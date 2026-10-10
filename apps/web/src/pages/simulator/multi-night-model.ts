/**
 * Ansicht der Mehrnacht-Simulation (S-40, FA-SIM-04; Neugestaltung 10.10.2026 nach Svens Entwurf): rein aus dem
 * Job-Ergebnis gerechnet – Kacheln (erwartete und mögliche Belichtung, gute Nächte, fertige Projekte), je Nacht die
 * erwartete Belichtung gestapelt nach Projekt und die mögliche bei klarer Nacht, je Projekt die Stunden je Nacht.
 * Die Stunden je Projekt und Nacht sind der Anteil des Projekts an der belichteten Zeit der Nacht (nach seiner
 * Blockzeit), damit Säule und Zeilen dieselbe Summe zeigen.
 */
import type { MultiSimResult } from '../../api/client';

/** Nachtbewertung „Gut“ (3) oder besser zählt als gute Nacht (FA-WET-03). */
export const GOOD_RATING = 3;

export interface SimNightView {
  readonly night: string;
  readonly darkHours: number | null;
  readonly weight: number;
  readonly ratingIndex: number | null;
  readonly hasForecast: boolean;
  /** Erwartete Belichtung (gewichtet). */
  readonly expected: number;
  /** Belichtung, wenn die Nacht klar wird (ungewichtet); gleich `expected` bei Gewicht 1. */
  readonly possible: number;
  /** Erwartete Stunden je Projekt in der Reihenfolge der Projektzeilen; nur Projekte mit Anteil. */
  readonly segments: readonly { projectId: string; hours: number }[];
}

export interface SimProjectView {
  readonly projectId: string;
  readonly name: string;
  readonly approvalStatus: string;
  /** Index der Farbe (`sim-n`, zyklisch). */
  readonly colorIndex: number;
  readonly needFrames: number;
  readonly simulatedFrames: number;
  /** Anteil des Bedarfs, den der Zeitraum deckt, 0…100. */
  readonly progressPct: number;
  readonly completesNight: string | null;
  /** Erwartete Stunden je Nacht (Spalten wie `nights`). */
  readonly hours: readonly number[];
  readonly totalHours: number;
  readonly filters: MultiSimResult['projects'][number]['filters'];
}

export interface SimView {
  readonly weather: boolean;
  readonly nights: readonly SimNightView[];
  /** Projekte mit Bedarf, nach erwarteten Stunden absteigend. */
  readonly projects: readonly SimProjectView[];
  /** Projekte ohne Bedarf (schon fertig). */
  readonly finished: readonly string[];
  readonly totals: {
    readonly expected: number;
    readonly possible: number;
    readonly goodNights: readonly string[];
    readonly withoutForecast: readonly string[];
    readonly completing: readonly { name: string; night: string }[];
    readonly active: number;
  };
}

export const SIM_COLORS = 6;

const round1 = (x: number) => Math.round(x * 10) / 10;

export function multiSimView(r: MultiSimResult): SimView {
  const active = r.projects.filter((p) => p.needFrames > 0);
  const finished = r.projects.filter((p) => p.needFrames === 0).map((p) => p.name);
  // Erwartete Stunden je Projekt und Nacht: Belichtung der Nacht nach dem Anteil an der Blockzeit.
  const hoursOf = (night: MultiSimResult['nights'][number], projectId: string) => {
    const block = night.projects.reduce((s, p) => s + p.hours, 0);
    const own = night.projects.find((p) => p.projectId === projectId)?.hours ?? 0;
    return block > 0 ? round1((night.exposureHours * own) / block) : 0;
  };
  const projects = active
    .map((p) => {
      const hours = r.nights.map((n) => hoursOf(n, p.projectId));
      return {
        projectId: p.projectId,
        name: p.name,
        approvalStatus: p.approvalStatus,
        colorIndex: 0,
        needFrames: p.needFrames,
        simulatedFrames: p.simulatedFrames,
        progressPct: Math.min(100, Math.round((p.simulatedFrames / p.needFrames) * 100)),
        completesNight: p.completesNight,
        hours,
        totalHours: round1(hours.reduce((s, h) => s + h, 0)),
        filters: p.filters,
      };
    })
    .sort((a, b) => b.totalHours - a.totalHours || a.name.localeCompare(b.name))
    .map((p, i) => ({ ...p, colorIndex: i % SIM_COLORS }));
  const nights = r.nights.map((n, i) => {
    const expected = n.exposureHours;
    return {
      night: n.night,
      darkHours: n.darkHours,
      weight: n.weight,
      ratingIndex: n.ratingIndex,
      hasForecast: n.hasForecast,
      expected,
      possible: r.weather && n.weight > 0 && n.weight < 1 ? round1(expected / n.weight) : expected,
      segments: projects.flatMap((p) =>
        (p.hours[i] ?? 0) > 0 ? [{ projectId: p.projectId, hours: p.hours[i] ?? 0 }] : [],
      ),
    };
  });
  return {
    weather: r.weather,
    nights,
    projects,
    finished,
    totals: {
      expected: round1(nights.reduce((s, n) => s + n.expected, 0)),
      possible: round1(nights.reduce((s, n) => s + n.possible, 0)),
      goodNights: nights
        .filter((n) => n.ratingIndex !== null && n.ratingIndex >= GOOD_RATING)
        .map((n) => n.night),
      withoutForecast: nights.filter((n) => !n.hasForecast).map((n) => n.night),
      completing: projects.flatMap((p) =>
        p.completesNight ? [{ name: p.name, night: p.completesNight }] : [],
      ),
      active: projects.length,
    },
  };
}

/** Wie eine Nacht zählt: voll, zur Hälfte, zu 10 % bzw. ohne Vorhersage (für den Text unter der Säule). */
export function weightKind(n: Pick<SimNightView, 'weight' | 'hasForecast'>, weather: boolean) {
  if (!weather) return 'off' as const;
  if (!n.hasForecast) return 'noForecast' as const;
  if (n.weight >= 1) return 'full' as const;
  return 'partial' as const;
}
