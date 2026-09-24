/**
 * Grid → Zuteilung (AP-13b): Profile, Matrix und `paint` in einem Aufruf. Liefert dieselben Felder wie
 * das Orakel (`tools/astropm-oracle`, `*.oracle.json`), damit der Vergleich eins zu eins geht.
 */
import type { GridInput } from './grid';
import { buildMatrix } from './matrix';
import type { ExcludedUnit, Matrix } from './model';
import { paint } from './paint';
import { setupFromGrid } from './profiles';

export interface PaintResult {
  /** Einheiten in Matrix-Reihenfolge. */
  readonly rows: readonly string[];
  readonly excluded: readonly ExcludedUnit[];
  readonly prefiltered: readonly string[];
  readonly firstUsableSlot: number;
  readonly lastUsableSlot: number;
  /** Einheit je Slot nach `paint` (`null` = frei). */
  readonly slotAssignment: readonly (string | null)[];
  readonly matrix: Matrix;
}

export function paintGrid(grid: GridInput): PaintResult {
  const setup = setupFromGrid(grid);
  const matrix = buildMatrix(setup);
  paint(matrix);
  const unitAt = (r: number) => (r >= 0 ? (matrix.rows[r]?.profile.unitId ?? null) : null);
  return {
    rows: matrix.rows.map((r) => r.profile.unitId),
    excluded: setup.excluded,
    prefiltered: matrix.rows.filter((r) => r.preFiltered).map((r) => r.profile.unitId),
    firstUsableSlot: matrix.firstUsableSlot,
    lastUsableSlot: matrix.lastUsableSlot,
    slotAssignment: matrix.assignment.map(unitAt),
    matrix,
  };
}
