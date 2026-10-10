/**
 * Ganzhimmelkarte der Auswertung (AP-69, S-65, FA-AUS-26): flächentreue **Hammer-Projektion**, äquatorial, Nord oben,
 * Rektaszension wächst nach **links** (Blick an den Himmel). Ebene: x ∈ [−2√2, 2√2], y ∈ [−√2, √2]; `centerRaDeg` liegt
 * in der Mitte, die Naht bei `centerRaDeg + 180°` am linken und rechten Rand. Linien und Flächen, die die Naht kreuzen,
 * werden geteilt; Flächen um einen Pol schließen über den Pol. Rein und deterministisch, Trigonometrie aus `src/math`.
 */
import { asin, atan2, cos, sin } from '../math';
import { DEG, norm180, norm360, RAD } from '../astro/angles';

const SQRT2 = Math.sqrt(2);
/** Halbachsen der Hammer-Ellipse. */
export const HAMMER_HALF_WIDTH = 2 * SQRT2;
export const HAMMER_HALF_HEIGHT = SQRT2;

export interface AllSkyPoint {
  readonly x: number;
  readonly y: number;
}

export interface SkyPos {
  readonly raDeg: number;
  readonly decDeg: number;
}

/** Länge relativ zur Kartenmitte in (−180°, 180°]; positiv = östlich = links. */
const lonOf = (raDeg: number, centerRaDeg: number) => norm180(raDeg - centerRaDeg);

/** Hammer-Projektion aus Länge relativ zur Mitte (Grad, positiv links) und Deklination. */
function hammer(lonDeg: number, decDeg: number): AllSkyPoint {
  const lambda = -lonDeg * RAD;
  const phi = decDeg * RAD;
  const cp = cos(phi);
  const d = Math.sqrt(1 + cp * cos(lambda / 2));
  // `+ 0`: −0 in der Mitte vermeiden.
  return { x: (2 * SQRT2 * cp * sin(lambda / 2)) / d + 0, y: (SQRT2 * sin(phi)) / d + 0 };
}

export function hammerProject(raDeg: number, decDeg: number, centerRaDeg = 0): AllSkyPoint {
  return hammer(lonOf(raDeg, centerRaDeg), decDeg);
}

/** Umkehrung; `null` außerhalb der Ellipse. */
export function hammerUnproject(x: number, y: number, centerRaDeg = 0): SkyPos | null {
  const qx = x / HAMMER_HALF_WIDTH;
  const qy = y / HAMMER_HALF_HEIGHT;
  if (qx * qx + qy * qy > 1 + 1e-12) return null;
  const z = Math.sqrt(Math.max(0, 1 - (x / 4) * (x / 4) - (y / 2) * (y / 2)));
  const lambda = 2 * atan2(z * x, 2 * (2 * z * z - 1));
  const phi = asin(Math.max(-1, Math.min(1, z * y)));
  return { raDeg: norm360(centerRaDeg - lambda * DEG), decDeg: phi * DEG };
}

type LonLat = readonly [number, number];

/** Längen stetig fortsetzen (Sprünge über ±180° auflösen). */
function unwrap(points: readonly SkyPos[], centerRaDeg: number): [number, number][] {
  const out: [number, number][] = [];
  for (const p of points) {
    let lon = lonOf(p.raDeg, centerRaDeg);
    const prev = out[out.length - 1];
    if (prev) {
      while (lon - prev[0] > 180) lon -= 360;
      while (lon - prev[0] < -180) lon += 360;
    }
    out.push([lon, p.decDeg]);
  }
  return out;
}

/**
 * Linie (z. B. Gradnetz, Sternbildlinie) in Teilstücke innerhalb der Karte: an der Naht endet ein Stück am Rand und das
 * nächste beginnt am gegenüberliegenden Rand (Deklination linear interpoliert).
 */
export function splitPolylineAtSeam(points: readonly SkyPos[], centerRaDeg = 0): AllSkyPoint[][] {
  const parts: AllSkyPoint[][] = [];
  let part: AllSkyPoint[] = [];
  let prev: LonLat | null = null;
  for (const p of points) {
    const cur: LonLat = [lonOf(p.raDeg, centerRaDeg), p.decDeg];
    if (prev && Math.abs(cur[0] - prev[0]) > 180) {
      const edge = prev[0] > 0 ? 180 : -180;
      const target = cur[0] + (edge > 0 ? 360 : -360);
      const t = (edge - prev[0]) / (target - prev[0]);
      const dec = prev[1] + t * (cur[1] - prev[1]);
      part.push(hammer(edge, dec));
      if (part.length > 1) parts.push(part);
      part = [hammer(-edge, dec)];
    }
    part.push(hammer(cur[0], cur[1]));
    prev = cur;
  }
  if (part.length > 1) parts.push(part);
  return parts;
}

/** Sutherland–Hodgman an einer senkrechten Geraden `lon = edge` (behält `keep(lon)`). */
function clip(
  ring: readonly LonLat[],
  edge: number,
  keep: (lon: number) => boolean,
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i] as LonLat;
    const b = ring[(i + 1) % ring.length] as LonLat;
    const ina = keep(a[0]);
    const inb = keep(b[0]);
    if (ina) out.push([a[0], a[1]]);
    if (ina !== inb) {
      const t = (edge - a[0]) / (b[0] - a[0]);
      out.push([edge, a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

/**
 * Fläche (Bildfeld, Panel) als ein oder mehrere Ringe in der Karte: Teile jenseits der Naht erscheinen am
 * gegenüberliegenden Rand; umschließt der Ring einen Pol (Längen laufen einmal herum), schließt er über den Pol.
 */
export function splitPolygonAtSeam(points: readonly SkyPos[], centerRaDeg = 0): AllSkyPoint[][] {
  if (points.length < 3) return [];
  const ring = unwrap(points, centerRaDeg);
  const first = ring[0] as [number, number];
  const last = ring[ring.length - 1] as [number, number];
  // Ring geschlossen übergeben (letzter = erster Punkt)? Dann ist die Umlaufzahl der Längensprung zwischen beiden.
  const closing = (() => {
    let lon = first[0];
    while (lon - last[0] > 180) lon -= 360;
    while (lon - last[0] < -180) lon += 360;
    return lon;
  })();
  const turn = closing - first[0];
  if (Math.abs(turn) > 180) {
    // Pol im Ring: über den Pol der mittleren Deklination schließen.
    const mean = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const pole = mean >= 0 ? 90 : -90;
    ring.push([closing, first[1]], [closing, pole], [first[0], pole]);
  }
  const out: AllSkyPoint[][] = [];
  for (const k of [-360, 0, 360]) {
    let r: [number, number][] = ring.map((p) => [p[0] + k, p[1]]);
    r = clip(r, 180, (lon) => lon <= 180);
    if (r.length < 3) continue;
    r = clip(r, -180, (lon) => lon >= -180);
    if (r.length < 3) continue;
    out.push(r.map(([lon, dec]) => hammer(lon, dec)));
  }
  return out;
}
