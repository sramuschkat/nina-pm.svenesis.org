/** Eingaben und Ausgaben des Katalog-Imports im Repository (`packages/catalog-data`). */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CatalogInput } from './build';

export const catalogData = fileURLToPath(
  new URL('../../../packages/catalog-data/', import.meta.url),
);
export const OUTPUT_JSON = `${catalogData}openngc/dso-objects.json`;
export const OUTPUT_REPORT = `${catalogData}openngc/import-report.md`;
export const OUTPUT_META = `${catalogData}openngc/catalog-meta.json`;
export const STAR_CATALOG_JS = `${catalogData}js/star-catalog.js`;
export const OUTPUT_SKY = `${catalogData}sky/sky.json`;

interface VersionFile {
  version: string;
  fetchedAt: string;
  files: Record<string, { sha256: string }>;
}

/** Liest die eingecheckten Quellen und prüft die Prüfsummen der OpenNGC-Dateien gegen `VERSION.json`. */
export function readCatalogInput(): CatalogInput {
  const meta = JSON.parse(
    readFileSync(`${catalogData}openngc/VERSION.json`, 'utf8'),
  ) as VersionFile;
  const read = (rel: string) => readFileSync(`${catalogData}${rel}`, 'utf8');
  for (const [name, { sha256 }] of Object.entries(meta.files)) {
    const got = createHash('sha256')
      .update(readFileSync(`${catalogData}openngc/${name}`))
      .digest('hex');
    if (got !== sha256) throw new Error(`${name}: Prüfsumme ${got} ≠ ${sha256} (VERSION.json)`);
  }
  return {
    ngcCsv: read('openngc/NGC.csv'),
    addendumCsv: read('openngc/addendum.csv'),
    extractJson: read('data/ngc.json'),
    curatedJs: read('js/dso-catalog.js'),
    version: meta.version,
    fetchedAt: meta.fetchedAt,
  };
}
