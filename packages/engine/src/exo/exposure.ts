/**
 * Belichtungsempfehlung für die Transitsuche (transit.md §6, Spec-Ergänzung 30.09.2026, Wunsch Sven): Belichtung
 * gegen Sättigung (FK Kap. 2 „Modus Exoplanet-Stern“) mit Obergrenzen aus Ingress-Abtastung und Nachführung; bei
 * hellen Sternen Defokus auf mindestens 30 s, dazu die Variante im Fokus. Genauigkeit je Aufnahme aus Photonen-,
 * Himmels-, Dunkel- und Ausleserauschen sowie Szintillation (Young 1967, Faktor 1,5 nach Osborn 2015).
 */
import { sinD } from '../astro/angles';
import { exp, pow } from '../math';

export type ExposureBand = 'V' | 'Rc' | 'Ic' | 'lum';

/** Photonen s⁻¹ cm⁻² Å⁻¹ bei 0 mag (Bessell 1998: f_λ·λ/hc; Luminanz über die V-Helligkeit). */
export const PHOTON_ZERO_POINT: Readonly<Record<ExposureBand, number>> = {
  V: 996,
  Rc: 702,
  Ic: 452,
  lum: 1000,
};
/** Bandbreite in nm, wenn der Filter keine hat. */
export const DEFAULT_BANDWIDTH_NM: Readonly<Record<ExposureBand, number>> = {
  V: 88,
  Rc: 138,
  Ic: 149,
  lum: 300,
};
/** Extinktion in mag je Luftmasse. */
export const EXTINCTION_MAG: Readonly<Record<ExposureBand, number>> = {
  V: 0.2,
  Rc: 0.13,
  Ic: 0.08,
  lum: 0.2,
};
/** Himmel im Band = Himmel in V minus Farbe des dunklen Himmels (V−R ≈ 0,9, V−I ≈ 1,9). */
export const SKY_COLOUR_MAG: Readonly<Record<ExposureBand, number>> = {
  V: 0,
  Rc: 0.9,
  Ic: 1.9,
  lum: 0,
};
/** Himmelshelligkeit in V (mag/″²) je Bortle-Klasse 1…9; ohne Angabe Klasse 4. */
export const BORTLE_SKY_V = [21.85, 21.6, 21.4, 20.9, 20.2, 19.5, 18.9, 18.4, 17.8] as const;
export const DEFAULT_BORTLE = 4;

/** Durchlass der Optik ohne Filter und Sensor (Spiegel, Linsen). */
export const OPTICS_THROUGHPUT = 0.7;
export const DEFAULT_FILTER_TRANSMISSION_PCT = 90;
/** Seeing im Fokus. */
export const FOCUS_FWHM_ARCSEC = 3;
/** Größte empfohlene Defokussierung. */
export const MAX_DEFOCUS_FWHM_ARCSEC = 20;
/** Spitzenpixel höchstens bei diesem Anteil der Sättigung (linearer Bereich). */
export const PEAK_TARGET = 0.5;
/** Unter dieser Belichtung wird defokussiert (Szintillation, Taktverlust durch Download). */
export const MIN_EXPOSURE_S = 30;
/** Obergrenze wegen Nachführung und Zeitauflösung. */
export const MAX_EXPOSURE_S = 180;
/** Mindestens so viele Aufnahmen je Ingress. */
export const INGRESS_POINTS = 4;
/** Photometrie-Blende: Radius = 1,5 · FWHM. */
export const APERTURE_RADIUS_FWHM = 1.5;

const FWHM_PER_SIGMA = 2.354820045;
const MMAG_PER_FRACTION = 1085.736; // 2,5 / ln 10 · 1000

export interface ExposureInput {
  readonly band: ExposureBand;
  /** Sternhelligkeit im Band (R für Rc/Ic, V für Luminanz, sonst die verwendete). */
  readonly mag: number;
  readonly depthMmag: number;
  readonly durationH: number;
  readonly rpOverRs: number | null;
  /** Dauer des Beobachtungsfensters. */
  readonly windowS: number;
  /** Höchster Stand im Fenster (Sättigung) und Höhe zur Mitte (Genauigkeit). */
  readonly altMaxDeg: number;
  readonly altMidDeg: number;
  readonly apertureMm: number;
  readonly obstructionPct: number;
  /** Wirksame Brennweite (mit Reducer). */
  readonly focalLengthMm: number;
  readonly pixelSizeUm: number;
  readonly readNoiseE: number;
  /** Sättigung in e⁻: min(Full Well, ADC-Bereich · e⁻/ADU). */
  readonly saturationE: number;
  readonly qePct: number;
  /** Dunkelstrom bei Betriebstemperatur. */
  readonly darkES: number;
  readonly bandwidthNm: number | null;
  readonly transmissionPct: number | null;
  readonly skyMagArcsec2V: number;
  readonly elevationM: number;
  readonly downloadS: number;
}

export interface ExposurePoint {
  readonly exposureS: number;
  readonly fwhmArcsec: number;
  /** Spitzenpixel als Anteil der Sättigung. */
  readonly peakFraction: number;
  readonly framesInWindow: number;
  readonly precisionMmag: number;
  /** Tiefe durch den Fehler des Mittelwerts im Transit gegen die Baseline. */
  readonly transitSnr: number;
}

export type ExposureLimit = 'saturation' | 'ingress' | 'max_exposure' | 'defocus' | 'defocus_limit';

export interface ExposureAdvice extends ExposurePoint {
  readonly defocus: boolean;
  readonly limitedBy: ExposureLimit;
  /** Variante im Fokus, wenn die Empfehlung defokussiert. */
  readonly inFocus: ExposurePoint | null;
  readonly skyMagArcsec2: number;
  readonly airmass: number;
}

/** Fehlerfunktion (Abramowitz & Stegun 7.1.26, |Fehler| < 1,5e-7). */
export function erf(x: number): number {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const poly =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return s * (1 - poly * exp(-a * a));
}

/** Anteil des Sternlichts im hellsten Pixel (Gauß, Stern mittig auf dem Pixel). */
export function peakPixelFraction(fwhmPx: number): number {
  const e = erf(0.5 / (Math.sqrt(2) * (fwhmPx / FWHM_PER_SIGMA)));
  return e * e;
}

export function airmass(altDeg: number): number {
  return 1 / sinD(Math.max(altDeg, 10));
}

export function skyMagForBortle(bortle: number | null): number {
  const cls = bortle === null ? DEFAULT_BORTLE : Math.min(9, Math.max(1, Math.floor(bortle)));
  return BORTLE_SKY_V[cls - 1] as number;
}

/** Abrunden auf 0,5 s (< 10 s), 5 s (< 60 s) bzw. 10 s. */
export function floorExposure(s: number): number {
  if (s < 10) return Math.max(0.5, Math.floor(s * 2) / 2);
  if (s < 60) return Math.floor(s / 5) * 5;
  return Math.floor(s / 10) * 10;
}

const mag = (m: number) => pow(10, -0.4 * m);

export function exposureAdvice(i: ExposureInput): ExposureAdvice {
  const dCm = i.apertureMm / 10;
  const obs = i.obstructionPct / 100;
  const areaCm2 = (Math.PI / 4) * dCm * dCm * (1 - obs * obs);
  const bwA = (i.bandwidthNm ?? DEFAULT_BANDWIDTH_NM[i.band]) * 10;
  const tau =
    OPTICS_THROUGHPUT *
    ((i.transmissionPct ?? DEFAULT_FILTER_TRANSMISSION_PCT) / 100) *
    (i.qePct / 100);
  const collect = PHOTON_ZERO_POINT[i.band] * bwA * areaCm2 * tau; // e⁻/s bei 0 mag
  const k = EXTINCTION_MAG[i.band];
  const xMax = airmass(i.altMaxDeg);
  const xMid = airmass(i.altMidDeg);
  const starPeakES = collect * mag(i.mag + k * xMax);
  const starMidES = collect * mag(i.mag + k * xMid);
  const scale = (206.265 * i.pixelSizeUm) / i.focalLengthMm; // ″/px
  const skyMag = i.skyMagArcsec2V - SKY_COLOUR_MAG[i.band];
  const skyPxES = collect * mag(skyMag) * scale * scale;
  const cycle = (t: number) => t + i.downloadS;
  const scint = 1.5 * 0.09 * pow(dCm, -2 / 3) * pow(xMid, 1.75) * exp(-i.elevationM / 8000);
  const depth = 1 - mag(i.depthMmag / 1000);
  const t14S = i.durationH * 3600;

  const saturationTime = (fwhm: number) =>
    (PEAK_TARGET * i.saturationE) /
    (starPeakES * peakPixelFraction(fwhm / scale) + skyPxES + i.darkES);

  const point = (t: number, fwhm: number): ExposurePoint => {
    const r = APERTURE_RADIUS_FWHM * fwhm;
    const sigma = fwhm / FWHM_PER_SIGMA;
    const inAperture = 1 - exp(-(r * r) / (2 * sigma * sigma));
    const npix = (Math.PI * r * r) / (scale * scale);
    const s = starMidES * inAperture * t;
    const sc = (scint / Math.sqrt(2 * t)) * s;
    const noise = Math.sqrt(
      s + npix * (skyPxES * t + i.darkES * t + i.readNoiseE * i.readNoiseE) + sc * sc,
    );
    const sigmaFrac = noise / s;
    const frames = Math.floor(i.windowS / cycle(t));
    const nIn = Math.max(1, Math.min(frames, Math.floor(t14S / cycle(t))));
    const nOut = frames - nIn;
    const meanErr = sigmaFrac * Math.sqrt(1 / nIn + (nOut > 0 ? 1 / nOut : 0));
    const peak = (starPeakES * peakPixelFraction(fwhm / scale) + skyPxES + i.darkES) * t;
    return {
      exposureS: t,
      fwhmArcsec: fwhm,
      peakFraction: peak / i.saturationE,
      framesInWindow: frames,
      precisionMmag: sigmaFrac * MMAG_PER_FRACTION,
      transitSnr: depth / meanErr,
    };
  };

  // Obergrenze: ≥ 4 Aufnahmen je Ingress (Dauer ≈ T14 · k/(1+k), k aus Rp/R★ bzw. der Tiefe) und 180 s.
  const ratio = i.rpOverRs ?? Math.sqrt(Math.max(depth, 0));
  const ingressS = (t14S * ratio) / (1 + ratio);
  const ingressCap = ingressS / INGRESS_POINTS;
  const cap = Math.min(MAX_EXPOSURE_S, ingressCap);
  const low = Math.min(MIN_EXPOSURE_S, cap);
  const tFocus = saturationTime(FOCUS_FWHM_ARCSEC);

  const common = { skyMagArcsec2: skyMag, airmass: xMid };
  if (tFocus >= low) {
    const t = floorExposure(Math.min(tFocus, cap));
    const limitedBy: ExposureLimit =
      tFocus < cap ? 'saturation' : ingressCap < MAX_EXPOSURE_S ? 'ingress' : 'max_exposure';
    return {
      ...point(t, FOCUS_FWHM_ARCSEC),
      defocus: false,
      limitedBy,
      inFocus: null,
      ...common,
    };
  }
  const inFocus = point(floorExposure(tFocus), FOCUS_FWHM_ARCSEC);
  if (saturationTime(MAX_DEFOCUS_FWHM_ARCSEC) < low) {
    const t = floorExposure(saturationTime(MAX_DEFOCUS_FWHM_ARCSEC));
    return {
      ...point(t, MAX_DEFOCUS_FWHM_ARCSEC),
      defocus: true,
      limitedBy: 'defocus_limit',
      inFocus,
      ...common,
    };
  }
  // Kleinste FWHM (auf 0,5″ aufgerundet), bei der `low` nicht sättigt – Halbierung, pf fällt mit der FWHM.
  let a = FOCUS_FWHM_ARCSEC;
  let b = MAX_DEFOCUS_FWHM_ARCSEC;
  for (let n = 0; n < 40; n++) {
    const m = (a + b) / 2;
    if (saturationTime(m) >= low) b = m;
    else a = m;
  }
  const fwhm = Math.min(MAX_DEFOCUS_FWHM_ARCSEC, Math.ceil(b * 2) / 2);
  const t = floorExposure(low);
  return { ...point(t, fwhm), defocus: true, limitedBy: 'defocus', inFocus, ...common };
}
