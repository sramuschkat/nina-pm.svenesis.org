// @vitest-environment jsdom
/**
 * Reiter *Sessions & Protokoll* im Projekt-Editor (S-31, AP-77): Fortschritt und Qualität je Filter als Karten, Verlauf,
 * Sessions mit Qualität, HFR-Spanne und Guiding Ø; Abfrage mit `projectId` über alle Nächte; axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { ProjectQualityView, ProjectReport, QualityStats } from '../../api/client';
import { ProjectSessionsTab } from './ProjectTabs';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const state = vi.hoisted(() => ({
  calls: [] as unknown[],
  report: null as unknown,
  quality: null as unknown,
}));

vi.mock('../../api/client', () => ({
  memberApi: {
    directory: () =>
      Promise.resolve({
        items: [
          {
            id: '00000000-0000-4000-8000-000000000003',
            displayName: 'Uta',
            avatarUrl: null,
            status: 'active',
          },
        ],
      }),
  },
  equipmentApi: {
    list: () => Promise.resolve({ items: [] }),
    nights: () => Promise.resolve({ nights: [] }),
  },
  projectsApi: {},
  reportsApi: {
    projects: (q: unknown) => {
      state.calls.push(q);
      return Promise.resolve(state.report);
    },
  },
  sessionsApi: { projectQuality: () => Promise.resolve(state.quality) },
}));

const stats = (o: Partial<QualityStats> = {}): QualityStats => ({
  good: 16,
  flagged: 1,
  rejected: 1,
  none: 0,
  sharePct: 88.9,
  reasons: { hfr: 0, stars: 1, rms: 0, cloud: 0 },
  hfr: { median: 1.51, min: 1.45, max: 1.95 },
  stars: { median: 1600, min: 400, max: 1700 },
  rmsArcsec: { median: 0.62, min: 0.4, max: 0.9 },
  ...o,
});

const quality = (): ProjectQualityView => ({
  projectId: ID(10),
  rigId: ID(1),
  settings: { hfrPct: 30, starsPct: 50, rmsArcsec: 1.5, cloudPct: 50 },
  minRef: 10,
  filters: [
    { filter: 'OIII', ...stats() },
    {
      filter: 'L',
      ...stats({
        good: 8,
        flagged: 0,
        rejected: 0,
        sharePct: 100,
        reasons: { hfr: 0, stars: 0, rms: 0, cloud: 0 },
      }),
    },
  ],
  nights: [],
  sessions: [{ sessionId: ID(20), ...stats({ good: 24, sharePct: 92.3 }) }],
  total: stats(),
  truncated: false,
});

const report = (): ProjectReport => ({
  from: '2026-09-01',
  to: '2026-09-26',
  generatedAt: '2026-09-26T18:00:00Z',
  totals: { projects: 1, periodAccepted: 24, periodIntegrationS: 7200 },
  projects: [
    {
      projectId: ID(10),
      name: 'NGC 7000',
      createdBy: ID(3),
      projectType: 'deep_sky',
      targetName: 'NGC 7000',
      rigId: ID(1),
      rigName: 'Rig A',
      approvalStatus: 'approved',
      status: 'active',
      percentDone: 55,
      commentCount: 0,
      filters: [
        {
          filter: 'OIII',
          planned: 40,
          accepted: 36,
          remaining: 4,
          integrationS: 10800,
          percentDone: 90,
        },
        {
          filter: 'L',
          planned: 40,
          accepted: 8,
          remaining: 32,
          integrationS: 2400,
          percentDone: 20,
        },
      ],
      periodAccepted: 24,
      periodIntegrationS: 7200,
      nights: [
        {
          night: '2026-09-12',
          filters: [
            {
              filter: 'OIII',
              acquired: 18,
              rejected: 2,
              accepted: 16,
              integrationS: 4800,
              cumulativeS: 10800,
            },
            {
              filter: 'L',
              acquired: 8,
              rejected: 0,
              accepted: 8,
              integrationS: 2400,
              cumulativeS: 2400,
            },
          ],
        },
      ],
      sessions: [
        {
          sessionId: ID(20),
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
      ],
      conditions: {
        minAltitudeDeg: 30,
        minTimeOnTargetH: 1,
        twilight: 'astronomical',
        moonAvoidanceEnabled: true,
        moonSeparationDeg: 60,
      },
      channelBalance: {
        behind: [{ filter: 'L', percentDone: 20 }],
        ahead: [{ filter: 'OIII', percentDone: 90 }],
      },
    },
  ],
});

const wrap = (projectId: string) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <ProjectSessionsTab projectId={projectId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  state.calls = [];
  state.report = report();
  state.quality = quality();
});

describe('Projekt-Editor: Reiter Sessions & Protokoll (S-31)', () => {
  it('Karten je Filter mit Fortschritt und Qualität, Sessions mit Qualität, HFR-Spanne und Guiding; axe', async () => {
    wrap(ID(10));
    const sessions = await screen.findByRole('table', { name: 'Sessions von NGC 7000' });
    expect(within(sessions).getByRole('link', { name: '12./13.09.' })).toBeTruthy();
    expect(
      within(sessions)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual([
      'Nacht',
      'Rig',
      'Frames je Filter',
      'Qualität',
      'HFR (Spanne)',
      'Guiding Ø',
      'Wetter',
    ]);
    expect(await within(sessions).findByText('92 % gut')).toBeTruthy();
    expect(within(sessions).getByText('1,45–1,95 px')).toBeTruthy();
    expect(within(sessions).getByText('0,6″')).toBeTruthy();
    const cards = screen.getByRole('list', { name: 'Filter von NGC 7000' });
    const oiii = within(cards).getAllByRole('listitem')[0] as HTMLElement;
    expect(within(oiii).getByText('36/40')).toBeTruthy();
    expect(within(oiii).getByText('88 % gut')).toBeTruthy();
    expect(within(oiii).getByText(/6 % ⚠ auffällig \(1 Sterne\)/)).toBeTruthy();
    expect(within(oiii).getByText('HFR 1,51 px · Guiding Ø 0,6″')).toBeTruthy();
    expect(screen.getByText(/1 Nächte · 44 Lights · 3,7 h · Qualität 88 % gut/)).toBeTruthy();
    expect(state.calls).toEqual([{ projectId: ID(10) }]);
    await expectNoSeriousA11y();
  });

  it('ohne Aufnahmen ein Hinweis', async () => {
    const r = report();
    state.report = { ...r, projects: [{ ...r.projects[0], sessions: [] }] };
    wrap(ID(10));
    expect(await screen.findByText('Noch keine Aufnahmen für dieses Projekt.')).toBeTruthy();
  });
});
