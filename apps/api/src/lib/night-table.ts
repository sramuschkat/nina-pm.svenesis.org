/**
 * Nacht-Tabelle des Servers (NT-02, specs/engine/night.md §1): Zeitzonen-Übergänge aus den tzdata der
 * Laufzeit (`Intl`, nur hier auf dem Server), Nachtgrenzen und `nightWindowEndUtc` aus der Engine,
 * `currentNight` aus `packages/shared`. Browser und Plugin rechnen ausschließlich mit dieser Tabelle.
 */
import {
  EngineInputError,
  nightBounds,
  nightTimes,
  type TimeZoneTransition,
} from '@nina-pm/engine';
import { currentNight, ProblemError } from '@nina-pm/shared';
import { isoUtc } from './format';

const DAY = 86_400_000;
/** So weit sucht die Tabelle rückwärts nach dem letzten Übergang vor Tabellenbeginn. */
const LOOKBACK_DAYS = 730;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Ortszeit als Felder (Kalender der Zone). */
function localParts(timeZone: string, ms: number) {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    h: Number(parts.hour),
    min: Number(parts.minute),
    s: Number(parts.second),
  };
}

/** Offset der Zone in Minuten zum UTC-Zeitpunkt `ms` (Chicago Sommerzeit −300). */
export function offsetMinutes(timeZone: string, ms: number): number {
  const p = localParts(timeZone, ms);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

/** Übergangszeitpunkt zwischen `lo` (alter Offset) und `hi` (neuer Offset) auf die Sekunde genau. */
function bisect(timeZone: string, lo: number, hi: number): number {
  const before = offsetMinutes(timeZone, lo);
  let a = lo;
  let b = hi;
  while (b - a > 1000) {
    const mid = Math.floor((a + b) / 2000) * 1000;
    if (offsetMinutes(timeZone, mid) === before) a = mid;
    else b = mid;
  }
  return b;
}

/**
 * Übergänge für [startMs, endMs] (night.md §1): der erste Eintrag ist der letzte Übergang **vor**
 * `startMs` (liefert den Anfangs-Offset), danach alle Übergänge bis `endMs`. Kennt die Zone in den
 * letzten zwei Jahren keinen Übergang, steht der erste Eintrag an der Suchgrenze.
 */
export function timeZoneTransitions(
  timeZone: string,
  startMs: number,
  endMs: number,
): TimeZoneTransition[] {
  const entry = (ms: number) => ({
    atUtc: Math.floor(ms / 1000),
    utcOffsetMinutes: offsetMinutes(timeZone, ms),
  });
  // Rückwärts: letzter Übergang vor startMs.
  let first: TimeZoneTransition | null = null;
  const startOffset = offsetMinutes(timeZone, startMs);
  for (let t = startMs, i = 0; i < LOOKBACK_DAYS; i += 1, t -= DAY) {
    if (offsetMinutes(timeZone, t - DAY) !== startOffset) {
      first = entry(bisect(timeZone, t - DAY, t));
      break;
    }
  }
  first ??= {
    atUtc: Math.floor((startMs - LOOKBACK_DAYS * DAY) / 1000),
    utcOffsetMinutes: startOffset,
  };
  const out: TimeZoneTransition[] = [first];
  let prev = startOffset;
  for (let t = startMs; t < endMs; t += DAY) {
    const next = Math.min(t + DAY, endMs);
    const off = offsetMinutes(timeZone, next);
    if (off !== prev) {
      out.push(entry(bisect(timeZone, t, next)));
      prev = off;
    }
  }
  return out;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const keyOf = (y: number, m: number, d: number) => `${String(y)}-${pad2(m)}-${pad2(d)}`;
const addDays = (key: string, n: number) => {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return keyOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
};

/** Mittagsnacht (H1): die Nacht, deren Mittag-bis-Mittag-Intervall `nowMs` enthält. */
export function noonNightKey(timeZone: string, nowMs: number): string {
  const p = localParts(timeZone, nowMs);
  const today = keyOf(p.y, p.m, p.d);
  return p.h < 12 ? addDays(today, -1) : today;
}

export interface NightTableSite {
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly timeZone: string;
}

export interface NightTableRow {
  night: string;
  noonStartUtc: string;
  noonEndUtc: string;
  nightWindowEndUtc: string;
}

export interface NightTable {
  tzdataVersion: string;
  timeZoneTransitions: { atUtc: string; utcOffsetMinutes: number }[];
  nights: NightTableRow[];
}

/** tzdata der Laufzeit (Teil des `inputHash`, night.md §1). */
export const tzdataVersion = (): string => process.versions.tz ?? 'unknown';

/**
 * `count` Nächte ab `from` (Nacht-Schlüssel). Nächte, deren lokaler Mittag nicht existiert
 * (Datumslinie), entfallen (AST-N16); ist `from` selbst so eine Nacht → `422 validation.failed`.
 */
export function buildNightTable(site: NightTableSite, from: string, count: number): NightTable {
  const [y, m, d] = from.split('-').map(Number) as [number, number, number];
  // Großzügiger Rahmen: ±2 Tage um die Tabelle, damit jeder lokale Mittag abgedeckt ist.
  const startMs = Date.UTC(y, m - 1, d) - 2 * DAY;
  const endMs = Date.UTC(y, m - 1, d + count) + 3 * DAY;
  const transitions = timeZoneTransitions(site.timeZone, startMs, endMs);
  const engineSite = { latDeg: site.latitudeDeg, lonDeg: site.longitudeDeg };
  const nights: NightTableRow[] = [];
  for (let i = 0; i < count; i += 1) {
    const night = addDays(from, i);
    try {
      nightBounds(night, transitions);
    } catch (error) {
      if (error instanceof EngineInputError && i > 0) continue;
      if (error instanceof EngineInputError)
        throw new ProblemError('validation.failed', [
          { path: 'from', message: `Nacht ${night} existiert in ${site.timeZone} nicht` },
        ]);
      throw error;
    }
    const t = nightTimes({ site: engineSite, night, timeZoneTransitions: transitions });
    nights.push({
      night,
      noonStartUtc: iso(t.noonStartUtc),
      noonEndUtc: iso(t.noonEndUtc),
      nightWindowEndUtc: iso(t.nightWindow.endUtc),
    });
  }
  return {
    tzdataVersion: tzdataVersion(),
    timeZoneTransitions: transitions.map((t) => ({
      atUtc: iso(t.atUtc),
      utcOffsetMinutes: t.utcOffsetMinutes,
    })),
    nights,
  };
}

const iso = (unixSec: number) => isoUtc(new Date(unixSec * 1000));

/**
 * Nacht-Tabelle für `GET /web/v1/sites/{id}/nights` (NT-02): ab `from` bzw. ohne `from` ab der
 * Mittagsnacht; `currentNight` rechnet der Server unabhängig von `from` (§1.1).
 */
export function siteNights(
  site: NightTableSite,
  now: Date,
  from: string | undefined,
  count: number,
) {
  const noon = noonNightKey(site.timeZone, now.getTime());
  const table = buildNightTable(site, from ?? noon, count);
  const around = from === undefined && count >= 2 ? table : buildNightTable(site, noon, 2);
  return { currentNight: currentNight(around, isoUtc(now)), ...table };
}
