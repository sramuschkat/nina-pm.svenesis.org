/**
 * Reine Regeln für Sitzungsprotokoll und Klarnacht-Statistik (AP-30; FA-AUS-15…17). Ohne Datenbank und ohne
 * Uhr – Server und Tests rechnen damit dasselbe.
 */
import type {
  ClearNightNight,
  SessionLogField,
  SessionLogValues,
  SessionLogView,
} from './contracts/session-log';
import { SESSION_LOG_FIELDS, USABLE_NIGHT_MIN_HOURS } from './contracts/session-log';
import type { SessionLogSource } from './generated/enums';

interface Stat {
  avg: number | null;
  min: number | null;
  max: number | null;
}

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

/**
 * NINA-Bedingungen (`session.nina_conditions`, Plugin-Schlüssel frei bis 64 Zeichen) auf die Felder des
 * Protokolls: `sqm`, `ambientTempC`/`temperatureC`, `humidityPct`, `windMs` (→ km/h) bzw. `windKmh`,
 * `seeingArcsec`/`starFwhmArcsec`. Unbekannte Schlüssel werden ignoriert.
 */
export function ninaStats(raw: unknown): SessionLogView['nina'] {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const stat = (key: string, factor = 1): Stat | null => {
    const v = src[key];
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    const n = (x: unknown) =>
      typeof x === 'number' && Number.isFinite(x) ? round1(x * factor) : null;
    const s = { avg: n(o.avg), min: n(o.min), max: n(o.max) };
    return s.avg === null && s.min === null && s.max === null ? null : s;
  };
  return {
    sqm: stat('sqm'),
    temperatureC: stat('ambientTempC') ?? stat('temperatureC'),
    humidityPct: stat('humidityPct'),
    windKmh: stat('windMs', 3.6) ?? stat('windKmh'),
    seeingArcsec: stat('seeingArcsec') ?? stat('starFwhmArcsec'),
  };
}

/** Repräsentativer NINA-Wert: Mittel, sonst Maximum (Wind), sonst Minimum. */
const ninaValue = (s: Stat | null) => (s ? (s.avg ?? s.max ?? s.min) : null);

export const EMPTY_SESSION_LOG: SessionLogValues = {
  startTime: null,
  endTime: null,
  seeingArcsec: null,
  transparencyPct: null,
  sqm: null,
  temperatureC: null,
  humidityPct: null,
  windKmh: null,
  cloudsNote: null,
  moonIlluminationPct: null,
  weatherNotes: '',
  notesMd: '',
};

/** Vorhersage-Werte, die das Protokoll vorschlägt (Teil von `ForecastSnapshot` bzw. `SessionLogView.forecast`). */
export type ForecastSuggestion = Pick<
  ForecastSnapshot,
  'transparencyPct' | 'temperatureC' | 'humidityPct' | 'windKmh' | 'cloudPct'
>;

export interface LogSuggestion {
  readonly value: number | string;
  readonly source: SessionLogSource;
}
export type LogSuggestions = Partial<Record<SessionLogField, readonly LogSuggestion[]>>;

/** Wolken als Notiz „NN %“. */
export const cloudsNote = (cloudPct: number) => `${String(Math.round(cloudPct))} %`;

/**
 * Vorschläge je Feld aus NINA und Vorhersage, NINA zuerst (FA-AUS-15). Seeing nur aus NINA – die Vorhersage
 * kennt keine Bogensekunden.
 */
export function logSuggestions(
  forecast: ForecastSuggestion | null,
  nina: SessionLogView['nina'],
): LogSuggestions {
  const out: Partial<Record<SessionLogField, LogSuggestion[]>> = {};
  const put = (field: SessionLogField, value: number | string | null, source: SessionLogSource) => {
    if (value !== null) (out[field] ??= []).push({ value, source });
  };
  put('sqm', ninaValue(nina.sqm), 'nina');
  put('temperatureC', ninaValue(nina.temperatureC), 'nina');
  put('humidityPct', ninaValue(nina.humidityPct), 'nina');
  put('windKmh', ninaValue(nina.windKmh), 'nina');
  put('seeingArcsec', ninaValue(nina.seeingArcsec), 'nina');
  if (forecast) {
    put('transparencyPct', forecast.transparencyPct, 'forecast');
    put('temperatureC', forecast.temperatureC, 'forecast');
    put('humidityPct', forecast.humidityPct, 'forecast');
    put('windKmh', forecast.windKmh, 'forecast');
    put(
      'cloudsNote',
      forecast.cloudPct === null ? null : cloudsNote(forecast.cloudPct),
      'forecast',
    );
  }
  return out;
}

/**
 * Vorbelegung ohne gespeichertes Protokoll: Beginn/Ende und Mondphase automatisch, Messwerte aus NINA,
 * sonst aus der Vorhersage; Seeing nur aus NINA (die Vorhersage kennt keine Bogensekunden).
 */
export function prefillSessionLog(input: {
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly forecast: ForecastSnapshot | null;
  readonly nina: SessionLogView['nina'];
}): { values: SessionLogValues; sources: SessionLogView['sources'] } {
  const values: SessionLogValues = { ...EMPTY_SESSION_LOG };
  const sources = Object.fromEntries(SESSION_LOG_FIELDS.map((f) => [f, null])) as Record<
    SessionLogField,
    SessionLogSource | null
  >;
  values.startTime = input.startedAt;
  sources.startTime = 'auto';
  if (input.endedAt) {
    values.endTime = input.endedAt;
    sources.endTime = 'auto';
  }
  if (input.forecast?.moonIllumPct !== null && input.forecast?.moonIllumPct !== undefined) {
    values.moonIlluminationPct = round1(input.forecast.moonIllumPct);
    sources.moonIlluminationPct = 'auto';
  }
  for (const [field, list] of Object.entries(logSuggestions(input.forecast, input.nina)) as [
    SessionLogField,
    readonly LogSuggestion[],
  ][]) {
    const first = list[0];
    if (!first) continue;
    (values as Record<string, unknown>)[field] = first.value;
    sources[field] = first.source;
  }
  return { values, sources };
}

const sameValue = (a: unknown, b: unknown) =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 0.05 : a === b;

/**
 * Quellen beim Speichern: ein unveränderter Wert behält seine bisherige Quelle, ein Wert gleich einem
 * Vorschlag (NINA/Vorhersage) erhält dessen Quelle; jeder andere nicht leere Wert ist *manuell*. Server
 * und Oberfläche (Vorschau der Kennzeichen) rechnen damit dasselbe.
 */
export function sourcesOnSave(
  values: SessionLogValues,
  previous: {
    values: SessionLogValues;
    /** Im Web aus dem OpenAPI-Typ: Schlüssel optional. */
    sources: Partial<Record<SessionLogField, SessionLogSource | null>>;
  },
  suggestions: LogSuggestions = {},
): SessionLogView['sources'] {
  const out = {} as Record<SessionLogField, SessionLogSource | null>;
  for (const field of SESSION_LOG_FIELDS) {
    const v = values[field];
    if (v === null || v === '') {
      out[field] = null;
      continue;
    }
    const before = previous.sources[field];
    if (before && sameValue(v, previous.values[field])) {
      out[field] = before;
      continue;
    }
    out[field] = suggestions[field]?.find((x) => sameValue(v, x.value))?.source ?? 'manual';
  }
  return out;
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
 * Treffsicherheit der Vorhersage (FA-AUS-16): Nächte mit Session und Schnappschuss; Treffer, wenn
 * „klar vorhergesagt“ und nutzbar bzw. nicht klar vorhergesagt und nicht nutzbar.
 */
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
