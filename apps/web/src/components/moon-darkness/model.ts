/**
 * „Mond und Dunkelheit“ und Mondkalender (Planung, Vorbild `drawNightStrip`/`renderMoonCal` im Beobachtungsplaner,
 * legacy/…/observing-planner.js): Daten einer Nacht bzw. eines Monats aus `@nina-pm/engine`. Die Nacht und ihre
 * Grenzen kommen aus der Zeitzonentabelle des Servers (NT-02) – `Intl` dient nur der Beschriftung; die
 * Astronomie ist die der Engine (topozentrischer Mond, exakte Dämmerungsdurchgänge), nicht die der Vorlage (WS-20).
 */
import {
  daysFromKey,
  keyFromDays,
  moonAgeDays,
  moonAt,
  moonEvents,
  moonPhaseAngleDeg,
  moonPhaseEvents,
  nightTimes,
  sunAt,
  type MoonQuarter,
  type TimeZoneTransition,
} from '@nina-pm/engine';
import { cropWindow, type AltPoint } from '../night-chart/model';

export interface Geo {
  readonly latDeg: number;
  readonly lonDeg: number;
}

export interface NightInput {
  readonly site: Geo;
  readonly night: string;
  readonly timeZoneTransitions: readonly TimeZoneTransition[];
  readonly timeZone: string;
}

export interface Crossing {
  readonly startUtc: number | null;
  readonly endUtc: number | null;
}

export interface MoonPhaseInfo {
  /** Beleuchteter Anteil in % (0–100). */
  readonly illumPct: number;
  /** Phasenwinkel λ☾ − λ☉ in [0, 360). */
  readonly angleDeg: number;
  /** 0 Neumond … 7 abnehmende Sichel (Grenzen wie im Beobachtungsplaner). */
  readonly phaseIndex: number;
  readonly ageDays: number;
}

export interface MoonDarknessData {
  readonly window: { readonly fromUtc: number; readonly toUtc: number };
  /** Alle 5 min: Sonnenhöhe (geometrisch) und scheinbare Mondhöhe. */
  readonly samples: readonly { atUtc: number; sunAltDeg: number; moonAltDeg: number }[];
  /** Sonnenunter-/-aufgang (−0,833°) und die drei Dämmerungsgrenzen der Nacht. */
  readonly sunset: Crossing;
  readonly civil: Crossing;
  readonly nautical: Crossing;
  readonly astronomical: Crossing;
  /** Keine astronomische Dunkelheit (Polartag bzw. heller Sommer). */
  readonly noDarkness: boolean;
  /** Dunkel über das ganze Fenster (Polarnacht). */
  readonly darkAll: boolean;
  readonly moonEvents: readonly { type: 'rise' | 'set'; atUtc: number }[];
  readonly moonPeak: { atUtc: number; altDeg: number } | null;
  /** Mond zur Mitternacht der Nacht (Mitte Mittag–Mittag), wie im Kalender. */
  readonly phase: MoonPhaseInfo;
}

const STEP_S = 300;

/** Phasenname-Index aus dem Phasenwinkel (Beobachtungsplaner `phaseIndex`). */
export function phaseIndexOf(angleDeg: number): number {
  const e = angleDeg;
  if (e < 12 || e >= 348) return 0;
  if (e < 78) return 1;
  if (e < 102) return 2;
  if (e < 168) return 3;
  if (e < 192) return 4;
  if (e < 258) return 5;
  if (e < 282) return 6;
  return 7;
}

export function moonPhaseAt(unixSec: number, site: Geo): MoonPhaseInfo {
  const angleDeg = moonPhaseAngleDeg(unixSec);
  return {
    illumPct: moonAt(unixSec, site).illumPct,
    angleDeg,
    phaseIndex: phaseIndexOf(angleDeg),
    ageDays: moonAgeDays(unixSec),
  };
}

const crossing = (c: { startUtc: number | null; endUtc: number | null }): Crossing => ({
  startUtc: c.startUtc,
  endUtc: c.endUtc,
});

/** Daten der Nacht für den Streifen „Mond und Dunkelheit“. */
export function moonDarkness(input: NightInput): MoonDarknessData {
  const t = nightTimes({
    site: input.site,
    night: input.night,
    timeZoneTransitions: input.timeZoneTransitions,
  });
  const full = { fromUtc: t.noonStartUtc, toUtc: t.noonEndUtc };
  const sunPoints: AltPoint[] = [];
  for (let at = full.fromUtc; at <= full.toUtc; at += 1800)
    sunPoints.push({ atUtc: at, altDeg: sunAt(at, input.site).altDeg });
  const window = cropWindow(full, sunPoints, input.timeZone);
  const samples: { atUtc: number; sunAltDeg: number; moonAltDeg: number }[] = [];
  for (let at = window.fromUtc; at <= window.toUtc; at += STEP_S)
    samples.push({
      atUtc: at,
      sunAltDeg: sunAt(at, input.site).altDeg,
      moonAltDeg: moonAt(at, input.site).altDeg,
    });
  let moonPeak: { atUtc: number; altDeg: number } | null = null;
  for (const s of samples)
    if (s.moonAltDeg > 0 && (!moonPeak || s.moonAltDeg > moonPeak.altDeg))
      moonPeak = { atUtc: s.atUtc, altDeg: s.moonAltDeg };
  const astro = t.twilight.astronomical;
  const mid = (t.noonStartUtc + t.noonEndUtc) / 2;
  return {
    window,
    samples,
    sunset: crossing(t.sunset),
    civil: crossing(t.twilight.civil),
    nautical: crossing(t.twilight.nautical),
    astronomical: crossing(astro),
    noDarkness: astro.kind === 'polarDay',
    darkAll: astro.kind === 'polarNight',
    moonEvents: moonEvents(input.site, window.fromUtc, window.toUtc),
    moonPeak,
    phase: moonPhaseAt(mid, input.site),
  };
}

/** Mondfreie astronomische Dunkelheit einer Nacht in Sekunden (5-min-Raster, Mond unter dem Horizont). */
export function moonFreeDarkSeconds(input: Omit<NightInput, 'timeZone'>): number {
  const t = nightTimes({
    site: input.site,
    night: input.night,
    timeZoneTransitions: input.timeZoneTransitions,
  });
  const a = t.twilight.astronomical;
  if (a.kind === 'polarDay') return 0;
  const from = a.kind === 'polarNight' ? t.noonStartUtc : (a.startUtc ?? t.noonStartUtc);
  const to = a.kind === 'polarNight' ? t.noonEndUtc : (a.endUtc ?? t.noonEndUtc);
  let free = 0;
  for (let at = from; at < to; at += STEP_S) {
    const end = Math.min(at + STEP_S, to);
    if (moonAt((at + end) / 2, input.site).altDeg < 0) free += end - at;
  }
  return free;
}

export interface CalendarDay {
  /** Nacht-Schlüssel = Datum des Abends. */
  readonly night: string;
  readonly day: number;
  readonly phase: MoonPhaseInfo;
  readonly moonFreeSec: number;
  readonly quarter: MoonQuarter | null;
}

export interface CalendarMonth {
  readonly year: number;
  readonly month: number;
  /** 0 = Montag … 6 = Sonntag für den 1. des Monats. */
  readonly firstWeekday: number;
  readonly days: readonly CalendarDay[];
  /** Die (bis zu) drei Nächte mit der längsten mondfreien Dunkelheit ≥ 1 h. */
  readonly best: readonly string[];
  /** Längste mondfreie Dunkelheit des Monats, mindestens 8 h (voller Balken). */
  readonly barMaxSec: number;
  readonly quarters: readonly { kind: MoonQuarter; atUtc: number; night: string }[];
}

const MIN_BAR_S = 8 * 3600;
const MIN_BEST_S = 3600;

/**
 * Monat für den Mondkalender: je Nacht Phase und Beleuchtung zur Mitternacht (Mitte Mittag–Mittag), mondfreie
 * Dunkelheit, Viertel (der Nacht zugeordnet, deren Mittag–Mittag-Spanne sie enthält). `nightsOfMonth` liefert
 * die Mittag-Grenzen aus der Tabelle des Servers.
 */
export function calendarMonth(
  year: number,
  month: number,
  site: Geo,
  timeZoneTransitions: readonly TimeZoneTransition[],
): CalendarMonth {
  const firstKey = `${String(year)}-${String(month).padStart(2, '0')}-01`;
  const firstDays = daysFromKey(firstKey);
  const nextMonth =
    month === 12
      ? `${String(year + 1)}-01-01`
      : `${String(year)}-${String(month + 1).padStart(2, '0')}-01`;
  const count = daysFromKey(nextMonth) - firstDays;
  const bounds = Array.from({ length: count }, (_, i) => {
    const night = keyFromDays(firstDays + i);
    const t = nightTimes({ site, night, timeZoneTransitions });
    return { night, noonStartUtc: t.noonStartUtc, noonEndUtc: t.noonEndUtc };
  });
  const first = bounds[0];
  const last = bounds.at(-1);
  const quarters =
    first && last
      ? moonPhaseEvents(first.noonStartUtc, last.noonEndUtc).map((q) => ({
          ...q,
          night:
            bounds.find((b) => q.atUtc >= b.noonStartUtc && q.atUtc < b.noonEndUtc)?.night ??
            first.night,
        }))
      : [];
  const days: CalendarDay[] = bounds.map((b, i) => ({
    night: b.night,
    day: i + 1,
    phase: moonPhaseAt((b.noonStartUtc + b.noonEndUtc) / 2, site),
    moonFreeSec: moonFreeDarkSeconds({ site, night: b.night, timeZoneTransitions }),
    quarter: quarters.find((q) => q.night === b.night)?.kind ?? null,
  }));
  const best = [...days]
    .filter((d) => d.moonFreeSec >= MIN_BEST_S)
    .sort((a, b) => b.moonFreeSec - a.moonFreeSec || a.day - b.day)
    .slice(0, 3)
    .map((d) => d.night);
  // Wochentag des 1.: 1970-01-01 war ein Donnerstag (Montag = 0).
  const firstWeekday = (((firstDays + 3) % 7) + 7) % 7;
  return {
    year,
    month,
    firstWeekday,
    days,
    best,
    barMaxSec: Math.max(MIN_BAR_S, ...days.map((d) => d.moonFreeSec)),
    quarters,
  };
}
