/**
 * Exoplaneten-Kataloge `exo_catalog_entry` (AP-40, FA-EXO-02…04/31, TK 13): systemweit, ohne Mandanten.
 * - `replaceExoCatalog` (Job `catalog_refresh`, Rolle `app_job`): Upsert `ON CONFLICT (catalog, planet)` in Stapeln
 *   (je Stapel eine Transaktion, ≤ 3.000 Zeilen, ADR-S1) – `id` bleibt, damit `exo_project.catalog_entry_id` hält.
 *   Danach werden Zeilen dieses Katalogs gelöscht, die der neue Stand nicht mehr liefert, außer ein
 *   Exoplaneten-Projekt verweist darauf (die bleiben mit altem `fetched_at` stehen und werden gemeldet).
 * - `exoCatalogCount`, `exoCatalogStatus`, `exoPrefilterSetting`, `readExoCatalog` (lesen): Stand für S-82, Zusammenführung (FA-EXO-03).
 */
import type { Catalog } from '@nina-pm/shared';
import { CamelCasePlugin, sql, type Kysely } from 'kysely';
import { withTx } from '../tx';
import type { Database } from '../types';

export type ExoCatalog = Exclude<Catalog, 'dso'>;

export interface ExoCatalogRow {
  readonly planet: string;
  readonly star: string;
  readonly disposition: string | null;
  readonly raDeg: number;
  readonly decDeg: number;
  readonly magVJohnson: number | null;
  readonly magRCousins: number | null;
  readonly magSdssG: number | null;
  readonly magGaiaG: number | null;
  readonly magTess: number | null;
  readonly magBandUsed: string | null;
  readonly teffK: number | null;
  readonly distancePc: number | null;
  readonly t0BjdTdb: number;
  readonly t0SigmaD: number | null;
  readonly periodD: number;
  readonly periodSigmaD: number | null;
  readonly durationH: number | null;
  readonly durationEstimated: boolean;
  readonly depthMmag: number | null;
  readonly depthRaw: number | null;
  readonly depthUnit: string | null;
  readonly depthEstimated: boolean;
  readonly rpOverRs: number | null;
  readonly aOverRs: number | null;
  readonly inclinationDeg: number | null;
  readonly planetRadiusRe: number | null;
  readonly eqTempK: number | null;
  readonly exoclockPriority: string | null;
  readonly oMinusCMin: number | null;
  readonly minApertureMm: number | null;
  readonly minApertureEstimated: boolean;
  readonly amateurReachable: boolean;
  readonly timeSystemSource: string;
  readonly timeSystemRaw: string | null;
  readonly t0Raw: number;
  readonly ticId: string | null;
}

/**
 * Drei Spalten haben zwei Großbuchstaben hintereinander im TS-Namen (`mag_v_johnson` → `magVJohnson`,
 * `mag_r_cousins`, `o_minus_c_min`). Der Standard-`CamelCasePlugin` machte daraus `mag_vjohnson`; für diese
 * Tabelle schreiben wir deshalb mit `underscoreBetweenUppercaseLetters` (die übrigen Spalten ändern sich nicht).
 */
export function exoDb(db: Kysely<Database>): Kysely<Database> {
  return db
    .withoutPlugins()
    .withPlugin(new CamelCasePlugin({ underscoreBetweenUppercaseLetters: true }));
}

/** 41 Spalten je Zeile: 200 Zeilen ≈ 8.200 Parameter, in der Größenordnung des Objektkatalogs (500 × 16). */
export const EXO_BATCH_SIZE = 200;
/** Löschen in Stapeln ≤ 2.500 Zeilen (TK 13). */
const DELETE_BATCH_SIZE = 2500;

export interface ExoReplaceResult {
  readonly written: number;
  readonly deleted: number;
  /** Nicht mehr gelieferte Planeten, auf die ein Projekt verweist – bleiben stehen. */
  readonly keptReferenced: string[];
}

export async function replaceExoCatalog(
  db: Kysely<Database>,
  catalog: ExoCatalog,
  rows: readonly ExoCatalogRow[],
  now: Date,
  batchSize = EXO_BATCH_SIZE,
): Promise<ExoReplaceResult> {
  db = exoDb(db);
  let written = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    await withTx(db, async (trx) => {
      await trx
        .insertInto('exoCatalogEntry')
        .values(batch.map((r) => ({ ...r, catalog, fetchedAt: now })))
        .onConflict((oc) =>
          oc.columns(['catalog', 'planet']).doUpdateSet((eb) => ({
            star: eb.ref('excluded.star'),
            disposition: eb.ref('excluded.disposition'),
            raDeg: eb.ref('excluded.raDeg'),
            decDeg: eb.ref('excluded.decDeg'),
            magVJohnson: eb.ref('excluded.magVJohnson'),
            magRCousins: eb.ref('excluded.magRCousins'),
            magSdssG: eb.ref('excluded.magSdssG'),
            magGaiaG: eb.ref('excluded.magGaiaG'),
            magTess: eb.ref('excluded.magTess'),
            magBandUsed: eb.ref('excluded.magBandUsed'),
            teffK: eb.ref('excluded.teffK'),
            distancePc: eb.ref('excluded.distancePc'),
            t0BjdTdb: eb.ref('excluded.t0BjdTdb'),
            t0SigmaD: eb.ref('excluded.t0SigmaD'),
            periodD: eb.ref('excluded.periodD'),
            periodSigmaD: eb.ref('excluded.periodSigmaD'),
            durationH: eb.ref('excluded.durationH'),
            durationEstimated: eb.ref('excluded.durationEstimated'),
            depthMmag: eb.ref('excluded.depthMmag'),
            depthRaw: eb.ref('excluded.depthRaw'),
            depthUnit: eb.ref('excluded.depthUnit'),
            depthEstimated: eb.ref('excluded.depthEstimated'),
            rpOverRs: eb.ref('excluded.rpOverRs'),
            aOverRs: eb.ref('excluded.aOverRs'),
            inclinationDeg: eb.ref('excluded.inclinationDeg'),
            planetRadiusRe: eb.ref('excluded.planetRadiusRe'),
            eqTempK: eb.ref('excluded.eqTempK'),
            exoclockPriority: eb.ref('excluded.exoclockPriority'),
            oMinusCMin: eb.ref('excluded.oMinusCMin'),
            minApertureMm: eb.ref('excluded.minApertureMm'),
            minApertureEstimated: eb.ref('excluded.minApertureEstimated'),
            amateurReachable: eb.ref('excluded.amateurReachable'),
            timeSystemSource: eb.ref('excluded.timeSystemSource'),
            timeSystemRaw: eb.ref('excluded.timeSystemRaw'),
            t0Raw: eb.ref('excluded.t0Raw'),
            ticId: eb.ref('excluded.ticId'),
            fetchedAt: now,
          })),
        )
        .execute();
    });
    written += batch.length;
  }

  // Nicht mehr gelieferte Zeilen: alles mit älterem `fetched_at`; Verweise aus Projekten schützen die Zeile.
  const referenced = await db
    .selectFrom('exoProject')
    .innerJoin('exoCatalogEntry', 'exoCatalogEntry.id', 'exoProject.catalogEntryId')
    .select(['exoCatalogEntry.id', 'exoCatalogEntry.planet'])
    .where('exoCatalogEntry.catalog', '=', catalog)
    .where('exoCatalogEntry.fetchedAt', '<', now)
    .execute();
  const keep = new Set(referenced.map((r) => r.id));
  let deleted = 0;
  for (;;) {
    const stale = await db
      .selectFrom('exoCatalogEntry')
      .select('id')
      .where('catalog', '=', catalog)
      .where('fetchedAt', '<', now)
      .orderBy('id')
      .execute();
    const ids = stale.map((r) => r.id).filter((id) => !keep.has(id));
    if (ids.length === 0) break;
    const chunk = ids.slice(0, DELETE_BATCH_SIZE);
    await withTx(db, async (trx) => {
      await trx.deleteFrom('exoCatalogEntry').where('id', 'in', chunk).execute();
    });
    deleted += chunk.length;
    if (ids.length <= DELETE_BATCH_SIZE) break;
  }
  return { written, deleted, keptReferenced: [...new Set(referenced.map((r) => r.planet))].sort() };
}

/** Zeilen je Katalog (Schutz vor abgeschnittenen Antworten vor dem Ersetzen). */
export async function exoCatalogCount(db: Kysely<Database>, catalog: ExoCatalog): Promise<number> {
  const r = await db
    .selectFrom('exoCatalogEntry')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('catalog', '=', catalog)
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

export interface ExoCatalogStatus {
  readonly catalog: ExoCatalog;
  readonly rows: number;
  readonly unknownTimeSystem: number;
  readonly lastImportAt: Date | null;
  readonly lastJob: {
    readonly id: string;
    readonly status: string;
    readonly error: string | null;
    readonly createdAt: Date;
    readonly finishedAt: Date | null;
  } | null;
}

export const EXO_CATALOGS: readonly ExoCatalog[] = ['exoclock', 'nasa', 'toi'];

/** Stand je Exoplaneten-Katalog für S-82: Zeilen, davon mit unsicherem Zeitsystem, letzter Import, letzter Job. */
export async function exoCatalogStatus(db: Kysely<Database>): Promise<ExoCatalogStatus[]> {
  const agg = await db
    .selectFrom('exoCatalogEntry')
    .select((eb) => [
      'catalog',
      eb.fn.countAll<number>().as('n'),
      sql<number>`count(*) filter (where time_system_source = 'unknown')`.as('unknown'),
      eb.fn.max('fetchedAt').as('last'),
    ])
    .groupBy('catalog')
    .execute();
  const out: ExoCatalogStatus[] = [];
  for (const catalog of EXO_CATALOGS) {
    const a = agg.find((r) => r.catalog === catalog);
    const job = await db
      .selectFrom('job')
      .select(['id', 'status', 'error', 'createdAt', 'finishedAt'])
      .where('kind', '=', 'catalog_refresh')
      .where('tenantId', 'is', null)
      .where('dedupeKey', '=', exoCatalogDedupeKey(catalog))
      .orderBy('createdAt', 'desc')
      .limit(1)
      .executeTakeFirst();
    out.push({
      catalog,
      rows: Number(a?.n ?? 0),
      unknownTimeSystem: Number(a?.unknown ?? 0),
      lastImportAt: a?.last ? new Date(a.last as unknown as string) : null,
      lastJob: job
        ? {
            id: job.id,
            status: job.status,
            error: job.error,
            createdAt: new Date(job.createdAt),
            finishedAt: job.finishedAt ? new Date(job.finishedAt) : null,
          }
        : null,
    });
  }
  return out;
}

/** Deduplizierung des Jobs `catalog_refresh` je Katalog (manuell und aus den Zeitplänen). */
export function exoCatalogDedupeKey(catalog: ExoCatalog): string {
  return `catalog_refresh:${catalog}`;
}

/** Alle Zeilen eines oder mehrerer Kataloge (für Zusammenführung und Transitsuche, AP-41/42). */
export async function readExoCatalog(
  db: Kysely<Database>,
  catalogs: readonly ExoCatalog[] = EXO_CATALOGS,
): Promise<(ExoCatalogRow & { id: string; catalog: ExoCatalog; fetchedAt: Date })[]> {
  const rows = await db
    .selectFrom('exoCatalogEntry')
    .selectAll()
    .where('catalog', 'in', [...catalogs])
    .orderBy('catalog')
    .orderBy('planet')
    .execute();
  return rows.map((r) => ({
    ...r,
    catalog: r.catalog,
    raDeg: Number(r.raDeg),
    decDeg: Number(r.decDeg),
    t0BjdTdb: Number(r.t0BjdTdb),
    periodD: Number(r.periodD),
    durationEstimated: r.durationEstimated,
    depthEstimated: r.depthEstimated === true,
    minApertureEstimated: r.minApertureEstimated,
    amateurReachable: r.amateurReachable,
    timeSystemSource: r.timeSystemSource ?? 'bjd_tdb',
    t0Raw: r.t0Raw === null ? Number(r.t0BjdTdb) : Number(r.t0Raw),
    fetchedAt: new Date(r.fetchedAt),
  }));
}

/** Gespeicherter Amateur-Vorfilter (`system_setting.exoPrefilter`, FA-EXO-31) oder `null`; Prüfung im Job. */
export async function exoPrefilterSetting(db: Kysely<Database>): Promise<unknown> {
  const row = await db
    .selectFrom('systemSetting')
    .select('value')
    .where('key', '=', 'exoPrefilter')
    .executeTakeFirst();
  return row?.value ?? null;
}

/** Eigene Exoplaneten-Projekte je Planet (Spalte „Meine Beob.“ in S-22); mandanten- und benutzergebunden. */
export async function myExoProjectCounts(
  db: Kysely<Database>,
  tenantId: string,
  userId: string,
): Promise<Map<string, number>> {
  const rows = await db
    .selectFrom('exoProject')
    .innerJoin('project', 'project.id', 'exoProject.projectId')
    .select(['exoProject.planet', (eb) => eb.fn.countAll<number>().as('n')])
    .where('exoProject.tenantId', '=', tenantId)
    .where('project.tenantId', '=', tenantId)
    .where('project.createdBy', '=', userId)
    .where('project.deletedAt', 'is', null)
    .groupBy('exoProject.planet')
    .execute();
  return new Map(rows.map((r) => [r.planet, Number(r.n)]));
}
