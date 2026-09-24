/**
 * Speicherbedarf je Mandant (AP-07d, FA-SU-03): der `worker` misst täglich die Dateien unter
 * `tenant/<id>/` und schreibt eine Zeile je Mandant (`app_job`: SELECT, INSERT, UPDATE).
 */
import type { Kysely } from 'kysely';
import type { Database } from '../types';

/** Alle Mandanten (auch gesperrte – ihre Dateien belegen ebenfalls Speicher). */
export async function tenantIdsForStorage(db: Kysely<Database>): Promise<string[]> {
  const rows = await db.selectFrom('tenant').select('id').orderBy('id').execute();
  return rows.map((r) => r.id);
}

/** Messwert eines Mandanten speichern (idempotent, eine Zeile je Mandant). */
export async function recordTenantStorage(
  db: Kysely<Database>,
  tenantId: string,
  usage: { bytes: number; count: number },
  now: Date,
): Promise<void> {
  await db
    .insertInto('tenantStorage')
    .values({ tenantId, fileBytes: usage.bytes, fileCount: usage.count, measuredAt: now })
    .onConflict((oc) =>
      oc.column('tenantId').doUpdateSet({
        fileBytes: usage.bytes,
        fileCount: usage.count,
        measuredAt: now,
      }),
    )
    .execute();
}
