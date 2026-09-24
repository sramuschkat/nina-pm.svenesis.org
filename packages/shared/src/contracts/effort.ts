/**
 * Aufwand-Kennzeichen (FA-PRJ-23, FK 8.9, `specs/engine/effort.md`; AP-13e): Ergebnis von
 * `estimateEffort` wie in `project.effort_*` gespeichert und im Browser live gerechnet.
 * `tag: null` = Planungsbedarf 0 („fertig“, FA-PRJ-12).
 */
import { z } from 'zod';
import { diagnosticReasons, effortTags } from '../generated/enums';
import { NightKey, UtcInstant } from './common';

export const EffortLimitingFactor = z
  .object({
    lineId: z.string(),
    filterShortName: z.string(),
    reason: z.enum(diagnosticReasons).nullable(),
  })
  .meta({ id: 'EffortLimitingFactor' });

export const EffortView = z
  .object({
    tag: z.enum(effortTags).nullable(),
    nights: z.number().int().min(0).nullable(),
    earliestCompletion: NightKey.nullable(),
    achievablePct: z.number().int().min(0).max(100).nullable(),
    requiredHours: z.number().min(0).nullable(),
    bestNight: NightKey.nullable(),
    bestNightHoursByStage: z.array(
      z.object({
        moonProfileId: z.string().nullable(),
        filters: z.array(z.string()),
        hours: z.number().min(0),
      }),
    ),
    limitingFactor: EffortLimitingFactor.nullable(),
    fullyObservable: z.boolean().nullable(),
    coveragePct: z.number().int().min(0).max(100).nullable(),
    /** Zeitraum der Schätzung (Wunschzeitraum bzw. heute … Saisonende, ≤ 180 Nächte). */
    fromNight: NightKey.nullable(),
    toNight: NightKey.nullable(),
    stride: z.number().int().min(1),
    engineVersion: z.string(),
    computedAt: UtcInstant,
  })
  .meta({ id: 'EffortView' });
export type EffortView = z.infer<typeof EffortView>;

/** `project.effort_detail` (jsonb): alles außer `tag`/`nights`/`computedAt` (eigene Spalten). */
export const EffortDetail = EffortView.omit({ tag: true, nights: true, computedAt: true });
export type EffortDetail = z.infer<typeof EffortDetail>;
