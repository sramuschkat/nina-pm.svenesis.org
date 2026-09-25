/**
 * Vektoren und Drehmatrizen der Sternkarte (AP-21, TK 8.4): Richtungen als Einheitsvektoren im
 * äquatorialen J2000-Rahmen. Trigonometrie nur beim Umrechnen von und nach RA/Dec (rules/engine.md);
 * Projektion und Rahmenwechsel sind danach reine Skalarprodukte.
 */
import { asin, atan2, cos, sin } from '../math';
import { DEG, RAD, norm360 } from '../astro/angles';

export type Vec3 = readonly [number, number, number];
/** Zeilenweise 3×3-Matrix. */
export type Mat3 = readonly [Vec3, Vec3, Vec3];

export function radecToVec(raDeg: number, decDeg: number): Vec3 {
  const ra = raDeg * RAD;
  const dec = decDeg * RAD;
  const c = cos(dec);
  return [c * cos(ra), c * sin(ra), sin(dec)];
}

export function vecToRadec(v: Vec3): { raDeg: number; decDeg: number } {
  const n = norm(v);
  const z = Math.max(-1, Math.min(1, v[2] / n));
  return { raDeg: norm360(atan2(v[1], v[0]) * DEG), decDeg: asin(z) * DEG };
}

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const norm = (a: Vec3) => Math.sqrt(dot(a, a));

export function normalize(a: Vec3): Vec3 {
  const n = norm(a);
  return n === 0 ? [0, 0, 0] : [a[0] / n, a[1] / n, a[2] / n];
}

export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export const matVec = (m: Mat3, v: Vec3): Vec3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];

export function transpose(m: Mat3): Mat3 {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ];
}

export function matMul(a: Mat3, b: Mat3): Mat3 {
  const t = transpose(b);
  return [
    [dot(a[0], t[0]), dot(a[0], t[1]), dot(a[0], t[2])],
    [dot(a[1], t[0]), dot(a[1], t[1]), dot(a[1], t[2])],
    [dot(a[2], t[0]), dot(a[2], t[1]), dot(a[2], t[2])],
  ];
}

/** Winkelabstand zweier Einheitsvektoren (Grad), stabil über `atan2`. */
export function angleBetweenDeg(a: Vec3, b: Vec3): number {
  return atan2(norm(cross(a, b)), dot(a, b)) * DEG;
}
