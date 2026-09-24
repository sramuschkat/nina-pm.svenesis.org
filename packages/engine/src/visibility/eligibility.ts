/**
 * Nutzbarkeit je Ziel und Zeile `buildEligibility` (allocation.md §3.1/§3.3, night.md §3, FK 8.1):
 * `CanImage[s]` = Sonne (geometrisch) unter der Dämmerungsgrenze des Projekts **und** scheinbare
 * Zielhöhe ≥ Mindesthöhe **und** Nacht ≥ Startdatum – jeweils zu Beginn und Ende des Slots (A-26).
 * `safe[l][s]` = `moonSafe` des Zeilenprofils an beiden Slotgrenzen; Zeilen ohne Profil sind immer sicher.
 * Vorfilter über die Kulminationshöhe (AST-N11): nie sichtbare Ziele ohne Rasterlauf.
 */
import { norm180, separationDeg } from '../astro/angles';
import { altAz, apparentAltitudeDeg, localApparentSiderealDeg, type Site } from '../astro/horizon';
import { targetApparent, type Target } from '../astro/target';
import { q } from '../round';
import { moonSafe, type MoonProfile } from './moon-safe';
import type { NightContext } from './night-context';

export type TwilightLimit = 'civil' | 'nautical' | 'astronomical';

/** Geometrische Sonnenhöhe der Dämmerungsgrenzen (night.md §2). */
export const TWILIGHT_DEG: Readonly<Record<TwilightLimit, number>> = {
  civil: -6,
  nautical: -12,
  astronomical: -18,
};

export interface EligibilityLine {
  readonly id: string;
  /** `null` = Zeile ohne Mondvermeidung (immer sicher). */
  readonly moonProfile: MoonProfile | null;
}

export interface EligibilityInput {
  readonly target: Target;
  readonly twilight: TwilightLimit;
  readonly minAltDeg: number;
  /** Nacht-Schlüssel; Nächte davor sind nicht nutzbar. */
  readonly startDate?: string | null;
  readonly lines?: readonly EligibilityLine[];
}

export type Visibility = 'never' | 'circumpolar' | 'normal';

export interface Eligibility {
  /** Vorfilter aus der Kulminationshöhe (AST-N11). */
  readonly visibility: Visibility;
  /** Scheinbare Zielhöhe je Slotgrenze; leer bei `never`. */
  readonly targetAltDeg: readonly number[];
  readonly canImage: readonly boolean[];
  readonly lines: readonly { readonly id: string; readonly safe: readonly boolean[] }[];
  readonly usableSlots: number;
  /** Längster zusammenhängender Lauf nutzbarer Slots. */
  readonly longestRunSlots: number;
  readonly firstUsableSlot: number | null;
  readonly lastUsableSlot: number | null;
  /** Höchste scheinbare Zielhöhe in nutzbaren Slots (Slotgrenzen), sonst `null`. */
  readonly peakAltDeg: number | null;
}

/** R(h) in Grad an der Kulmination: dieselbe Saemundsson-Formel wie für alle Höhen. */
const culminationApparent = (hMaxGeo: number) => apparentAltitudeDeg(hMaxGeo);

/**
 * Vorfilter (AST-N11): `h_max = 90° − |φ − δ|`; `h_max + R(h_max) < minAlt` → nie sichtbar;
 * `|φ + δ| − 90° ≥ minAlt` (untere Kulmination über der Mindesthöhe) → zirkumpolar.
 */
export function culminationVisibility(
  latDeg: number,
  decDeg: number,
  minAltDeg: number,
): Visibility {
  const hMax = 90 - Math.abs(latDeg - decDeg);
  if (q(culminationApparent(hMax), 1e6) < q(minAltDeg, 1e6)) return 'never';
  if (q(Math.abs(latDeg + decDeg) - 90, 1e6) >= q(minAltDeg, 1e6)) return 'circumpolar';
  return 'normal';
}

function runs(mask: readonly boolean[]): {
  longest: number;
  first: number | null;
  last: number | null;
} {
  let longest = 0;
  let current = 0;
  let first: number | null = null;
  let last: number | null = null;
  mask.forEach((ok, s) => {
    if (ok) {
      current += 1;
      if (current > longest) longest = current;
      if (first === null) first = s;
      last = s;
    } else current = 0;
  });
  return { longest, first, last };
}

export function buildEligibility(ctx: NightContext, input: EligibilityInput): Eligibility {
  const S = ctx.slotCount;
  const place = targetApparent(input.target, ctx.jdeMid);
  const visibility = culminationVisibility(ctx.site.latDeg, place.decDeg, input.minAltDeg);
  const lines = input.lines ?? [];
  const started =
    input.startDate === undefined || input.startDate === null || ctx.night >= input.startDate;
  if (visibility === 'never' || !started) {
    const none = new Array<boolean>(S).fill(false);
    return {
      visibility,
      targetAltDeg: [],
      canImage: none,
      lines: lines.map((l) => ({ id: l.id, safe: none })),
      usableSlots: 0,
      longestRunSlots: 0,
      firstUsableSlot: null,
      lastUsableSlot: null,
      peakAltDeg: null,
    };
  }
  const site: Site = ctx.site;
  const sunLimit = q(TWILIGHT_DEG[input.twilight], 1e6);
  const minAlt = q(input.minAltDeg, 1e6);
  const targetAltDeg: number[] = [];
  const pointOk: boolean[] = [];
  const sep: number[] = [];
  for (let k = 0; k <= S; k += 1) {
    const t = ctx.boundaryUtc[k] as number;
    // Der scheinbare Ort ändert sich über eine Nacht um < 0,01″; die Sternzeit läuft je Grenze.
    const ha = norm180(localApparentSiderealDeg(t, site.lonDeg) - place.raDeg);
    const alt = apparentAltitudeDeg(altAz(ha, place.decDeg, site.latDeg).altDeg);
    targetAltDeg.push(alt);
    const sunOk = q(ctx.sunAltDeg[k] as number, 1e6) < sunLimit;
    pointOk.push(sunOk && q(alt, 1e6) >= minAlt);
    const m = ctx.moon[k];
    sep.push(m ? separationDeg(m.raDeg, m.decDeg, place.raDeg, place.decDeg) : 0);
  }
  const canImage: boolean[] = [];
  for (let s = 0; s < S; s += 1) canImage.push(pointOk[s] === true && pointOk[s + 1] === true);

  const lineMasks = lines.map((line) => {
    const profile = line.moonProfile;
    if (!profile) return { id: line.id, safe: new Array<boolean>(S).fill(true) };
    const pointSafe: boolean[] = [];
    for (let k = 0; k <= S; k += 1) {
      const m = ctx.moon[k];
      pointSafe.push(
        m
          ? moonSafe(profile, {
              moonAltDeg: m.altDeg,
              illumPct: m.illumPct,
              phaseDays: m.phaseDays,
              sepDeg: sep[k] as number,
            })
          : false,
      );
    }
    const safe: boolean[] = [];
    for (let s = 0; s < S; s += 1) safe.push(pointSafe[s] === true && pointSafe[s + 1] === true);
    return { id: line.id, safe };
  });

  const r = runs(canImage);
  let peak: number | null = null;
  canImage.forEach((ok, s) => {
    if (!ok) return;
    const a = Math.max(targetAltDeg[s] as number, targetAltDeg[s + 1] as number);
    if (peak === null || a > peak) peak = a;
  });
  return {
    visibility,
    targetAltDeg,
    canImage,
    lines: lineMasks,
    usableSlots: canImage.filter(Boolean).length,
    longestRunSlots: r.longest,
    firstUsableSlot: r.first,
    lastUsableSlot: r.last,
    peakAltDeg: peak === null ? null : q(peak, 1e6),
  };
}
