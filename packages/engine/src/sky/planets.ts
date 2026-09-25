/**
 * Planetenorte für die Sternkarte (AP-21, FA-FRM-08 „Mond/Sonne/Planeten“): Kepler-Elemente mit Raten je
 * Jahrhundert nach JPL „Approximate Positions of the Major Planets“ (Tabelle 1, gültig 1800–2050), Erde =
 * Erde-Mond-Schwerpunkt, ohne Lichtlaufzeit. Helligkeit nach Mallama & Hilton (2018). Portiert aus
 * `legacy/astro-tools-2026-09-21/js/astro-core.js` (heliocentric, planetCoords, planetMagnitude); dort gegen
 * JPL Horizons auf ≈ 0,05° geprüft (Test `sky.spec.ts`). Nur Anzeige – die Planung nutzt keine Planeten.
 */
import { acos, atan2, cos, exp, log10, sin } from '../math';
import { DEG, RAD, norm360 } from '../astro/angles';
import { nutation } from '../astro/nutation';
import { EQ_TO_ECLIPTIC } from './frames';
import { transpose, matVec, type Vec3 } from './vec';

export const PLANET_IDS = [
  'mercury',
  'venus',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
] as const;
export type PlanetId = (typeof PLANET_IDS)[number];

type Elements = readonly [readonly number[], readonly number[]];

const EARTH: Elements = [
  [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
  [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0],
];

const ELEMENTS: Readonly<Record<PlanetId, Elements>> = {
  mercury: [
    [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
    [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  ],
  venus: [
    [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
    [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
  ],
  mars: [
    [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  ],
  jupiter: [
    [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  ],
  saturn: [
    [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  ],
  uranus: [
    [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503],
    [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  ],
  neptune: [
    [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
    [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
  ],
};

/** Heliozentrische ekliptikale J2000-Koordinaten (AE) zu `t` Jahrhunderten seit J2000. */
function heliocentric(el: Elements, t: number): Vec3 {
  const v = el[0].map((x, k) => x + (el[1][k] ?? 0) * t);
  const [a = 0, e = 0, iDeg = 0, lDeg = 0, pDeg = 0, oDeg = 0] = v;
  const I = RAD * iDeg;
  const w = RAD * (pDeg - oDeg);
  const O = RAD * oDeg;
  const M = RAD * (((((lDeg - pDeg) % 360) + 540) % 360) - 180);
  let E = M + e * sin(M);
  for (let k = 0; k < 8; k += 1) E -= (E - e * sin(E) - M) / (1 - e * cos(E));
  const xp = a * (cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * sin(E);
  const cw = cos(w);
  const sw = sin(w);
  const cO = cos(O);
  const sO = sin(O);
  const cI = cos(I);
  const sI = sin(I);
  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    sw * sI * xp + cw * sI * yp,
  ];
}

export interface PlanetPlace {
  /** Geozentrisch, äquatorial J2000 (Einheitsvektor) – für die Karte im J2000-Rahmen. */
  readonly j2000: Vec3;
  /** Scheinbarer Ort zum Datum (Präzession in Länge und Nutation), Grad. */
  readonly raDeg: number;
  readonly decDeg: number;
  /** Abstand Erde (AE), Sonnenabstand (AE), Phasenwinkel (Grad). */
  readonly distAu: number;
  readonly sunDistAu: number;
  readonly phaseDeg: number;
  readonly mag: number;
}

const ECL_TO_EQ = transpose(EQ_TO_ECLIPTIC);

/** Ort und Helligkeit eines Planeten zu `jde` (TT). */
export function planetAt(id: PlanetId, jde: number): PlanetPlace {
  const t = (jde - 2451545) / 36525;
  const E = heliocentric(EARTH, t);
  const P = heliocentric(ELEMENTS[id], t);
  const x = P[0] - E[0];
  const y = P[1] - E[1];
  const z = P[2] - E[2];
  const dist = Math.sqrt(x * x + y * y + z * z);
  const r = Math.sqrt(P[0] * P[0] + P[1] * P[1] + P[2] * P[2]);
  const R = Math.sqrt(E[0] * E[0] + E[1] * E[1] + E[2] * E[2]);
  const j2000 = matVec(ECL_TO_EQ, [x / dist, y / dist, z / dist]);
  // Zum Datum: Präzession in Länge (1,396971°/Jh.) und Nutation (Meeus 22).
  const lam = atan2(y, x) + RAD * 1.396971 * t;
  const beta = atan2(z, Math.sqrt(x * x + y * y));
  const nu = nutation(jde);
  const l = lam + nu.dpsiDeg * RAD;
  const eps = nu.epsDeg * RAD;
  const ra = atan2(sin(l) * cos(eps) - (sin(beta) / cos(beta)) * sin(eps), cos(l));
  const dec = decOf(l, beta, eps);
  const phase =
    acos(Math.max(-1, Math.min(1, (r * r + dist * dist - R * R) / (2 * r * dist)))) * DEG;
  return {
    j2000,
    raDeg: norm360(ra * DEG),
    decDeg: dec * DEG,
    distAu: dist,
    sunDistAu: r,
    phaseDeg: phase,
    mag: magnitude(id, r, dist, phase, lam, beta, t),
  };
}

function decOf(l: number, beta: number, eps: number): number {
  const s = sin(beta) * cos(eps) + cos(beta) * sin(eps) * sin(l);
  return atan2(s, Math.sqrt(Math.max(0, 1 - s * s)));
}

function magnitude(
  id: PlanetId,
  r: number,
  dist: number,
  a: number,
  lam: number,
  beta: number,
  t: number,
): number {
  const k = 5 * log10(r * dist);
  switch (id) {
    case 'mercury':
      return (
        -0.613 +
        k +
        a *
          (6.328e-2 +
            a *
              (-1.6336e-3 + a * (3.3644e-5 + a * (-3.4265e-7 + a * (1.6893e-9 - a * 3.0334e-12)))))
      );
    case 'venus':
      return a < 163.7
        ? -4.384 + k + a * (-1.044e-3 + a * (3.687e-4 + a * (-2.814e-6 + a * 8.938e-9)))
        : 236.05828 + k + a * (-2.81914 + a * 8.39034e-3);
    case 'mars':
      return a <= 50
        ? -1.601 + k + a * (2.267e-2 - a * 1.302e-4)
        : -0.367 + k + a * (-2.573e-2 + a * 3.445e-4);
    case 'jupiter':
      return -9.395 + k + a * (-3.7e-4 + a * 6.16e-4);
    case 'uranus':
      return -7.11 + k + a * (6.587e-3 + a * 1.045e-4);
    case 'neptune':
      return -7.0 + k;
    case 'saturn': {
      // Die Ringe hellen Saturn auf, je stärker sie zur Erde geneigt sind (Ringneigung B).
      const ir = RAD * (28.075216 - 0.012998 * t);
      const or = RAD * (169.50847 + 1.394681 * t);
      const sB = Math.abs(sin(ir) * cos(beta) * sin(lam - or) - cos(ir) * sin(beta));
      return -8.914 + k - 1.825 * sB + 0.026 * a - 0.378 * sB * exp(-2.25 * a);
    }
  }
}
