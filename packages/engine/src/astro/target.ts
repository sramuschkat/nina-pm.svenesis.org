/**
 * Feste Ziele (J2000) am Standort (TK 8.4, flip-rotation.md §1.1): scheinbarer Ort zum Datum =
 * Präzession (Meeus 21) + Nutation (Meeus 23.1), **ohne** Aberration (≤ 20,5″, TK 9.1).
 * Meridiandurchgang in der geschlossenen Form (WS-24) – liefert per Konstruktion die erste
 * Kulmination im Fenster, ganze Sekunden **abgerundet**.
 */
import { cosD, norm180, norm360, sinD, tanD } from './angles';
import { altAz, apparentAltitudeDeg, localApparentSiderealDeg, type Site } from './horizon';
import { nutation } from './nutation';
import { precessFromJ2000 } from './precession';
import { jdeFromUnix } from './time';

/** Siderische Rate des Stundenwinkels, °/h. */
const SIDEREAL_RATE_DEG_PER_HOUR = 15.0410686;

export interface Target {
  readonly raJ2000Deg: number;
  readonly decJ2000Deg: number;
}

/** Scheinbarer Ort zum Datum (ohne Aberration); `jde` in TT. */
export function targetApparent(target: Target, jde: number): { raDeg: number; decDeg: number } {
  const mean = precessFromJ2000(target.raJ2000Deg, target.decJ2000Deg, jde);
  const nu = nutation(jde);
  const a = mean.raDeg;
  const d = mean.decDeg;
  const e = nu.epsDeg;
  const dRa = (cosD(e) + sinD(e) * sinD(a) * tanD(d)) * nu.dpsiDeg - cosD(a) * tanD(d) * nu.depsDeg;
  const dDec = sinD(e) * cosD(a) * nu.dpsiDeg + sinD(a) * nu.depsDeg;
  return { raDeg: norm360(a + dRa), decDeg: d + dDec };
}

export interface TargetAtSite {
  readonly raDeg: number;
  readonly decDeg: number;
  readonly hourAngleDeg: number;
  /** Geometrische Höhe (ohne Refraktion). */
  readonly altGeometricDeg: number;
  /** Scheinbare Höhe (Saemundsson). */
  readonly altDeg: number;
  readonly azDeg: number;
}

export function targetAt(target: Target, unixSec: number, site: Site): TargetAtSite {
  const place = targetApparent(target, jdeFromUnix(unixSec));
  const ha = norm180(localApparentSiderealDeg(unixSec, site.lonDeg) - place.raDeg);
  const { altDeg, azDeg } = altAz(ha, place.decDeg, site.latDeg);
  return {
    raDeg: place.raDeg,
    decDeg: place.decDeg,
    hourAngleDeg: ha,
    altGeometricDeg: altDeg,
    altDeg: apparentAltitudeDeg(altDeg),
    azDeg,
  };
}

/**
 * Erste obere (bzw. untere, NT-26) Kulmination in `[windowStart, windowEnd)`; sonst `null`.
 * `t = t_start + ((Ziel − LHA(t_start)) mod 360°) / 15,0410686 °/h`, auf ganze Sekunden abgerundet.
 */
export function meridianTransitUtc(
  target: Target,
  site: Site,
  windowStartUtc: number,
  windowEndUtc: number,
  culmination: 'upper' | 'lower' = 'upper',
): number | null {
  const lha = norm360(targetAt(target, windowStartUtc, site).hourAngleDeg);
  const goal = culmination === 'upper' ? 360 : 180;
  const t = windowStartUtc + (norm360(goal - lha) / SIDEREAL_RATE_DEG_PER_HOUR) * 3600;
  const floored = Math.floor(t);
  return floored < windowEndUtc ? floored : null;
}
