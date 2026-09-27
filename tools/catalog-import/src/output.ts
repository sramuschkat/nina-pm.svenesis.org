/** Serialisierung des Importergebnisses: JSON zeilenweise (diffbar) und Importbericht (Markdown). */
import type { CatalogBuild } from './build';

export function catalogJson(b: CatalogBuild): string {
  const head = {
    version: b.version,
    fetchedAt: b.fetchedAt,
    counts: b.counts,
    nonexistent: b.nonexistent,
  };
  return `${JSON.stringify(head).slice(0, -1)},"rows":[\n${b.rows.map((r) => JSON.stringify(r)).join(',\n')}\n]}\n`;
}

export function importReport(b: CatalogBuild): string {
  const c = b.counts;
  return [
    `# Importbericht Objektkatalog (OpenNGC ${b.version}, abgerufen ${b.fetchedAt})`,
    '',
    'Erzeugt von `pnpm catalog:build` nach `docs/specs/catalog/dso-import.md` – nicht von Hand ändern.',
    '',
    '| Größe | Wert |',
    '|---|---|',
    `| Zeilen \`NGC.csv\` | ${String(c.ngcCsv)} |`,
    `| Zeilen \`addendum.csv\` (\`n_addendum\`) | ${String(c.addendumCsv)} |`,
    `| Quellzeilen zusammen | ${String(c.ngcCsv)} + ${String(c.addendumCsv)} = ${String(c.ngcCsv + c.addendumCsv)} |`,
    `| davon \`Dup\` (Alias statt Zeile) | ${String(c.dup)} |`,
    `| davon \`NonEx\` (Liste \`nonexistent\`) | ${String(c.nonEx)} |`,
    `| zusammengeführt (dasselbe Himmelsobjekt) | ${String(c.merged)} |`,
    `| Sharpless-Regionen aus dem Auszug (ohne OpenNGC-Zeile) | ${String(c.sharpless)} |`,
    `| **Zeilen in \`dso_object\`** | **${String(c.rows)}** |`,
    '',
    '## Zusammengeführt',
    '',
    ...b.merged.map((m) => `- ${m.from} → ${m.into} (${m.reason})`),
    '',
    '## Nicht existent (OpenNGC `NonEx`)',
    '',
    b.nonexistent.join(', '),
    '',
    `## Importwarnungen (${String(b.warnings.length)})`,
    '',
    ...b.warnings.map((w) => `- ${w}`),
    '',
  ].join('\n');
}

/** Kleine Kennzahlen für die `api` (S-82), ohne die Zeilen. */
/**
 * Wikipedia-Titel je `primary_id` (`openngc/wikipedia.json`, eine Zeile je Objekt): die Oberfläche lädt die
 * Datei als eigenen Teil nach und baut daraus den Wikipedia-Link (`wikipediaLink`, FA-FRM-14).
 */
export function wikipediaJson(b: CatalogBuild): string {
  const lines = Object.entries(b.wikipedia).map(
    ([id, w]) => `${JSON.stringify(id)}:${JSON.stringify(w)}`,
  );
  return `{\n${lines.join(',\n')}\n}\n`;
}

export function catalogMeta(b: CatalogBuild): string {
  return `${JSON.stringify(
    {
      version: b.version,
      fetchedAt: b.fetchedAt,
      counts: b.counts,
      warnings: b.warnings.length,
      nonexistent: b.nonexistent.length,
    },
    null,
    2,
  )}\n`;
}
