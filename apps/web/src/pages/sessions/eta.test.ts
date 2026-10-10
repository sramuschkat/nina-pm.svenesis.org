/** Voraussichtlich fertig (`etaOf`, AP-64): fertig, Nächte, Saisonwarnung, ohne Prognose. */
import { describe, expect, it } from 'vitest';
import type { ForecastView } from '../../api/client';
import { etaOf } from './eta';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const forecast = (over: Partial<ForecastView['projects'][number]> = {}): ForecastView => ({
  rigId: ID(1),
  rigName: 'Rig A',
  siteTimeZone: 'America/Chicago',
  computedAt: '2026-09-26T18:00:00Z',
  currentNight: '2026-09-26',
  nights: [],
  clearQuota: { rate: 0.5, source: 'default', recordedNights: 3 },
  projects: [
    {
      projectId: ID(10),
      name: 'NGC 7000',
      createdBy: ID(3),
      priority: 2,
      status: 'active',
      need: [{ filter: 'L', frames: 32, hours: 3 }],
      needFrames: 36,
      needHours: 3.3,
      optimistic: { nights: 2, completesNight: '2026-09-27', extrapolated: false },
      realistic: { nights: 4, completesNight: '2026-09-29', extrapolated: false },
      candidates: [],
      seasonWarning: null,
      suggestions: [],
      lines: [],
      ...over,
    },
  ],
  resume: [],
});

describe('etaOf', () => {
  it('etaOf: fertig, Nächte, Saison, ohne Prognose', () => {
    const f = forecast().projects[0] as ForecastView['projects'][number];
    expect(etaOf(undefined, null)).toEqual({ tone: 'none', kind: 'none' });
    expect(etaOf({ ...f, needFrames: 0 }, '2026-09-26').kind).toBe('done');
    expect(etaOf(f, '2026-09-26')).toMatchObject({ kind: 'nights', nights: 4, optimistic: 2 });
    expect(
      etaOf({ ...f, seasonWarning: { achievablePct: null, seasonEnd: null } }, '2026-09-26'),
    ).toMatchObject({ kind: 'season', seasonNights: null, tone: 'warn' });
    expect(
      etaOf(
        { ...f, realistic: { nights: null, completesNight: null, extrapolated: false } },
        '2026-09-26',
      ).kind,
    ).toBe('open');
  });
});
