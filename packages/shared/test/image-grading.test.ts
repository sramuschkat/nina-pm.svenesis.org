/** AP-72b: Bildbewertung je Grenzwert und Kombination, Bezug, Zustand. */
import { describe, expect, it } from 'vitest';
import { gradeFlags, gradeRefs, IMAGE_QUALITY_DEFAULTS, imageGrade } from '../src';

const ref = { hfr: 2, stars: 600, n: 40 };
const ok = { hfr: 2.1, stars: 580, rmsArcsec: 0.6, cloudCoverPct: 0 };

describe('Bildbewertung', () => {
  it('Startwerte: HFR + 30 %, Sterne < 50 %, RMS > 1,5″, Wolken > 50 %', () => {
    const s = IMAGE_QUALITY_DEFAULTS;
    expect(gradeFlags(ok, ref, s)).toEqual([]);
    expect(gradeFlags({ ...ok, hfr: 2.61 }, ref, s)).toEqual([
      { metric: 'hfr', value: 2.61, limit: 2.6 },
    ]);
    expect(gradeFlags({ ...ok, hfr: 2.6 }, ref, s)).toEqual([]);
    expect(gradeFlags({ ...ok, stars: 299 }, ref, s)).toEqual([
      { metric: 'stars', value: 299, limit: 300 },
    ]);
    expect(gradeFlags({ ...ok, rmsArcsec: 1.6 }, ref, s)).toEqual([
      { metric: 'rms', value: 1.6, limit: 1.5 },
    ]);
    expect(gradeFlags({ ...ok, cloudCoverPct: 55 }, ref, s)).toEqual([
      { metric: 'cloud', value: 55, limit: 50 },
    ]);
    const all = gradeFlags({ hfr: 3, stars: 100, rmsArcsec: 2, cloudCoverPct: 80 }, ref, s);
    expect(all.map((f) => f.metric)).toEqual(['hfr', 'stars', 'rms', 'cloud']);
  });

  it('abgeschaltete Grenzwerte und zu wenig Bezug prüfen nichts; RMS und Wolken auch ohne Bezug', () => {
    const off = { ...IMAGE_QUALITY_DEFAULTS, hfrPct: null, rmsArcsec: null };
    expect(gradeFlags({ ...ok, hfr: 5, rmsArcsec: 5 }, ref, off)).toEqual([]);
    const few = { ...ref, n: 9 };
    expect(gradeFlags({ ...ok, hfr: 5, stars: 10 }, few, IMAGE_QUALITY_DEFAULTS)).toEqual([]);
    expect(gradeFlags({ ...ok, rmsArcsec: 2 }, null, IMAGE_QUALITY_DEFAULTS)).toHaveLength(1);
  });

  it('Zustand: verworfen vor behalten vor markiert vor ok; ohne Messwert none', () => {
    const flags = gradeFlags({ ...ok, hfr: 3 }, ref, IMAGE_QUALITY_DEFAULTS);
    expect(imageGrade(ok, flags, { rejected: true, kept: true })).toBe('rejected');
    expect(imageGrade(ok, flags, { rejected: false, kept: true })).toBe('kept');
    expect(imageGrade(ok, flags, { rejected: false, kept: false })).toBe('flagged');
    expect(imageGrade(ok, [], { rejected: false, kept: false })).toBe('ok');
    const none = { hfr: null, stars: null, rmsArcsec: null, cloudCoverPct: null };
    expect(imageGrade(none, [], { rejected: false, kept: false })).toBe('none');
  });

  it('Bezug je Filter ohne verworfene Lights', () => {
    const r = gradeRefs([
      { filter: 'R', hfr: 1.5, stars: 600, rejected: false },
      { filter: 'R', hfr: 1.7, stars: 640, rejected: false },
      { filter: 'R', hfr: 9, stars: 1, rejected: true },
      { filter: 'L', hfr: 1.4, stars: null, rejected: false },
    ]);
    expect(r.get('R')).toEqual({ hfr: 1.6, stars: 620, n: 2 });
    expect(r.get('L')).toEqual({ hfr: 1.4, stars: null, n: 1 });
  });
});
