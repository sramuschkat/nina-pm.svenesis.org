/**
 * Projektbericht (AP-34; FA-AUS-18, FA-AUS-10, FA-AUS-11, FA-AUS-13): Filter-Summen, Verlauf je Nacht mit
 * kumulierter Integration über den Zeitraum hinaus, Sessions mit Verworfen-Quote und Wetter, Kanalbalance.
 */
import { describe, expect, it } from 'vitest';
import { channelBalance, ProjectReport, projectReport } from '../src';
import { NGC7000, projects } from './fixtures/plan';

const p = projects.find((x) => x.id === NGC7000);
if (!p) throw new Error('Fixture fehlt');
const [oiii, l] = p.panels[0]?.lines ?? [];
if (!oiii || !l) throw new Error('Fixture fehlt');
// OIII 40/36 akzeptiert, L 40/8 → Kanalbalance-Hinweis.
const project = {
  ...p,
  panels: p.panels.map((panel) => ({
    ...panel,
    lines: [
      {
        ...oiii,
        counters: {
          ...oiii.counters,
          planned: 40,
          accepted: 36,
          remaining: 4,
          integrationS: 36 * 300,
        },
      },
      {
        ...l,
        counters: { ...l.counters, planned: 40, accepted: 8, remaining: 32, integrationS: 8 * 300 },
      },
    ],
  })),
};

const S1 = '00000000-0000-4000-8000-000000000501';
const report = projectReport({
  from: '2026-09-10',
  to: '2026-09-20',
  generatedAt: '2026-09-26T18:00:00Z',
  projects: [project],
  rigNames: new Map([[project.rigId as string, 'Rig A']]),
  nights: [
    {
      projectId: p.id,
      lineId: oiii.id,
      night: '2026-09-01',
      acquired: 20,
      rejected: 0,
      integrationS: 6000,
    },
    {
      projectId: p.id,
      lineId: oiii.id,
      night: '2026-09-12',
      acquired: 18,
      rejected: 2,
      integrationS: 4800,
    },
    {
      projectId: p.id,
      lineId: l.id,
      night: '2026-09-12',
      acquired: 8,
      rejected: 0,
      integrationS: 2400,
    },
    {
      projectId: p.id,
      lineId: oiii.id,
      night: '2026-09-25',
      acquired: 5,
      rejected: 0,
      integrationS: 1500,
    },
  ],
  sessions: [
    {
      sessionId: S1,
      projectId: p.id,
      lineId: oiii.id,
      night: '2026-09-12',
      rigName: 'Rig A',
      status: 'completed',
      frames: 18,
      rejected: 2,
      weatherRatingIndex: 3,
    },
    {
      sessionId: S1,
      projectId: p.id,
      lineId: l.id,
      night: '2026-09-12',
      rigName: 'Rig A',
      status: 'completed',
      frames: 8,
      rejected: 0,
      weatherRatingIndex: 3,
    },
  ],
});

describe('projectReport', () => {
  it('Filter-Summen und Fortschritt; Vertragsform', () => {
    expect(ProjectReport.safeParse(report).error?.issues ?? []).toEqual([]);
    const r = report.projects[0];
    expect(r?.rigName).toBe('Rig A');
    expect(
      r?.filters.map((f) => [f.filter, f.planned, f.accepted, f.remaining, f.percentDone]),
    ).toEqual([
      ['OIII', 40, 36, 4, 90],
      ['L', 40, 8, 32, 20],
    ]);
    expect(r?.percentDone).toBe(55);
  });

  it('Verlauf: nur Nächte im Zeitraum, kumuliert ab der ersten Nacht', () => {
    const r = report.projects[0];
    expect(r?.nights.map((n) => n.night)).toEqual(['2026-09-12']);
    expect(r?.nights[0]?.filters).toEqual([
      {
        filter: 'OIII',
        acquired: 18,
        rejected: 2,
        accepted: 16,
        integrationS: 4800,
        cumulativeS: 10800,
      },
      { filter: 'L', acquired: 8, rejected: 0, accepted: 8, integrationS: 2400, cumulativeS: 2400 },
    ]);
    expect(r?.periodAccepted).toBe(24);
    expect(r?.periodIntegrationS).toBe(7200);
    expect(report.totals).toEqual({ projects: 1, periodAccepted: 24, periodIntegrationS: 7200 });
  });

  it('Sessions mit Frames je Filter, Verworfen-Quote und Wetter', () => {
    expect(report.projects[0]?.sessions).toEqual([
      {
        sessionId: S1,
        night: '2026-09-12',
        rigName: 'Rig A',
        status: 'completed',
        filters: [
          { filter: 'OIII', frames: 18 },
          { filter: 'L', frames: 8 },
        ],
        frames: 26,
        rejectedPct: 7.7,
        weatherRatingIndex: 3,
      },
    ]);
  });

  it('Kanalbalance: Filter ≥ 30 Punkte hinter dem besten', () => {
    expect(report.projects[0]?.channelBalance).toEqual({
      behind: [{ filter: 'L', percentDone: 20 }],
      ahead: [{ filter: 'OIII', percentDone: 90 }],
    });
    const even = [
      { filter: 'R', planned: 10, accepted: 8, remaining: 2, integrationS: 0, percentDone: 80 },
      { filter: 'G', planned: 10, accepted: 6, remaining: 4, integrationS: 0, percentDone: 60 },
    ];
    expect(channelBalance(even)).toBeNull();
    expect(channelBalance([even[0] as (typeof even)[number]])).toBeNull();
  });
});
