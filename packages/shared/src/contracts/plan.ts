/**
 * Planungsvertrag (TK 7.6, 8.2; AP-13c): `PlanInput` (Eingabe von `planNight`, gebaut nur von
 * `buildPlanInput`) und `NightPlan` (Antwort von `POST /plan`, Simulator). Gegenstück der Engine-Typen in
 * `packages/engine/src/plan/plan-input.ts`; Zeitpunkte ISO-8601 mit `Z` (ganze Sekunden), Winkel in Grad.
 */
import { z } from 'zod';
import {
  blockKinds,
  diagnosticReasons,
  flatsSources,
  rotationModes,
  simulatorWarnings,
  sortChainKeys,
  strategies,
  twilight,
  warningLevels,
} from '../generated/enums';
import { NightKey, UtcInstant } from './common';

const Id = z.string().min(1).max(80);
const Seconds = z.number().min(0);

export const PlanMoonProfileSchema = z.strictObject({
  id: Id,
  separationDeg: z.number().min(0).max(180),
  widthDays: z.number().min(0),
  relaxScale: z.number().min(0),
  moonMinAltDeg: z.number().min(-90).max(90),
  moonMaxAltDeg: z.number().min(-90).max(90),
  maxIlluminationPct: z.number().min(0).max(100),
  moonMustBeDown: z.boolean(),
});

export const PlanLineSchema = z.strictObject({
  id: Id,
  filter: z.string().min(1).max(40),
  ninaFilterName: z.string().max(60).nullable(),
  exposureS: z.number().positive(),
  planned: z.number().int().min(0),
  accepted: z.number().int().min(0),
  pending: z.number().int().min(0),
  enabled: z.boolean(),
  moonProfileId: Id.nullable(),
  gain: z.number().int().nullable(),
  offset: z.number().int().nullable(),
  binning: z.number().int().min(1),
  readoutMode: z.string().nullable(),
});

export const PlanPanelSchema = z.strictObject({
  id: Id,
  index: z.number().int().min(0),
  raDeg: z.number().min(0).lt(360),
  decDeg: z.number().min(-90).max(90),
  rotationDeg: z.number().min(0).lt(360),
  lines: z.array(PlanLineSchema),
});

export const PlanProjectSchema = z.strictObject({
  id: Id,
  raDeg: z.number().min(0).lt(360),
  decDeg: z.number().min(-90).max(90),
  rotationDeg: z.number().min(0).lt(360),
  priority: z.number().int().min(0),
  minAltitudeDeg: z.number().min(-90).max(90),
  minTimeOnTargetH: z.number().min(0).max(24),
  twilight: z.enum(twilight),
  startDate: NightKey.nullable(),
  dueDate: NightKey.nullable(),
  panels: z.array(PlanPanelSchema).min(1),
  transit: z
    .strictObject({
      observationId: Id,
      lineId: Id,
      windowStartUtc: UtcInstant,
      windowEndUtc: UtcInstant,
      lockedAtUtc: UtcInstant,
    })
    .nullable(),
});

export const PlanTonightSchema = z.strictObject({
  pastBlocks: z.array(z.strictObject({ unitId: Id, fromUtc: UtcInstant, toUtc: UtcInstant })),
  exposedSecByUnit: z.record(z.string(), Seconds),
  lastAutofocusUtc: UtcInstant.nullable(),
  filterCycle: z.array(
    z.strictObject({ unitId: Id, lineId: Id, subsOnLine: z.number().int().min(0) }),
  ),
  flipDoneByPanel: z.record(z.string(), z.boolean()),
  currentUnitId: Id.nullable(),
});

export const PlanInputSchema = z
  .strictObject({
    mode: z.enum(['productive', 'compat']),
    night: NightKey,
    site: z.strictObject({
      latitudeDeg: z.number().min(-89.9).max(89.9),
      longitudeDeg: z.number().min(-180).max(180),
      elevationM: z.number(),
    }),
    tzdataVersion: z.string(),
    timeZoneTransitions: z
      .array(z.strictObject({ atUtc: UtcInstant, utcOffsetMinutes: z.number().int() }))
      .min(1),
    rig: z.strictObject({
      id: Id,
      hasRotator: z.boolean(),
      defaultRotationDeg: z.number().min(0).lt(360).nullable(),
      rotationToleranceDeg: z.number().min(0).max(90),
      hasFilterWheel: z.boolean(),
    }),
    scheduler: z.strictObject({
      strategy: z.enum(strategies),
      sortChain: z.array(z.enum(sortChainKeys)),
      bonusEnabled: z.boolean(),
      overshootPct: z.number().min(0).max(100),
      mosaicPanelsIndependent: z.boolean(),
      ditherEnabled: z.boolean(),
      ditherEvery: z.number().int().min(0),
      filterSwitchEnabled: z.boolean(),
      filterSwitchEvery: z.number().int().min(0),
      filterSwitchTolerancePct: z.number().min(0).max(100),
      flatsSource: z.enum(flatsSources),
      flip: z.strictObject({
        enabled: z.boolean(),
        afterMin: z.number().min(0),
        maxAfterMin: z.number().min(0),
        pauseBeforeMin: z.number().min(0),
        durationS: Seconds,
      }),
      overhead: z.strictObject({
        slewCenterS: Seconds,
        filterChangeS: Seconds,
        ditherSettleS: Seconds,
        afEveryMin: Seconds,
        afDurationS: Seconds,
        downloadS: Seconds,
      }),
    }),
    moonProfiles: z.array(PlanMoonProfileSchema),
    projects: z.array(PlanProjectSchema),
    startAtUtc: UtcInstant.nullable(),
    tonight: PlanTonightSchema.nullable(),
  })
  .meta({ id: 'PlanInput' });
export type PlanInputDto = z.infer<typeof PlanInputSchema>;

const exposureParams = {
  exposureLineId: Id,
  filter: z.string(),
  exposureS: z.number().positive(),
  gain: z.number().int().nullable(),
  offset: z.number().int().nullable(),
  binning: z.number().int().min(1),
  readoutMode: z.string().nullable(),
};

export const PlanEntrySchema = z.discriminatedUnion('cmd', [
  z.strictObject({
    seq: z.number().int().min(1),
    cmd: z.enum(['slew_center', 'slew_center_rotate']),
    atUtc: UtcInstant,
    durationS: Seconds,
  }),
  z.strictObject({
    seq: z.number().int().min(1),
    cmd: z.literal('filter'),
    atUtc: UtcInstant,
    durationS: Seconds,
    filter: z.string(),
  }),
  z.strictObject({
    seq: z.number().int().min(1),
    cmd: z.literal('expose'),
    atUtc: UtcInstant,
    ...exposureParams,
    bonus: z.boolean(),
    lastOfNight: z.boolean(),
  }),
  z.strictObject({
    seq: z.number().int().min(1),
    cmd: z.literal('expose_series'),
    atUtc: UtcInstant,
    untilUtc: UtcInstant,
    ...exposureParams,
  }),
  z.strictObject({
    seq: z.number().int().min(1),
    cmd: z.enum(['dither', 'autofocus_hint', 'wait', 'meridian_flip']),
    atUtc: UtcInstant,
    durationS: Seconds,
  }),
  z.strictObject({ seq: z.number().int().min(1), cmd: z.literal('end'), atUtc: UtcInstant }),
]);

export const MeridianFlipSchema = z.strictObject({
  waitStartUtc: UtcInstant.nullable(),
  plannedUtc: UtcInstant,
  durationS: Seconds,
  inTransitWindow: z.boolean(),
  planned: z.boolean(),
  gapStartUtc: UtcInstant.nullable(),
  gapDurationS: Seconds.nullable(),
});

export const PlanBlockSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(blockKinds),
  projectId: Id,
  panelId: Id.nullable(),
  transitObservationId: Id.nullable(),
  startUtc: UtcInstant,
  endUtc: UtcInstant,
  twilightEndUtc: UtcInstant.nullable(),
  raDeg: z.number(),
  decDeg: z.number(),
  rotationDeg: z.number(),
  rotationMode: z.enum(rotationModes),
  meridianFlip: MeridianFlipSchema.nullable(),
  entries: z.array(PlanEntrySchema).min(1),
});

export const NightPlanSchema = z
  .strictObject({
    nightPlanId: z.uuid(),
    engineVersion: z.string(),
    inputHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    outputHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    night: NightKey,
    startAtUtc: UtcInstant.nullable(),
    nightWindow: z.strictObject({ startUtc: UtcInstant, endUtc: UtcInstant }),
    darkness: z.strictObject({
      civilStartUtc: UtcInstant.nullable(),
      civilEndUtc: UtcInstant.nullable(),
      nauticalStartUtc: UtcInstant.nullable(),
      nauticalEndUtc: UtcInstant.nullable(),
      astronomicalStartUtc: UtcInstant.nullable(),
      astronomicalEndUtc: UtcInstant.nullable(),
    }),
    darknessEndUtc: UtcInstant.nullable(),
    flatsNotBeforeUtc: UtcInstant,
    flatsNotAfterUtc: UtcInstant.nullable(),
    sessionEndUtc: UtcInstant,
    blocks: z.array(PlanBlockSchema),
    summary: z.strictObject({
      targets: z.number().int().min(0),
      plannedFrames: z.record(z.string(), z.record(z.string(), z.number().int().min(0))),
    }),
    diagnostics: z.array(
      z.strictObject({
        projectId: Id,
        panelId: Id.optional(),
        lineId: Id.optional(),
        reason: z.enum(diagnosticReasons),
        message: z.string().optional(),
      }),
    ),
    warnings: z.array(
      z.strictObject({
        code: z.enum(simulatorWarnings),
        level: z.enum(warningLevels),
        unitId: z.string().optional(),
        atUtc: UtcInstant.optional(),
        durationS: Seconds.optional(),
        message: z.string().optional(),
      }),
    ),
  })
  .meta({ id: 'NightPlan' });
export type NightPlanDto = z.infer<typeof NightPlanSchema>;
