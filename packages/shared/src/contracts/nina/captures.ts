/**
 * `POST /nina/v1/sessions/{id}/captures` (TK 6.6, 7.6; FA-SYN-04/05, FA-NIN-17, NT-10, NT-E2, NT-E3,
 * NIN5-8/9/14): ≤ 500 Meldungen je Paket (mehr → `413 capture.batch_too_large`), Lights, Flats und
 * Dark-Flats; `fileName` nur bei `result = saved` Pflicht. Antwort je Meldung mit Ingest-Status.
 */
import { z } from 'zod';
import { captureIngestStatuses, captureResults, pierSides } from '../../generated/enums';
import { Angle, NightKey, Text, UtcInstant, Uuid } from './common';

export const NINA_CAPTURE_BATCH_MAX = 500;

/**
 * Messwerte je Aufnahme aus NINAs Bild-Metadaten (NIN5-10): fehlende Werte fehlen, nie 0. Seit AP-70 (Plugin 0.4.21) auch
 * Guiding getrennt nach RA/Dec, Temperatur des Fokussierers und – flach, als Zahlen – die Werte des NINA-Wettergeräts
 * (z. B. SkyAlert) während der Aufnahme.
 */
const Metrics = z.object({
  hfr: z.number().min(0).optional(),
  stars: z.number().int().min(0).optional(),
  meanAdu: z.number().min(0).optional(),
  sensorTempC: z.number().optional(),
  setPointC: z.number().optional(),
  guidingRmsArcsec: z.number().min(0).optional(),
  rmsRaArcsec: z.number().min(0).optional(),
  rmsDecArcsec: z.number().min(0).optional(),
  altitudeDeg: z.number().min(-90).max(90).optional(),
  airmass: z.number().min(1).max(40).optional(),
  focusPosition: z.number().optional(),
  focuserTemperatureC: z.number().optional(),
  cloudCoverPct: z.number().min(0).max(100).optional(),
  skyQualityMag: z.number().optional(),
  skyBrightnessLux: z.number().min(0).optional(),
  skyTemperatureC: z.number().optional(),
  starFwhmArcsec: z.number().min(0).optional(),
  airTemperatureC: z.number().optional(),
  humidityPct: z.number().min(0).max(100).optional(),
  dewPointC: z.number().optional(),
  pressureHpa: z.number().min(0).optional(),
  windSpeedMs: z.number().min(0).optional(),
  windGustMs: z.number().min(0).optional(),
  windDirectionDeg: z.number().min(0).max(360).optional(),
});

const common = {
  id: Uuid,
  capturedAtUtc: UtcInstant,
  exposureMidUtc: UtcInstant,
  night: NightKey,
  nightPlanId: Uuid.nullable(),
  filterShortName: Text,
  filterActual: Text,
  exposureS: z.number().min(0),
  gain: z.number().int().nullable(),
  offset: z.number().int().nullable(),
  binning: z.number().int().min(1),
  readoutMode: Text.nullable(),
  readoutModeIndex: z.number().int().min(0).nullable(),
  rotatorMechDeg: Angle,
  temperatureDeviation: z.boolean(),
  result: z.enum(captureResults),
  fileName: z.string().max(512).optional(),
  metrics: Metrics.optional(),
};

/**
 * Felder nur der Lights, die `null` sein dürfen: fehlt das Feld, gilt `null`. Der C#-Client des Plugins lässt sie bei
 * `null` weg (im OpenAPI-Schema der Vereinigung optional); als Pflicht lehnte der Server sonst das ganze Paket mit
 * `422` ab – z. B. jede nicht zugeordnete Aufnahme oder `pierSide` einer Montierung ohne Pier-Seite (Analyse 04.10.2026).
 */
const lightNullable = <T extends z.ZodType>(s: T) => s.nullable().default(null);

export const NinaLightCapture = z.object({
  ...common,
  frameType: z.literal('light'),
  blockId: lightNullable(Uuid),
  projectId: lightNullable(Uuid),
  panelId: lightNullable(Uuid),
  exposureLineId: lightNullable(Uuid),
  assignment: z.literal('unassigned').optional(),
  transitObservationId: Uuid.nullable().optional(),
  raDeg: z.number().min(0).lt(360),
  decDeg: z.number().min(-90).max(90),
  rotationDeg: Angle,
  pierSide: lightNullable(z.enum(pierSides)),
  bonus: z.boolean(),
});

const calibration = {
  ...common,
  projectIds: z.array(Uuid).max(50),
  flatsPlanned: z.number().int().min(0).optional(),
  darkFlatsPlanned: z.number().int().min(0).optional(),
};
export const NinaFlatCapture = z.object({ ...calibration, frameType: z.literal('flat') });
export const NinaDarkFlatCapture = z.object({ ...calibration, frameType: z.literal('dark_flat') });

export const NinaCapture = z
  .discriminatedUnion('frameType', [NinaLightCapture, NinaFlatCapture, NinaDarkFlatCapture])
  .superRefine((c, ctx) => {
    if (c.result === 'saved' && !c.fileName)
      ctx.addIssue({ code: 'custom', path: ['fileName'], message: 'bei result = saved Pflicht' });
  });
export type NinaCapture = z.infer<typeof NinaCapture>;

export const NinaCaptureBatch = z
  .strictObject({ captures: z.array(NinaCapture).min(1).max(NINA_CAPTURE_BATCH_MAX) })
  .meta({ id: 'NinaCaptureBatch' });
export type NinaCaptureBatch = z.infer<typeof NinaCaptureBatch>;

export const NinaCaptureResults = z
  .object({
    results: z.array(z.object({ id: Uuid, status: z.enum(captureIngestStatuses) })),
  })
  .meta({ id: 'NinaCaptureResults' });
export type NinaCaptureResults = z.infer<typeof NinaCaptureResults>;
