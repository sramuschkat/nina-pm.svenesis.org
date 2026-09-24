/**
 * Grid-Format der Soll-Pläne und des Vergleichsorakels (AP-13a; `docs/contracts/golden-plans/README.md`,
 * `specs/engine/allocation.md` §11.2). Strukturprüfung hier; Querbezüge (Einheiten-IDs, Zeilen-IDs,
 * Profile, Bereiche) prüft `checkGrid` der Engine. `pnpm contracts:generate` schreibt daraus
 * `docs/contracts/golden-plans/grid.schema.json`.
 */
import { z } from 'zod';
import { sortChainKeys } from '../generated/enums';

const Int = z.number().int();
const NonNegInt = Int.min(0);
const SlotRange = z.tuple([NonNegInt, NonNegInt]);
const Id = z.string().min(1).max(64);

export const GridLineSchema = z.strictObject({
  id: Id,
  filter: z.string().min(1).max(32),
  exposureS: Int.positive(),
  planned: NonNegInt,
  accepted: NonNegInt,
  enabled: z.boolean(),
  moonProfile: Id.nullable(),
  safe: z.array(SlotRange),
});

export const GridPanelSchema = z.strictObject({
  index: NonNegInt,
  peakAltDeg: z.number().min(-90).max(90).optional(),
  canImage: z.array(SlotRange).optional(),
  meridianAtS: Int.nullable().optional(),
  lines: z.array(GridLineSchema),
});

export const GridUnitSchema = z.strictObject({
  unitId: z.string().regex(/^[^/]+(\/p(0|[1-9][0-9]*))?$/),
  projectId: z.string().regex(/^[^/]+$/),
  priority: NonNegInt,
  minTimeOnTargetH: z.number().min(0).max(24),
  dueDate: z.iso.date().nullable(),
  peakAltDeg: z.number().min(-90).max(90),
  canImage: z.array(SlotRange),
  meridianAtS: Int.nullable(),
  transit: z
    .strictObject({
      windowS: z.tuple([Int, Int]),
      lineId: Id,
      lockedAtS: Int,
    })
    .nullable(),
  panels: z.array(GridPanelSchema).min(1),
  twilightEndS: Int.nullable().optional(),
});

export const GridMoonProfileSchema = z.strictObject({
  id: Id,
  distanceDeg: z.number().min(0).max(180),
  maxIllumPct: z.number().min(0).max(100),
  mustBeDown: z.boolean(),
  /** Breite `W` (Tage); produktiv Pflicht außer bei `mustBeDown` (A-31). */
  widthDays: z.number().min(0).max(30).optional(),
});

export const GridSettingsSchema = z.strictObject({
  strategy: z.enum(['proportional', 'manual_priority']),
  sortChain: z.array(z.enum(sortChainKeys)),
  bonusEnabled: z.boolean(),
  overshootPct: z.number().min(0).max(100),
  mosaicPanelsIndependent: z.boolean(),
  dither: z.strictObject({ enabled: z.boolean(), every: NonNegInt }),
  filterSwitch: z.strictObject({
    enabled: z.boolean(),
    every: NonNegInt,
    tolerancePct: z.number().min(0).max(100),
  }),
  overhead: z.strictObject({
    slewCenterS: NonNegInt,
    filterChangeS: NonNegInt,
    ditherSettleS: NonNegInt,
    afEveryMin: NonNegInt,
    afDurationS: NonNegInt,
    downloadS: NonNegInt,
  }),
  flip: z.strictObject({
    enabled: z.boolean(),
    afterMin: z.number().min(0),
    maxAfterMin: z.number().min(0),
    pauseBeforeMin: z.number().min(0),
    durationS: NonNegInt,
  }),
});

export const GridTonightSchema = z.strictObject({
  pastBlocks: z.array(z.strictObject({ unitId: Id, fromS: NonNegInt, toS: NonNegInt })),
  exposedSecByUnit: z.record(z.string(), z.number().min(0)),
  lastAutofocusS: Int.nullable(),
  filterCycle: z.array(z.strictObject({ unitId: Id, lineId: Id, subsOnLine: NonNegInt })),
  flipDoneByPanel: z.record(z.string(), z.boolean()),
  currentUnitId: Id.nullable(),
});

export const GridInputSchema = z.strictObject({
  mode: z.enum(['productive', 'compat']),
  slotS: z.literal(300),
  slots: Int.min(1).max(288),
  startAtS: NonNegInt.nullable(),
  moonAltDeg: z.array(z.number().min(-90).max(90)),
  settings: GridSettingsSchema,
  moonProfiles: z.array(GridMoonProfileSchema),
  units: z.array(GridUnitSchema),
  tonight: GridTonightSchema.nullable(),
  darknessEndS: Int.nullable().optional(),
});
export type GridInputDto = z.infer<typeof GridInputSchema>;

const Entry = z
  .object({ atS: Int, cmd: z.string().min(1) })
  .catchall(z.union([z.string(), z.number(), z.boolean(), z.null()]));

/** Soll-Plan-Datei (`docs/contracts/golden-plans/G*.json`); `approvedBy` setzt nur Sven (H-13). */
export const GoldenPlanSchema = z.strictObject({
  id: z.string().regex(/^G[0-9]{2,3}[a-z]?$/),
  title: z.string().min(1),
  requirements: z.array(z.string()),
  explanation: z.string(),
  approvedBy: z.string().nullable(),
  oracleDiff: z.string().nullable(),
  input: GridInputSchema,
  expected: z.strictObject({
    slotAssignment: z.array(z.string().nullable()).optional(),
    entries: z.array(Entry).optional(),
    warnings: z.array(z.strictObject({ code: z.string(), atS: Int.optional() })).optional(),
    diagnostics: z
      .array(
        z.strictObject({
          unitId: z.string(),
          lineId: z.string().optional(),
          reason: z.string(),
          message: z.string().optional(),
        }),
      )
      .optional(),
  }),
});
export type GoldenPlanDto = z.infer<typeof GoldenPlanSchema>;
