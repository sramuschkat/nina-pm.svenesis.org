/**
 * Saisondiagramm und Wochen-Sichtbarkeit (AP-24; FA-SIC-02/04, S-33 „Sichtbarkeit 4 Wochen“;
 * components.md §2.4): Aufbereitung von `seasonWindow` der Engine zu Balken je Nacht (1 Monat) bzw. je
 * Woche (3/6 Monate, Jahr). Rechnet ausschließlich mit der Nacht-Tabelle des Servers (NT-02); läuft im
 * Browser im Worker, im Test direkt.
 */
import { SEASON_PAUSE_NIGHTS, seasonWindow, unixFromIso, type SeasonNight } from '@nina-pm/engine';
import type { z } from 'zod';
import type { SiteNightsView } from './contracts';

type Nights = z.infer<typeof SiteNightsView>;

export const SEASON_RANGES = ['1m', '3m', '6m', '1y'] as const;
export type SeasonRange = (typeof SEASON_RANGES)[number];

/** Nächte je Zeitraum. */
export const SEASON_RANGE_NIGHTS: Readonly<Record<SeasonRange, number>> = {
  '1m': 30,
  '3m': 91,
  '6m': 182,
  '1y': 364,
};

/** Suchlänge für Saisonbeginn/-ende: ein Jahr plus die Pause, höchstens die Tabelle (≤ 400). */
export const SEASON_SEARCH_NIGHTS = 365 + SEASON_PAUSE_NIGHTS;

export interface SeasonTargetInput {
  readonly site: { readonly latitudeDeg: number; readonly longitudeDeg: number };
  readonly nights: Nights;
  readonly target: { readonly raDeg: number; readonly decDeg: number };
  readonly conditions: {
    readonly minAltitudeDeg: number;
    readonly minTimeOnTargetH: number;
    readonly twilight: 'astronomical' | 'nautical' | 'civil';
  };
  readonly startDate?: string | null;
}

/** Ein Balken (components.md §2.4 `months[]`): Nacht bzw. Woche ab `month` (Nacht-Schlüssel). */
export interface SeasonBar {
  /** Erste Nacht des Balkens (`YYYY-MM-DD`). */
  readonly month: string;
  readonly nights: number;
  /** Nutzbare Stunden je Nacht (Mittel über die Nächte des Balkens). */
  readonly usableHours: number;
  /** Anteil der nutzbaren Zeit mit Mond über dem Horizont, 0–100. */
  readonly moonPct: number;
  /** Mindestens eine Nacht erreicht die Mindestzeit am Stück. */
  readonly usable: boolean;
  /** Höchste Zielhöhe in nutzbarer Zeit, Grad; `null` = nie nutzbar. */
  readonly peakAltDeg: number | null;
}

export interface SeasonChartData {
  readonly range: SeasonRange;
  readonly today: string;
  readonly status: 'in_season' | 'out_of_season' | 'never';
  readonly seasonStart: string | null;
  readonly seasonEnd: string | null;
  /** Nutzbare Stunden von heute bis Saisonende (FA-SIC-04). */
  readonly usableHoursToSeasonEnd: number;
  readonly minTimeH: number;
  readonly months: SeasonBar[];
}

function run(input: SeasonTargetInput, count: number, withMoon: boolean) {
  const today = input.nights.currentNight;
  const keys = input.nights.nights
    .map((n) => n.night)
    .filter((n) => n >= today)
    .slice(0, count);
  const c = input.conditions;
  return seasonWindow({
    site: { latDeg: input.site.latitudeDeg, lonDeg: input.site.longitudeDeg },
    nights: keys,
    timeZoneTransitions: input.nights.timeZoneTransitions.map((t) => ({
      atUtc: unixFromIso(t.atUtc),
      utcOffsetMinutes: t.utcOffsetMinutes,
    })),
    target: { raJ2000Deg: input.target.raDeg, decJ2000Deg: input.target.decDeg },
    twilight: c.twilight,
    minAltDeg: c.minAltitudeDeg,
    minTimeSec: c.minTimeOnTargetH * 3600,
    startDate: input.startDate ?? null,
    withMoon,
  });
}

/** Nächte zu Balken zusammenfassen: je `size` Nächte einer. */
export function seasonBars(nights: readonly SeasonNight[], size: number): SeasonBar[] {
  const bars: SeasonBar[] = [];
  for (let i = 0; i < nights.length; i += size) {
    const group = nights.slice(i, i + size);
    const usable = group.reduce((s, n) => s + n.usableSec, 0);
    const moon = group.reduce((s, n) => s + (n.moonUpSec ?? 0), 0);
    const peaks = group.map((n) => n.peakAltDeg).filter((p): p is number => p !== null);
    bars.push({
      month: group[0]?.night ?? '',
      nights: group.length,
      usableHours: usable / 3600 / group.length,
      moonPct: usable > 0 ? (100 * moon) / usable : 0,
      usable: group.some((n) => n.sufficient),
      peakAltDeg: peaks.length > 0 ? Math.max(...peaks) : null,
    });
  }
  return bars;
}

/** Saisondiagramm (FA-SIC-02): Balken je Nacht (1 Monat) bzw. je Woche, Saisonbeginn/-ende. */
export function seasonChartData(input: SeasonTargetInput, range: SeasonRange): SeasonChartData {
  const r = run(input, SEASON_SEARCH_NIGHTS, true);
  const shown = r.nights.slice(0, SEASON_RANGE_NIGHTS[range]);
  return {
    range,
    today: input.nights.currentNight,
    status: r.status,
    seasonStart: r.seasonStart,
    seasonEnd: r.seasonEnd,
    usableHoursToSeasonEnd: r.usableSecToSeasonEnd / 3600,
    minTimeH: input.conditions.minTimeOnTargetH,
    months: seasonBars(shown, range === '1m' ? 1 : 7),
  };
}

/** Wochen-Sichtbarkeit (S-33): vier Wochen ab heute, je Woche nutzbare Stunden je Nacht. */
export function visibilityWeeks(input: SeasonTargetInput, weeks = 4): SeasonBar[] {
  const r = run(input, weeks * 7, false);
  return seasonBars(r.nights, 7);
}
