/**
 * `pnpm oracle:run [<grid.json|ordner>...] [--random <n>] [--seed <s>] [--repeat <k>] [--out <ordner>]`
 * (AP-13a, allocation.md §11.2).
 *
 * 1. Grids sammeln: angegebene Dateien/Ordner (Soll-Pläne als Kompatibilitäts-Kopie unter
 *    `<out>/compat/`), dazu `--random n` Zufallsgrids (Seeds s … s+n−1, Kompatibilitätsmodus) unter
 *    `<out>/grids/`. Jedes Grid wird gegen Schema und `checkGrid` geprüft.
 * 2. Originalquellen laden und patchen (`fetch.ts`), Orakel mit `dotnet build` übersetzen.
 * 3. Orakel `k`-mal rechnen (`<out>/run-1` …) und byte-genau vergleichen (Determinismus).
 * 4. Bericht `<out>/report.md` (Artefakt in `oracle.yml`); Exit 1 bei ungültigen Grids, Orakelfehlern
 *    oder Abweichungen zwischen den Läufen.
 * Ohne .NET 8 bricht der Lauf mit Hinweis ab – das Orakel läuft dann nur im CI (CLAUDE.md).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { randomGrid, type GridInput } from '@nina-pm/engine';
import { fetchSources, loadPin, ORACLE_DIR } from './fetch';
import { compatCopy, gridFiles, gridOf, validateFiles } from './grids';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    random: { type: 'string', default: '0' },
    seed: { type: 'string', default: '1' },
    repeat: { type: 'string', default: '1' },
    out: { type: 'string', default: join(ORACLE_DIR, 'out') },
    'no-build': { type: 'boolean', default: false },
  },
});

const out = resolve(values.out);
const count = Number(values.random);
const firstSeed = Number(values.seed);
const repeat = Math.max(1, Number(values.repeat));

function hasDotnet(): boolean {
  return spawnSync('dotnet', ['--version'], { stdio: 'ignore' }).status === 0;
}

function writeRandomGrids(): string | null {
  if (count <= 0) return null;
  const dir = join(out, 'grids');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (let seed = firstSeed; seed < firstSeed + count; seed++)
    writeFileSync(
      join(dir, `random-${String(seed).padStart(4, '0')}.json`),
      `${JSON.stringify(randomGrid(seed), null, 2)}\n`,
    );
  return dir;
}

/** Produktive Grids (Soll-Pläne) als Kompatibilitäts-Kopie unter `<out>/compat/` rechnen. */
function compatInputs(files: readonly string[]): string[] {
  const dir = join(out, 'compat');
  rmSync(dir, { recursive: true, force: true });
  return files.map((file) => {
    const grid = gridOf(JSON.parse(readFileSync(file, 'utf8'))) as GridInput;
    if (grid.mode === 'compat') return file;
    mkdirSync(dir, { recursive: true });
    const copy = join(dir, basename(file));
    writeFileSync(copy, `${JSON.stringify(compatCopy(grid), null, 2)}\n`);
    return copy;
  });
}

function build(): string {
  const bin = join(ORACLE_DIR, 'bin', 'oracle');
  if (!values['no-build'])
    execFileSync(
      'dotnet',
      [
        'build',
        join(ORACLE_DIR, 'AstroPmOracle.csproj'),
        '-c',
        'Release',
        '-o',
        bin,
        '--nologo',
        '-v',
        'q',
      ],
      { stdio: 'inherit' },
    );
  return join(bin, 'AstroPmOracle.dll');
}

function runOracle(dll: string, files: readonly string[], dir: string): number {
  rmSync(dir, { recursive: true, force: true });
  const res = spawnSync('dotnet', [dll, '--out', dir, ...files], { stdio: 'inherit' });
  return res.status ?? 1;
}

function compareRuns(dirs: readonly string[]): string[] {
  const [first, ...rest] = dirs;
  if (!first) return [];
  const names = readdirSync(first).sort();
  const diffs: string[] = [];
  for (const other of rest)
    for (const name of names) {
      const b = join(other, name);
      if (!existsSync(b) || readFileSync(join(first, name), 'utf8') !== readFileSync(b, 'utf8'))
        diffs.push(`${name}: ${basename(first)} ≠ ${basename(other)}`);
    }
  return diffs;
}

async function main(): Promise<number> {
  const randomDir = writeRandomGrids();
  const inputs = [...positionals, ...(randomDir ? [randomDir] : [])];
  if (inputs.length === 0) {
    console.error('Keine Grids: Dateien/Ordner angeben oder --random <n>.');
    return 64;
  }
  const files = compatInputs(gridFiles(inputs));
  const invalid = validateFiles(files);
  const report: string[] = [
    '# Orakel-Bericht (AP-13a)',
    '',
    `Quelle: ${loadPin().repo} @ ${loadPin().commit.slice(0, 7)} · Grids: ${String(files.length)} · Läufe: ${String(repeat)}`,
    '',
  ];
  if (invalid.length > 0) {
    report.push('## Ungültige Grids', '');
    for (const p of invalid) report.push(`- ${p.file}: ${p.problems.join('; ')}`);
    writeReport(report);
    return 1;
  }
  if (!hasDotnet()) {
    console.error('dotnet (.NET 8) fehlt – das Orakel läuft im CI (oracle.yml).');
    return 69;
  }
  await fetchSources();
  const dll = build();
  const dirs: string[] = [];
  let failed = 0;
  for (let k = 1; k <= repeat; k++) {
    const dir = join(out, `run-${String(k)}`);
    if (runOracle(dll, files, dir) !== 0) failed++;
    dirs.push(dir);
  }
  const errors = readdirSync(dirs[0] ?? out)
    .sort()
    .filter(
      (f) => 'error' in (JSON.parse(readFileSync(join(dirs[0] ?? out, f), 'utf8')) as object),
    );
  const diffs = compareRuns(dirs);
  report.push(
    '## Ergebnis',
    '',
    `- gerechnet: ${String(files.length - errors.length)}/${String(files.length)}`,
    `- Orakelfehler: ${errors.length === 0 ? 'keine' : errors.join(', ')}`,
    `- Determinismus (${String(repeat)} Läufe): ${repeat < 2 ? 'nicht geprüft' : diffs.length === 0 ? 'identisch' : 'ABWEICHUNG'}`,
    ...diffs.map((d) => `  - ${d}`),
  );
  writeReport(report);
  return failed > 0 || errors.length > 0 || diffs.length > 0 ? 1 : 0;
}

function writeReport(lines: readonly string[]) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'report.md'), `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
}

process.exitCode = await main();
