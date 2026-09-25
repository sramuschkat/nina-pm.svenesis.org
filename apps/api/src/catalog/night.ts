/**
 * Nachtwerte im Objektbrowser (AP-20; FA-FRM-15, S-21): je Standort und Nacht ein Nachtkontext der
 * Engine (5-min-Slots, Sonne und Mond an jeder Slotgrenze), je Objekt dieselbe Nutzbarkeit wie
 * `buildEligibility` im Scheduler – nutzbare Stunden (dunkel und über der Mindesthöhe), beste Höhe und
 * Zeit im Dunkeln und Mondabstand zur besten Zeit. Die Sternzeit je Slotgrenze wird einmal je Nacht
 * gerechnet statt je Objekt (13.600 Objekte in unter einer Sekunde; Gleichheit mit `buildEligibility`
 * prüft `catalog.test.ts`). Werte je Objekt werden erst bei Bedarf gerechnet und gemerkt; die
 * letzten Nächte bleiben im Speicher der `api`.
 */
import {
  altAz,
  apparentAltitudeDeg,
  buildNightContext,
  culminationVisibility,
  localApparentSiderealDeg,
  norm180,
  q,
  separationDeg,
  targetApparent,
  TWILIGHT_DEG,
  type NightContext,
  type TimeZoneTransition,
  type TwilightLimit,
} from '@nina-pm/engine';
import type { DsoNight } from '@nina-pm/shared';
import { isoUtc } from '../lib/format';
import { sampleWeight } from './score';
import type { CatalogRow } from './search';

export interface NightMeta {
  readonly night: string;
  readonly timeZone: string;
  readonly darkStartUtc: string | null;
  readonly darkEndUtc: string | null;
  readonly moonIllumPct: number | null;
}

export interface NightEvaluator {
  readonly meta: NightMeta;
  metrics(row: CatalogRow): Omit<DsoNight, 'score'>;
  /**
   * Zielvorschläge (FA-FRM-13): mit Höhe und Mond gewichtete Stunden im Dunkeln (5-min-Slots, Höhe zu
   * Slotbeginn) und die Dauer der Dunkelheit; `null` ohne Dunkelheit an der gewählten Grenze.
   */
  weighted(row: CatalogRow, kind: string): { weightedHours: number; darkHours: number } | null;
}

export interface NightEvaluatorInput {
  readonly site: { readonly latDeg: number; readonly lonDeg: number; readonly timeZone: string };
  readonly night: string;
  readonly timeZoneTransitions: readonly TimeZoneTransition[];
  readonly minAltDeg: number;
  readonly twilight: TwilightLimit;
}

const iso = (unixSec: number) => isoUtc(new Date(unixSec * 1000));
const round1 = (x: number) => Math.round(x * 10) / 10;

export function nightEvaluator(input: NightEvaluatorInput): NightEvaluator {
  const ctx: NightContext = buildNightContext({
    site: { latDeg: input.site.latDeg, lonDeg: input.site.lonDeg },
    night: input.night,
    timeZoneTransitions: input.timeZoneTransitions,
  });
  const sunLimit = TWILIGHT_DEG[input.twilight];
  const dark = ctx.sunAltDeg.map((a) => a < sunLimit);
  const anyDark = dark.some(Boolean);
  const crossings = ctx.times.twilight[input.twilight];
  const mid = ctx.moon[Math.floor(ctx.moon.length / 2)];
  const meta: NightMeta = {
    night: input.night,
    timeZone: input.site.timeZone,
    darkStartUtc:
      crossings.kind === 'normal' && crossings.startUtc !== null ? iso(crossings.startUtc) : null,
    darkEndUtc:
      crossings.kind === 'normal' && crossings.endUtc !== null ? iso(crossings.endUtc) : null,
    moonIllumPct: mid ? Math.round(mid.illumPct) : null,
  };
  const memo = new Map<string, Omit<DsoNight, 'score'>>();
  const weightedMemo = new Map<string, { weightedHours: number; darkHours: number } | null>();
  // Wie buildEligibility: Sonne und Mindesthöhe auf 1e-6 quantisiert verglichen.
  const sunOk = ctx.sunAltDeg.map((a) => q(a, 1e6) < q(sunLimit, 1e6));
  const lst = ctx.boundaryUtc.map((t) => localApparentSiderealDeg(t, ctx.site.lonDeg));
  const minAlt = q(input.minAltDeg, 1e6);
  const S = ctx.slotCount;

  // Mond je Slotgrenze als Einheitsvektor (scheinbar, topozentrisch) – Abstand ohne weitere Trigonometrie.
  const moonVec = ctx.moon.map((m) => (m.altDeg > 0 ? unit(m.raDeg, m.decDeg) : null));
  const darkSlots: number[] = [];
  for (let s = 0; s < S; s += 1) if (sunOk[s] && sunOk[s + 1]) darkSlots.push(s);
  const darkHours = (darkSlots.length * 300) / 3600;

  const placeOf = (row: CatalogRow) =>
    targetApparent({ raJ2000Deg: row.raDeg, decJ2000Deg: row.decDeg }, ctx.jdeMid);
  const altitudesOf = (place: { raDeg: number; decDeg: number }) =>
    lst.map((l) =>
      apparentAltitudeDeg(altAz(norm180(l - place.raDeg), place.decDeg, ctx.site.latDeg).altDeg),
    );

  const computeWeighted = (row: CatalogRow, kind: string) => {
    if (darkSlots.length === 0) return null;
    const place = placeOf(row);
    const alt = altitudesOf(place);
    const p = unit(place.raDeg, place.decDeg);
    let sum = 0;
    for (const s of darkSlots) {
      const m = moonVec[s];
      const sample = ctx.moon[s];
      const moon =
        m && sample
          ? {
              up: true,
              illumFraction: sample.illumPct / 100,
              sepDeg:
                (Math.acos(Math.max(-1, Math.min(1, m[0] * p[0] + m[1] * p[1] + m[2] * p[2]))) *
                  180) /
                Math.PI,
            }
          : null;
      sum += sampleWeight(alt[s] as number, moon, kind);
    }
    return { weightedHours: (sum * 300) / 3600, darkHours };
  };

  const compute = (row: CatalogRow): Omit<DsoNight, 'score'> => {
    const place = placeOf(row);
    const visibility = culminationVisibility(ctx.site.latDeg, place.decDeg, input.minAltDeg);
    if (visibility === 'never')
      return { visibility, usableHours: 0, peakAltDeg: null, peakUtc: null, moonSepDeg: null };
    const alt = altitudesOf(place);
    const ok = alt.map((a, k) => sunOk[k] === true && q(a, 1e6) >= minAlt);
    let usableSlots = 0;
    for (let s = 0; s < S; s += 1) if (ok[s] && ok[s + 1]) usableSlots += 1;
    let best = -1;
    alt.forEach((a, k) => {
      if (anyDark && !dark[k]) return;
      if (best < 0 || a > (alt[best] as number)) best = k;
    });
    const peakAlt = alt[best] as number;
    const moon = ctx.moon[best];
    const moonSepDeg =
      moon && moon.altDeg > 0
        ? Math.round(separationDeg(moon.raDeg, moon.decDeg, place.raDeg, place.decDeg))
        : null;
    return {
      visibility,
      usableHours: round1((usableSlots * 300) / 3600),
      peakAltDeg: peakAlt > 0 ? round1(peakAlt) : null,
      peakUtc: peakAlt > 0 ? iso(ctx.boundaryUtc[best] as number) : null,
      moonSepDeg,
    };
  };

  return {
    meta,
    metrics(row) {
      let m = memo.get(row.primaryId);
      if (!m) {
        m = compute(row);
        memo.set(row.primaryId, m);
      }
      return m;
    },
    weighted(row, kind) {
      const key = `${row.primaryId}:${kind}`;
      if (!weightedMemo.has(key)) weightedMemo.set(key, computeWeighted(row, kind));
      return weightedMemo.get(key) ?? null;
    },
  };
}

const unit = (raDeg: number, decDeg: number): [number, number, number] => {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
};

/** Die letzten Auswertungen (Standort × Nacht × Mindesthöhe × Dämmerung) bleiben im Speicher. */
const MAX_EVALUATORS = 8;
const evaluators = new Map<string, NightEvaluator>();

export function cachedNightEvaluator(key: string, build: () => NightEvaluator): NightEvaluator {
  let e = evaluators.get(key);
  if (e) {
    evaluators.delete(key);
    evaluators.set(key, e);
    return e;
  }
  e = build();
  evaluators.set(key, e);
  while (evaluators.size > MAX_EVALUATORS) {
    const oldest = evaluators.keys().next().value;
    if (oldest === undefined) break;
    evaluators.delete(oldest);
  }
  return e;
}

export function clearNightCache() {
  evaluators.clear();
}
