/**
 * Reine Hilfen des Nachtdiagramms (ohne DOM): Zeitachse in Standortzeit (Beschriftung je Zeitpunkt über
 * `Intl`, nie über einen festen Versatz – NT-03, components.md §2.3), Abtastung für die Tastatur und die
 * Werte der Textalternative.
 */
import { formatTzAbbr, formatZonedTime } from '@nina-pm/shared';

export interface AltPoint {
  /** Unix-Sekunden (UTC). */
  readonly atUtc: number;
  readonly altDeg: number;
}

export interface AltitudeSeries {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly points: readonly AltPoint[];
}

export interface TwilightSpan {
  /** Abwärtsdurchgang am Abend bzw. `null` (Polartag/-nacht). */
  readonly startUtc: number | null;
  /** Aufwärtsdurchgang am Morgen bzw. `null`. */
  readonly endUtc: number | null;
  /** Polarnacht für diese Grenze: das ganze Fenster ist dunkel (ohne Durchgänge). */
  readonly allNight?: boolean;
}

export interface NightMarker {
  readonly atUtc: number;
  readonly kind: 'flip' | 'transit' | 'now' | 'custom';
  readonly label: string;
}

/** ISO-Zeitpunkt für die Hilfsfunktionen aus `packages/shared` (die rechnen mit Date/ISO). */
export const iso = (unixSec: number) => new Date(unixSec * 1000).toISOString();

/** „21:08 CDT“ – Uhrzeit mit Kürzel in der Zone (rules/ui.md). */
export function clock(unixSec: number, timeZone: string): string {
  return `${formatZonedTime(iso(unixSec), timeZone)} ${formatTzAbbr(iso(unixSec), timeZone)}`;
}

export interface Tick {
  readonly atUtc: number;
  readonly label: string;
}

/**
 * Volle Stunden in der Zone: je 5-min-Raster die Punkte, deren Ortszeit auf „:00“ endet – so folgt die
 * Achse der Standortzeit mit 23/24/25 Stunden und springt bei der Zeitumstellung sichtbar.
 */
export function hourTicks(startUtc: number, endUtc: number, timeZone: string): Tick[] {
  const ticks: Tick[] = [];
  const first = Math.ceil(startUtc / 300) * 300;
  for (let t = first; t <= endUtc; t += 300) {
    const label = formatZonedTime(iso(t), timeZone);
    if (label.endsWith(':00')) ticks.push({ atUtc: t, label: label.slice(0, 2) });
  }
  return ticks;
}

/** Wert einer Reihe zum Zeitpunkt (linear zwischen Stützstellen), außerhalb `null`. */
export function valueAt(points: readonly AltPoint[], atUtc: number): number | null {
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i] as AltPoint;
    const b = points[i + 1] as AltPoint;
    if (atUtc >= a.atUtc && atUtc <= b.atUtc) {
      const f = b.atUtc === a.atUtc ? 0 : (atUtc - a.atUtc) / (b.atUtc - a.atUtc);
      return a.altDeg + f * (b.altDeg - a.altDeg);
    }
  }
  return null;
}

/** Höchster Punkt einer Reihe (Kulmination im Fenster). */
export function peak(points: readonly AltPoint[]): AltPoint | null {
  let best: AltPoint | null = null;
  for (const p of points) if (!best || p.altDeg > best.altDeg) best = p;
  return best;
}

/** Erster/letzter Zeitpunkt über der Höhe `minAltDeg` (Textalternative: Auf-/Untergang über Mindesthöhe). */
export function aboveSpan(points: readonly AltPoint[], minAltDeg: number) {
  const above = points.filter((p) => p.altDeg >= minAltDeg);
  return above.length === 0
    ? null
    : { fromUtc: (above[0] as AltPoint).atUtc, toUtc: (above[above.length - 1] as AltPoint).atUtc };
}
