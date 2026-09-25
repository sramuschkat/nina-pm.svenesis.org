/**
 * `pnpm catalog:build` (AP-20): baut den Objektkatalog aus den eingecheckten Quellen und schreibt
 * `packages/catalog-data/openngc/dso-objects.json` (vom Job `catalog_refresh` importiert) und den
 * Importbericht. Deterministisch – ein Test prüft, dass die eingecheckte Ausgabe dem Build entspricht.
 */
import { writeFileSync } from 'node:fs';
import { buildCatalog } from './build';
import { OUTPUT_JSON, OUTPUT_META, OUTPUT_REPORT, readCatalogInput } from './files';
import { catalogJson, catalogMeta, importReport } from './output';

const build = buildCatalog(readCatalogInput());
writeFileSync(OUTPUT_JSON, catalogJson(build));
writeFileSync(OUTPUT_REPORT, importReport(build));
writeFileSync(OUTPUT_META, catalogMeta(build));
const c = build.counts;
console.log(
  `OpenNGC ${build.version}: ${String(c.ngcCsv)} + ${String(c.addendumCsv)} Quellzeilen → ${String(c.rows)} Zeilen (${String(build.warnings.length)} Warnungen)`,
);
