/**
 * Hintergrundaufgaben rund um Sessions (AP-15; TK 13; FK 8.1, 8.4; NT-08, NT-09, DAT-1, DAT5-3) – über
 * alle Mandanten, jede Schreiboperation mandantengebunden:
 * - `markStaleSessions` (`tick-5min`): *läuft* → *verwaist* bei 10 min ohne Heartbeat (nur
 *   `offline_since IS NULL`) bzw. 2 h nach `session_end_utc` der letzten Planrevision.
 * - `sessionsDueForClose` (`tick-5min`): beendete bzw. verwaiste Sessions ohne `session_close`-Job,
 *   sobald `outbox_pending = 0` oder 6 h nach `ended_at` (NIN5-7). Verlässt eine Session `stale`, benennt
 *   `NinaSessionRepository.rearmClose` den alten Job um (`…:rearmed:<Zeit>`), damit sie erneut fällig wird.
 * - `reconcileSite` (Job `reconcile` aus `tick-hourly`, einmal je Standortnacht): Zähler je Zeile und
 *   Nacht aus `capture`/`correction` neu bilden (Regel max, FA-AUS-06), verwaiste `capture_night`-Zeilen
 *   entfernen, Zeilenzähler als Summe; überspringt Rigs mit laufender Session.
 * - `activeAdminIds`, `alertSentSince`: Empfänger und Entprellung der Betriebsalarme in der App.
 */
import { withTx } from '../tx';
import type { Database } from '../types';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export const STALE_NO_HEARTBEAT_MS = 10 * 60_000;
export const STALE_AFTER_SESSION_END_MS = 2 * 3_600_000;
export const CLOSE_AFTER_END_MS = 6 * 3_600_000;

export interface StaleSession {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly rigId: string;
  readonly rigName: string;
  readonly night: string;
  readonly reason: 'no_heartbeat' | 'past_session_end';
}

/** Laufende Sessions nach den Zeitschwellen aus FK 8.1 auf *verwaist* setzen. */
export async function markStaleSessions(db: Kysely<Database>, now: Date): Promise<StaleSession[]> {
  const heartbeatLimit = new Date(now.getTime() - STALE_NO_HEARTBEAT_MS);
  const endLimit = new Date(now.getTime() - STALE_AFTER_SESSION_END_MS);
  const candidates = await db
    .selectFrom('session as s')
    .innerJoin('rig as r', (j) =>
      j.onRef('r.id', '=', 's.rigId').onRef('r.tenantId', '=', 's.tenantId'),
    )
    .select([
      's.tenantId',
      's.id',
      's.rigId',
      'r.name as rigName',
      's.night',
      's.lastHeartbeatAt',
      's.startedAt',
      's.offlineSince',
      's.sessionEndUtc',
    ])
    .where('s.status', '=', 'running')
    .where((eb) =>
      eb.or([
        eb.and([
          eb('s.offlineSince', 'is', null),
          eb(eb.fn.coalesce('s.lastHeartbeatAt', 's.startedAt'), '<', heartbeatLimit),
        ]),
        eb.and([eb('s.sessionEndUtc', 'is not', null), eb('s.sessionEndUtc', '<', endLimit)]),
      ]),
    )
    .orderBy('s.tenantId')
    .orderBy('s.id')
    .limit(500)
    .execute();
  const out: StaleSession[] = [];
  for (const c of candidates) {
    const noHeartbeat =
      c.offlineSince === null &&
      new Date(c.lastHeartbeatAt ?? c.startedAt).getTime() < heartbeatLimit.getTime();
    const updated = await db
      .updateTable('session')
      .set({ status: 'stale' })
      .where('tenantId', '=', c.tenantId)
      .where('id', '=', c.id)
      .where('status', '=', 'running')
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 0) continue;
    out.push({
      tenantId: c.tenantId,
      sessionId: c.id,
      rigId: c.rigId,
      rigName: c.rigName,
      night: String(c.night),
      reason: noHeartbeat ? 'no_heartbeat' : 'past_session_end',
    });
  }
  return out;
}

export interface SessionToClose {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly endedAt: Date | null;
  /** Ende der Dunkelheit bzw. Sessionende der letzten Planrevision (Frist des Nachtberichts). */
  readonly reportAt: Date;
}

/** Beendete/verwaiste Sessions ohne `session_close`-Job, deren Outbox leer ist oder die 6 h beendet sind. */
export async function sessionsDueForClose(
  db: Kysely<Database>,
  now: Date,
): Promise<SessionToClose[]> {
  const sixHours = new Date(now.getTime() - CLOSE_AFTER_END_MS);
  const rows = await db
    .selectFrom('session as s')
    .select(['s.tenantId', 's.id', 's.endedAt', 's.status', 's.outboxPending', 's.sessionEndUtc'])
    .where('s.status', 'in', ['completed', 'aborted', 'stale'])
    .where((eb) =>
      eb.or([
        eb('s.status', '=', 'stale'),
        eb('s.outboxPending', 'is', null),
        eb('s.outboxPending', '=', 0),
        eb('s.endedAt', '<=', sixHours),
      ]),
    )
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom('job as j')
            .select('j.id')
            .whereRef('j.tenantId', '=', 's.tenantId')
            .where('j.dedupeKey', '=', sql<string>`'session_close:' || s.id`),
        ),
      ),
    )
    .orderBy('s.tenantId')
    .orderBy('s.id')
    .limit(200)
    .execute();
  const out: SessionToClose[] = [];
  for (const r of rows) {
    const plan = await db
      .selectFrom('nightPlan')
      .select('summary')
      .where('tenantId', '=', r.tenantId)
      .where('sessionId', '=', r.id)
      .orderBy('revision', 'desc')
      .limit(1)
      .executeTakeFirst();
    const s = (typeof plan?.summary === 'string' ? JSON.parse(plan.summary) : plan?.summary) as
      { darknessEndUtc?: string | null; sessionEndUtc?: string | null } | undefined;
    const ended = r.endedAt === null ? null : new Date(r.endedAt);
    const mark = s?.darknessEndUtc ?? s?.sessionEndUtc ?? null;
    const reportAt = new Date(
      Math.max(ended?.getTime() ?? now.getTime(), mark ? Date.parse(mark) : 0),
    );
    out.push({ tenantId: r.tenantId, sessionId: r.id, endedAt: ended, reportAt });
  }
  return out;
}

/** Aktive Admins des Mandanten (Empfänger der Betriebsalarme in der App). */
export async function activeAdminIds(db: Kysely<Database>, tenantId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('appUser')
    .select('id')
    .where('tenantId', '=', tenantId)
    .where('role', '=', 'admin')
    .where('status', '=', 'active')
    .orderBy('id')
    .execute();
  return rows.map((r) => r.id);
}

/** Gab es diesen Alarm (Art + Schlüssel im `payload.key`) seit `since` schon? Entprellung. */
export async function alertSentSince(
  db: Kysely<Database>,
  tenantId: string,
  kind: string,
  key: string,
  since: Date,
): Promise<boolean> {
  const row = await db
    .selectFrom('notification')
    .select('id')
    .where('tenantId', '=', tenantId)
    .where('kind', '=', kind)
    .where('createdAt', '>=', since)
    .where(sql<boolean>`payload->>'key' = ${key}`)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

export interface ReconcileResult {
  readonly rigs: number;
  readonly rigsSkipped: number;
  readonly lines: number;
  readonly linesFixed: number;
  readonly rowsFixed: number;
  readonly rowsDeleted: number;
}

interface NightCounts {
  acquired: number;
  rejectedIndividual: number;
  rejectedCorrection: number;
  rejected: number;
  bonus: number;
  bonusRejected: number;
  integrationS: number;
  hasCaptures: boolean;
  hasCorrection: boolean;
}

/**
 * Zähler-Abgleich eines Standorts (NT-08): je Rig ohne laufende Session je Zeile eine Transaktion
 * (Wächter `FOR UPDATE` auf der Zeile, ≤ 3.000 Zeilen). Zeilen mit Importquelle bleiben unverändert.
 */
export async function reconcileSite(
  db: Kysely<Database>,
  tenantId: string,
  siteId: string,
  now: Date,
): Promise<ReconcileResult> {
  const rigs = await db
    .selectFrom('rig')
    .select('id')
    .where('tenantId', '=', tenantId)
    .where('siteId', '=', siteId)
    .orderBy('id')
    .execute();
  let rigsSkipped = 0;
  let lines = 0;
  let linesFixed = 0;
  let rowsFixed = 0;
  let rowsDeleted = 0;
  for (const rig of rigs) {
    const running = await db
      .selectFrom('session')
      .select('id')
      .where('tenantId', '=', tenantId)
      .where('rigId', '=', rig.id)
      .where('status', '=', 'running')
      .limit(1)
      .executeTakeFirst();
    if (running) {
      rigsSkipped += 1;
      continue;
    }
    const lineIds = await db
      .selectFrom('exposureLine as l')
      .innerJoin('project as p', (j) =>
        j.onRef('p.id', '=', 'l.projectId').onRef('p.tenantId', '=', 'l.tenantId'),
      )
      .select('l.id')
      .where('l.tenantId', '=', tenantId)
      .where('p.rigId', '=', rig.id)
      .orderBy('l.id')
      .execute();
    for (const { id } of lineIds) {
      lines += 1;
      const r = await reconcileLine(db, tenantId, id, now);
      if (r.changed) linesFixed += 1;
      rowsFixed += r.rowsFixed;
      rowsDeleted += r.rowsDeleted;
    }
  }
  return { rigs: rigs.length, rigsSkipped, lines, linesFixed, rowsFixed, rowsDeleted };
}

async function reconcileLine(
  db: Kysely<Database>,
  tenantId: string,
  lineId: string,
  now: Date,
): Promise<{ changed: boolean; rowsFixed: number; rowsDeleted: number }> {
  return withTx(db, async (trx) => {
    const line = await trx
      .selectFrom('exposureLine')
      .select([
        'id',
        'projectId',
        'exposureS',
        'acquiredCount',
        'rejectedCount',
        'bonusCount',
        'bonusRejectedCount',
      ])
      .where('tenantId', '=', tenantId)
      .where('id', '=', lineId)
      .forUpdate()
      .executeTakeFirst();
    if (!line) return { changed: false, rowsFixed: 0, rowsDeleted: 0 };
    const lineExposure = Number(line.exposureS);
    const captures = await trx
      .selectFrom('capture')
      .select([
        'night',
        sql<number>`SUM(CASE WHEN NOT is_bonus THEN 1 ELSE 0 END)`.as('acquired'),
        sql<number>`SUM(CASE WHEN NOT is_bonus AND rejected THEN 1 ELSE 0 END)`.as('rejInd'),
        sql<number>`SUM(CASE WHEN is_bonus THEN 1 ELSE 0 END)`.as('bonus'),
        sql<number>`SUM(CASE WHEN is_bonus AND rejected THEN 1 ELSE 0 END)`.as('bonusRej'),
        sql<number>`SUM(CASE WHEN NOT rejected THEN exposure_s ELSE 0 END)`.as('seconds'),
      ])
      .where('tenantId', '=', tenantId)
      .where('exposureLineId', '=', lineId)
      .where('frameType', '=', 'light')
      .where('result', '=', 'saved')
      .where('assignment', '=', 'assigned')
      .groupBy('night')
      .execute();
    const corrections = await trx
      .selectFrom('correction')
      .select(['night', 'rejectedCount', 'createdAt', 'id'])
      .where('tenantId', '=', tenantId)
      .where('exposureLineId', '=', lineId)
      .orderBy('createdAt')
      .orderBy('id')
      .execute();
    const existing = await trx
      .selectFrom('captureNight')
      .selectAll()
      .where('tenantId', '=', tenantId)
      .where('exposureLineId', '=', lineId)
      .execute();

    const nights = new Map<string, NightCounts>();
    const slot = (night: string) => {
      const k = String(night);
      let n = nights.get(k);
      if (!n) {
        n = {
          acquired: 0,
          rejectedIndividual: 0,
          rejectedCorrection: 0,
          rejected: 0,
          bonus: 0,
          bonusRejected: 0,
          integrationS: 0,
          hasCaptures: false,
          hasCorrection: false,
        };
        nights.set(k, n);
      }
      return n;
    };
    for (const c of captures) {
      const n = slot(String(c.night));
      n.acquired = Number(c.acquired);
      n.rejectedIndividual = Number(c.rejInd);
      n.bonus = Number(c.bonus);
      n.bonusRejected = Number(c.bonusRej);
      n.integrationS = Number(c.seconds);
      n.hasCaptures = true;
    }
    // Die jüngste Korrektur je Nacht gilt (FA-AUS-06).
    for (const c of corrections) {
      const n = slot(String(c.night));
      n.rejectedCorrection = Number(c.rejectedCount);
      n.hasCorrection = true;
    }
    for (const n of nights.values()) {
      n.rejected = Math.max(n.rejectedCorrection, n.rejectedIndividual);
      n.integrationS -= Math.max(0, n.rejected - n.rejectedIndividual) * lineExposure;
    }

    let rowsFixed = 0;
    let rowsDeleted = 0;
    const totals = { acquired: 0, rejected: 0, bonus: 0, bonusRejected: 0 };
    const isImport = (sources: unknown) =>
      (Array.isArray(sources) ? sources : typeof sources === 'string' ? JSON.parse(sources) : [])
        .map(String)
        .includes('import');
    for (const row of existing) {
      const night = String(row.night);
      if (isImport(row.sources)) {
        // Importierte Zählungen haben keine Aufnahmen: unverändert übernehmen.
        totals.acquired += Number(row.acquiredCount);
        totals.rejected += Number(row.rejectedCount);
        totals.bonus += Number(row.bonusCount);
        totals.bonusRejected += Number(row.bonusRejectedCount);
        nights.delete(night);
        continue;
      }
      const n = nights.get(night);
      if (!n) {
        await trx
          .deleteFrom('captureNight')
          .where('tenantId', '=', tenantId)
          .where('exposureLineId', '=', lineId)
          .where('night', '=', row.night)
          .execute();
        rowsDeleted += 1;
        continue;
      }
      const same =
        Number(row.acquiredCount) === n.acquired &&
        Number(row.rejectedIndividual) === n.rejectedIndividual &&
        Number(row.rejectedCorrection) === n.rejectedCorrection &&
        Number(row.rejectedCount) === n.rejected &&
        Number(row.bonusCount) === n.bonus &&
        Number(row.bonusRejectedCount) === n.bonusRejected &&
        Math.abs(Number(row.integrationS) - n.integrationS) < 1e-6;
      if (!same) {
        await trx
          .updateTable('captureNight')
          .set({
            acquiredCount: n.acquired,
            rejectedIndividual: n.rejectedIndividual,
            rejectedCorrection: n.rejectedCorrection,
            rejectedCount: n.rejected,
            bonusCount: n.bonus,
            bonusRejectedCount: n.bonusRejected,
            integrationS: n.integrationS,
            updatedAt: now,
          })
          .where('tenantId', '=', tenantId)
          .where('exposureLineId', '=', lineId)
          .where('night', '=', row.night)
          .execute();
        rowsFixed += 1;
      }
      nights.delete(night);
      totals.acquired += n.acquired;
      totals.rejected += n.rejected;
      totals.bonus += n.bonus;
      totals.bonusRejected += n.bonusRejected;
    }
    // Nächte mit Aufnahmen oder Korrekturen, aber ohne `capture_night`-Zeile.
    for (const [night, n] of nights) {
      await trx
        .insertInto('captureNight')
        .values({
          tenantId,
          exposureLineId: lineId,
          night,
          projectId: line.projectId,
          acquiredCount: n.acquired,
          rejectedIndividual: n.rejectedIndividual,
          rejectedCorrection: n.rejectedCorrection,
          rejectedCount: n.rejected,
          bonusCount: n.bonus,
          bonusRejectedCount: n.bonusRejected,
          integrationS: n.integrationS,
          sources: JSON.stringify([
            ...(n.hasCaptures ? ['nina'] : []),
            ...(n.hasCorrection ? ['correction'] : []),
          ]),
          updatedAt: now,
        })
        .execute();
      rowsFixed += 1;
      totals.acquired += n.acquired;
      totals.rejected += n.rejected;
      totals.bonus += n.bonus;
      totals.bonusRejected += n.bonusRejected;
    }
    const lineSame =
      Number(line.acquiredCount) === totals.acquired &&
      Number(line.rejectedCount) === totals.rejected &&
      Number(line.bonusCount) === totals.bonus &&
      Number(line.bonusRejectedCount) === totals.bonusRejected;
    if (!lineSame)
      await trx
        .updateTable('exposureLine')
        .set({
          acquiredCount: totals.acquired,
          rejectedCount: totals.rejected,
          bonusCount: totals.bonus,
          bonusRejectedCount: totals.bonusRejected,
          updatedAt: now,
        })
        .where('tenantId', '=', tenantId)
        .where('id', '=', lineId)
        .execute();
    return { changed: !lineSame || rowsFixed + rowsDeleted > 0, rowsFixed, rowsDeleted };
  });
}
