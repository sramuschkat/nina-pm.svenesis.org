/**
 * Sonne und Mond am Standort (TK 8.4, moon.md §Eingaben): Ephemeridenargumente in TT = UT + ΔT,
 * Sternzeit aus UT. Mondhöhe **topozentrisch** und **scheinbar** (geometrisch + Saemundsson);
 * Beleuchtung aus der **geozentrischen** Elongation mit `atan2` (Meeus Kap. 48).
 */
import { atan2D, cosD, norm180, norm360, separationDeg, sinD } from './angles';
import {
  altAz,
  apparentAltitudeDeg,
  localApparentSiderealDeg,
  topocentric,
  type Site,
} from './horizon';
import { moonApparent } from './moon';
import { sunApparent } from './sun';
import { jdeFromUnix } from './time';

const AU_KM = 149597870.7;
/** Mittlere Rate der Phasenlage, °/Tag (moon.md: Phasenmaß `d`, AST-M9). */
const SYNODIC_RATE_DEG_PER_DAY = 12.1907;

export interface SunAtSite {
  readonly raDeg: number;
  readonly decDeg: number;
  /** Geometrische Höhe des Sonnenmittelpunkts (Grundlage der Dämmerung, night.md §2). */
  readonly altDeg: number;
  readonly azDeg: number;
  /** Stundenwinkel in (−180, 180]. */
  readonly hourAngleDeg: number;
}

export function sunAt(unixSec: number, site: Site): SunAtSite {
  const s = sunApparent(jdeFromUnix(unixSec));
  const ha = norm180(localApparentSiderealDeg(unixSec, site.lonDeg) - s.raDeg);
  const { altDeg, azDeg } = altAz(ha, s.decDeg, site.latDeg);
  return { raDeg: s.raDeg, decDeg: s.decDeg, altDeg, azDeg, hourAngleDeg: ha };
}

export interface MoonAtSite {
  /** Topozentrisch, unrefraktiert, zum Datum (Grundlage für `sep`, AST-M4). */
  readonly raDeg: number;
  readonly decDeg: number;
  /** Geometrische topozentrische Höhe (ohne Refraktion). */
  readonly altGeometricDeg: number;
  /** Scheinbare topozentrische Höhe des Mittelpunkts (`moonAlt`). */
  readonly altDeg: number;
  readonly azDeg: number;
  /** Beleuchteter Anteil in % (0–100). */
  readonly illumPct: number;
  /** Geozentrische Elongation Sonne–Mond, Grad. */
  readonly elongationDeg: number;
  /** Phasenmaß in Tag-Äquivalenten bis/seit Vollmond (moon.md, `d`). */
  readonly phaseDays: number;
  /** Abstand Erde–Mond, km (geozentrisch). */
  readonly distanceKm: number;
}

/** Beleuchteter Anteil aus Elongation ψ und den Distanzen (Meeus 48.2/48.3 mit atan2). */
export function illuminationPct(
  elongationDeg: number,
  moonDistKm: number,
  sunDistKm: number,
): number {
  const i = atan2D(sunDistKm * sinD(elongationDeg), moonDistKm - sunDistKm * cosD(elongationDeg));
  return (100 * (1 + cosD(i))) / 2;
}

export function moonAt(unixSec: number, site: Site): MoonAtSite {
  const jde = jdeFromUnix(unixSec);
  const m = moonApparent(jde);
  const s = sunApparent(jde);
  const topo = topocentric(m.raDeg, m.decDeg, m.distanceKm, unixSec, site);
  const ha = norm180(localApparentSiderealDeg(unixSec, site.lonDeg) - topo.raDeg);
  const { altDeg: geo, azDeg } = altAz(ha, topo.decDeg, site.latDeg);
  const elong = separationDeg(s.raDeg, s.decDeg, m.raDeg, m.decDeg);
  return {
    raDeg: topo.raDeg,
    decDeg: topo.decDeg,
    altGeometricDeg: geo,
    altDeg: apparentAltitudeDeg(geo),
    azDeg,
    illumPct: illuminationPct(elong, m.distanceKm, s.distanceAu * AU_KM),
    elongationDeg: elong,
    phaseDays: Math.abs(180 - norm360(m.lambdaDeg - s.lambdaDeg)) / SYNODIC_RATE_DEG_PER_DAY,
    distanceKm: m.distanceKm,
  };
}
