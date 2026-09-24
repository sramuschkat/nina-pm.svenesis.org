/**
 * Dämmerung, Nachtfenster und Zeitmarken (specs/engine/night.md §2–§3, NT-07, NT-40):
 * Transit und Antitransit der Sonne als Anker, je Grenze Bisektion auf ≤ 1 s (höchstens 20 Schritte),
 * Ergebnis auf ganze Sekunden. Kein Raster, keine Mitternachts-Heuristik (WS-20).
 */
import { q } from '../round';
import { norm180 } from './angles';
import { moonAt, sunAt } from './bodies';
import type { Site } from './horizon';
import { localTimeOfNightUtc, nightBounds, type TimeZoneTransition } from './timezone';

/** Sonnen-LHA-Rate ≈ 15°/h → 240 s je Grad. */
const SECONDS_PER_DEGREE = 240;
const MAX_ITERATIONS = 10;

/** Zeitpunkt mit LHA_Sonne = Ziel (0 = Transit, 180 = Antitransit), iterativ ab `guess`. */
export function sunHourAngleTime(site: Site, guessUtc: number, targetDeg: 0 | 180): number {
  let t = guessUtc;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const dt = -norm180(sunAt(t, site).hourAngleDeg - targetDeg) * SECONDS_PER_DEGREE;
    t += dt;
    if (Math.abs(dt) < 0.5) break;
  }
  return t;
}

/** Bisektion eines Vorzeichenwechsels von f in [a, b] auf ≤ 1 s, höchstens 20 Schritte; ganze Sekunde. */
function bisect(f: (t: number) => number, a0: number, b0: number): number {
  let a = a0;
  let b = b0;
  const fa = f(a) > 0;
  for (let i = 0; i < 20 && b - a > 1; i++) {
    const m = (a + b) / 2;
    if (f(m) > 0 === fa) a = m;
    else b = m;
  }
  return q((a + b) / 2, 1);
}

export type LimitName = 'civil' | 'nautical' | 'astronomical';
export const TWILIGHT_LIMITS: Readonly<Record<LimitName, number>> = {
  civil: -6,
  nautical: -12,
  astronomical: -18,
};

export interface Crossings {
  /** Höhenschwelle, Grad (geometrischer Sonnenmittelpunkt). */
  readonly h0: number;
  /** Abwärts- (Beginn der Dunkelheit) und Aufwärtsdurchgang; `null` ohne Durchgang. */
  readonly startUtc: number | null;
  readonly endUtc: number | null;
  /** `normal` (zwei Durchgänge), `polarDay` (h_min > h₀), `polarNight` (h_max < h₀). */
  readonly kind: 'normal' | 'polarDay' | 'polarNight';
  /** Streifender Fall: min(|h_min − h₀|, |h_max − h₀|) < 0,5° (night.md §2, AST-N3). */
  readonly grazing: boolean;
}

export interface SunAnchors {
  readonly transitUtc: number;
  readonly antitransitUtc: number;
  readonly nextTransitUtc: number;
  readonly maxAltDeg: number;
  readonly minAltDeg: number;
}

/** Transit vor, Antitransit in und Transit nach der Nacht (Mittag bis Mittag). */
export function sunAnchors(site: Site, noonStartUtc: number, noonEndUtc: number): SunAnchors {
  const anti = sunHourAngleTime(site, (noonStartUtc + noonEndUtc) / 2, 180);
  const transit = sunHourAngleTime(site, anti - 43200, 0);
  const next = sunHourAngleTime(site, anti + 43200, 0);
  return {
    transitUtc: transit,
    antitransitUtc: anti,
    nextTransitUtc: next,
    maxAltDeg: sunAt(transit, site).altDeg,
    minAltDeg: sunAt(anti, site).altDeg,
  };
}

/** Abwärts- und Aufwärtsdurchgang der Sonne durch h₀ (night.md §2). */
export function sunCrossings(site: Site, anchors: SunAnchors, h0: number): Crossings {
  const grazing =
    Math.min(Math.abs(anchors.minAltDeg - h0), Math.abs(anchors.maxAltDeg - h0)) < 0.5;
  if (anchors.minAltDeg > h0)
    return { h0, startUtc: null, endUtc: null, kind: 'polarDay', grazing };
  if (anchors.maxAltDeg < h0)
    return { h0, startUtc: null, endUtc: null, kind: 'polarNight', grazing };
  const f = (t: number) => sunAt(t, site).altDeg - h0;
  return {
    h0,
    startUtc: bisect(f, anchors.transitUtc, anchors.antitransitUtc),
    endUtc: bisect(f, anchors.antitransitUtc, anchors.nextTransitUtc),
    kind: 'normal',
    grazing,
  };
}

const SLOT_SECONDS = 300;
const floorSlot = (t: number) => t - (((t % SLOT_SECONDS) + SLOT_SECONDS) % SLOT_SECONDS);
const ceilSlot = (t: number) => {
  const f = floorSlot(t);
  return f === t ? f : f + SLOT_SECONDS;
};

export interface NightInput {
  readonly site: Site;
  /** Nacht-Schlüssel `YYYY-MM-DD` (Abenddatum in Standortzeit). */
  readonly night: string;
  /** Übergangstabelle der Zeitzone (night.md §1). */
  readonly timeZoneTransitions: readonly TimeZoneTransition[];
  /** Himmelsflats (NT-40): zusätzlich Aufwärtsdurchgänge −8° und −2°. */
  readonly flatsSource?: 'panel' | 'sky';
}

export interface NightTimes {
  readonly night: string;
  readonly noonStartUtc: number;
  readonly noonEndUtc: number;
  readonly transitUtc: number;
  readonly antitransitUtc: number;
  readonly sunMaxAltDeg: number;
  readonly sunMinAltDeg: number;
  readonly twilight: Readonly<Record<LimitName, Crossings>>;
  /** Sonnenuntergang/-aufgang (geometrisch −0,8333°, Konvention AST-N9). */
  readonly sunset: Crossings;
  /** Nachtfenster nach NT-07: Beginn auf 5 min ab-, Ende auf 5 min aufgerundet (UTC-Uhr). */
  readonly nightWindow: {
    readonly startUtc: number;
    readonly endUtc: number;
    readonly slots: number;
  };
  /** Himmelsflats: nur bei `flatsSource = 'sky'` und vorhandenen Durchgängen, sonst beide `null`. */
  readonly skyFlats: { readonly notBeforeUtc: number | null; readonly notAfterUtc: number | null };
}

/** Zeiten einer Nacht (night.md §2–§3). */
export function nightTimes(input: NightInput): NightTimes {
  const { site, night } = input;
  const { noonStartUtc, noonEndUtc } = nightBounds(night, input.timeZoneTransitions);
  const anchors = sunAnchors(site, noonStartUtc, noonEndUtc);
  const twilight = {
    civil: sunCrossings(site, anchors, TWILIGHT_LIMITS.civil),
    nautical: sunCrossings(site, anchors, TWILIGHT_LIMITS.nautical),
    astronomical: sunCrossings(site, anchors, TWILIGHT_LIMITS.astronomical),
  };
  const civil = twilight.civil;
  let window: { startUtc: number; endUtc: number };
  if (civil.kind === 'normal' && civil.startUtc !== null && civil.endUtc !== null) {
    window = { startUtc: floorSlot(civil.startUtc - 3600), endUtc: ceilSlot(civil.endUtc + 3600) };
  } else if (civil.kind === 'polarDay') {
    // 18:00 Standortzeit + 12 h (wie Original, allocation.md §2)
    const start = localTimeOfNightUtc(night, 18 * 3600, input.timeZoneTransitions);
    window = { startUtc: start, endUtc: start + 12 * 3600 };
  } else {
    window = { startUtc: noonStartUtc, endUtc: noonEndUtc };
  }

  let skyFlats: { notBeforeUtc: number | null; notAfterUtc: number | null } = {
    notBeforeUtc: null,
    notAfterUtc: null,
  };
  if (input.flatsSource === 'sky') {
    const lower = sunCrossings(site, anchors, -8);
    const upper = sunCrossings(site, anchors, -2);
    if (lower.endUtc !== null && upper.endUtc !== null)
      skyFlats = { notBeforeUtc: lower.endUtc, notAfterUtc: upper.endUtc };
  }

  return {
    night,
    noonStartUtc,
    noonEndUtc,
    transitUtc: q(anchors.transitUtc, 1),
    antitransitUtc: q(anchors.antitransitUtc, 1),
    sunMaxAltDeg: q(anchors.maxAltDeg, 1e6),
    sunMinAltDeg: q(anchors.minAltDeg, 1e6),
    twilight,
    sunset: sunCrossings(site, anchors, -0.8333),
    nightWindow: { ...window, slots: (window.endUtc - window.startUtc) / SLOT_SECONDS },
    skyFlats,
  };
}

export interface MoonEvent {
  readonly type: 'rise' | 'set';
  readonly atUtc: number;
}

/**
 * Mondauf- und -untergänge in [from, to]: scheinbare topozentrische Höhe des **Mittelpunkts** = 0°
 * (moon.md AST-3). Suche im 10-min-Raster, danach Bisektion auf ≤ 1 s; ganze Sekunden.
 */
export function moonEvents(site: Site, fromUtc: number, toUtc: number): MoonEvent[] {
  const step = 600;
  const f = (t: number) => moonAt(t, site).altDeg;
  const out: MoonEvent[] = [];
  let a = fromUtc;
  let fa = f(a);
  while (a < toUtc) {
    const b = Math.min(a + step, toUtc);
    const fb = f(b);
    if (fa <= 0 !== fb <= 0) out.push({ type: fb > 0 ? 'rise' : 'set', atUtc: bisect(f, a, b) });
    a = b;
    fa = fb;
  }
  return out;
}
