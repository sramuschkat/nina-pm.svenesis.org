/** Winkelhilfen in Grad über die eigene Mathematik (rules/engine.md Nr. 2). */
import { asin, atan2, cos, sin, tan } from '../math';

export const RAD = Math.PI / 180;
export const DEG = 180 / Math.PI;

export const sinD = (x: number) => sin(x * RAD);
export const cosD = (x: number) => cos(x * RAD);
export const tanD = (x: number) => tan(x * RAD);
export const asinD = (x: number) => asin(x) * DEG;
export const atan2D = (y: number, x: number) => atan2(y, x) * DEG;

/** Auf [0, 360) normalisieren (rules/engine.md Nr. 9). Winzige negative Werte ergäben sonst 360 und −0 bliebe
 *  −0 (Astronomie-Prüfung 28.09.2026). */
export function norm360(x: number): number {
  const r = x % 360;
  const y = r < 0 ? r + 360 : r;
  return y >= 360 ? 0 : y + 0;
}

/** Auf (−180, 180] normalisieren. */
export function norm180(x: number): number {
  const r = norm360(x);
  return r > 180 ? r - 360 : r;
}

/** Winkelabstand zweier Punkte (RA/Dec in Grad) in der stabilen `atan2`-Form (moon.md, AST-M4). */
export function separationDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const x1 = cosD(dec1) * cosD(ra1);
  const y1 = cosD(dec1) * sinD(ra1);
  const z1 = sinD(dec1);
  const x2 = cosD(dec2) * cosD(ra2);
  const y2 = cosD(dec2) * sinD(ra2);
  const z2 = sinD(dec2);
  const cx = y1 * z2 - z1 * y2;
  const cy = z1 * x2 - x1 * z2;
  const cz = x1 * y2 - y1 * x2;
  return atan2D(Math.sqrt(cx * cx + cy * cy + cz * cz), x1 * x2 + y1 * y2 + z1 * z2);
}
