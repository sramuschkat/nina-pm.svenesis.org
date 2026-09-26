// @vitest-environment jsdom
/**
 * Startseite als Übersicht (AP-26c, AP-26d): Kopf mit Mandant und Datum in Mandantenzeit, *Neues Projekt*
 * nur mit Recht; Kennzahlen (aktive Projekte, Warteschlange, Integration im Monat, nächste gute Nacht);
 * Karten Warteschlange (Stimme wie S-33, eigenes gesperrt), Wetter heute Nacht (Farbband der kommenden
 * Nacht, bestes Fenster in Standortzeit), Aktive Projekte je Rig als Tabelle, Letzte Sessions; Leer- und
 * Fehlerzustände; System-Kontext unverändert; axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type {
  Me,
  NightSession,
  ProjectListItem,
  QueueItem,
  SiteView,
  WeatherView,
} from '../../api/client';
import { AuthProvider } from '../../auth';
import { HomePage, monthIntegration, nextGoodNight, tonight } from './HomePage';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ME = ID(3);

const state = vi.hoisted(() => ({
  me: null as unknown,
  queue: [] as unknown[],
  queueError: false,
  projects: [] as unknown[],
  sessions: [] as unknown[],
  sites: [] as unknown[],
  weather: null as unknown,
  denied: new Set<string>(),
  vote: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  api: { me: () => Promise.resolve(state.me) },
  approvalApi: {
    queue: () =>
      state.queueError
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({ items: state.queue }),
    vote: (...a: unknown[]) => state.vote(...a) as Promise<unknown>,
  },
  projectsApi: { list: () => Promise.resolve({ items: state.projects }) },
  sessionsApi: { list: () => Promise.resolve({ items: state.sessions }) },
  equipmentApi: {
    list: (kind: string) =>
      Promise.resolve({
        items:
          kind === 'rigs'
            ? [
                { id: ID(500), name: 'Rig A', siteId: ID(600) },
                { id: ID(501), name: 'Rig B', siteId: ID(600) },
              ]
            : kind === 'sites'
              ? state.sites
              : [],
      }),
    weather: () => Promise.resolve(state.weather),
  },
}));

vi.mock('../../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth')>();
  return {
    ...actual,
    useCan: (action: Parameters<typeof actual.useCan>[0]) =>
      actual.useCan(action) && !state.denied.has(action),
  };
});

const me = (context: 'tenant' | 'system' = 'tenant'): Me => ({
  identity: {
    id: ID(1),
    discordUserId: '1',
    username: 'u',
    globalName: 'Uta',
    avatarHash: null,
    mfa: true,
  },
  context,
  tenant:
    context === 'tenant'
      ? { id: ID(2), key: 'demo', name: 'Demo', timeZone: 'Europe/Berlin' }
      : null,
  member:
    context === 'tenant'
      ? { id: ME, displayName: 'Uta', role: 'owner', effectiveRole: 'admin' }
      : null,
  isSuperUser: context === 'system',
  mfaRequired: false,
  memberships: [{ tenantKey: 'demo', tenantName: 'Demo', role: 'owner' }],
});

const queueItem = (n: number, over: Partial<QueueItem> = {}): QueueItem =>
  ({
    kind: 'project',
    id: ID(100 + n),
    projectId: ID(100 + n),
    name: `Objekt ${String(n)}`,
    createdBy: ID(9),
    createdByName: 'Zoe',
    votes: { count: 0, voters: [], mine: false, mineChangedSince: false },
    effort: null,
    ...over,
  }) as unknown as QueueItem;

const project = (n: number, over: Partial<ProjectListItem> = {}): ProjectListItem =>
  ({
    id: ID(200 + n),
    name: `Projekt ${String(n)}`,
    rigId: ID(500),
    status: 'active',
    approvalStatus: 'approved',
    priority: n,
    deletedAt: null,
    effort: null,
    effortStale: false,
    progress: {
      targetReached: false,
      finished: false,
      planningNeed: 0,
      percentDone: 15,
      plannedS: 36_000,
      integrationS: 5_400,
    },
    ...over,
  }) as unknown as ProjectListItem;

const session = (n: number, over: Partial<NightSession> = {}): NightSession => ({
  id: ID(300 + n),
  rigId: ID(500),
  rigName: 'Rig A',
  siteTimeZone: 'America/Chicago',
  night: `2026-09-${String(10 + n)}`,
  status: 'completed',
  startedAt: `2026-09-${String(11 + n)}T02:00:00Z`,
  endedAt: `2026-09-${String(11 + n)}T09:00:00Z`,
  sessionEndUtc: null,
  createdOffline: false,
  reviewed: false,
  ninaInstanceName: null,
  frames: 10,
  bonusFrames: 0,
  integrationS: 7_200,
  unassigned: 0,
  ...over,
});

const SITE = {
  id: ID(600),
  name: 'Starfront',
  latitudeDeg: 31.5471,
  longitudeDeg: -99.3823,
  timeZone: 'America/Chicago',
} as unknown as SiteView;

const hour = (tUtc: string, score: number | null, sunAltDeg: number) => ({
  tUtc,
  overallScore: score,
  ratingIndex: score === null ? null : 3,
  sunAltDeg,
});

const weatherView = (): WeatherView =>
  ({
    siteId: ID(600),
    timeZone: 'America/Chicago',
    status: 'ready',
    hours: [
      hour('2026-09-24T22:00:00Z', null, -5),
      hour('2026-09-25T00:00:00Z', 0.5, -14),
      hour('2026-09-25T01:00:00Z', 0.8, -20),
      hour('2026-09-25T02:00:00Z', 0.9, -25),
      hour('2026-09-25T13:00:00Z', 0.9, 10),
    ],
    nights: [
      {
        night: '2026-09-24',
        darkFromUtc: '2026-09-25T01:05:00Z',
        darkToUtc: '2026-09-25T10:05:00Z',
        nightMean: 0.78,
        ratingIndex: 3,
        coveredSec: 6900,
        darknessSec: 32400,
        coverage: 0.9,
        moonlessSec: 6900,
        bestWindow: {
          fromUtc: '2026-09-25T01:05:00Z',
          toUtc: '2026-09-25T03:00:00Z',
          sec: 6900,
          moonFreeSec: 6900,
          meanScore: 0.8,
          fair: false,
        },
        aerosolMissing: false,
        seeingIncomplete: false,
        moonIllumPct: 40,
        moonEvents: [],
      },
    ],
    nightWindows: [
      { night: '2026-09-24', startUtc: '2026-09-24T23:00:00Z', endUtc: '2026-09-25T12:10:00Z' },
    ],
    darkWindows: [],
  }) as unknown as WeatherView;

const renderPage = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <AuthProvider>
          <HomePage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const card = (name: string) => screen.findByRole('region', { name });

beforeEach(() => {
  // Nur `Date` fälschen: 24.09.2026 20:00 UTC = 22:00 MESZ (Mandant) = 15:00 CDT (Standort).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.UTC(2026, 8, 24, 20, 0));
  state.me = me();
  state.queue = [];
  state.queueError = false;
  state.projects = [];
  state.sessions = [];
  state.sites = [];
  state.weather = weatherView();
  state.denied = new Set();
  state.vote.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Modell', () => {
  it('tonight: erstes nicht vergangenes Nachtfenster, nur dessen Stunden, Farbe nach Sonnenhöhe', () => {
    const data = tonight(weatherView(), Date.UTC(2026, 8, 24, 20, 0));
    expect(data?.window.night).toBe('2026-09-24');
    expect(data?.night?.nightMean).toBe(0.78);
    expect(data?.cells.map((c) => c.tUtc)).toEqual([
      '2026-09-25T00:00:00Z',
      '2026-09-25T01:00:00Z',
      '2026-09-25T02:00:00Z',
    ]);
    // Nach dem Ende der letzten Nacht: das erste Fenster bleibt Bezug (wie WeatherChart).
    expect(tonight(weatherView(), Date.UTC(2026, 8, 26))?.window.night).toBe('2026-09-24');
    expect(tonight({ ...weatherView(), nightWindows: [] }, Date.UTC(2026, 8, 24))).toBeNull();
  });

  it('monthIntegration: Summe und Nächte mit Aufnahmen im Monat', () => {
    const sessions = [
      session(1, { night: '2026-09-01', integrationS: 3_600 }),
      session(2, { night: '2026-09-01', integrationS: 1_800 }),
      session(3, { night: '2026-09-05', integrationS: 0 }),
      session(4, { night: '2026-08-31', integrationS: 7_200 }),
    ];
    expect(monthIntegration(sessions, '2026-09')).toEqual({ seconds: 5_400, nights: 1 });
    expect(monthIntegration([], '2026-09')).toEqual({ seconds: 0, nights: 0 });
  });

  it('nextGoodNight: erste Nacht mit Dunkelheit und mindestens „Gut“, früheste über alle Standorte', () => {
    const now = Date.UTC(2026, 8, 24, 20, 0);
    const view = weatherView();
    const [night] = view.nights;
    if (!night) throw new Error('Testdaten');
    const poor = { ...night, night: '2026-09-24', ratingIndex: 2 };
    const later = { ...night, night: '2026-09-26', ratingIndex: 4 };
    const other = { ...SITE, id: ID(601), name: 'Remote' };
    expect(nextGoodNight([{ site: SITE, view }], now)?.night.night).toBe('2026-09-24');
    const best = nextGoodNight(
      [
        { site: SITE, view: { ...view, nights: [poor, later] } },
        { site: other, view: { ...view, nights: [{ ...night, night: '2026-09-25' }] } },
      ],
      now,
    );
    expect(best?.site.name).toBe('Remote');
    expect(best?.night.night).toBe('2026-09-25');
    expect(
      nextGoodNight(
        [{ site: SITE, view: { ...view, nights: [{ ...night, darkFromUtc: null }] } }],
        now,
      ),
    ).toBeNull();
    expect(nextGoodNight([{ site: SITE, view: undefined }], now)).toBeNull();
  });
});

describe('Startseite (Mandant)', () => {
  it('Kopf, alle Karten mit Daten, Stimme abgeben, eigenes gesperrt; axe', async () => {
    state.queue = [
      queueItem(1, { effort: null }),
      queueItem(2, { createdBy: ME, createdByName: 'Uta', name: 'Meins' }),
      queueItem(3, { votes: { count: 1, voters: [], mine: true, mineChangedSince: false } }),
    ];
    state.projects = [
      project(1),
      project(2, { status: 'planning', name: 'In Planung' }),
      project(3, { rigId: ID(501), name: 'Projekt B' }),
    ];
    state.sessions = [1, 2, 3, 4, 5, 6].map((n) => session(n));
    state.sites = [SITE];
    state.vote.mockResolvedValue({});
    renderPage();

    expect(await screen.findByRole('heading', { level: 1, name: 'Übersicht' })).toBeVisible();
    expect(screen.getByText('Demo · Donnerstag, 24. September 2026')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Neues Projekt' })).toHaveAttribute(
      'href',
      '/projekte/neu',
    );

    // Kennzahlen: aktive Projekte, Warteschlange, Integration im Monat, nächste gute Nacht
    const kpis = screen.getByRole('list', { name: 'Kennzahlen' });
    const tile = (label: string) =>
      within(kpis)
        .getAllByRole('listitem')
        .find((li) => li.textContent?.startsWith(label));
    await waitFor(() =>
      expect(tile('Aktive Projekte')).toHaveTextContent('Aktive Projekte2auf 2 Rigs'),
    );
    await waitFor(() =>
      expect(tile('Warteschlange')).toHaveTextContent('Warteschlange3 offen1 ohne deine Stimme'),
    );
    await waitFor(() =>
      expect(tile('Integration September')).toHaveTextContent('12,0 h6 Nächte mit Aufnahmen'),
    );
    await waitFor(() =>
      expect(tile('Nächste gute Nacht')).toHaveTextContent('24./25.09.Starfront · Gut 78 %'),
    );

    // Warteschlange
    const queue = await card('Warteschlange');
    expect(within(queue).getByRole('link', { name: 'Objekt 1' })).toHaveAttribute(
      'href',
      `/projekte/${ID(101)}`,
    );
    expect(within(queue).getAllByText('von Zoe')).toHaveLength(2);
    expect(
      within(queue).getByRole('button', { name: 'Eigenes Objekt „Meins“ – keine Stimme möglich' }),
    ).toBeDisabled();
    expect(within(queue).getByRole('button', { name: 'Für „Objekt 3“ stimmen' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(queue).getByRole('button', { name: 'Für „Objekt 1“ stimmen' }));
    await waitFor(() => expect(state.vote).toHaveBeenCalledWith(ID(101), true));
    expect(within(queue).getByRole('link', { name: 'Zur Warteschlange' })).toHaveAttribute(
      'href',
      '/projekte/warteschlange',
    );

    // Wetter heute Nacht: Farbband der Nacht 24./25.09. in Standortzeit
    const weather = await card('Wetter heute Nacht');
    expect(
      await within(weather).findByRole('img', {
        name: 'Stündliche Bewertung der Nacht 24./25.09. in Starfront',
      }),
    ).toBeInTheDocument();
    expect(within(weather).getByText('24./25.09. · Gut 78 %')).toBeInTheDocument();
    expect(within(weather).getByText('Bestes Fenster 20:05–22:00 CDT · 1,9 h')).toBeInTheDocument();
    expect(within(weather).getByText('18:00 CDT')).toBeInTheDocument();
    expect(within(weather).getByTitle('20:00 CDT · Gut 80 %')).toBeInTheDocument();
    expect(within(weather).getByRole('link', { name: 'Starfront' })).toHaveAttribute(
      'href',
      `/wetter?standort=${ID(600)}`,
    );
    expect(within(weather).getByRole('link', { name: 'Zum Wetter' })).toHaveAttribute(
      'href',
      '/wetter',
    );

    // Aktive Projekte je Rig: eine Tabelle, Rig als Gruppenzeile
    const projects = await card('Aktive Projekte');
    expect(
      await within(projects).findByRole('columnheader', { name: 'Rig A' }),
    ).toBeInTheDocument();
    expect(within(projects).getByRole('columnheader', { name: 'Rig B' })).toBeInTheDocument();
    expect(within(projects).getAllByRole('table')).toHaveLength(1);
    expect(within(projects).getByRole('link', { name: 'Projekt 1' })).toHaveAttribute(
      'href',
      `/projekte/${ID(201)}`,
    );
    expect(within(projects).queryByText('In Planung')).toBeNull();
    expect(within(projects).getAllByText('1,5 / 10,0 h')).toHaveLength(2);
    expect(within(projects).getAllByText('15 %')).toHaveLength(2);
    expect(within(projects).getByRole('link', { name: 'Zur Projektliste' })).toHaveAttribute(
      'href',
      '/projekte',
    );

    // Letzte Sessions: neueste zuerst, höchstens fünf
    const sessions = await card('Letzte Sessions');
    const table = await within(sessions).findByRole('table', { name: 'Letzte Sessions' });
    const nights = within(table)
      .getAllByRole('link')
      .map((a) => a.textContent);
    expect(nights).toEqual(['16./17.09.', '15./16.09.', '14./15.09.', '13./14.09.', '12./13.09.']);
    expect(within(table).getAllByText('2.0 h')).toHaveLength(5);
    expect(within(sessions).getByRole('link', { name: 'Alle Sessions' })).toHaveAttribute(
      'href',
      '/auswertung/sessions',
    );

    await expectNoSeriousA11y();
  });

  it('Leerzustände je Karte', async () => {
    renderPage();
    expect(
      await within(await card('Warteschlange')).findByText('Keine offenen Einreichungen.'),
    ).toBeInTheDocument();
    expect(
      await within(await card('Wetter heute Nacht')).findByText('Noch kein Standort angelegt.'),
    ).toBeInTheDocument();
    expect(
      await within(await card('Aktive Projekte')).findByText('Keine aktiven Projekte.'),
    ).toBeInTheDocument();
    expect(
      await within(await card('Letzte Sessions')).findByText('Noch keine Sessions.'),
    ).toBeInTheDocument();
    // Kennzahlen ohne Daten: Nullwerte, keine gute Nacht in Sicht.
    const kpis = screen.getByRole('list', { name: 'Kennzahlen' });
    await waitFor(() => expect(kpis).toHaveTextContent('kein Projekt in Arbeit'));
    await waitFor(() => expect(kpis).toHaveTextContent('Nächste gute Nachtkeine in Sicht'));
    expect(kpis).toHaveTextContent('0,0 h0 Nächte mit Aufnahmen');
    await expectNoSeriousA11y();
  });

  it('Fehler einer Karte mit Erneut versuchen; Wetter noch nicht abgerufen', async () => {
    state.queueError = true;
    state.sites = [SITE];
    state.weather = { ...weatherView(), status: 'pending', hours: [], nights: [] };
    renderPage();
    const queue = await screen.findByRole('region', { name: 'Warteschlange' });
    expect(await within(queue).findByRole('alert')).toBeInTheDocument();
    expect(within(queue).getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument();
    expect(
      await within(await card('Wetter heute Nacht')).findByText(/noch keine Vorhersage vor/),
    ).toBeInTheDocument();
  });

  it('Ohne Rechte keine Hauptaktion und keine Karten der Zielseiten', async () => {
    state.denied = new Set(['project.create', 'queue.read', 'session.read']);
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Übersicht' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Neues Projekt' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Warteschlange' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Letzte Sessions' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Aktive Projekte' })).toBeInTheDocument();
    // Kennzahlen nur mit dem Recht der Zielseite.
    const kpis = screen.getByRole('list', { name: 'Kennzahlen' });
    expect(within(kpis).getAllByRole('listitem')).toHaveLength(2);
    expect(kpis).not.toHaveTextContent('Warteschlange');
    expect(kpis).not.toHaveTextContent('Integration');
  });
});

describe('Startseite (System-Kontext)', () => {
  it('bleibt der Hinweis zur Verwaltung, keine Karten', async () => {
    state.me = me('system');
    renderPage();
    expect(await screen.findByRole('heading', { name: 'System-Kontext' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'Willkommen bei NINA-PM' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Übersicht' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Warteschlange' })).toBeNull();
    await expectNoSeriousA11y();
  });
});
