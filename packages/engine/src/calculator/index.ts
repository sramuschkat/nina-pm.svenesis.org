/**
 * Belichtungs- und Sampling-Rechner S-23 (AP-61, `docs/specs/engine/calculator.md`, Spec-Ergänzung 01.10.2026,
 * Wunsch Sven): Himmelshintergrund je Pixel, kürzeste Einzelbelichtung, bei der das Ausleserauschen überdeckt
 * ist, Effizienz je Belichtungszeit; Abbildungsmaßstab, Bildfeld und Sampling-Einstufung je Binning. Das
 * photometrische Modell (Nullpunkte, Ersatzbandbreiten, Himmel aus Bortle, Durchlass) ist das aus transit.md §6.
 */
import {
  DEFAULT_BANDWIDTH_NM,
  DEFAULT_FILTER_TRANSMISSION_PCT,
  OPTICS_THROUGHPUT,
  PHOTON_ZERO_POINT,
  SKY_COLOUR_MAG,
  type ExposureBand,
} from '../exo/exposure';
import { pow } from '../math';

/** Himmel (+ Dunkelstrom) · t ≥ Faktor · RN² gilt als „Ausleserauschen überdeckt“ (Entscheidung Sven 01.10.2026). */
export const DEFAULT_SWAMP_FACTOR = 10;
export const MIN_SWAMP_FACTOR = 3;
export const MAX_SWAMP_FACTOR = 20;
/** Feste Zeilen der Effizienztabelle. */
export const SUB_TABLE_S: readonly number[] = [30, 60, 120, 180, 300, 600];
export const DEFAULT_SEEING_ARCSEC = 2.5;
/** FWHM in Pixeln: darunter unterabgetastet, darüber überabgetastet (Entscheidung Sven 01.10.2026). */
export const SAMPLING_UNDER_PX = 1.5;
export const SAMPLING_OVER_PX = 3.5;
const SAMPLING_TARGET_PX = 2.5;
export const CALCULATOR_BINNINGS: readonly number[] = [1, 2, 3, 4];

const ARCSEC_PER_RAD_E3 = 206.265; // ″ je µm/mm

/** Filterangaben, aus denen das Band für Nullpunkt und Himmelsfarbe folgt. */
export interface CalculatorFilter {
  readonly photometricBand: string;
  readonly filterType: string;
  readonly centerWavelengthNm: number | null;
}

/**
 * Band des Modells für einen Filter: photometrisches Band, sonst Luminanz-artige Typen → `lum`, sonst die
 * Mittenwellenlänge (< 600 nm V, < 750 nm Rc, sonst Ic), ohne Angabe V.
 */
export function calculatorBand(f: CalculatorFilter): ExposureBand {
  switch (f.photometricBand) {
    case 'U':
    case 'B':
    case 'g':
    case 'V':
      return 'V';
    case 'Rc':
    case 'r':
      return 'Rc';
    case 'Ic':
    case 'i':
    case 'z':
      return 'Ic';
    case 'clear':
    case 'lum':
      return 'lum';
  }
  if (['luminance', 'uv_ir_cut', 'light_pollution'].includes(f.filterType)) return 'lum';
  const c = f.centerWavelengthNm;
  if (c === null) return 'V';
  return c < 600 ? 'V' : c < 750 ? 'Rc' : 'Ic';
}

export interface SkyInput {
  readonly band: ExposureBand;
  readonly bandwidthNm: number | null;
  readonly transmissionPct: number | null;
  readonly apertureMm: number;
  readonly obstructionPct: number;
  /** Wirksame Brennweite (mit Reducer). */
  readonly focalLengthMm: number;
  readonly pixelSizeUm: number;
  readonly qePct: number;
  /** Himmelshelligkeit in V (mag/″²), aus Bortle oder SQM. */
  readonly skyMagArcsec2V: number;
}

export interface SkyBackground {
  readonly scaleArcsecPx: number;
  /** Himmelshelligkeit im Band (mag/″²). */
  readonly skyMagArcsec2: number;
  /** Himmel je Pixel und Sekunde (e⁻). */
  readonly skyES: number;
}

export function skyBackground(i: SkyInput): SkyBackground {
  const dCm = i.apertureMm / 10;
  const obs = i.obstructionPct / 100;
  const areaCm2 = (Math.PI / 4) * dCm * dCm * (1 - obs * obs);
  const bwA = (i.bandwidthNm ?? DEFAULT_BANDWIDTH_NM[i.band]) * 10;
  const tau =
    OPTICS_THROUGHPUT *
    ((i.transmissionPct ?? DEFAULT_FILTER_TRANSMISSION_PCT) / 100) *
    (i.qePct / 100);
  const scale = (ARCSEC_PER_RAD_E3 * i.pixelSizeUm) / i.focalLengthMm;
  const skyMag = i.skyMagArcsec2V - SKY_COLOUR_MAG[i.band];
  const skyES =
    PHOTON_ZERO_POINT[i.band] * bwA * areaCm2 * tau * pow(10, -0.4 * skyMag) * scale * scale;
  return { scaleArcsecPx: scale, skyMagArcsec2: skyMag, skyES };
}

/** Aufrunden auf 0,5 s (< 10 s), 5 s (< 60 s) bzw. 10 s – Gegenstück zu `floorExposure`. */
export function ceilExposure(s: number): number {
  if (s < 10) return Math.max(0.5, Math.ceil(s * 2) / 2);
  if (s < 60) return Math.ceil(s / 5) * 5;
  return Math.ceil(s / 10) * 10;
}

export interface SubExposureInput extends SkyInput {
  readonly readNoiseE: number;
  /** Dunkelstrom bei Betriebstemperatur (e⁻/px/s). */
  readonly darkES: number;
  /** Sättigung in e⁻; `null` = unbekannt (Spalte bleibt leer). */
  readonly saturationE: number | null;
  readonly swampFactor: number;
}

export interface SubExposureRow {
  readonly exposureS: number;
  /** Himmel + Dunkelstrom je Pixel und Aufnahme (e⁻). */
  readonly backgroundE: number;
  /** Anteil des idealen SNR² (ohne Ausleserauschen) bei gleicher Gesamtzeit, in %. */
  readonly efficiencyPct: number;
  /** Zuschlag des Ausleserauschens auf das Hintergrundrauschen, in %. */
  readonly noiseIncreasePct: number;
  /** Hintergrund in % der Sättigung, `null` ohne Sättigungswert. */
  readonly saturationPct: number | null;
  /** Die empfohlene kürzeste Belichtung. */
  readonly recommended: boolean;
}

export interface SubExposure extends SkyBackground {
  readonly darkES: number;
  readonly backgroundES: number;
  /** Ungerundete kürzeste Belichtung: Faktor · RN² / (Himmel + Dunkel). */
  readonly minSubRawS: number;
  /** Auf 0,5/5/10 s aufgerundet. */
  readonly minSubS: number;
  /** Hintergrund je Pixel, ab dem das Ausleserauschen überdeckt ist: Faktor · RN² (e⁻). */
  readonly targetBackgroundE: number;
  readonly rows: readonly SubExposureRow[];
}

export function subExposure(i: SubExposureInput): SubExposure {
  const sky = skyBackground(i);
  const bgES = sky.skyES + i.darkES;
  const rn2 = i.readNoiseE * i.readNoiseE;
  const minRaw = (i.swampFactor * rn2) / bgES;
  const minSub = ceilExposure(minRaw);
  const row = (t: number, recommended: boolean): SubExposureRow => {
    const bg = bgES * t;
    return {
      exposureS: t,
      backgroundE: bg,
      efficiencyPct: (100 * bg) / (bg + rn2),
      noiseIncreasePct: 100 * (Math.sqrt(1 + rn2 / bg) - 1),
      saturationPct:
        i.saturationE === null || !(i.saturationE > 0) ? null : (100 * bg) / i.saturationE,
      recommended,
    };
  };
  const rows = [
    ...SUB_TABLE_S.filter((t) => t !== minSub).map((t) => row(t, false)),
    row(minSub, true),
  ].sort((a, b) => a.exposureS - b.exposureS);
  return {
    ...sky,
    darkES: i.darkES,
    backgroundES: bgES,
    minSubRawS: minRaw,
    minSubS: minSub,
    targetBackgroundE: i.swampFactor * rn2,
    rows,
  };
}

export type SamplingGrade = 'under' | 'ok' | 'over';

export function samplingGrade(fwhmPx: number): SamplingGrade {
  return fwhmPx < SAMPLING_UNDER_PX ? 'under' : fwhmPx > SAMPLING_OVER_PX ? 'over' : 'ok';
}

export interface SamplingInput {
  readonly focalLengthMm: number;
  readonly pixelSizeUm: number;
  readonly widthPx: number | null;
  readonly heightPx: number | null;
  readonly seeingArcsec: number;
}

export interface SamplingRow {
  readonly binning: number;
  readonly scaleArcsecPx: number;
  readonly fwhmPx: number;
  readonly grade: SamplingGrade;
  /** Bildfeld in Bogenminuten, `null` ohne Auflösung. */
  readonly fovWidthArcmin: number | null;
  readonly fovHeightArcmin: number | null;
}

export interface Sampling {
  readonly rows: readonly SamplingRow[];
  /** Kleinstes Binning mit Einstufung *passend*, sonst das mit der FWHM am nächsten an 2,5 px. */
  readonly recommendedBinning: number;
}

export function sampling(i: SamplingInput): Sampling {
  const base = (ARCSEC_PER_RAD_E3 * i.pixelSizeUm) / i.focalLengthMm;
  const fov = (px: number | null) => (px === null || !(px > 0) ? null : (px * base) / 60);
  const rows = CALCULATOR_BINNINGS.map((binning) => {
    const scale = base * binning;
    const fwhmPx = i.seeingArcsec / scale;
    return {
      binning,
      scaleArcsecPx: scale,
      fwhmPx,
      grade: samplingGrade(fwhmPx),
      fovWidthArcmin: fov(i.widthPx),
      fovHeightArcmin: fov(i.heightPx),
    };
  });
  const ok = rows.find((r) => r.grade === 'ok');
  const closest = rows.reduce((a, b) =>
    Math.abs(b.fwhmPx - SAMPLING_TARGET_PX) < Math.abs(a.fwhmPx - SAMPLING_TARGET_PX) ? b : a,
  );
  return { rows, recommendedBinning: (ok ?? closest).binning };
}
