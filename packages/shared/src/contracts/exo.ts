/**
 * Transitsuche S-22 (AP-42; FA-EXO-01…14, FK 14.3): `GET /api/web/v1/exo/transits` rechnet für ein Rig und eine
 * Nacht alle Transits der gewählten Kataloge (zusammengeführt ExoClock → NASA → TOI, FA-EXO-03) mit der Engine
 * (`predictTransits`, transit.md §2). Gefiltert wird in der Oberfläche (FA-EXO-05), damit Schalter sofort wirken.
 */
import { z } from 'zod';
import { twilight } from '../generated/enums';
import { NightKey, UtcInstant, Uuid } from './common';

export const EXO_CATALOG_NAMES = ['exoclock', 'nasa', 'toi'] as const;
export type ExoCatalogName = (typeof EXO_CATALOG_NAMES)[number];

export const ExoTransitQuery = z.object({
  rigId: Uuid,
  /** Nacht-Schlüssel; ohne Angabe die laufende Nacht des Standorts (FA-EXO-01, NT-01). */
  night: NightKey.optional(),
  /** Kommagetrennt, Standard alle drei (FA-EXO-02). */
  catalogs: z
    .string()
    .regex(/^(exoclock|nasa|toi)(,(exoclock|nasa|toi))*$/)
    .optional(),
  /** Mindesthöhe für die Beobachtbarkeit (FA-EXO-05, Standard 30°). */
  minAltDeg: z.coerce.number().min(0).max(90).default(30),
  /** Dämmerungsgrenze; die Suche läuft nautisch (transit.md §2), Projekte astronomisch. */
  twilight: z.enum(twilight).default('nautical'),
  /** Puffer in σ (FA-EXO-12). */
  k: z.coerce.number().int().min(1).max(3).default(1),
});
export type ExoTransitQuery = z.infer<typeof ExoTransitQuery>;

const ExoExposurePoint = z.object({
  exposureS: z.number(),
  fwhmArcsec: z.number(),
  /** Spitzenpixel in Prozent der Sättigung (Full Well bzw. ADC-Bereich). */
  peakPct: z.number(),
  framesInWindow: z.number().int(),
  precisionMmag: z.number(),
  transitSnr: z.number(),
});

/** Warum keine Empfehlung möglich ist: fehlende Angaben an Teleskop, Kamera, Filterwahl oder Katalog. */
export const EXO_EXPOSURE_MISSING = [
  'telescope',
  'camera_noise',
  'camera_saturation',
  'filter',
  'magnitude',
  'depth',
] as const;

/** Belichtungsempfehlung für das Rig (transit.md §6, Spec-Ergänzung 30.09.2026). */
export const ExoExposure = z.discriminatedUnion('status', [
  ExoExposurePoint.extend({
    status: z.literal('ok'),
    filterShortName: z.string(),
    /** `false` = Web-Filter eines noch nicht bestätigten Filterradplatzes (Ersatz, transit.md §6). */
    filterConfirmed: z.boolean(),
    /** Standard-Gain der Kamera; `null` = NINA-Standard. */
    gain: z.number().int().nullable(),
    defocus: z.boolean(),
    limitedBy: z.enum(['saturation', 'ingress', 'max_exposure', 'defocus', 'defocus_limit']),
    /** Variante im Fokus (3″), wenn die Empfehlung defokussiert. */
    inFocus: ExoExposurePoint.nullable(),
    skyMagArcsec2: z.number(),
    bortle: z.number().nullable(),
    airmass: z.number(),
  }),
  z.object({
    status: z.literal('missing'),
    missing: z.array(z.enum(EXO_EXPOSURE_MISSING)).min(1),
  }),
]);
export type ExoExposure = z.infer<typeof ExoExposure>;

export const ExoTransitView = z
  .object({
    /** `<catalog>:<planet>:<n>` – eindeutig je Nacht. */
    key: z.string(),
    planet: z.string(),
    star: z.string(),
    catalog: z.enum(EXO_CATALOG_NAMES),
    /** Weitere Kataloge desselben Planeten (FA-EXO-03). */
    alsoIn: z.array(z.enum(EXO_CATALOG_NAMES)),
    disposition: z.string().nullable(),
    priority: z.enum(['alert', 'high', 'medium', 'low']).nullable(),
    ticId: z.string().nullable(),
    raDeg: z.number(),
    decDeg: z.number(),
    sizeClass: z
      .enum(['terrestrial', 'super_earth', 'sub_neptune', 'neptune', 'gas_giant'])
      .nullable(),
    radiusRe: z.number().nullable(),
    distancePc: z.number().nullable(),
    teffK: z.number().nullable(),
    spectralClass: z.enum(['O', 'B', 'A', 'F', 'G', 'K', 'M']).nullable(),
    /** Verwendete Helligkeit und ihr Band (V, R, G = Gaia G, T = TESS). */
    mag: z.number().nullable(),
    magBand: z.string().nullable(),
    depthMmag: z.number().nullable(),
    depthEstimated: z.boolean(),
    durationH: z.number(),
    durationEstimated: z.boolean(),
    periodD: z.number(),
    rpOverRs: z.number().nullable(),
    aOverRs: z.number().nullable(),
    inclinationDeg: z.number().nullable(),
    /** Letzte O−C aus dem Katalog (ExoClock), Minuten. */
    ocMin: z.number().nullable(),
    timeSystemSource: z.string(),
    t0BjdTdb: z.number(),
    fetchedAt: UtcInstant,
    transit: z.object({
      n: z.number().int(),
      tcBjdTdb: z.number(),
      tcUtc: UtcInstant,
      ingressUtc: UtcInstant,
      egressUtc: UtcInstant,
      windowStartUtc: UtcInstant,
      windowEndUtc: UtcInstant,
      sigmaS: z.number(),
      bufferS: z.number(),
      baselineBeforeMin: z.number(),
      baselineAfterMin: z.number(),
      ocAppliedMin: z.number().nullable(),
      timeSystemUncertain: z.boolean(),
      ephemerisAge: z.enum(['ok', 'uncertain', 'stale']),
      observable: z.boolean(),
      usableFraction: z.number(),
      fullyObservable: z.boolean(),
      /** An Ingress − 1 h bzw. Egress + 1 h (Filter „Start/Ende …“, FA-EXO-19; Entscheidung Sven 30.09.2026). */
      startDark: z.boolean(),
      endDark: z.boolean(),
      startAboveMinAlt: z.boolean(),
      endAboveMinAlt: z.boolean(),
      baselineInTwilight: z.boolean(),
      meridianUtc: UtcInstant.nullable(),
      /** Kulmination im Fenster inkl. Baseline (rote Markierung, FA-EXO-11). */
      meridianInWindow: z.boolean(),
      /** Kulmination zwischen Ingress − 1 h und Egress + 1 h (Filter „Transits mit Flip ausblenden“). */
      meridianNearTransit: z.boolean(),
      altAtIngressDeg: z.number(),
      altAtCenterDeg: z.number(),
      altAtEgressDeg: z.number(),
      /** Mondabstand (topozentrisch) und Beleuchtung zur Transitmitte. */
      moonSepDeg: z.number(),
      moonIllumPct: z.number(),
    }),
    aperture: z
      .object({
        requiredMm: z.number(),
        /** `true` = eigene Schätzung („est“, FA-EXO-07), sonst ExoClock. */
        estimated: z.boolean(),
        /** Gegen die Öffnung des Rigs; `null`, wenn das Teleskop keine Öffnung hat. */
        fit: z.enum(['ok', 'close', 'insufficient']).nullable(),
      })
      .nullable(),
    filter: z.object({
      band: z.enum(['Rc', 'Ic', 'lum']),
      /** Filter der bestätigten Filterradbelegung; `null` = auf diesem Rig nicht festlegbar (FA-EXO-08). */
      choice: z
        .object({
          filterId: Uuid,
          shortName: z.string(),
          match: z.enum(['same_band', 'substitute', 'lum']),
        })
        .nullable(),
    }),
    /** Belichtungsempfehlung für das Rig (transit.md §6). */
    exposure: ExoExposure,
    /** Eigene Exoplaneten-Projekte zu diesem Planeten (Spalte „Meine Beob.“). */
    myProjects: z.number().int(),
  })
  .meta({ id: 'ExoTransitView' });
export type ExoTransitView = z.infer<typeof ExoTransitView>;

export const ExoTransitList = z
  .object({
    rig: z.object({ id: Uuid, name: z.string(), apertureMm: z.number().nullable() }),
    site: z.object({
      id: Uuid,
      name: z.string(),
      timeZone: z.string(),
      latDeg: z.number(),
      lonDeg: z.number(),
    }),
    night: NightKey,
    currentNight: NightKey,
    /** Nachtfenster (FK 8.1) der Suche. */
    nightStartUtc: UtcInstant,
    nightEndUtc: UtcInstant,
    minAltDeg: z.number(),
    twilight: z.enum(twilight),
    /** Stand je Katalog (FA-EXO-04, S-22 zeigt nur das Datum des letzten Abrufs). */
    catalogs: z.array(
      z.object({
        catalog: z.enum(EXO_CATALOG_NAMES),
        rows: z.number().int(),
        fetchedAt: UtcInstant.nullable(),
      }),
    ),
    items: z.array(ExoTransitView),
  })
  .meta({ id: 'ExoTransitList' });
export type ExoTransitList = z.infer<typeof ExoTransitList>;

/** Filter der Transitsuche, je Benutzer gespeichert (FA-EXO-05, Einstellung `exo.search`). */
export const ExoSearchSettings = z
  .object({
    catalogs: z.array(z.enum(EXO_CATALOG_NAMES)).min(1),
    priority: z.enum(['all', 'alert', 'high', 'medium']),
    maxMag: z.number().min(5).max(20),
    minDepthMmag: z.number().min(0).max(100),
    minAltDeg: z.number().min(0).max(90),
    observableOnly: z.boolean(),
    startEndDark: z.boolean(),
    startEndAboveMinAlt: z.boolean(),
    showFlip: z.boolean(),
    hideFlip: z.boolean(),
  })
  .strict()
  .meta({ id: 'ExoSearchSettings' });
export type ExoSearchSettings = z.infer<typeof ExoSearchSettings>;

export const EXO_SEARCH_DEFAULTS: ExoSearchSettings = {
  catalogs: ['exoclock'],
  priority: 'all',
  maxMag: 14,
  minDepthMmag: 3,
  minAltDeg: 30,
  observableOnly: true,
  startEndDark: false,
  startEndAboveMinAlt: false,
  showFlip: true,
  hideFlip: false,
};
