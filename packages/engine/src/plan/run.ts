/**
 * Grid → Zuteilung (AP-13b): Profile, Matrix und `paint` in einem Aufruf. Liefert dieselben Felder wie
 * das Orakel (`tools/astropm-oracle`, `*.oracle.json`), damit der Vergleich eins zu eins geht.
 */
import type { GridInput } from './grid';
import { buildMatrix } from './matrix';
import type { ExcludedUnit, Matrix } from './model';
import { paint } from './paint';
import { setupFromGrid } from './profiles';
import { walk, type WalkBlock } from './walk';
import { walkCompat, type CompatEntry } from './walk-compat';

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
  // Zuteilung nach Paint festhalten: der Ablauf ändert `matrix.assignment` (Ersatz, Freigaben).
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

export interface CompatPlanResult extends PaintResult {
  /** Einheit je Slot nach dem Ablauf (Blockanfang-Ersatz, Freigaben). */
  readonly walkSlotAssignment: readonly (string | null)[];
  readonly entries: readonly CompatEntry[];
}

/** Kompatibilitätsmodus: Zuteilung und Ablauf wie das Orakel (`*.oracle.json`). */
export function planGridCompat(grid: GridInput): CompatPlanResult {
  const painted = paintGrid(grid);
  const m = painted.matrix;
  const s = grid.settings;
  const { entries } = walkCompat(m, {
    ditherEnabled: s.dither.enabled && s.dither.every > 0,
    ditherEvery: s.dither.every,
    filterSwitchEnabled: s.filterSwitch.enabled && s.filterSwitch.every > 0,
    filterSwitchCount: s.filterSwitch.every,
    tolerance: s.filterSwitch.tolerancePct / 100.0,
    bonusEnabled: s.bonusEnabled,
    overshootPct: s.overshootPct,
  });
  const unitAt = (r: number) => (r >= 0 ? (m.rows[r]?.profile.unitId ?? null) : null);
  return { ...painted, walkSlotAssignment: m.assignment.map(unitAt), entries };
}

export interface PlanGridResult extends PaintResult {
  readonly blocks: readonly WalkBlock[];
  readonly walkSlotAssignment: readonly (string | null)[];
}

/** Produktivmodus: Zuteilung und Ablauf aus einem Grid (Soll-Pläne Ablauf, Eigenschaftstests). */
export function planGrid(
  grid: GridInput,
  options: { readonly rotator?: boolean } = {},
): PlanGridResult {
  const painted = paintGrid(grid);
  const m = painted.matrix;
  const s = grid.settings;
  const o = s.overhead;
  const twilight = new Map(grid.units.map((u) => [u.unitId, u.twilightEndS ?? null]));
  const { blocks } = walk(m, {
    slewCenterS: o.slewCenterS,
    filterChangeS: o.filterChangeS,
    ditherSettleS: o.ditherSettleS,
    afEveryMin: o.afEveryMin,
    afDurationS: o.afDurationS,
    downloadS: o.downloadS,
    ditherEnabled: s.dither.enabled,
    ditherEvery: s.dither.every,
    filterSwitchEnabled: s.filterSwitch.enabled,
    filterSwitchEvery: s.filterSwitch.every,
    tolerancePct: s.filterSwitch.tolerancePct,
    bonusEnabled: s.bonusEnabled,
    rotator: options.rotator ?? false,
    darknessEndS: grid.darknessEndS ?? null,
    twilightEndS: (unitId) => twilight.get(unitId) ?? null,
    lastAutofocusS: grid.tonight?.lastAutofocusS ?? null,
    startAtS: grid.startAtS,
    initialCycle: new Map(
      (grid.tonight?.filterCycle ?? []).map((c) => [
        c.unitId,
        { lineId: c.lineId, subs: c.subsOnLine },
      ]),
    ),
  });
  const unitAt = (r: number) => (r >= 0 ? (m.rows[r]?.profile.unitId ?? null) : null);
  return { ...painted, blocks, walkSlotAssignment: m.assignment.map(unitAt) };
}
