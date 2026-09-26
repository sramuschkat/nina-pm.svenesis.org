// @vitest-environment jsdom
/**
 * AP-35: S-02 „Heute Nacht“ – Karte je Rig mit Nacht vom Server (nicht aus dem Browserdatum), Zeiten in
 * Standortzeit mit Kürzel (CDT), Mond, Wetterband, NINA, Safety-Link, geplante Projekte; Admin schaltet eine
 * Zeile nur für die kommende Nacht aus (danach neue Prognose); ungeprüfte Sessions und Warteschlange (Admin);
 * User ohne Umschalter und ohne Warteschlange; Nacht ohne Prognose; axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { Me, TonightView } from '../../api/client';
import { AuthProvider } from '../../auth';
import { TonightPage } from './TonightPage';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const state = vi.hoisted(() => ({
  me: null as unknown,
  view: null as unknown,
  run: vi.fn(),
  setLine: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  api: { me: () => Promise.resolve(state.me) },
  equipmentApi: {
    list: (kind: string) =>
      Promise.resolve({
        items: kind === 'filters' ? [{ id: ID(5), shortName: 'Ha', colorHex: '#c62828' }] : [],
      }),
  },
  tonightApi: {
    get: () => Promise.resolve(state.view),
    setLine: (...a: unknown[]) => state.setLine(...a) as Promise<unknown>,
  },
  forecastApi: { run: (...a: unknown[]) => state.run(...a) as Promise<unknown> },
  sessionsApi: {
    list: () =>
      Promise.resolve({
        items: [{ id: ID(30), night: '2026-09-17', rigName: 'Rig A', frames: 42 }],
      }),
  },
  approvalApi: {
    queue: () =>
      Promise.resolve({
        items: [
          {
            kind: 'project',
            id: ID(40),
            projectId: ID(40),
            name: 'IC 1396',
            createdByName: 'Ben',
          },
        ],
      }),
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

const view = (): TonightView => ({
  generatedAt: '2026-09-18T18:00:00Z',
  rigs: [
    {
      rigId: ID(1),
      rigName: 'Rig A',
      siteId: ID(2),
      siteName: 'Starfront',
      siteTimeZone: 'America/Chicago',
      weatherSafetyUrl: 'https://example.org/safety',
      night: '2026-09-18',
      nightWindow: { startUtc: '2026-09-19T00:00:00Z', endUtc: '2026-09-19T13:00:00Z' },
      dark: { fromUtc: '2026-09-19T01:10:00Z', toUtc: '2026-09-19T10:40:00Z' },
      darkHours: 9.5,
      moon: {
        illumPct: 48,
        events: [{ type: 'set', atUtc: '2026-09-19T05:00:00Z' }],
      },
      weather: {
        nightMean: 0.72,
        ratingIndex: 3,
        coverage: 1,
        bestWindow: {
          fromUtc: '2026-09-19T02:00:00Z',
          toUtc: '2026-09-19T08:00:00Z',
          sec: 21600,
          moonFreeSec: 18000,
          meanScore: 0.8,
          fair: true,
        },
        aerosolMissing: false,
        hours: [
          { tUtc: '2026-09-19T00:00:00Z', overallScore: 0.7, ratingIndex: 3, sunAltDeg: -10 },
          { tUtc: '2026-09-19T01:00:00Z', overallScore: 0.8, ratingIndex: 3, sunAltDeg: -20 },
        ],
      },
      forecast: { computedAt: '2026-09-18T17:10:00Z', covered: true },
      projects: [
        {
          projectId: ID(10),
          name: 'NGC 281',
          priority: 1,
          frames: 24,
          hours: 2.1,
          lines: [{ lineId: ID(11), filter: 'Ha', frames: 24, disabledTonight: false }],
        },
      ],
      idleProjects: 2,
      instances: [{ id: ID(20), name: 'PC', lastSeenAt: '2026-09-18T17:55:00Z', state: 'waiting' }],
    },
  ],
});

const wrap = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <AuthProvider>
          <TonightPage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  state.me = me('owner');
  state.view = view();
  state.run.mockReset();
  state.setLine.mockReset();
});

describe('S-02 Heute Nacht', () => {
  it('Karte je Rig: Nacht vom Server, Standortzeit mit Kürzel, Mond, Wetter, NINA, Plan; axe', async () => {
    wrap();
    const card = (await screen.findByRole('heading', { level: 2, name: 'Rig A' })).closest(
      'section',
    ) as HTMLElement;
    expect(card.textContent).toContain('Starfront · Nacht 18./19.09.');
    expect(card.textContent).toContain('20:10 CDT–05:40 CDT · 9,5 h');
    expect(card.textContent).toContain('48 % beleuchtet · Untergang 00:00 CDT');
    expect(card.textContent).toContain('Gut 72 %');
    expect(card.textContent).toContain('bestes Fenster 21:00 CDT–03:00 CDT');
    expect(card.textContent).toContain('PC: zuletzt gesehen 18.09.2026 12:55 CDT');
    expect(
      within(card).getByRole('link', { name: 'Safety- und Wetterseite der Sternwarte' }),
    ).toHaveProperty('href', 'https://example.org/safety');
    expect(
      within(card).getByRole('img', { name: 'Wetter der Nacht 18./19.09. am Rig Rig A' }),
    ).toBeTruthy();
    const table = within(card).getByRole('table', { name: 'Geplante Projekte am Rig Rig A' });
    const row = within(table).getByRole('row', { name: /NGC 281/ });
    expect(row.textContent).toContain('24');
    expect(row.textContent).toContain('2,1 h');
    expect(card.textContent).toContain('2 weitere aktive Projekte ohne Frames in dieser Nacht.');
    // Darunter: ungeprüfte Sessions, Warteschlange (Admin).
    expect(await screen.findByRole('link', { name: '17./18.09.' })).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'IC 1396' })).toBeTruthy();
    await expectNoSeriousA11y();
  });

  it('Admin: Zeile nur heute aus, danach neue Prognose für das Rig', async () => {
    state.setLine.mockResolvedValue({});
    state.run.mockResolvedValue({ jobId: ID(99) });
    wrap();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Ha (24 Frames) nur heute Nacht ausschalten' }),
    );
    await waitFor(() => expect(state.setLine).toHaveBeenCalledWith(ID(10), ID(11), true));
    await waitFor(() => expect(state.run).toHaveBeenCalledWith(ID(1)));
  });

  it('User: kein Umschalter, keine Warteschlange; „heute aus“ als Hinweis', async () => {
    state.me = me('user');
    const v = view();
    const rig = v.rigs[0];
    if (rig) {
      rig.projects[0]?.lines.splice(0, 1, {
        lineId: ID(11),
        filter: 'Ha',
        frames: 0,
        disabledTonight: true,
      });
    }
    state.view = v;
    wrap();
    expect(await screen.findByText('heute aus')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /heute Nacht/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: /Offene Warteschlange/ })).toBeNull();
  });

  it('Nacht noch nicht in der Prognose: Hinweis und „Prognose berechnen“', async () => {
    state.view = {
      ...view(),
      rigs: view().rigs.map((r) => ({ ...r, forecast: { computedAt: null, covered: false } })),
    };
    state.run.mockResolvedValue({ jobId: ID(98) });
    wrap();
    expect(await screen.findByText(/Die Prognose enthält diese Nacht noch nicht/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Prognose berechnen' }));
    await waitFor(() => expect(state.run).toHaveBeenCalledWith(ID(1)));
  });
});
