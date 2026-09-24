/**
 * Changelog aus Einzeldateien (`docs/changelog.d/*.md`) – vermeidet Konflikte, wenn mehrere PRs
 * gleichzeitig offen sind. `pnpm changelog:collect` übernimmt alle Einträge (neueste zuerst) unter
 * „## [Unveröffentlicht]“ in `docs/CHANGELOG.md` und löscht die Dateien. Aufruf vor einem Release
 * bzw. gesammelt in einem PR.
 */
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HEADING = '## [Unveröffentlicht]';

/** Fügt die Einträge (bereits in Zielreihenfolge) direkt unter der Überschrift ein. */
export function mergeFragments(changelog: string, fragments: readonly string[]): string {
  const at = changelog.indexOf(HEADING);
  if (at < 0) throw new Error(`Überschrift „${HEADING}“ fehlt im Changelog`);
  if (fragments.length === 0) return changelog;
  const head = changelog.slice(0, at + HEADING.length);
  const rest = changelog.slice(at + HEADING.length).replace(/^\n+/, '');
  const body = fragments.map((f) => f.trim()).join('\n\n');
  return `${head}\n\n${body}\n\n${rest}`;
}

/** Dateinamen `YYYY-MM-DD-<slug>.md`, neueste zuerst; `README.md` bleibt. */
export function fragmentFiles(names: readonly string[]): string[] {
  return names
    .filter((n) => n.endsWith('.md') && n !== 'README.md')
    .sort()
    .reverse();
}

function main(): void {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const dir = `${root}docs/changelog.d/`;
  const files = fragmentFiles(readdirSync(dir));
  const changelogPath = `${root}docs/CHANGELOG.md`;
  const next = mergeFragments(
    readFileSync(changelogPath, 'utf8'),
    files.map((f) => readFileSync(`${dir}${f}`, 'utf8')),
  );
  writeFileSync(changelogPath, next);
  for (const f of files) unlinkSync(`${dir}${f}`);
  console.log(`${String(files.length)} Einträge übernommen.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
