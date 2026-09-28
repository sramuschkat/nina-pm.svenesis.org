/**
 * Mosaik-Panels (`specs/engine/geometry.md` §2): Panelzentren über die inverse Gnomonik (TAN), exakte
 * Feldrotation `γ` über Vektoren, NINA-Nummerierung (NT-32) und Normalisierung nach dem Runden (NT-31).
 * Panel-Masken (Höhe, Mondabstand, `tM`) rechnet die Planung produktiv mit diesen Koordinaten (A-19).
 */
import { asin, atan, atan2, cos, sin } from '../math';
import { DEG, RAD, norm360 } from '../astro/angles';
import { q } from '../round';

export interface MosaicInput {
  readonly raDeg: number;
  readonly decDeg: number;
  /** Positionswinkel `pa₀` (ohne Rotator: Kamerawinkel des Rigs, NT-30). */
  readonly paDeg: number;
  readonly cols: number;
  readonly rows: number;
  readonly overlapPct: number;
  readonly fovWidthDeg: number;
  readonly fovHeightDeg: number;
}

export interface MosaicPanel {
  /** NINA-Nummer ab 1, zeilenweise ab oben links (NT-32). */
  readonly n: number;
  /** Spalte (0 = West bei pa = 0) und Zeile (0 = Nord). */
  readonly i: number;
  readonly j: number;
  /** Standardkoordinaten nach Ost/Nord in Grad. */
  readonly xiDeg: number;
  readonly etaDeg: number;
  readonly raDeg: number;
  readonly decDeg: number;
  /** Feldrotation `γ` (Grad, + = nach Ost). */
  readonly gammaDeg: number;
  /** `paPanel = (pa₀ + γ) mod 360`. */
  readonly paDeg: number;
}

/** Rundung auf 1e-6° und Normalisierung auf [0, 360): erst runden, dann `≥ 360 → −360`, `−0 → 0`. */
export function normAngle(x: number): number {
  let v = q(x, 1e6) % 360;
  if (v < 0) v = q(v + 360, 1e6);
  if (v >= 360) v -= 360;
  return v === 0 ? 0 : v;
}

type Vec = readonly [number, number, number];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (a: Vec): Vec => {
  const l = Math.sqrt(dot(a, a));
  return [a[0] / l, a[1] / l, a[2] / l];
};
function frame(raDeg: number, decDeg: number): { p: Vec; e: Vec; n: Vec } {
  const a = raDeg * RAD;
  const d = decDeg * RAD;
  return {
    p: [cos(d) * cos(a), cos(d) * sin(a), sin(d)],
    e: [-sin(a), cos(a), 0],
    n: [-sin(d) * cos(a), -sin(d) * sin(a), cos(d)],
  };
}

/** Inverse Gnomonik: Standardkoordinaten (Grad, Tangentialebene) → α ∈ [0, 360), δ (Grad, ungerundet). */
export function offsetToSky(
  raDeg: number,
  decDeg: number,
  xiDeg: number,
  etaDeg: number,
): { raDeg: number; decDeg: number } {
  const xi = xiDeg * RAD;
  const eta = etaDeg * RAD;
  const d0 = decDeg * RAD;
  const rho = atan(Math.sqrt(xi * xi + eta * eta));
  const theta = atan2(xi, eta);
  const dec = asin(sin(d0) * cos(rho) + cos(d0) * sin(rho) * cos(theta));
  const dra = atan2(sin(rho) * sin(theta), cos(d0) * cos(rho) - sin(d0) * sin(rho) * cos(theta));
  return { raDeg: norm360(raDeg + dra * DEG), decDeg: dec * DEG };
}

/** Feldrotation `γ` am Panel (Grad, ungerundet), exakt über Vektoren (§2.2). */
export function fieldRotationDeg(
  raDeg: number,
  decDeg: number,
  xiDeg: number,
  etaDeg: number,
): number {
  const c = frame(raDeg, decDeg);
  const xi = xiDeg * RAD;
  const eta = etaDeg * RAD;
  const v = normalize([
    c.p[0] + xi * c.e[0] + eta * c.n[0],
    c.p[1] + xi * c.e[1] + eta * c.n[1],
    c.p[2] + xi * c.e[2] + eta * c.n[2],
  ]);
  const k = dot(c.n, v);
  const dHat = normalize([c.n[0] - k * v[0], c.n[1] - k * v[1], c.n[2] - k * v[2]]);
  const sky = offsetToSky(raDeg, decDeg, xiDeg, etaDeg);
  const at = frame(sky.raDeg, sky.decDeg);
  return atan2(dot(dHat, at.e), dot(dHat, at.n)) * DEG;
}

/** NINA-Nummer ↔ Rasterzelle (NT-32). */
export function panelNumber(i: number, j: number, cols: number): number {
  return j * cols + (cols - 1 - i) + 1;
}
export function panelCell(n: number, cols: number): { i: number; j: number } {
  return { i: cols - 1 - ((n - 1) % cols), j: Math.floor((n - 1) / cols) };
}

/** Panels eines Mosaiks nach NINA-Nummer (§2.1, §2.2). */
export function mosaicPanels(input: MosaicInput): MosaicPanel[] {
  const stepX = input.fovWidthDeg * (1 - input.overlapPct / 100);
  const stepY = input.fovHeightDeg * (1 - input.overlapPct / 100);
  const pa = input.paDeg * RAD;
  const panels: MosaicPanel[] = [];
  for (let n = 1; n <= input.cols * input.rows; n++) {
    const { i, j } = panelCell(n, input.cols);
    const x = (i - (input.cols - 1) / 2) * stepX;
    const y = ((input.rows - 1) / 2 - j) * stepY;
    const xiDeg = x * cos(pa) + y * sin(pa);
    const etaDeg = -x * sin(pa) + y * cos(pa);
    const sky = offsetToSky(input.raDeg, input.decDeg, xiDeg, etaDeg);
    const gamma = fieldRotationDeg(input.raDeg, input.decDeg, xiDeg, etaDeg);
    const g = q(gamma, 1e6);
    panels.push({
      n,
      i,
      j,
      xiDeg: q(xiDeg, 1e6),
      etaDeg: q(etaDeg, 1e6),
      raDeg: normAngle(sky.raDeg),
      decDeg: q(sky.decDeg, 1e6),
      gammaDeg: g === 0 ? 0 : g,
      paDeg: normAngle(input.paDeg + gamma),
    });
  }
  return panels;
}
