/**
 * `GET /nina/v1/targets` (TK 7.3, 7.6; FA-SYN-02/03, NT-E1, NT-19): auslieferbare Projekte des Rigs
 * (`isDeliverable`) als Discriminated Union über `type`; je Zeile `ninaFilterName` (`null` = nicht
 * zugeordnet). Keine Uhrzeiten der Nacht außer den Transitfenstern.
 */
import { z } from 'zod';
import {
  moonModes,
  projectStatuses,
  transitObservationStatuses,
  twilight,
} from '../../generated/enums';
import { Angle, NightKey, Text, UtcInstant, Uuid } from './common';

const Moon = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }),
  z.object({ mode: z.literal('project_default') }),
  z.object({ mode: z.literal('profile'), profileId: Uuid }),
]);
// Enum-Werte aus enums.json (moonModes) – die Union oben deckt genau diese ab.
export const NINA_MOON_MODES = moonModes;

const LineBase = {
  id: Uuid,
  filter: Text,
  ninaFilterName: Text.nullable(),
  exposureS: z.number().positive(),
  gain: z.number().int().nullable(),
  offset: z.number().int().nullable(),
  binning: z.number().int().min(1),
  readoutMode: Text.nullable(),
  readoutModeIndex: z.number().int().min(0).nullable(),
  moon: Moon,
};

export const NinaLineCounts = z.object({
  planned: z.number().int().min(0),
  acquired: z.number().int().min(0),
  rejected: z.number().int().min(0),
  accepted: z.number().int().min(0),
  remaining: z.number().int().min(0),
  planningNeed: z.number().int().min(0),
  bonus: z.number().int().min(0),
  bonusRejected: z.number().int().min(0),
});

const Panel = <L extends z.ZodType>(line: L) =>
  z.object({
    id: Uuid,
    index: z.number().int().min(0),
    label: Text,
    raDeg: z.number().min(0).lt(360),
    decDeg: z.number().min(-90).max(90),
    rotationDeg: Angle,
    lines: z.array(line).max(100),
  });

const Conditions = z.object({
  minAltitudeDeg: z.number().min(-90).max(90),
  minTimeOnTargetH: z.number().min(0).max(24),
  twilight: z.enum(twilight),
  moonDefault: z
    .object({
      enabled: z.boolean(),
      separationDeg: z.number().optional(),
      widthDays: z.number().optional(),
      relax: z.number().optional(),
      minAltDeg: z.number().optional(),
      maxAltDeg: z.number().optional(),
      maxIlluminationPct: z.number().optional(),
      moonMustBeDown: z.boolean().optional(),
    })
    .optional(),
});

/** Vorhandene Flats des Projekts auf diesem Rig je Kombination (Auto-Flats, AP-50b). */
export const NinaFlatRecord = z.object({
  filterShortName: Text,
  /** Mechanischer Rotatorwinkel in Zehntelgrad (Schlüssel wie `flat_combination`, NIN5-8). */
  rotatorMechDg: z.number().int().min(0).max(3599),
  /** Gain/Offset `null` als `-1` (NT-38). */
  gain: z.number().int(),
  offset: z.number().int(),
  binning: z.number().int().min(1),
  readoutModeIndex: z.number().int().min(0),
  /** Ende der Session, in der die Flats entstanden. */
  lastUtc: UtcInstant,
  count: z.number().int().min(0),
});

const Common = {
  id: Uuid,
  version: z.number().int().min(1),
  name: Text,
  target: z.object({
    name: Text.nullable(),
    objectType: Text.nullable(),
    catalogNames: z.string().max(2000).optional(),
  }),
  status: z.enum(projectStatuses),
  priority: z.number().int(),
  startDate: NightKey.nullable().optional(),
  dueDate: NightKey.nullable().optional(),
  conditions: Conditions,
  /** Vorhandene Flats (AP-50b); fehlt bei älteren Servern – dann gelten keine als vorhanden. */
  flatsOnRecord: z.array(NinaFlatRecord).max(500).optional(),
  /**
   * Projektzentrum und Positionswinkel `pa₀` (geometry.md §2, NT-30/NT-32) für „In Framing-Assistent
   * laden“ (FA-NIN-02, AP-16h); ohne Rotator der Kamerawinkel des Rigs. Optional: ältere Server liefern
   * ihn nicht, das Plugin nimmt dann das einzige Panel bzw. den Mittelpunkt der Panels.
   */
  center: z
    .object({
      raDeg: z.number().min(0).lt(360),
      decDeg: z.number().min(-90).max(90),
      rotationDeg: Angle,
    })
    .optional(),
};

export const NinaDeepSkyProject = z.object({
  ...Common,
  type: z.literal('deep_sky'),
  mosaic: z
    .object({
      rows: z.number().int().min(1),
      columns: z.number().int().min(1),
      overlapPct: z.number().min(0).max(100),
    })
    .nullable()
    .optional(),
  panels: z
    .array(
      Panel(
        z.object({
          ...LineBase,
          order: z.number().int().min(0),
          enabled: z.boolean(),
          counts: NinaLineCounts,
        }),
      ),
    )
    .min(1)
    .max(64),
  exoplanet: z.null().optional(),
});

export const NinaExoplanetProject = z.object({
  ...Common,
  type: z.literal('exoplanet'),
  panels: z
    .array(Panel(z.object(LineBase)))
    .min(1)
    .max(1),
  exoplanet: z.object({
    planet: Text,
    ephemeris: z.object({
      t0BjdTdb: z.number(),
      t0SigmaD: z.number().min(0).nullable(),
      periodD: z.number().positive(),
      periodSigmaD: z.number().min(0).nullable(),
      durationH: z.number().positive(),
    }),
    observation: z.object({
      id: Uuid,
      status: z.enum(transitObservationStatuses),
      epoch: z.number().int(),
      night: NightKey,
      ingressUtc: UtcInstant,
      midUtc: UtcInstant,
      egressUtc: UtcInstant,
      windowStartUtc: UtcInstant,
      windowEndUtc: UtcInstant,
      allowAutofocus: z.boolean(),
      allowRecenter: z.boolean(),
      counts: z.object({
        planned: z.number().int().min(0),
        acquired: z.number().int().min(0),
        rejected: z.number().int().min(0),
      }),
    }),
  }),
});

export const NinaTargets = z
  .object({
    rigId: Uuid,
    generatedAtUtc: UtcInstant,
    projects: z
      .array(z.discriminatedUnion('type', [NinaDeepSkyProject, NinaExoplanetProject]))
      .max(500),
    mosaicPanelsIndependent: z.boolean(),
    /**
     * Auslieferungsmenge der aktuellen und der zwei folgenden Nächte (FA-NIN-07, AP-52): Anzahl auslieferbarer Projekte
     * je Nacht (FA-SYN-02, mit Startdatum und Planungsbedarf). Die *NINA-PM Tagesschleife* läuft weiter, solange eine
     * dieser Nächte (ab der nächsten auszuführenden) nicht leer ist.
     */
    deliveryNights: z
      .array(z.object({ night: NightKey, projects: z.number().int().min(0) }))
      .max(3)
      .optional(),
  })
  .meta({ id: 'NinaTargets' });
export type NinaTargets = z.infer<typeof NinaTargets>;
export type NinaDeepSkyProject = z.infer<typeof NinaDeepSkyProject>;
