/**
 * Reine Anzeigeregeln des Bausteins `WeatherChart` (components.md §2.5, WS-17): Farbrampen, Ampel,
 * Windstufen, Taugefahr, Hilfsbewertungen der Zellfarbe, Modellkürzel, Wettersymbole. Nichts hiervon
 * bewertet eine Stunde – die Scores kommen fertig aus der Engine (`engine/weather.md`).
 */
import { formatZonedTime } from '@nina-pm/shared';
import {
  WEATHER,
  WEATHER_NEUTRAL,
  WEATHER_RAMP,
  WEATHER_RATING_STOPS,
  WEATHER_WIND_MAX,
  WEATHER_WIND_STEPS,
} from '@nina-pm/ui-tokens';
import type { weatherIcons } from '../icons';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rgb = (c: readonly number[]) => `rgb(${c.map((v) => String(v)).join(', ')})`;

export const NO_DATA = WEATHER['wx-no-data'] ?? '#262c34';

/** Teilbewertungs-Rampe: `kanal = round(schlecht + (gut − schlecht) · s)`; `null` → „keine Daten“. */
export function scoreColour(s: number | null): string {
  if (s === null) return NO_DATA;
  const { bad, good } = WEATHER_RAMP;
  return rgb(bad.map((b, i) => Math.round(b + ((good[i] ?? b) - b) * s)));
}

/** Tintenschwelle 0,55: weiße Schrift erst auf dunklem Blau. */
export function inkColour(s: number | null): string {
  return s !== null && s > 0.55
    ? (WEATHER['wx-ink-light'] ?? '#fff')
    : (WEATHER['wx-ink-dark'] ?? '#1b2633');
}

/** Ampel der Gesamtnote, eingeblendet in den neutralen Grund mit `k` (0 = Tag, 1 = Dunkelheit). */
export function ratingColour(s: number | null, k: number): string {
  if (s === null || k <= 0) return rgb(WEATHER_NEUTRAL);
  let c: readonly number[] = WEATHER_NEUTRAL;
  for (let i = 1; i < WEATHER_RATING_STOPS.length; i += 1) {
    const [a, ca] = WEATHER_RATING_STOPS[i - 1] as (typeof WEATHER_RATING_STOPS)[number];
    const [b, cb] = WEATHER_RATING_STOPS[i] as (typeof WEATHER_RATING_STOPS)[number];
    if (s <= b) {
      const f = (s - a) / (b - a);
      c = ca.map((v, j) => v + ((cb[j] ?? v) - v) * f);
      break;
    }
  }
  return rgb(WEATHER_NEUTRAL.map((v, j) => Math.round(v + ((c[j] ?? v) - v) * clamp(k, 0, 1))));
}

/** Einblendung nach Sonnenhöhe: 0 bei −12° (nautisch), 1 ab −18° (astronomisch). */
export const daylightFade = (sunAltDeg: number) => clamp((-sunAltDeg - 12) / 6, 0, 1);

/** Windstufen 10/20/30/40 km/h (obere Grenze inklusiv); `null` → „keine Daten“. */
export function windColour(kmh: number | null): string {
  if (kmh === null) return NO_DATA;
  for (const [max, color] of WEATHER_WIND_STEPS) if (kmh <= max) return color;
  return WEATHER_WIND_MAX;
}

/** Taugefahr aus dem Taupunktabstand (°C): ≤ 2 rot, ≤ 4 orange (Schwellen bleiben in °C). */
export function dewRisk(tempC: number | null, dewPointC: number | null): 'danger' | 'warn' | null {
  if (tempC === null || dewPointC === null) return null;
  const spread = tempC - dewPointC;
  return spread <= 2 ? 'danger' : spread <= 4 ? 'warn' : null;
}

/** Hilfsbewertungen – **nur** Zellfarbe, ohne Wirkung auf irgendeinen Score. */
export const helperScore = {
  pwv: (mm: number) => clamp(1 - (mm - 10) / 40, 0, 1),
  dust: (ug: number) => clamp(1 - ug / 100, 0, 1),
  visibility: (m: number) => clamp((m / 1000 - 1) / 19, 0, 1),
  precipProb: (pct: number) => clamp(1 - pct / 100, 0, 1),
  /** Wolken einer Anzeigezeile (Schichten, Vergleichsmodelle) in derselben Rampe. */
  cloud: (pct: number) => clamp(1 - pct / 100, 0, 1),
} as const;

/** Stützwerte der Skala in Worten: Anzeigemittelpunkte der Klassen, keine Schwellen. */
export const SCALE_STEPS: readonly (readonly [score: number, rating: 0 | 1 | 2 | 3 | 4])[] = [
  [0.92, 4],
  [0.75, 3],
  [0.55, 2],
  [0.35, 1],
  [0.12, 0],
];

/** Modellkürzel je `modelId` (lang / kurz); unbekannter Wert → der rohe Wert. */
export const MODEL_NAMES: Readonly<Record<string, readonly [string, string]>> = {
  d2: ['ICON-D2', 'D2'],
  eu: ['ICON-EU', 'EU'],
  global: ['ICON global', 'IG'],
  dini: ['HARMONIE', 'HA'],
  hrrr: ['HRRR', 'HR'],
  gem: ['GEM', 'GEM'],
  gfs: ['GFS', 'GFS'],
};

export function modelName(id: string, short = false): string {
  const names = MODEL_NAMES[id];
  if (!names) return id;
  return short ? names[1] : names[0];
}

export type WeatherIconKey = keyof typeof weatherIcons;

/** WMO-Code → Symbol (Zuordnung wie `wxSymbol` der Vorlage); nachts Mond statt Sonne. */
export function weatherIconKey(code: number | null, night: boolean): WeatherIconKey | null {
  if (code === null) return null;
  if (code >= 95) return 'thunder';
  if (code >= 85 || (code >= 71 && code <= 77)) return 'snow';
  if (code >= 61) return 'rain';
  if (code >= 51) return night ? 'rain' : 'drizzle';
  if (code >= 45) return 'fog';
  if (code === 3) return 'cloudy';
  if (code === 2) return night ? 'cloudy' : 'partlyDay';
  if (code === 1) return night ? 'partlyNight' : 'partlyDay';
  return night ? 'clearNight' : 'clearDay';
}

/** WMO-Code → Textschlüssel `weather.wx.<key>` (Tooltip und Textalternative). */
export function weatherTextKey(code: number | null): string | null {
  if (code === null) return null;
  if (code >= 95) return 'thunder';
  if (code >= 85) return 'snowShowers';
  if (code >= 80) return 'showers';
  if (code >= 71) return 'snow';
  if (code >= 61) return 'rain';
  if (code >= 51) return 'drizzle';
  if (code >= 45) return 'fog';
  return (['clear', 'mainlyClear', 'partly', 'overcast'] as const)[code] ?? 'overcast';
}

export const unix = (iso: string) => Date.parse(iso) / 1000;

/** Stunde (0–23) in der Zone – nur Anzeige. */
export function localHour(unixSec: number, timeZone: string): number {
  return Number(formatZonedTime(new Date(unixSec * 1000), timeZone).slice(0, 2));
}

/** Kalendertag `YYYY-MM-DD` in der Zone – nur Anzeige (Tagesbalken). */
export function localDay(unixSec: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(unixSec * 1000));
}

/** Temperatur in der Anzeigeeinheit; die Taugefahr-Schwellen bleiben in °C. */
export const toUnit = (c: number | null, unit: 'c' | 'f') =>
  c === null ? null : unit === 'f' ? (c * 9) / 5 + 32 : c;
