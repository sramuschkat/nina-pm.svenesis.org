/** AP-77: Kennzahlen je Nacht – Anteil guter Lights, Median von Bewölkung und SQM, Wettergerät im Dunkel-Fenster. */
import { IMAGE_QUALITY_DEFAULTS } from '@nina-pm/shared';
import { describe, expect, it } from 'vitest';
import { deviceMeasures, nightMeasures, type NightGradeRow } from '../src/sessions/night-measures';
import { refsByProject } from '../src/sessions/project-images';

const row = (night: string, metrics: Record<string, unknown>, rejected = false): NightGradeRow => ({
  night,
  rigId: 'rig',
  projectId: 'p',
  filter: 'Ha',
  rejected,
  metrics,
});

describe('nightMeasures', () => {
  it('gut = in Ordnung bzw. bestätigt; auffällig und verworfen zählen schlecht; ohne Messwerte zählt nicht', () => {
    // Bezug: 12 Lights mit HFR 1,5 und 1.000 Sternen.
    const basis = Array.from({ length: 12 }, () => ({
      projectId: 'p',
      filter: 'Ha',
      hfr: 1.5,
      stars: 1000,
      rejected: false,
    }));
    const refs = refsByProject(basis);
    const rows = [
      ...Array.from({ length: 6 }, () =>
        row('2026-10-08', { hfr: 1.5, stars: 1000, cloudCoverPct: 10, skyQualityMag: 21.2 }),
      ),
      row('2026-10-08', { hfr: 2.2, stars: 1000, cloudCoverPct: 30, skyQualityMag: 20.8 }), // HFR auffällig
      row('2026-10-08', { hfr: 2.2, stars: 1000, qualityKept: true }), // bestätigt → gut
      row('2026-10-08', { hfr: 1.5, stars: 1000 }, true), // verworfen
      row('2026-10-08', {}), // ohne Messwerte → zählt nicht
      row('2026-10-09', { hfr: 1.5, stars: 1000, guidingRmsArcsec: 2.4 }), // Guiding auffällig
    ];
    const m = nightMeasures(rows, refs, () => IMAGE_QUALITY_DEFAULTS);
    // 2026-10-08: 7 gut von 9 bewertet.
    expect(m.get('2026-10-08')).toEqual({ qualityPct: 77.8, cloudPct: 10, sqm: 21.2 });
    expect(m.get('2026-10-09')).toEqual({ qualityPct: 0, cloudPct: null, sqm: null });
  });
});

describe('deviceMeasures', () => {
  it('Mittel der Bewölkung und Median des SQM nur im Dunkel-Fenster; ohne Werte keine Nacht', () => {
    const at = (iso: string) => new Date(iso);
    const samples = [
      { atUtc: at('2026-10-09T23:55:00Z'), metrics: { cloudCoverPct: 100 } }, // vor dem Fenster
      { atUtc: at('2026-10-10T02:00:00Z'), metrics: { cloudCoverPct: 20, skyQualityMag: 21.0 } },
      { atUtc: at('2026-10-10T03:00:00Z'), metrics: { cloudCoverPct: 40, skyQualityMag: 21.4 } },
      { atUtc: at('2026-10-10T04:00:00Z'), metrics: { skyQualityMag: 21.2 } },
    ];
    const windows = new Map([
      [
        '2026-10-09',
        { fromMs: Date.parse('2026-10-10T01:00:00Z'), toMs: Date.parse('2026-10-10T10:00:00Z') },
      ],
      [
        '2026-10-08',
        { fromMs: Date.parse('2026-10-09T01:00:00Z'), toMs: Date.parse('2026-10-09T10:00:00Z') },
      ],
    ]);
    const d = deviceMeasures(samples, windows);
    expect(d.get('2026-10-09')).toEqual({ cloudPct: 30, sqm: 21.2 });
    expect(d.has('2026-10-08')).toBe(false);
  });
});
