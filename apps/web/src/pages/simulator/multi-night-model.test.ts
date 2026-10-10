/** Ansicht der Mehrnacht-Simulation (Neugestaltung 10.10.2026): Summen, möglich bei klarer Nacht, Anteile je Projekt. */
import { describe, expect, it } from 'vitest';
import type { MultiSimResult } from '../../api/client';
import { multiSimView, weightKind } from './multi-night-model';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const project = (o: Partial<MultiSimResult['projects'][number]>) => ({
  projectId: ID(10),
  name: 'P',
  approvalStatus: 'approved',
  needFrames: 10,
  simulatedFrames: 5,
  hours: 1,
  nightsUsed: 1,
  completesNight: null,
  sharePct: 50,
  filters: [],
  ...o,
});
const result = (weather: boolean): MultiSimResult => ({
  kind: 'multi_sim',
  rigId: ID(1),
  rigName: 'Rig',
  siteTimeZone: 'America/Chicago',
  nightFrom: '2026-10-10',
  nightCount: 2,
  weather,
  computedAt: '2026-10-10T18:00:00Z',
  nights: [
    {
      night: '2026-10-10',
      darkHours: 9.6,
      weight: 0.1,
      ratingIndex: 1,
      hasForecast: true,
      exposureHours: 0.8,
      projects: [
        { projectId: ID(10), frames: 1, hours: 0.6 },
        { projectId: ID(11), frames: 1, hours: 0.3 },
      ],
    },
    {
      night: '2026-10-11',
      darkHours: 9.6,
      weight: 1,
      ratingIndex: 4,
      hasForecast: true,
      exposureHours: 7.9,
      projects: [
        { projectId: ID(10), frames: 1, hours: 2 },
        { projectId: ID(11), frames: 1, hours: 6 },
      ],
    },
  ],
  projects: [
    project({ projectId: ID(10), name: 'Klein' }),
    project({ projectId: ID(11), name: 'Groß', completesNight: '2026-10-11', simulatedFrames: 10 }),
    project({ projectId: ID(12), name: 'Fertig', needFrames: 0, simulatedFrames: 0 }),
  ],
});

describe('multiSimView', () => {
  it('Summen, möglich bei klarer Nacht, Anteile je Projekt nach Blockzeit, Reihenfolge nach Stunden', () => {
    const v = multiSimView(result(true));
    expect(v.totals).toMatchObject({
      expected: 8.7,
      possible: 15.9,
      goodNights: ['2026-10-11'],
      withoutForecast: [],
      completing: [{ name: 'Groß', night: '2026-10-11' }],
      active: 2,
    });
    expect(v.finished).toEqual(['Fertig']);
    expect(v.projects.map((p) => [p.name, p.colorIndex, p.hours, p.progressPct])).toEqual([
      ['Groß', 0, [0.3, 5.9], 100],
      ['Klein', 1, [0.5, 2], 50],
    ]);
    expect(v.nights[0]).toMatchObject({ expected: 0.8, possible: 8 });
    expect(v.nights[0]?.segments.map((s) => s.projectId)).toEqual([ID(11), ID(10)]);
  });

  it('ohne Wetter: möglich = erwartet; Zählweise je Nacht', () => {
    const v = multiSimView(result(false));
    expect(v.totals.possible).toBe(v.totals.expected);
    expect(weightKind({ weight: 0.1, hasForecast: true }, false)).toBe('off');
    expect(weightKind({ weight: 1, hasForecast: false }, true)).toBe('noForecast');
    expect(weightKind({ weight: 1, hasForecast: true }, true)).toBe('full');
    expect(weightKind({ weight: 0.5, hasForecast: true }, true)).toBe('partial');
  });
});
