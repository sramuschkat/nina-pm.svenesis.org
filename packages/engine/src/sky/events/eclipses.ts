/**
 * Die nächsten Finsternisse am Standort („Ereignisse der Nacht“): Mondfinsternisse aus dem Mond im Erdschatten
 * (geozentrisch, Schatten nach Chauvenet um 2 % vergrößert, Meeus Kap. 54) und Sonnenfinsternisse aus dem
 * topozentrischen Mond vor der topozentrischen Sonne, jeweils nur, wenn am Standort etwas davon zu sehen ist.
 * Portiert aus `legacy/astro-tools-2026-09-21/js/sky-events.js` (`nextSyzygy`, `shadowAt`, `lunarEclipses`,
 * `solarEclipses`) und `observing-planner.js` (`renderEvents`: Suche ab dem 14-Tage-Block, je Art drei).
 * Abweichung: Sonne und Mond kommen aus der Engine (TT = UT + ΔT), alle Zeiten sind UT ohne die ΔT-Rückrechnung
 * der Vorlage und auf ganze Sekunden gerundet. Zeiten etwa ±2 min. Nur Anzeige.
 */
import { acos, asin } from '../../math';
import { DEG, norm360, separationDeg } from '../../astro/angles';
import { moonAt, sunAt } from '../../astro/bodies';
import { topocentric, type Site } from '../../astro/horizon';
import { moonApparent } from '../../astro/moon';
import { moonPhaseAngleDeg } from '../../astro/moon-phase';
import { sunApparent } from '../../astro/sun';
import { jdeFromUnix } from '../../astro/time';
import { roundHalfAwayFromZero } from '../../round';
import { bisect, goldenMin } from './common';

const AU_KM = 149597870.7;
const DAY_S = 86400;
const YEAR_S = 365.25 * DAY_S;
const MOON_RADIUS_KM = 1737.4;
const EARTH_RADIUS_KM = 6378.14;

/** Nächster Neumond (`targetDeg` 0) bzw. Vollmond (180) nach `fromUtc`, Unix-Sekunden (nicht gerundet). */
export function nextSyzygy(fromUtc: number, targetDeg: 0 | 180): number | null {
  const past = (x: number) => norm360(moonPhaseAngleDeg(x) - targetDeg);
  let a = fromUtc;
  let pa = past(a);
  for (let i = 0; i < 80; i++) {
    let b = a + 43200;
    const pb = past(b);
    if (pb < pa) {
      for (let j = 0; j < 30; j++) {
        const m = (a + b) / 2;
        if (past(m) > 180) a = m;
        else b = m;
      }
      return (a + b) / 2;
    }
    a = b;
    pa = pb;
  }
  return null;
}

/**
 * Mond gegen den Erdschatten zu `unixSec` (geozentrisch, Grad): Abstand von der Schattenachse `d`, Mondradius
 * `sm`, Kernschatten `ru` und Halbschatten `rp` in Mondentfernung, um 2 % für die Atmosphäre vergrößert.
 */
export function earthShadowAt(unixSec: number): { d: number; sm: number; ru: number; rp: number } {
  const jde = jdeFromUnix(unixSec);
  const s = sunApparent(jde);
  const m = moonApparent(jde);
  const pm = asin(EARTH_RADIUS_KM / m.distanceKm) * DEG;
  const ps = 8.794 / 3600 / s.distanceAu;
  const ss = 959.63 / 3600 / s.distanceAu;
  return {
    d: separationDeg(m.raDeg, m.decDeg, s.raDeg + 180, -s.decDeg),
    sm: asin(MOON_RADIUS_KM / m.distanceKm) * DEG,
    ru: 1.02 * (0.99834 * pm - ss + ps),
    rp: 1.02 * (0.99834 * pm + ss + ps),
  };
}

export type LunarEclipseKind = 'penumbral' | 'partial' | 'total';
export type SolarEclipseKind = 'partial' | 'annular' | 'total';

export interface LunarEclipse {
  readonly kind: LunarEclipseKind;
  /** Größte Finsternis, Unix-Sekunden (UTC). */
  readonly maxUtc: number;
  /** Größe im Kernschatten (≤ 0: keiner; ≥ 1: total) und im Halbschatten (Anteil des Monddurchmessers). */
  readonly umbralMag: number;
  readonly penumbralMag: number;
  /** Kontakte, Unix-Sekunden; `null`, wo es keinen gibt (U1/U4 nur mit Kernschatten, U2/U3 nur total). */
  readonly p1Utc: number;
  readonly u1Utc: number | null;
  readonly u2Utc: number | null;
  readonly u3Utc: number | null;
  readonly u4Utc: number | null;
  readonly p4Utc: number;
  /** Geometrische topozentrische Mondhöhe zur größten Finsternis, Grad (negativ: unter dem Horizont). */
  readonly altDeg: number;
  /** Erste und letzte 5-min-Probe der Kernschattenphase (sonst Halbschattenphase) mit dem Mond über dem Horizont. */
  readonly visFromUtc: number;
  readonly visToUtc: number;
  /** Diese Phase ist ganz zu sehen. */
  readonly whole: boolean;
}

export interface SolarEclipse {
  readonly kind: SolarEclipseKind;
  /** Größte Finsternis am Standort, Unix-Sekunden (UTC). */
  readonly maxUtc: number;
  /** Größe: bedeckter Anteil des Sonnendurchmessers; Bedeckung: bedeckter Anteil der Sonnenfläche (0–1). */
  readonly magnitude: number;
  readonly obscuration: number;
  /** Kontakte, Unix-Sekunden; C2/C3 nur, wenn die Finsternis am Standort zentral (total/ringförmig) ist. */
  readonly c1Utc: number;
  readonly c2Utc: number | null;
  readonly c3Utc: number | null;
  readonly c4Utc: number;
  /** Geometrische Sonnenhöhe zur größten Finsternis, Grad. */
  readonly altDeg: number;
  /** Erste und letzte 2-min-Probe zwischen C1 und C4 mit der Sonne über −0,5°. */
  readonly visFromUtc: number;
  readonly visToUtc: number;
  readonly whole: boolean;
}

const sec = roundHalfAwayFromZero;
const secOrNull = (x: number | null) => (x === null ? null : sec(x));

/**
 * Mondfinsternisse ab `fromUtc` (Vorlage `lunarEclipses`), höchstens `count` innerhalb von `maxYears` Jahren,
 * die am Standort zumindest teilweise zu sehen sind: der Mond über dem Horizont während der Kernschattenphase,
 * bei einer Halbschattenfinsternis während der Halbschattenphase.
 */
export function lunarEclipses(
  fromUtc: number,
  maxYears: number,
  count: number,
  site: Site,
): LunarEclipse[] {
  const out: LunarEclipse[] = [];
  const until = fromUtc + maxYears * YEAR_S;
  const moonAlt = (x: number) => moonAt(x, site).altGeometricDeg;
  let t = fromUtc;
  while (out.length < count && t < until) {
    const full = nextSyzygy(t, 180);
    if (full === null) break;
    t = full + 25 * DAY_S;
    const q0 = earthShadowAt(full);
    if (q0.d > q0.rp + q0.sm + 0.5) continue;
    const tm = goldenMin((x) => earthShadowAt(x).d, full - 6 * 3600, full + 6 * 3600, 2);
    const s0 = earthShadowAt(tm);
    const pen = (s0.rp + s0.sm - s0.d) / (2 * s0.sm);
    const umb = (s0.ru + s0.sm - s0.d) / (2 * s0.sm);
    if (pen <= 0) continue;
    const contact = (radius: (z: ReturnType<typeof earthShadowAt>) => number) => {
      const f = (x: number) => {
        const z = earthShadowAt(x);
        return z.d - radius(z);
      };
      return f(tm) >= 0
        ? null
        : ([bisect(f, tm - 5 * 3600, tm, 24), bisect(f, tm, tm + 5 * 3600, 24)] as const);
    };
    const p = contact((z) => z.rp + z.sm);
    const u = umb > 0 ? contact((z) => z.ru + z.sm) : null;
    const tot = umb >= 1 ? contact((z) => z.ru - z.sm) : null;
    const span = u ?? p;
    if (!p || !span) continue;
    const vis: number[] = [];
    for (let tt = span[0]; tt <= span[1]; tt += 300) if (moonAlt(tt) > 0) vis.push(tt);
    const visFrom = vis[0];
    const visTo = vis[vis.length - 1];
    if (visFrom === undefined || visTo === undefined) continue;
    out.push({
      kind: umb >= 1 ? 'total' : umb > 0 ? 'partial' : 'penumbral',
      maxUtc: sec(tm),
      umbralMag: umb,
      penumbralMag: pen,
      p1Utc: sec(p[0]),
      u1Utc: secOrNull(u ? u[0] : null),
      u2Utc: secOrNull(tot ? tot[0] : null),
      u3Utc: secOrNull(tot ? tot[1] : null),
      u4Utc: secOrNull(u ? u[1] : null),
      p4Utc: sec(p[1]),
      altDeg: moonAlt(tm),
      visFromUtc: sec(visFrom),
      visToUtc: sec(visTo),
      whole: vis.length > (span[1] - span[0]) / 300,
    });
  }
  return out;
}

/** Topozentrischer Mond gegen topozentrische Sonne zu `unixSec` (Grad): Abstand, Sonnen- und Mondradius. */
function localDiscs(unixSec: number, site: Site): { sep: number; ss: number; sm: number } {
  const jde = jdeFromUnix(unixSec);
  const g = sunApparent(jde);
  const s = topocentric(g.raDeg, g.decDeg, g.distanceAu * AU_KM, unixSec, site);
  const mg = moonApparent(jde);
  const m = topocentric(mg.raDeg, mg.decDeg, mg.distanceKm, unixSec, site);
  return {
    sep: separationDeg(m.raDeg, m.decDeg, s.raDeg, s.decDeg),
    ss: 959.63 / 3600 / (s.distanceKm / AU_KM),
    sm: asin(MOON_RADIUS_KM / m.distanceKm) * DEG,
  };
}

const clamp1 = (x: number) => Math.max(-1, Math.min(1, x));

/**
 * Sonnenfinsternisse am Standort ab `fromUtc` (Vorlage `solarEclipses`), höchstens `count` innerhalb von
 * `maxYears` Jahren: an jedem Neumond nahe genug am Knoten (geozentrisch ≤ 1,8°) der topozentrische Mond vor
 * der topozentrischen Sonne; gelistet, wenn die Sonne zwischen C1 und C4 einmal über −0,5° steht.
 */
export function solarEclipses(
  fromUtc: number,
  maxYears: number,
  count: number,
  site: Site,
): SolarEclipse[] {
  const out: SolarEclipse[] = [];
  const until = fromUtc + maxYears * YEAR_S;
  let t = fromUtc;
  while (out.length < count && t < until) {
    const nm = nextSyzygy(t, 0);
    if (nm === null) break;
    t = nm + 25 * DAY_S;
    const jde = jdeFromUnix(nm);
    const gs = sunApparent(jde);
    const gm = moonApparent(jde);
    if (separationDeg(gm.raDeg, gm.decDeg, gs.raDeg, gs.decDeg) > 1.8) continue;
    const tm = goldenMin((x) => localDiscs(x, site).sep, nm - 5 * 3600, nm + 5 * 3600, 2);
    const l = localDiscs(tm, site);
    if (l.sep >= l.sm + l.ss) continue;
    const f1 = (x: number) => {
      const z = localDiscs(x, site);
      return z.sep - (z.sm + z.ss);
    };
    const c1 = bisect(f1, tm - 4 * 3600, tm, 24);
    const c4 = bisect(f1, tm, tm + 4 * 3600, 24);
    const central = l.sep < Math.abs(l.sm - l.ss);
    let c2: number | null = null;
    let c3: number | null = null;
    if (central) {
      const f2 = (x: number) => {
        const z = localDiscs(x, site);
        return z.sep - Math.abs(z.sm - z.ss);
      };
      c2 = bisect(f2, c1, tm, 24);
      c3 = bisect(f2, tm, c4, 24);
    }
    const vis: number[] = [];
    for (let tt = c1; tt <= c4; tt += 120) if (sunAt(tt, site).altDeg > -0.5) vis.push(tt);
    const visFrom = vis[0];
    const visTo = vis[vis.length - 1];
    if (visFrom === undefined || visTo === undefined) continue;
    const bigR = l.ss;
    const r = l.sm;
    const dd = l.sep;
    const obscuration =
      dd <= Math.abs(bigR - r)
        ? Math.min(1, (r * r) / (bigR * bigR))
        : (r * r * acos(clamp1((dd * dd + r * r - bigR * bigR) / (2 * dd * r))) +
            bigR * bigR * acos(clamp1((dd * dd + bigR * bigR - r * r) / (2 * dd * bigR))) -
            0.5 *
              Math.sqrt(
                Math.max(0, (-dd + r + bigR) * (dd + r - bigR) * (dd - r + bigR) * (dd + r + bigR)),
              )) /
          (Math.PI * bigR * bigR);
    out.push({
      kind: central ? (l.sm > l.ss ? 'total' : 'annular') : 'partial',
      maxUtc: sec(tm),
      magnitude: (l.sm + l.ss - l.sep) / (2 * l.ss),
      obscuration,
      c1Utc: sec(c1),
      c2Utc: secOrNull(c2),
      c3Utc: secOrNull(c3),
      c4Utc: sec(c4),
      altDeg: sunAt(tm, site).altDeg,
      visFromUtc: sec(visFrom),
      visToUtc: sec(visTo),
      whole: vis.length > (c4 - c1) / 120,
    });
  }
  return out;
}

export type SiteEclipse =
  ({ readonly body: 'lunar' } & LunarEclipse) | ({ readonly body: 'solar' } & SolarEclipse);

/** Suchblock der Vorlage (14 Tage), damit das Ergebnis innerhalb eines Blocks nicht vom Suchbeginn abhängt. */
const ECLIPSE_BLOCK_S = 14 * DAY_S;

/**
 * „Die nächsten Finsternisse am Standort“ wie der Beobachtungsplaner (`renderEvents`): gesucht ab dem Beginn
 * des 14-Tage-Blocks, der `eveningUtc` enthält (Mondfinsternisse 10 Jahre, Sonnenfinsternisse 20 Jahre,
 * je `perKind + 1`), behalten, was bis `eveningUtc` noch nicht vorbei ist (`visToUtc` ≥ `eveningUtc`), je
 * Art höchstens `perKind` (Vorlage 3), zusammen nach größter Finsternis sortiert (Gleichstand: Mond zuerst).
 * `eveningUtc`: Beginn der Nacht (Vorlage: Ortsmittag vor der Nacht).
 */
export function nextEclipses(site: Site, eveningUtc: number, perKind = 3): SiteEclipse[] {
  const from = Math.floor(eveningUtc / ECLIPSE_BLOCK_S) * ECLIPSE_BLOCK_S;
  const keep = <T extends { visToUtc: number }>(list: readonly T[]) =>
    list.filter((x) => x.visToUtc >= eveningUtc).slice(0, perKind);
  const lunar = keep(lunarEclipses(from, 10, perKind + 1, site)).map((x): SiteEclipse => ({
    body: 'lunar',
    ...x,
  }));
  const solar = keep(solarEclipses(from, 20, perKind + 1, site)).map((x): SiteEclipse => ({
    body: 'solar',
    ...x,
  }));
  return lunar
    .concat(solar)
    .sort((a, b) => a.maxUtc - b.maxUtc || (a.body === b.body ? 0 : a.body === 'lunar' ? -1 : 1));
}
