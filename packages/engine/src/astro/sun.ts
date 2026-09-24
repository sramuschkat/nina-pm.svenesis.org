/**
 * Sonne nach Meeus Kap. 25 (Kurzreihe, 0,01° in der Länge; TK 8.4): scheinbare Länge mit Nutation
 * in Länge und Aberration (−0,00569°), Schiefe ε₀ (Meeus 22.2) + 0,00256°·cos Ω (Meeus 25.8).
 */
import { atan2D, asinD, cosD, norm360, sinD } from './angles';
import { meanObliquityDeg } from './nutation';
import { centuries } from './time';

export interface SunPlace {
  /** Scheinbare Rektaszension/Deklination zum Datum, Grad. */
  readonly raDeg: number;
  readonly decDeg: number;
  /** Scheinbare ekliptikale Länge, Grad. */
  readonly lambdaDeg: number;
  /** Abstand Erde–Sonne, AE. */
  readonly distanceAu: number;
}

export function sunApparent(jde: number): SunPlace {
  const t = centuries(jde);
  const t2 = t * t;
  const l0 = 280.46646 + 36000.76983 * t + 0.0003032 * t2;
  const m = 357.52911 + 35999.05029 * t - 0.0001537 * t2;
  const e = 0.016708634 - 0.000042037 * t - 0.0000001267 * t2;
  const c =
    (1.914602 - 0.004817 * t - 0.000014 * t2) * sinD(m) +
    (0.019993 - 0.000101 * t) * sinD(2 * m) +
    0.000289 * sinD(3 * m);
  const trueLong = l0 + c;
  const nu = m + c;
  const r = (1.000001018 * (1 - e * e)) / (1 + e * cosD(nu));
  const om = 125.04 - 1934.136 * t;
  const lambda = trueLong - 0.00569 - 0.00478 * sinD(om);
  const eps = meanObliquityDeg(jde) + 0.00256 * cosD(om);
  return {
    raDeg: norm360(atan2D(cosD(eps) * sinD(lambda), cosD(lambda))),
    decDeg: asinD(sinD(eps) * sinD(lambda)),
    lambdaDeg: norm360(lambda),
    distanceAu: r,
  };
}
