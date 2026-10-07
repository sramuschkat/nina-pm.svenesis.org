/**
 * Sessions im Web (AP-15; S-60, S-61; FA-AUS-01…03, FA-AUS-07, FA-AUS-22; TK 7.2): Liste je Rig und
 * Nacht mit Frames/Integration, Detail mit Soll/Ist je Zeile (Soll = erste Planrevision der Session ohne
 * Bonus, Ist = Aufnahmen dieser Session; Entscheidung Sven 07.10.2026), Aufnahmen mit Kennzeichen,
 * Ereignisse, Flats; *Als geprüft
 * markieren*; Ziel einer Korrektur prüfen (Zeile eines Projekts am Rig der Session).
 */
import { ProblemError, sessionKpis, type KpiPlanEntry, type RejectReason } from '@nina-pm/shared';
import { sql } from 'kysely';
import { TenantRepo } from './base';

const iso = (v: Date | string | null | undefined): string | null =>
  v === null || v === undefined ? null : new Date(v).toISOString().replace(/\.\d{3}Z$/, 'Z');
const num = (v: unknown) => Number(v ?? 0);

export interface NightSessionRow {
  readonly id: string;
  readonly rigId: string;
  readonly rigName: string;
  readonly siteTimeZone: string;
  readonly night: string;
  readonly status: 'running' | 'completed' | 'aborted' | 'stale';
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly sessionEndUtc: string | null;
  readonly createdOffline: boolean;
  readonly reviewed: boolean;
  readonly reviewedBy: string | null;
  readonly ninaInstanceName: string | null;
  readonly frames: number;
  readonly bonusFrames: number;
  readonly integrationS: number;
  readonly unassigned: number;
}

export interface NightSessionFilter {
  readonly rigId?: string | undefined;
  readonly unreviewed?: boolean | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly limit: number;
}

interface PlanSummary {
  readonly darknessEndUtc?: string | null;
  readonly darkness?: {
    readonly astronomicalStartUtc?: string | null;
    readonly astronomicalEndUtc?: string | null;
  };
}

const parseJson = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;

/** Eintrag eines gespeicherten Plan-Blocks (`night_plan.blocks[].entries[]`, TK 7.6) – nur gelesene Felder. */
interface PlanEntryJson {
  readonly cmd?: string;
  readonly atUtc?: string;
  readonly untilUtc?: string;
  readonly exposureLineId?: string;
  readonly exposureS?: number;
  readonly bonus?: boolean;
}
interface PlanBlockJson {
  readonly entries?: readonly PlanEntryJson[];
}

/** Soll einer Zeile in einem Plan: Frames ohne Bonus, Transit-Serie als Zeitfenster. */
export interface LineSoll {
  readonly frames: number;
  readonly series: { readonly fromUtc: string; readonly untilUtc: string } | null;
}

/**
 * Soll je Zeile aus den Blöcken eines Plans (Entscheidung Sven 07.10.2026): `expose` ohne `bonus: true` zählt
 * einen Frame, `expose_series` (Transit) ergibt das Zeitfenster vom frühesten Beginn bis zum spätesten
 * Ende. `summary.plannedFrames` der Engine zählt Bonus-Frames mit und taugt dafür nicht. Zeilen nur mit
 * Bonus-Einträgen fehlen im Ergebnis.
 */
export function plannedByLine(blocks: readonly PlanBlockJson[] | null): Map<string, LineSoll> {
  const acc = new Map<string, { frames: number; from: string | null; until: string | null }>();
  for (const b of blocks ?? [])
    for (const e of b.entries ?? []) {
      if (!e.exposureLineId) continue;
      const frame = e.cmd === 'expose' && e.bonus !== true;
      const series = e.cmd === 'expose_series' && Boolean(e.atUtc) && Boolean(e.untilUtc);
      if (!frame && !series) continue;
      const cur = acc.get(e.exposureLineId) ?? { frames: 0, from: null, until: null };
      if (frame) cur.frames += 1;
      else {
        const from = e.atUtc as string;
        const until = e.untilUtc as string;
        if (cur.from === null || Date.parse(from) < Date.parse(cur.from)) cur.from = from;
        if (cur.until === null || Date.parse(until) > Date.parse(cur.until)) cur.until = until;
      }
      acc.set(e.exposureLineId, cur);
    }
  return new Map(
    [...acc].map(([lineId, v]) => [
      lineId,
      {
        frames: v.frames,
        series:
          v.from !== null && v.until !== null
            ? { fromUtc: iso(v.from) as string, untilUtc: iso(v.until) as string }
            : null,
      },
    ]),
  );
}

/**
 * Anteil einer Session am Korrektur-Überhang einer Zeile in der Nacht. Verworfen = max(Korrektur, einzeln
 * verworfene) gilt je Zeile und Nacht, nicht je Session (FA-AUS-06). Den Überhang über die einzeln
 * verworfenen tragen die Sessions nach Beginn (bei Gleichstand nach ID), jede höchstens bis zu ihren nicht
 * verworfenen Nicht-Bonus-Aufnahmen – die Summe über die Sessions ergibt den Nachtwert.
 */
export function correctionShare(
  extra: number,
  sessions: readonly { sessionId: string; startedAt: string; open: number }[],
  sessionId: string,
): number {
  let rest = Math.max(0, extra);
  const ordered = [...sessions].sort(
    (a, b) =>
      Date.parse(a.startedAt) - Date.parse(b.startedAt) ||
      (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0),
  );
  for (const s of ordered) {
    const take = Math.min(rest, Math.max(0, s.open));
    if (s.sessionId === sessionId) return take;
    rest -= take;
  }
  return 0;
}

/** HFR und Sterne aus `capture.metrics` (AP-62); fehlende oder ungültige Werte → `null`, nie 0. */
export function captureMetrics(v: unknown): { hfr: number | null; stars: number | null } {
  let m: { hfr?: unknown; stars?: unknown } | null;
  try {
    m = v === null || v === undefined ? null : parseJson<{ hfr?: unknown; stars?: unknown }>(v);
  } catch {
    m = null;
  }
  const hfr = typeof m?.hfr === 'number' && Number.isFinite(m.hfr) && m.hfr > 0 ? m.hfr : null;
  const stars =
    typeof m?.stars === 'number' && Number.isInteger(m.stars) && m.stars > 0 ? m.stars : null;
  return { hfr, stars };
}

export class SessionReviewRepository extends TenantRepo {
  private base() {
    return this.db
      .selectFrom('session as s')
      .innerJoin('rig as r', (j) =>
        j.onRef('r.id', '=', 's.rigId').onRef('r.tenantId', '=', 's.tenantId'),
      )
      .innerJoin('site as st', (j) =>
        j.onRef('st.id', '=', 'r.siteId').onRef('st.tenantId', '=', 'r.tenantId'),
      )
      .leftJoin('ninaInstance as ni', (j) =>
        j.onRef('ni.id', '=', 's.ninaInstanceId').onRef('ni.tenantId', '=', 's.tenantId'),
      )
      .select([
        's.id',
        's.rigId',
        'r.name as rigName',
        'st.timeZone as siteTimeZone',
        's.night',
        's.status',
        's.startedAt',
        's.endedAt',
        's.sessionEndUtc',
        's.createdOffline',
        's.reviewed',
        's.reviewedBy',
        'ni.name as ninaInstanceName',
      ])
      .where('s.tenantId', '=', this.ctx.tenantId);
  }

  /** Frames, Bonus, Integration und Unzugeordnete je Session (FK 8.4: gespeicherte Lights). */
  private async counts(ids: readonly string[]) {
    if (ids.length === 0) return new Map<string, { f: number; b: number; s: number; u: number }>();
    const rows = await this.db
      .selectFrom('capture')
      .select((eb) => [
        'sessionId',
        sql<number>`SUM(CASE WHEN frame_type = 'light' AND result = 'saved' AND assignment = 'assigned' AND NOT is_bonus AND NOT rejected THEN 1 ELSE 0 END)`.as(
          'f',
        ),
        sql<number>`SUM(CASE WHEN frame_type = 'light' AND result = 'saved' AND assignment = 'assigned' AND is_bonus AND NOT rejected THEN 1 ELSE 0 END)`.as(
          'b',
        ),
        sql<number>`SUM(CASE WHEN frame_type = 'light' AND result = 'saved' AND assignment = 'assigned' AND NOT rejected THEN exposure_s ELSE 0 END)`.as(
          's',
        ),
        sql<number>`SUM(CASE WHEN frame_type = 'light' AND assignment = 'unassigned' THEN 1 ELSE 0 END)`.as(
          'u',
        ),
        eb.fn.countAll<number>().as('n'),
      ])
      .where('tenantId', '=', this.ctx.tenantId)
      .where('sessionId', 'in', [...ids])
      .groupBy('sessionId')
      .execute();
    return new Map(
      rows.map((r) => [r.sessionId, { f: num(r.f), b: num(r.b), s: num(r.s), u: num(r.u) }]),
    );
  }

  private static view(
    r: Awaited<ReturnType<ReturnType<SessionReviewRepository['base']>['executeTakeFirstOrThrow']>>,
    c: { f: number; b: number; s: number; u: number } | undefined,
  ): NightSessionRow {
    return {
      id: r.id,
      rigId: r.rigId,
      rigName: r.rigName,
      siteTimeZone: r.siteTimeZone,
      night: String(r.night),
      status: r.status as NightSessionRow['status'],
      startedAt: iso(r.startedAt) as string,
      endedAt: iso(r.endedAt),
      sessionEndUtc: iso(r.sessionEndUtc),
      createdOffline: Boolean(r.createdOffline),
      reviewed: Boolean(r.reviewed),
      reviewedBy: r.reviewedBy,
      ninaInstanceName: r.ninaInstanceName,
      frames: c?.f ?? 0,
      bonusFrames: c?.b ?? 0,
      integrationS: c?.s ?? 0,
      unassigned: c?.u ?? 0,
    };
  }

  async list(f: NightSessionFilter): Promise<NightSessionRow[]> {
    let q = this.base();
    if (f.rigId) q = q.where('s.rigId', '=', f.rigId);
    if (f.unreviewed) q = q.where('s.reviewed', '=', false);
    if (f.from) q = q.where('s.night', '>=', f.from);
    if (f.to) q = q.where('s.night', '<=', f.to);
    const rows = await q
      .orderBy('s.night', 'desc')
      .orderBy('s.startedAt', 'desc')
      .orderBy('s.id')
      .limit(f.limit)
      .execute();
    const counts = await this.counts(rows.map((r) => r.id));
    return rows.map((r) => SessionReviewRepository.view(r, counts.get(r.id)));
  }

  async byId(id: string): Promise<NightSessionRow | undefined> {
    const r = await this.base().where('s.id', '=', id).executeTakeFirst();
    if (!r) return undefined;
    return SessionReviewRepository.view(r, (await this.counts([id])).get(id));
  }

  /** Detail S-61: Soll/Ist je Zeile, Aufnahmen (höchstens `captureLimit`), Ereignisse, Flats. */
  async detail(id: string, captureLimit: number) {
    const session = await this.byId(id);
    if (!session) throw new ProblemError('resource.not_found');
    const t = this.ctx.tenantId;
    const plans = await this.db
      .selectFrom('nightPlan')
      .select(['revision', 'summary', 'blocks'])
      .where('tenantId', '=', t)
      .where('sessionId', '=', id)
      .orderBy('revision')
      .execute();
    const first = plans[0] ? parseJson<PlanSummary>(plans[0].summary) : null;
    const last = plans.at(-1) ? parseJson<PlanSummary>(plans.at(-1)?.summary) : null;
    // Soll (Entscheidung Sven 07.10.2026): erster Plan der Session ohne Bonus; Transit-Serien als Zeitfenster.
    const firstBlocks = plans[0] ? parseJson<PlanBlockJson[]>(plans[0].blocks) : null;
    const planned = plannedByLine(firstBlocks);
    const plannedLater = new Set<string>();
    for (const p of plans.slice(1))
      for (const lineId of plannedByLine(parseJson<PlanBlockJson[]>(p.blocks)).keys())
        if (!planned.has(lineId)) plannedLater.add(lineId);

    // Ist: gespeicherte, zugeordnete Lights dieser Session je Zeile (FK 8.4) – nicht die ganze Nacht.
    const own = await this.db
      .selectFrom('capture')
      .select([
        'exposureLineId',
        sql<number>`SUM(CASE WHEN NOT is_bonus THEN 1 ELSE 0 END)`.as('acquired'),
        sql<number>`SUM(CASE WHEN NOT is_bonus AND rejected THEN 1 ELSE 0 END)`.as('rejInd'),
        sql<number>`SUM(CASE WHEN is_bonus THEN 1 ELSE 0 END)`.as('bonus'),
        sql<number>`SUM(CASE WHEN is_bonus AND rejected THEN 1 ELSE 0 END)`.as('bonusRej'),
        sql<number>`SUM(CASE WHEN NOT rejected THEN exposure_s ELSE 0 END)`.as('seconds'),
      ])
      .where('tenantId', '=', t)
      .where('sessionId', '=', id)
      .where('frameType', '=', 'light')
      .where('result', '=', 'saved')
      .where('assignment', '=', 'assigned')
      .where('exposureLineId', 'is not', null)
      .groupBy('exposureLineId')
      .execute();
    const ownByLine = new Map(own.map((o) => [String(o.exposureLineId), o]));

    // Zeilen: mit Aufnahmen dieser Session oder in einem Plan der Session – nur Projekte am Rig der Session.
    const lineIds = [...new Set([...ownByLine.keys(), ...planned.keys(), ...plannedLater])];
    const lines =
      lineIds.length === 0
        ? []
        : await this.db
            .selectFrom('exposureLine as l')
            .innerJoin('project as p', (j) =>
              j.onRef('p.id', '=', 'l.projectId').onRef('p.tenantId', '=', 'l.tenantId'),
            )
            .select([
              'l.id',
              'l.projectId',
              'l.filterShortName',
              'l.exposureS',
              'l.orderIndex',
              'l.deletedAt',
              'p.name as projectName',
              'p.createdBy as projectCreatedBy',
            ])
            .where('l.tenantId', '=', t)
            .where('l.id', 'in', lineIds)
            .where('p.rigId', '=', session.rigId)
            .orderBy('p.name')
            .orderBy('l.orderIndex')
            .orderBy('l.id')
            .execute();
    const shown = lines.filter((l) => ownByLine.has(l.id) || l.deletedAt === null);

    // Nachtwerte je Zeile: die Korrektur gilt je Zeile und Nacht (FA-AUS-06).
    const nightRows =
      shown.length === 0
        ? []
        : await this.db
            .selectFrom('captureNight')
            .selectAll()
            .where('tenantId', '=', t)
            .where('night', '=', session.night)
            .where(
              'exposureLineId',
              'in',
              shown.map((l) => l.id),
            )
            .execute();
    const nightByLine = new Map(nightRows.map((n) => [n.exposureLineId, n]));
    // Korrektur-Überhang (Korrektur über den einzeln verworfenen) auf die Sessions der Nacht verteilen.
    const extraLines = shown
      .map((l) => l.id)
      .filter((lid) => {
        const n = nightByLine.get(lid);
        return (
          ownByLine.has(lid) && n !== undefined && num(n.rejectedCount) > num(n.rejectedIndividual)
        );
      });
    const capacities =
      extraLines.length === 0
        ? []
        : await this.db
            .selectFrom('capture as c')
            .innerJoin('session as s', (j) =>
              j.onRef('s.id', '=', 'c.sessionId').onRef('s.tenantId', '=', 'c.tenantId'),
            )
            .select([
              'c.exposureLineId',
              'c.sessionId',
              's.startedAt',
              sql<number>`SUM(CASE WHEN NOT c.rejected THEN 1 ELSE 0 END)`.as('open'),
            ])
            .where('c.tenantId', '=', t)
            .where('c.night', '=', session.night)
            .where('c.exposureLineId', 'in', extraLines)
            .where('c.frameType', '=', 'light')
            .where('c.result', '=', 'saved')
            .where('c.assignment', '=', 'assigned')
            .where('c.isBonus', '=', false)
            .groupBy(['c.exposureLineId', 'c.sessionId', 's.startedAt'])
            .execute();

    const rows = shown.map((l) => {
      const o = ownByLine.get(l.id);
      const n = nightByLine.get(l.id);
      const soll = planned.get(l.id);
      const nightRejected = num(n?.rejectedCount);
      const nightIndividual = num(n?.rejectedIndividual);
      const share = correctionShare(
        nightRejected - nightIndividual,
        capacities
          .filter((c) => c.exposureLineId === l.id)
          .map((c) => ({
            sessionId: c.sessionId,
            startedAt: iso(c.startedAt) as string,
            open: num(c.open),
          })),
        id,
      );
      const acquired = num(o?.acquired);
      const rejected = num(o?.rejInd) + share;
      return {
        projectId: l.projectId,
        projectName: l.projectName,
        projectCreatedBy: l.projectCreatedBy,
        exposureLineId: l.id,
        filterShortName: l.filterShortName,
        exposureS: num(l.exposureS),
        planned: plans.length === 0 ? null : (soll?.frames ?? 0),
        plannedSeries: soll?.series ?? null,
        plannedLater: plannedLater.has(l.id),
        acquired,
        rejected,
        accepted: Math.max(0, acquired - rejected),
        bonus: num(o?.bonus),
        bonusRejected: num(o?.bonusRej),
        // Korrektur ohne Einzelauswahl mit der Zeilenbelichtung abziehen (wie `capture_night`, NT-E3).
        integrationS: Math.max(0, num(o?.seconds) - share * num(l.exposureS)),
        night: {
          acquired: num(n?.acquiredCount),
          rejected: nightRejected,
          rejectedIndividual: nightIndividual,
          rejectedCorrection: num(n?.rejectedCorrection),
        },
      };
    });

    const captureRows = await this.db
      .selectFrom('capture as c')
      .leftJoin('project as p', (j) =>
        j.onRef('p.id', '=', 'c.projectId').onRef('p.tenantId', '=', 'c.tenantId'),
      )
      .select([
        'c.id',
        'c.capturedAt',
        'c.frameType',
        'c.projectId',
        'p.name as projectName',
        'p.createdBy as projectCreatedBy',
        'c.exposureLineId',
        'c.assignment',
        'c.filterShortName',
        'c.filterActual',
        'c.exposureS',
        'c.gain',
        'c.offsetAdu',
        'c.binning',
        'c.result',
        'c.isBonus',
        'c.temperatureDeviation',
        'c.settingsDeviation',
        'c.rejected',
        'c.rejectReason',
        'c.fileName',
        'c.metrics',
      ])
      .where('c.tenantId', '=', t)
      .where('c.sessionId', '=', id)
      .orderBy('c.capturedAt')
      .orderBy('c.id')
      .limit(captureLimit + 1)
      .execute();
    const events = await this.db
      .selectFrom('sessionEvent')
      .select(['id', 'occurredAt', 'kind', 'message', 'durationS'])
      .where('tenantId', '=', t)
      .where('sessionId', '=', id)
      .orderBy('occurredAt')
      .orderBy('id')
      .limit(1000)
      .execute();
    const flats = await this.db
      .selectFrom('flatCombination')
      .selectAll()
      .where('tenantId', '=', t)
      .where('sessionId', '=', id)
      .orderBy('filterShortName')
      .orderBy('rotatorMechDegDg')
      .execute();
    // Kennzahlen und Gründe (AP-31): alle Lights der Session, erster Plan als Soll – mit denselben
    // Begriffen wie Soll/Ist (ohne Bonus, Transit-Serie nur in der Zeit; 07.10.2026).
    const lights = await this.db
      .selectFrom('capture')
      .select([
        'capturedAt',
        'exposureS',
        'result',
        'isBonus',
        'assignment',
        'filterShortName',
        'blockId',
        'exposureLineId',
      ])
      .where('tenantId', '=', t)
      .where('sessionId', '=', id)
      .where('frameType', '=', 'light')
      .execute();
    const planEntries: KpiPlanEntry[] | null = firstBlocks
      ? firstBlocks.flatMap((b) =>
          (b.entries ?? [])
            .filter((e) => (e.cmd === 'expose' || e.cmd === 'expose_series') && e.exposureS)
            .map((e) => ({
              cmd: e.cmd as 'expose' | 'expose_series',
              atUtc: String(e.atUtc),
              untilUtc: e.untilUtc,
              exposureS: Number(e.exposureS),
              bonus: e.bonus === true,
            })),
        )
      : null;
    const { kpis, reasons } = sessionKpis({
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      darkness: first
        ? {
            fromUtc: first.darkness?.astronomicalStartUtc ?? null,
            toUtc: first.darkness?.astronomicalEndUtc ?? null,
          }
        : null,
      planEntries,
      lights: lights.map((l) => ({
        capturedAt: iso(l.capturedAt) as string,
        exposureS: num(l.exposureS),
        result: l.result,
        isBonus: Boolean(l.isBonus),
        assigned: l.assignment === 'assigned',
        filter: l.filterShortName,
        blockId: l.blockId,
        // Zeilen mit Transit-Serie im ersten Plan: Soll ist ein Zeitfenster – Aufnahmen zählen nur in der Zeit.
        series: (planned.get(l.exposureLineId ?? '')?.series ?? null) !== null,
      })),
      events: events.map((e) => ({
        kind: e.kind,
        occurredAt: iso(e.occurredAt) as string,
        durationS: e.durationS === null ? null : num(e.durationS),
      })),
    });
    return {
      session: {
        ...session,
        planRevision: plans.at(-1)?.revision ?? null,
        darknessEndUtc: iso(last?.darknessEndUtc ?? null),
      },
      rows,
      captures: captureRows.slice(0, captureLimit).map((c) => ({
        id: c.id,
        capturedAt: iso(c.capturedAt) as string,
        frameType: c.frameType as 'light' | 'flat' | 'dark_flat',
        projectId: c.projectId,
        projectName: c.projectName,
        projectCreatedBy: c.projectCreatedBy ?? null,
        exposureLineId: c.exposureLineId,
        assignment: c.assignment as 'assigned' | 'unassigned',
        filterShortName: c.filterShortName,
        filterActual: c.filterActual,
        exposureS: num(c.exposureS),
        gain: c.gain,
        offset: c.offsetAdu,
        binning: c.binning,
        result: c.result as 'saved' | 'aborted' | 'failed',
        isBonus: Boolean(c.isBonus),
        temperatureDeviation: Boolean(c.temperatureDeviation),
        settingsDeviation: Boolean(c.settingsDeviation),
        rejected: Boolean(c.rejected),
        rejectReason: c.rejectReason as RejectReason | null,
        fileName: c.fileName,
        ...captureMetrics(c.metrics),
      })),
      capturesTruncated: captureRows.length > captureLimit,
      events: events.map((e) => ({
        id: e.id,
        occurredAt: iso(e.occurredAt) as string,
        kind: e.kind,
        message: e.message,
        durationS: e.durationS === null ? null : num(e.durationS),
      })),
      flats: flats.map((f) => ({
        filterShortName: f.filterShortName,
        rotatorMechDeg: num(f.rotatorMechDegDg) / 10,
        binning: num(f.binning),
        status: String(f.status),
        flatsPlanned: num(f.flatsPlanned),
        flatsTaken: num(f.flatsTaken),
        darkFlatsPlanned: num(f.darkFlatsPlanned),
        darkFlatsTaken: num(f.darkFlatsTaken),
        flatExposureS: f.flatExposureS === null ? null : num(f.flatExposureS),
      })),
      kpis,
      reasons,
    };
  }

  /** *Als geprüft markieren* (FA-AUS-07, Admin). */
  async setReviewed(id: string, reviewed: boolean): Promise<void> {
    const r = await this.db
      .updateTable('session')
      .set({ reviewed, reviewedBy: reviewed ? (this.ctx.memberId ?? null) : null })
      .where('tenantId', '=', this.ctx.tenantId)
      .where('id', '=', id)
      .executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw new ProblemError('resource.not_found');
  }

  /**
   * Ziel einer Korrektur: die Zeile gehört zu einem Projekt am Rig der Session (sonst
   * `422 validation.failed`); liefert Nacht, Projekt und dessen Eigentümer für die Rechteprüfung.
   */
  /** Projekt einer Aufnahme für die Rechteprüfung beim Verwerfen (FA-AUS-20); `404`, wenn fremd. */
  async rejectTarget(
    captureId: string,
  ): Promise<{ projectId: string | null; projectCreatedBy: string | null }> {
    const row = await this.db
      .selectFrom('capture as c')
      .leftJoin('project as p', (j) =>
        j.onRef('p.id', '=', 'c.projectId').onRef('p.tenantId', '=', 'c.tenantId'),
      )
      .select(['c.projectId', 'p.createdBy'])
      .where('c.tenantId', '=', this.ctx.tenantId)
      .where('c.id', '=', captureId)
      .executeTakeFirst();
    if (!row) throw new ProblemError('resource.not_found');
    return { projectId: row.projectId, projectCreatedBy: row.createdBy ?? null };
  }

  async correctionTarget(
    sessionId: string,
    exposureLineId: string,
  ): Promise<{ night: string; projectId: string; projectCreatedBy: string | null }> {
    const session = await this.db
      .selectFrom('session')
      .select(['night', 'rigId'])
      .where('tenantId', '=', this.ctx.tenantId)
      .where('id', '=', sessionId)
      .executeTakeFirst();
    if (!session) throw new ProblemError('resource.not_found');
    const line = await this.db
      .selectFrom('exposureLine as l')
      .innerJoin('project as p', (j) =>
        j.onRef('p.id', '=', 'l.projectId').onRef('p.tenantId', '=', 'l.tenantId'),
      )
      .select(['l.projectId', 'p.createdBy', 'p.rigId'])
      .where('l.tenantId', '=', this.ctx.tenantId)
      .where('l.id', '=', exposureLineId)
      .executeTakeFirst();
    if (!line || line.rigId !== session.rigId)
      throw new ProblemError('validation.failed', [
        { path: 'exposureLineId', message: 'keine Zeile eines Projekts am Rig dieser Session' },
      ]);
    return {
      night: String(session.night),
      projectId: line.projectId,
      projectCreatedBy: line.createdBy,
    };
  }
}
