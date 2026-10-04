/**
 * Sessions, Lease und Heartbeat der NINA-API (AP-14b; TK 5.6, 6.6, 7.3, 7.6; FA-SYN-06/07,
 * FA-RIG-06, FA-NIN-04, NT-09, NT-11, NT-14, NT-15, M5, M6):
 * - Jede Methode ist an Mandant **und** Rig des Tokens gebunden; eine Session eines anderen Rigs gilt
 *   als nicht vorhanden (SEC-53 → 404).
 * - Die Lease steht in `rig_lease` (nie auf `rig`); Wächter ist die `rig_lease`-Zeile (`FOR UPDATE`).
 * - Statusübergänge: running → completed | aborted | stale; einziger Rückweg stale → running.
 */
import { dedupeKeys, ProblemError } from '@nina-pm/shared';
import type { Kysely, Selectable, Transaction } from 'kysely';
import { withTx } from '../tx';
import type { Database, RigLeaseTable, SessionTable } from '../types';
import { TenantRepo, type TenantContext } from './base';

export type SessionRow = Selectable<SessionTable>;
type LeaseRow = Selectable<RigLeaseTable>;
type Tx = Transaction<Database> | Kysely<Database>;

/** Lease-Dauer (TK 5.6, FK 8.1). */
export const LEASE_MS = 3 * 60_000;
/** Offline-Modus höchstens 14 Tage (FA-NIN-04). */
export const OFFLINE_MAX_MS = 14 * 86_400_000;
/** Späte Meldungen sind bis 7 Tage nach Sessionende zulässig (TK 6.6). */
export const LATE_REPORT_MS = 7 * 86_400_000;

export interface LeaseView {
  readonly untilUtc: Date | null;
  readonly leaseLost: boolean;
}

export interface SessionCreateInput {
  readonly id: string;
  readonly night: string;
  readonly nightPlanId: string | null;
  readonly startedAt: Date;
  readonly offline: boolean;
  readonly offlinePlan: OfflinePlanInput | null;
}

export interface OfflinePlanInput {
  readonly nightPlanId: string;
  readonly inputHash: string;
  readonly engineVersion: string;
  readonly blocks: readonly unknown[];
}

const OPEN = new Set(['running', 'stale']);

function leaseHeld(l: LeaseRow | undefined, now: Date): boolean {
  if (!l || l.activeSessionId === null) return false;
  const frozen = l.offlineUntil !== null && new Date(l.offlineUntil) > now;
  return frozen || (l.leaseUntil !== null && new Date(l.leaseUntil) > now);
}

const isoSec = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

function jsonObject(value: unknown): Record<string, unknown> {
  const v: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/**
 * Admin-Freigabe je Session (M5; Spec-Ergänzung 28.09.2026, `execution.md` §6): die Freigabe steht
 * dauerhaft an der Session (`session.kpis.leaseReleasedAt`, Spalte bis zum Sessionende sonst ungenutzt)
 * – `rig_lease.released_session_id` merkt nur die zuletzt freigegebene Session und wird beim nächsten
 * Lease-Erwerb zurückgesetzt. Eine so ausgeschlossene Session erhält die Lease auf keinem Weg zurück.
 */
function leaseReleasedAt(s: Pick<SessionRow, 'kpis'>): string | null {
  const at = jsonObject(s.kpis).leaseReleasedAt;
  return typeof at === 'string' ? at : null;
}

function excludedByRelease(s: SessionRow, lease: LeaseRow): boolean {
  return lease.releasedSessionId === s.id || leaseReleasedAt(s) !== null;
}

export class NinaSessionRepository extends TenantRepo {
  constructor(
    db: Kysely<Database>,
    ctx: TenantContext,
    private readonly rigId: string,
    private readonly instanceId: string,
  ) {
    super(db, ctx);
  }

  private get tenantId() {
    return this.ctx.tenantId;
  }

  /** Session dieses Rigs; fremde bzw. unbekannte Sessions → `undefined` (SEC-53). */
  async session(id: string, trx?: Tx): Promise<SessionRow | undefined> {
    return (trx ?? this.db)
      .selectFrom('session')
      .selectAll()
      .where('id', '=', id)
      .where('tenantId', '=', this.tenantId)
      .where('rigId', '=', this.rigId)
      .executeTakeFirst();
  }

  /** Existiert eine Session mit dieser ID überhaupt (auch bei einem anderen Rig)? */
  private async exists(trx: Tx, id: string): Promise<boolean> {
    const row = await trx
      .selectFrom('session')
      .select('id')
      .where('id', '=', id)
      .executeTakeFirst();
    return row !== undefined;
  }

  /** `rig_lease`-Zeile anlegen (Altbestand, DAT5-19) und als Wächter sperren. */
  private async lockLease(trx: Tx): Promise<LeaseRow> {
    await trx
      .insertInto('rigLease')
      .values({ rigId: this.rigId, tenantId: this.tenantId, updatedAt: new Date() })
      .onConflict((oc) => oc.column('rigId').doNothing())
      .execute();
    return trx
      .selectFrom('rigLease')
      .selectAll()
      .where('rigId', '=', this.rigId)
      .where('tenantId', '=', this.tenantId)
      .forUpdate()
      .executeTakeFirstOrThrow();
  }

  /**
   * Lease an `sessionId` vergeben. `offlineUntil` gehört immer dem Halter: ein neuer Erwerb friert nur
   * ein, wenn der Halter selbst den Offline-Modus meldet (sonst erbte er das Einfrieren eines Vorgängers).
   */
  private async setLease(
    trx: Tx,
    sessionId: string,
    until: Date,
    now: Date,
    offlineUntil: Date | null = null,
  ) {
    await trx
      .updateTable('rigLease')
      .set({
        activeSessionId: sessionId,
        leaseUntil: until,
        offlineUntil,
        releasedSessionId: null,
        updatedAt: now,
      })
      .where('rigId', '=', this.rigId)
      .where('tenantId', '=', this.tenantId)
      .execute();
  }

  /**
   * `session_close` neu scharf schalten (TK 13, NIN5-7): verlässt eine Session den Status `stale`
   * (Rückkehr nach `running` oder echtes Ende), gilt ein beim Verwaisen angelegter `session_close` als
   * überholt. Sein `dedupe_key` erhält einen Zusatz, damit `sessionsDueForClose` die Session beim
   * nächsten Ende bzw. Verwaisen wieder schließt (Flats, Klarnacht-Statistik, Aufwand). `dedupe_active`
   * bleibt, ein noch offener Job läuft zu Ende (der Handler überspringt eine laufende Session).
   */
  private async rearmClose(trx: Tx, sessionId: string, now: Date): Promise<void> {
    const key = dedupeKeys.sessionClose(sessionId);
    await trx
      .updateTable('job')
      .set({ dedupeKey: `${key}:rearmed:${isoSec(now)}` })
      .where('tenantId', '=', this.tenantId)
      .where('kind', '=', 'session_close')
      .where('dedupeKey', '=', key)
      .execute();
  }

  /** Offline erzeugten bzw. nachgemeldeten Plan speichern (`night_plan(origin='plugin_offline')`). */
  private async saveOfflinePlan(
    trx: Tx,
    sessionId: string,
    night: string,
    plan: OfflinePlanInput,
    now: Date,
  ): Promise<void> {
    const existing = await trx
      .selectFrom('nightPlan')
      .select(['tenantId', 'rigId'])
      .where('id', '=', plan.nightPlanId)
      .executeTakeFirst();
    if (existing) {
      if (existing.tenantId !== this.tenantId || existing.rigId !== this.rigId)
        throw new ProblemError('resource.not_found');
      return;
    }
    const max = await trx
      .selectFrom('nightPlan')
      .select((eb) => eb.fn.max('revision').as('rev'))
      .where('tenantId', '=', this.tenantId)
      .where('sessionId', '=', sessionId)
      .executeTakeFirst();
    await trx
      .insertInto('nightPlan')
      .values({
        id: plan.nightPlanId,
        tenantId: this.tenantId,
        rigId: this.rigId,
        night,
        origin: 'plugin_offline',
        sessionId,
        revision: Number(max?.rev ?? 0) + 1,
        reason: 'resume',
        engineVersion: plan.engineVersion,
        inputHash: plan.inputHash,
        summary: JSON.stringify({ inputHash: plan.inputHash, engineVersion: plan.engineVersion }),
        blocks: JSON.stringify(plan.blocks),
        createdAt: now,
      })
      .execute();
    // Offline gemeldete Aufnahmen und Ereignisse ohne Plan erhalten die nachgemeldete ID (NIN5-14).
    await trx
      .updateTable('capture')
      .set({ nightPlanId: plan.nightPlanId })
      .where('tenantId', '=', this.tenantId)
      .where('sessionId', '=', sessionId)
      .where('nightPlanId', 'is', null)
      .execute();
    await trx
      .updateTable('sessionEvent')
      .set({ nightPlanId: plan.nightPlanId })
      .where('tenantId', '=', this.tenantId)
      .where('sessionId', '=', sessionId)
      .where('nightPlanId', 'is', null)
      .execute();
  }

  /**
   * `POST /sessions` (TK 5.6): idempotent über `(id, rig_id)`; Lease 3 min, außer `offline: true`.
   * Hält eine **andere** Session eine gültige Lease → `409 session.rig_busy`.
   */
  create(
    input: SessionCreateInput,
    now: Date,
  ): Promise<{ session: SessionRow; created: boolean; lease: LeaseView }> {
    return withTx(this.db, async (trx) => {
      const own = await this.session(input.id, trx);
      if (own) {
        const lease = await trx
          .selectFrom('rigLease')
          .selectAll()
          .where('rigId', '=', this.rigId)
          .where('tenantId', '=', this.tenantId)
          .executeTakeFirst();
        const held = lease?.activeSessionId === own.id && leaseHeld(lease, now);
        return {
          session: own,
          created: false,
          lease: {
            untilUtc: held && lease?.leaseUntil ? new Date(lease.leaseUntil) : null,
            leaseLost: false,
          },
        };
      }
      if (await this.exists(trx, input.id)) throw new ProblemError('resource.not_found');
      const lease = await this.lockLease(trx);
      let until: Date | null = null;
      if (!input.offline) {
        if (lease.activeSessionId !== input.id && leaseHeld(lease, now))
          throw new ProblemError('session.rig_busy');
        until = new Date(now.getTime() + LEASE_MS);
        await this.setLease(trx, input.id, until, now);
      }
      // Plan dieser Nacht (Server-Plan vor der Session, NT-47) verknüpfen und sein Sessionende übernehmen.
      let planId: string | null = null;
      let sessionEnd: Date | null = null;
      if (input.nightPlanId) {
        const plan = await trx
          .selectFrom('nightPlan')
          .select(['id', 'tenantId', 'rigId', 'summary', 'sessionId'])
          .where('id', '=', input.nightPlanId)
          .executeTakeFirst();
        if (plan && (plan.tenantId !== this.tenantId || plan.rigId !== this.rigId))
          throw new ProblemError('resource.not_found');
        if (plan) {
          planId = plan.id;
          const summary = (
            typeof plan.summary === 'string' ? JSON.parse(plan.summary) : plan.summary
          ) as {
            sessionEndUtc?: string;
          } | null;
          if (summary?.sessionEndUtc) sessionEnd = new Date(summary.sessionEndUtc);
        }
      }
      // UNIQUE (rig_id, night, started_at): gleichzeitig gestartete Sessions desselben Rigs → rig_busy.
      const clash = await trx
        .selectFrom('session')
        .select('id')
        .where('rigId', '=', this.rigId)
        .where('night', '=', input.night)
        .where('startedAt', '=', input.startedAt)
        .executeTakeFirst();
      if (clash) throw new ProblemError('session.rig_busy');
      await trx
        .insertInto('session')
        .values({
          id: input.id,
          tenantId: this.tenantId,
          rigId: this.rigId,
          ninaInstanceId: this.instanceId,
          night: input.night,
          nightPlanId: planId,
          startedAt: input.startedAt,
          sessionEndUtc: sessionEnd,
          reportDueAt: sessionEnd ? new Date(sessionEnd.getTime() + 2 * 3_600_000) : null,
          createdOffline: input.offline,
          lastHeartbeatAt: now,
        })
        .execute();
      if (planId)
        await trx
          .updateTable('nightPlan')
          .set({ sessionId: input.id })
          .where('id', '=', planId)
          .where('tenantId', '=', this.tenantId)
          .where('sessionId', 'is', null)
          .execute();
      if (input.offlinePlan)
        await this.saveOfflinePlan(trx, input.id, input.night, input.offlinePlan, now);
      const session = (await this.session(input.id, trx)) as SessionRow;
      return { session, created: true, lease: { untilUtc: until, leaseLost: false } };
    });
  }

  /** Andere Sessions desselben Rigs in derselben Nacht (Alarm `rig.busy` bei Offline-Sessions). */
  async otherSessionsInNight(sessionId: string, night: string): Promise<number> {
    const row = await this.db
      .selectFrom('session')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('tenantId', '=', this.tenantId)
      .where('rigId', '=', this.rigId)
      .where('night', '=', night)
      .where('id', '!=', sessionId)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  /**
   * `PATCH /sessions/{id}` (NT-11, NT-15, NT-47, M6, NIN5-7, NIN5-14):
   * - `running` + `resumedAtUtc`: nur aus `running`/`stale`, erneuert die Lease (sonst `409 session.closed`
   *   bzw. `409 session.rig_busy`).
   * - `completed`/`aborted`: endgültig, `ended_at`, `outbox_pending`, Lease frei.
   * - `offline: true` + `offlinePlan`: Plan nachmelden, ohne Lease annehmen.
   */
  patch(
    id: string,
    input: {
      status?: 'running' | 'completed' | 'aborted';
      endedAt?: Date;
      outboxPending?: number;
      ninaConditions?: unknown;
      offline?: boolean;
      offlinePlan?: OfflinePlanInput;
    },
    now: Date,
  ): Promise<{
    session: SessionRow;
    lease: LeaseView;
    ended: boolean;
    /** `outbox_pending` fiel mit diesem PATCH von > 0 auf 0 (Jobs am Sessionende, NIN5-7). */
    outboxDrained: boolean;
    nightPlanId: string | null;
  }> {
    return withTx(this.db, async (trx) => {
      const s = await this.session(id, trx);
      // Wie bei Aufnahmen und Ereignissen: unbekannt → `409 session.unknown` (das Plugin vergisst die Session bzw. meldet
      // sie nach), fremdes Rig → `404` (SEC-53).
      if (!s)
        throw new ProblemError(
          (await this.exists(trx, id)) ? 'resource.not_found' : 'session.unknown',
        );
      const lease = await this.lockLease(trx);
      const released = excludedByRelease(s, lease);
      const set: Partial<Record<keyof SessionTable, unknown>> = {};
      let leaseView: LeaseView = {
        untilUtc:
          lease.activeSessionId === id && lease.leaseUntil ? new Date(lease.leaseUntil) : null,
        leaseLost:
          (released && OPEN.has(s.status)) ||
          (lease.activeSessionId !== id && leaseHeld(lease, now)),
      };
      let ended = false;
      if (input.status === 'running') {
        if (!OPEN.has(s.status)) throw new ProblemError('session.closed');
        if (released) {
          leaseView = { untilUtc: null, leaseLost: true };
        } else {
          if (lease.activeSessionId !== id && leaseHeld(lease, now))
            throw new ProblemError('session.rig_busy');
          const until = new Date(now.getTime() + LEASE_MS);
          await this.setLease(trx, id, until, now);
          leaseView = { untilUtc: until, leaseLost: false };
          set.status = 'running';
          set.lastHeartbeatAt = now;
          if (s.status === 'stale') await this.rearmClose(trx, id, now);
        }
      } else if (input.status === 'completed' || input.status === 'aborted') {
        if (OPEN.has(s.status)) {
          set.status = input.status;
          set.endedAt = input.endedAt ?? now;
          ended = true;
          if (s.status === 'stale') await this.rearmClose(trx, id, now);
          if (lease.activeSessionId === id)
            await trx
              .updateTable('rigLease')
              .set({ activeSessionId: null, leaseUntil: null, offlineUntil: null, updatedAt: now })
              .where('rigId', '=', this.rigId)
              .where('tenantId', '=', this.tenantId)
              .execute();
          leaseView = { untilUtc: null, leaseLost: false };
        }
        // Wiederholte PATCHes mit kleinerem outboxPending sind idempotent (NIN5-7).
        if (input.outboxPending !== undefined)
          set.outboxPending =
            s.outboxPending === null
              ? input.outboxPending
              : Math.min(s.outboxPending, input.outboxPending);
      }
      if (input.ninaConditions !== undefined)
        set.ninaConditions = JSON.stringify(input.ninaConditions);
      let nightPlanId = s.nightPlanId;
      if (input.offlinePlan) {
        await this.saveOfflinePlan(trx, id, s.night, input.offlinePlan, now);
        nightPlanId = input.offlinePlan.nightPlanId;
        // Offline-Nachmeldung: ohne Lease angenommen; eine freie Lease wird für die Session gehalten (L9)
        // – nie für eine per Admin-Freigabe ausgeschlossene Session (M5).
        if (
          s.status === 'running' &&
          !released &&
          (lease.activeSessionId === id || !leaseHeld(lease, now))
        ) {
          const until = new Date(now.getTime() + LEASE_MS);
          await this.setLease(trx, id, until, now);
          leaseView = { untilUtc: until, leaseLost: false };
        }
      }
      if (Object.keys(set).length > 0)
        await trx
          .updateTable('session')
          .set(set as never)
          .where('id', '=', id)
          .where('tenantId', '=', this.tenantId)
          .execute();
      const session = (await this.session(id, trx)) as SessionRow;
      const outboxDrained =
        s.outboxPending !== null && s.outboxPending > 0 && session.outboxPending === 0;
      return { session, lease: leaseView, ended, outboxDrained, nightPlanId };
    });
  }

  /**
   * Heartbeat (M5, M6, FA-NIN-04): verlängert bzw. **holt** die Lease zurück, wenn sie frei ist oder
   * dieser Session gehört, die Session nicht per Admin-Freigabe ausgeschlossen und `running`/`stale`
   * ist (`stale → running`); Offline-Modus friert die Lease ein. Ohne `sessionId` keine Lease.
   * `rig_lease.offline_until` ändert nur der (neue) Halter: Heartbeats einer anderen Instanz bzw. einer
   * Session ohne Lease frieren weder ein noch tauen sie das Einfrieren des Halters auf.
   */
  heartbeat(
    input: { sessionId: string | null; offline: boolean; offlineUntil: Date | null },
    now: Date,
  ): Promise<LeaseView | null> {
    return withTx(this.db, async (trx) => {
      const lease = await this.lockLease(trx);
      if (!input.sessionId) return null;
      const s = await this.session(input.sessionId, trx);
      // Unbekannte Session (offline angelegt, Anlage liegt noch in der Outbox des Plugins): keine Lease-Angabe statt
      // `leaseLost` – sonst brach das Plugin den laufenden Block mit `lease_lost` ab, bis die Outbox die Session nachmeldete
      // (Analyse 04.10.2026).
      if (!s) return null;
      await trx
        .updateTable('session')
        .set({
          lastHeartbeatAt: now,
          offlineSince: input.offline ? (s.offlineSince ?? now) : null,
        })
        .where('id', '=', s.id)
        .where('tenantId', '=', this.tenantId)
        .execute();
      const mine = lease.activeSessionId === null || lease.activeSessionId === s.id;
      const free = mine || !leaseHeld(lease, now);
      if (!OPEN.has(s.status) || excludedByRelease(s, lease) || !free)
        return { untilUtc: null, leaseLost: true };
      const until = new Date(now.getTime() + LEASE_MS);
      let offlineUntil: Date | null = null;
      if (input.offline) {
        const max = new Date(now.getTime() + OFFLINE_MAX_MS);
        offlineUntil = input.offlineUntil && input.offlineUntil < max ? input.offlineUntil : max;
      }
      await this.setLease(trx, s.id, until, now, offlineUntil);
      if (s.status === 'stale') {
        await trx
          .updateTable('session')
          .set({ status: 'running' })
          .where('id', '=', s.id)
          .where('tenantId', '=', this.tenantId)
          .execute();
        await this.rearmClose(trx, s.id, now);
      }
      return { untilUtc: until, leaseLost: false };
    });
  }

  /** Letzten Heartbeat-Inhalt der Instanz speichern (NT-22; Übernahme in S-42, Alarme in AP-15). */
  async recordInstanceState(
    state: {
      pluginVersion: string;
      engineVersion: string;
      profileLat: number | null;
      profileLon: number | null;
      lastState: unknown;
    },
    now: Date,
  ): Promise<void> {
    await this.db
      .updateTable('ninaInstance')
      .set({
        pluginVersion: state.pluginVersion,
        engineVersion: state.engineVersion,
        profileLat: state.profileLat,
        profileLon: state.profileLon,
        lastState: JSON.stringify(state.lastState),
        lastSeenAt: now,
      })
      .where('id', '=', this.instanceId)
      .where('tenantId', '=', this.tenantId)
      .execute();
  }

  /** Offene Kommandos der Instanz (≤ 10 min, TK 7.6) und Quittungen. */
  async commands(acked: readonly string[], now: Date): Promise<{ id: string; command: string }[]> {
    if (acked.length > 0)
      await this.db
        .updateTable('command')
        .set({ acknowledgedAt: now })
        .where('tenantId', '=', this.tenantId)
        .where('ninaInstanceId', '=', this.instanceId)
        .where('id', 'in', [...acked])
        .where('acknowledgedAt', 'is', null)
        .execute();
    const rows = await this.db
      .selectFrom('command')
      .select(['id', 'kind'])
      .where('tenantId', '=', this.tenantId)
      .where('ninaInstanceId', '=', this.instanceId)
      .where('acknowledgedAt', 'is', null)
      .where('createdAt', '>', new Date(now.getTime() - 10 * 60_000))
      .orderBy('createdAt')
      .execute();
    return rows.map((r) => ({ id: r.id, command: r.kind }));
  }

  /** `session_end_utc` der letzten Planrevision (NT-09), für den Nachtbericht. */
  async lastPlanSummary(
    sessionId: string,
  ): Promise<{ darknessEndUtc: string | null; sessionEndUtc: string | null } | null> {
    const row = await this.db
      .selectFrom('nightPlan')
      .select('summary')
      .where('tenantId', '=', this.tenantId)
      .where('sessionId', '=', sessionId)
      .orderBy('revision', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (!row) return null;
    const s = (typeof row.summary === 'string' ? JSON.parse(row.summary) : row.summary) as {
      darknessEndUtc?: string | null;
      sessionEndUtc?: string | null;
    };
    return { darknessEndUtc: s.darknessEndUtc ?? null, sessionEndUtc: s.sessionEndUtc ?? null };
  }
}

/** Admin-Freigabe der Lease (`POST /web/v1/rigs/{id}/lease/release`, TK 5.6): beendet auch das Einfrieren. */
export async function releaseRigLease(
  db: Kysely<Database>,
  tenantId: string,
  rigId: string,
  now: Date,
): Promise<{ releasedSessionId: string | null }> {
  return withTx(db, async (trx) => {
    const rig = await trx
      .selectFrom('rig')
      .select('id')
      .where('tenantId', '=', tenantId)
      .where('id', '=', rigId)
      .executeTakeFirst();
    if (!rig) throw new ProblemError('resource.not_found');
    const lease = await trx
      .selectFrom('rigLease')
      .selectAll()
      .where('rigId', '=', rigId)
      .where('tenantId', '=', tenantId)
      .forUpdate()
      .executeTakeFirst();
    if (!lease) return { releasedSessionId: null };
    // Freigabe an der Session festhalten, bis sie abgeschlossen ist (M5, `leaseReleasedAt`).
    if (lease.activeSessionId) {
      const s = await trx
        .selectFrom('session')
        .select(['status', 'kpis'])
        .where('tenantId', '=', tenantId)
        .where('rigId', '=', rigId)
        .where('id', '=', lease.activeSessionId)
        .executeTakeFirst();
      if (s && OPEN.has(s.status))
        await trx
          .updateTable('session')
          .set({ kpis: JSON.stringify({ ...jsonObject(s.kpis), leaseReleasedAt: isoSec(now) }) })
          .where('tenantId', '=', tenantId)
          .where('id', '=', lease.activeSessionId)
          .execute();
    }
    await trx
      .updateTable('rigLease')
      .set({
        activeSessionId: null,
        leaseUntil: null,
        offlineUntil: null,
        releasedSessionId: lease.activeSessionId ?? lease.releasedSessionId,
        updatedAt: now,
      })
      .where('rigId', '=', rigId)
      .where('tenantId', '=', tenantId)
      .execute();
    return { releasedSessionId: lease.activeSessionId };
  });
}

/**
 * Teil des Jobs `session_close` (TK 6.6, DAT5-7): jede noch laufende Flat-Kombination wird `done`
 * (Sollzahlen erreicht bzw. beide 0) oder `skipped`. KPIs und Klarnacht-Statistik folgen mit AP-15.
 * Liefert die Projekte mit Aufnahmen der Session (für die Aufwand-Jobs, NT-48).
 */
export async function closeSessionFlats(
  db: Kysely<Database>,
  tenantId: string,
  sessionId: string,
): Promise<{ projectIds: string[]; skipped: boolean }> {
  return withTx(db, async (trx) => {
    // Seit dem Anlegen des Jobs wieder aufgenommen (stale → running): nichts schließen; der nächste
    // `session_close` folgt beim Ende bzw. erneuten Verwaisen (Neu-Scharfschalten, `rearmClose`).
    const session = await trx
      .selectFrom('session')
      .select('status')
      .where('tenantId', '=', tenantId)
      .where('id', '=', sessionId)
      .executeTakeFirst();
    if (session?.status === 'running') return { projectIds: [], skipped: true };
    const combos = await trx
      .selectFrom('flatCombination')
      .selectAll()
      .where('tenantId', '=', tenantId)
      .where('sessionId', '=', sessionId)
      .where('status', '=', 'running')
      .execute();
    for (const c of combos) {
      const done =
        Number(c.flatsTaken) >= Number(c.flatsPlanned) &&
        Number(c.darkFlatsTaken) >= Number(c.darkFlatsPlanned);
      await trx
        .updateTable('flatCombination')
        .set({ status: done ? 'done' : 'skipped' })
        .where('tenantId', '=', tenantId)
        .where('sessionId', '=', sessionId)
        .where('filterShortName', '=', c.filterShortName)
        .where('rotatorMechDegDg', '=', c.rotatorMechDegDg)
        .where('gain', '=', c.gain)
        .where('offsetAdu', '=', c.offsetAdu)
        .where('binning', '=', c.binning)
        .where('readoutModeIndex', '=', c.readoutModeIndex)
        .execute();
    }
    const rows = await trx
      .selectFrom('capture')
      .select('projectId')
      .distinct()
      .where('tenantId', '=', tenantId)
      .where('sessionId', '=', sessionId)
      .where('projectId', 'is not', null)
      .execute();
    return { projectIds: rows.map((r) => r.projectId as string).sort(), skipped: false };
  });
}

/** Nachtbericht-Status setzen (TK 13, FA-AUS-21). */
export async function setReportStatus(
  db: Kysely<Database>,
  tenantId: string,
  sessionId: string,
  status: 'pending' | 'sent' | 'failed' | 'skipped',
  sentAt?: Date,
): Promise<void> {
  await db
    .updateTable('session')
    .set({ reportStatus: status, ...(status === 'sent' && sentAt ? { reportSentAt: sentAt } : {}) })
    .where('tenantId', '=', tenantId)
    .where('id', '=', sessionId)
    .execute();
}
