/**
 * Transittiefe und -dauer beim Katalogimport (transit.md §1, AST-D1/D2; AP-40).
 * Tiefe je Quelle in ihrer Einheit, gespeichert in mmag – **nichtlinear**: `−2500·log10(1 − Anteil)`.
 * Kontrollwerte: 1 % = 10 000 ppm = 10,912 mmag · 0,2 % = 2,174 mmag · 3 % = 33,071 mmag.
 */
import { asin, cos, log10, sin } from '../math';
import { RAD } from '../astro/angles';

export const EXO_DEPTH_UNITS = ['percent', 'ppm', 'mmag'] as const;
export type ExoDepthUnit = (typeof EXO_DEPTH_UNITS)[number];

function fractionToMmag(fraction: number): number | null {
  if (!(fraction > 0) || !(fraction < 1)) return null;
  return -2500 * log10(1 - fraction);
}

/** Tiefe in mmag aus Rohwert und Quelleinheit; `null` bei fehlendem, nicht positivem oder unmöglichem Wert. */
export function depthMmag(value: number | null, unit: ExoDepthUnit): number | null {
  if (value === null || !Number.isFinite(value) || !(value > 0)) return null;
  switch (unit) {
    case 'mmag':
      return value;
    case 'percent':
      return fractionToMmag(value / 100);
    case 'ppm':
      return fractionToMmag(value / 1e6);
  }
}

/**
 * **Geometrische** Tiefe `(Rp/R★)²` in mmag – nur Ersatzwert mit Kennzeichen *geschätzt*: ohne Randverdunklung
 * bis rund 20 % zu flach (HAT-P-17 b: 16,63 gegen 20,37 mmag).
 */
export function geometricDepthMmag(rpOverRs: number | null): number | null {
  if (rpOverRs === null || !Number.isFinite(rpOverRs)) return null;
  return fractionToMmag(rpOverRs * rpOverRs);
}

/**
 * Transitdauer T14 in Stunden aus der Geometrie (Seager & Mallén-Ornelas 2003, Kreisbahn):
 * `T14 = P/π · asin( √((1 + k)² − b²) / (a/R★ · sin i) )`, `b = a/R★ · cos i`.
 * `null`, wenn eine Größe fehlt oder der Planet den Stern nicht bedeckt (`b ≥ 1 + k`).
 */
export function transitDurationH(
  periodD: number,
  aOverRs: number | null,
  rpOverRs: number | null,
  inclinationDeg: number | null,
): number | null {
  if (aOverRs === null || rpOverRs === null || inclinationDeg === null) return null;
  if (!(periodD > 0) || !(aOverRs > 1) || !(rpOverRs > 0)) return null;
  const i = RAD * inclinationDeg;
  const b = aOverRs * cos(i);
  const chord2 = (1 + rpOverRs) * (1 + rpOverRs) - b * b;
  const sinI = sin(i);
  if (!(chord2 > 0) || !(sinI > 0)) return null;
  const arg = Math.min(1, Math.sqrt(chord2) / (aOverRs * sinI));
  return ((periodD * 24) / Math.PI) * asin(arg);
}
