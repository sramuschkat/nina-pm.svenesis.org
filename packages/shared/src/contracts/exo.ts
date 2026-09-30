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

// ---- Exoplaneten-Projekt (AP-42 Teil 2; FA-EXO-15/16/17) ----------------------------------------------

/**
 * `POST /api/web/v1/exo/projects`: Projekt aus einer Ergebniszeile der Suche (FA-EXO-15). Der Server liest den
 * Katalogeintrag selbst (Ephemeride, Kenndaten) und traut dem Client nur Planet, Rig und Suchfilter.
 * Eindeutig je Planet, Rig und Ersteller (OP-22): Gibt es das eigene Projekt schon, kommt es zurück (`created: false`).
 */
export const ExoProjectCreate = z
  .object({
    /** Client-ID des neuen Projekts; Wiederholung mit derselben ID ist idempotent (rules/api.md). */
    id: Uuid,
    rigId: Uuid,
    catalog: z.enum(EXO_CATALOG_NAMES),
    planet: z.string().trim().min(1).max(120),
    /** Dämmerungsgrenze und Mindesthöhe aus dem Suchfilter (FA-EXO-05). */
    twilight: z.enum(twilight).default('nautical'),
    minAltDeg: z.number().min(0).max(90).default(30),
    /** Vorbelegung der Transit-Zeile aus der Belichtungsempfehlung (FA-EXO-14a); sonst 60 s. */
    exposureS: z.number().positive().max(3600).nullable().default(null),
  })
  .strict()
  .meta({ id: 'ExoProjectCreate' });
export type ExoProjectCreate = z.infer<typeof ExoProjectCreate>;

export const ExoProjectCreated = z
  .object({ projectId: Uuid, created: z.boolean() })
  .meta({ id: 'ExoProjectCreated' });
export type ExoProjectCreated = z.infer<typeof ExoProjectCreated>;

/** Am Projekt gespeicherte Ephemeride (FA-EXO-16); die aktive rechnet, die übrigen sind Historie. */
export const ExoEphemerisView = z
  .object({
    id: Uuid,
    t0BjdTdb: z.number(),
    t0SigmaD: z.number().nullable(),
    periodD: z.number(),
    periodSigmaD: z.number().nullable(),
    durationH: z.number().nullable(),
    durationEstimated: z.boolean(),
    timeSystemSource: z.string(),
    ocMin: z.number().nullable(),
    depthMmag: z.number().nullable(),
    rpOverRs: z.number().nullable(),
    /** Katalog, aus dem die Ephemeride stammt. */
    source: z.string(),
    /** Katalogstand (Abrufdatum). */
    sourceDate: NightKey.nullable(),
    active: z.boolean(),
    createdAt: UtcInstant,
  })
  .meta({ id: 'ExoEphemerisView' });
export type ExoEphemerisView = z.infer<typeof ExoEphemerisView>;

/**
 * Neuerer Katalogstand als Angebot (FA-EXO-16): Änderung von T₀ und P und deren Wirkung auf die nächste
 * Transitmitte. `null`, wenn der Katalog dieselbe Ephemeride führt oder den Planeten nicht mehr kennt.
 */
export const ExoEphemerisUpdate = z
  .object({
    catalog: z.enum(EXO_CATALOG_NAMES),
    t0BjdTdb: z.number(),
    t0SigmaD: z.number().nullable(),
    periodD: z.number(),
    periodSigmaD: z.number().nullable(),
    fetchedAt: UtcInstant,
    /** P neu − P alt in Sekunden. */
    periodDeltaS: z.number(),
    /** Nächste Transitmitte nach der neuen Ephemeride und ihre Verschiebung gegenüber der alten (min). */
    nextMidUtc: UtcInstant,
    nextMidShiftMin: z.number(),
  })
  .meta({ id: 'ExoEphemerisUpdate' });
export type ExoEphemerisUpdate = z.infer<typeof ExoEphemerisUpdate>;

/** `GET /api/web/v1/projects/{id}/exo`: Reiter *Exoplanet-Transit* im Projekt-Editor (FA-EXO-15…17). */
export const ExoProjectDetail = z
  .object({
    projectId: Uuid,
    planet: z.string(),
    star: z.string(),
    catalog: z.enum(EXO_CATALOG_NAMES),
    baselineBeforeMin: z.number().int(),
    baselineAfterMin: z.number().int(),
    /** Puffer in σ (FA-EXO-12). */
    bufferSigma: z.number(),
    ephemeris: ExoEphemerisView,
    /** Frühere Ephemeriden, neueste zuerst. */
    history: z.array(ExoEphemerisView),
    catalogUpdate: ExoEphemerisUpdate.nullable(),
    /** Exoplaneten-Projekte anderer Mitglieder zum selben Planeten (FA-EXO-15, Hinweis mit Link). */
    others: z.array(
      z.object({
        projectId: Uuid,
        name: z.string(),
        createdByName: z.string(),
        rigName: z.string().nullable(),
      }),
    ),
    /** Rig des Projekts (bzw. Wunsch-Rig); ohne Rig keine Vorhersage. */
    rig: z.object({ id: Uuid, name: z.string(), apertureMm: z.number().nullable() }).nullable(),
    site: z
      .object({
        id: Uuid,
        name: z.string(),
        timeZone: z.string(),
        latDeg: z.number(),
        lonDeg: z.number(),
      })
      .nullable(),
    minAltDeg: z.number(),
    twilight: z.enum(twilight),
    /** Erste Nacht der Vorhersage (laufende Nacht) und Zahl der Nächte. */
    fromNight: NightKey.nullable(),
    nights: z.number().int(),
    /** Beobachtbare Transits der nächsten Nächte aus der gespeicherten Ephemeride (FA-EXO-17), je mit Nacht. */
    upcoming: z.array(z.object({ night: NightKey, item: ExoTransitView })),
  })
  .meta({ id: 'ExoProjectDetail' });
export type ExoProjectDetail = z.infer<typeof ExoProjectDetail>;
