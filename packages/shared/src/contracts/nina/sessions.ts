/**
 * Sessions (TK 5.6, 6.6, 7.3, 7.6; FA-SYN-06, FA-RIG-06, NT-01, NT-09, NT-11, NT-14, NT-15, NT-47, M6):
 * `POST /nina/v1/sessions` legt idempotent mit Lease an, `PATCH` beendet, setzt fort oder meldet einen
 * offline erzeugten Plan nach.
 */
import { z } from 'zod';
import { reportStatuses, sessionStatuses } from '../../generated/enums';
import { Lease, NightKey, Sha256, UtcInstant, Uuid, Version } from './common';
import { NinaPlanBlock } from './plan';

/** Offline (Jint) erzeugter Plan; Einträge dürfen fehlen, maßgeblich sind Blöcke und Input-Hash. */
export const NinaOfflinePlan = z.object({
  nightPlanId: Uuid,
  inputHash: Sha256,
  engineVersion: Version,
  blocks: z
    .array(NinaPlanBlock.extend({ entries: NinaPlanBlock.shape.entries.optional() }))
    .max(200),
});

export const NinaSessionCreate = z
  .strictObject({
    id: Uuid,
    night: NightKey,
    nightPlanId: Uuid.nullable(),
    startedAtUtc: UtcInstant,
    offline: z.boolean().default(false),
    offlinePlan: NinaOfflinePlan.nullable().optional(),
  })
  .meta({ id: 'NinaSessionCreate' });
export type NinaSessionCreate = z.infer<typeof NinaSessionCreate>;

export const NinaSessionCreated = z
  .object({
    sessionId: Uuid,
    lease: z.object({ untilUtc: UtcInstant.nullable() }),
    /** Presigned POST für das Planprotokoll `plans/<id>.json.gz` (SEC-23). */
    planLogUploadUrl: z.string().max(4096),
    planLogUploadFields: z.record(z.string(), z.string()).optional(),
  })
  .meta({ id: 'NinaSessionCreated' });

const Stat = z.object({
  avg: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

export const NinaSessionPatch = z
  .strictObject({
    status: z.enum(['running', 'completed', 'aborted']).optional(),
    endedAtUtc: UtcInstant.optional(),
    resumedAtUtc: UtcInstant.optional(),
    outboxPending: z.number().int().min(0).optional(),
    ninaConditions: z.record(z.string().max(64), Stat).optional(),
    offline: z.boolean().optional(),
    offlinePlan: NinaOfflinePlan.optional(),
  })
  .meta({ id: 'NinaSessionPatch' });
export type NinaSessionPatch = z.infer<typeof NinaSessionPatch>;

export const NinaSessionPatched = z
  .object({
    sessionId: Uuid,
    status: z.enum(sessionStatuses),
    lease: Lease,
    nightPlanId: Uuid.nullable(),
    reportStatus: z.enum(reportStatuses),
  })
  .meta({ id: 'NinaSessionPatched' });
