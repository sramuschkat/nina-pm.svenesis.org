/** specs/engine/moon.md §Eingaben (AP-08b): Refraktion, Beleuchtung, Phasenmaß, Mondhöhe/Abstand topozentrisch. */
import { describe, expect, it } from 'vitest';
import {
  apparentAltitudeDeg,
  bennettRefractionArcmin,
  illuminationPct,
  jdeFromUnix,
  moonApparent,
  moonAt,
  refractionArcmin,
  separationDeg,
} from '../src/index';

describe('Refraktion nach Saemundsson aus der geometrischen Höhe (moon.md, AST-1, WS-20)', () => {
  it('R(0°) = 28,98′, R(−1°) = 38,795′, darunter konstant', () => {
    expect(refractionArcmin(0)).toBeCloseTo(28.98, 2);
    expect(refractionArcmin(-1)).toBeCloseTo(38.795, 3);
    expect(refractionArcmin(-5)).toBe(refractionArcmin(-1));
    expect(refractionArcmin(-30)).toBe(refractionArcmin(-1));
  });

  it('konform: refract(−5°) = −4,3534° (Negativliste :110 schrieb 0 fest)', () => {
    expect(apparentAltitudeDeg(-5)).toBeCloseTo(-4.3534, 4);
  });

  it('Mond unten: geometrisch −0,574° ist scheinbar 0,000° (Versatz 0,259° gegen −0,833°)', () => {
    expect(apparentAltitudeDeg(-0.574)).toBeCloseTo(0, 3);
  });

  it('1′ bei 45° (Saemundsson); Bennett nur für Rückrechnungen: 34,5′ am scheinbaren Horizont', () => {
    expect((apparentAltitudeDeg(45) - 45) * 60).toBeCloseTo(1.0, 1);
    expect(bennettRefractionArcmin(0)).toBeCloseTo(34.5, 1);
  });

  it('stetig über −1°', () => {
    expect(
      Math.abs(apparentAltitudeDeg(-1.0000001) - apparentAltitudeDeg(-0.9999999)),
    ).toBeLessThan(1e-6);
  });
});

describe('Beleuchtung nach Meeus Kap. 48 mit atan2 (moon.md)', () => {
  it.each([
    [30, 6.7],
    [60, 25.1],
    [90, 50.1],
    [120, 75.1],
    [150, 93.3],
  ])('ψ = %d° → %d % (±0,2 %)', (psi, pct) => {
    expect(Math.abs(illuminationPct(psi, 384400, 1.496e8) - pct)).toBeLessThanOrEqual(0.2);
  });
});

describe('Mond am Standort', () => {
  it('Hannover 2026-11-27 18:45 UTC, NGC 281: geozentrisch 74,084°, topozentrisch 75,087° (moon.md)', () => {
    // Das Spec-Beispiel ist mit den J2000-Koordinaten von NGC 281 gerechnet (α 13,2458°, δ 56,6194°);
    // entscheidend ist der Unterschied topozentrisch − geozentrisch von 1,003°.
    const t = Date.parse('2026-11-27T18:45:00Z') / 1000;
    const site = { latDeg: 52.3705, lonDeg: 9.7332 };
    const topo = moonAt(t, site);
    const geo = moonApparent(jdeFromUnix(t));
    const sepTopo = separationDeg(topo.raDeg, topo.decDeg, 13.2458, 56.6194);
    const sepGeo = separationDeg(geo.raDeg, geo.decDeg, 13.2458, 56.6194);
    expect(sepTopo).toBeCloseTo(75.087, 2);
    expect(sepGeo).toBeCloseTo(74.084, 2);
    expect(sepTopo - sepGeo).toBeCloseTo(1.003, 2);
  });

  it('Phasenmaß d ≤ 180/12,1907 Tage, Beleuchtung 0…100 %', () => {
    const t = Date.parse('2026-09-26T16:49:00Z') / 1000; // Vollmond (USNO)
    const m = moonAt(t, { latDeg: 31.5471, lonDeg: -99.3823 });
    expect(m.phaseDays).toBeLessThan(0.05);
    expect(m.illumPct).toBeGreaterThan(99);
  });
});
