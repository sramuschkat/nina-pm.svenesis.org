/**
 * Stereografische Projektion der Sternkarte (AP-21, S-20): Blick aus der Himmelskugel auf `center`,
 * `upHint` bestimmt die Bildoberkante (Himmelsnordpol für „Norden oben“, Zenit für „Horizont“). Ost
 * liegt links wie am Himmel. Winkeltreu, Kreise bleiben Kreise – geeignet von 180° bis zu Bogenminuten.
 */
import { atan2, tan } from '../math';
import { DEG, RAD } from '../astro/angles';
import { cross, dot, normalize, type Vec3 } from './vec';

export interface SkyView {
  readonly center: Vec3;
  /** Einheitsvektoren der Bildachsen: `east` nach links, `up` nach oben. */
  readonly east: Vec3;
  readonly up: Vec3;
  /** Pixel je Einheit der stereografischen Ebene. */
  readonly k: number;
  readonly width: number;
  readonly height: number;
  /** Horizontale Bildbreite in Grad. */
  readonly fovDeg: number;
}

export function makeView(
  center: Vec3,
  upHint: Vec3,
  fovDeg: number,
  width: number,
  height: number,
): SkyView {
  const f = normalize(center);
  let u = normalize([
    upHint[0] - dot(upHint, f) * f[0],
    upHint[1] - dot(upHint, f) * f[1],
    upHint[2] - dot(upHint, f) * f[2],
  ]);
  // Blick genau auf den Pol: beliebige, aber feste Oberkante.
  if (u[0] === 0 && u[1] === 0 && u[2] === 0) u = normalize(cross(f, [0, 1, 0]));
  const e = normalize(cross(u, f));
  const k = width / 2 / (2 * tan((fovDeg * RAD) / 4));
  return { center: f, east: e, up: u, k, width, height, fovDeg };
}

/** Bildpunkt eines Einheitsvektors; `null` für Punkte nahe dem Gegenpunkt (nicht darstellbar). */
export function project(view: SkyView, v: Vec3): { x: number; y: number } | null {
  const z = dot(v, view.center);
  if (z < -0.9) return null;
  const s = (2 * view.k) / (1 + z);
  return {
    x: view.width / 2 - s * dot(v, view.east),
    y: view.height / 2 - s * dot(v, view.up),
  };
}

/** Einheitsvektor zu einem Bildpunkt (Umkehrung von `project`). */
export function unproject(view: SkyView, x: number, y: number): Vec3 {
  const X = (view.width / 2 - x) / view.k;
  const Y = (view.height / 2 - y) / view.k;
  const r2 = X * X + Y * Y;
  const d = 4 + r2;
  const f = view.center;
  const e = view.east;
  const u = view.up;
  return [
    ((4 - r2) * f[0] + 4 * X * e[0] + 4 * Y * u[0]) / d,
    ((4 - r2) * f[1] + 4 * X * e[1] + 4 * Y * u[1]) / d,
    ((4 - r2) * f[2] + 4 * X * e[2] + 4 * Y * u[2]) / d,
  ];
}

/** Grad je Bildpunkt in der Bildmitte. */
export const degPerPixel = (view: SkyView) => view.fovDeg / view.width;

/**
 * Positionswinkel der Bildoberkante gegen Himmelsnord am Punkt `v` (Grad, Nord über Ost) – damit
 * zeichnet die Karte das Bildfeld eines Rigs mit dem richtigen Winkel, auch in der Horizontansicht.
 */
export function screenNorthAngle(view: SkyView, v: Vec3): number {
  const p = project(view, v);
  const north: Vec3 = normalize([-v[2] * v[0], -v[2] * v[1], 1 - v[2] * v[2]]);
  const eps = 1e-4;
  const q = project(
    view,
    normalize([v[0] + eps * north[0], v[1] + eps * north[1], v[2] + eps * north[2]]),
  );
  if (!p || !q) return 0;
  // Bildschirmwinkel der Nordrichtung, gemessen von „oben“ gegen den Uhrzeigersinn (= nach Ost bei Ost links).
  return atan2(-(q.x - p.x), -(q.y - p.y)) * DEG;
}
