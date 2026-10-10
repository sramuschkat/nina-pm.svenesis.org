/** Sessionqualität (AP-77, FA-AUS-25): Anteile, Gründe, Spannen, Summen und Stufen des Urteils. */
import { describe, expect, it } from 'vitest';
import {
  combineQualityCounts,
  qualityCounts,
  qualityStats,
  sessionGrade,
  shareLabelPct,
  type QualityLight,
} from '../src/session-quality';

const light = (o: Partial<QualityLight> = {}): QualityLight => ({
  grade: 'ok',
  flags: [],
  hfr: 1.5,
  stars: 400,
  rmsArcsec: 0.6,
  ...o,
});

describe('qualityCounts', () => {
  it('gut = in Ordnung bzw. behalten; ohne Messwert nicht im Anteil; Gründe je Kennzahl', () => {
    const c = qualityCounts([
      light(),
      light({ grade: 'kept' }),
      light({ grade: 'flagged', flags: [{ metric: 'stars' }] }),
      light({ grade: 'flagged', flags: [{ metric: 'hfr' }, { metric: 'stars' }] }),
      light({ grade: 'rejected' }),
      light({ grade: 'none' }),
    ]);
    expect(c).toEqual({
      good: 2,
      flagged: 2,
      rejected: 1,
      none: 1,
      sharePct: 40,
      reasons: { hfr: 1, stars: 2, rms: 0, cloud: 0 },
    });
  });

  it('ohne bewertete Lights kein Anteil', () => {
    expect(qualityCounts([light({ grade: 'none' })]).sharePct).toBeNull();
    expect(qualityCounts([]).sharePct).toBeNull();
  });

  it('Summe mehrerer Zählungen rechnet den Anteil neu', () => {
    const a = qualityCounts([light(), light(), light()]);
    const b = qualityCounts([light({ grade: 'flagged', flags: [{ metric: 'rms' }] })]);
    expect(combineQualityCounts([a, b])).toMatchObject({
      good: 3,
      flagged: 1,
      sharePct: 75,
      reasons: { rms: 1 },
    });
    expect(combineQualityCounts([]).sharePct).toBeNull();
  });
});

describe('qualityStats', () => {
  it('Median und Spanne ohne verworfene Lights', () => {
    const s = qualityStats([
      light({ hfr: 1.45, stars: 380, rmsArcsec: 0.5 }),
      light({ hfr: 1.58, stars: 420, rmsArcsec: 0.7 }),
      light({ hfr: 1.5, stars: null, rmsArcsec: null }),
      light({ grade: 'rejected', hfr: 3.2, stars: 50, rmsArcsec: 4 }),
    ]);
    expect(s.hfr).toEqual({ median: 1.5, min: 1.45, max: 1.58 });
    expect(s.stars).toEqual({ median: 400, min: 380, max: 420 });
    expect(s.rmsArcsec).toEqual({ median: 0.6, min: 0.5, max: 0.7 });
    expect(qualityStats([light({ hfr: null, stars: null, rmsArcsec: null })]).hfr).toBeNull();
  });
});

describe('sessionGrade', () => {
  it('Stufen an den Grenzen 95, 85, 70', () => {
    expect(sessionGrade(100)).toBe('very_good');
    expect(sessionGrade(95)).toBe('very_good');
    expect(sessionGrade(94.9)).toBe('good');
    expect(sessionGrade(85)).toBe('good');
    expect(sessionGrade(84.9)).toBe('fair');
    expect(sessionGrade(70)).toBe('fair');
    expect(sessionGrade(69.9)).toBe('poor');
    expect(sessionGrade(null)).toBeNull();
  });

  it('Anzeige rundet ab: 100 % nur, wenn alle gut sind', () => {
    expect(shareLabelPct(99.6)).toBe(99);
    expect(shareLabelPct(100)).toBe(100);
  });
});
