/**
 * `pnpm catalog:build` (AP-20): baut den Objektkatalog aus den eingecheckten Quellen und schreibt
 * `packages/catalog-data/openngc/dso-objects.json` (vom Job `catalog_refresh` importiert) und den
 * Importbericht, die Wikipedia-Titel `openngc/wikipedia.json`, dazu die Sterndaten der Sternkarte `sky/sky.json` (AP-21). Deterministisch – ein Test prüft, dass die eingecheckte Ausgabe dem Build entspricht.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildCatalog } from './build';
import {
  OUTPUT_JSON,
  OUTPUT_META,
  OUTPUT_REPORT,
  OUTPUT_SKY,
  OUTPUT_WIKIPEDIA,
  readCatalogInput,
  STAR_CATALOG_JS,
} from './files';
import { buildSkyData, skyJson } from './sky';
import { catalogJson, catalogMeta, importReport, wikipediaJson } from './output';

const build = buildCatalog(readCatalogInput());
writeFileSync(OUTPUT_JSON, catalogJson(build));
writeFileSync(OUTPUT_REPORT, importReport(build));
writeFileSync(OUTPUT_META, catalogMeta(build));
writeFileSync(OUTPUT_WIKIPEDIA, wikipediaJson(build));
const c = build.counts;
console.log(
  `OpenNGC ${build.version}: ${String(c.ngcCsv)} + ${String(c.addendumCsv)} Quellzeilen → ${String(c.rows)} Zeilen (${String(build.warnings.length)} Warnungen), Wikipedia-Titel für ${String(Object.keys(build.wikipedia).length)} Zeilen`,
);

// Sternkarte (AP-21): Sterne, Sternbilder, Milchstraße aus der Website-Vorlage.
const sky = buildSkyData(readFileSync(STAR_CATALOG_JS, 'utf8'));
mkdirSync(dirname(OUTPUT_SKY), { recursive: true });
writeFileSync(OUTPUT_SKY, skyJson(sky));
console.log(
  `Sternkarte: ${String(sky.stars.length)} Sterne bis 6 mag, ${String(Object.keys(sky.lines).length)} Sternbildfiguren`,
);
