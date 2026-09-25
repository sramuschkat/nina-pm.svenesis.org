/**
 * Wetterbewertung je Stunde (specs/engine/weather.md §2/§3.1, WS-01…WS-07): 1:1 aus
 * legacy/astro-tools-2026-09-21/js/weather-core.js (WS-E1) mit genau einer Abweichung – `seeingScore`
 * normiert die Gewichte über die vorhandenen Terme (WS-04a). Wertebereich 0…1, `null` = keine Aussage;
 * gerechnet wird ungerundet, `q(x, 1e3)` erst unmittelbar vor Vergleich, Hash und Ausgabe (WS-08).
 */
import { cosD, sinD } from '../astro/angles';

export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** WS-01: Gesamtbedeckung → 0…1 (0 % → 1, 100 % → 0). */
export function cloudScore(cloudTotalPct: number | null): number | null {
  if (cloudTotalPct === null) return null;
  return clamp(1 - cloudTotalPct / 100, 0, 1);
}

/** WS-02: Vektordifferenz zweier Winde (km/h, Richtung in Grad) → km/h. */
export function windShear(
  s1Kmh: number | null,
  dir1Deg: number | null,
  s2Kmh: number | null,
  dir2Deg: number | null,
): number | null {
  if (s1Kmh === null || s2Kmh === null || dir1Deg === null || dir2Deg === null) return null;
  const du = s1Kmh * sinD(dir1Deg) - s2Kmh * sinD(dir2Deg);
  const dv = s1Kmh * cosD(dir1Deg) - s2Kmh * cosD(dir2Deg);
  return Math.sqrt(du * du + dv * dv);
}

/**
 * WS-03: `max(w250, 1,3·w500)`; fehlt einer der beiden, zählt er als 0 (1:1 aus der Vorlage, die einzige
 * Stelle mit `null → 0`); fehlen beide, `null`.
 */
export function jetKmh(wind250Kmh: number | null, wind500Kmh: number | null): number | null {
  if (wind250Kmh === null && wind500Kmh === null) return null;
  return Math.max(wind250Kmh ?? 0, 1.3 * (wind500Kmh ?? 0));
}

/** Untergrenze der Scherung nach Bodendruck (WS-03): < 750 hPa → 500, < 900 → 700, sonst 850. */
export function shearLowLevel(surfacePressureHPa: number | null): 500 | 700 | 850 {
  if (surfacePressureHPa !== null && surfacePressureHPa < 750) return 500;
  if (surfacePressureHPa !== null && surfacePressureHPa < 900) return 700;
  return 850;
}

export interface WindProfile {
  readonly surfacePressureHPa: number | null;
  readonly wind250Kmh: number | null;
  readonly windDir250Deg: number | null;
  readonly wind500Kmh: number | null;
  readonly windDir500Deg: number | null;
  readonly wind700Kmh: number | null;
  readonly windDir700Deg: number | null;
  readonly wind850Kmh: number | null;
  readonly windDir850Deg: number | null;
}

/** Scherung zwischen 250 hPa und der Untergrenze nach Bodendruck (WS-03). */
export function shearKmh(h: WindProfile): number | null {
  const low = shearLowLevel(h.surfacePressureHPa);
  const [s, d] =
    low === 500
      ? [h.wind500Kmh, h.windDir500Deg]
      : low === 700
        ? [h.wind700Kmh, h.windDir700Deg]
        : [h.wind850Kmh, h.windDir850Deg];
  return windShear(h.wind250Kmh, h.windDir250Deg, s, d);
}

/**
 * WS-04 mit der Abweichung WS-04a: fehlende Scherung bzw. fehlender Bodenwind zählen **nicht** als ruhige
 * Luft, sondern die Gewichte werden über die vorhandenen Terme normiert. Bei vollständigen Daten ist
 * `Σw = 1` und das Ergebnis bitgleich zur Vorlage.
 */
export function seeingScore(input: {
  readonly jetKmh: number | null;
  readonly shearKmh: number | null;
  readonly wind10Kmh: number | null;
}): number | null {
  if (input.jetKmh === null) return null;
  let sum = 0.45 * clamp((input.jetKmh - 20) / 110, 0, 1);
  let weight = 0.45;
  if (input.shearKmh !== null) {
    sum += 0.35 * clamp((input.shearKmh - 20) / 100, 0, 1);
    weight += 0.35;
  }
  if (input.wind10Kmh !== null) {
    sum += 0.2 * clamp((input.wind10Kmh - 8) / 25, 0, 1);
    weight += 0.2;
  }
  // Vollständig ist weight = 0,45 + 0,35 + 0,2 = 1 (auch in double exakt) → bitgleich zur Vorlage.
  return clamp(1 - sum / weight, 0, 1);
}

/** WS-04a: jeder fehlende Eingangswert des Seeings – ohne Score (`jetKmh == null`) kein Kennzeichen. */
export function seeingIncomplete(h: {
  readonly jetKmh: number | null;
  readonly wind250Kmh: number | null;
  readonly wind500Kmh: number | null;
  readonly shearKmh: number | null;
  readonly wind10Kmh: number | null;
}): boolean {
  return (
    h.jetKmh !== null &&
    (h.wind250Kmh === null || h.wind500Kmh === null || h.shearKmh === null || h.wind10Kmh === null)
  );
}

/** WS-05/WS-E2: ohne Aerosol keine Transparenz; Feuchte > 80 % und Wasserdampf > 25 mm dämpfen. */
export function transparencyScore(
  aod: number | null,
  humidityPct: number | null,
  pwvMm: number | null,
): number | null {
  if (aod === null) return null;
  let s = clamp(1 - (aod - 0.05) / 0.45, 0, 1);
  if (humidityPct !== null && humidityPct > 80) s *= clamp(1 - (humidityPct - 80) / 40, 0.5, 1);
  if (pwvMm !== null) s *= clamp(1 - (pwvMm - 25) / 150, 0.85, 1);
  return s;
}

/** WS-06: Wolken quadratisch; fehlende Terme geben ihr Gewicht ab, statt als Mittelwert zu zählen. */
export function overallScore(
  cloud: number | null,
  seeing: number | null,
  transparency: number | null,
): number | null {
  if (cloud === null) return null;
  let sum = 0.7;
  let weight = 0.7;
  if (seeing !== null) {
    sum += 0.15 * seeing;
    weight += 0.15;
  }
  if (transparency !== null) {
    sum += 0.15 * transparency;
    weight += 0.15;
  }
  return clamp((cloud * cloud * sum) / weight, 0, 1);
}

/** WS-07: Klassenschnitte, nach unten inklusiv (0 sehr schlecht … 4 ausgezeichnet). */
export const RATING_CUTS: readonly [number, number, number, number] = [0.25, 0.45, 0.65, 0.85];

/** Klasse 0…4; verglichen wird der **gerundete** Score (`q(x, 1e3)`, WS-08) – das macht der Aufrufer. */
export function ratingIndex(score: number | null): 0 | 1 | 2 | 3 | 4 | null {
  if (score === null) return null;
  const [c1, c2, c3, c4] = RATING_CUTS;
  return score >= c4 ? 4 : score >= c3 ? 3 : score >= c2 ? 2 : score >= c1 ? 1 : 0;
}
