/**
 * Vergleich TS-Engine ↔ Orakel im Kompatibilitätsmodus (AP-13b, allocation.md §11.2): identische
 * `SlotAssignment` nach Paint, dazu Einheiten, Ausschlüsse und Vorfilter. Läuft, wenn `ORACLE_OUT`
 * auf einen Ausgabeordner von `pnpm oracle:run` zeigt (`oracle.yml`); sonst übersprungen. Schreibt
 * `<ORACLE_OUT>/compare.md` als Abweichungsbericht.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paintGrid, type GridInput } from '@nina-pm/engine';
import { describe, expect, it } from 'vitest';
import { ORACLE_DIR } from '../src/fetch';
import { gridOf } from '../src/grids';

const out = process.env.ORACLE_OUT;
const run = out ? join(out, 'run-1') : '';

interface OracleOut {
  readonly rows?: string[];
  readonly excluded?: { unitId: string; reason: string }[];
  readonly prefiltered?: string[];
  readonly slotAssignment?: (string | null)[];
  readonly error?: { code: string };
}

function gridSources(): { name: string; grid: GridInput }[] {
  const dirs = [
    join(ORACLE_DIR, 'grids'),
    ...(out ? [join(out, 'grids'), join(out, 'compat')] : []),
  ];
  return dirs
    .filter((d) => existsSync(d))
    .flatMap((d) =>
      readdirSync(d)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => ({
          name: f.replace(/\.json$/, ''),
          grid: gridOf(JSON.parse(readFileSync(join(d, f), 'utf8'))) as GridInput,
        })),
    );
}

function firstDiff(a: readonly (string | null)[], b: readonly (string | null)[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return i;
  return -1;
}

describe.runIf(out)('Kompatibilitätsmodus = Orakel (Paint)', () => {
  it('identische Slot-Zuteilung für alle Grids', () => {
    const diffs: string[] = [];
    let compared = 0;
    for (const { name, grid } of gridSources()) {
      const file = join(run, `${name}.oracle.json`);
      if (!existsSync(file) || grid.mode !== 'compat') continue;
      const oracle = JSON.parse(readFileSync(file, 'utf8')) as OracleOut;
      if (oracle.error) continue;
      compared++;
      const ts = paintGrid(grid);
      const problems: string[] = [];
      if (JSON.stringify(ts.rows) !== JSON.stringify(oracle.rows))
        problems.push(`rows ${JSON.stringify(ts.rows)} ≠ ${JSON.stringify(oracle.rows)}`);
      const tsExcluded = ts.excluded.map((e) => `${e.unitId}:${e.reason}`);
      const orExcluded = (oracle.excluded ?? []).map((e) => `${e.unitId}:${e.reason}`);
      if (JSON.stringify(tsExcluded) !== JSON.stringify(orExcluded))
        problems.push(`excluded ${tsExcluded.join(',')} ≠ ${orExcluded.join(',')}`);
      if (JSON.stringify(ts.prefiltered) !== JSON.stringify(oracle.prefiltered))
        problems.push(
          `prefiltered ${ts.prefiltered.join(',')} ≠ ${(oracle.prefiltered ?? []).join(',')}`,
        );
      const at = firstDiff(ts.slotAssignment, oracle.slotAssignment ?? []);
      if (at >= 0)
        problems.push(
          `slot ${String(at)}: ${String(ts.slotAssignment[at])} ≠ ${String(oracle.slotAssignment?.[at])}` +
            `\n    TS     ${ts.slotAssignment.map((u) => u ?? '.').join(' ')}` +
            `\n    Orakel ${(oracle.slotAssignment ?? []).map((u) => u ?? '.').join(' ')}`,
        );
      if (problems.length > 0) diffs.push(`- **${name}**: ${problems.join('; ')}`);
    }
    if (out)
      writeFileSync(
        join(out, 'compare.md'),
        [
          '# Vergleich TS ↔ Orakel (Paint, Kompatibilitätsmodus)',
          '',
          `Verglichen: ${String(compared)} · Abweichungen: ${String(diffs.length)}`,
          '',
          ...diffs,
          '',
        ].join('\n'),
      );
    expect(compared).toBeGreaterThan(0);
    expect(diffs, diffs.slice(0, 5).join('\n')).toEqual([]);
  });
});
