/**
 * Ergebnisse der Jobs `multi_sim` und `impact` (AP-32a; FA-SIM-04, FA-FRG-05; TK 7.4): liegen als JSON in S3
 * (`tenant/<tid>/jobs/<jobId>.json`) und kommen über `GET /web/v1/jobs/{id}/result`.
 */
import { z } from 'zod';
import { NightKey, UtcInstant, Uuid } from './common';

/** Anteil eines Projekts an einer simulierten Nacht. */
export const MultiSimNightProject = z.object({
  projectId: Uuid,
  /** Frames dieser Nacht (mit Wettergewichtung: erwartete Frames, gerundet auf 0,1). */
  frames: z.number().min(0),
  /** Belegte Blockzeit inkl. Overhead (gewichtet). */
  hours: z.number().min(0),
});

export const MultiSimNight = z
  .object({
    night: NightKey,
    /** Astronomisch dunkle Stunden laut Plan; `null` ohne astronomische Nacht. */
    darkHours: z.number().min(0).nullable(),
    /** Gewicht 0…1 (1 ohne Wettergewichtung bzw. ohne Vorhersage). */
    weight: z.number().min(0).max(1),
    /** Nachtbewertung 0…4 (FA-WET-03); `null` ohne Vorhersage. */
    ratingIndex: z.number().int().min(0).max(4).nullable(),
    hasForecast: z.boolean(),
    /** Belichtete Stunden der Nacht (gewichtet). */
    exposureHours: z.number().min(0),
    projects: z.array(MultiSimNightProject),
  })
  .meta({ id: 'MultiSimNight' });

export const MultiSimFilter = z.object({
  filter: z.string(),
  /** Planungsbedarf zu Beginn (Frames). */
  need: z.number().int().min(0),
  /** Über den Zeitraum simulierte Frames (gewichtet, auf 0,1 gerundet). */
  simulated: z.number().min(0),
});

export const MultiSimProject = z
  .object({
    projectId: Uuid,
    name: z.string(),
    /** `approved` bzw. Vorschau-Status (eigener Entwurf, Einreichung, Objekt der Auswirkungsvorschau). */
    approvalStatus: z.string(),
    needFrames: z.number().int().min(0),
    simulatedFrames: z.number().min(0),
    hours: z.number().min(0),
    nightsUsed: z.number().int().min(0),
    /** Nacht, in der der Planungsbedarf gedeckt ist; `null` = nicht im Zeitraum. */
    completesNight: NightKey.nullable(),
    /** Anteil an der belichteten Zeit des Zeitraums in %. */
    sharePct: z.number().min(0).max(100),
    filters: z.array(MultiSimFilter),
  })
  .meta({ id: 'MultiSimProject' });

export const MultiSimResult = z
  .object({
    kind: z.literal('multi_sim'),
    rigId: Uuid,
    rigName: z.string(),
    siteTimeZone: z.string(),
    nightFrom: NightKey,
    nightCount: z.number().int().min(1),
    weather: z.boolean(),
    computedAt: UtcInstant,
    nights: z.array(MultiSimNight),
    projects: z.array(MultiSimProject),
  })
  .meta({ id: 'MultiSimResult' });
export type MultiSimResult = z.infer<typeof MultiSimResult>;

/** Verschiebung eines anderen Projekts durch das neue Objekt (FA-FRG-05). */
export const ImpactShift = z
  .object({
    projectId: Uuid,
    name: z.string(),
    hoursWithout: z.number().min(0),
    hoursWith: z.number().min(0),
    framesWithout: z.number().min(0),
    framesWith: z.number().min(0),
    completesWithout: NightKey.nullable(),
    completesWith: NightKey.nullable(),
  })
  .meta({ id: 'ImpactShift' });

export const ImpactResult = z
  .object({
    kind: z.literal('impact'),
    queueItemId: Uuid,
    projectId: Uuid,
    projectName: z.string(),
    rigId: Uuid,
    rigName: z.string(),
    nightFrom: NightKey,
    nightCount: z.number().int().min(1),
    computedAt: UtcInstant,
    /** Das Objekt in der Simulation mit ihm; `null`, wenn es im Zeitraum keine Zeit erhält. */
    target: MultiSimProject.nullable(),
    shifts: z.array(ImpactShift),
    /** Belegte Stunden des Rigs (Blockzeit aller Projekte inkl. Overhead) ohne bzw. mit dem Objekt. */
    hoursWithout: z.number().min(0),
    hoursWith: z.number().min(0),
  })
  .meta({ id: 'ImpactResult' });
export type ImpactResult = z.infer<typeof ImpactResult>;

export const JobResult = z
  .discriminatedUnion('kind', [MultiSimResult, ImpactResult])
  .meta({ id: 'JobResult' });
export type JobResult = z.infer<typeof JobResult>;
