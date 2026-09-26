/**
 * Betriebsexport des Aufbaus (`ops-cli export-setup`): Mengen der Auswertungsdaten eines Mandanten, damit die
 * Auswertungs-Demo zum vorhandenen Stand passt. Nur Lesen, mandantengebunden.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../types';

/** Tabellen mit Auswertungsdaten (Sessions, Aufnahmen, Protokolle, Statistik). */
const EVALUATION_TABLES = [
  'session',
  'capture',
  'capture_night',
  'correction',
  'flat_combination',
  'session_event',
  'session_log',
  'site_night_stat',
] as const;

export interface EvaluationCounts {
  readonly rows: Record<string, number>;
  readonly nightPlansByOrigin: Record<string, number>;
  readonly sessionNights: { readonly from: string | null; readonly to: string | null };
  readonly sessionsByRig: Record<string, number>;
}

export async function evaluationCounts(
  db: Kysely<Database>,
  tenantId: string,
): Promise<EvaluationCounts> {
  const rows: Record<string, number> = {};
  for (const table of EVALUATION_TABLES) {
    const res = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM ${sql.table(table)} WHERE tenant_id = ${tenantId}`.execute(db);
    rows[table] = Number(res.rows[0]?.n ?? 0);
  }
  const plans = await db
    .selectFrom('nightPlan')
    .select(['origin', sql<number>`count(*)::int`.as('n')])
    .where('tenantId', '=', tenantId)
    .groupBy('origin')
    .execute();
  const range = await db
    .selectFrom('session')
    .select([sql<string>`min(night)::text`.as('from'), sql<string>`max(night)::text`.as('to')])
    .where('tenantId', '=', tenantId)
    .executeTakeFirst();
  const byRig = await db
    .selectFrom('session')
    .select(['rigId', sql<number>`count(*)::int`.as('n')])
    .where('tenantId', '=', tenantId)
    .groupBy('rigId')
    .execute();
  return {
    rows,
    nightPlansByOrigin: Object.fromEntries(plans.map((p) => [p.origin, Number(p.n)])),
    sessionNights: { from: range?.from ?? null, to: range?.to ?? null },
    sessionsByRig: Object.fromEntries(byRig.map((r) => [r.rigId, Number(r.n)])),
  };
}
