/**
 * Einmaliger Generator: teilt docs/concept/schema_aurora_dsql.sql in die Migrationen 0001–0005 auf
 * (je Abschnitt A–E des Schemas), eine Anweisung je `-- statement`, und hängt an jede Tabelle ihre
 * GRANTs aus src/grants.ts. Danach sind die Migrationen die Quelle der Wahrheit (TK 6); neue
 * Änderungen kommen als neue, nur additive Migrationen.
 *
 * Aufruf: pnpm --filter @nina-pm/db exec tsx scripts/generate-migrations.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { grantStatements, TABLE_GRANTS } from '../src/grants';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const schema = readFileSync(`${root}docs/concept/schema_aurora_dsql.sql`, 'utf8').split('\n');

const SECTIONS: { marker: RegExp; file: string; title: string }[] = [
  { marker: /^-- A\. /, file: '0001_system.sql', title: 'A. System (mandantenübergreifend)' },
  {
    marker: /^-- B\. /,
    file: '0002_mandant_benutzer.sql',
    title: 'B. Mandant, Benutzer, Berechtigung',
  },
  { marker: /^-- C\. /, file: '0003_ausruestung.sql', title: 'C. Ausrüstung' },
  {
    marker: /^-- D\. /,
    file: '0004_projekte_exoplaneten.sql',
    title: 'D. Projekte, Freigabe, Exoplaneten',
  },
  {
    marker: /^-- E\. /,
    file: '0005_ausfuehrung.sql',
    title: 'E. Ausführung, Aufnahmen, Auswertung',
  },
];

const starts = SECTIONS.map((s) => {
  const i = schema.findIndex((l) => s.marker.test(l));
  if (i < 0) throw new Error(`Abschnitt ${s.title} nicht gefunden`);
  return i;
});
const tailStart = schema.findIndex((l) => l.startsWith('-- Nicht übernommene Astro-PM-Tabellen'));

// Indizes gehören über `ON <tabelle>` zu ihrer Tabelle, egal wo sie im Schema stehen.
const indexesByTable = new Map<string, string[]>();
for (const line of schema) {
  const m = /^CREATE (?:UNIQUE )?INDEX ASYNC \w+ ON (\w+)/.exec(line);
  if (!m?.[1]) continue;
  indexesByTable.set(m[1], [...(indexesByTable.get(m[1]) ?? []), line.trim()]);
}
if (schema.some((l) => /^CREATE (UNIQUE )?INDEX /.test(l) && !/ ASYNC /.test(l))) {
  throw new Error('Index ohne ASYNC im Schema');
}

const seen = new Set<string>();
SECTIONS.forEach((section, k) => {
  const from = starts[k] ?? 0;
  const to =
    k + 1 < starts.length
      ? (starts[k + 1] ?? schema.length)
      : tailStart > 0
        ? tailStart - 1
        : schema.length;
  const lines = schema.slice(from, to);
  const statements: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const table = /^CREATE TABLE (\w+) /.exec(line)?.[1];
    if (!table) {
      if (/^CREATE /.test(line) && !/^CREATE (UNIQUE )?INDEX ASYNC /.test(line)) {
        throw new Error(`Unerwartete Anweisung im Schema: ${line}`);
      }
      continue;
    }
    const block = [line];
    while (!(lines[i] ?? '').startsWith(');')) {
      i += 1;
      block.push(lines[i] ?? '');
    }
    statements.push(block.join('\n'));
    seen.add(table);
    statements.push(...(indexesByTable.get(table) ?? []));
    statements.push(...grantStatements(table).filter((st) => !st.startsWith('--')));
  }
  const header = [
    `-- Migration ${section.file.slice(0, 4)} – ${section.title}`,
    '-- Erzeugt aus docs/concept/schema_aurora_dsql.sql v1.19 (scripts/generate-migrations.ts, AP-03).',
    '-- Eine Anweisung je Abschnitt, jede in eigener Transaktion (DSQL: eine DDL je Transaktion).',
    '-- GRANTs je Tabelle für app_rw und app_job nach TK 6.2 (src/grants.ts).',
    '',
  ].join('\n');
  writeFileSync(
    fileURLToPath(new URL(`../migrations/${section.file}`, import.meta.url)),
    `${header}${statements.map((st) => `-- statement\n${st}\n`).join('\n')}`,
  );
  console.log(`${section.file}: ${statements.length} Anweisungen`);
});

const indexed = [...indexesByTable.values()].flat().length;
const emitted = [...seen].reduce((n, t) => n + (indexesByTable.get(t)?.length ?? 0), 0);
if (indexed !== emitted)
  throw new Error(`${indexed - emitted} Indizes ohne Tabelle in den Abschnitten`);
const missing = Object.keys(TABLE_GRANTS).filter((t) => !seen.has(t));
const unmapped = [...seen].filter((t) => !(t in TABLE_GRANTS));
if (missing.length || unmapped.length) {
  throw new Error(
    `Zuordnung passt nicht: ohne Tabelle ${missing.join(', ')}; ohne Zuordnung ${unmapped.join(', ')}`,
  );
}
console.log(`${seen.size} Tabellen, alle mit GRANTs.`);
