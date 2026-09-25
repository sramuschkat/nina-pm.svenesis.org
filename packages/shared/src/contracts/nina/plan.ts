/**
 * `POST /nina/v1/plan` (TK 7.3, 7.6; FA-SIM-05, FA-SYN-03, NT-01, NT-20, M4, M7, M8): der Server plant
 * mit derselben Engine wie der Simulator (`buildPlanInput` → `planNight`) und speichert die Revision.
 * Antwort = `NightPlan` plus `revision` und `readoutModeIndex` je Belichtung.
 */
import { z } from 'zod';
import {
  blockKinds,
  diagnosticReasons,
  rotationModes,
  simulatorWarnings,
  warningLevels,
} from '../../generated/enums';
import { MeridianFlipSchema, PlanTonightSchema } from '../plan';
import { Angle, Message, NightKey, Sha256, Text, UtcInstant, Uuid, Version } from './common';

export const NINA_PLAN_REASONS = ['initial', 'refresh', 'resume', 'reset'] as const;

export const NinaPlanRequest = z
  .strictObject({
    night: NightKey,
    reason: z.enum(NINA_PLAN_REASONS),
    startAtUtc: UtcInstant.nullable().optional(),
    sessionId: Uuid.nullable().optional(),
    pendingCaptures: z
      .array(
        z.strictObject({
          exposureLineId: Uuid,
          transitObservationId: Uuid.nullable().optional(),
          captureIds: z.array(Uuid).max(500),
        }),
      )
      .max(500)
      .default([]),
    targetsEtag: Text.nullable().optional(),
    tonight: PlanTonightSchema.partial().nullable().optional(),
  })
  .meta({ id: 'NinaPlanRequest' });
export type NinaPlanRequest = z.infer<typeof NinaPlanRequest>;

const exposure = {
  exposureLineId: Uuid,
  filter: Text,
  exposureS: z.number().positive(),
  gain: z.number().int().nullable(),
  offset: z.number().int().nullable(),
  binning: z.number().int().min(1),
  readoutMode: Text.nullable(),
  readoutModeIndex: z.number().int().min(0).nullable(),
};
const seq = z.number().int().min(1);

export const NinaPlanEntry = z.discriminatedUnion('cmd', [
  z.object({
    seq,
    cmd: z.enum(['slew_center', 'slew_center_rotate']),
    atUtc: UtcInstant,
    durationS: z.number().min(0),
  }),
  z.object({
    seq,
    cmd: z.literal('filter'),
    atUtc: UtcInstant,
    durationS: z.number().min(0),
    filter: Text,
  }),
  z.object({
    seq,
    cmd: z.literal('expose'),
    atUtc: UtcInstant,
    ...exposure,
    bonus: z.boolean(),
    lastOfNight: z.boolean(),
  }),
  z.object({
    seq,
    cmd: z.literal('expose_series'),
    atUtc: UtcInstant,
    untilUtc: UtcInstant,
    ...exposure,
  }),
  z.object({
    seq,
    cmd: z.enum(['dither', 'autofocus_hint', 'wait', 'meridian_flip']),
    atUtc: UtcInstant,
    durationS: z.number().min(0),
  }),
  z.object({ seq, cmd: z.literal('end'), atUtc: UtcInstant }),
]);

export const NinaPlanBlock = z.object({
  id: Uuid,
  kind: z.enum(blockKinds),
  projectId: Uuid,
  panelId: Uuid.nullable(),
  transitObservationId: Uuid.nullable().optional(),
  startUtc: UtcInstant,
  endUtc: UtcInstant,
  twilightEndUtc: UtcInstant.nullable(),
  raDeg: z.number().min(0).lt(360),
  decDeg: z.number().min(-90).max(90),
  rotationDeg: Angle,
  rotationMode: z.enum(rotationModes),
  meridianFlip: MeridianFlipSchema.nullable(),
  entries: z.array(NinaPlanEntry).min(1).max(2000),
});

export const NinaPlanResponse = z
  .object({
    nightPlanId: Uuid,
    engineVersion: Version,
    inputHash: Sha256,
    outputHash: Sha256.optional(),
    night: NightKey,
    revision: z.number().int().min(1),
    startAtUtc: UtcInstant.nullable(),
    nightWindow: z.object({ startUtc: UtcInstant, endUtc: UtcInstant }),
    darkness: z.object({
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
    blocks: z.array(NinaPlanBlock).max(200),
    summary: z.object({
      targets: z.number().int().min(0),
      plannedFrames: z.record(z.string(), z.record(z.string(), z.number().int().min(0))),
    }),
    diagnostics: z.array(
      z.object({
        projectId: Uuid,
        panelId: Uuid.optional(),
        lineId: Uuid.optional(),
        reason: z.enum(diagnosticReasons),
        message: Message.optional(),
      }),
    ),
    warnings: z.array(
      z.object({
        code: z.enum(simulatorWarnings),
        level: z.enum(warningLevels),
        unitId: Text.optional(),
        atUtc: UtcInstant.optional(),
        durationS: z.number().min(0).optional(),
        message: Message.optional(),
      }),
    ),
  })
  .meta({ id: 'NinaPlanResponse' });
export type NinaPlanResponse = z.infer<typeof NinaPlanResponse>;
