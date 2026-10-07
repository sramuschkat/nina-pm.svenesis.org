// @vitest-environment jsdom
/**
 * AP-64 (vorher AP-34): Auswertung – Reiter „Projekte“ – Zeitraum und Rig aus dem gemeinsamen Filter, Status und Objekttyp
 * gehen in die Abfrage; eine Zeile je Projekt mit Ersteller, Fortschritt je Filter und „Voraussichtlich fertig“ aus der
 * Prognose (bzw. Saisonwarnung); „Verlauf“ klappt Balken je Nacht, Nächte mit Link, Kanalbalance und Bedingungen auf;
 * CSV und Drucken; axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { ForecastView, Me, ProjectReport } from '../../api/client';
import { AuthProvider } from '../../auth';
import { etaOf, ProjectsPage } from './ProjectsPage';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const state = vi.hoisted(() => ({
  me: null as unknown,
  calls: [] as unknown[],
  report: null as unknown,
  forecast: null as unknown,
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
            ? [{ id: ID(1), name: 'Rig A' }]
            : kind === 'filters'
              ? [
                  { id: ID(5), shortName: 'OIII', colorHex: '#00897b' },
                  { id: ID(6), shortName: 'L', colorHex: '#9e9e9e' },
                ]
              : [],
      }),
  },
  reportsApi: {
    projects: (q: unknown) => {
      state.calls.push(q);
      return Promise.resolve(state.report);
    },
  },
  forecastApi: { get: () => Promise.resolve(state.forecast) },
}));

const me = (): Me => ({
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
  member: { id: ID(92), displayName: 'Uta', role: 'user', effectiveRole: 'user' },
  isSuperUser: false,
  mfaRequired: false,
  memberships: [{ tenantKey: 'demo', tenantName: 'Demo', role: 'user' }],
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
      commentCount: 3,
    },
  ],
});

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

const wrap = (path = '/auswertung/projekte') =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <ProjectsPage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  state.me = me();
  state.calls = [];
  state.report = report();
  state.forecast = forecast();
});

describe('Auswertung – Projekte (AP-64)', () => {
  it('Zeitraum nach dem Tag in der Zeitzone des Mandanten, nur eine Abfrage (Mitternacht dort, nicht in UTC)', async () => {
    // 03.10.2026 22:30 UTC = 04.10. 00:30 in Berlin: erst mit geladenem Mandanten abfragen.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 3, 22, 30));
    try {
      wrap('/auswertung/projekte?zeitraum=90');
      expect(await screen.findByRole('article', { name: 'NGC 7000' })).toBeTruthy();
      expect(state.calls).toEqual([
        { from: '2026-07-07', to: '2026-10-04', status: '', rigId: '', type: '' },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Zeile je Projekt: Ersteller, Fortschritt je Filter, voraussichtlich fertig; Verlauf aufklappen; axe', async () => {
    wrap();
    const row = await screen.findByRole('article', { name: 'NGC 7000' });
    expect(within(row).getByRole('img', { name: 'Kommentare: 3' })).toBeTruthy();
    expect(await within(row).findByText('Uta')).toBeTruthy();
    const filters = within(row).getByRole('list', { name: 'Filter von NGC 7000' });
    expect(within(filters).getByRole('progressbar', { name: 'OIII: 36 von 40' })).toBeTruthy();
    expect(within(filters).getByText('8/40')).toBeTruthy();
    expect(await within(row).findByText('≈ 4 Nächte')).toBeTruthy();
    expect(
      within(row).getByText('realistisch bis 29./30.09. · optimistisch 2 Nächte'),
    ).toBeTruthy();
    const toggle = within(row).getByRole('button', { name: 'Verlauf' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(within(row).getByRole('button', { name: 'Zuklappen' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(
      within(row).getByRole('img', { name: /1 Nächte mit Aufnahmen, kumuliert 3,7 h/ }),
    ).toBeTruthy();
    expect(within(row).getByRole('link', { name: /12\.\/13\.09\./ })).toHaveAttribute(
      'href',
      `/auswertung/naechte/${ID(20)}`,
    );
    expect(within(row).getByText(/Kanalbalance: OIII 90 % – dagegen L 20 %/)).toBeTruthy();
    expect(within(row).getByText('an (Mindestabstand 60°)')).toBeTruthy();
    await expectNoSeriousA11y();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'active' } });
    fireEvent.change(screen.getByLabelText('Objekttyp'), { target: { value: 'deep_sky' } });
    await waitFor(() =>
      expect(state.calls.at(-1)).toMatchObject({ status: 'active', rigId: '', type: 'deep_sky' }),
    );
  });

  it('Saisonwarnung in Hinweisfarbe statt Schätzung', async () => {
    state.forecast = forecast({ seasonWarning: { achievablePct: 40, seasonEnd: '2026-10-05' } });
    wrap();
    const row = await screen.findByRole('article', { name: 'NGC 7000' });
    expect(await within(row).findByText('Saison endet in 9 Nächten')).toBeTruthy();
  });

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

  it('CSV exportieren und Drucken', async () => {
    const names: string[] = [];
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b);
      return 'blob:x';
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    wrap();
    const row = await screen.findByRole('article', { name: 'NGC 7000' });
    await within(row).findByText('Uta');
    fireEvent.click(screen.getByRole('button', { name: 'CSV exportieren' }));
    expect(names).toEqual(['projektbericht-2026-09-01-2026-09-26.csv']);
    const bytes = new Uint8Array(await (blobs[0] as Blob).arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes).split('\r\n')).toMatchInlineSnapshot(`
      [
        "section;project;projectCreator;rig;status;filter;night;planned;accepted;remaining;acquired;rejected;integrationH;cumulativeH",
        "total;NGC 7000;Uta;Rig A;active;OIII;;40;36;4;;;3;",
        "total;NGC 7000;Uta;Rig A;active;L;;40;8;32;;;0.67;",
        "night;NGC 7000;Uta;Rig A;active;OIII;2026-09-12;;16;;18;2;1.33;3",
        "night;NGC 7000;Uta;Rig A;active;L;2026-09-12;;8;;8;0;0.67;0.67",
        "",
      ]
    `);
    fireEvent.click(screen.getByRole('button', { name: 'Drucken' }));
    expect(print).toHaveBeenCalled();
    click.mockRestore();
    print.mockRestore();
  });
});
