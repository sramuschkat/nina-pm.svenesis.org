/**
 * Aufnahmen- und Ereignis-Ingest der NINA-API (AP-14b; TK 6.6, 7.6; FA-SYN-04…06, FA-NIN-17,
 * NT-10, NT-14, NT-E2, NT-E3, NIN5-8/9/14, DAT-3, DAT5-11/12/20/21):
 * - idempotent über die vom Plugin erzeugte `id` (`ON CONFLICT DO NOTHING`),
 * - Zugehörigkeit der ganzen Kette `exposure_line → project_panel → project → rig` gegen Mandant und Rig,
 * - Zähler nur für neue, gespeicherte Aufnahmen; Wächter `exposure_line` aufsteigend nach ID,
 * - `capture_night` genau eine Zeile je (Zeile, Nacht), `integration_s` aus der gemeldeten Belichtung,
 * - Flats/Dark-Flats in `flat_combination` (Schlüssel mit Zehntelgrad-Ganzzahl, erste Meldung gewinnt),
 * - Meldungen scheitern nie an der Lease; ohne Lease gespeicherte werden als Ereignis markiert.
 */
import { ProblemError } from '@nina-pm/shared';
import type { Kysely, Transaction } from 'kysely';
import { ProjectRepository } from './project';
import { withTx } from '../tx';
import type { Database } from '../types';
import { TenantRepo, type TenantContext } from './base';
import { LATE_REPORT_MS } from './nina-session';

type Tx = Transaction<Database>;

export type IngestStatus =
  'accepted' | 'duplicate' | 'archived' | 'unassigned' | 'rejected_invalid';

export interface CaptureInput {
  readonly id: string;
  readonly frameType: 'light' | 'flat' | 'dark_flat';
  readonly capturedAtUtc: string;
  readonly exposureMidUtc: string;
  readonly night: string;
  readonly nightPlanId: string | null;
  readonly filterShortName: string;
  readonly filterActual: string;
  readonly exposureS: number;
  readonly gain: number | null;
  readonly offset: number | null;
  readonly binning: number;
  readonly readoutMode: string | null;
  readonly readoutModeIndex: number | null;
  readonly rotatorMechDeg: number;
  readonly temperatureDeviation: boolean;
  readonly result: 'saved' | 'aborted' | 'failed';
  readonly fileName?: string | undefined;
  readonly metrics?: Readonly<Record<string, number | undefined>> | undefined;
  // Lights
  readonly blockId?: string | null | undefined;
  readonly projectId?: string | null | undefined;
  readonly panelId?: string | null | undefined;
  readonly exposureLineId?: string | null | undefined;
  readonly assignment?: 'unassigned' | undefined;
  readonly transitObservationId?: string | null | undefined;
  readonly raDeg?: number | undefined;
  readonly decDeg?: number | undefined;
  readonly rotationDeg?: number | undefined;
  readonly pierSide?: 'east' | 'west' | null | undefined;
  readonly bonus?: boolean | undefined;
  // Flats
  readonly projectIds?: readonly string[] | undefined;
  readonly flatsPlanned?: number | undefined;
  readonly darkFlatsPlanned?: number | undefined;
}

export interface EventInput {
  readonly id: string;
  readonly occurredAtUtc: string;
  readonly kind: string;
  readonly code?: string | null | undefined;
  readonly message?: string | undefined;
  readonly nightPlanId?: string | null | undefined;
  readonly blockId?: string | null | undefined;
  readonly projectId?: string | null | undefined;
  readonly durationS?: number | undefined;
  readonly data?: Record<string, unknown> | null | undefined;
}

/** Winkel auf [0, 360) (Datenbank-Check, AST-G07). */
const norm360 = (deg: number) => ((deg % 360) + 360) % 360;
/** Zehntelgrad als Ganzzahl, halbe Werte vom Nullpunkt weg (NIN5-8, DAT5-21). */
export const tenthDegrees = (deg: number) => {
  const x = norm360(deg) * 10;
  const r = x >= 0 ? Math.floor(x + 0.5) : -Math.floor(-x + 0.5);
  return r >= 3600 ? 0 : r;
};

interface LineInfo {
  readonly id: string;
  readonly projectId: string;
  readonly panelId: string;
  readonly filterShortName: string;
  readonly exposureS: number;
  readonly gain: number | null;
  readonly offsetAdu: number | null;
  readonly binning: number;
  readonly archived: boolean;
}

export class NinaIngestRepository extends TenantRepo {
  constructor(
    db: Kysely<Database>,
    ctx: TenantContext,
    private readonly rigId: string,
  ) {
    super(db, ctx);
  }

  private get tenantId() {
    return this.ctx.tenantId;
  }

  /**
   * Session für Meldungen: unbekannt → `409 session.unknown`, fremdes Rig → `404` (SEC-53),
   * länger als 7 Tage abgeschlossen → `409 session.closed` (TK 6.6).
   */
  private async reportingSession(trx: Tx, sessionId: string, now: Date) {
    const s = await trx
      .selectFrom('session')
      .select(['id', 'tenantId', 'rigId', 'status', 'endedAt', 'createdOffline', 'night'])
      .where('id', '=', sessionId)
      .executeTakeFirst();
    if (!s) throw new ProblemError('session.unknown');
    if (s.tenantId !== this.tenantId || s.rigId !== this.rigId)
      throw new ProblemError('resource.not_found');
    if (
      (s.status === 'completed' || s.status === 'aborted') &&
      s.endedAt !== null &&
      now.getTime() - new Date(s.endedAt).getTime() > LATE_REPORT_MS
    )
      throw new ProblemError('session.closed');
    return s;
  }

  /** Hält die Session gerade die Lease? Sonst werden Meldungen markiert (NT-14). */
  private async holdsLease(trx: Tx, sessionId: string, now: Date): Promise<boolean> {
    const l = await trx
      .selectFrom('rigLease')
      .select(['activeSessionId', 'leaseUntil', 'offlineUntil'])
      .where('rigId', '=', this.rigId)
      .where('tenantId', '=', this.tenantId)
      .executeTakeFirst();
    if (!l || l.activeSessionId !== sessionId) return false;
    const frozen = l.offlineUntil !== null && new Date(l.offlineUntil) > now;
    return frozen || (l.leaseUntil !== null && new Date(l.leaseUntil) > now);
  }

  /** Zeilen der Meldungen mit der ganzen Kette gegen Mandant **und** Rig (DAT-3). */
  private async lines(trx: Tx, ids: readonly string[]): Promise<Map<string, LineInfo>> {
    if (ids.length === 0) return new Map();
    const rows = await trx
      .selectFrom('exposureLine as l')
      .innerJoin('projectPanel as pp', 'pp.id', 'l.panelId')
      .innerJoin('project as p', 'p.id', 'l.projectId')
      .select([
        'l.id',
        'l.projectId',
        'l.panelId',
        'l.filterShortName',
        'l.exposureS',
        'l.gain',
        'l.offsetAdu',
        'l.binning',
        'l.deletedAt as lineDeleted',
        'pp.deletedAt as panelDeleted',
        'pp.projectId as panelProject',
        'p.deletedAt as projectDeleted',
        'p.status',
        'p.rigId',
      ])
      .where('l.tenantId', '=', this.tenantId)
      .where('pp.tenantId', '=', this.tenantId)
      .where('p.tenantId', '=', this.tenantId)
      .where('l.id', 'in', [...ids])
      .execute();
    const out = new Map<string, LineInfo>();
    for (const r of rows) {
      if (r.rigId !== this.rigId || r.panelProject !== r.projectId) continue;
      out.set(r.id, {
        id: r.id,
        projectId: r.projectId,
        panelId: r.panelId,
        filterShortName: r.filterShortName,
        exposureS: Number(r.exposureS),
        gain: r.gain,
        offsetAdu: r.offsetAdu,
        binning: Number(r.binning),
        archived:
          r.lineDeleted !== null ||
          r.panelDeleted !== null ||
          r.projectDeleted !== null ||
          r.status === 'archived',
      });
    }
    return out;
  }

  /** Projekte des Rigs im Mandanten (Flat-Ziellisten, DAT-3). */
  private async rigProjects(trx: Tx, ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await trx
      .selectFrom('project')
      .select('id')
      .where('tenantId', '=', this.tenantId)
      .where('rigId', '=', this.rigId)
      .where('id', 'in', [...new Set(ids)])
      .execute();
    return new Set(rows.map((r) => r.id));
  }

  /**
   * `POST /sessions/{id}/captures` (TK 6.6): Status je Meldung; ungültige werden **nicht** gespeichert
   * (`rejected_invalid`), alle übrigen gespeichert und – falls gespeichert (`result = saved`) – gezählt.
   */
  ingestCaptures(
    sessionId: string,
    captures: readonly CaptureInput[],
    now: Date,
    serverEventId: () => string,
  ): Promise<{ results: { id: string; status: IngestStatus }[]; withoutLease: boolean }> {
    return withTx(this.db, async (trx) => {
      const session = await this.reportingSession(trx, sessionId, now);
      const lineIds = captures
        .filter((c) => c.frameType === 'light' && c.exposureLineId)
        .map((c) => c.exposureLineId as string);
      const lines = await this.lines(trx, lineIds);
      const projects = await this.rigProjects(
        trx,
        captures.flatMap((c) => (c.frameType === 'light' ? [] : [...(c.projectIds ?? [])])),
      );
      const transitIds = [
        ...new Set(captures.map((c) => c.transitObservationId).filter((x): x is string => !!x)),
      ];
      const transits = new Map(
        transitIds.length === 0
          ? []
          : (
              await trx
                .selectFrom('transitObservation')
                .select(['id', 'projectId'])
                .where('tenantId', '=', this.tenantId)
                .where('id', 'in', transitIds)
                .execute()
            ).map((r) => [r.id, r.projectId] as const),
      );

      const status = new Map<string, IngestStatus>();
      const rows: Record<string, unknown>[] = [];
      for (const c of captures) {
        const invalid = () => status.set(c.id, 'rejected_invalid');
        if (c.nightPlanId === null && !session.createdOffline) {
          invalid();
          continue;
        }
        if (c.result === 'saved' && !c.fileName) {
          invalid();
          continue;
        }
        const base = {
          id: c.id,
          tenantId: this.tenantId,
          sessionId,
          frameType: c.frameType,
          night: c.night,
          capturedAt: new Date(c.capturedAtUtc),
          exposureMidUtc: new Date(c.exposureMidUtc),
          nightPlanId: c.nightPlanId,
          filterShortName: c.filterShortName,
          filterActual: c.filterActual,
          exposureS: c.exposureS,
          gain: c.gain,
          offsetAdu: c.offset,
          binning: c.binning,
          readoutMode: c.readoutMode,
          readoutModeIndex: c.readoutModeIndex ?? 0,
          rotatorMechDeg: norm360(c.rotatorMechDeg),
          result: c.result,
          temperatureDeviation: c.temperatureDeviation,
          fileName: c.fileName ?? null,
          metrics: c.metrics ? JSON.stringify(c.metrics) : null,
        };
        if (c.frameType === 'light') {
          const light = {
            ...base,
            blockId: c.blockId ?? null,
            raDeg: c.raDeg ?? null,
            decDeg: c.decDeg ?? null,
            rotationDeg: c.rotationDeg === undefined ? null : norm360(c.rotationDeg),
            pierSide: c.pierSide ?? null,
            isBonus: c.bonus === true,
          };
          if (c.assignment === 'unassigned' || !c.exposureLineId) {
            if (c.assignment !== 'unassigned') {
              invalid();
              continue;
            }
            rows.push({ ...light, assignment: 'unassigned' });
            status.set(c.id, 'unassigned');
            continue;
          }
          const line = lines.get(c.exposureLineId);
          if (!line || line.projectId !== c.projectId || line.panelId !== c.panelId) {
            invalid();
            continue;
          }
          if (c.transitObservationId && transits.get(c.transitObservationId) !== line.projectId) {
            invalid();
            continue;
          }
          const deviation =
            c.filterShortName !== line.filterShortName ||
            c.exposureS !== line.exposureS ||
            c.binning !== line.binning ||
            c.gain !== line.gain ||
            c.offset !== line.offsetAdu;
          rows.push({
            ...light,
            projectId: line.projectId,
            panelId: line.panelId,
            exposureLineId: line.id,
            transitObservationId: c.transitObservationId ?? null,
            assignment: 'assigned',
            settingsDeviation: deviation,
          });
          status.set(c.id, line.archived ? 'archived' : 'accepted');
          continue;
        }
        const ids = c.projectIds ?? [];
        if (ids.some((p) => !projects.has(p))) {
          invalid();
          continue;
        }
        rows.push({ ...base, projectIds: JSON.stringify(ids), assignment: 'assigned' });
        status.set(c.id, 'accepted');
      }

      const inserted =
        rows.length === 0
          ? []
          : await trx
              .insertInto('capture')
              .values(rows as never)
              .onConflict((oc) => oc.column('id').doNothing())
              .returning('id')
              .execute();
      const fresh = new Set(inserted.map((r) => r.id));
      for (const r of rows) if (!fresh.has(r.id as string)) status.set(r.id as string, 'duplicate');
      const added = captures.filter((c) => fresh.has(c.id));

      // Zähler je Zeile und Nacht für neue gespeicherte Lights (Wächter aufsteigend, DAT5-20).
      const byLineNight = new Map<
        string,
        { line: string; night: string; n: number; bonus: number; s: number }
      >();
      for (const c of added) {
        if (c.frameType !== 'light' || c.result !== 'saved' || !c.exposureLineId) continue;
        if (c.assignment === 'unassigned') continue;
        const k = `${c.exposureLineId}|${c.night}`;
        const agg = byLineNight.get(k) ?? {
          line: c.exposureLineId,
          night: c.night,
          n: 0,
          bonus: 0,
          s: 0,
        };
        if (c.bonus) agg.bonus += 1;
        else agg.n += 1;
        agg.s += c.exposureS;
        byLineNight.set(k, agg);
      }
      const touched = [...new Set([...byLineNight.values()].map((a) => a.line))].sort();
      for (const lineId of touched) {
        await trx
          .selectFrom('exposureLine')
          .select('id')
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', lineId)
          .forUpdate()
          .execute();
      }
      for (const agg of [...byLineNight.values()].sort((a, b) =>
        a.line === b.line ? (a.night < b.night ? -1 : 1) : a.line < b.line ? -1 : 1,
      )) {
        const line = lines.get(agg.line) as LineInfo;
        await trx
          .updateTable('exposureLine')
          .set((eb) => ({
            acquiredCount: eb('acquiredCount', '+', agg.n),
            bonusCount: eb('bonusCount', '+', agg.bonus),
            updatedAt: now,
          }))
          .where('tenantId', '=', this.tenantId)
          .where('id', '=', agg.line)
          .execute();
        await trx
          .insertInto('captureNight')
          .values({
            tenantId: this.tenantId,
            exposureLineId: agg.line,
            night: agg.night,
            projectId: line.projectId,
            acquiredCount: agg.n,
            bonusCount: agg.bonus,
            integrationS: agg.s,
            sources: JSON.stringify(['nina']),
            updatedAt: now,
          })
          .onConflict((oc) =>
            oc.columns(['exposureLineId', 'night']).doUpdateSet((eb) => ({
              acquiredCount: eb(
                'captureNight.acquiredCount',
                '+',
                eb.ref('excluded.acquiredCount'),
              ),
              bonusCount: eb('captureNight.bonusCount', '+', eb.ref('excluded.bonusCount')),
              integrationS: eb('captureNight.integrationS', '+', eb.ref('excluded.integrationS')),
              updatedAt: now,
            })),
          )
          .execute();
      }

      await this.countFlats(trx, sessionId, added, now);

      const withoutLease = added.length > 0 && !(await this.holdsLease(trx, sessionId, now));
      if (withoutLease)
        await trx
          .insertInto('sessionEvent')
          .values({
            id: serverEventId(),
            tenantId: this.tenantId,
            sessionId,
            occurredAt: now,
            kind: 'lease_conflict',
            message: 'Aufnahmen ohne gültige Lease gespeichert',
            data: JSON.stringify({
              count: added.length,
              captureIds: added.slice(0, 50).map((c) => c.id),
            }),
          })
          .execute();
      return {
        results: captures.map((c) => ({
          id: c.id,
          status: status.get(c.id) ?? 'rejected_invalid',
        })),
        withoutLease,
      };
    });
  }

  /** Flats/Dark-Flats je Kombination (TK 6.6, NIN5-8/9, DAT5-7/21). */
  private async countFlats(trx: Tx, sessionId: string, added: readonly CaptureInput[], now: Date) {
    const calib = added.filter((c) => c.frameType !== 'light' && c.result === 'saved');
    if (calib.length === 0) return;
    const rig = await trx
      .selectFrom('rig')
      .select(['flatCount', 'darkFlatCount'])
      .where('tenantId', '=', this.tenantId)
      .where('id', '=', this.rigId)
      .executeTakeFirst();
    const groups = new Map<string, CaptureInput[]>();
    const keyOf = (c: CaptureInput) =>
      [
        c.filterShortName,
        tenthDegrees(c.rotatorMechDeg),
        c.gain ?? -1,
        c.offset ?? -1,
        c.binning,
        c.readoutModeIndex ?? 0,
      ].join('|');
    for (const c of calib) groups.set(keyOf(c), [...(groups.get(keyOf(c)) ?? []), c]);
    for (const list of [...groups.values()].sort((a, b) =>
      keyOf(a[0] as CaptureInput) < keyOf(b[0] as CaptureInput) ? -1 : 1,
    )) {
      const first = list[0] as CaptureInput;
      const where = {
        filterShortName: first.filterShortName,
        rotatorMechDegDg: tenthDegrees(first.rotatorMechDeg),
        gain: first.gain ?? -1,
        offsetAdu: first.offset ?? -1,
        binning: first.binning,
        readoutModeIndex: first.readoutModeIndex ?? 0,
      };
      const existing = await trx
        .selectFrom('flatCombination')
        .selectAll()
        .where('tenantId', '=', this.tenantId)
        .where('sessionId', '=', sessionId)
        .where('filterShortName', '=', where.filterShortName)
        .where('rotatorMechDegDg', '=', where.rotatorMechDegDg)
        .where('gain', '=', where.gain)
        .where('offsetAdu', '=', where.offsetAdu)
        .where('binning', '=', where.binning)
        .where('readoutModeIndex', '=', where.readoutModeIndex)
        .forUpdate()
        .executeTakeFirst();
      const flats = list.filter((c) => c.frameType === 'flat');
      const darks = list.filter((c) => c.frameType === 'dark_flat');
      const ids = [...new Set(list.flatMap((c) => [...(c.projectIds ?? [])]))];
      const lastFlat = flats[flats.length - 1];
      if (!existing) {
        const flatsPlanned = first.flatsPlanned ?? Number(rig?.flatCount ?? 0);
        const darkPlanned =
          first.darkFlatsPlanned ?? Number(rig?.darkFlatCount ?? rig?.flatCount ?? 0);
        const done = flats.length >= flatsPlanned && darks.length >= darkPlanned;
        await trx
          .insertInto('flatCombination')
          .values({
            tenantId: this.tenantId,
            sessionId,
            ...where,
            readoutMode: first.readoutMode ?? '',
            status: done ? 'done' : 'running',
            projectIds: JSON.stringify(ids.sort()),
            flatsPlanned,
            flatsTaken: flats.length,
            flatExposureS: lastFlat ? lastFlat.exposureS : null,
            darkFlatsPlanned: darkPlanned,
            darkFlatsTaken: darks.length,
          })
          .execute();
        continue;
      }
      const prevIds = (
        typeof existing.projectIds === 'string'
          ? JSON.parse(existing.projectIds)
          : existing.projectIds
      ) as string[];
      const flatsTaken = Number(existing.flatsTaken) + flats.length;
      const darkTaken = Number(existing.darkFlatsTaken) + darks.length;
      const done =
        flatsTaken >= Number(existing.flatsPlanned) &&
        darkTaken >= Number(existing.darkFlatsPlanned);
      await trx
        .updateTable('flatCombination')
        .set({
          flatsTaken,
          darkFlatsTaken: darkTaken,
          projectIds: JSON.stringify([...new Set([...prevIds, ...ids])].sort()),
          ...(lastFlat ? { flatExposureS: lastFlat.exposureS } : {}),
          ...(done ? { status: 'done' } : {}),
        })
        .where('tenantId', '=', this.tenantId)
        .where('sessionId', '=', sessionId)
        .where('filterShortName', '=', where.filterShortName)
        .where('rotatorMechDegDg', '=', where.rotatorMechDegDg)
        .where('gain', '=', where.gain)
        .where('offsetAdu', '=', where.offsetAdu)
        .where('binning', '=', where.binning)
        .where('readoutModeIndex', '=', where.readoutModeIndex)
        .execute();
      void now;
    }
  }

  /** `POST /sessions/{id}/events`: idempotent über `id` (TK 7.3). */
  ingestEvents(
    sessionId: string,
    events: readonly EventInput[],
    now: Date,
  ): Promise<{ accepted: number; duplicate: number }> {
    return withTx(this.db, async (trx) => {
      await this.reportingSession(trx, sessionId, now);
      const inserted = await trx
        .insertInto('sessionEvent')
        .values(
          events.map((e) => ({
            id: e.id,
            tenantId: this.tenantId,
            sessionId,
            occurredAt: new Date(e.occurredAtUtc),
            kind: e.kind,
            projectId: e.projectId ?? null,
            nightPlanId: e.nightPlanId ?? null,
            blockId: e.blockId ?? null,
            durationS: e.durationS ?? null,
            message: e.message ?? null,
            data: JSON.stringify({ ...(e.data ?? {}), ...(e.code ? { code: e.code } : {}) }),
          })),
        )
        .onConflict((oc) => oc.column('id').doNothing())
        .returning('id')
        .execute();
      return { accepted: inserted.length, duplicate: events.length - inserted.length };
    });
  }
}

/**
 * Korrektur „verworfen“ je Zeile und Nacht (FA-AUS-06, TK 6.6): wirksam ist
 * `max(Korrektur, einzeln verworfene)`; eine Korrektur unter der Anzahl einzeln verworfener →
 * `409 correction.conflict`. Zähler und `integration_s` werden um die Differenz angepasst.
 */
export async function applyCorrection(
  db: Kysely<Database>,
  input: {
    tenantId: string;
    userId: string;
    exposureLineId: string;
    night: string;
    rejected: number;
    reason: string | null;
    comment: string | null;
  },
  now: Date,
): Promise<{ rejectedCount: number; projectStatus: string | null }> {
  return withTx(db, async (trx) => {
    const line = await trx
      .selectFrom('exposureLine')
      .select(['id', 'projectId', 'exposureS', 'rejectedCount'])
      .where('tenantId', '=', input.tenantId)
      .where('id', '=', input.exposureLineId)
      .forUpdate()
      .executeTakeFirst();
    if (!line) throw new ProblemError('resource.not_found');
    const cn = await trx
      .selectFrom('captureNight')
      .selectAll()
      .where('tenantId', '=', input.tenantId)
      .where('exposureLineId', '=', input.exposureLineId)
      .where('night', '=', input.night)
      .executeTakeFirst();
    const individual = Number(cn?.rejectedIndividual ?? 0);
    if (input.rejected < individual) throw new ProblemError('correction.conflict');
    const before = Number(cn?.rejectedCount ?? 0);
    const after = Math.max(individual, input.rejected);
    const delta = after - before;
    await trx
      .insertInto('correction')
      .values({
        tenantId: input.tenantId,
        exposureLineId: input.exposureLineId,
        night: input.night,
        rejectedCount: input.rejected,
        reason: input.reason,
        comment: input.comment,
        userId: input.userId,
      })
      .execute();
    await trx
      .insertInto('captureNight')
      .values({
        tenantId: input.tenantId,
        exposureLineId: input.exposureLineId,
        night: input.night,
        projectId: line.projectId,
        rejectedCorrection: input.rejected,
        rejectedCount: after,
        integrationS: -delta * Number(line.exposureS),
        sources: JSON.stringify(['correction']),
        updatedAt: now,
      })
      .onConflict((oc) =>
        oc.columns(['exposureLineId', 'night']).doUpdateSet((eb) => ({
          rejectedCorrection: input.rejected,
          rejectedCount: after,
          integrationS: eb('captureNight.integrationS', '-', delta * Number(line.exposureS)),
          updatedAt: now,
        })),
      )
      .execute();
    await trx
      .updateTable('exposureLine')
      .set((eb) => ({ rejectedCount: eb('rejectedCount', '+', delta), updatedAt: now }))
      .where('tenantId', '=', input.tenantId)
      .where('id', '=', input.exposureLineId)
      .execute();
    await trx
      .updateTable('project')
      .set({ effortStale: true })
      .where('tenantId', '=', input.tenantId)
      .where('id', '=', line.projectId)
      .execute();
    // Verbleibend steigt → fertiges Projekt zurück nach *Aktiv* (FA-PRJ-12, AP-15).
    const status = await new ProjectRepository(trx, {
      tenantId: input.tenantId,
      memberId: input.userId,
    }).reactivateAfterCounts(trx, line.projectId, now);
    return { rejectedCount: after, projectStatus: status };
  });
}

/**
 * Einzelne Aufnahme verwerfen bzw. zurücknehmen (`PATCH /web/v1/captures/{id}`, FA-AUS-20, TK 6.6): nur
 * gespeicherte, zugeordnete Lights (sonst `409 capture.not_rejectable`). In **einer** Transaktion mit
 * Wächter auf der Zeile: Aufnahme ändern, `capture_night` der Nacht nachführen – Nicht-Bonus nach der
 * Regel `verworfen = max(Korrektur, einzeln verworfene)` (FA-AUS-06), Bonus in *Bonus verworfen* –,
 * Integrationszeit mit der **gemeldeten** Belichtung der Aufnahme (NT-E3), der von einer Korrektur ohne
 * Einzelauswahl abgedeckte Rest mit der Belichtung der Zeile; Zeilenzähler, `project.effort_stale`,
 * Rückkehr nach *Aktiv* (FA-PRJ-12). Unveränderter Zustand ändert nichts (idempotent).
 */
export async function rejectCapture(
  db: Kysely<Database>,
  input: {
    tenantId: string;
    userId: string;
    captureId: string;
    rejected: boolean;
    reason: string | null;
  },
  now: Date,
): Promise<{
  captureId: string;
  rejected: boolean;
  rejectedCount: number;
  bonusRejectedCount: number;
  projectStatus: string | null;
}> {
  const target = await db
    .selectFrom('capture')
    .select(['exposureLineId'])
    .where('tenantId', '=', input.tenantId)
    .where('id', '=', input.captureId)
    .executeTakeFirst();
  if (!target) throw new ProblemError('resource.not_found');
  if (!target.exposureLineId) throw new ProblemError('capture.not_rejectable');
  const lineId = target.exposureLineId;
  return withTx(
    db,
    async (trx) => {
      const line = await trx
        .selectFrom('exposureLine')
        .select(['id', 'projectId', 'exposureS'])
        .where('tenantId', '=', input.tenantId)
        .where('id', '=', lineId)
        .executeTakeFirst();
      if (!line) throw new ProblemError('resource.not_found');
      const c = await trx
        .selectFrom('capture')
        .select([
          'id',
          'night',
          'frameType',
          'result',
          'assignment',
          'isBonus',
          'rejected',
          'exposureS',
          'exposureLineId',
        ])
        .where('tenantId', '=', input.tenantId)
        .where('id', '=', input.captureId)
        .executeTakeFirst();
      if (!c) throw new ProblemError('resource.not_found');
      if (
        c.frameType !== 'light' ||
        c.result !== 'saved' ||
        c.assignment !== 'assigned' ||
        c.exposureLineId !== lineId
      )
        throw new ProblemError('capture.not_rejectable');
      const night = String(c.night);
      const cn = await trx
        .selectFrom('captureNight')
        .selectAll()
        .where('tenantId', '=', input.tenantId)
        .where('exposureLineId', '=', lineId)
        .where('night', '=', night)
        .executeTakeFirst();
      const was = Boolean(c.rejected);
      if (was === input.rejected) {
        // Nur der Grund kann sich ändern; Zähler bleiben.
        if (was)
          await trx
            .updateTable('capture')
            .set({ rejectReason: input.reason })
            .where('tenantId', '=', input.tenantId)
            .where('id', '=', c.id)
            .execute();
        return {
          captureId: c.id,
          rejected: was,
          rejectedCount: Number(cn?.rejectedCount ?? 0),
          bonusRejectedCount: Number(cn?.bonusRejectedCount ?? 0),
          projectStatus: null,
        };
      }
      await trx
        .updateTable('capture')
        .set({ rejected: input.rejected, rejectReason: input.rejected ? input.reason : null })
        .where('tenantId', '=', input.tenantId)
        .where('id', '=', c.id)
        .execute();
      const step = input.rejected ? 1 : -1;
      const exposure = Number(c.exposureS);
      const lineExposure = Number(line.exposureS);
      const correction = Number(cn?.rejectedCorrection ?? 0);
      const individual = Number(cn?.rejectedIndividual ?? 0);
      const rejectedBefore = Number(cn?.rejectedCount ?? 0);
      const bonusRejectedBefore = Number(cn?.bonusRejectedCount ?? 0);
      let individualAfter = individual;
      let rejectedAfter = rejectedBefore;
      let bonusRejectedAfter = bonusRejectedBefore;
      // Integration: die Aufnahme selbst mit ihrer gemeldeten Belichtung; bei Nicht-Bonus ändert sich
      // zusätzlich der von der Korrektur abgedeckte Rest (max-Regel) mit der Belichtung der Zeile.
      let integrationDelta = -step * exposure;
      if (c.isBonus) {
        bonusRejectedAfter = Math.max(0, bonusRejectedBefore + step);
      } else {
        individualAfter = Math.max(0, individual + step);
        rejectedAfter = Math.max(correction, individualAfter);
        const restBefore = Math.max(0, rejectedBefore - individual);
        const restAfter = Math.max(0, rejectedAfter - individualAfter);
        integrationDelta -= (restAfter - restBefore) * lineExposure;
      }
      if (cn)
        await trx
          .updateTable('captureNight')
          .set((eb) => ({
            rejectedIndividual: individualAfter,
            rejectedCount: rejectedAfter,
            bonusRejectedCount: bonusRejectedAfter,
            integrationS: eb('integrationS', '+', integrationDelta),
            updatedAt: now,
          }))
          .where('tenantId', '=', input.tenantId)
          .where('exposureLineId', '=', lineId)
          .where('night', '=', night)
          .execute();
      await trx
        .updateTable('exposureLine')
        .set((eb) => ({
          rejectedCount: eb('rejectedCount', '+', rejectedAfter - rejectedBefore),
          bonusRejectedCount: eb(
            'bonusRejectedCount',
            '+',
            bonusRejectedAfter - bonusRejectedBefore,
          ),
          updatedAt: now,
        }))
        .where('tenantId', '=', input.tenantId)
        .where('id', '=', lineId)
        .execute();
      await trx
        .updateTable('project')
        .set({ effortStale: true })
        .where('tenantId', '=', input.tenantId)
        .where('id', '=', line.projectId)
        .execute();
      const status = await new ProjectRepository(trx, {
        tenantId: input.tenantId,
        memberId: input.userId,
      }).reactivateAfterCounts(trx, line.projectId, now);
      return {
        captureId: c.id,
        rejected: input.rejected,
        rejectedCount: rejectedAfter,
        bonusRejectedCount: bonusRejectedAfter,
        projectStatus: status,
      };
    },
    { guard: [{ table: 'exposure_line', id: lineId, tenantId: input.tenantId }] },
  );
}

/**
 * Nachträgliche Zuordnung (`PATCH /web/v1/captures/{id}/assign`, DAT5-12): Kette gegen den Mandanten
 * (sonst `409 capture.assign_mismatch`), Zähler +1 und `capture_night` anlegen bzw. erhöhen.
 */
export async function assignCapture(
  db: Kysely<Database>,
  tenantId: string,
  captureId: string,
  exposureLineId: string,
  now: Date,
): Promise<void> {
  await withTx(db, async (trx) => {
    const c = await trx
      .selectFrom('capture as c')
      .innerJoin('session as s', 's.id', 'c.sessionId')
      .select([
        'c.id',
        'c.assignment',
        'c.frameType',
        'c.result',
        'c.isBonus',
        'c.night',
        'c.exposureS',
        's.rigId',
      ])
      .where('c.tenantId', '=', tenantId)
      .where('c.id', '=', captureId)
      .executeTakeFirst();
    if (!c) throw new ProblemError('resource.not_found');
    if (c.frameType !== 'light' || c.assignment !== 'unassigned')
      throw new ProblemError('capture.assign_mismatch');
    const line = await trx
      .selectFrom('exposureLine as l')
      .innerJoin('project as p', 'p.id', 'l.projectId')
      .select(['l.id', 'l.projectId', 'l.panelId', 'p.rigId'])
      .where('l.tenantId', '=', tenantId)
      .where('p.tenantId', '=', tenantId)
      .where('l.id', '=', exposureLineId)
      .forUpdate()
      .executeTakeFirst();
    if (!line || line.rigId !== c.rigId) throw new ProblemError('capture.assign_mismatch');
    await trx
      .updateTable('capture')
      .set({
        assignment: 'assigned',
        exposureLineId: line.id,
        projectId: line.projectId,
        panelId: line.panelId,
      })
      .where('tenantId', '=', tenantId)
      .where('id', '=', captureId)
      .execute();
    if (c.result !== 'saved') return;
    const bonus = c.isBonus ? 1 : 0;
    await trx
      .updateTable('exposureLine')
      .set((eb) => ({
        acquiredCount: eb('acquiredCount', '+', 1 - bonus),
        bonusCount: eb('bonusCount', '+', bonus),
        updatedAt: now,
      }))
      .where('tenantId', '=', tenantId)
      .where('id', '=', line.id)
      .execute();
    await trx
      .insertInto('captureNight')
      .values({
        tenantId,
        exposureLineId: line.id,
        night: c.night,
        projectId: line.projectId,
        acquiredCount: 1 - bonus,
        bonusCount: bonus,
        integrationS: Number(c.exposureS),
        sources: JSON.stringify(['nina']),
        updatedAt: now,
      })
      .onConflict((oc) =>
        oc.columns(['exposureLineId', 'night']).doUpdateSet((eb) => ({
          acquiredCount: eb('captureNight.acquiredCount', '+', 1 - bonus),
          bonusCount: eb('captureNight.bonusCount', '+', bonus),
          integrationS: eb('captureNight.integrationS', '+', Number(c.exposureS)),
          updatedAt: now,
        })),
      )
      .execute();
  });
}
