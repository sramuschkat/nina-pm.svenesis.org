/**
 * AP-69 (S-65, FA-AUS-26): Hammer-Projektion der Ganzhimmelkarte – bekannte Punkte, Hin und zurück, Rand, Teilen an der
 * Naht und Flächen um den Pol.
 */
import { describe, expect, it } from 'vitest';
import { sky } from '../src';

const { hammerProject, hammerUnproject, splitPolygonAtSeam, splitPolylineAtSeam } = sky;
const S2 = Math.sqrt(2);

/** Fläche eines Rings (Schuhbandformel, Ebene). */
const area = (r: readonly { x: number; y: number }[]) =>
  Math.abs(
    r.reduce((s, p, i) => {
      const q = r[(i + 1) % r.length] as { x: number; y: number };
      return s + p.x * q.y - q.x * p.y;
    }, 0) / 2,
  );

describe('hammerProject', () => {
  it('bekannte Punkte: Mitte, Pole, Rand, RA wächst nach links', () => {
    expect(hammerProject(0, 0)).toEqual({ x: 0, y: 0 });
    const north = hammerProject(123, 90);
    expect(north.x).toBeCloseTo(0, 12);
    expect(north.y).toBeCloseTo(S2, 12);
    expect(hammerProject(0, -90, 50).y).toBeCloseTo(-S2, 12);
    // 90° östlich der Mitte: x = −2√2·sin 45° / √(1 + cos 45°)
    const east = hammerProject(90, 0);
    expect(east.x).toBeCloseTo(-(2 * S2 * Math.SQRT1_2) / Math.sqrt(1 + Math.SQRT1_2), 12);
    expect(east.y).toBeCloseTo(0, 12);
    expect(hammerProject(270, 0).x).toBeCloseTo(-east.x, 12);
    // Naht: 180° von der Mitte am linken Rand.
    expect(hammerProject(180, 0).x).toBeCloseTo(-2 * S2, 12);
    expect(hammerProject(12 * 15 + 30, 0, 30).x).toBeCloseTo(-2 * S2, 12);
  });

  it('flächentreu: gleich große Kugelkappen ergeben gleich große Flächen', () => {
    const cap = (ra: number, dec: number) => {
      const pts = Array.from({ length: 64 }, (_, k) => {
        const a = (k / 64) * 2 * Math.PI;
        const r = 2; // Grad
        return {
          raDeg: ra + (r * Math.cos(a)) / Math.cos((dec * Math.PI) / 180),
          decDeg: dec + r * Math.sin(a),
        };
      });
      return area(splitPolygonAtSeam(pts)[0] ?? []);
    };
    const a = cap(0, 0);
    expect(cap(100, 0) / a).toBeCloseTo(1, 2);
    expect(cap(40, 50) / a).toBeCloseTo(1, 1);
  });
});

describe('hammerUnproject', () => {
  it('hin und zurück über den ganzen Himmel, außerhalb der Ellipse null', () => {
    for (let ra = 0; ra < 360; ra += 17)
      for (let dec = -85; dec <= 85; dec += 11) {
        const p = hammerProject(ra, dec, 75);
        const back = hammerUnproject(p.x, p.y, 75);
        expect(back).not.toBeNull();
        expect(Math.abs((((back?.raDeg ?? 0) - ra + 540) % 360) - 180)).toBeLessThan(1e-9);
        expect(back?.decDeg).toBeCloseTo(dec, 9);
      }
    expect(hammerUnproject(2.9, 0)).toBeNull();
    expect(hammerUnproject(0, 1.5)).toBeNull();
    expect(hammerUnproject(2.1, 1)).toBeNull();
  });
});

describe('Naht und Pol', () => {
  it('Linie über die Naht endet am Rand und beginnt gegenüber', () => {
    const parts = splitPolylineAtSeam(
      [
        { raDeg: 175, decDeg: 10 },
        { raDeg: 185, decDeg: 20 },
      ],
      0,
    );
    expect(parts).toHaveLength(2);
    const end = parts[0]?.at(-1);
    const start = parts[1]?.[0];
    // Gleiche Deklination (15°) am linken bzw. rechten Rand.
    expect(end?.y).toBeCloseTo(start?.y ?? NaN, 12);
    expect(end?.x).toBeCloseTo(-(start?.x ?? NaN), 12);
    expect(hammerUnproject(end?.x ?? 0, end?.y ?? 0)?.decDeg).toBeCloseTo(15, 9);
    // Ohne Naht ein Stück.
    expect(
      splitPolylineAtSeam([
        { raDeg: 350, decDeg: 0 },
        { raDeg: 10, decDeg: 0 },
      ]),
    ).toHaveLength(1);
  });

  it('Bildfeld über der Naht: zwei Teile, zusammen so groß wie dasselbe Feld in der Mitte', () => {
    const box = (ra: number) => [
      { raDeg: ra - 2, decDeg: -2 },
      { raDeg: ra + 2, decDeg: -2 },
      { raDeg: ra + 2, decDeg: 2 },
      { raDeg: ra - 2, decDeg: 2 },
    ];
    const seam = splitPolygonAtSeam(box(180), 0);
    expect(seam).toHaveLength(2);
    const whole = splitPolygonAtSeam(box(179.9), 179.9);
    expect(whole).toHaveLength(1);
    const sum = seam.reduce((s, r) => s + area(r), 0);
    // Am Rand ist die Hammer-Projektion verzerrt, aber flächentreu.
    expect(sum / area(whole[0] ?? [])).toBeCloseTo(1, 2);
    for (const r of seam)
      for (const p of r) expect(Math.abs(p.x)).toBeLessThanOrEqual(2 * S2 + 1e-9);
  });

  it('Feld um den Nordpol schließt über den Pol und deckt die Polkappe', () => {
    const ring = Array.from({ length: 72 }, (_, k) => ({ raDeg: k * 5, decDeg: 88 }));
    const parts = splitPolygonAtSeam(ring, 0);
    expect(parts.length).toBeGreaterThanOrEqual(1);
    const ys = parts.flat().map((p) => p.y);
    expect(Math.max(...ys)).toBeCloseTo(S2, 9);
    // Südpol ebenso.
    const south = splitPolygonAtSeam(
      Array.from({ length: 72 }, (_, k) => ({ raDeg: k * 5, decDeg: -87 })),
      40,
    );
    expect(Math.min(...south.flat().map((p) => p.y))).toBeCloseTo(-S2, 9);
  });
});
