/** Berechnete Ausrüstungswerte und Filterrad-Heuristik (AP-09a; geometry.md §1, FA-RIG-14). */
import { describe, expect, it } from 'vitest';
import {
  cameraDerived,
  imageScale,
  normalizeFilterName,
  ProblemError,
  suggestNinaFilterName,
  telescopeDerived,
  validateFlip,
  validateSortChain,
} from '../src';

describe('Abbildungsmaßstab und Bildfeld (geometry.md §1)', () => {
  it('GT81 mit 0,8×-Reducer und IMX533 – gegen Handrechnung', () => {
    // effFocal = 478 · 0,8 = 382,4 mm
    // scale = 206,265 · 3,76 / 382,4 = 775,5564 / 382,4 = 2,028129… ″/px
    // FOV = 2,028129 · 3008 / 3600 = 1,694571…°, Diagonale · √2 = 2,396486…°
    const s = imageScale(
      { focalLengthMm: 478, reducerFactor: 0.8, pixelSizeUm: 3.76, widthPx: 3008, heightPx: 3008 },
      2,
    );
    expect(s).toEqual({
      effFocalMm: 382.4,
      scaleArcsecPx: 2.028,
      scaleBinnedArcsecPx: 4.056,
      fovWidthDeg: 1.6946,
      fovHeightDeg: 1.6946,
      fovDiagonalDeg: 2.3965,
    });
  });

  it('RASA 8 (400 mm, f/2) mit IMX571 (6248 × 4176, 3,76 µm)', () => {
    // 206,265 · 3,76 / 400 = 1,938891 ″/px; 1,938891 · 6248 / 3600 = 3,365053°; · 4176 / 3600 = 2,2491…°
    const s = imageScale({
      focalLengthMm: 400,
      reducerFactor: 1,
      pixelSizeUm: 3.76,
      widthPx: 6248,
      heightPx: 4176,
    });
    expect([s.scaleArcsecPx, s.fovWidthDeg, s.fovHeightDeg]).toEqual([1.939, 3.3651, 2.2491]);
  });

  it('Teleskop- und Kamerakennwerte (FA-TEL-03, FA-KAM-05/06)', () => {
    expect(telescopeDerived({ apertureMm: 81, focalLengthMm: 478, reducerFactor: 0.8 })).toEqual({
      effFocalMm: 382.4,
      fRatioNative: 5.9,
      fRatioEffective: 4.72,
      dawesArcsec: 1.43,
      rayleighArcsec: 1.7,
      airyDiskUm: 6.34, // 2,44 · 0,55 µm · 4,720988 = 6,3354
    });
    const c = cameraDerived({
      widthPx: 3008,
      heightPx: 3008,
      pixelSizeUm: 3.76,
      bitDepth: 14,
      fullWellE: 50000,
      readNoiseE: 1,
      supportedBinning: [2, 1],
    });
    expect(c).toMatchObject({
      sensorWidthMm: 11.31,
      sensorDiagonalMm: 15.99,
      megapixels: 9.05,
      dynamicRangeStops: 15.61,
      maxAdu: 16383,
    });
    expect(c.binned.map((b) => [b.binning, b.widthPx, b.pixelSizeUm])).toEqual([
      [1, 3008, 3.76],
      [2, 1504, 7.52],
    ]);
  });
});

describe('Vorschlagsheuristik Filterrad (FA-RIG-14, NT-E1)', () => {
  const cases: [short: string, nina: string[], expected: string | null][] = [
    ['Ha', ['L', 'Ha 3nm', 'OIII'], 'Ha 3nm'],
    ['Ha', ['HaOIII'], null],
    ['L', ['LPro'], null],
    ['R', ['Rc'], null],
    ['OIII', ['O III'], 'O III'],
    ['O III', ['OIII'], 'OIII'],
    ['SII', ['sii'], 'sii'],
    ['Ha', ['Ha-7nm'], 'Ha-7nm'],
    ['Ha', ['Ha_3', 'Ha 3nm'], 'Ha_3'],
    ['L', ['Lum'], null],
    ['HA', ['H'], null],
    ['', ['L'], null],
  ];
  it.each(cases)('%s in %j → %s', (short, nina, expected) => {
    expect(suggestNinaFilterName(short, nina)).toBe(expected);
  });

  it('exakte Übereinstimmung schlägt Präfix', () => {
    expect(suggestNinaFilterName('Ha', ['Ha 3nm', 'H a'])).toBe('H a');
  });

  it('normalisiert Kleinbuchstaben ohne Leer- und Sonderzeichen', () => {
    expect(normalizeFilterName(' O-III ')).toBe('oiii');
  });
});

describe('Sortierkette und Flip', () => {
  const code = (fn: () => void) => {
    try {
      fn();
      return null;
    } catch (error) {
      return (error as ProblemError).code;
    }
  };
  it('unbekannte oder doppelte Schlüssel → rig.sort_chain_invalid; leer ist erlaubt', () => {
    expect(code(() => validateSortChain([]))).toBeNull();
    expect(code(() => validateSortChain(['lowest_peak_altitude', 'constrained']))).toBeNull();
    expect(code(() => validateSortChain(['foo']))).toBe('rig.sort_chain_invalid');
    expect(code(() => validateSortChain(['constrained', 'constrained']))).toBe(
      'rig.sort_chain_invalid',
    );
  });
  it('maxAfter < after → rig.flip_settings_invalid; gleich ist erlaubt', () => {
    expect(
      code(() => validateFlip({ flipAfterMeridianMin: 5, flipMaxAfterMeridianMin: 5 })),
    ).toBeNull();
    expect(code(() => validateFlip({ flipAfterMeridianMin: 6, flipMaxAfterMeridianMin: 5 }))).toBe(
      'rig.flip_settings_invalid',
    );
  });
});
