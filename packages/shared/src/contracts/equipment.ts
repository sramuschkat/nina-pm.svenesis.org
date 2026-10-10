/**
 * Ausrüstung (AP-09a; FA-STO, FA-TEL, FA-KAM, FA-FIL, FA-BPL, FA-MON, FA-RIG-01…14; TK 7.2):
 * Standorte, Standort-Links, Teleskope, Kameras, Filter, Mondprofile, Belichtungsvorlagen, Rigs samt
 * Scheduler-Einstellungen und Filterradbelegung. Gain/Offset überall nullable (`null` = NINA-Standard,
 * NT-38). Löschen in Verwendung → `409 resource.in_use`, die Verwender stehen in `errors[]`
 * (`path` = Art, `message` = Name).
 */
import { z } from 'zod';
import {
  filterTypes,
  flatsAutoModes,
  flatsSources,
  moonModes,
  observatoryTypes,
  opticalDesigns,
  overheadSources,
  overheadValueKeys,
  photometricBands,
  playbackModes,
  strategies,
} from '../generated/enums';
import { Uuid, UtcInstant } from './common';
import { IanaTimeZone } from './tenant-settings';

const name = z.string().trim().min(1).max(120);
const notes = z.string().max(4000);
const optionalPositive = z.number().positive().nullable();
const nullableInt = z.number().int().nullable();

// ---- Standort ------------------------------------------------------------------------------------

export const SiteInput = z
  .object({
    name,
    pierName: z.string().trim().max(120).nullable().default(null),
    observatoryType: z.enum(observatoryTypes).default('open_air'),
    /** ±89,9° – Pole ausgeschlossen (AST-N18). */
    latitudeDeg: z.number().min(-89.9).max(89.9),
    /** Ost positiv (WGS84). */
    longitudeDeg: z.number().min(-180).max(180),
    elevationM: z.number().min(-430).max(9000).default(0),
    bortleClass: z.number().min(1).max(9).nullable().default(null),
    timeZone: IanaTimeZone,
    weatherSafetyUrl: z.url().max(500).nullable().default(null),
    notes: notes.default(''),
  })
  .strict()
  .meta({ id: 'SiteInput' });
export type SiteInput = z.infer<typeof SiteInput>;
/** Anlage mit Client-UUID (rules/api.md: Idempotenz). */
export const SiteCreate = SiteInput.extend({ id: Uuid }).meta({ id: 'SiteCreate' });

export const SiteView = SiteInput.extend({
  id: Uuid,
  createdAt: UtcInstant,
  updatedAt: UtcInstant,
}).meta({ id: 'SiteView' });

export const SiteLinkInput = z
  .object({
    siteId: Uuid,
    /** anydesk, rustdesk, rdp, web, … – ohne Passwörter (FA-STO-05). */
    serviceType: z.string().trim().min(1).max(40),
    name,
    remoteIdOrUrl: z.string().trim().min(1).max(500),
    notes: notes.default(''),
    isDefault: z.boolean().default(false),
  })
  .strict()
  .meta({ id: 'SiteLinkInput' });
export type SiteLinkInput = z.infer<typeof SiteLinkInput>;
export const SiteLinkCreate = SiteLinkInput.extend({ id: Uuid }).meta({ id: 'SiteLinkCreate' });
export const SiteLinkView = SiteLinkInput.extend({ id: Uuid, createdAt: UtcInstant }).meta({
  id: 'SiteLinkView',
});

// ---- Teleskop ------------------------------------------------------------------------------------

export const TelescopeInput = z
  .object({
    name,
    brand: z.string().max(120).default(''),
    model: z.string().max(120).default(''),
    opticalDesign: z.enum(opticalDesigns),
    apertureMm: z.number().positive(),
    focalLengthMm: z.number().positive(),
    /** 1,0 = kein Reducer (AST-G08). */
    reducerFactor: z.number().positive().default(1),
    obstructionPct: z.number().min(0).max(100).default(0),
    imageCircleMm: optionalPositive.default(null),
    backfocusMm: optionalPositive.default(null),
    weightKg: optionalPositive.default(null),
    notes: notes.default(''),
  })
  .strict()
  .meta({ id: 'TelescopeInput' });
export type TelescopeInput = z.infer<typeof TelescopeInput>;
export const TelescopeCreate = TelescopeInput.extend({ id: Uuid }).meta({ id: 'TelescopeCreate' });
export const TelescopeView = TelescopeInput.extend({
  id: Uuid,
  createdAt: UtcInstant,
  updatedAt: UtcInstant,
}).meta({ id: 'TelescopeView' });

// ---- Kamera --------------------------------------------------------------------------------------

export const GainMode = z
  .object({
    name: z.string().trim().min(1).max(60),
    gain: z.number().int(),
    readNoiseE: z.number().nonnegative().nullable().default(null),
    fullWellE: z.number().positive().nullable().default(null),
    ePerAdu: z.number().positive().nullable().default(null),
  })
  .strict();

const cameraFields = z
  .object({
    name,
    brand: z.string().max(120).default(''),
    model: z.string().max(120).default(''),
    sensorName: z.string().max(120).default(''),
    widthPx: z.number().int().positive(),
    heightPx: z.number().int().positive(),
    pixelSizeUm: z.number().positive(),
    bitDepth: z.number().int().min(8).max(32).default(16),
    isCooled: z.boolean().default(true),
    /** Kühl-Soll in °C; `null` = keine Prüfung (NT-E2). */
    coolingSetpointC: z.number().min(-60).max(40).nullable().default(null),
    coolingToleranceC: z.number().positive().default(1),
    isColor: z.boolean().default(false),
    readNoiseE: z.number().nonnegative().nullable().default(null),
    fullWellE: z.number().positive().nullable().default(null),
    gainEPerAdu: z.number().positive().nullable().default(null),
    quantumEfficiencyPct: z.number().min(0).max(100).nullable().default(80),
    darkCurrentES20c: z.number().nonnegative().nullable().default(0.005),
    /** `null` = NINA-Standard (NT-38). */
    defaultGain: nullableInt.default(null),
    defaultOffset: nullableInt.default(null),
    defaultBinning: z.number().int().min(1).max(4).default(1),
    /** Exakt wie im Treiber – das Plugin löst per Name auf (FA-KAM-04). */
    defaultReadoutMode: z.string().max(60).default('Default'),
    supportedBinning: z.array(z.number().int().min(1).max(4)).min(1).max(4).default([1, 2]),
    gainModes: z.array(GainMode).max(20).default([]),
    readoutModes: z.array(z.string().trim().min(1).max(60)).min(1).max(20).default(['Default']),
    notes: notes.default(''),
  })
  .strict();

function checkCamera(
  c: Pick<
    z.infer<typeof cameraFields>,
    'supportedBinning' | 'defaultBinning' | 'readoutModes' | 'defaultReadoutMode'
  >,
  ctx: z.RefinementCtx,
): void {
  if (new Set(c.supportedBinning).size !== c.supportedBinning.length)
    ctx.addIssue({ code: 'custom', path: ['supportedBinning'], message: 'doppelt' });
  if (!c.supportedBinning.includes(c.defaultBinning))
    ctx.addIssue({
      code: 'custom',
      path: ['defaultBinning'],
      message: 'nicht in supportedBinning',
    });
  if (!c.readoutModes.includes(c.defaultReadoutMode))
    ctx.addIssue({
      code: 'custom',
      path: ['defaultReadoutMode'],
      message: 'nicht in readoutModes',
    });
}

export const CameraInput = cameraFields.superRefine(checkCamera).meta({ id: 'CameraInput' });
export type CameraInput = z.infer<typeof CameraInput>;
export const CameraCreate = cameraFields
  .extend({ id: Uuid })
  .superRefine(checkCamera)
  .meta({ id: 'CameraCreate' });

export const CameraView = z
  .object({
    id: Uuid,
    name: z.string(),
    brand: z.string(),
    model: z.string(),
    sensorName: z.string(),
    widthPx: z.number().int(),
    heightPx: z.number().int(),
    pixelSizeUm: z.number(),
    bitDepth: z.number().int(),
    isCooled: z.boolean(),
    coolingSetpointC: z.number().nullable(),
    coolingToleranceC: z.number(),
    isColor: z.boolean(),
    readNoiseE: z.number().nullable(),
    fullWellE: z.number().nullable(),
    gainEPerAdu: z.number().nullable(),
    quantumEfficiencyPct: z.number().nullable(),
    darkCurrentES20c: z.number().nullable(),
    defaultGain: z.number().int().nullable(),
    defaultOffset: z.number().int().nullable(),
    defaultBinning: z.number().int(),
    defaultReadoutMode: z.string(),
    supportedBinning: z.array(z.number().int()),
    gainModes: z.array(GainMode),
    readoutModes: z.array(z.string()),
    /** Vom Plugin gemeldete Modi/Gain-Grenzen (FA-KAM-07); `null` = noch nichts gemeldet. */
    ninaReported: z.unknown().nullable(),
    notes: z.string(),
    createdAt: UtcInstant,
    updatedAt: UtcInstant,
  })
  .meta({ id: 'CameraView' });

// ---- Mondprofil ----------------------------------------------------------------------------------

/**
 * Validierung nach moon.md §1 (AST-M8): minAlt < maxAlt, W ≥ 0, A ≥ 0, relax ≥ 0, 0 ≤ maxIllum ≤ 100.
 * `moonMaxAltDeg` ist die Höhe, **ab der** der volle Abstand gilt (gegenüber Astro PM invertiert);
 * `relaxScale` ist Grad je Grad, **kein** Multiplikator (AST-M2).
 */
const moonProfileFields = z
  .object({
    name,
    description: z.string().max(1000).default(''),
    separationDeg: z.number().min(0).max(180),
    widthDays: z.number().min(0),
    relaxScale: z.number().min(0),
    moonMinAltDeg: z.number().min(-90).max(90),
    moonMaxAltDeg: z.number().min(-90).max(90),
    maxIlluminationPct: z.number().min(0).max(100),
    moonMustBeDown: z.boolean().default(false),
  })
  .strict();
const minBelowMax = (p: { moonMinAltDeg: number; moonMaxAltDeg: number }, ctx: z.RefinementCtx) => {
  if (!(p.moonMinAltDeg < p.moonMaxAltDeg))
    ctx.addIssue({ code: 'custom', path: ['moonMinAltDeg'], message: 'minAlt < maxAlt' });
};
export const MoonProfileInput = moonProfileFields
  .superRefine(minBelowMax)
  .meta({ id: 'MoonProfileInput' });
export type MoonProfileInput = z.infer<typeof MoonProfileInput>;
export const MoonProfileCreate = moonProfileFields
  .extend({ id: Uuid })
  .superRefine(minBelowMax)
  .meta({ id: 'MoonProfileCreate' });
export const MoonProfileView = z
  .object({
    id: Uuid,
    name: z.string(),
    description: z.string(),
    separationDeg: z.number(),
    widthDays: z.number(),
    relaxScale: z.number(),
    moonMinAltDeg: z.number(),
    moonMaxAltDeg: z.number(),
    maxIlluminationPct: z.number(),
    moonMustBeDown: z.boolean(),
    /** Mitgeliefert: nicht änderbar, nicht löschbar, aber klonbar (FA-MON-02). */
    isBuiltIn: z.boolean(),
    createdAt: UtcInstant,
  })
  .meta({ id: 'MoonProfileView' });

// ---- Filter --------------------------------------------------------------------------------------

export const FilterInput = z
  .object({
    /** Anzeige- und Planungsschlüssel (FA-FIL-01), eindeutig je Mandant. */
    shortName: z.string().trim().min(1).max(20),
    fullName: z.string().max(120).default(''),
    brand: z.string().max(120).default(''),
    filterType: z.enum(filterTypes),
    telescopeId: Uuid.nullable().default(null),
    size: z.string().max(40).nullable().default(null),
    shape: z.string().max(40).nullable().default(null),
    mountType: z.string().max(40).nullable().default(null),
    bandwidthNm: optionalPositive.default(null),
    centerWavelengthNm: optionalPositive.default(null),
    photometricBand: z.enum(photometricBands).default('none'),
    transmissionPct: z.number().min(0).max(100).nullable().default(null),
    thicknessMm: optionalPositive.default(null),
    colorHex: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default('#CCCCCC'),
    defaultOnNewProject: z.boolean().default(false),
    defaultExposureS: optionalPositive.default(null),
    defaultMoonProfileId: Uuid.nullable().default(null),
    notes: notes.default(''),
  })
  .strict()
  .meta({ id: 'FilterInput' });
export type FilterInput = z.infer<typeof FilterInput>;
export const FilterCreate = FilterInput.extend({ id: Uuid }).meta({ id: 'FilterCreate' });
export const FilterView = FilterInput.extend({
  id: Uuid,
  createdAt: UtcInstant,
  updatedAt: UtcInstant,
}).meta({ id: 'FilterView' });

// ---- Belichtungsvorlage --------------------------------------------------------------------------

export const TemplateLine = z
  .object({
    filterId: Uuid,
    exposureS: z.number().positive(),
    plannedCount: z.number().int().min(0),
    gain: nullableInt.default(null),
    offsetAdu: nullableInt.default(null),
    binning: z.number().int().min(1).max(4).default(1),
    readoutMode: z.string().max(60).nullable().default(null),
    moonMode: z.enum(moonModes).default('profile'),
    moonProfileId: Uuid.nullable().default(null),
    enabled: z.boolean().default(true),
  })
  .strict()
  .refine((l) => l.moonMode !== 'profile' || l.moonProfileId !== null, {
    path: ['moonProfileId'],
    message: 'Mondprofil fehlt',
  });

export const ExposureTemplateInput = z
  .object({
    name,
    telescopeId: Uuid.nullable().default(null),
    cameraId: Uuid.nullable().default(null),
    notes: notes.default(''),
    lines: z.array(TemplateLine).max(50).default([]),
  })
  .strict()
  .meta({ id: 'ExposureTemplateInput' });
export type ExposureTemplateInput = z.infer<typeof ExposureTemplateInput>;
export const ExposureTemplateCreate = ExposureTemplateInput.extend({ id: Uuid }).meta({
  id: 'ExposureTemplateCreate',
});
export const ExposureTemplateView = z
  .object({
    id: Uuid,
    name: z.string(),
    telescopeId: Uuid.nullable(),
    cameraId: Uuid.nullable(),
    notes: z.string(),
    lines: z.array(
      z.object({
        id: Uuid,
        filterId: Uuid.nullable(),
        filterShortName: z.string(),
        exposureS: z.number(),
        plannedCount: z.number().int(),
        gain: z.number().int().nullable(),
        offsetAdu: z.number().int().nullable(),
        binning: z.number().int(),
        readoutMode: z.string().nullable(),
        moonMode: z.enum(moonModes),
        moonProfileId: Uuid.nullable(),
        enabled: z.boolean(),
      }),
    ),
    createdAt: UtcInstant,
    updatedAt: UtcInstant,
  })
  .meta({ id: 'ExposureTemplateView' });

// ---- Rig -----------------------------------------------------------------------------------------

export const RigInput = z
  .object({
    name,
    siteId: Uuid,
    telescopeId: Uuid,
    cameraId: Uuid,
    showInPlanning: z.boolean().default(true),
    ninaDeliveryEnabled: z.boolean().default(true),
    defaultTemplateId: Uuid.nullable().default(null),
    /** Ohne Rotator der feste Kamerawinkel (FA-RIG-10). */
    defaultRotationDeg: z.number().min(0).lt(360).nullable().default(null),
    hasRotator: z.boolean().default(false),
    rotationToleranceDeg: z.number().min(0).max(90).default(5),
    skipOnRotationMismatch: z.boolean().default(false),
    sessionReportDiscord: z.boolean().default(false),
    notes: notes.default(''),
  })
  .strict()
  .meta({ id: 'RigInput' });
export type RigInput = z.infer<typeof RigInput>;
export const RigCreate = RigInput.extend({ id: Uuid }).meta({ id: 'RigCreate' });

export type Overhead = z.infer<typeof Overhead>;
export const Overhead = z
  .object({
    slewCenterS: z.number().min(0).max(3600).default(120),
    filterChangeS: z.number().min(0).max(600).default(10),
    ditherSettleS: z.number().min(0).max(600).default(20),
    /** `0` = kein zeitgesteuerter Autofokus. */
    afEveryMin: z.number().min(0).max(1440).default(60),
    afDurationS: z.number().min(0).max(3600).default(180),
    downloadS: z.number().min(0).max(600).default(5),
  })
  .strict();

/**
 * Gemessener Overhead-Wert (AP-65, FA-RIG-04b): Median, Anzahl und Streuung (p25–p75) der letzten 40 Messungen aus dem
 * Ist der Nächte des Rigs, in Sekunden. `measuredOverheads` in `packages/shared` rechnet ihn.
 */
export const MeasuredOverheadStat = z
  .object({
    medianS: z.number().min(0),
    n: z.number().int().min(0),
    p25S: z.number().min(0),
    p75S: z.number().min(0),
  })
  .meta({ id: 'MeasuredOverheadStat' });
export type MeasuredOverheadStat = z.infer<typeof MeasuredOverheadStat>;

/**
 * Messung je Rig (AP-65): nach jedem Sessionabschluss (`session_close`) über die letzten 30 Nächte gerechnet und an der
 * abgeschlossenen Session gespeichert (`session.kpis.measuredOverhead`). `null` je Wert = keine Messung.
 */
export const MeasuredOverheads = z
  .object({
    computedAtUtc: UtcInstant,
    fromNight: z.iso.date(),
    toNight: z.iso.date(),
    /** Nächte mit Sessions ab Plugin 0.4.13 (`block_start` vorhanden), die in die Messung eingingen. */
    nights: z.number().int().min(0),
    values: z.object({
      slewCenterS: MeasuredOverheadStat.nullable(),
      filterChangeS: MeasuredOverheadStat.nullable(),
      ditherSettleS: MeasuredOverheadStat.nullable(),
      afDurationS: MeasuredOverheadStat.nullable(),
      downloadS: MeasuredOverheadStat.nullable(),
      flipDurationS: MeasuredOverheadStat.nullable(),
    }),
  })
  .meta({ id: 'MeasuredOverheads' });
export type MeasuredOverheads = z.infer<typeof MeasuredOverheads>;

/** Ein Overhead-Wert in S-10 (AP-65): getippt, gemessen, wirksam, Schalter „fest“, Hinweis bei großer Abweichung. */
export const RigOverheadValue = z
  .object({
    key: z.enum(overheadValueKeys),
    typedS: z.number(),
    measured: MeasuredOverheadStat.nullable(),
    /** Wert in der Engine-Eingabe (ganze Sekunden bei `measured`). */
    effectiveS: z.number(),
    source: z.enum(overheadSources),
    fixed: z.boolean(),
    /** Gemessen (ab `minSamples`) mehr als doppelt bzw. weniger als halb so groß wie getippt. */
    deviates: z.boolean(),
  })
  .meta({ id: 'RigOverheadValue' });
export type RigOverheadValue = z.infer<typeof RigOverheadValue>;

export const RigOverheadsView = z
  .object({
    /** Ab so vielen Messungen wirkt der gemessene Wert (10). */
    minSamples: z.number().int(),
    computedAtUtc: UtcInstant.nullable(),
    fromNight: z.iso.date().nullable(),
    toNight: z.iso.date().nullable(),
    nights: z.number().int(),
    values: z.array(RigOverheadValue),
  })
  .meta({ id: 'RigOverheadsView' });
export type RigOverheadsView = z.infer<typeof RigOverheadsView>;

/**
 * Grenzwerte der Bildbewertung je Rig (AP-72b, FA-AUS-25; Entscheidung Sven 09.10.2026), `null` = aus. HFR und Sterne
 * relativ zum Median desselben Projekts und Filters, RMS und Wolken absolut. Die Bewertung fließt nur in die Anteile der
 * Sessionqualität ein (AP-77); den Modus „beim Eingang verwerfen“ gibt es nicht mehr (ein gespeichertes `mode` wird
 * beim Lesen ignoriert).
 */
export const ImageQualitySettings = z
  .object({
    /** Markieren, wenn HFR mehr als so viele % über dem Median liegt. */
    hfrPct: z.number().min(1).max(500).nullable(),
    /** Markieren, wenn die Sternzahl unter so vielen % des Medians liegt. */
    starsPct: z.number().min(1).max(100).nullable(),
    rmsArcsec: z.number().min(0.1).max(20).nullable(),
    cloudPct: z.number().min(0).max(100).nullable(),
  })
  .strict()
  .meta({ id: 'ImageQualitySettings' });
export type ImageQualitySettings = z.infer<typeof ImageQualitySettings>;

/**
 * Scheduler-Einstellungen je Rig (FA-RIG-04, FA-SCH, flip-rotation.md §1). Die Sortierkette ist hier
 * bewusst eine Liste freier Zeichenketten: unbekannte oder doppelte Schlüssel ergeben
 * `422 rig.sort_chain_invalid` (sort-chain.md), `maxAfter < after` ergibt `422 rig.flip_settings_invalid`.
 */
export const SchedulerSettings = z
  .object({
    strategy: z.enum(strategies),
    playback: z.enum(playbackModes),
    sortChain: z.array(z.string().max(40)).max(8),
    bonusEnabled: z.boolean(),
    overshootPct: z.number().min(0).max(100),
    mosaicPanelsIndependent: z.boolean(),
    ditherEnabled: z.boolean(),
    ditherEvery: z.number().int().min(1).max(100),
    filterSwitchEnabled: z.boolean(),
    filterSwitchEvery: z.number().int().min(1).max(100),
    filterSwitchTolerancePct: z.number().min(0).max(100),
    flatsEnabled: z.boolean(),
    flatsFullSet: z.boolean(),
    flatCount: z.number().int().min(1).max(500),
    darkFlatsEnabled: z.boolean(),
    /** `null` = wie `flatCount` (FA-SCH-08). */
    darkFlatCount: z.number().int().min(1).max(500).nullable(),
    flatsSource: z.enum(flatsSources),
    /**
     * Auto-Flats je Projekt (AP-50b): `off` = Flats nach jeder Nacht für alle Kombinationen; `once_per_project` = nur
     * Kombinationen ohne Flats im Projekt; `time_based` = zusätzlich, wenn die letzten älter als `flatsAutoIntervalDays` sind.
     */
    flatsAutoMode: z.enum(flatsAutoModes).default('off'),
    flatsAutoIntervalDays: z.number().int().min(1).max(30).default(7),
    flipEnabled: z.boolean(),
    flipAfterMeridianMin: z.number().min(0).max(120),
    flipMaxAfterMeridianMin: z.number().min(0).max(240),
    flipPauseBeforeMeridianMin: z.number().min(0).max(120),
    flipDurationS: z.number().min(0).max(3600),
    overhead: Overhead,
    /**
     * Overhead-Werte, für die immer der getippte Wert gilt (AP-65, Schalter „fest“ in S-10); sonst wirkt ab 10 Messungen
     * der gemessene Median. Fehlt das Feld beim Speichern, bleibt die gespeicherte Auswahl.
     */
    overheadFixed: z
      .array(z.enum(overheadValueKeys))
      .max(overheadValueKeys.length)
      .refine((a) => new Set(a).size === a.length, { message: 'doppelt' })
      .optional(),
    /** Bildbewertung (AP-72b); fehlt das Feld beim Speichern, bleibt die gespeicherte (Standard: Startwerte). */
    imageQuality: ImageQualitySettings.optional(),
  })
  .strict()
  .meta({ id: 'SchedulerSettings' });
export type SchedulerSettings = z.infer<typeof SchedulerSettings>;

export const FilterWheelSlot = z
  .object({
    position: z.number().int().min(1).max(20),
    filterId: Uuid.nullable(),
    /** Bestätigter NINA-Name; `null` = nicht zugeordnet. */
    ninaFilterName: z.string().max(60).nullable(),
    ninaConfirmedAt: UtcInstant.nullable(),
    ninaConfirmedBy: Uuid.nullable(),
  })
  .meta({ id: 'FilterWheelSlot' });

export const RigView = RigInput.extend({
  id: Uuid,
  scheduler: SchedulerSettings,
  filterWheel: z.array(FilterWheelSlot),
  /** Erhöht bei jeder Änderung (Sync an NINA); auch als `ETag`. */
  settingsVersion: z.number().int(),
  /**
   * Overheads getippt/gemessen/wirksam (AP-65, FA-RIG-04b, S-10). Ändert sich nur die Messung, ändern sich weder
   * `settingsVersion` noch das Ziele-ETag; fehlt das Feld, gelten die getippten Werte.
   */
  overheads: RigOverheadsView.optional(),
  derived: z.object({
    effFocalMm: z.number(),
    scaleArcsecPx: z.number(),
    fovWidthDeg: z.number(),
    fovHeightDeg: z.number(),
  }),
  createdAt: UtcInstant,
  updatedAt: UtcInstant,
}).meta({ id: 'RigView' });

/** `PUT /rigs/{id}/filter-wheel` (nur Admin/Owner): bestätigt die Zuordnung je Platz. */
export const FilterWheelPut = z
  .object({
    slots: z
      .array(
        z
          .object({
            position: z.number().int().min(1).max(20),
            filterId: Uuid.nullable(),
            ninaFilterName: z.string().trim().min(1).max(60).nullable(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict()
  .refine((w) => new Set(w.slots.map((s) => s.position)).size === w.slots.length, {
    path: ['slots'],
    message: 'Position doppelt',
  })
  .meta({ id: 'FilterWheelPut' });
export type FilterWheelPut = z.infer<typeof FilterWheelPut>;

export const FilterWheelView = z
  .object({
    slots: z.array(
      FilterWheelSlot.extend({
        /** Vom Plugin an diesem Platz gemeldeter Name (letzter Heartbeat). */
        reportedName: z.string().nullable(),
        /** Vorschlag der Heuristik für den NINA-Namen zum Web-Filter dieses Platzes, sonst `null`. */
        suggestion: z.string().nullable(),
        /** Web-Filter, dessen Kurzname zum gemeldeten NINA-Namen passt (für Plätze ohne Filter). */
        suggestedFilterId: Uuid.nullable(),
        /** unbestätigt, weil NINA an diesem Platz inzwischen etwas anderes meldet. */
        changedByNina: z.boolean(),
      }),
    ),
    reported: z
      .object({
        slots: z.array(
          z.object({
            position: z.number().int(),
            name: z.string(),
            focusOffset: z.number().nullable(),
          }),
        ),
        reportedAt: UtcInstant.nullable(),
      })
      .nullable(),
    settingsVersion: z.number().int(),
  })
  .meta({ id: 'FilterWheelView' });

/**
 * Vorgeschlagene Filter-Offsets (AP-72, FA-RIG-20): aus den erfolgreichen Autofokus-Läufen (`af`) der letzten Nächte je
 * NINA-Filter, Regression Position gegen Temperatur mit gemeinsamer Steigung. Offset relativ zum Bezugsfilter (L, sonst
 * der Filter mit den meisten Läufen); ein Vorschlag erst ab `minRuns` Läufen. `ninaOffset` = von NINA gemeldeter Offset.
 */
export const FocusOffsetsView = z
  .object({
    rigId: Uuid,
    fromNight: z.iso.date(),
    toNight: z.iso.date(),
    minRuns: z.number().int().min(1),
    totalRuns: z.number().int().min(0),
    reference: z.string().nullable(),
    slopePerC: z.number().nullable(),
    referenceTemperatureC: z.number().nullable(),
    /** NINA meldet an allen Plätzen Offset 0 (mindestens zwei Filter) – Offsets noch nicht eingetragen. */
    ninaWithoutOffsets: z.boolean(),
    filters: z.array(
      z.object({
        filter: z.string(),
        /** Kurzname des Web-Filters am Platz mit diesem NINA-Namen, sonst `null`. */
        shortName: z.string().nullable(),
        position: z.number().int().nullable(),
        runs: z.number().int().min(0),
        positionAtRef: z.number(),
        offset: z.number().int().nullable(),
        scatter: z.number().nullable(),
        ninaOffset: z.number().nullable(),
        lastRunAt: UtcInstant.nullable(),
      }),
    ),
  })
  .meta({ id: 'FocusOffsetsView' });
export type FocusOffsetsView = z.infer<typeof FocusOffsetsView>;

// ---- Nacht-Tabelle -------------------------------------------------------------------------------

export const NightsQuery = z.object({
  from: z.iso.date().optional(),
  count: z.coerce.number().int().min(1).max(400).default(60),
});

export const SiteNightsView = z
  .object({
    currentNight: z.iso.date(),
    tzdataVersion: z.string(),
    timeZoneTransitions: z.array(
      z.object({ atUtc: UtcInstant, utcOffsetMinutes: z.number().int() }),
    ),
    nights: z.array(
      z.object({
        night: z.iso.date(),
        noonStartUtc: UtcInstant,
        noonEndUtc: UtcInstant,
        nightWindowEndUtc: UtcInstant,
      }),
    ),
  })
  .meta({ id: 'SiteNightsView' });

/**
 * Stammdaten in einem Aufruf (`GET /web/v1/equipment`, `equipment.read`; 01.10.2026): die sechs Listen, die fast
 * jede Seite braucht. Vorher je Liste ein Aufruf – ein Seitenaufruf belegte so bis zu 20 Lambda-Instanzen
 * (Alarm 5xx 30.09.2026). Der Web-Client bündelt gleichzeitige `list(kind)` hierauf.
 */
export const EquipmentBundle = z
  .object({
    sites: z.array(SiteView),
    telescopes: z.array(TelescopeView),
    cameras: z.array(CameraView),
    filters: z.array(FilterView),
    moonProfiles: z.array(MoonProfileView),
    rigs: z.array(RigView),
  })
  .meta({ id: 'EquipmentBundle' });
export type EquipmentBundle = z.infer<typeof EquipmentBundle>;
