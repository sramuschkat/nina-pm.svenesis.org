/**
 * NINA-Instanzen und Plugin-Zugriff (TK 5.6, 6.3, 7.3; SV-08, FA-SYN-01…03):
 * - `NinaInstanceRepository` (Web, mandantengebunden): anlegen mit Token-Hash, auflisten, widerrufen.
 * - `ninaTokenLookup`: Suche über den eindeutigen Index `token_hash` bei **jeder** Plugin-Anfrage
 *   (kein Cache) – wie die Anmeldesitzung eine bewusste Ausnahme von der tenant_id-Regel (TK 6.1).
 * - `NinaRigRepository`: Plugin-Sicht auf genau ein Rig (Übernahmestatus, ETag-Bausteine, offene Meldungen,
 *   festgelegte Transits für `targets` und `POST /plan`).
 */
import { ProblemError, type MeasuredOverheads } from '@nina-pm/shared';
import type { Kysely, Selectable } from 'kysely';
import { withTx, retryOcc } from '../tx';
import type { Database, NinaInstanceTable } from '../types';
import { TenantRepo, type TenantContext } from './base';
import { latestMeasuredOverheads } from './measured-overhead';
import { latestSessionPlan } from './night-plan-binding';
import { transitLine } from './transit';

export type NinaInstanceRow = Selectable<NinaInstanceTable>;

/** Instanz mit Rig, Standort und Lease für S-42 und den Übernahmestatus (FA-SIM-09, FA-ADM-02). */
export interface NinaInstanceOverview extends NinaInstanceRow {
  readonly rigName: string;
  readonly rigSettingsVersion: number;
  readonly siteLatDeg: number;
  readonly siteLonDeg: number;
  readonly siteTimeZone: string;
  readonly leaseActiveSessionId: string | null;
  readonly leaseUntil: Date | null;
  readonly leaseOfflineUntil: Date | null;
  readonly leasePresent: boolean;
}

/** Eintrag im Ringpuffer `last_calls` (FA-ADM-06); Aufbau wie `nina.NinaCallEntry`. */
export interface NinaCallRecord {
  readonly atUtc: string;
  readonly method: string;
  readonly route: string;
  readonly status: number;
  readonly code: string | null;
  readonly durationMs: number;
}

export interface NinaCallLog {
  readonly calls: NinaCallRecord[];
  readonly errors: NinaCallRecord[];
}

/** Je Liste höchstens so viele Einträge (neueste zuerst). */
export const NINA_CALL_LOG_SIZE = 20;

export function parseCallLog(raw: unknown): NinaCallLog {
  const v = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<NinaCallLog> | null;
  return {
    calls: Array.isArray(v?.calls) ? v.calls : [],
    errors: Array.isArray(v?.errors) ? v.errors : [],
  };
}

/**
 * Aufruf im Ringpuffer vermerken (FA-ADM-06): erfolgreiche Heartbeats nicht (sie zeigen `last_seen_at`
 * und `last_state`), Antworten ≥ 400 zusätzlich in `errors`. Lesen und Schreiben in einer Transaktion
 * mit `FOR UPDATE` (OCC-Retry über `withTx`).
 */
export async function ninaRecordCall(
  db: Kysely<Database>,
  p: { readonly instanceId: string; readonly tenantId: string },
  entry: NinaCallRecord,
  options: { readonly heartbeat: boolean },
): Promise<void> {
  const isError = entry.status >= 400;
  if (options.heartbeat && !isError) return;
  await withTx(db, async (trx) => {
    const row = await trx
      .selectFrom('ninaInstance')
      .select('lastCalls')
      .where('id', '=', p.instanceId)
      .where('tenantId', '=', p.tenantId)
      .forUpdate()
      .executeTakeFirst();
    if (!row) return;
    const log = parseCallLog(row.lastCalls);
    const next: NinaCallLog = {
      calls: options.heartbeat ? log.calls : [entry, ...log.calls].slice(0, NINA_CALL_LOG_SIZE),
      errors: isError ? [entry, ...log.errors].slice(0, NINA_CALL_LOG_SIZE) : log.errors,
    };
    await trx
      .updateTable('ninaInstance')
      .set({ lastCalls: JSON.stringify(next) })
      .where('id', '=', p.instanceId)
      .where('tenantId', '=', p.tenantId)
      .execute();
  });
}

export interface NinaPrincipal {
  readonly instanceId: string;
  readonly instanceName: string;
  readonly tenantId: string;
  readonly rigId: string;
  readonly status: string;
  readonly tenantStatus: 'active' | 'locked';
  readonly lastSeenAt: Date | null;
  readonly lastState: unknown;
}

/** `last_seen_at` höchstens einmal je 5 min schreiben (TK 5.6). */
export const NINA_SEEN_INTERVAL_MS = 5 * 60_000;

export async function ninaTokenLookup(
  db: Kysely<Database>,
  tokenHash: string,
): Promise<NinaPrincipal | undefined> {
  const row = await db
    .selectFrom('ninaInstance as n')
    .innerJoin('tenant as t', 't.id', 'n.tenantId')
    .select([
      'n.id',
      'n.name',
      'n.tenantId',
      'n.rigId',
      'n.status',
      'n.lastSeenAt',
      'n.lastState',
      't.status as tenantStatus',
    ])
    .where('n.tokenHash', '=', tokenHash)
    .executeTakeFirst();
  if (!row) return undefined;
  return {
    instanceId: row.id,
    instanceName: row.name,
    tenantId: row.tenantId,
    rigId: row.rigId,
    status: row.status,
    tenantStatus: row.tenantStatus,
    lastSeenAt: row.lastSeenAt === null ? null : new Date(row.lastSeenAt),
    lastState: row.lastState,
  };
}

/** Letzte Nutzung vermerken, wenn die vorige länger als 5 min zurückliegt. */
export async function ninaTouch(
  db: Kysely<Database>,
  p: Pick<NinaPrincipal, 'instanceId' | 'tenantId' | 'lastSeenAt'>,
  now: Date,
): Promise<void> {
  if (p.lastSeenAt && now.getTime() - p.lastSeenAt.getTime() < NINA_SEEN_INTERVAL_MS) return;
  await db
    .updateTable('ninaInstance')
    .set({ lastSeenAt: now })
    .where('id', '=', p.instanceId)
    .where('tenantId', '=', p.tenantId)
    .execute();
}

export class NinaInstanceRepository extends TenantRepo {
  private overviewQuery() {
    return this.db
      .selectFrom('ninaInstance as n')
      .innerJoin('rig as r', (j) =>
        j.onRef('r.id', '=', 'n.rigId').onRef('r.tenantId', '=', 'n.tenantId'),
      )
      .innerJoin('site as s', (j) =>
        j.onRef('s.id', '=', 'r.siteId').onRef('s.tenantId', '=', 'r.tenantId'),
      )
      .leftJoin('rigLease as l', (j) =>
        j.onRef('l.rigId', '=', 'r.id').onRef('l.tenantId', '=', 'r.tenantId'),
      )
      .selectAll('n')
      .select([
        'r.name as rigName',
        'r.settingsVersion as rigSettingsVersion',
        's.latitudeDeg as siteLatDeg',
        's.longitudeDeg as siteLonDeg',
        's.timeZone as siteTimeZone',
        'l.activeSessionId as leaseActiveSessionId',
        'l.leaseUntil as leaseUntil',
        'l.offlineUntil as leaseOfflineUntil',
        'l.rigId as leaseRigId',
      ])
      .where('n.tenantId', '=', this.ctx.tenantId);
  }

  private static overview(
    row: NinaInstanceRow & {
      rigName: string;
      rigSettingsVersion: number;
      siteLatDeg: number;
      siteLonDeg: number;
      siteTimeZone: string;
      leaseActiveSessionId: string | null;
      leaseUntil: Date | string | null;
      leaseOfflineUntil: Date | string | null;
      leaseRigId: string | null;
    },
  ): NinaInstanceOverview {
    const { leaseRigId, ...rest } = row;
    const date = (v: Date | string | null) => (v === null ? null : new Date(v));
    return {
      ...rest,
      rigSettingsVersion: Number(row.rigSettingsVersion),
      leaseUntil: date(row.leaseUntil),
      leaseOfflineUntil: date(row.leaseOfflineUntil),
      leasePresent: leaseRigId !== null,
    };
  }

  async list(rigId?: string): Promise<NinaInstanceOverview[]> {
    let q = this.overviewQuery();
    if (rigId) q = q.where('n.rigId', '=', rigId);
    const rows = await q.orderBy('n.createdAt').orderBy('n.id').execute();
    return rows.map((r) => NinaInstanceRepository.overview(r));
  }

  async byId(id: string): Promise<NinaInstanceOverview | undefined> {
    const row = await this.overviewQuery().where('n.id', '=', id).executeTakeFirst();
    return row ? NinaInstanceRepository.overview(row) : undefined;
  }

  /** Anlegen mit Client-UUID; das Rig muss im Mandanten existieren (sonst 404). */
  async create(
    input: { id: string; rigId: string; name: string; tokenHash: string; tokenPrefix: string },
    now: Date,
  ): Promise<NinaInstanceOverview> {
    const rig = await this.db
      .selectFrom('rig')
      .select('id')
      .where('tenantId', '=', this.ctx.tenantId)
      .where('id', '=', input.rigId)
      .executeTakeFirst();
    if (!rig) throw new ProblemError('resource.not_found');
    const existing = await this.db
      .selectFrom('ninaInstance')
      .select('tenantId')
      .where('id', '=', input.id)
      .executeTakeFirst();
    if (existing)
      throw new ProblemError('validation.failed', [{ path: 'id', message: 'vergeben' }]);
    await this.db
      .insertInto('ninaInstance')
      .values({
        id: input.id,
        tenantId: this.ctx.tenantId,
        rigId: input.rigId,
        name: input.name,
        tokenHash: input.tokenHash,
        tokenPrefix: input.tokenPrefix,
        createdBy: this.ctx.memberId ?? null,
        createdAt: now,
      })
      .execute();
    return (await this.byId(input.id)) as NinaInstanceOverview;
  }

  /** Widerruf wirkt sofort: die nächste Plugin-Anfrage findet `status = revoked` (401). */
  async revoke(id: string): Promise<NinaInstanceOverview> {
    const done = await retryOcc(() =>
      this.db
        .updateTable('ninaInstance')
        .set({ status: 'revoked' })
        .where('tenantId', '=', this.ctx.tenantId)
        .where('id', '=', id)
        .executeTakeFirst(),
    );
    if (Number(done.numUpdatedRows) === 0) throw new ProblemError('resource.not_found');
    return (await this.byId(id)) as NinaInstanceOverview;
  }

  /**
   * Endgültig löschen nur ohne Verlauf (FA-ADM-02, Entscheidung 25.09.2026): keine Session und kein
   * Kommando verweist auf die Instanz – sonst `409 resource.in_use` mit den Verwendern, dann bleibt
   * *Widerrufen*. Eine gleichzeitig angelegte Session scheitert am Fremdschlüssel (23503) → ebenfalls 409.
   */
  async remove(id: string): Promise<void> {
    const tenantId = this.ctx.tenantId;
    try {
      await withTx(this.db, async (trx) => {
        const row = await trx
          .selectFrom('ninaInstance')
          .select('id')
          .where('tenantId', '=', tenantId)
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!row) throw new ProblemError('resource.not_found');
        const count = async (table: 'session' | 'command') =>
          Number(
            (
              await trx
                .selectFrom(table)
                .select((eb) => eb.fn.countAll<number>().as('n'))
                .where('tenantId', '=', tenantId)
                .where('ninaInstanceId', '=', id)
                .executeTakeFirstOrThrow()
            ).n,
          );
        const users = [
          { path: 'session', n: await count('session') },
          { path: 'command', n: await count('command') },
        ].filter((u) => u.n > 0);
        if (users.length > 0)
          throw new ProblemError(
            'resource.in_use',
            users.map((u) => ({ path: u.path, message: String(u.n) })),
          );
        await trx
          .deleteFrom('ninaInstance')
          .where('tenantId', '=', tenantId)
          .where('id', '=', id)
          .execute();
      });
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === '23503')
        throw new ProblemError('resource.in_use', [{ path: 'session', message: 'neu' }]);
      throw error;
    }
  }
}

/** Plugin-Sicht auf das Rig des Tokens (Mandant und Rig aus dem Token, TK 5.6). */
/** Vorhandene Flats eines Projekts je Kombination (AP-50b). */
export interface FlatRecord {
  readonly filterShortName: string;
  readonly rotatorMechDg: number;
  readonly gain: number;
  readonly offset: number;
  readonly binning: number;
  readonly readoutModeIndex: number;
  readonly lastUtc: string;
  readonly count: number;
}

/**
 * Festgelegter Transit für die Auslieferung an NINA (AP-44; transit.md §3, §9): Beobachtung, Planet, Erlaubnisse des
 * Projekts, Ephemeride der Festlegung und Transit-Zeile (`transitLine`, wie beim Festlegen).
 */
export interface DeliveredTransit {
  readonly observationId: string;
  readonly projectId: string;
  readonly night: string;
  readonly epoch: number;
  readonly ingressUtc: Date;
  readonly midUtc: Date;
  readonly egressUtc: Date;
  readonly windowStartUtc: Date;
  readonly windowEndUtc: Date;
  /** `locked_at`, ersatzweise `created_at` (Reihenfolge bei Überlappung, allocation.md §7.1). */
  readonly lockedAt: Date;
  readonly plannedCount: number;
  readonly acquiredCount: number;
  readonly rejectedCount: number;
  readonly planet: string;
  readonly allowAutofocus: boolean;
  readonly allowRecenter: boolean;
  readonly ephemeris: {
    readonly id: string;
    readonly t0BjdTdb: number;
    readonly t0SigmaD: number | null;
    readonly periodD: number;
    readonly periodSigmaD: number | null;
    readonly durationH: number | null;
  };
  /** Aktive Transit-Zeile des Projekts; `null` = keine (dann nicht auslieferbar). */
  readonly lineId: string | null;
}

const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export class NinaRigRepository extends TenantRepo {
  constructor(
    db: Kysely<Database>,
    ctx: TenantContext,
    private readonly rigId: string,
  ) {
    super(db, ctx);
  }

  /** Jüngste gespeicherte Messung der Overheads des Rigs (AP-65), sonst `null`. */
  async measuredOverhead(): Promise<MeasuredOverheads | null> {
    return (
      (await latestMeasuredOverheads(this.db, this.ctx.tenantId, [this.rigId])).get(this.rigId) ??
      null
    );
  }

  /** Übernahmestatus (FA-SIM-09): abgerufene Einstellungsversion und Zeitpunkt. */
  async recordSettingsFetched(instanceId: string, settingsVersion: number, now: Date) {
    await retryOcc(() =>
      this.db
        .updateTable('ninaInstance')
        .set({ settingsVersionFetched: settingsVersion, settingsFetchedAt: now })
        .where('tenantId', '=', this.ctx.tenantId)
        .where('id', '=', instanceId)
        .execute(),
    );
  }

  /**
   * Bausteine des `targets`-ETags **ohne** Zähler aus Aufnahmemeldungen (NT-19): verworfene Anzahlen
   * je Zeile (Korrekturen/Verwerfen) der ausgelieferten Projekte.
   */
  async rejectedCounts(projectIds: readonly string[]): Promise<Record<string, number>> {
    if (projectIds.length === 0) return {};
    const rows = await this.db
      .selectFrom('exposureLine')
      .select(['id', 'rejectedCount', 'bonusRejectedCount'])
      .where('tenantId', '=', this.ctx.tenantId)
      .where('projectId', 'in', [...projectIds])
      .execute();
    return Object.fromEntries(
      rows.map((r) => [r.id, Number(r.rejectedCount) + Number(r.bonusRejectedCount)]),
    );
  }

  /**
   * Vorhandene Flats je Projekt auf diesem Rig (AP-50b): Kombinationen aus `flat_combination` der Sessions des Rigs
   * mit mindestens einer Flat-Aufnahme, nicht übersprungen. Je Projekt und Schlüssel (Filter, mechanischer Winkel in
   * Zehntelgrad, Gain, Offset, Binning, Auslesemodus-Index) das späteste Sessionende und die Summe der Flats.
   */
  async flatRecords(projectIds: readonly string[]): Promise<Map<string, FlatRecord[]>> {
    const result = new Map<string, FlatRecord[]>();
    if (projectIds.length === 0) return result;
    const wanted = new Set(projectIds);
    const rows = await this.db
      .selectFrom('flatCombination as f')
      .innerJoin('session as s', 's.id', 'f.sessionId')
      .select([
        'f.filterShortName',
        'f.rotatorMechDegDg',
        'f.gain',
        'f.offsetAdu',
        'f.binning',
        'f.readoutModeIndex',
        'f.projectIds',
        'f.flatsTaken',
        's.startedAt',
        's.endedAt',
      ])
      .where('f.tenantId', '=', this.ctx.tenantId)
      .where('s.tenantId', '=', this.ctx.tenantId)
      .where('s.rigId', '=', this.rigId)
      .where('f.status', '<>', 'skipped')
      .where('f.flatsTaken', '>', 0)
      .execute();
    const byKey = new Map<string, FlatRecord & { projectId: string }>();
    for (const r of rows) {
      const at = (r.endedAt ?? r.startedAt).toISOString().replace(/\.\d{3}Z$/, 'Z');
      for (const projectId of (r.projectIds as string[] | null) ?? []) {
        if (!wanted.has(projectId)) continue;
        const rec = {
          filterShortName: r.filterShortName,
          rotatorMechDg: Number(r.rotatorMechDegDg),
          gain: Number(r.gain),
          offset: Number(r.offsetAdu),
          binning: Number(r.binning),
          readoutModeIndex: Number(r.readoutModeIndex),
        };
        const key = JSON.stringify([projectId, rec]);
        const prev = byKey.get(key);
        byKey.set(key, {
          ...rec,
          projectId,
          lastUtc: prev && prev.lastUtc > at ? prev.lastUtc : at,
          count: (prev?.count ?? 0) + Number(r.flatsTaken),
        });
      }
    }
    for (const { projectId, ...rec } of [...byKey.values()].sort((a, b) =>
      a.lastUtc < b.lastUtc ? -1 : 1,
    ))
      result.set(projectId, [...(result.get(projectId) ?? []), rec]);
    return result;
  }

  /**
   * Mechanischer Rotatorwinkel der jüngsten gespeicherten Light-Aufnahme je Belichtungszeile eines Projekts auf diesem
   * Rig (Zehntelgrad) – für die Flat-Markierung je Zeile (AP-50b).
   */
  async lightMechAngles(projectId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .selectFrom('capture as c')
      .innerJoin('session as s', 's.id', 'c.sessionId')
      .select(['c.exposureLineId', 'c.rotatorMechDeg', 'c.capturedAt'])
      .where('c.tenantId', '=', this.ctx.tenantId)
      .where('s.tenantId', '=', this.ctx.tenantId)
      .where('s.rigId', '=', this.rigId)
      .where('c.projectId', '=', projectId)
      .where('c.frameType', '=', 'light')
      .where('c.result', '=', 'saved')
      .where('c.exposureLineId', 'is not', null)
      .orderBy('c.capturedAt', 'desc')
      .execute();
    const result = new Map<string, number>();
    for (const r of rows)
      if (r.exposureLineId && !result.has(r.exposureLineId))
        result.set(r.exposureLineId, Math.round(Number(r.rotatorMechDeg) * 10) % 3600);
    return result;
  }

  /**
   * Festgelegte Transits dieses Rigs für die Nächte `nights` (transit.md §3, §9): `status = 'locked'`, Fensterende
   * nach `now`, Projekt nicht gelöscht und am Rig. Nur **primäre** Beobachtungen (`primary_observation_id IS NULL`):
   * verknüpfte Beobachtungen desselben Ereignisses belichtet NINA nicht noch einmal, ihre Aufnahmen hängen an der
   * primären (FA-EXO-33a). Sortiert nach Fensterbeginn.
   */
  async lockedTransits(nights: readonly string[], now: Date): Promise<DeliveredTransit[]> {
    if (nights.length === 0) return [];
    const tenantId = this.ctx.tenantId;
    const rows = await this.db
      .selectFrom('transitObservation as o')
      .innerJoin('project as p', 'p.id', 'o.projectId')
      .innerJoin('exoProject as x', 'x.projectId', 'o.projectId')
      .innerJoin('ephemeris as e', 'e.id', 'o.ephemerisId')
      .select([
        'o.id',
        'o.projectId',
        'o.night',
        'o.epoch',
        'o.ingressUtc',
        'o.midUtc',
        'o.egressUtc',
        'o.windowStartUtc',
        'o.windowEndUtc',
        'o.lockedAt',
        'o.createdAt',
        'o.plannedCount',
        'o.acquiredCount',
        'o.rejectedCount',
        'x.planet',
        'x.allowAutofocus',
        'x.allowRecenter',
        'e.id as ephemerisId',
        'e.t0BjdTdb',
        'e.t0SigmaD',
        'e.periodD',
        'e.periodSigmaD',
        'e.durationH',
      ])
      .where('o.tenantId', '=', tenantId)
      .where('p.tenantId', '=', tenantId)
      .where('x.tenantId', '=', tenantId)
      .where('e.tenantId', '=', tenantId)
      .where('p.rigId', '=', this.rigId)
      .where('p.deletedAt', 'is', null)
      .where('o.status', '=', 'locked')
      .where('o.primaryObservationId', 'is', null)
      .where('o.night', 'in', [...nights])
      .where('o.windowEndUtc', '>', now)
      .orderBy('o.windowStartUtc')
      .orderBy('o.id')
      .execute();
    const lines = new Map<string, string | null>();
    for (const r of rows)
      if (!lines.has(r.projectId))
        lines.set(r.projectId, (await transitLine(this.db, tenantId, r.projectId))?.id ?? null);
    return rows.map((r) => ({
      observationId: r.id,
      projectId: r.projectId,
      night: String(r.night),
      epoch: Number(r.epoch),
      ingressUtc: new Date(r.ingressUtc),
      midUtc: new Date(r.midUtc),
      egressUtc: new Date(r.egressUtc),
      windowStartUtc: new Date(r.windowStartUtc),
      windowEndUtc: new Date(r.windowEndUtc),
      lockedAt: new Date(r.lockedAt ?? r.createdAt),
      plannedCount: Number(r.plannedCount),
      acquiredCount: Number(r.acquiredCount),
      rejectedCount: Number(r.rejectedCount),
      planet: r.planet,
      allowAutofocus: r.allowAutofocus,
      allowRecenter: r.allowRecenter,
      ephemeris: {
        id: r.ephemerisId,
        t0BjdTdb: Number(r.t0BjdTdb),
        t0SigmaD: numOrNull(r.t0SigmaD),
        periodD: Number(r.periodD),
        periodSigmaD: numOrNull(r.periodSigmaD),
        durationH: numOrNull(r.durationH),
      },
      lineId: lines.get(r.projectId) ?? null,
    }));
  }

  /** Offene Meldungen (NT-20): IDs, die schon in `capture` stehen, zählen nicht noch einmal. */
  async knownCaptureIds(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db
      .selectFrom('capture')
      .select('id')
      .where('tenantId', '=', this.ctx.tenantId)
      .where('id', 'in', [...ids])
      .execute();
    return new Set(rows.map((r) => r.id));
  }

  /**
   * Serverplan speichern (`night_plan(origin = 'server_plan')`, TK 7.3): Revision = höchste Revision der
   * Session + 1 (ohne Session 1). Gleiche Eingabe ergibt dieselbe `nightPlanId` (UUID aus dem Hash) –
   * dann bleibt die gespeicherte Revision. Eine Session eines anderen Rigs → 404 (SEC-53); die Session
   * erhält `session_end_utc` der letzten Revision (NT-09).
   * Analyse 07.10.2026:
   * - Eine noch unbekannte Session (offline angelegt, Anlage noch im Postausgang) wird trotzdem eingetragen
   *   (`session_id` hat keinen Fremdschlüssel); die Revisionen zählen dann schon je Session.
   * - Gehört die `nightPlanId` einer **anderen** Session (bzw. noch keiner), erhält diese Session eine Kopie als neue
   *   Revision (`summary.sourceNightPlanId`), statt ohne Plan zu bleiben.
   * - Ist die letzte Revision der Session inhaltsgleich (`contentKey`, nur wenn `reusable`), entsteht keine neue: der
   *   Aufrufer antwortet mit der gespeicherten (`reused`), Sessionende und Berichtsfrist bleiben.
   */
  savePlan(input: {
    nightPlanId: string;
    night: string;
    sessionId: string | null;
    reason: string;
    engineVersion: string;
    inputHash: string;
    /** Inhaltsschlüssel ohne die aus `startAtUtc` folgenden Werte (`planContentKey`); `null` = nie wiederverwenden. */
    contentKey: string | null;
    /** Inhaltsgleiche Revision darf wiederverwendet werden (kein Block vor jetzt, `reusablePlan`). */
    reusable: boolean;
    plan: {
      readonly blocks: readonly unknown[];
      readonly sessionEndUtc: string;
      readonly [key: string]: unknown;
    };
    now: Date;
  }): Promise<SavedPlan> {
    const tenantId = this.ctx.tenantId;
    return withTx(this.db, async (trx) => {
      let sessionId: string | null = null;
      if (input.sessionId) {
        const session = await trx
          .selectFrom('session')
          .select(['id', 'tenantId', 'rigId'])
          .where('id', '=', input.sessionId)
          .executeTakeFirst();
        if (session && (session.tenantId !== tenantId || session.rigId !== this.rigId))
          throw new ProblemError('resource.not_found');
        sessionId = input.sessionId;
      }
      const existing = await trx
        .selectFrom('nightPlan')
        .select(['revision', 'tenantId', 'rigId', 'sessionId'])
        .where('id', '=', input.nightPlanId)
        .executeTakeFirst();
      if (existing) {
        if (existing.tenantId !== tenantId || existing.rigId !== this.rigId)
          throw new ProblemError('resource.not_found');
        if (!sessionId || existing.sessionId === sessionId)
          return { revision: existing.revision, nightPlanId: input.nightPlanId, reused: null };
      }
      if (sessionId) {
        const latest = await latestSessionPlan(trx, tenantId, sessionId);
        // Dieselbe Eingabe schon als letzte Revision dieser Session (auch als Kopie): idempotent.
        if (latest && latest.inputHash === input.inputHash)
          return { revision: latest.revision, nightPlanId: latest.deliveredId, reused: null };
        if (
          latest &&
          input.reusable &&
          input.contentKey !== null &&
          latest.contentKey === input.contentKey
        ) {
          const row = await trx
            .selectFrom('nightPlan')
            .select(['summary', 'blocks'])
            .where('tenantId', '=', tenantId)
            .where('id', '=', latest.id)
            .executeTakeFirstOrThrow();
          const json = (v: unknown): unknown => (typeof v === 'string' ? JSON.parse(v) : v);
          return {
            revision: latest.revision,
            nightPlanId: latest.deliveredId,
            reused: {
              summary: json(row.summary) as Record<string, unknown>,
              blocks: json(row.blocks) as unknown[],
            },
          };
        }
      }
      let revision = 1;
      if (sessionId) {
        const max = await trx
          .selectFrom('nightPlan')
          .select((eb) => eb.fn.max('revision').as('rev'))
          .where('tenantId', '=', tenantId)
          .where('sessionId', '=', sessionId)
          .executeTakeFirst();
        revision = Number(max?.rev ?? 0) + 1;
      }
      const { blocks, ...summary } = input.plan as { blocks: readonly unknown[] } & Record<
        string,
        unknown
      >;
      await trx
        .insertInto('nightPlan')
        .values({
          // Kopie für diese Session: eigene Zeilen-ID, ausgeliefert bleibt die `nightPlanId` der Quelle.
          id: existing ? crypto.randomUUID() : input.nightPlanId,
          tenantId,
          rigId: this.rigId,
          night: input.night,
          origin: 'server_plan',
          sessionId,
          revision,
          reason: input.reason,
          engineVersion: input.engineVersion,
          inputHash: input.inputHash,
          summary: JSON.stringify({
            ...summary,
            ...(input.contentKey !== null ? { contentKey: input.contentKey } : {}),
            ...(existing ? { sourceNightPlanId: input.nightPlanId } : {}),
          }),
          blocks: JSON.stringify(blocks),
          createdAt: input.now,
        })
        .execute();
      if (sessionId) {
        const end = new Date(input.plan.sessionEndUtc);
        await trx
          .updateTable('session')
          .set({
            sessionEndUtc: end,
            reportDueAt: new Date(end.getTime() + 2 * 3_600_000),
          })
          .where('tenantId', '=', tenantId)
          .where('id', '=', sessionId)
          .execute();
      }
      return { revision, nightPlanId: input.nightPlanId, reused: null };
    });
  }

  /**
   * Ist einer Nacht (AP-53c, FA-SIM-10): Sessions des Rigs in der Nacht, ihre Ereignisse und Light-Aufnahmen, nach Zeit
   * geordnet. Mandantengebunden; höchstens 20 000 Ereignisse bzw. Aufnahmen (eine Transitnacht hat rund 600).
   */
  async nightActual(night: string): Promise<{
    sessions: { id: string; status: string; nightPlanId: string | null; startedAt: Date }[];
    events: {
      occurredAt: Date;
      kind: string;
      blockId: string | null;
      projectId: string | null;
      nightPlanId: string | null;
      durationS: number | null;
      data: unknown;
    }[];
    lights: {
      capturedAt: Date;
      exposureS: number;
      result: string;
      filter: string;
      blockId: string | null;
      projectId: string | null;
      panelId: string | null;
      nightPlanId: string | null;
      /** Transit-Aufnahme (FA-EXO-20): ihr Block ist ein Transitblock, auch ohne gespeicherte Revision (Analyse 07.10.2026). */
      transitObservationId: string | null;
    }[];
  }> {
    const tenantId = this.ctx.tenantId;
    const sessions = await this.db
      .selectFrom('session')
      .select(['id', 'status', 'nightPlanId', 'startedAt'])
      .where('tenantId', '=', tenantId)
      .where('rigId', '=', this.rigId)
      .where('night', '=', night)
      .orderBy('startedAt')
      .execute();
    if (sessions.length === 0) return { sessions: [], events: [], lights: [] };
    const ids = sessions.map((x) => x.id);
    const events = await this.db
      .selectFrom('sessionEvent')
      .select(['occurredAt', 'kind', 'blockId', 'projectId', 'nightPlanId', 'durationS', 'data'])
      .where('tenantId', '=', tenantId)
      .where('sessionId', 'in', ids)
      .orderBy('occurredAt')
      .limit(20_000)
      .execute();
    const lights = await this.db
      .selectFrom('capture')
      .select([
        'capturedAt',
        'exposureS',
        'result',
        'filterShortName',
        'blockId',
        'projectId',
        'panelId',
        'nightPlanId',
        'transitObservationId',
      ])
      .where('tenantId', '=', tenantId)
      .where('sessionId', 'in', ids)
      .where('frameType', '=', 'light')
      .orderBy('capturedAt')
      .limit(20_000)
      .execute();
    return {
      sessions: sessions.map((x) => ({ ...x, startedAt: new Date(x.startedAt) })),
      events: events.map((e) => ({
        ...e,
        occurredAt: new Date(e.occurredAt),
        durationS: e.durationS === null ? null : Number(e.durationS),
      })),
      lights: lights.map((l) => ({
        capturedAt: new Date(l.capturedAt),
        exposureS: Number(l.exposureS),
        result: l.result,
        filter: l.filterShortName ?? '',
        blockId: l.blockId,
        projectId: l.projectId,
        panelId: l.panelId,
        nightPlanId: l.nightPlanId,
        transitObservationId: l.transitObservationId,
      })),
    };
  }

  /**
   * Gespeicherte Serverpläne der Nacht (`origin = server_plan`, AP-53c): die letzte Revision (das, was das Plugin
   * ausführt) und die erste (Ursprungsplan = Plan der ersten Session bzw. der früheste). Inhalt (`summary`, `blocks`)
   * nur dieser beiden Zeilen laden – eine Nacht hat viele Revisionen (Analyse 07.10.2026).
   */
  async serverPlans(night: string): Promise<{
    latest: StoredServerPlan | null;
    first: StoredServerPlan | null;
  }> {
    const tenantId = this.ctx.tenantId;
    const ids = await this.db
      .selectFrom('nightPlan')
      .select(['id'])
      .where('tenantId', '=', tenantId)
      .where('rigId', '=', this.rigId)
      .where('night', '=', night)
      .where('origin', '=', 'server_plan')
      .orderBy('createdAt')
      .orderBy('id')
      .execute();
    const pick = [...new Set([ids[0]?.id, ids.at(-1)?.id].filter((x): x is string => !!x))];
    const rows =
      pick.length === 0
        ? []
        : await this.db
            .selectFrom('nightPlan')
            .select(['id', 'revision', 'reason', 'createdAt', 'summary', 'blocks', 'sessionId'])
            .where('tenantId', '=', tenantId)
            .where('rigId', '=', this.rigId)
            .where('id', 'in', pick)
            .execute();
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    const map = (r: (typeof rows)[number] | undefined): StoredServerPlan | null =>
      r
        ? {
            id: r.id,
            revision: r.revision,
            reason: r.reason,
            createdAt: new Date(r.createdAt),
            summary: (typeof r.summary === 'string' ? JSON.parse(r.summary) : r.summary) as Record<
              string,
              unknown
            >,
            blocks: (typeof r.blocks === 'string' ? JSON.parse(r.blocks) : r.blocks) as unknown[],
          }
        : null;
    return {
      latest: map(byId.get(ids.at(-1)?.id ?? '')),
      first: map(byId.get(ids[0]?.id ?? '')),
    };
  }

  get rig(): string {
    return this.rigId;
  }
}

/** Ergebnis von `savePlan`: Revision, ausgelieferte `nightPlanId` und – bei Wiederverwendung – die gespeicherte Revision. */
export interface SavedPlan {
  revision: number;
  nightPlanId: string;
  /** Inhaltsgleiche letzte Revision (keine neue gespeichert): so antworten, wie sie gespeichert ist. */
  reused: { summary: Record<string, unknown>; blocks: unknown[] } | null;
}

/** Gespeicherter Serverplan einer Nacht (AP-53c). */
export interface StoredServerPlan {
  id: string;
  revision: number;
  reason: string;
  createdAt: Date;
  summary: Record<string, unknown>;
  blocks: unknown[];
}
