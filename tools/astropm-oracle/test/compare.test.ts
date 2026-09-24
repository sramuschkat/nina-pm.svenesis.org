/**
 * Vergleich TS-Engine ↔ Orakel im Kompatibilitätsmodus (AP-13b, allocation.md §11.2): identische
 * `SlotAssignment` nach Paint, dazu Einheiten, Ausschlüsse und Vorfilter. Läuft, wenn `ORACLE_OUT`
 * auf einen Ausgabeordner von `pnpm oracle:run` zeigt (`oracle.yml`); sonst übersprungen. Schreibt
 * `<ORACLE_OUT>/compare.md` als Abweichungsbericht.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { planGridCompat, type GridInput } from '@nina-pm/engine';
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
  readonly walkSlotAssignment?: (string | null)[];
  readonly entries?: Record<string, unknown>[];
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

/** Eintrag als Zeichenkette mit sortierten Schlüsseln (Reihenfolge der Felder egal). */
function canonical(e: object): string {
  return JSON.stringify(Object.fromEntries(Object.entries(e).sort(([a], [b]) => (a < b ? -1 : 1))));
}

function firstDiff(a: readonly (string | null)[], b: readonly (string | null)[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return i;
  return -1;
}

describe.runIf(out)('Kompatibilitätsmodus = Orakel (Zuteilung und Ablauf)', () => {
  it('identische Slot-Zuteilung und Belichtungsfolge für alle Grids', () => {
    const diffs: string[] = [];
    let compared = 0;
    for (const { name, grid } of gridSources()) {
      const file = join(run, `${name}.oracle.json`);
      if (!existsSync(file) || grid.mode !== 'compat') continue;
      const oracle = JSON.parse(readFileSync(file, 'utf8')) as OracleOut;
      if (oracle.error) continue;
      compared++;
      const ts = planGridCompat(grid);
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
      const walkAt = firstDiff(ts.walkSlotAssignment, oracle.walkSlotAssignment ?? []);
      if (walkAt >= 0)
        problems.push(
          `Ablauf-Slot ${String(walkAt)}: ${String(ts.walkSlotAssignment[walkAt])} ≠ ${String(oracle.walkSlotAssignment?.[walkAt])}`,
        );
      const tsEntries = ts.entries.map(canonical);
      const orEntries = (oracle.entries ?? []).map(canonical);
      const entryAt = firstDiff(tsEntries, orEntries);
      if (entryAt >= 0)
        problems.push(
          `Eintrag ${String(entryAt)} (von ${String(tsEntries.length)}/${String(orEntries.length)}): ` +
            `${String(tsEntries[entryAt])} ≠ ${String(orEntries[entryAt])}`,
        );
      if (problems.length > 0) diffs.push(`- **${name}**: ${problems.join('; ')}`);
    }
    if (out)
      writeFileSync(
        join(out, 'compare.md'),
        [
          '# Vergleich TS ↔ Orakel (Zuteilung und Ablauf, Kompatibilitätsmodus)',
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
