/**
 * Strenge Präzession J2000 ↔ Datum (Meeus 21.2–21.4, IAU 1976 ζ, z, θ). Der Pol bleibt endlich
 * (δ = 89,85° für den J2000-Pol im Jahr 2026). Die Mittelwert-Rektaszension mit J2000 statt Datum
 * kostet 70 s im Meridiandurchgang (WS-24) – deshalb immer präzedieren.
 */
import { asinD, atan2D, cosD, norm360, sinD } from './angles';
import { centuries } from './time';

interface Angles {
  zeta: number;
  z: number;
  theta: number;
}

function anglesFromJ2000(jde: number): Angles {
  const t = centuries(jde);
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    zeta: (2306.2181 * t + 0.30188 * t2 + 0.017998 * t3) / 3600,
    z: (2306.2181 * t + 1.09468 * t2 + 0.018203 * t3) / 3600,
    theta: (2004.3109 * t - 0.42665 * t2 - 0.041833 * t3) / 3600,
  };
}

/** Mittlerer Ort J2000 → mittlerer Ort zum Datum (Grad). */
export function precessFromJ2000(
  raDeg: number,
  decDeg: number,
  jde: number,
): { raDeg: number; decDeg: number } {
  const { zeta, z, theta } = anglesFromJ2000(jde);
  const a = cosD(decDeg) * sinD(raDeg + zeta);
  const b = cosD(theta) * cosD(decDeg) * cosD(raDeg + zeta) - sinD(theta) * sinD(decDeg);
  const c = sinD(theta) * cosD(decDeg) * cosD(raDeg + zeta) + cosD(theta) * sinD(decDeg);
  return { raDeg: norm360(atan2D(a, b) + z), decDeg: atan2D(c, Math.sqrt(a * a + b * b)) };
}

/** Mittlerer Ort zum Datum → J2000 (Umkehrung derselben Drehung). */
export function precessToJ2000(
  raDeg: number,
  decDeg: number,
  jde: number,
): { raDeg: number; decDeg: number } {
  const { zeta, z, theta } = anglesFromJ2000(jde);
  // Rückdrehung: R_z(ζ)·R_y(−θ)·R_z(z) invertiert
  const r = raDeg - z;
  const a = cosD(decDeg) * sinD(r);
  const b = cosD(theta) * cosD(decDeg) * cosD(r) + sinD(theta) * sinD(decDeg);
  const c = -sinD(theta) * cosD(decDeg) * cosD(r) + cosD(theta) * sinD(decDeg);
  return { raDeg: norm360(atan2D(a, b) - zeta), decDeg: asinD(Math.max(-1, Math.min(1, c))) };
}
