/**
 * Mandant löschen (FA-MAN-03): alle Zeilen mit `tenant_id` in Fremdschlüssel-Reihenfolge (Kinder zuerst),
 * je Stapel eine eigene Transaktion mit höchstens `batch` Zeilen (rules/dsql.md: ≤ 3.000 Zeilen, keine
 * ON-DELETE-Aktionen). Das System-Audit bleibt erhalten: `tenant_id` → `null`, Mandanten-ID in `details`
 * (SV-11). Wiederholbar: bricht ein Lauf ab, bleibt der Mandant gesperrt und ein zweiter Lauf setzt fort.
 */
import { sql, type Kysely, type Transaction } from 'kysely';
import { withTx, type WithTxOptions } from '../tx';
import type { Database } from '../types';

/** Tabellen mit `tenant_id`, Kinder vor Eltern; der Test prüft Vollständigkeit und Reihenfolge gegen das Schema. */
export const TENANT_DELETE_ORDER: readonly { table: string; key: readonly string[] }[] = [
  { table: 'approval_event', key: ['id'] },
  { table: 'auth_session', key: ['id'] },
  { table: 'capture', key: ['id'] },
  { table: 'capture_night', key: ['exposure_line_id', 'night'] },
  { table: 'change_log', key: ['id'] },
  { table: 'change_request', key: ['id'] },
  { table: 'command', key: ['id'] },
  { table: 'correction', key: ['id'] },
  { table: 'discord_delivery', key: ['channel_id', 'event_key', 'object_id'] },
  { table: 'exo_project', key: ['project_id'] },
  { table: 'exposure_template_line', key: ['id'] },
  { table: 'favorite', key: ['user_id', 'project_id'] },
  {
    table: 'flat_combination',
    key: [
      'session_id',
      'filter_short_name',
      'rotator_mech_deg_dg',
      'gain',
      'offset_adu',
      'binning',
      'readout_mode_index',
    ],
  },
  { table: 'invitation', key: ['id'] },
  { table: 'job', key: ['id'] },
  { table: 'notification', key: ['id'] },
  { table: 'project_note_reaction', key: ['note_id', 'user_id', 'emoji'] },
  { table: 'project_note', key: ['id'] },
  { table: 'queue_vote', key: ['tenant_id', 'subject_kind', 'subject_id', 'voter_id'] },
  { table: 'rig_lease', key: ['rig_id'] },
  { table: 'session_event', key: ['id'] },
  { table: 'session_log', key: ['session_id'] },
  { table: 'site_link', key: ['id'] },
  { table: 'site_night_forecast', key: ['site_id', 'night'] },
  { table: 'site_night_stat', key: ['site_id', 'night'] },
  { table: 'tenant_storage', key: ['tenant_id'] },
  { table: 'transit_result', key: ['id'] },
  { table: 'user_preference', key: ['user_id', 'pref_key'] },
  { table: 'discord_channel', key: ['id'] },
  { table: 'exposure_line', key: ['id'] },
  { table: 'session', key: ['id'] },
  { table: 'transit_observation', key: ['id'] },
  { table: 'ephemeris', key: ['id'] },
  { table: 'filter', key: ['id'] },
  { table: 'night_plan', key: ['id'] },
  { table: 'nina_instance', key: ['id'] },
  { table: 'project_panel', key: ['id'] },
  { table: 'moon_profile', key: ['id'] },
  { table: 'project', key: ['id'] },
  { table: 'app_user', key: ['id'] },
  { table: 'rig', key: ['id'] },
  { table: 'exposure_template', key: ['id'] },
  { table: 'site', key: ['id'] },
  { table: 'camera', key: ['id'] },
  { table: 'telescope', key: ['id'] },
];

/** Selbstbezüge (nullable), die vor dem stapelweisen Löschen geleert werden. */
export const SELF_REFERENCES: readonly { table: string; column: string }[] = [
  { table: 'app_user', column: 'invited_by' },
  { table: 'transit_observation', column: 'primary_observation_id' },
];

export const TENANT_DELETE_BATCH = 1000;

async function inBatches(run: () => Promise<number>, batch: number): Promise<number> {
  let total = 0;
  for (;;) {
    const n = await run();
    total += n;
    if (n < batch) return total;
  }
}

/** Löscht alle Mandantendaten außer der `tenant`-Zeile; liefert die Zeilenzahl je Tabelle. */
export async function deleteTenantData(
  db: Kysely<Database>,
  tenant: { id: string; tenantKey: string },
  opts: WithTxOptions & { batch?: number } = {},
): Promise<Record<string, number>> {
  const batch = opts.batch ?? TENANT_DELETE_BATCH;
  const counts: Record<string, number> = {};
  const tx = (fn: (trx: Transaction<Database>) => Promise<number>) => withTx(db, fn, opts);

  for (const { table, column } of SELF_REFERENCES) {
    await inBatches(
      () =>
        tx(async (trx) => {
          const res = await sql`
            UPDATE ${sql.table(table)} SET ${sql.ref(column)} = NULL
            WHERE id IN (SELECT id FROM ${sql.table(table)}
                         WHERE tenant_id = ${tenant.id} AND ${sql.ref(column)} IS NOT NULL LIMIT ${batch})`.execute(
            trx,
          );
          return Number(res.numAffectedRows ?? 0);
        }),
      batch,
    );
  }

  // System-Audit bleibt, verliert aber den Fremdschlüssel (Mandanten-ID in details).
  await inBatches(
    () =>
      tx(async (trx) => {
        const res = await sql`
          UPDATE system_audit
          SET tenant_id = NULL,
              details = details || jsonb_build_object('tenantId', ${tenant.id}::text, 'tenantKey', ${tenant.tenantKey}::text)
          WHERE id IN (SELECT id FROM system_audit WHERE tenant_id = ${tenant.id} LIMIT ${batch})`.execute(
          trx,
        );
        return Number(res.numAffectedRows ?? 0);
      }),
    batch,
  );

  for (const { table, key } of TENANT_DELETE_ORDER) {
    const cols = sql.join(key.map((k) => sql.ref(k)));
    counts[table] = await inBatches(
      () =>
        tx(async (trx) => {
          const res = await sql`
            DELETE FROM ${sql.table(table)}
            WHERE (${cols}) IN (SELECT ${cols} FROM ${sql.table(table)} WHERE tenant_id = ${tenant.id} LIMIT ${batch})`.execute(
            trx,
          );
          return Number(res.numAffectedRows ?? 0);
        }),
      batch,
    );
  }
  return counts;
}
