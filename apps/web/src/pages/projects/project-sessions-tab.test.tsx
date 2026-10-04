// @vitest-environment jsdom
/**
 * Reiter *Sessions & Protokoll* im Projekt-Editor (S-31): der Abschnitt des Projektberichts für genau dieses Projekt,
 * aufgeklappt; Abfrage mit `projectId` über alle Nächte.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../test/setup';
import type { ProjectReport } from '../../api/client';
import { ChartArea } from './ProjectTabs';
import type { ProjectDraft } from './model';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const state = vi.hoisted(() => ({ calls: [] as unknown[], report: null as unknown }));

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
}));

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

const draft = { raDeg: null, decDeg: null, conditions: {} } as unknown as ProjectDraft;

const wrap = (projectId: string | null) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <ChartArea draft={draft} site={null} sessionsProjectId={projectId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  state.calls = [];
  state.report = report();
});

describe('Projekt-Editor: Reiter Sessions & Protokoll (S-31)', () => {
  it('zeigt Filter, Verlauf und Sessions des Projekts, Abfrage nur mit projectId', async () => {
    wrap(ID(10));
    fireEvent.click(screen.getByRole('tab', { name: 'Sessions & Protokoll' }));
    const sessions = await screen.findByRole('table', { name: 'Sessions von NGC 7000' });
    expect(within(sessions).getByRole('link', { name: '12./13.09.' })).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Filter von NGC 7000' })).toBeTruthy();
    expect(state.calls).toEqual([{ projectId: ID(10) }]);
  });

  it('ohne Aufnahmen ein Hinweis; ohne freigegebenes Projekt kein Reiter', async () => {
    const r = report();
    state.report = { ...r, projects: [{ ...r.projects[0], sessions: [] }] };
    const { unmount } = wrap(ID(10));
    fireEvent.click(screen.getByRole('tab', { name: 'Sessions & Protokoll' }));
    expect(await screen.findByText('Noch keine Aufnahmen für dieses Projekt.')).toBeTruthy();
    unmount();
    wrap(null);
    expect(screen.queryByRole('tab', { name: 'Sessions & Protokoll' })).toBeNull();
  });
});
