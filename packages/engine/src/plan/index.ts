/** Nachtplanung (AP-13a…13d, `specs/engine/allocation.md`): Grid-Format, Kompatibilitätsschalter. */
export {
  checkGrid,
  DEFAULT_SORT_CHAIN,
  GRID_SLOT_SECONDS,
  gridMasks,
  maskToRanges,
  panelUnitIndex,
  rangesToMask,
  SORT_CHAIN_KEYS,
  type GridFlip,
  type GridInput,
  type GridIssue,
  type GridIssueCode,
  type GridLine,
  type GridLineMask,
  type GridMasks,
  type GridMode,
  type GridMoonProfile,
  type GridOverhead,
  type GridPanel,
  type GridPanelMask,
  type GridSettings,
  type GridTonight,
  type GridTransit,
  type GridUnit,
  type GridUnitMask,
  type SlotRange,
  type SortChainKey,
} from './grid';
export { randomGrid, seededRandom, type RandomGridOptions } from './grid-random';
export { randomPlanInput } from './plan-input-random';
export { compatSwitches, DEVIATION_IDS, type CompatSwitches } from './compat';
export { buildMatrix, priorityOrder } from './matrix';
export { budgetSlots, decrementWork, paint, type BudgetInput, type PaintStage } from './paint';
export { effectiveRemaining, setupFromGrid } from './profiles';
export {
  paintGrid,
  planGrid,
  planGridCompat,
  type CompatPlanResult,
  type PaintResult,
  type PlanGridOptions,
  type PlanGridResult,
} from './run';
export {
  walk,
  type Picked,
  type WalkBlock,
  type WalkEntry,
  type WalkResult,
  type WalkSettings,
} from './walk';
export { walkCompat, type CompatEntry, type CompatWalkSettings } from './walk-compat';
export { applySortChain, moonDownChain } from './sort-chain';
export type {
  ExcludedUnit,
  Hint,
  Matrix,
  NightSetup,
  PastSlots,
  ProjectLines,
  Row,
  Tier,
  UnitLine,
  UnitProfile,
  UnitTransit,
} from './model';
export { isoFromUnix, unixFromIso, uuidv7FromHash } from './iso';
export { planNight } from './plan-night';
export type {
  NightPlan,
  PlanBlock,
  PlanDiagnostic,
  PlanEntry,
  PlanInput,
  PlanLine,
  PlanMoonProfile,
  PlanPanel,
  PlanProject,
  PlanScheduler,
  PlanTonight,
  PlanTransit,
  PlanWarning,
  TwilightName,
} from './plan-input';
export {
  validatePlan,
  type DiagnosticReason,
  type UnitDiagnostic,
  type UnitWarning,
  type WarningCode,
} from './validate';
export { goldenDiagnostics, goldenEntries, goldenWarnings, type GoldenEntry } from './golden';
