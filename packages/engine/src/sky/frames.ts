/**
 * Koordinatenrahmen der Sternkarte (AP-21, FA-FRM-08): galaktisch (Hipparcos-Matrix, ESA 1997 Bd. 1
 * §1.5.3), ekliptikal J2000 (mittlere Schiefe 23,4392911°), Präzession J2000 → Datum (IAU 1976, dieselbe
 * Drehung wie `precessFromJ2000`) und horizontal (Ost, Nord, Zenit) aus Sternzeit und Breite.
 */
import { asin, atan2, cos, sin } from '../math';
import { DEG, RAD, norm360 } from '../astro/angles';
import { precessFromJ2000 } from '../astro/precession';
import { matMul, matVec, radecToVec, type Mat3, type Vec3 } from './vec';

/** Äquatorial J2000 → galaktisch (l, b). */
export const EQ_TO_GALACTIC: Mat3 = [
  [-0.0548755604162154, -0.873437090234885, -0.483835015548713],
  [0.494109427875584, -0.444829629960011, 0.746982244497219],
  [-0.867666149019005, -0.198076373431202, 0.455983776175067],
];

const EPS_J2000 = 23.4392911 * RAD;
/** Äquatorial J2000 → ekliptikal J2000 (λ, β). */
export const EQ_TO_ECLIPTIC: Mat3 = [
  [1, 0, 0],
  [0, cos(EPS_J2000), sin(EPS_J2000)],
  [0, -sin(EPS_J2000), cos(EPS_J2000)],
];

/** Kugelkoordinaten (Länge, Breite) eines Vektors im jeweiligen Rahmen, Grad. */
export function lonLat(v: Vec3): { lonDeg: number; latDeg: number } {
  const n = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return {
    lonDeg: norm360(atan2(v[1], v[0]) * DEG),
    latDeg: asin(Math.max(-1, Math.min(1, v[2] / n))) * DEG,
  };
}

/** Vektor aus Länge/Breite im jeweiligen Rahmen (gleiche Formel wie `radecToVec`). */
export const lonLatToVec = radecToVec;

/** Präzessionsmatrix J2000 → mittleres Äquinoktium des Datums (Spalten = gedrehte Achsen). */
export function precessionMatrix(jde: number): Mat3 {
  const col = (ra: number, dec: number) => {
    const p = precessFromJ2000(ra, dec, jde);
    return radecToVec(p.raDeg, p.decDeg);
  };
  const x = col(0, 0);
  const y = col(90, 0);
  const z = col(0, 90);
  return [
    [x[0], y[0], z[0]],
    [x[1], y[1], z[1]],
    [x[2], y[2], z[2]],
  ];
}

/**
 * Äquatorial zum Datum → horizontal mit den Zeilen Ost, Nord, Zenit; `lstDeg` = Ortssternzeit.
 * Höhe = asin(z), Azimut = atan2(x, y) (Nord über Ost).
 */
export function horizonMatrix(lstDeg: number, latDeg: number): Mat3 {
  const sl = sin(lstDeg * RAD);
  const cl = cos(lstDeg * RAD);
  const sp = sin(latDeg * RAD);
  const cp = cos(latDeg * RAD);
  return [
    [-sl, cl, 0],
    [-sp * cl, -sp * sl, cp],
    [cp * cl, cp * sl, sp],
  ];
}

/** J2000 → horizontal (Ost, Nord, Zenit) für Sternzeit, Breite und Zeitpunkt (ohne Refraktion). */
export function j2000ToHorizonMatrix(jde: number, lstDeg: number, latDeg: number): Mat3 {
  return matMul(horizonMatrix(lstDeg, latDeg), precessionMatrix(jde));
}

/** Höhe und Azimut (Grad) eines horizontalen Vektors. */
export function altAzOf(h: Vec3): { altDeg: number; azDeg: number } {
  return {
    altDeg: asin(Math.max(-1, Math.min(1, h[2]))) * DEG,
    azDeg: norm360(atan2(h[0], h[1]) * DEG),
  };
}

/** Horizontaler Vektor aus Höhe und Azimut (Ost, Nord, Zenit). */
export function altAzToVec(altDeg: number, azDeg: number): Vec3 {
  const a = altDeg * RAD;
  const z = azDeg * RAD;
  return [cos(a) * sin(z), cos(a) * cos(z), sin(a)];
}

export { matVec };
