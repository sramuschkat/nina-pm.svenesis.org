/**
 * Job `catalog_refresh` (AP-20, TK 13 „manuell“, S-82): importiert den mit `pnpm catalog:build` erzeugten
 * Objektkatalog (`packages/catalog-data/openngc/dso-objects.json`) nach `dso_object` – Upsert über
 * `primary_id`, `id` bleibt (T-KAT-11). Zeilen früherer Stände bleiben stehen und werden gemeldet.
 * Der lokale Stack ruft `importCatalog` beim Start auf, solange `dso_object` leer ist.
 */
import { upsertDsoCatalog, type DsoCatalogRow, type OpenDatabase } from '@nina-pm/db';
import catalog from '@nina-pm/catalog-data/openngc/dso-objects.json' with { type: 'json' };
import { logger } from '../lib/logger';
import type { JobHandler } from './jobs';

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

export function catalogRefreshHandler(
  deps: { readonly db: () => Promise<OpenDatabase['db']> },
  file: CatalogFile = CATALOG_FILE,
): JobHandler {
  return async (ctx) => {
    await importCatalog(await deps.db(), ctx.now(), file);
    return undefined;
  };
}
