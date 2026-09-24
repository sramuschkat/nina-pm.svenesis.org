/**
 * Grid → Zuteilung (AP-13b): Profile, Matrix und `paint` in einem Aufruf. Liefert dieselben Felder wie
 * das Orakel (`tools/astropm-oracle`, `*.oracle.json`), damit der Vergleich eins zu eins geht.
 */
import type { GridInput } from './grid';
import { buildMatrix } from './matrix';
import type { ExcludedUnit, Matrix } from './model';
import { paint } from './paint';
import { setupFromGrid } from './profiles';
import { validatePlan, type UnitDiagnostic, type UnitWarning } from './validate';
import { walk, type TransitFlip, type WalkBlock, type WalkSettings } from './walk';
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
  readonly warnings: readonly UnitWarning[];
  readonly diagnostics: readonly UnitDiagnostic[];
  readonly blocks: readonly WalkBlock[];
  readonly walkSlotAssignment: readonly (string | null)[];
  readonly emitted: ReadonlyMap<string, number>;
  readonly transitFlips: readonly TransitFlip[];
}

/** Produktivmodus: Zuteilung und Ablauf aus einem Grid (Soll-Pläne Ablauf, Eigenschaftstests). */
export interface PlanGridOptions {
  readonly rotator?: boolean;
  /** Astronomie aus `planNight` statt der Grid-Werte (Meridian, Pierseite). */
  readonly meridian?: WalkSettings['meridian'];
  readonly upperMeridian?: WalkSettings['upperMeridian'];
  readonly pierSide?: WalkSettings['pierSide'];
}

export function planGrid(grid: GridInput, options: PlanGridOptions = {}): PlanGridResult {
  const painted = paintGrid(grid);
  const m = painted.matrix;
  const s = grid.settings;
  const o = s.overhead;
  const twilight = new Map(grid.units.map((u) => [u.unitId, u.twilightEndS ?? null]));
  const units = new Map(grid.units.map((u) => [u.unitId, u]));
  /** Meridiandurchgang je Einheit/Panel: Panelwert, sonst Einheit (A-19). */
  const meridianOf = (unitId: string, panelIndex: number | null): number | null => {
    const u = units.get(unitId);
    if (!u) return null;
    const panel = panelIndex === null ? undefined : u.panels.find((p) => p.index === panelIndex);
    return panel?.meridianAtS ?? u.meridianAtS;
  };
  const { blocks, emitted, transitFlips } = walk(m, {
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
    flip: s.flip,
    meridian:
      options.meridian ??
      ((unitId, panelIndex) => {
        const tm = meridianOf(unitId, panelIndex);
        return tm === null ? [] : [tm];
      }),
    upperMeridian: options.upperMeridian ?? meridianOf,
    pierSide:
      options.pierSide ??
      ((unitId, panelIndex, t) => {
        const tm = meridianOf(unitId, panelIndex);
        return tm === null ? null : t < tm ? 'west' : 'east';
      }),
    flipDone: new Set(
      Object.entries(grid.tonight?.flipDoneByPanel ?? {})
        .filter(([, done]) => done)
        .map(([unitId]) => unitId),
    ),
  });
  const unitAt = (r: number) => (r >= 0 ? (m.rows[r]?.profile.unitId ?? null) : null);
  const pastSec = new Map<string, number>();
  for (const u of m.setup.past?.byUnit ?? [])
    if (u !== null) pastSec.set(u, (pastSec.get(u) ?? 0) + 300);
  const { warnings, diagnostics } = validatePlan({
    matrix: m,
    blocks,
    emitted,
    transitFlips,
    excluded: painted.excluded,
    downloadS: o.downloadS,
    flipDurationS: s.flip.durationS,
    slewCenterS: o.slewCenterS,
    tonight: grid.tonight
      ? { pastSecByUnit: pastSec, exposedSecByUnit: grid.tonight.exposedSecByUnit }
      : null,
  });
  return {
    ...painted,
    warnings,
    diagnostics,
    blocks,
    emitted,
    transitFlips,
    walkSlotAssignment: m.assignment.map(unitAt),
  };
}
