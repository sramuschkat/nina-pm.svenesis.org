/**
 * Gemessene Overheads je Rig (AP-65, FA-RIG-04b): Ist der letzten 30 Nächte laden (Session-Ereignisse und Light-Aufnahmen
 * der Sessions mit `block_start`, Plugin ≥ 0.4.13) und das Ergebnis speichern. Speicherort ohne Migration: die beim
 * `session_close` abgeschlossene Session trägt die Messung des Rigs in `session.kpis.measuredOverhead` (die Rolle
 * `app_job` darf `rig` nur in `updated_at` ändern); gelesen wird die jüngste Session des Rigs mit Messung. Jede Abfrage
 * mandantengebunden.
 */
import {
  MEASURED_NIGHTS,
  MeasuredOverheads,
  type OverheadEvent,
  type OverheadLight,
  type OverheadNight,
} from '@nina-pm/shared';
import { sql, type Kysely } from 'kysely';
import { withTx } from '../tx';
import type { Database } from '../types';

/** Ereignisarten, die die Messung braucht (`measuredOverheads`). */
const KINDS = [
  'block_start',
  'block_end',
  'block_skipped',
  'af',
  'flip',
  'flip_undetected',
  'safety_pause',
  'safety_resume',
  'plan_built',
  'plan_rebuilt',
  'skipped_timeaware',
  'center_failed',
  'lease_lost',
  'offline_start',
  'offline_end',
];

/** Obergrenze je Abfrage (30 Nächte; eine Transit-Nacht hat einige hundert Lights). */
const ROW_LIMIT = 60_000;

const dayMs = 86_400_000;
const nightKey = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
const ms = (v: unknown) => (v instanceof Date ? v.getTime() : Date.parse(String(v)));
const object = (v: unknown): Record<string, unknown> | null => {
  const o = typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
  return o !== null && typeof o === 'object' && !Array.isArray(o)
    ? (o as Record<string, unknown>)
    : null;
};

export interface OverheadIst {
  readonly rigId: string;
  readonly fromNight: string;
  readonly toNight: string;
  readonly nights: OverheadNight[];
}

/** Erste Nacht des Fensters von `nights` Nächten bis `toNight` (Nacht-Schlüssel, reine Kalenderrechnung in UTC). */
export function overheadWindowStart(toNight: string, nights = MEASURED_NIGHTS): string {
  return new Date(Date.parse(`${toNight}T00:00:00Z`) - (nights - 1) * dayMs)
    .toISOString()
    .slice(0, 10);
}

/**
 * Ist des Rigs der Session für die letzten `MEASURED_NIGHTS` Nächte bis zur Nacht der Session: nur Sessions mit
 * `block_start` (Plugin ≥ 0.4.13). `null`, wenn die Session nicht zum Mandanten gehört.
 */
export async function overheadIstForSession(
  db: Kysely<Database>,
  tenantId: string,
  sessionId: string,
): Promise<OverheadIst | null> {
  const s = await db
    .selectFrom('session')
    .select(['rigId', 'night'])
    .where('tenantId', '=', tenantId)
    .where('id', '=', sessionId)
    .executeTakeFirst();
  if (!s) return null;
  const toNight = nightKey(s.night);
  const fromNight = overheadWindowStart(toNight);
  const sessions = await db
    .selectFrom('session')
    .select(['id', 'night'])
    .where('tenantId', '=', tenantId)
    .where('rigId', '=', s.rigId)
    .where('night', '>=', fromNight)
    .where('night', '<=', toNight)
    .execute();
  const empty = { rigId: s.rigId, fromNight, toNight, nights: [] };
  if (sessions.length === 0) return empty;
  const ids = sessions.map((x) => x.id);
  const events = await db
    .selectFrom('sessionEvent')
    .select(['sessionId', 'occurredAt', 'kind', 'blockId', 'projectId', 'durationS', 'data'])
    .where('tenantId', '=', tenantId)
    .where('sessionId', 'in', ids)
    .where('kind', 'in', KINDS)
    .orderBy('occurredAt')
    .limit(ROW_LIMIT)
    .execute();
  const withBlocks = new Set(
    events.filter((e) => e.kind === 'block_start').map((e) => e.sessionId),
  );
  const used = ids.filter((id) => withBlocks.has(id));
  if (used.length === 0) return empty;
  const lights = await db
    .selectFrom('capture')
    .select([
      'sessionId',
      'capturedAt',
      'exposureS',
      'filterShortName',
      'blockId',
      'transitObservationId',
    ])
    .where('tenantId', '=', tenantId)
    .where('sessionId', 'in', used)
    .where('frameType', '=', 'light')
    .orderBy('capturedAt')
    .limit(ROW_LIMIT)
    .execute();
  const nightOf = new Map(sessions.map((x) => [x.id, nightKey(x.night)]));
  const byNight = new Map<string, { events: OverheadEvent[]; lights: OverheadLight[] }>();
  const bucket = (sessionId: string) => {
    const night = nightOf.get(sessionId) ?? toNight;
    let b = byNight.get(night);
    if (!b) {
      b = { events: [], lights: [] };
      byNight.set(night, b);
    }
    return b;
  };
  for (const e of events) {
    if (!withBlocks.has(e.sessionId)) continue;
    bucket(e.sessionId).events.push({
      atMs: ms(e.occurredAt),
      kind: e.kind,
      blockId: e.blockId,
      projectId: e.projectId,
      durationS: e.durationS === null ? null : Number(e.durationS),
      data: object(e.data),
    });
  }
  for (const l of lights)
    bucket(l.sessionId).lights.push({
      startMs: ms(l.capturedAt),
      exposureS: Number(l.exposureS),
      filter: l.filterShortName,
      blockId: l.blockId,
      transit: l.transitObservationId !== null,
    });
  const nights = [...byNight.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([night, b]) => ({ night, events: b.events, lights: b.lights }));
  return { rigId: s.rigId, fromNight, toNight, nights };
}

/** Messung an der abgeschlossenen Session ablegen (`session.kpis.measuredOverhead`, übrige Schlüssel bleiben). */
export async function saveMeasuredOverhead(
  db: Kysely<Database>,
  tenantId: string,
  sessionId: string,
  measured: MeasuredOverheads,
): Promise<void> {
  await withTx(db, async (trx) => {
    const s = await trx
      .selectFrom('session')
      .select('kpis')
      .where('tenantId', '=', tenantId)
      .where('id', '=', sessionId)
      .executeTakeFirst();
    if (!s) return;
    await trx
      .updateTable('session')
      .set({ kpis: JSON.stringify({ ...(object(s.kpis) ?? {}), measuredOverhead: measured }) })
      .where('tenantId', '=', tenantId)
      .where('id', '=', sessionId)
      .execute();
  });
}

/** Jüngste gespeicherte Messung je Rig (eine Abfrage je Rig über `ix_session_rig_night`); ohne Messung fehlt das Rig. */
export async function latestMeasuredOverheads(
  db: Kysely<Database>,
  tenantId: string,
  rigIds: readonly string[],
): Promise<Map<string, MeasuredOverheads>> {
  const out = new Map<string, MeasuredOverheads>();
  for (const rigId of [...new Set(rigIds)].sort()) {
    const row = await db
      .selectFrom('session')
      .select(sql<unknown>`kpis -> 'measuredOverhead'`.as('measured'))
      .where('tenantId', '=', tenantId)
      .where('rigId', '=', rigId)
      .where(sql<boolean>`kpis -> 'measuredOverhead' is not null`)
      .orderBy('night', 'desc')
      .orderBy('startedAt', 'desc')
      .limit(1)
      .executeTakeFirst();
    const parsed = row ? MeasuredOverheads.safeParse(object(row.measured)) : null;
    if (parsed?.success) out.set(rigId, parsed.data);
  }
  return out;
}
