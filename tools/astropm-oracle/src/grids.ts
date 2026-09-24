/** Grids lesen und prüfen (Schema aus `@nina-pm/shared`, Querbezüge aus `checkGrid` der Engine). */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { checkGrid, type GridInput } from '@nina-pm/engine';
import { GridInputSchema } from '@nina-pm/shared';

export interface GridProblem {
  readonly file: string;
  readonly problems: readonly string[];
}

/** Dateien und Ordner (alle `*.json` außer Orakel-Ausgaben), ordinal sortiert. */
export function gridFiles(paths: readonly string[]): string[] {
  return paths
    .flatMap((p) =>
      statSync(p).isDirectory()
        ? readdirSync(p)
            .filter((f) => f.endsWith('.json') && !f.endsWith('.oracle.json'))
            .map((f) => join(p, f))
        : [p],
    )
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Soll-Plan (mit `input`) oder reines Grid → Grid-Eingabe. */
export function gridOf(json: unknown): unknown {
  return json !== null && typeof json === 'object' && 'input' in json ? json.input : json;
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
