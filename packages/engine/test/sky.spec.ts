/**
 * Sternkarte (AP-21, TK 8.4, FA-FRM-03/08): Rahmen (galaktisch, ekliptikal, Präzession, horizontal),
 * stereografische Projektion (Ost links, Norden bzw. Zenit oben, Umkehrbarkeit), HEALPix NESTED
 * (Prüfungen aus `verify-planner.js:66–80`: Pixelmitte und Unterpixel) und Planeten gegen JPL Horizons
 * (`verify-planner.js:229–243`, Toleranz 0,05° und 0,15 mag).
 */
import { describe, expect, it } from 'vitest';
import { jdeFromUnix, precessFromJ2000, separationDeg, sky } from '../src';

const near = (a: number, b: number, tol: number) =>
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

/** Deterministische Zufallszahlen (LCG) für die Stichproben. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('Rahmen', () => {
  it('galaktisch: Zentrum und Nordpol', () => {
    const gc = sky.lonLat(sky.matVec(sky.EQ_TO_GALACTIC, sky.radecToVec(266.40499, -28.93617)));
    near(Math.min(gc.lonDeg, 360 - gc.lonDeg), 0, 1e-3);
    near(gc.latDeg, 0, 1e-3);
    const ngp = sky.lonLat(sky.matVec(sky.EQ_TO_GALACTIC, sky.radecToVec(192.85948, 27.12825)));
    near(ngp.latDeg, 90, 1e-3);
  });

  it('ekliptikal: Frühlingspunkt und Sommersonnenwende', () => {
    const v = sky.lonLat(sky.matVec(sky.EQ_TO_ECLIPTIC, sky.radecToVec(90, 23.4392911)));
    near(v.lonDeg, 90, 1e-9);
    near(v.latDeg, 0, 1e-9);
  });

  it('Präzessionsmatrix entspricht precessFromJ2000', () => {
    const jde = jdeFromUnix(Date.UTC(2026, 8, 18) / 1000);
    const m = sky.precessionMatrix(jde);
    for (const [ra, dec] of [
      [10.68, 41.27],
      [279.23, 38.78],
      [83.82, -5.39],
    ] as const) {
      const p = precessFromJ2000(ra, dec, jde);
      const q = sky.vecToRadec(sky.matVec(m, sky.radecToVec(ra, dec)));
      near(separationDeg(p.raDeg, p.decDeg, q.raDeg, q.decDeg), 0, 1e-9);
    }
  });

  it('horizontal: Himmelspol in Polhöhe, Zenit = Ortssternzeit/Breite', () => {
    const m = sky.horizonMatrix(123, 48);
    const pole = sky.altAzOf(sky.matVec(m, [0, 0, 1]));
    near(pole.altDeg, 48, 1e-9);
    near(pole.azDeg, 0, 1e-9);
    const zenith = sky.altAzOf(sky.matVec(m, sky.radecToVec(123, 48)));
    near(zenith.altDeg, 90, 1e-9);
    // Ein Stern im Osten (Stundenwinkel −90°, δ = 0) steht bei Azimut 90°.
    const east = sky.altAzOf(sky.matVec(m, sky.radecToVec(123 + 90, 0)));
    near(east.azDeg, 90, 1e-9);
    near(east.altDeg, 0, 1e-9);
    const v = sky.altAzToVec(30, 200);
    const back = sky.altAzOf(v);
    near(back.altDeg, 30, 1e-9);
    near(back.azDeg, 200, 1e-9);
  });
});

describe('Stereografische Projektion', () => {
  const north = sky.radecToVec(0, 90);

  it('Mitte in der Bildmitte, Norden oben, Osten links', () => {
    const view = sky.makeView(sky.radecToVec(83.82, -5.39), north, 10, 1000, 800);
    const c = sky.project(view, sky.radecToVec(83.82, -5.39));
    near(c?.x ?? NaN, 500, 1e-9);
    near(c?.y ?? NaN, 400, 1e-9);
    const n = sky.project(view, sky.radecToVec(83.82, -4.39));
    expect(n && n.y < 400).toBe(true);
    const e = sky.project(view, sky.radecToVec(84.82, -5.39));
    expect(e && e.x < 500).toBe(true);
  });

  it('Bildbreite entspricht dem Sichtfeld', () => {
    const view = sky.makeView(sky.radecToVec(0, 0), north, 20, 1000, 600);
    const left = sky.project(view, sky.radecToVec(10, 0));
    near(left?.x ?? NaN, 0, 1e-6);
  });

  it('project ∘ unproject = Identität', () => {
    const r = rng(7);
    for (let i = 0; i < 200; i += 1) {
      const view = sky.makeView(
        sky.radecToVec(r() * 360, r() * 170 - 85),
        north,
        0.5 + r() * 120,
        900,
        700,
      );
      const x = r() * 900;
      const y = r() * 700;
      const p = sky.project(view, sky.unproject(view, x, y));
      near(p?.x ?? NaN, x, 1e-6);
      near(p?.y ?? NaN, y, 1e-6);
    }
  });

  it('Horizontansicht: Zenit oben', () => {
    // Blick nach Süden bei 30° Höhe; Zenit oben, Osten links.
    const m = sky.horizonMatrix(0, 50);
    const toEq = (h: sky.Vec3) => sky.matVec(sky.transpose(m), h);
    const view = sky.makeView(toEq(sky.altAzToVec(30, 180)), toEq([0, 0, 1]), 60, 1000, 800);
    const up = sky.project(view, toEq(sky.altAzToVec(40, 180)));
    expect(up && up.y < 400).toBe(true);
    const east = sky.project(view, toEq(sky.altAzToVec(30, 170)));
    expect(east && east.x < 500).toBe(true);
  });

  it('Winkel der Bildoberkante gegen Himmelsnord: 0 bei „Norden oben“', () => {
    const v = sky.radecToVec(150, 20);
    near(sky.screenNorthAngle(sky.makeView(v, north, 5, 800, 600), v), 0, 1e-3);
  });
});

describe('HEALPix NESTED', () => {
  it('Basisflächen der Ordnung 0', () => {
    expect(sky.hpxPix(0, 45, 60)).toBe(0);
    expect(sky.hpxPix(0, 135, 60)).toBe(1);
    expect(sky.hpxPix(0, 0.5, 0)).toBe(4);
    expect(sky.hpxPix(0, 90.5, 0)).toBe(5);
    expect(sky.hpxPix(0, 45, -60)).toBe(8);
  });

  it('Pixelmitte fällt ins eigene Pixel, Unterpixel ins richtige Kind (Ordnungen 3–9)', () => {
    const r = rng(42);
    let centre = 0;
    let sub = 0;
    for (let order = 3; order <= 9; order += 1) {
      const nside = 1 << order;
      for (let i = 0; i < 500; i += 1) {
        const ra = r() * 360;
        const dec = (Math.asin(2 * r() - 1) * 180) / Math.PI;
        const p = sky.hpxPix(order, ra, dec);
        const f = sky.hpxXyf(order, p);
        const c = sky.hpxLoc(f.face, (f.ix + 0.5) / nside, (f.iy + 0.5) / nside);
        if (sky.hpxPix(order, c.raDeg, c.decDeg) !== p) centre += 1;
        const x = r();
        const y = r();
        const q = sky.hpxLoc(f.face, (f.ix + x) / nside, (f.iy + y) / nside);
        const expected =
          f.face * 64 * nside * nside +
          sky.hpxInterleave(f.ix * 8 + Math.floor(x * 8), f.iy * 8 + Math.floor(y * 8));
        if (sky.hpxPix(order + 3, q.raDeg, q.decDeg) !== expected) sub += 1;
      }
    }
    expect({ centre, sub }).toEqual({ centre: 0, sub: 0 });
  });

  it('Kachelpfad und Ordnung nach Bildschirmauflösung', () => {
    expect(sky.hipsTilePath(9, 123456)).toBe('Norder9/Dir120000/Npix123456');
    expect(sky.hipsOrderFor(1, 9)).toBe(3);
    // 1″ je Bildschirmpixel → gedeckelt auf die höchste Ordnung der Durchmusterung.
    expect(sky.hipsOrderFor(1 / 3600, 9)).toBe(9);
    expect(sky.hipsOrderFor(1 / 3600, 11)).toBe(9);
    expect(sky.hipsOrderFor(0.3 / 3600, 11)).toBe(11);
  });
});

describe('Planeten gegen JPL Horizons', () => {
  const HORIZONS: Record<'uranus' | 'neptune', [string, number, number, number][]> = {
    uranus: [
      ['2026-01-01T00:00:00Z', 55.7371, 19.50965, 5.646],
      ['2030-01-17T00:00:00Z', 73.7444, 22.63384, 5.572],
      ['2034-02-02T00:00:00Z', 92.82341, 23.68675, 5.515],
      ['2038-02-18T00:00:00Z', 112.47311, 22.33423, 5.467],
      ['2042-03-06T00:00:00Z', 131.94821, 18.57278, 5.427],
    ],
    neptune: [
      ['2026-01-01T00:00:00Z', 0.07761, -1.41861, 7.767],
      ['2030-01-17T00:00:00Z', 8.45737, 2.02873, 7.772],
      ['2034-02-02T00:00:00Z', 16.91549, 5.44932, 7.778],
      ['2038-02-18T00:00:00Z', 25.50989, 8.76676, 7.783],
      ['2042-03-06T00:00:00Z', 34.26185, 11.88881, 7.788],
    ],
  };
  for (const [id, rows] of Object.entries(HORIZONS) as [
    'uranus' | 'neptune',
    typeof HORIZONS.uranus,
  ][]) {
    it(`${id}: Ort < 0,05°, Helligkeit < 0,15 mag`, () => {
      for (const [t, ra, dec, mag] of rows) {
        const p = sky.planetAt(id, jdeFromUnix(Date.parse(t) / 1000));
        near(separationDeg(p.raDeg, p.decDeg, ra, dec), 0, 0.05);
        near(p.mag, mag, 0.15);
      }
    });
  }

  it('J2000-Vektor und scheinbarer Ort liegen nahe beieinander (Präzession 2026 ≈ 0,36°)', () => {
    const p = sky.planetAt('jupiter', jdeFromUnix(Date.UTC(2026, 8, 25) / 1000));
    const j = sky.vecToRadec(p.j2000);
    const d = separationDeg(p.raDeg, p.decDeg, j.raDeg, j.decDeg);
    expect(d).toBeGreaterThan(0.2);
    expect(d).toBeLessThan(0.5);
    expect(p.mag).toBeLessThan(-1.5);
  });
});
