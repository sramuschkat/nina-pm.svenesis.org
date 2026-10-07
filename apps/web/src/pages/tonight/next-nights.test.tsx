// @vitest-environment jsdom
/**
 * AP-64 (vorher AP-33, S-62 Folgeplanung): Abschnitt „Nächste Nächte“ auf „Heute Nacht“ – Kandidatennächte mit Ampel
 * und Wetterkennzeichen, Saisonwarnung mit Ein-Klick-Vorschlag (Admin, danach neue Prognose), Neuberechnung, Zustand
 * „noch keine Prognose“; „Nur für die kommende Nacht“ steht nicht doppelt hier, sondern im Plan der Nacht; axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { ForecastView, Me } from '../../api/client';
import { AuthProvider } from '../../auth';
import { NextNights } from './NextNights';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const state = vi.hoisted(() => ({
  me: null as unknown,
  view: null as unknown,
  run: vi.fn(),
  priority: vi.fn(),
  setStatus: vi.fn(),
  setLine: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  api: { me: () => Promise.resolve(state.me) },
  // Mitgliederverzeichnis: Ersteller neben dem Projektnamen (01.10.2026).
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
    list: (kind: string) =>
      Promise.resolve({
        items:
          kind === 'rigs'
            ? [{ id: ID(1), name: 'Rig A', showInPlanning: true, siteId: ID(2) }]
            : [],
      }),
    nights: vi.fn(),
  },
  forecastApi: {
    get: () => Promise.resolve(state.view),
    run: (...a: unknown[]) => state.run(...a) as Promise<unknown>,
  },
  projectsApi: {
    priority: (...a: unknown[]) => state.priority(...a) as Promise<unknown>,
    setStatus: (...a: unknown[]) => state.setStatus(...a) as Promise<unknown>,
  },
  tonightApi: {
    setLine: (...a: unknown[]) => state.setLine(...a) as Promise<unknown>,
  },
  jobsApi: {
    get: (id: string) => Promise.resolve({ id, status: 'running', hasResult: false }),
    result: vi.fn(),
  },
}));

const me = (role: 'owner' | 'user'): Me => ({
  identity: {
    id: ID(90),
    discordUserId: '1',
    username: 'u',
    globalName: 'Uta',
    avatarHash: null,
    mfa: true,
  },
  context: 'tenant',
  tenant: { id: ID(91), key: 'demo', name: 'Demo', timeZone: 'Europe/Berlin' },
  member: {
    id: ID(92),
    displayName: 'Uta',
    role,
    effectiveRole: role === 'user' ? 'user' : 'admin',
  },
  isSuperUser: false,
  mfaRequired: false,
  memberships: [{ tenantKey: 'demo', tenantName: 'Demo', role }],
});

const night = (k: string, weather: ForecastView['nights'][number]['weather'], weight = 1) => ({
  night: k,
  darkHours: 9,
  weight,
  weightSource: weather ? ('forecast' as const) : ('quota' as const),
  weather,
});

const view = (): ForecastView => ({
  rigId: ID(1),
  rigName: 'Rig A',
  siteTimeZone: 'America/Chicago',
  computedAt: '2026-09-26T18:00:00Z',
  currentNight: '2026-09-26',
  nights: [
    night('2026-09-26', {
      nightMean: 0.8,
      ratingIndex: 3,
      coverage: 1,
      bestWindow: null,
      aerosolMissing: false,
      seeingIncomplete: false,
      incomplete: false,
      precipProbPct: 20,
      precipMm: 0.4,
    }),
    night(
      '2026-09-27',
      {
        nightMean: 0.5,
        ratingIndex: 2,
        coverage: 0.8,
        bestWindow: null,
        aerosolMissing: true,
        seeingIncomplete: false,
        incomplete: true,
        precipProbPct: 0,
        precipMm: 0,
      },
      0.5,
    ),
  ],
  clearQuota: { rate: 0.5, source: 'default', recordedNights: 3 },
  projects: [
    {
      projectId: ID(10),
      name: 'NGC 281',
      createdBy: ID(3),
      priority: 2,
      status: 'active',
      need: [{ filter: 'Ha', frames: 17, hours: 1.56 }],
      needFrames: 17,
      needHours: 1.56,
      optimistic: { nights: 2, completesNight: '2026-09-27', extrapolated: false },
      realistic: { nights: 4, completesNight: '2026-09-29', extrapolated: true },
      candidates: [
        {
          night: '2026-09-26',
          frames: 10,
          hours: 1,
          benefit: 10,
          light: 'green',
          filters: [{ filter: 'Ha', frames: 10 }],
        },
        {
          night: '2026-09-27',
          frames: 10,
          hours: 1,
          benefit: 5,
          light: 'yellow',
          filters: [{ filter: 'Ha', frames: 10 }],
        },
      ],
      seasonWarning: { achievablePct: 80, seasonEnd: '2026-12-01' },
      suggestions: [
        { kind: 'raise_priority', oneClick: true },
        { kind: 'reduce_frames', oneClick: false },
      ],
      lines: [{ lineId: ID(11), filter: 'Ha', frames: 10, disabledTonight: false }],
    },
  ],
  resume: [],
});

const wrap = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <AuthProvider>
          <NextNights rigId={ID(1)} />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  state.me = me('owner');
  state.view = view();
  for (const f of [state.run, state.priority, state.setStatus, state.setLine]) f.mockReset();
});

describe('Heute Nacht – Nächste Nächte (AP-64)', () => {
  it('Kandidatennächte mit Ampel und Kennzeichen, Ersteller gekürzt; axe', async () => {
    wrap();
    expect(await screen.findByRole('heading', { level: 2, name: 'Nächste Nächte' })).toBeTruthy();
    const matrix = await screen.findByRole('table', { name: 'Kandidatennächte' });
    expect(within(matrix).getByText('Regen 20 % · 0,4 mm')).toBeTruthy();
    expect(within(matrix).getByText('ohne Aerosol – optimistisch')).toBeTruthy();
    expect(within(matrix).getByText('Nacht unvollständig')).toBeTruthy();
    const cells = within(matrix).getAllByRole('cell');
    expect(cells.map((c) => c.getAttribute('data-light'))).toEqual(['green', 'yellow']);
    expect(cells[1]?.textContent).toContain('5 · 1 h');
    expect(screen.getByText(/Startquote 50 %/)).toBeTruthy();
    // Restbedarf und Prognose stehen jetzt in der Auswertung (Projekte), nicht hier.
    expect(screen.queryByRole('table', { name: 'Restbedarf und Prognose' })).toBeNull();
    // „Nur für die kommende Nacht“ nicht doppelt (steht im Plan der Nacht).
    expect(screen.queryByText('Nur für die kommende Nacht')).toBeNull();
    await expectNoSeriousA11y();
  });

  it('Admin: Priorität erhöhen per Klick, danach neue Prognose; Hinweise ohne Knopf', async () => {
    state.priority.mockResolvedValue({});
    state.run.mockResolvedValue({ jobId: ID(99) });
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Priorität erhöhen' }));
    await waitFor(() => expect(state.priority).toHaveBeenCalledWith(ID(10), 1));
    await waitFor(() => expect(state.run).toHaveBeenCalledWith(ID(1)));
    expect(screen.queryByRole('button', { name: 'Frames reduzieren' })).toBeNull();
    expect(screen.getByText('Frames reduzieren')).toBeTruthy();
  });

  it('User sieht Vorschläge nur als Hinweis; noch keine Prognose → Hinweis; neu berechnen', async () => {
    state.me = me('user');
    state.view = { ...view(), computedAt: null, nights: [], projects: [] };
    wrap();
    expect(await screen.findByText(/liegt noch keine Prognose vor/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Priorität erhöhen' })).toBeNull();
    state.run.mockResolvedValue({ jobId: ID(98) });
    fireEvent.click(screen.getByRole('button', { name: 'Prognose neu berechnen' }));
    await waitFor(() => expect(state.run).toHaveBeenCalledWith(ID(1)));
  });
});
