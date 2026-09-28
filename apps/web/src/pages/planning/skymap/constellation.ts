/**
 * Sternbild eines Orts (Infokarte der Sternkarte, 28.09.2026) nach der Vorlage
 * `legacy/astro-tools-2026-09-21/js/sky-map.js` (`boundsB1875`, `dropStrays`, `inRing`, `constellationAt`):
 * Die IAU hat die Grenzen entlang der Stundenkreise und Parallelen von B1875 gezogen; `sky.json` hält ihre
 * Ecken in J2000. Zurück nach B1875 präzediert sind die Kanten wieder gerade in RA und Dec, der
 * Punkt-im-Ring-Test ist dort exakt. Präzession aus der Engine.
 */
import { precessFromJ2000 } from '@nina-pm/engine';
import type { ConstellationBound } from './sky-data';

/** Besselsche Epoche 1875.0 als JDE. */
const B1875_JDE = 2405889.258550475;

const wrap180 = (d: number) => (((d % 360) + 540) % 360) - 180;

type Ring = readonly (readonly [number, number])[];

/**
 * Die Quelle unterteilt einige lange B1875-Parallelen mit Punkten, die in J2000 gesetzt sind und nach B1875
 * zurückgerechnet neben der Parallelen liegen (um den Pol in Cep und UMi bis 0,45°). Zwischen zwei Ecken
 * gleicher Dec fallen Punkte, die weniger als 1° daneben liegen und ihre RA mit keinem Nachbarn teilen.
 */
function dropStrays(ring: [number, number][]): [number, number][] {
  const n = ring.length;
  const drop = new Set<number>();
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 2; j <= i + 6 && j < i + n; j += 1) {
      const a = ring[i] as [number, number];
      const b = ring[j % n] as [number, number];
      let ok = Math.abs(a[1] - b[1]) <= 0.01;
      for (let k = i + 1; ok && k < j; k += 1) {
        const pt = ring[k % n] as [number, number];
        const pr = ring[(k - 1) % n] as [number, number];
        const nx = ring[(k + 1) % n] as [number, number];
        const off = Math.abs(pt[1] - a[1]);
        ok =
          off >= 0.01 &&
          off <= 1 &&
          Math.abs(wrap180(pt[0] - pr[0])) >= 0.01 &&
          Math.abs(wrap180(nx[0] - pt[0])) >= 0.01;
      }
      if (ok) {
        for (let k = i + 1; k < j; k += 1) drop.add(k % n);
        break;
      }
    }
  }
  return ring.filter((_, idx) => !drop.has(idx));
}

/** Gerader Test entlang des Stundenkreises nach Norden; ein Ring, der einmal um den Nordpol läuft, zählt umgekehrt. */
function inRing(ring: Ring, ra: number, dec: number): boolean {
  let cross = 0;
  let turn = 0;
  let sumDec = 0;
  const n = ring.length;
  for (let i = 0; i < n; i += 1) {
    const a = ring[i] as readonly [number, number];
    const b = ring[(i + 1) % n] as readonly [number, number];
    const dl = wrap180(b[0] - a[0]);
    const a1 = wrap180(a[0] - ra);
    const a2 = a1 + dl;
    turn += dl;
    sumDec += a[1];
    if ((a1 <= 0 && a2 > 0) || (a2 <= 0 && a1 > 0)) {
      if (a[1] + ((b[1] - a[1]) * (0 - a1)) / (a2 - a1) > dec) cross += 1;
    }
  }
  const inside = cross % 2 === 1;
  return Math.abs(turn) > 180 && sumDec > 0 ? !inside : inside;
}

const cache = new WeakMap<readonly ConstellationBound[], { abbr: string; ring: Ring }[]>();

function boundsB1875(bounds: readonly ConstellationBound[]) {
  let out = cache.get(bounds);
  if (out) return out;
  out = bounds.map((b) => {
    const ring: [number, number][] = b.corners.map(([ra, dec]) => {
      const q = precessFromJ2000(ra, dec, B1875_JDE);
      return [q.raDeg, q.decDeg];
    });
    const f = ring[0];
    const l = ring[ring.length - 1];
    if (
      f &&
      l &&
      ring.length > 1 &&
      Math.abs(wrap180(f[0] - l[0])) < 1e-6 &&
      Math.abs(f[1] - l[1]) < 1e-6
    )
      ring.pop();
    return { abbr: b.abbr, ring: dropStrays(ring) };
  });
  cache.set(bounds, out);
  return out;
}

/** IAU-Kürzel des Sternbilds, in dem ein J2000-Ort (Grad) liegt; `null`, wenn keiner der Ringe passt. */
export function constellationAt(
  bounds: readonly ConstellationBound[],
  raDeg: number,
  decDeg: number,
): string | null {
  const q = precessFromJ2000(raDeg, decDeg, B1875_JDE);
  for (const b of boundsB1875(bounds)) if (inRing(b.ring, q.raDeg, q.decDeg)) return b.abbr;
  return null;
}
