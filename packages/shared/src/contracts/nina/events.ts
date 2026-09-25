/**
 * `POST /nina/v1/sessions/{id}/events` (TK 7.3, 7.6; FA-SYN-06, SEC-52): ≤ 200 Ereignisse
 * (mehr → `413`), `message` ≤ 2 KiB, `data` ≤ 8 KiB und Tiefe ≤ 8 (sonst `422`); idempotent über `id`.
 */
import { z } from 'zod';
import { sessionEventKinds } from '../../generated/enums';
import { boundedJson, Text, UtcInstant, Uuid } from './common';

export const NINA_EVENT_BATCH_MAX = 200;

export const NinaEvent = z.object({
  id: Uuid,
  occurredAtUtc: UtcInstant,
  kind: z.enum(sessionEventKinds),
  code: Text.nullable().optional(),
  message: z
    .string()
    .refine((m) => new TextEncoder().encode(m).length <= 2048, { message: 'höchstens 2 KiB' })
    .optional(),
  nightPlanId: Uuid.nullable().optional(),
  blockId: Uuid.nullable().optional(),
  projectId: Uuid.nullable().optional(),
  durationS: z.number().min(0).optional(),
  data: boundedJson(8192).nullable().optional(),
});

export const NinaEventBatch = z
  .strictObject({ events: z.array(NinaEvent).min(1).max(NINA_EVENT_BATCH_MAX) })
  .meta({ id: 'NinaEventBatch' });
export type NinaEventBatch = z.infer<typeof NinaEventBatch>;

export const NinaEventResults = z
  .object({ accepted: z.number().int().min(0), duplicate: z.number().int().min(0) })
  .meta({ id: 'NinaEventResults' });
