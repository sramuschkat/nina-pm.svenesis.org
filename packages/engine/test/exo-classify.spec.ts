/** Einordnung der Transitsuche (AP-42, FA-EXO-06…08): Größen- und Spektralklasse, Öffnung, Filter. */
import { describe, expect, it } from 'vitest';
import {
  apertureFit,
  estimatedApertureMm,
  mapBandToRig,
  recommendedBand,
  sizeClass,
  spectralClass,
  type RigFilter,
} from '../src';

describe('Größenklasse (FA-EXO-06)', () => {
  it.each([
    [1.0, 'terrestrial'],
    [1.25, 'super_earth'],
    [1.99, 'super_earth'],
    [2, 'sub_neptune'],
    [4, 'neptune'],
    [5.99, 'neptune'],
    [6, 'gas_giant'],
    [11.77, 'gas_giant'],
  ] as const)('%s R⊕ → %s', (r, c) => expect(sizeClass(r)).toBe(c));

  it('ohne Radius → null', () => {
    expect(sizeClass(null)).toBeNull();
    expect(sizeClass(0)).toBeNull();
  });
});

describe('Spektralklasse aus Teff', () => {
  it.each([
    [35000, 'O'],
    [10000, 'B'],
    [8000, 'A'],
    [6265, 'F'],
    [5246, 'G'],
    [5200, 'G'],
    [4500, 'K'],
    [3700, 'K'],
    [3200, 'M'],
  ] as const)('%s K → %s', (t, c) => expect(spectralClass(t)).toBe(c));
});

describe('Geschätzte Öffnung (FA-EXO-07 „est“)', () => {
  it('Untergrenze 127 mm wie ExoClock (HAT-P-17 b: 10,24 mag, 20,37 mmag, 4,04 h → ExoClock 5″)', () => {
    expect(estimatedApertureMm(10.24, 20.37, 4.04)).toBe(127);
  });

  // ExoClock-Planeten über der Untergrenze: Formel exakt, Abstand zum ExoClock-Wert wie gemessen.
  it.each([
    ['AU Mic b', 9.078, 3.32, 3.51, 279.4, 293.2],
    ['HATS-25 b', 13.07, 16.85, 3.22, 205.74, 188.7],
    ['K2-333 b', 11.766, 2.76, 4.95, 575.56, 599.8],
    ['WASP-165 b', 12.71, 6.78, 4.24, 322.83, 356.3],
  ])('%s', (_n, mag, depth, dur, exoclockMm, expected) => {
    const est = estimatedApertureMm(mag, depth, dur) ?? 0;
    expect(est).toBeCloseTo(expected, 0);
    expect(Math.abs(est / exoclockMm - 1)).toBeLessThan(0.25);
  });

  it('ohne Helligkeit oder Tiefe → null; ohne Dauer 2 h', () => {
    expect(estimatedApertureMm(null, 10, 2)).toBeNull();
    expect(estimatedApertureMm(11, null, 2)).toBeNull();
    expect(estimatedApertureMm(13, 5, null)).toBe(estimatedApertureMm(13, 5, 2));
  });

  it('Farbe gegen das Rig: erfüllt · ≥ 80 % · darunter', () => {
    expect(apertureFit(127, 130)).toBe('ok');
    expect(apertureFit(127, 127)).toBe('ok');
    expect(apertureFit(100, 81)).toBe('close');
    expect(apertureFit(127, 81)).toBe('insufficient');
  });
});

describe('Filterempfehlung und Abbildung auf das Rig (FA-EXO-08, NT-41)', () => {
  it('Rc Standard, Ic unter 4000 K, Luminanz über 13 mag', () => {
    expect(recommendedBand(5246, 10.2)).toBe('Rc');
    expect(recommendedBand(3900, 11)).toBe('Ic');
    expect(recommendedBand(3900, 13.5)).toBe('lum');
    expect(recommendedBand(null, null)).toBe('Rc');
  });

  const f = (
    id: string,
    shortName: string,
    photometricBand: string,
    filterType: string,
    centerWavelengthNm: number | null,
  ): RigFilter => ({ id, shortName, photometricBand, filterType, centerWavelengthNm });
  // Antlia-Satz aus S-10 (30.09.2026): Bänder `none`, Luminanz `lum`.
  const antlia = [
    f('b', 'BLUE', 'none', 'broadband', 470),
    f('g', 'GREEN', 'none', 'broadband', 530),
    f('r', 'RED', 'none', 'broadband', 655),
    f('l', 'LUMINOS', 'lum', 'luminance', 567.5),
    f('h', 'HA', 'none', 'narrowband', 656.3),
  ];

  it('Antlia-Satz: Rc/Ic → RED als Ersatzfilter, V → GREEN, lum → LUMINOS; Schmalband nie', () => {
    expect(mapBandToRig('Rc', antlia)).toEqual({
      filterId: 'r',
      shortName: 'RED',
      match: 'substitute',
    });
    expect(mapBandToRig('Ic', antlia)).toEqual({
      filterId: 'r',
      shortName: 'RED',
      match: 'substitute',
    });
    expect(mapBandToRig('V', antlia)).toEqual({
      filterId: 'g',
      shortName: 'GREEN',
      match: 'substitute',
    });
    // Empfohlen ist Luminanz selbst: gleiches Band, kein Ersatz.
    expect(mapBandToRig('lum', antlia)).toEqual({
      filterId: 'l',
      shortName: 'LUMINOS',
      match: 'same_band',
    });
  });

  it('gleiches Band geht vor; ohne Treffer Luminanz, sonst nicht festlegbar', () => {
    const phot = [...antlia, f('rc', 'Rc', 'Rc', 'photometric', 640)];
    expect(mapBandToRig('Rc', phot)).toEqual({
      filterId: 'rc',
      shortName: 'Rc',
      match: 'same_band',
    });
    expect(mapBandToRig('Rc', [antlia[4] as RigFilter, antlia[3] as RigFilter])).toEqual({
      filterId: 'l',
      shortName: 'LUMINOS',
      match: 'lum',
    });
    expect(mapBandToRig('Rc', [antlia[4] as RigFilter])).toBeNull();
  });
});
