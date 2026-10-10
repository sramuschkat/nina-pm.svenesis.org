/** Sessionqualität und Bedingungen im Nacht-Detail (AP-77, S-61): Zeilen, Grenzlinien, Quellen der Bedingungen. */
import { IMAGE_QUALITY_DEFAULTS, type GradeRef, type NightSessionCapture } from '@nina-pm/shared';
import { describe, expect, it } from 'vitest';
import { lineQualities, nightConditions, sessionQuality } from '../src/sessions/night-quality';

const P = '00000000-0000-4000-8000-000000000001';
const L = '00000000-0000-4000-8000-000000000002';
let n = 0;
const capture = (o: Partial<NightSessionCapture> = {}): NightSessionCapture => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  capturedAt: `2026-10-09T0${String(n % 9)}:00:00Z`,
  frameType: 'light',
  projectId: P,
  projectName: 'LDN1228',
  projectCreatedBy: null,
  exposureLineId: L,
  assignment: 'assigned',
  filterShortName: 'L',
  filterActual: null,
  exposureS: 120,
  gain: null,
  offset: null,
  binning: 1,
  result: 'saved',
  isBonus: false,
  temperatureDeviation: false,
  settingsDeviation: false,
  rejected: false,
  rejectReason: null,
  fileName: null,
  hfr: 1.5,
  stars: 400,
  quality: { rmsArcsec: 0.6, cloudCoverPct: 2, skyQualityMag: 21.3 },
  grade: 'ok',
  flags: [],
  ...o,
});

describe('lineQualities', () => {
  it('eine Zeile je Projekt und Zeile; Grenzen aus Bezug und Rig; Verlauf ohne verworfene', () => {
    const refs = new Map([
      [P, new Map<string, GradeRef>([['L', { hfr: 1.5, stars: 400, n: 40 }]])],
    ]);
    const lines = lineQualities(
      [
        capture({ capturedAt: '2026-10-09T03:00:00Z' }),
        capture({
          capturedAt: '2026-10-09T02:00:00Z',
          grade: 'flagged',
          flags: [{ metric: 'stars', value: 100, limit: 200 }],
        }),
        capture({ capturedAt: '2026-10-09T04:00:00Z', grade: 'rejected', rejected: true }),
        capture({ frameType: 'flat', grade: null }),
      ],
      refs,
      IMAGE_QUALITY_DEFAULTS,
    );
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line).toMatchObject({
      projectId: P,
      exposureLineId: L,
      filter: 'L',
      good: 1,
      flagged: 1,
      rejected: 1,
      hfrLimit: 1.95,
      rmsLimit: 1.5,
      reasons: { stars: 1 },
    });
    expect(line?.series.map((x) => [x.atUtc, x.flagged])).toEqual([
      ['2026-10-09T02:00:00Z', true],
      ['2026-10-09T03:00:00Z', false],
    ]);
    expect(sessionQuality(lines)).toMatchObject({ sharePct: 33.3, grade: 'poor' });
  });

  it('Bezug unter 10 Lights → keine HFR-Grenze', () => {
    const refs = new Map([[P, new Map<string, GradeRef>([['L', { hfr: 1.5, stars: 400, n: 9 }]])]]);
    expect(lineQualities([capture()], refs, IMAGE_QUALITY_DEFAULTS)[0]?.hfrLimit).toBeNull();
  });
});

describe('nightConditions', () => {
  it('Lights vor Wettergerät, Powerbox vor Wettergerät, Stundenwerte mit Spanne, Vorhersage als ein Wert', () => {
    const c = nightConditions({
      captures: [
        capture({ quality: { cloudCoverPct: 10 } }),
        capture({ quality: { cloudCoverPct: 30 } }),
      ],
      powerBox: [
        { metrics: { airC: 12, humidityPct: 40 } },
        { metrics: { airC: { min: 8, avg: 9, max: 10 }, humidityPct: 60 } },
      ],
      weather: [
        { metrics: { skyQualityMag: 21.5, windSpeedMs: 3, cloudCoverPct: 90, airC: 99 } },
        { metrics: { skyQualityMag: 21.7, windSpeedMs: 5 } },
      ],
      forecast: { seeingScore: 0.6, transparencyPct: null },
    });
    expect(c).toEqual([
      { metric: 'cloudPct', source: 'captures', median: 20, min: 10, max: 30 },
      { metric: 'sqm', source: 'telemetry', median: 21.6, min: 21.5, max: 21.7 },
      { metric: 'temperatureC', source: 'telemetry', median: 10.5, min: 8, max: 12 },
      { metric: 'humidityPct', source: 'telemetry', median: 50, min: 40, max: 60 },
      { metric: 'windMs', source: 'telemetry', median: 4, min: 3, max: 5 },
      { metric: 'seeingScore', source: 'forecast', median: 0.6, min: 0.6, max: 0.6 },
    ]);
  });
});
