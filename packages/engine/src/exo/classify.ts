/**
 * Einordnung für die Ergebnisliste der Transitsuche (FA-EXO-06…08, AP-42): Größenklasse, Spektralklasse,
 * geschätzte benötigte Öffnung und Filterempfehlung samt Abbildung auf die bestätigte Filterradbelegung (NT-41).
 */
import { log10, pow } from '../math';

export type SizeClass = 'terrestrial' | 'super_earth' | 'sub_neptune' | 'neptune' | 'gas_giant';

/** Größenklasse aus dem Planetenradius in Erdradien (FA-EXO-06): < 1,25 · < 2 · < 4 · < 6 · darüber. */
export function sizeClass(radiusRe: number | null): SizeClass | null {
  if (radiusRe === null || !(radiusRe > 0)) return null;
  if (radiusRe < 1.25) return 'terrestrial';
  if (radiusRe < 2) return 'super_earth';
  if (radiusRe < 4) return 'sub_neptune';
  if (radiusRe < 6) return 'neptune';
  return 'gas_giant';
}

/** Spektralklasse aus der Effektivtemperatur (Harvard-Grenzen): O ≥ 30 000 K … M < 3 700 K. */
export function spectralClass(
  teffK: number | null,
): 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M' | null {
  if (teffK === null || !(teffK > 0)) return null;
  if (teffK >= 30000) return 'O';
  if (teffK >= 10000) return 'B';
  if (teffK >= 7500) return 'A';
  if (teffK >= 6000) return 'F';
  if (teffK >= 5200) return 'G';
  if (teffK >= 3700) return 'K';
  return 'M';
}

/** Untergrenze von ExoClock: 5″ = 127 mm. */
export const EXOCLOCK_MIN_APERTURE_MM = 127;

/**
 * Geschätzte benötigte Öffnung in mm für Planeten ohne ExoClock-Wert (FA-EXO-07 „est“; Spec-Ergänzung 30.09.2026):
 * `log10(Zoll) = 0,7364 + 0,1074·mag − 0,8967·log10(Tiefe[mmag]) − 0,3333·log10(T14[h])`, mindestens 5″.
 * Angepasst an die 646 ExoClock-Planeten über der 5″-Untergrenze (Stand 30.09.2026); über alle 776 liegen 85 %
 * innerhalb ±25 % und 99 % innerhalb ±50 % des ExoClock-Werts. `mag` ist die verwendete Sternhelligkeit
 * (R, sonst V/Gaia G/TESS T).
 */
export function estimatedApertureMm(
  mag: number | null,
  depthMmag: number | null,
  durationH: number | null,
): number | null {
  if (mag === null || depthMmag === null || !(depthMmag > 0)) return null;
  const t14 = durationH !== null && durationH > 0 ? durationH : 2;
  const inches = pow(10, 0.7364 + 0.1074 * mag - 0.8967 * log10(depthMmag) - 0.3333 * log10(t14));
  return Math.max(EXOCLOCK_MIN_APERTURE_MM, inches * 25.4);
}

export type ApertureFit = 'ok' | 'close' | 'insufficient';

/** Farbe gegen die Öffnung des Rigs (FA-EXO-07): erfüllt · ≥ 80 % · darunter. */
export function apertureFit(requiredMm: number, rigApertureMm: number): ApertureFit {
  if (rigApertureMm >= requiredMm) return 'ok';
  return rigApertureMm >= 0.8 * requiredMm ? 'close' : 'insufficient';
}

export type TransitBand = 'Rc' | 'Ic' | 'lum';

/** Schwelle „sehr roter Stern“ für Ic (Spec-Ergänzung 30.09.2026): späte K- und M-Sterne. */
export const IC_TEFF_BELOW_K = 4000;
/** Schwelle „lichtschwacher Stern“ für Luminanz/Clear (FA-EXO-08). */
export const LUM_MAG_ABOVE = 13;

/** Empfohlenes Band (FA-EXO-08): Standard Rc, sehr rote Sterne Ic, lichtschwache (> 13 mag) Luminanz/Clear. */
export function recommendedBand(teffK: number | null, mag: number | null): TransitBand {
  if (mag !== null && mag > LUM_MAG_ABOVE) return 'lum';
  if (teffK !== null && teffK > 0 && teffK < IC_TEFF_BELOW_K) return 'Ic';
  return 'Rc';
}

export interface RigFilter {
  readonly id: string;
  readonly shortName: string;
  readonly photometricBand: string;
  readonly filterType: string;
  readonly centerWavelengthNm: number | null;
}

export interface FilterChoice {
  readonly filterId: string;
  readonly shortName: string;
  /** `same_band` · Breitband-Ersatz (Hinweis *Ersatzfilter*) · Luminanz/Clear. */
  readonly match: 'same_band' | 'substitute' | 'lum';
}

/** Breitband-Rot bzw. -Grün über die Zentralwellenlänge (Spec-Ergänzung 30.09.2026): ≥ 590 nm bzw. 490–590 nm. */
function broadbandColour(f: RigFilter): 'red' | 'green' | null {
  if (f.filterType !== 'broadband' || f.centerWavelengthNm === null) return null;
  if (f.centerWavelengthNm >= 590) return 'red';
  if (f.centerWavelengthNm >= 490) return 'green';
  return null;
}

const byName = (a: RigFilter, b: RigFilter) =>
  a.shortName < b.shortName ? -1 : a.shortName > b.shortName ? 1 : a.id < b.id ? -1 : 1;

/**
 * Abbildung auf die **bestätigte** Filterradbelegung (NT-41): gleiches Band → sonst Breitband-Rot (für Rc/Ic)
 * bzw. Breitband-Grün (für V) als *Ersatzfilter* → sonst Luminanz/Clear. `null` = auf diesem Rig nicht festlegbar.
 * Kein Schmalband. Bei mehreren Treffern entscheidet der Kurzname (ordinal).
 */
export function mapBandToRig(
  band: TransitBand | 'V',
  filters: readonly RigFilter[],
): FilterChoice | null {
  const sorted = [...filters].filter((f) => f.filterType !== 'narrowband').sort(byName);
  const same = sorted.find((f) => f.photometricBand === band);
  if (same) return { filterId: same.id, shortName: same.shortName, match: 'same_band' };
  if (band !== 'lum') {
    const colour = band === 'V' ? 'green' : 'red';
    const sub = sorted.find((f) => broadbandColour(f) === colour);
    if (sub) return { filterId: sub.id, shortName: sub.shortName, match: 'substitute' };
  }
  const lum = sorted.find((f) => f.photometricBand === 'lum' || f.photometricBand === 'clear');
  return lum ? { filterId: lum.id, shortName: lum.shortName, match: 'lum' } : null;
}
