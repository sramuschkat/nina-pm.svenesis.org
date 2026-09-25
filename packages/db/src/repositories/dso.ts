/**
 * Objektkatalog `dso_object` (AP-20, specs/catalog/dso-import.md, TK 13): systemweit, ohne Mandanten.
 * - `upsertDsoCatalog` (Job `catalog_refresh`, Rolle `app_job`): Upsert `ON CONFLICT (primary_id)` in
 *   Stapeln – `id` bleibt, damit kein Fremdschlüssel bricht (T-KAT-11); je Stapel eine Transaktion
 *   (≤ 3.000 Zeilen, ADR-S1).
 * - `readDsoCatalog`/`dsoCatalogStatus` (Rolle `app_rw`, nur lesen): Suche im Speicher der `api`, S-82.
 * - `enqueueSystemJob`: Job ohne Mandanten (`tenant_id = null`, Kataloge), Deduplizierung wie 7.4.
 */
import type { JobKind } from '@nina-pm/shared';
import { sql, type Kysely } from 'kysely';
import { withTx } from '../tx';
import type { Database } from '../types';

export interface DsoCatalogRow {
  readonly primaryId: string;
  readonly names: readonly string[];
  readonly catalogs: readonly string[];
  readonly objectType: string;
  readonly constellation: string | null;
  readonly raDeg: number;
  readonly decDeg: number;
  readonly magV: number | null;
  readonly magB: number | null;
  readonly magBandUsed: 'V' | 'B' | null;
  readonly surfBrMagArcsec2: number | null;
  readonly sizeMajorArcmin: number | null;
  readonly sizeMinorArcmin: number | null;
  readonly positionAngleDeg: number | null;
  readonly source: string;
}

export const DSO_BATCH_SIZE = 500;

/** Upsert aller Zeilen; liefert die Zahl geschriebener Zeilen und die nicht mehr gelieferten `primary_id`. */
export async function upsertDsoCatalog(
  db: Kysely<Database>,
  rows: readonly DsoCatalogRow[],
  now: Date,
  batchSize = DSO_BATCH_SIZE,
): Promise<{ written: number; stale: string[] }> {
  let written = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    await withTx(db, async (trx) => {
      await trx
        .insertInto('dsoObject')
        .values(
          batch.map((r) => ({
            primaryId: r.primaryId,
            names: JSON.stringify(r.names),
            catalogs: JSON.stringify(r.catalogs),
            objectType: r.objectType,
            constellation: r.constellation,
            raDeg: r.raDeg,
            decDeg: r.decDeg,
            magV: r.magV,
            magB: r.magB,
            magBandUsed: r.magBandUsed,
            surfBrMagArcsec2: r.surfBrMagArcsec2,
            sizeMajorArcmin: r.sizeMajorArcmin,
            sizeMinorArcmin: r.sizeMinorArcmin,
            positionAngleDeg: r.positionAngleDeg,
            source: r.source,
            updatedAt: now,
          })),
        )
        .onConflict((oc) =>
          oc.column('primaryId').doUpdateSet((eb) => ({
            names: eb.ref('excluded.names'),
            catalogs: eb.ref('excluded.catalogs'),
            objectType: eb.ref('excluded.objectType'),
            constellation: eb.ref('excluded.constellation'),
            raDeg: eb.ref('excluded.raDeg'),
            decDeg: eb.ref('excluded.decDeg'),
            magV: eb.ref('excluded.magV'),
            magB: eb.ref('excluded.magB'),
            magBandUsed: eb.ref('excluded.magBandUsed'),
            surfBrMagArcsec2: eb.ref('excluded.surfBrMagArcsec2'),
            sizeMajorArcmin: eb.ref('excluded.sizeMajorArcmin'),
            sizeMinorArcmin: eb.ref('excluded.sizeMinorArcmin'),
            positionAngleDeg: eb.ref('excluded.positionAngleDeg'),
            source: eb.ref('excluded.source'),
            updatedAt: now,
          })),
        )
        .execute();
    });
    written += batch.length;
  }
  // Zeilen früherer Katalogstände bleiben (Fremdschlüssel von Projekten/Panels), werden aber gemeldet.
  const wanted = new Set(rows.map((r) => r.primaryId));
  const existing = await db.selectFrom('dsoObject').select('primaryId').execute();
  return { written, stale: existing.map((r) => r.primaryId).filter((id) => !wanted.has(id)) };
}

const parseList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? (JSON.parse(v) as unknown[]) : []).map(String);

/** Ganzer Katalog (≈ 13.600 Zeilen) für die Suche im Speicher der `api`. */
export async function readDsoCatalog(
  db: Kysely<Database>,
): Promise<(DsoCatalogRow & { id: string })[]> {
  const rows = await db.selectFrom('dsoObject').selectAll().orderBy('primaryId').execute();
  return rows.map((r) => ({
    id: r.id,
    primaryId: r.primaryId,
    names: parseList(r.names),
    catalogs: parseList(r.catalogs),
    objectType: r.objectType,
    constellation: r.constellation,
    raDeg: Number(r.raDeg),
    decDeg: Number(r.decDeg),
    magV: r.magV === null ? null : Number(r.magV),
    magB: r.magB === null ? null : Number(r.magB),
    magBandUsed: (r.magBandUsed as 'V' | 'B' | null) ?? null,
    surfBrMagArcsec2: r.surfBrMagArcsec2 === null ? null : Number(r.surfBrMagArcsec2),
    sizeMajorArcmin: r.sizeMajorArcmin === null ? null : Number(r.sizeMajorArcmin),
    sizeMinorArcmin: r.sizeMinorArcmin === null ? null : Number(r.sizeMinorArcmin),
    positionAngleDeg: r.positionAngleDeg === null ? null : Number(r.positionAngleDeg),
    source: r.source,
  }));
}

export interface DsoCatalogStatus {
  readonly rows: number;
  readonly lastImportAt: Date | null;
  readonly sources: string[];
  readonly lastJob: {
    readonly id: string;
    readonly status: string;
    readonly error: string | null;
    readonly createdAt: Date;
    readonly finishedAt: Date | null;
  } | null;
}

/** Stand des Katalogs für S-82: Zeilen, letzter Import, Quellen, letzter Job `catalog_refresh`. */
export async function dsoCatalogStatus(db: Kysely<Database>): Promise<DsoCatalogStatus> {
  const agg = await db
    .selectFrom('dsoObject')
    .select((eb) => [eb.fn.countAll<number>().as('n'), eb.fn.max('updatedAt').as('last')])
    .executeTakeFirstOrThrow();
  const sources = await db
    .selectFrom('dsoObject')
    .select(sql<string>`split_part(source, ' (', 1)`.as('s'))
    .groupBy(sql`split_part(source, ' (', 1)`)
    .execute();
  const job = await db
    .selectFrom('job')
    .select(['id', 'status', 'error', 'createdAt', 'finishedAt'])
    .where('kind', '=', 'catalog_refresh')
    .where('tenantId', 'is', null)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .executeTakeFirst();
  return {
    rows: Number(agg.n),
    lastImportAt: agg.last ? new Date(agg.last as unknown as string) : null,
    sources: sources.map((s) => s.s).sort(),
    lastJob: job
      ? {
          id: job.id,
          status: job.status,
          error: job.error,
          createdAt: new Date(job.createdAt),
          finishedAt: job.finishedAt ? new Date(job.finishedAt) : null,
        }
      : null,
  };
}

/** Job ohne Mandanten (Kataloge, Wetter); ist einer mit gleichem `dedupeKey` offen, entsteht keiner. */
export async function enqueueSystemJob(
  db: Kysely<Database>,
  job: {
    kind: JobKind;
    dedupeKey: string;
    input?: Record<string, unknown>;
    createdBy?: string | null;
  },
): Promise<{ jobId: string; created: boolean }> {
  return withTx(db, async (trx) => {
    const open = await trx
      .selectFrom('job')
      .select('id')
      .where('dedupeActive', '=', job.dedupeKey)
      .where('tenantId', 'is', null)
      .executeTakeFirst();
    if (open) return { jobId: open.id, created: false };
    const row = await trx
      .insertInto('job')
      .values({
        tenantId: null,
        kind: job.kind,
        dedupeKey: job.dedupeKey,
        dedupeActive: job.dedupeKey,
        input: JSON.stringify(job.input ?? {}),
        createdBy: job.createdBy ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { jobId: row.id, created: true };
  });
}
