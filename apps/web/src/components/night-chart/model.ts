/**
 * Reine Hilfen des Nachtdiagramms (ohne DOM): Zeitachse in Standortzeit (Beschriftung je Zeitpunkt über
 * `Intl`, nie über einen festen Versatz – NT-03, components.md §2.3), Abtastung für die Tastatur und die
 * Werte der Textalternative.
 */
import { formatTzAbbr, formatZonedTime } from '@nina-pm/shared';

/**
 * Transit im Nachtdiagramm (S-22, AP-42): Beobachtungsfenster als Fläche mit Start/Ende, Kontakte und die
 * schematische relative Helligkeit als gelbe Linie mit Prozentachse rechts (FA-EXO-10).
 */
export interface TransitOverlay {
  readonly windowStartUtc: number;
  readonly windowEndUtc: number;
  readonly ingressUtc: number;
  readonly midUtc: number;
  readonly egressUtc: number;
  /** Relative Helligkeit je Zeitpunkt: 0 außerhalb, negativ im Transit (Anteil, z. B. −0,0062). */
  readonly flux: readonly { readonly atUtc: number; readonly rel: number }[];
  /** Beschriftung an der Linie („−6,7 mmag“) und rechts an der Achse („−0,62 %“). */
  readonly depthLabel: string;
  readonly depthPctLabel: string;
}

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

/** Belegter Block (components.md §2.3 `TimelineBlock`): Balken unter dem Diagramm. */
export interface TimelineBlock {
  readonly id: string;
  readonly fromUtc: number;
  readonly toUtc: number;
  readonly label: string;
  readonly kind: 'regular' | 'transit' | 'flat' | 'idle';
  /** Farbe des Ziels (CSS-Farbe oder `var(--npm-…)`). */
  readonly color?: string;
  readonly actual?: boolean;
}

/** Filterbalken über den Blöcken (FA-SIM-07): Belichtungszeit je Filter in Filterfarbe. */
export interface FilterBar {
  readonly fromUtc: number;
  readonly toUtc: number;
  readonly color: string;
  readonly label: string;
  /** Anzahl der Belichtungen im Balken (Plangrafik „R ×10“, AP-26e). */
  readonly count?: number;
}

/** Beschriftung eines Filterbalkens in der Plangrafik: „R ×10“, ohne Anzahl nur der Filter. */
export const filterBarLabel = (f: FilterBar) =>
  f.count && f.count > 0 ? `${f.label} ×${String(f.count)}` : f.label;

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

export interface Interval {
  readonly fromUtc: number;
  readonly toUtc: number;
}

type Rgb = readonly [number, number, number];

/**
 * Himmelsfarbe zur Sonnenhöhe (components.md §2.3): linear zwischen den Stützstellen aus
 * `@nina-pm/ui-tokens` (`SKY_STOPS`, absteigend), außerhalb die jeweils äußere Farbe.
 */
export function skyColor(sunAltDeg: number, stops: readonly (readonly [number, Rgb])[]): string {
  const rgb = (c: Rgb) => `rgb(${c.map((v) => String(Math.round(v))).join(', ')})`;
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) return 'rgb(0, 0, 0)';
  if (sunAltDeg >= first[0]) return rgb(first[1]);
  for (let i = 0; i + 1 < stops.length; i += 1) {
    const [a, ca] = stops[i] as readonly [number, Rgb];
    const [b, cb] = stops[i + 1] as readonly [number, Rgb];
    if (sunAltDeg <= a && sunAltDeg >= b) {
      const f = (a - sunAltDeg) / (a - b);
      const mix = (k: 0 | 1 | 2) => ca[k] + (cb[k] - ca[k]) * f;
      return rgb([mix(0), mix(1), mix(2)]);
    }
  }
  return rgb(last[1]);
}

/** Sonnenhöhe an den Dämmerungsgrenzen (engine `TWILIGHT_DEG`). */
const TWILIGHT_ALT = { civil: -6, nautical: -12, astronomical: -18 } as const;

export interface TwilightInput {
  readonly civil: TwilightSpan;
  readonly nautical: TwilightSpan;
  readonly astronomical: TwilightSpan;
}

const inSpan = (s: TwilightSpan, at: number, win: Interval) => {
  if (s.allNight) return true;
  if (s.startUtc === null && s.endUtc === null) return false;
  return at >= (s.startUtc ?? win.fromUtc) && at <= (s.endUtc ?? win.toUtc);
};

/**
 * Ersatz-Sonnenhöhe aus den Dämmerungszeiten, wenn keine Sonnenkurve übergeben wird: je Stufe die
 * Höhe ihrer Grenze (Tag 0°). Reicht für Himmelsfarbe und Dunkel-Streifen in Stufen.
 */
export function sunAltFromTwilight(tw: TwilightInput, at: number, win: Interval): number {
  if (inSpan(tw.astronomical, at, win)) return TWILIGHT_ALT.astronomical;
  if (inSpan(tw.nautical, at, win)) return TWILIGHT_ALT.nautical;
  if (inSpan(tw.civil, at, win)) return TWILIGHT_ALT.civil;
  return 0;
}

/** Die fünf Stundenstreifen unter dem Diagramm (Legende „Streifen + Summe“, Entscheidung 24.09.2026). */
export const BAND_KEYS = ['recommended', 'moonless', 'moonlit', 'above', 'dark'] as const;
export type BandKey = (typeof BAND_KEYS)[number];

export interface Band {
  readonly key: BandKey;
  readonly intervals: readonly Interval[];
  /** Summe in Sekunden. */
  readonly totalSec: number;
}

export interface BandInput {
  readonly window: Interval;
  readonly sun?: readonly AltPoint[];
  readonly twilight?: TwilightInput;
  /** Höhenkurve des Hauptziels (erste Reihe). */
  readonly target?: readonly AltPoint[];
  readonly moon?: readonly AltPoint[];
  readonly minAltDeg?: number;
  /** Nutzbare Zeit aus der Engine (Dämmerung, Mindesthöhe, Mondvermeidung); fehlt sie, entfällt der Streifen. */
  readonly recommended?: readonly Interval[];
  readonly stepSec?: number;
}

const DARK_DEG = -18;

/**
 * Stundenstreifen auf einem 5-min-Raster (Wert je Schrittmitte): *dunkel* = Sonne ≤ −18°; *über
 * Mindesthöhe* = dunkel und Ziel ≥ Mindesthöhe; davon *ohne Mond* (Mond ≤ 0°) bzw. *mit Mond*;
 * *empfohlen* = die übergebenen Engine-Intervalle. Nur Anzeige – der Scheduler rechnet in der Engine.
 */
export function hourBands(input: BandInput): Band[] {
  const step = input.stepSec ?? 300;
  const { fromUtc, toUtc } = input.window;
  const minAlt = input.minAltDeg ?? 0;
  const acc: Record<Exclude<BandKey, 'recommended'>, Interval[]> = {
    moonless: [],
    moonlit: [],
    above: [],
    dark: [],
  };
  const push = (list: Interval[], a: number, b: number) => {
    const prev = list[list.length - 1];
    if (prev && prev.toUtc === a) list[list.length - 1] = { fromUtc: prev.fromUtc, toUtc: b };
    else list.push({ fromUtc: a, toUtc: b });
  };
  for (let a = fromUtc; a < toUtc; a += step) {
    const b = Math.min(toUtc, a + step);
    const mid = (a + b) / 2;
    const sun = input.sun
      ? valueAt(input.sun, mid)
      : input.twilight
        ? sunAltFromTwilight(input.twilight, mid, input.window)
        : null;
    if (sun === null || sun > DARK_DEG) continue;
    push(acc.dark, a, b);
    const alt = input.target ? valueAt(input.target, mid) : null;
    if (alt === null || alt < minAlt) continue;
    push(acc.above, a, b);
    const moon = input.moon ? valueAt(input.moon, mid) : null;
    push(moon !== null && moon > 0 ? acc.moonlit : acc.moonless, a, b);
  }
  const total = (list: readonly Interval[]) => list.reduce((s, i) => s + (i.toUtc - i.fromUtc), 0);
  const bands: Band[] = [];
  if (input.recommended)
    bands.push({
      key: 'recommended',
      intervals: input.recommended,
      totalSec: total(input.recommended),
    });
  if (input.target)
    for (const key of ['moonless', 'moonlit', 'above'] as const)
      bands.push({ key, intervals: acc[key], totalSec: total(acc[key]) });
  bands.push({ key: 'dark', intervals: acc.dark, totalSec: total(acc.dark) });
  return bands;
}

/** Zusammenhängende Intervalle aus einer Maske je 5-min-Slot (`boundaryUtc` hat eine Grenze mehr). */
export function maskIntervals(
  boundaryUtc: readonly number[],
  mask: readonly boolean[],
): Interval[] {
  const out: Interval[] = [];
  mask.forEach((on, k) => {
    if (!on) return;
    const a = boundaryUtc[k] as number;
    const b = boundaryUtc[k + 1] as number;
    const prev = out[out.length - 1];
    if (prev && prev.toUtc === a) out[out.length - 1] = { fromUtc: prev.fromUtc, toUtc: b };
    else out.push({ fromUtc: a, toUtc: b });
  });
  return out;
}

/** Wechselpunkte der Dämmerung im Fenster (senkrechte Linien mit Kürzel B/N/A bzw. C/N/A). */
export function twilightCrossings(
  tw: TwilightInput,
  win: Interval,
): { atUtc: number; kind: 'civil' | 'nautical' | 'astronomical' }[] {
  const out: { atUtc: number; kind: 'civil' | 'nautical' | 'astronomical' }[] = [];
  for (const kind of ['civil', 'nautical', 'astronomical'] as const) {
    const s = tw[kind];
    if (s.allNight) continue;
    for (const at of [s.startUtc, s.endUtc])
      if (at !== null && at > win.fromUtc && at < win.toUtc) out.push({ atUtc: at, kind });
  }
  return out.sort((a, b) => a.atUtc - b.atUtc);
}

/** Horizont mit Refraktion (Sonnenoberrand): Sonnenuntergang und -aufgang im Sinne des Beobachtungsplaners. */
const SUNSET_DEG = -0.833;

/**
 * Ausschnitt des Diagramms (AP-26e, `planetWindow` im Beobachtungsplaner): eine Stunde vor Sonnenuntergang
 * bis eine Stunde nach Sonnenaufgang, auf volle Stunden der Standortzeit (über `hourTicks`, also auch bei
 * der Zeitumstellung richtig). Ohne Sonnenkurve oder ohne Unter- bzw. Aufgang (Polartag/-nacht) bleibt das
 * ganze Fenster.
 */
export function cropWindow(
  win: Interval,
  sun: readonly AltPoint[] | undefined,
  timeZone: string,
): Interval {
  if (!sun || sun.length < 2) return win;
  let set: number | null = null;
  let rise: number | null = null;
  for (let i = 0; i + 1 < sun.length; i += 1) {
    const a = sun[i] as AltPoint;
    const b = sun[i + 1] as AltPoint;
    const cross = (a.altDeg - SUNSET_DEG) * (b.altDeg - SUNSET_DEG) <= 0 && a.altDeg !== b.altDeg;
    if (!cross) continue;
    const at = a.atUtc + ((SUNSET_DEG - a.altDeg) / (b.altDeg - a.altDeg)) * (b.atUtc - a.atUtc);
    if (set === null && b.altDeg < a.altDeg) set = at;
    else if (set !== null && b.altDeg > a.altDeg) {
      rise = at;
      break;
    }
  }
  if (set === null || rise === null) return win;
  const ticks = hourTicks(win.fromUtc, win.toUtc, timeZone).map((t) => t.atUtc);
  const from = [...ticks].reverse().find((t) => t <= set - 3600) ?? win.fromUtc;
  const to = ticks.find((t) => t >= rise + 3600) ?? win.toUtc;
  return to > from ? { fromUtc: from, toUtc: to } : win;
}

/**
 * Beste Zeit eines Ziels (Punkt im Diagramm, `bestSample` im Beobachtungsplaner): der höchste Stand in
 * astronomischer Dunkelheit, sonst in nautischer, sonst im Fenster; `null`, wenn das Ziel nie über 0° steht.
 */
export function bestTime(
  points: readonly AltPoint[],
  twilight: TwilightInput | undefined,
  win: Interval,
): AltPoint | null {
  const within = (s: TwilightSpan | undefined) => {
    if (!s) return [];
    if (s.allNight) return points.filter((p) => p.atUtc >= win.fromUtc && p.atUtc <= win.toUtc);
    if (s.startUtc === null || s.endUtc === null) return [];
    const from = s.startUtc;
    const to = s.endUtc;
    return points.filter((p) => p.atUtc >= from && p.atUtc <= to);
  };
  for (const list of [
    within(twilight?.astronomical),
    within(twilight?.nautical),
    points.filter((p) => p.atUtc >= win.fromUtc && p.atUtc <= win.toUtc),
  ]) {
    const top = peak(list);
    if (top) return top.altDeg > 0 ? top : null;
  }
  return null;
}

/** Deckkraft der Mondfläche nach Beleuchtung (Beobachtungsplaner: 0,18 + 0,4 × Anteil). */
export const moonAlpha = (illuminationPct: number) =>
  0.18 + (0.4 * Math.max(0, Math.min(100, illuminationPct))) / 100;

/** Relative Helligkeit einer Farbe `#rgb`/`#rrggbb`/`rgb(…)` (0–1) für die Textfarbe auf Filterbalken. */
export function luminance(color: string): number | null {
  let rgb: number[] | null = null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hex?.[1]) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  } else {
    const m = /^rgba?\(([^)]+)\)$/.exec(color.trim());
    if (m?.[1])
      rgb = m[1]
        .split(',')
        .slice(0, 3)
        .map((v) => Number(v.trim()));
  }
  if (!rgb || rgb.some((v) => Number.isNaN(v))) return null;
  const lin = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (lin[0] ?? 0) + 0.7152 * (lin[1] ?? 0) + 0.0722 * (lin[2] ?? 0);
}
