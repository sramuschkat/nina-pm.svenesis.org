/** Grids lesen und prüfen (Schema aus `@nina-pm/shared`, Querbezüge aus `checkGrid` der Engine). */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { checkGrid, type GridInput } from '@nina-pm/engine';
import { GridInputSchema } from '@nina-pm/shared';

export interface GridProblem {
  readonly file: string;
  readonly problems: readonly string[];
}

/** Dateien und Ordner (alle `*.json` außer Orakel-Ausgaben und Schemas), ordinal sortiert. */
export function gridFiles(paths: readonly string[]): string[] {
  return paths
    .flatMap((p) =>
      statSync(p).isDirectory()
        ? readdirSync(p)
            .filter(
              (f) =>
                f.endsWith('.json') && !f.endsWith('.oracle.json') && !f.endsWith('.schema.json'),
            )
            .map((f) => join(p, f))
        : [p],
    )
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Soll-Plan (mit `input`) oder reines Grid → Grid-Eingabe. */
export function gridOf(json: unknown): unknown {
  return json !== null && typeof json === 'object' && 'input' in json ? json.input : json;
}

/**
 * Kompatibilitäts-Kopie eines produktiven Grids für den Orakel-Vergleich (golden-plans/README.md:
 * „dieselben Grids laufen zusätzlich mit mode compat“): Neuplanung und `due_soonest` kennt das Original
 * nicht und fallen weg.
 */
export function compatCopy(grid: GridInput): GridInput {
  return {
    ...grid,
    mode: 'compat',
    startAtS: null,
    tonight: null,
    settings: {
      ...grid.settings,
      sortChain: grid.settings.sortChain.filter((k) => k !== 'due_soonest'),
    },
  };
}

export function validateGrid(json: unknown): { grid?: GridInput; problems: string[] } {
  const parsed = GridInputSchema.safeParse(gridOf(json));
  if (!parsed.success)
    return {
      problems: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  const grid = parsed.data as GridInput;
  const issues = checkGrid(grid);
  return issues.length === 0
    ? { grid, problems: [] }
    : { problems: issues.map((i) => `${i.code} ${i.path}: ${i.message}`) };
}

export function validateFiles(files: readonly string[]): GridProblem[] {
  return files.flatMap((file) => {
    const { problems } = validateGrid(JSON.parse(readFileSync(file, 'utf8')));
    return problems.length > 0 ? [{ file: basename(file), problems }] : [];
  });
}
