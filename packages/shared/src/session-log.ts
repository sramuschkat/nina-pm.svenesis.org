/**
 * Reine Regeln für Wetter-Schnappschuss und Klarnacht-Statistik (AP-30; FA-AUS-16/17). Ohne Datenbank und ohne
 * Uhr – Server und Tests rechnen damit dasselbe.
 */
import type { ClearNightNight } from './contracts/session-log';
import { USABLE_NIGHT_MIN_HOURS } from './contracts/session-log';

/** Wetter-Schnappschuss zum Sessionbeginn (`session.forecast_snapshot`): Mittel der dunklen Stunden. */
export interface ForecastSnapshot {
  readonly night: string;
  readonly fetchedAtUtc: string | null;
  readonly hours: number;
  readonly cloudPct: number | null;
  readonly transparencyPct: number | null;
  readonly seeingScore: number | null;
  readonly temperatureC: number | null;
  readonly humidityPct: number | null;
  readonly windKmh: number | null;
  readonly ratingIndex: number | null;
  readonly nightMean: number | null;
  readonly moonIllumPct: number | null;
}

/** Stunde der Vorhersage mit den Feldern, die der Schnappschuss mittelt. */
export interface ForecastHour {
  readonly tUtc: string;
  readonly cloudTotalPct: number | null;
  readonly transparencyScore: number | null;
  readonly seeingScore: number | null;
  readonly tempC: number | null;
  readonly humidityPct: number | null;
  readonly wind10Kmh: number | null;
}

const HOUR_MS = 3_600_000;
const round1 = (v: number) => Math.round(v * 10) / 10;
const mean = (xs: readonly (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x !== null && Number.isFinite(x));
  return v.length === 0 ? null : round1(v.reduce((s, x) => s + x, 0) / v.length);
};

/**
 * Schnappschuss aus der Stundenreihe: alle Stunden, die das astronomisch dunkle Fenster der Nacht
 * überlappen (Entscheidung Sven 26.09.2026: Mittel der dunklen Stunden). Ohne dunkles Fenster oder ohne
 * Stunden darin `null`.
 */
export function forecastSnapshot(input: {
  readonly night: string;
  readonly darkFromUtc: string | null;
  readonly darkToUtc: string | null;
  readonly hours: readonly ForecastHour[];
  readonly ratingIndex: number | null;
  readonly nightMean: number | null;
  readonly moonIllumPct: number | null;
  readonly fetchedAtUtc: string | null;
}): ForecastSnapshot | null {
  if (!input.darkFromUtc || !input.darkToUtc) return null;
  const from = Date.parse(input.darkFromUtc);
  const to = Date.parse(input.darkToUtc);
  const hours = input.hours.filter((h) => {
    const t = Date.parse(h.tUtc);
    return t + HOUR_MS > from && t < to;
  });
  if (hours.length === 0) return null;
  const pct = (v: number | null) => (v === null ? null : v * 100);
  return {
    night: input.night,
    fetchedAtUtc: input.fetchedAtUtc,
    hours: hours.length,
    cloudPct: mean(hours.map((h) => h.cloudTotalPct)),
    transparencyPct: mean(hours.map((h) => pct(h.transparencyScore))),
    seeingScore: (() => {
      const m = mean(hours.map((h) => h.seeingScore));
      return m === null ? null : Math.min(1, Math.max(0, m));
    })(),
    temperatureC: mean(hours.map((h) => h.tempC)),
    humidityPct: mean(hours.map((h) => h.humidityPct)),
    windKmh: mean(hours.map((h) => h.wind10Kmh)),
    ratingIndex: input.ratingIndex,
    nightMean: input.nightMean,
    moonIllumPct: input.moonIllumPct,
  };
}

// ---- Klarnacht-Statistik ----------------------------------------------------------------------------

/** Nutzbar ab 1 h akzeptierter Lights (Entscheidung Sven 26.09.2026). */
export const isUsableNight = (usableHours: number) => usableHours >= USABLE_NIGHT_MIN_HOURS;

/** Monatszeilen (Monat des Nacht-Schlüssels) aus den Nächten mit Angabe. */
export function clearNightMonths(nights: readonly ClearNightNight[]) {
  const by = new Map<string, { recorded: number; usable: number; hours: number[] }>();
  for (const n of nights) {
    if (n.source === null || n.usable === null) continue;
    const month = n.night.slice(0, 7);
    const m = by.get(month) ?? { recorded: 0, usable: 0, hours: [] };
    m.recorded += 1;
    if (n.usable) {
      m.usable += 1;
      if (n.usableHours !== null) m.hours.push(n.usableHours);
    }
    by.set(month, m);
  }
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, m]) => ({
      month,
      recorded: m.recorded,
      usable: m.usable,
      usablePct: m.recorded === 0 ? null : Math.round((m.usable / m.recorded) * 1000) / 10,
      meanUsableHours:
        m.hours.length === 0
          ? null
          : Math.round((m.hours.reduce((s, h) => s + h, 0) / m.hours.length) * 10) / 10,
    }));
}

/** Klasse *Gut* (FA-WET-03, Index 3) und besser gilt als „klar vorhergesagt“. */
export const GOOD_RATING_INDEX = 3;

/**
 * Treffsicherheit der Vorhersage (FA-AUS-16): Nächte mit Session und Vorhersage (Schnappschuss, sonst gespeicherte
 * Vorhersage der Nacht); Treffer, wenn „klar vorhergesagt“ und nutzbar bzw. nicht klar vorhergesagt und nicht
 * nutzbar. Nächte ohne Session zählen nicht: Ohne Session ist nichts beobachtet (AP-64b, FA-AUS-16 „Vorhersage vs.
 * gemessen/beobachtet“); sie erscheinen im Kalender als „klar, aber nicht genutzt“.
 */
/** Treffsicherheit der Vorhersage laut Bildern (AP-72, FA-AUS-24): Bewertung ≥ *Gut* ⇔ Nacht überwiegend klar. */
export function imagesForecastAccuracy(nights: readonly ClearNightNight[]) {
  let compared = 0;
  let hits = 0;
  for (const n of nights) {
    if (!n.imagesClarity || n.forecastRatingIndex === null) continue;
    compared += 1;
    if (n.forecastRatingIndex >= GOOD_RATING_INDEX === (n.imagesClarity === 'clear')) hits += 1;
  }
  return {
    compared,
    hits,
    hitPct: compared === 0 ? null : Math.round((hits / compared) * 1000) / 10,
  };
}

export function forecastAccuracy(nights: readonly ClearNightNight[]) {
  let compared = 0;
  let hits = 0;
  for (const n of nights) {
    if (n.source !== 'session' || n.usable === null || n.forecastRatingIndex === null) continue;
    compared += 1;
    if (n.forecastRatingIndex >= GOOD_RATING_INDEX === n.usable) hits += 1;
  }
  return {
    compared,
    hits,
    hitPct: compared === 0 ? null : Math.round((hits / compared) * 1000) / 10,
  };
}
