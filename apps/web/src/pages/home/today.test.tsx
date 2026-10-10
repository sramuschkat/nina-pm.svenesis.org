// @vitest-environment jsdom
/**
 * AP-73: S-02 Startseite „Heute“ (vorher „Heute Nacht“, AP-35) – zuerst das Rig wählen (Standort), Nacht vom Server
 * (nicht aus dem Browserdatum), fünf Kennzahlen (Dämmerung nautisch/astronomisch, Safety-Link beim Wetter, Rig jetzt),
 * Zeitleiste mit Aufklappern darunter (Ereignisse offen, Zustand gemerkt), Plan mit „nur heute aus“, „Rig jetzt“ mit
 * letzter Aufnahme, „Zu tun“ (letzte Nacht, ungeprüft, Warteschlange, Exo-Transit, NINA-Abweichungen), aktive Projekte
 * mit Restzeit; künftige Nacht, Nacht ohne Prognose, „An NINA ausliefern“ aus; axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { Me, TonightView } from '../../api/client';
import { AuthProvider } from '../../auth';
import { TodayPage } from './TodayPage';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const state = vi.hoisted(() => ({
  me: null as unknown,
  view: null as unknown,
  run: vi.fn(),
  setLine: vi.fn(),
  nights: [] as (string | null)[],
  deliveryOff: false,
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
  projectsApi: {
    // Projektliste für die Kommentaranzahl im Plan (FA-PRJ-17) und „Aktive Projekte“.
    list: () =>
      Promise.resolve({
        items: [
          {
            id: ID(10),
            name: 'NGC 281',
            commentCount: 3,
            status: 'active',
            deletedAt: null,
            rigId: ID(1),
            createdBy: ID(3),
            createdByName: 'Uta',
            progress: { percentDone: 40, integrationS: 7_200, plannedS: 18_000 },
          },
        ],
      }),
    get: () => Promise.reject(new Error('nicht gebraucht')),
  },
  approvalApi: {
    queue: () =>
      Promise.resolve({
        items: [
          { id: ID(40), kind: 'project', votes: { mine: false, count: 1 }, createdBy: ID(41) },
          {
            id: ID(42),
            kind: 'transit',
            votes: { mine: false, count: 0 },
            createdBy: ID(41),
            transit: {
              planet: 'WASP-12 b',
              night: '2026-09-21',
              midUtc: '2026-09-22T05:00:00Z',
              deadlineUtc: '2026-09-21T17:00:00Z',
            },
          },
        ],
      }),
  },
  sessionsApi: {
    list: () =>
      Promise.resolve({
        items: [
          {
            id: ID(50),
            rigId: ID(1),
            rigName: 'Rig A',
            siteTimeZone: 'America/Chicago',
            night: '2026-09-17',
            status: 'completed',
            startedAt: '2026-09-18T01:00:00Z',
            endedAt: '2026-09-18T11:00:00Z',
            reviewed: false,
            integrationS: 18_000,
            efficiency: null,
            weather: null,
            projects: [],
          },
        ],
      }),
    unreviewed: () =>
      Promise.resolve({ unreviewed: 2, firstUnreviewed: { rigId: ID(1), night: '2026-09-16' } }),
    get: () =>
      Promise.resolve({ captures: [{ grade: 'flagged' }, { grade: 'ok' }, { grade: 'flagged' }] }),
  },
  tonightApi: {
    get: (_rigId?: string, night?: string) => {
      state.nights.push(night ?? null);
      if (!night) return Promise.resolve(state.view);
      const v = state.view as TonightView;
      return Promise.resolve({
        ...v,
        rigs: v.rigs.map((r) => ({ ...r, night, weather: null })),
      });
    },
    setLine: (...a: unknown[]) => state.setLine(...a) as Promise<unknown>,
  },
  forecastApi: {
    run: (...a: unknown[]) => state.run(...a) as Promise<unknown>,
    get: (rigId: string) =>
      Promise.resolve({
        rigId,
        rigName: 'Rig A',
        siteTimeZone: 'America/Chicago',
        computedAt: '2026-09-18T17:10:00Z',
        currentNight: '2026-09-18',
        nights: [],
        clearQuota: { rate: 0.5, source: 'default', recordedNights: 3 },
        projects: [
          {
            projectId: ID(10),
            name: 'NGC 281',
            createdBy: ID(3),
            priority: 1,
            status: 'active',
            need: [{ filter: 'Ha', frames: 30, hours: 2.5 }],
            needFrames: 30,
            needHours: 2.5,
            optimistic: { nights: 2, completesNight: '2026-09-19', extrapolated: false },
            realistic: { nights: 4, completesNight: '2026-09-21', extrapolated: false },
            candidates: [],
            seasonWarning: null,
            suggestions: [],
            lines: [],
          },
        ],
        resume: [],
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
      currentNight: '2026-09-18',
      calendar: Array.from({ length: 7 }, (_, i) => ({
        night: `2026-09-${String(18 + i)}`,
        darkHours: 9.5,
        moonlessDarkHours: 4 + i * 0.5,
        moonIllumPct: 48 + i * 7,
        waxing: true,
        ratingIndex: i < 5 ? 3 : null,
        nightMean: i < 5 ? 0.72 : null,
      })),
      nightWindow: { startUtc: '2026-09-19T00:00:00Z', endUtc: '2026-09-19T13:00:00Z' },
      dark: { fromUtc: '2026-09-19T01:10:00Z', toUtc: '2026-09-19T10:40:00Z' },
      darkHours: 9.5,
      twilight: {
        sun: { duskUtc: '2026-09-18T23:55:00Z', dawnUtc: '2026-09-19T11:55:00Z' },
        civil: { duskUtc: '2026-09-19T00:20:00Z', dawnUtc: '2026-09-19T11:30:00Z' },
        nautical: { duskUtc: '2026-09-19T00:45:00Z', dawnUtc: '2026-09-19T11:05:00Z' },
        astronomical: { duskUtc: '2026-09-19T01:10:00Z', dawnUtc: '2026-09-19T10:40:00Z' },
      },
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
          createdBy: ID(3),
          priority: 1,
          frames: 24,
          hours: 2.1,
          lines: [{ lineId: ID(11), filter: 'Ha', frames: 24, disabledTonight: false }],
        },
      ],
      idleProjects: 2,
      instances: [
        {
          id: ID(20),
          name: 'PC',
          lastSeenAt: '2026-09-18T17:55:00Z',
          state: 'waiting',
          mismatchCodes: ['optics_mismatch', 'af_time_trigger_missing'],
          profileSiteMismatch: false,
        },
      ],
      live: null,
      lastCapture: {
        captureId: ID(60),
        sessionId: ID(50),
        projectId: ID(10),
        projectName: 'NGC 281',
        filter: 'Ha',
        exposureS: 300,
        capturedAtUtc: '2026-09-18T11:09:00Z',
        hfr: 2.4,
        stars: 1512,
        grade: 'flagged',
        flags: [{ metric: 'stars', value: 1512, limit: 1640 }],
      },
    },
  ],
});

function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.search}</span>;
}

const wrap = (path = '/') =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <TodayPage />
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
  state.nights = [];
  window.localStorage.clear();
});

describe('S-02 Startseite „Heute“', () => {
  it('Kopf mit Einschätzung, Kennzahlen, Zeitleiste, Plan und Ereignisse, Details eingeklappt; axe', async () => {
    wrap();
    expect(await screen.findByRole('heading', { level: 1, name: 'Heute' })).toBeVisible();
    expect(await screen.findByRole('link', { name: 'Neues Projekt' })).toHaveAttribute(
      'href',
      '/projekte/neu',
    );
    const context = await screen.findByRole('region', { name: 'Rig und Nacht' });
    expect(within(context).getByRole('combobox', { name: 'Rig wählen' })).toHaveTextContent(
      'Rig A',
    );
    expect(context.textContent).toContain('Starfront · Nacht 18./19.09.');
    // Einschätzung: Wetterklasse der Nacht und Countdown (die Testnacht liegt in der Vergangenheit).
    expect(context.textContent).toContain('Gut 72 % · Dunkelheit vorbei');
    // Fünf Kennzahlen – Dunkel, Mond, Wetter, Plan, Rig jetzt stehen nur hier (Standortzeit CDT).
    const kpis = screen.getByRole('list', { name: 'Kennzahlen der Nacht' });
    const items = within(kpis)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(items[0]).toContain('9,5 h');
    expect(items[0]).toContain('astronomisch20:10');
    expect(items[0]).toContain('05:40');
    // Dämmerung nur nautisch und astronomisch (AP-73).
    expect(items[0]).toContain('nautisch');
    expect(items[0]).not.toContain('bürgerlich');
    expect(items[0]).not.toContain('Sonne');
    expect(items[1]).toContain('48 %');
    expect(items[1]).toContain('unter 00:00');
    expect(items[2]).toContain('Gut 72 %');
    expect(items[2]).toContain('bestes Fenster 21:00–03:00');
    // FA-STO-06: Safety- und Wetterseite der Sternwarte in der Kachel „Wetter“.
    expect(
      within(kpis).getByRole('link', { name: 'Safety- und Wetterseite der Sternwarte' }),
    ).toHaveProperty('href', 'https://example.org/safety');
    expect(items[3]).not.toContain('NINA zuletzt');
    expect(items[4]).toContain('Rig jetzt');
    expect(items[4]).toContain('NINA zuletzt 12:55 CDT');
    // Zeitleiste auf einer Achse: Himmel, Wetter, Mond, Plan, Ereignisse.
    const timeline = screen.getByRole('group', { name: 'Zeitleiste der Nacht' });
    for (const lane of ['Himmel', 'Wetter', 'Mond', 'Plan', 'Ereignisse'])
      expect(within(timeline).getByText(lane)).toBeTruthy();
    expect(timeline.textContent).toMatch(/Standortzeit \(CDT\)/);
    // Plan: Projekte aus der Prognose; keine doppelten Angaben.
    const card = (
      await screen.findByRole('heading', { level: 2, name: 'Plan für diese Nacht' })
    ).closest('section') as HTMLElement;
    // Kommentare am Projekt (FA-PRJ-17): Sprechblase neben dem Namen.
    expect(await within(card).findByRole('img', { name: 'Kommentare: 3' })).toBeInTheDocument();
    for (const gone of [
      'Dunkelheit',
      'beleuchtet',
      'Gut 72 %',
      'bestes Fenster',
      'zuletzt gesehen',
    ])
      expect(card.textContent).not.toContain(gone);
    const table = within(card).getByRole('table', { name: 'Geplante Projekte am Rig Rig A' });
    expect(within(table).getByRole('columnheader', { name: 'Ersteller' })).toBeTruthy();
    const row = within(table).getByRole('row', { name: /NGC 281/ });
    expect(row.textContent).toContain('24');
    expect(row.textContent).toContain('2,1 h');
    expect(card.textContent).toContain('2 weitere aktive Projekte ohne Frames in dieser Nacht.');
    // Reihenfolge: Kennzahlen → Zeitleiste → Aufklapper → Plan.
    expect(kpis.compareDocumentPosition(timeline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Kein eigenes Kurzfenster „Mond & Planeten“ mehr; die Sichtbarkeit steht eingeklappt unter der Zeitleiste.
    expect(screen.queryByRole('heading', { level: 2, name: 'Mond & Planeten' })).toBeNull();
    const weatherFold = screen.getByRole('button', { name: /Nachtwetter im Detail/ });
    const bodiesFold = screen.getByRole('button', { name: /Mond und Planeten – Sichtbarkeit/ });
    expect(weatherFold).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /Ereignisse der Nacht/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(
      timeline.compareDocumentPosition(weatherFold) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      weatherFold.compareDocumentPosition(bodiesFold) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      bodiesFold.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // „Ereignisse der Nacht“ anfangs offen unter der Zeitleiste.
    const events = await screen.findByRole('region', { name: 'Ereignisse der Nacht' });
    expect(events.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await within(events).findByText(/Satellitenbahnen Stand 15\.09\.2026/)).toBeTruthy();
    // 18./19.09.: noch kein großer Strom aktiv (Südliche Tauriden ab λ☉ 177°) – Gruppe entfällt.
    expect(within(events).queryByText('Meteorströme')).toBeNull();
    expect(within(events).getByText('Die nächsten Finsternisse am Standort')).toBeTruthy();
    expect(
      within(events).getByText(/Halbschatten-Mondfinsternis · Sa\., 20\.02\.2027, 17:13 CST/),
    ).toBeTruthy();
    // Eingeklappt: Nacht im Detail und Sichtbarkeit von Mond & Planeten – Inhalt erst beim Aufklappen.
    expect(screen.queryByText('noch keine Vorhersage für diese Nacht')).toBeNull();
    fireEvent.click(weatherFold);
    expect(await screen.findByText('noch keine Vorhersage für diese Nacht')).toBeTruthy();
    fireEvent.click(bodiesFold);
    expect(
      await screen.findByRole('img', { name: /Sichtbarkeit von Mond und Planeten.*Zeiten in CDT/ }),
    ).toBeTruthy();
    // Zustand der Aufklapper je Gerät gemerkt.
    expect(JSON.parse(window.localStorage.getItem('npm.today.folds') ?? '[]')).toEqual([
      'events',
      'weather',
      'bodies',
    ]);
    await expectNoSeriousA11y();
    // Unter Last (voller Testlauf, 01.10.2026) 5,3 s – wie der Nachbar-Test 20 s.
  }, 20_000);

  it('Nachtwahl (Mondkalender, 7 Nächte): künftige Nacht mit Hinweis, Dunkelzeitraum, ohne NINA und Umschalter', async () => {
    wrap();
    const cal = await screen.findByRole('navigation', {
      name: 'Nacht wählen (Mondkalender, 7 Nächte)',
    });
    const nights = within(cal).getAllByRole('button');
    expect(nights).toHaveLength(7);
    expect(nights[0]).toHaveAttribute('aria-pressed', 'true');
    expect(nights[0]).toHaveTextContent('Heute Nacht');
    expect(nights[6]).toHaveTextContent('keine Vorhersage');
    fireEvent.click(nights[2] as HTMLElement);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('nacht=2026-09-20'));
    await waitFor(() => expect(state.nights).toContain('2026-09-20'));
    expect(
      await screen.findByText(
        /Vorschau: So sähe der Plan aus, wenn bis dahin nichts mehr passiert/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('NINA-Status nur für die laufende Nacht')).toBeInTheDocument();
    expect(screen.getByText(/dunkel \d\d:\d\d–\d\d:\d\d CDT/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /nur heute aus|heute aus/i })).toBeNull();
    // zurück zur laufenden Nacht: Parameter entfällt
    fireEvent.click(within(cal).getAllByRole('button')[0] as HTMLElement);
    await waitFor(() => expect(screen.getByTestId('where')).not.toHaveTextContent('nacht='));
    // Lokal ≈ 1 s (Mondphasen für 7 Nächte, zweite Prognose); im CI-Shard unter Last 5,3 s (30.09.2026) – daher 20 s.
  }, 20_000);

  it('Rig aus der URL: anderes Rig zeigt dessen Standort', async () => {
    const v = view();
    const a = v.rigs[0];
    if (a)
      v.rigs.push({ ...a, rigId: ID(4), rigName: 'Rig B', siteId: ID(3), siteName: 'Hannover' });
    state.view = v;
    wrap(`/?rig=${ID(4)}`);
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

  it('Rig jetzt: letzte Aufnahme mit ⚠-Link aufs Bild; Zu tun: letzte Nacht, ungeprüft, Warteschlange, Exo, NINA', async () => {
    wrap();
    const live = await screen.findByRole('region', { name: 'Rig jetzt' });
    expect(live.textContent).toContain('Letzte Aufnahme');
    expect(live.textContent).toContain('06:09 CDT');
    expect(live.textContent).toContain('NGC 281 · Ha 300 s');
    expect(live.textContent).toContain('HFR 2,4');
    expect(within(live).getByRole('link', { name: /markiert: Sterne/ })).toHaveAttribute(
      'href',
      `/projekte/${ID(10)}?reiter=bilder&bild=${ID(60)}`,
    );
    expect(within(live).getByRole('link', { name: 'Rig-Zustand' })).toHaveAttribute(
      'href',
      `/rig-zustand?rig=${ID(1)}`,
    );
    const todo = (await screen.findByRole('heading', { level: 2, name: 'Zu tun' })).closest(
      'section',
    ) as HTMLElement;
    expect(
      await within(todo).findByRole('link', { name: /Letzte Nacht · Do 17\.\/18\.09\./ }),
    ).toBeTruthy();
    expect(await within(todo).findByRole('link', { name: '⚠ Bilder markiert: 2' })).toBeTruthy();
    expect(within(todo).getByRole('link', { name: /Ungeprüfte Nächte: 2/ })).toHaveAttribute(
      'href',
      `/auswertung/naechte/${ID(1)}/2026-09-16`,
    );
    expect(
      within(todo).getByRole('link', { name: /Warteschlange: 1 offen, 1 ohne deine Stimme/ }),
    ).toBeTruthy();
    expect(
      within(todo).getByRole('link', { name: /Exoplanet-Transits zu bestätigen: 1/ }),
    ).toBeTruthy();
    expect(
      within(todo).getByRole('link', { name: /NINA-Einstellungen weichen ab: 2/ }),
    ).toHaveAttribute('href', '/nina/instanzen');
    // Plan links, „Rig jetzt“ und „Zu tun“ rechts daneben (DOM-Reihenfolge).
    const plan = screen.getByRole('heading', { level: 2, name: 'Plan für diese Nacht' });
    expect(plan.compareDocumentPosition(live) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(live.compareDocumentPosition(todo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }, 20_000);

  it('Aktive Projekte: eingeklappt, aufgeklappt mit Fortschritt und Restzeit; Zustand gemerkt', async () => {
    wrap();
    const toggle = await screen.findByRole('button', { name: /Aktive Projekte/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('table', { name: 'Aktive Projekte' })).toBeNull();
    fireEvent.click(toggle);
    const table = await screen.findByRole('table', { name: 'Aktive Projekte' });
    const row = within(table).getByRole('row', { name: /NGC 281/ });
    expect(row.textContent).toContain('40 %');
    expect(row.textContent).toContain('2,0 / 5,0 h');
    expect(await within(row).findByText('≈ 4 Nächte')).toBeTruthy();
    expect(row.textContent).toContain('optimistisch 2');
    expect(window.localStorage.getItem('npm.today.projects')).toBe('1');
  });
});
