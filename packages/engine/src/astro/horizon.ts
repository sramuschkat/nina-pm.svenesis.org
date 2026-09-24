/**
 * Horizontkoordinaten, Refraktion und Topozentrik (moon.md §Eingaben, TK 8.4, Meeus Kap. 11, 13, 40).
 * Azimut von Nord über Ost. Standorthöhe bleibt bewusst unbenutzt (AST-N13).
 */
import { asinD, atan2D, cosD, norm360, sinD, tanD } from './angles';
import { nutation } from './nutation';
import { gmstDeg, jdeFromUnix, jdFromUnix } from './time';

export interface Site {
  /** Geografische Breite, Grad (±89,9°, AST-N18). */
  readonly latDeg: number;
  /** Geografische Länge, Grad, **Ost positiv**. */
  readonly lonDeg: number;
}

/** Scheinbare Sternzeit (GAST + Länge) in Grad; Sternzeit aus UT, Äquinoktialgleichung aus TT. */
export function localApparentSiderealDeg(unixSec: number, lonDeg: number): number {
  const nu = nutation(jdeFromUnix(unixSec));
  return norm360(gmstDeg(jdFromUnix(unixSec)) + nu.dpsiDeg * cosD(nu.epsDeg) + lonDeg);
}

/** Höhe und Azimut aus Stundenwinkel und Deklination (geometrisch). */
export function altAz(
  hourAngleDeg: number,
  decDeg: number,
  latDeg: number,
): { altDeg: number; azDeg: number } {
  const alt = asinD(sinD(latDeg) * sinD(decDeg) + cosD(latDeg) * cosD(decDeg) * cosD(hourAngleDeg));
  // Meeus 13.5: von Süd nach West; +180° → von Nord über Ost
  const az = atan2D(
    sinD(hourAngleDeg),
    cosD(hourAngleDeg) * sinD(latDeg) - tanD(decDeg) * cosD(latDeg),
  );
  return { altDeg: alt, azDeg: norm360(az + 180) };
}

/**
 * Refraktion nach **Saemundsson aus der geometrischen Höhe** (moon.md, AST-1), Bogenminuten:
 * R(h) = 1,02′ / tan(h + 10,3/(h + 5,11)); unterhalb −1° konstant R(−1°) = 38,795′ (WS-20).
 */
export function refractionArcmin(geometricAltDeg: number): number {
  const h = geometricAltDeg < -1 ? -1 : geometricAltDeg;
  return 1.02 / tanD(h + 10.3 / (h + 5.11));
}

/** Scheinbare Höhe aus geometrischer Höhe. */
export function apparentAltitudeDeg(geometricAltDeg: number): number {
  return geometricAltDeg + refractionArcmin(geometricAltDeg) / 60;
}

/**
 * Bennett (R = 1′/tan(h + 7,31/(h + 4,4)), Eingabe **scheinbar**) – nur zur Rückrechnung in
 * Referenztests, nie im Produktivpfad (moon.md).
 */
export function bennettRefractionArcmin(apparentAltDeg: number): number {
  return 1 / tanD(apparentAltDeg + 7.31 / (apparentAltDeg + 4.4));
}

const EARTH_RADIUS_KM = 6378.14;
const B_OVER_A = 0.99664719;

/**
 * Geozentrischer Ort (scheinbar zum Datum, Abstand in km) vom Standort gesehen: geozentrischer Vektor
 * minus Beobachtervektor (Meeus Kap. 11, 40). Der Beobachter dreht mit der scheinbaren Sternzeit.
 */
export function topocentric(
  raDeg: number,
  decDeg: number,
  distanceKm: number,
  unixSec: number,
  site: Site,
): { raDeg: number; decDeg: number; distanceKm: number } {
  const u = atan2D(B_OVER_A * sinD(site.latDeg), cosD(site.latDeg));
  const theta = localApparentSiderealDeg(unixSec, site.lonDeg);
  const rc = EARTH_RADIUS_KM * cosD(u);
  const rs = EARTH_RADIUS_KM * B_OVER_A * sinD(u);
  const x = distanceKm * cosD(decDeg) * cosD(raDeg) - rc * cosD(theta);
  const y = distanceKm * cosD(decDeg) * sinD(raDeg) - rc * sinD(theta);
  const z = distanceKm * sinD(decDeg) - rs;
  const dist = Math.sqrt(x * x + y * y + z * z);
  return { raDeg: norm360(atan2D(y, x)), decDeg: asinD(z / dist), distanceKm: dist };
}
