// @vitest-environment jsdom
/**
 * AP-35: S-02 „Heute Nacht“ (Umbau Wunsch Sven 27.09.2026) – zuerst das Rig wählen (Standort), Nacht vom
 * Server (nicht aus dem Browserdatum), „Mond und Dunkelheit“, Plan nur mit NINA, Safety-Link und geplanten
 * Projekten (Zeiten in Standortzeit mit Kürzel, CDT); „Nacht im Detail“ und „Mond & Planeten“; keine
 * ungeprüften Sessions und keine Warteschlange mehr; Admin schaltet eine Zeile nur für die kommende Nacht aus
 * (danach neue Prognose); User ohne Umschalter; Nacht ohne Prognose; axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
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
        items:
          kind === 'filters'
            ? [{ id: ID(5), shortName: 'Ha', colorHex: '#c62828' }]
            : kind === 'sites'
              ? [
                  {
                    id: ID(2),
                    name: 'Starfront',
                    latitudeDeg: 31.5471,
                    longitudeDeg: -99.3823,
                    timeZone: 'America/Chicago',
                  },
                  {
                    id: ID(3),
                    name: 'Hannover',
                    latitudeDeg: 52.3705,
                    longitudeDeg: 9.7332,
                    timeZone: 'Europe/Berlin',
                  },
                ]
              : [],
      }),
    nights: () =>
      Promise.resolve({
        currentNight: '2026-09-18',
        nights: [],
        timeZoneTransitions: [{ atUtc: '2026-03-08T08:00:00Z', utcOffsetMinutes: -300 }],
      }),
    weather: () => Promise.resolve({ status: 'pending' }),
  },
  tonightApi: {
    get: () => Promise.resolve(state.view),
    setLine: (...a: unknown[]) => state.setLine(...a) as Promise<unknown>,
  },
  forecastApi: { run: (...a: unknown[]) => state.run(...a) as Promise<unknown> },
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

function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.search}</span>;
}

const wrap = (path = '/heute-nacht') =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <TonightPage />
          <Where />
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
  it('Rig zuerst, dann Mond und Dunkelheit, Plan, Nacht im Detail, Mond & Planeten; axe', async () => {
    wrap();
    const context = await screen.findByRole('region', { name: 'Rig und Nacht' });
    expect(within(context).getByRole('combobox', { name: 'Rig wählen' })).toHaveTextContent(
      'Rig A',
    );
    expect(context.textContent).toContain('Starfront · Nacht 18./19.09.');
    const card = (
      await screen.findByRole('heading', { level: 2, name: 'Plan für diese Nacht' })
    ).closest('section') as HTMLElement;
    // Nur, was NINA heute Nacht tut: NINA-Status, Safety-Link, Projekte – Dunkelheit, Mond und Wetter stehen in
    // „Mond und Dunkelheit“ bzw. „Nacht im Detail“ (nicht doppelt, 27.09.2026).
    expect(card.textContent).toContain('PC: zuletzt gesehen 18.09.2026 12:55 CDT');
    expect(
      within(card).getByRole('link', { name: 'Safety- und Wetterseite der Sternwarte' }),
    ).toHaveProperty('href', 'https://example.org/safety');
    for (const gone of ['Dunkelheit', 'beleuchtet', 'Gut 72 %', 'bestes Fenster'])
      expect(card.textContent).not.toContain(gone);
    expect(within(card).queryByRole('img')).toBeNull();
    const table = within(card).getByRole('table', { name: 'Geplante Projekte am Rig Rig A' });
    const row = within(table).getByRole('row', { name: /NGC 281/ });
    expect(row.textContent).toContain('24');
    expect(row.textContent).toContain('2,1 h');
    expect(card.textContent).toContain('2 weitere aktive Projekte ohne Frames in dieser Nacht.');
    // Mond und Dunkelheit vor dem Plan; Nacht im Detail und Mond & Planeten danach.
    const moon = await screen.findByRole('img', {
      name: /Mond und Dunkelheit der Nacht 18\.\/19\.09\./,
    });
    expect(moon.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const detail = screen.getByRole('heading', { level: 2, name: 'Nacht im Detail' });
    expect(card.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('noch keine Vorhersage für diese Nacht')).toBeTruthy();
    const bodies = screen.getByRole('heading', { level: 2, name: 'Mond & Planeten' });
    const panel = bodies.closest('section') as HTMLElement;
    expect(
      within(panel).getByRole('img', { name: /Sichtbarkeit von Mond und Planeten.*Zeiten in CDT/ }),
    ).toBeTruthy();
    expect(within(panel).getAllByRole('listitem').length).toBeGreaterThan(0);
    expect(panel.textContent).toMatch(/max\. \d+° um \d\d:\d\d CDT/);
    // Ereignisse der Nacht: Bahndaten (hier der mitgelieferte Stand), vier Gruppen aus der Engine.
    const events = (
      await screen.findByRole('heading', { level: 2, name: 'Ereignisse der Nacht' })
    ).closest('section') as HTMLElement;
    expect(await within(events).findByText(/Satellitenbahnen Stand 15\.09\.2026/)).toBeTruthy();
    // 18./19.09.: noch kein großer Strom aktiv (Südliche Tauriden ab λ☉ 177°) – Gruppe entfällt.
    expect(within(events).queryByText('Meteorströme')).toBeNull();
    expect(within(events).getByText('Zentrum der Milchstraße')).toBeTruthy();
    expect(within(events).getByText('Die nächsten Finsternisse am Standort')).toBeTruthy();
    expect(
      within(events).getByText(/Halbschatten-Mondfinsternis · Sa\., 20\.02\.2027, 17:13 CST/),
    ).toBeTruthy();
    // Keine ungeprüften Sessions und keine Warteschlange mehr.
    expect(
      screen.queryByRole('heading', { name: /Ungeprüfte Sessions|Offene Warteschlange/ }),
    ).toBeNull();
    await expectNoSeriousA11y();
  });

  it('Rig aus der URL: anderes Rig zeigt dessen Standort', async () => {
    const v = view();
    const a = v.rigs[0];
    if (a)
      v.rigs.push({ ...a, rigId: ID(4), rigName: 'Rig B', siteId: ID(3), siteName: 'Hannover' });
    state.view = v;
    wrap(`/heute-nacht?rig=${ID(4)}`);
    const context = await screen.findByRole('region', { name: 'Rig und Nacht' });
    expect(within(context).getByRole('combobox', { name: 'Rig wählen' })).toHaveTextContent(
      'Rig B',
    );
    expect(context.textContent).toContain('Hannover · Nacht 18./19.09.');
    expect(screen.getByTestId('where')).toHaveTextContent(`rig=${ID(4)}`);
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

  it('User: kein Umschalter; „heute aus“ als Hinweis', async () => {
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
