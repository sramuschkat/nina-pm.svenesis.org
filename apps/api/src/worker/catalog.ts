/**
 * Job `catalog_refresh` (AP-20, AP-40; TK 13, S-82). `input.catalog` wählt den Katalog:
 * - `dso` (oder leer, Jobs vor AP-40): importiert den mit `pnpm catalog:build` erzeugten Objektkatalog
 *   (`packages/catalog-data/openngc/dso-objects.json`) nach `dso_object` – Upsert über `primary_id`, `id` bleibt
 *   (T-KAT-11). Zeilen früherer Stände bleiben stehen und werden gemeldet. Der lokale Stack ruft `importCatalog`
 *   beim Start auf, solange `dso_object` leer ist.
 * - `exoclock`/`nasa`/`toi`: holt den Exoplaneten-Katalog von der Quelle (`exo/job.ts`), `daily` bzw. `weekly`
 *   über `exoCatalogTick`, manuell über `POST /system/v1/catalogs/{catalog}/refresh`.
 */
import {
  exoCatalogCount,
  exoPrefilterSetting,
  replaceExoCatalog,
  upsertDsoCatalog,
  type DsoCatalogRow,
  type ExoCatalog,
  type OpenDatabase,
} from '@nina-pm/db';
import { catalogs, type Catalog } from '@nina-pm/shared';
import catalog from '@nina-pm/catalog-data/openngc/dso-objects.json' with { type: 'json' };
import { importExoCatalog, type ExoImportDeps } from '../exo/job';
export { enqueueExoCatalog } from '../exo/job';
import { logger } from '../lib/logger';
import { runJob, type JobHandler, type JobRunnerDeps } from './jobs';

export interface CatalogFile {
  readonly version: string;
  readonly counts: { readonly rows: number };
  readonly rows: readonly DsoCatalogRow[];
}

export const CATALOG_FILE = catalog as unknown as CatalogFile;

export async function importCatalog(
  db: OpenDatabase['db'],
  now: Date,
  file: CatalogFile = CATALOG_FILE,
): Promise<void> {
  if (file.rows.length !== file.counts.rows)
    throw new Error(
      `Katalogdatei unvollständig: ${String(file.rows.length)} ≠ ${String(file.counts.rows)}`,
    );
  // Doppelte primary_id → Abbruch vor dem ersten Schreiben (T-KAT-11).
  const seen = new Set<string>();
  for (const row of file.rows) {
    if (seen.has(row.primaryId)) throw new Error(`Doppelte primary_id ${row.primaryId}`);
    seen.add(row.primaryId);
  }
  const r = await upsertDsoCatalog(db, file.rows, now);
  logger.info('catalog_refresh', {
    version: file.version,
    written: r.written,
    stale: r.stale.length,
    staleSample: r.stale.slice(0, 20),
  });
}

/** Katalog aus der Job-Eingabe; ohne Angabe der Objektkatalog (Jobs vor AP-40). */
export function catalogOfInput(input: unknown): Catalog {
  const raw: unknown = typeof input === 'string' ? JSON.parse(input) : input;
  const value =
    raw !== null && typeof raw === 'object' ? (raw as { catalog?: unknown }).catalog : undefined;
  if (value === undefined) return 'dso';
  if (typeof value === 'string' && (catalogs as readonly string[]).includes(value))
    return value as Catalog;
  throw new Error(`Unbekannter Katalog ${String(value)}`);
}

export interface CatalogRefreshDeps {
  readonly db: () => Promise<OpenDatabase['db']>;
  /** Text einer HTTPS-Antwort mit Zeitlimit (gemeinsamer `httpClient`, TK 14). */
  readonly fetchText?: (url: string, timeoutMs: number) => Promise<string>;
}

export function exoImportDeps(
  db: OpenDatabase['db'],
  fetchText: (url: string, timeoutMs: number) => Promise<string>,
): ExoImportDeps {
  return {
    fetchText,
    prefilter: () => exoPrefilterSetting(db),
    count: (c) => exoCatalogCount(db, c),
    replace: (c, rows, now) => replaceExoCatalog(db, c, rows, now),
  };
}

export function catalogRefreshHandler(
  deps: CatalogRefreshDeps,
  file: CatalogFile = CATALOG_FILE,
): JobHandler {
  return async (ctx) => {
    const which = catalogOfInput(ctx.job.input);
    const db = await deps.db();
    if (which === 'dso') {
      await importCatalog(db, ctx.now(), file);
      return undefined;
    }
    if (!deps.fetchText) throw new Error('Kein HTTP-Client für die Exoplaneten-Kataloge');
    await importExoCatalog(exoImportDeps(db, deps.fetchText), which, ctx.now());
    return undefined;
  };
}

/**
 * Zeitplan-Aufgabe (TK 13): je Katalog einen Job `catalog_refresh` anlegen und gleich ausführen – `daily`
 * ExoClock, `weekly` NASA und TOI. Läuft schon einer (gleicher `dedupeKey`), entsteht keiner. Ein Fehler bei
 * einem Katalog hält die übrigen nicht auf; der gespeicherte Stand bleibt (FA-EXO-04).
 */
export async function exoCatalogTick(
  deps: {
    readonly enqueue: (
      catalog: ExoCatalog,
    ) => Promise<{ readonly jobId: string; readonly created: boolean }>;
  },
  jobs: JobRunnerDeps,
  which: readonly ExoCatalog[],
): Promise<number> {
  let runs = 0;
  for (const c of which) {
    const job = await deps.enqueue(c);
    if (!job.created) continue;
    const outcome = await runJob(jobs, job.jobId);
    if (outcome === 'done') runs += 1;
  }
  return runs;
}
