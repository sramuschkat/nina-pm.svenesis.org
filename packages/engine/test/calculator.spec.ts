/**
 * Rechner S-23 (AP-61, calculator.md): Band je Filter, Himmelshintergrund, kürzeste Einzelbelichtung mit
 * Effizienztabelle, Sampling je Binning. Beispiel: 200-mm-Newton f/5 (1000 mm) mit IMX571 (3,76 µm, 1,5 e⁻),
 * Bortle 3 (21,4 mag/″²); Sollwerte von Hand nach der Formel in calculator.md §2.
 */
import { describe, expect, it } from 'vitest';
import {
  calculatorBand,
  ceilExposure,
  DEFAULT_SWAMP_FACTOR,
  sampling,
  samplingGrade,
  skyBackground,
  subExposure,
  SUB_TABLE_S,
  type SubExposureInput,
} from '../src';

const lum: SubExposureInput = {
  band: 'lum',
  bandwidthNm: null,
  transmissionPct: null,
  apertureMm: 200,
  obstructionPct: 0,
  focalLengthMm: 1000,
  pixelSizeUm: 3.76,
  qePct: 80,
  skyMagArcsec2V: 21.4,
  readNoiseE: 1.5,
  darkES: 0.002,
  saturationE: 50000,
  swampFactor: DEFAULT_SWAMP_FACTOR,
};

describe('Band je Filter', () => {
  it('photometrisches Band vor Typ vor Mittenwellenlänge', () => {
    const f = (photometricBand: string, filterType: string, c: number | null) =>
      calculatorBand({ photometricBand, filterType, centerWavelengthNm: c });
    expect(f('V', 'photometric', null)).toBe('V');
    expect(f('r', 'photometric', null)).toBe('Rc');
    expect(f('i', 'photometric', null)).toBe('Ic');
    expect(f('clear', 'other', null)).toBe('lum');
    expect(f('none', 'luminance', null)).toBe('lum');
    expect(f('none', 'light_pollution', 500)).toBe('lum');
    expect(f('none', 'narrowband', 656.3)).toBe('Rc');
    expect(f('none', 'narrowband', 500.7)).toBe('V');
    expect(f('none', 'broadband', 800)).toBe('Ic');
    expect(f('none', 'other', null)).toBe('V');
  });
});

describe('Himmelshintergrund und kürzeste Belichtung', () => {
  it('Luminanz bei Bortle 3: Maßstab, Himmel je Pixel, Mindestbelichtung', () => {
    const s = skyBackground(lum);
    expect(s.scaleArcsecPx).toBeCloseTo(0.77556, 4);
    expect(s.skyMagArcsec2).toBe(21.4);
    // 1000 · 3000 Å · 314,16 cm² · (0,7 · 0,9 · 0,8) · 10^(−0,4·21,4) · 0,7756²
    expect(s.skyES).toBeCloseTo(0.78692, 4);

    const r = subExposure(lum);
    expect(r.backgroundES).toBeCloseTo(0.78892, 4);
    expect(r.minSubRawS).toBeCloseTo(28.52, 2); // 10 · 1,5² / 0,789
    expect(r.minSubS).toBe(30);
    expect(r.targetBackgroundE).toBeCloseTo(22.5, 6);
    // 30 s steht schon in der Tabelle: keine Doppelzeile, aber markiert.
    expect(r.rows.map((x) => x.exposureS)).toEqual([...SUB_TABLE_S]);
    const row30 = r.rows[0];
    expect(row30?.recommended).toBe(true);
    expect(row30?.efficiencyPct).toBeCloseTo(91.32, 2);
    expect(row30?.noiseIncreasePct).toBeCloseTo(4.65, 2);
    expect(row30?.saturationPct).toBeCloseTo(0.0473, 4);
    expect(r.rows.filter((x) => x.recommended)).toHaveLength(1);
  });

  it('Schmalband Hα 7 nm: Band Rc, Himmel im Band heller um V−R, deutlich längere Mindestbelichtung', () => {
    const ha = { ...lum, band: 'Rc' as const, bandwidthNm: 7, transmissionPct: 95 };
    const r = subExposure(ha);
    expect(r.skyMagArcsec2).toBeCloseTo(20.5, 6);
    expect(r.skyES).toBeCloseTo(0.031169, 5);
    expect(r.minSubRawS).toBeCloseTo(678.3, 1);
    expect(r.minSubS).toBe(680);
    // Empfehlung eingereiht nach 600 s
    expect(r.rows.map((x) => x.exposureS)).toEqual([...SUB_TABLE_S, 680]);
    expect(r.rows.at(-1)?.recommended).toBe(true);
  });

  it('Faktor, Ausleserauschen, Himmel und Sättigung wirken in die richtige Richtung', () => {
    const base = subExposure(lum).minSubRawS;
    expect(subExposure({ ...lum, swampFactor: 3 }).minSubRawS).toBeCloseTo((base * 3) / 10, 6);
    expect(subExposure({ ...lum, readNoiseE: 3 }).minSubRawS).toBeCloseTo(base * 4, 6);
    expect(subExposure({ ...lum, skyMagArcsec2V: 18.4 }).minSubRawS).toBeLessThan(base / 10);
    expect(subExposure({ ...lum, obstructionPct: 30 }).minSubRawS).toBeGreaterThan(base);
    expect(subExposure({ ...lum, saturationE: null }).rows[0]?.saturationPct).toBeNull();
    // Effizienz steigt mit der Belichtung, der Rauschzuschlag fällt.
    const rows = subExposure(lum).rows;
    for (let k = 1; k < rows.length; k++) {
      expect(rows[k]?.efficiencyPct).toBeGreaterThan(rows[k - 1]?.efficiencyPct ?? 0);
      expect(rows[k]?.noiseIncreasePct).toBeLessThan(rows[k - 1]?.noiseIncreasePct ?? 0);
    }
  });

  it('Aufrunden 0,5 / 5 / 10 s', () => {
    expect(ceilExposure(0.1)).toBe(0.5);
    expect(ceilExposure(3.2)).toBe(3.5);
    expect(ceilExposure(10.1)).toBe(15);
    expect(ceilExposure(59)).toBe(60);
    expect(ceilExposure(61)).toBe(70);
    expect(ceilExposure(120)).toBe(120);
  });
});

describe('Sampling', () => {
  it('Einstufung an den Grenzen 1,5 und 3,5 px', () => {
    expect(samplingGrade(1.49)).toBe('under');
    expect(samplingGrade(1.5)).toBe('ok');
    expect(samplingGrade(3.5)).toBe('ok');
    expect(samplingGrade(3.51)).toBe('over');
  });

  it('Maßstab, FWHM in Pixeln und Bildfeld je Binning; Empfehlung', () => {
    const s = sampling({
      focalLengthMm: 1000,
      pixelSizeUm: 3.76,
      widthPx: 6248,
      heightPx: 4176,
      seeingArcsec: 2.5,
    });
    expect(s.rows.map((r) => r.binning)).toEqual([1, 2, 3, 4]);
    expect(s.rows[0]?.scaleArcsecPx).toBeCloseTo(0.77556, 4);
    expect(s.rows[0]?.fwhmPx).toBeCloseTo(3.2235, 3);
    expect(s.rows.map((r) => r.grade)).toEqual(['ok', 'ok', 'under', 'under']);
    expect(s.rows[0]?.fovWidthArcmin).toBeCloseTo(80.76, 2);
    expect(s.rows[0]?.fovHeightArcmin).toBeCloseTo(53.98, 2);
    // Bildfeld hängt nicht vom Binning ab.
    expect(s.rows[3]?.fovWidthArcmin).toBeCloseTo(80.76, 2);
    expect(s.recommendedBinning).toBe(1);
  });

  it('lange Brennweite (0,28″/px): Bin 1 und 2 überabgetastet, Empfehlung das erste passende Binning', () => {
    const s = sampling({
      focalLengthMm: 2800,
      pixelSizeUm: 3.76,
      widthPx: null,
      heightPx: null,
      seeingArcsec: 2.5,
    });
    // FWHM 9,0 / 4,5 / 3,0 / 2,3 px
    expect(s.rows.map((r) => r.grade)).toEqual(['over', 'over', 'ok', 'ok']);
    expect(s.recommendedBinning).toBe(3);
    expect(s.rows[0]?.fovWidthArcmin).toBeNull();
  });

  it('nichts passend: Binning mit FWHM am nächsten an 2,5 px', () => {
    const s = sampling({
      focalLengthMm: 200,
      pixelSizeUm: 3.76,
      widthPx: null,
      heightPx: null,
      seeingArcsec: 2.5,
    });
    expect(s.rows.every((r) => r.grade === 'under')).toBe(true);
    expect(s.recommendedBinning).toBe(1);
  });
});
