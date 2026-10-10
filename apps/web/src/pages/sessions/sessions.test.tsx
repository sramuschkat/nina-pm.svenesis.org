// @vitest-environment jsdom
/**
 * AP-64/AP-77 (vorher AP-15/AP-31): Auswertung – Nächte (S-60: Kennzahlen, Karten mit Effizienz, Projekt-Chips mit
 * Ersteller, nicht zugeordnete Aufnahmen, Filter in der Adresse, seitenweise) und Nacht (S-61 ohne Reiter und ohne
 * Prüfen: Session-Qualität, Hinweise mit Zuordnen, Kennzahlen, Bedingungen, Ergebnis je Projekt mit Qualitätsleiste,
 * Details mit Qualität je Filter und Soll/Ist, Qualitätskurve, Ereignisse eingeklappt, CSV; Rechte Admin/User); axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { Me, NightSessionDetail, NightSessionListItem } from '../../api/client';
import { AuthProvider } from '../../auth';
import { NightPage } from './NightPage';
import { NightsPage } from './NightsPage';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const state = vi.hoisted(() => ({
  me: null as unknown,
  pages: [] as { items: unknown[]; nextCursor: string | null }[],
  detail: null as unknown,
  details: [] as unknown[],
  night: [] as unknown[],
  listCalls: [] as Record<string, unknown>[],
  summaryCalls: [] as unknown[],
  gaps: null as unknown,
  assign: vi.fn(),
  reject: vi.fn(),
}));

vi.mock('./night-actual', () => ({
  useNightActual: () => ({
    chart: null,
    gaps: state.gaps,
    isPending: false,
    isError: false,
  }),
}));

vi.mock('../../api/client', () => ({
  api: { me: () => Promise.resolve(state.me) },
  memberApi: {
    directory: () =>
      Promise.resolve({
        items: [
          { id: ID(3), displayName: 'Maximilian Mustermann', avatarUrl: null, status: 'active' },
          { id: ID(92), displayName: 'Uta', avatarUrl: null, status: 'active' },
        ],
      }),
  },
  equipmentApi: {
    list: (kind: string) =>
      Promise.resolve({
        items:
          kind === 'rigs'
            ? [{ id: ID(500), name: 'Rig A', siteId: ID(600) }]
            : kind === 'filters'
              ? [{ id: ID(700), shortName: 'Ha', colorHex: '#b71c1c' }]
              : kind === 'sites'
                ? [{ id: ID(600), name: 'Starfront', timeZone: 'America/Chicago' }]
                : [],
      }),
  },
  sessionsApi: {
    list: (q: Record<string, unknown>) => {
      // Nacht-Seite: Sessions einer Nacht (rigId, from = to = Nacht).
      if (q.from && q.from === q.to && q.limit === 50)
        return Promise.resolve({ items: state.night, nextCursor: null });
      state.listCalls.push(q);
      const page = q.cursor ? state.pages[1] : state.pages[0];
      return Promise.resolve(page ?? { items: [], nextCursor: null });
    },
    summary: (q: unknown) => {
      state.summaryCalls.push(q);
      return Promise.resolve({
        nights: 12,
        usableNights: 9,
        integrationS: 148_680,
        lights: 1284,
        projects: 4,
        efficiencyPct: 81,
      });
    },
    get: (id: string) =>
      Promise.resolve(
        (state.details as { session: { id: string } }[]).find((d) => d.session.id === id) ??
          state.detail,
      ),
    assign: (...a: unknown[]) => state.assign(...a) as Promise<unknown>,
    reject: (...a: unknown[]) => state.reject(...a) as Promise<unknown>,
  },
  sessionLogApi: {
    clearNights: () =>
      Promise.resolve({
        siteId: ID(600),
        siteName: 'Starfront',
        timeZone: 'America/Chicago',
        from: '2026-08-19',
        to: '2026-09-17',
        months: [],
        nights: [
          {
            night: '2026-09-15',
            source: 'manual',
            usable: false,
            usableHours: 0,
            sessionIds: [],
            forecastRatingIndex: null,
            forecastNightMean: null,
            seeingArcsec: null,
            sqm: null,
            transparencyPct: null,
            forecastTransparencyPct: null,
            rejectedPct: null,
          },
        ],
        accuracy: { hits: 0, compared: 0, hitPct: null },
      }),
  },
  discordApi: { resendReport: vi.fn() },
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

const session = (over: Partial<NightSessionListItem> = {}): NightSessionListItem => ({
  id: ID(1),
  rigId: ID(500),
  rigName: 'Rig A',
  siteTimeZone: 'America/Chicago',
  night: '2026-09-17',
  status: 'completed',
  startedAt: '2026-09-18T02:09:00Z',
  endedAt: '2026-09-18T09:14:00Z',
  sessionEndUtc: '2026-09-18T13:00:00Z',
  createdOffline: false,
  ninaInstanceName: 'Beobachtungs-PC',
  frames: 16,
  bonusFrames: 0,
  integrationS: 4800,
  unassigned: 1,
  efficiency: { exposureS: 29_520, usableDarkS: 34_560, pct: 85.4 },
  weather: { ratingIndex: 3, nightMean: 0.89 },
  quality: {
    good: 140,
    flagged: 5,
    rejected: 0,
    none: 0,
    sharePct: 96.6,
    reasons: { hfr: 1, stars: 4, rms: 0, cloud: 0 },
  },
  projects: [
    {
      projectId: ID(10),
      projectName: 'NGC 281',
      createdBy: ID(3),
      transit: false,
      frames: 16,
      filters: [{ filter: 'Ha', frames: 16 }],
    },
    {
      projectId: ID(11),
      projectName: 'WASP-3b',
      createdBy: ID(92),
      transit: true,
      frames: 558,
      filters: [{ filter: 'RED', frames: 558 }],
    },
  ],
  ...over,
});

const detail = (): NightSessionDetail => ({
  session: {
    ...session(),
    planRevision: 2,
    darknessEndUtc: '2026-09-18T11:30:00Z',
  },
  rows: [
    {
      projectId: ID(10),
      projectName: 'NGC 281',
      projectCreatedBy: ID(92),
      canCorrect: true,
      exposureLineId: ID(20),
      filterShortName: 'Ha',
      exposureS: 300,
      planned: 17,
      plannedSeries: null,
      plannedLater: false,
      acquired: 16,
      rejected: 1,
      accepted: 15,
      bonus: 0,
      bonusRejected: 0,
      integrationS: 4500,
      night: { acquired: 16, rejected: 1, rejectedIndividual: 1, rejectedCorrection: 0 },
    },
  ],
  captures: [
    {
      id: ID(30),
      capturedAt: '2026-09-18T02:34:00Z',
      frameType: 'light',
      projectId: ID(10),
      projectName: 'NGC 281',
      projectCreatedBy: ID(3),
      exposureLineId: ID(20),
      assignment: 'assigned',
      filterShortName: 'Ha',
      filterActual: 'Ha 3nm',
      exposureS: 330,
      gain: 100,
      offset: 20,
      binning: 1,
      result: 'saved',
      isBonus: false,
      temperatureDeviation: true,
      settingsDeviation: true,
      rejected: false,
      rejectReason: null,
      fileName: 'a.fits',
      hfr: 2.134,
      stars: 412,
      quality: { rmsArcsec: 0.6, cloudCoverPct: 2 },
      grade: 'ok',
      flags: [],
    },
    {
      id: ID(31),
      capturedAt: '2026-09-18T02:40:00Z',
      frameType: 'light',
      projectId: null,
      projectName: null,
      projectCreatedBy: null,
      exposureLineId: null,
      assignment: 'unassigned',
      filterShortName: 'Ha',
      filterActual: null,
      exposureS: 300,
      gain: null,
      offset: null,
      binning: 1,
      result: 'saved',
      isBonus: false,
      temperatureDeviation: false,
      settingsDeviation: false,
      rejected: false,
      rejectReason: null,
      fileName: 'b.fits',
      hfr: null,
      stars: null,
    },
    {
      id: ID(32),
      capturedAt: '2026-09-18T10:40:00Z',
      frameType: 'flat',
      projectId: null,
      projectName: null,
      projectCreatedBy: null,
      exposureLineId: null,
      assignment: 'assigned',
      filterShortName: 'Ha',
      filterActual: null,
      exposureS: 2.4,
      gain: null,
      offset: null,
      binning: 1,
      result: 'saved',
      isBonus: false,
      temperatureDeviation: false,
      settingsDeviation: false,
      rejected: false,
      rejectReason: null,
      fileName: null,
      hfr: null,
      stars: null,
    },
  ],
  capturesTruncated: false,
  events: [
    { id: ID(40), occurredAt: '2026-09-18T04:33:00Z', kind: 'flip', message: null, durationS: 180 },
    {
      id: ID(41),
      occurredAt: '2026-09-18T05:00:00Z',
      kind: 'af',
      message: 'HFR 2,1',
      durationS: 90,
    },
  ],
  flats: [
    {
      filterShortName: 'Ha',
      rotatorMechDeg: 270.4,
      binning: 1,
      status: 'done',
      flatsPlanned: 20,
      flatsTaken: 20,
      darkFlatsPlanned: 10,
      darkFlatsTaken: 9,
      flatExposureS: 2.4,
    },
  ],
  kpis: {
    darkFromUtc: '2026-09-18T01:30:00Z',
    darkToUtc: '2026-09-18T09:30:00Z',
    runtimeS: 25_500,
    usableDarkS: 25_140,
    exposureS: 4800,
    efficiencyPct: 19.1,
    overhead: { autofocusS: 240, flipS: 180, otherS: 20_280, pct: 81.2 },
    safetyPauseS: 0,
    blockChanges: 3,
    filterChanges: 5,
    plan: {
      plannedFrames: 17,
      plannedExposureS: 5100,
      acquiredFrames: 16,
      acquiredExposureS: 4830,
      framesPct: 94.1,
      timePct: 94.7,
    },
  },
  reasons: [
    { reason: 'meridian_flip', count: 1, durationS: 180 },
    { reason: 'center_failed', count: 2, durationS: null },
  ],
  quality: {
    scaleArcsecPx: null,
    refs: [],
    lines: [
      {
        projectId: ID(10),
        exposureLineId: ID(20),
        filter: 'Ha',
        good: 14,
        flagged: 1,
        rejected: 1,
        none: 0,
        sharePct: 87.5,
        reasons: { hfr: 0, stars: 1, rms: 0, cloud: 0 },
        hfr: { median: 2.1, min: 1.95, max: 2.6 },
        stars: { median: 410, min: 120, max: 450 },
        rmsArcsec: { median: 0.62, min: 0.4, max: 0.9 },
        hfrLimit: 2.73,
        rmsLimit: 1.5,
        series: [
          { atUtc: '2026-09-18T02:34:00Z', hfr: 2.1, rmsArcsec: 0.6, flagged: false },
          { atUtc: '2026-09-18T03:34:00Z', hfr: 2.6, rmsArcsec: 0.9, flagged: true },
          { atUtc: '2026-09-18T04:34:00Z', hfr: 1.95, rmsArcsec: 0.4, flagged: false },
        ],
      },
    ],
    session: {
      good: 14,
      flagged: 1,
      rejected: 1,
      none: 0,
      sharePct: 87.5,
      reasons: { hfr: 0, stars: 1, rms: 0, cloud: 0 },
      grade: 'good',
    },
  },
  conditions: [
    { metric: 'cloudPct', source: 'captures', median: 2, min: 0, max: 10 },
    { metric: 'temperatureC', source: 'telemetry', median: 12.4, min: 9.8, max: 15.1 },
    { metric: 'seeingScore', source: 'forecast', median: 0.6, min: 0.6, max: 0.6 },
  ],
});

function Where() {
  const l = useLocation();
  return <output data-testid="where">{`${l.pathname}${l.search}`}</output>;
}

const renderAt = (path: string) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes>
            <Route path="/auswertung/naechte" element={<NightsPage />} />
            <Route path="/auswertung/naechte/:rigId/:night" element={<NightPage />} />
          </Routes>
          <Where />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  state.me = me('owner');
  state.pages = [
    {
      items: [session(), session({ id: ID(2), night: '2026-09-16', unassigned: 0, projects: [] })],
      nextCursor: 'bmV4dA',
    },
    { items: [session({ id: ID(3), night: '2026-09-14' })], nextCursor: null },
  ];
  state.detail = detail();
  state.details = [];
  state.night = [session()];
  state.gaps = [
    {
      fromUtc: Date.parse('2026-09-18T08:22:00Z') / 1000,
      toUtc: Date.parse('2026-09-18T08:43:00Z') / 1000,
      kind: 'idle',
    },
  ];
  state.listCalls = [];
  state.summaryCalls = [];
  for (const fn of [state.assign, state.reject]) fn.mockReset();
});

describe('S-60 Nächte (AP-64)', () => {
  it('Kennzahlen, Karten mit Effizienz, Wetter und Projekt-Chips (Ersteller gekürzt, Transit als Serie); axe', async () => {
    // Eine Seite: graue Nächte auch älter als die letzte Session-Nacht.
    state.pages = [{ ...(state.pages[0] as (typeof state.pages)[number]), nextCursor: null }];
    renderAt('/auswertung/naechte');
    const card = await screen.findByRole('article', { name: 'Nacht 17./18.09. · Rig A' });
    expect(within(card).getByText('Do 17./18.09.')).toBeTruthy();
    expect(within(card).getByText('8,2 von 9,6 h · 85 %')).toBeTruthy();
    // Sessionqualität auf der Karte (AP-77).
    expect(within(card).getByText('Qualität sehr gut · 96 %')).toBeTruthy();
    expect(
      within(card).getByRole('img', { name: 'gut: 140, auffällig: 5, verworfen: 0' }),
    ).toBeTruthy();
    // Die Vorhersage steht nicht auf der Karte (Wunsch Sven 10.10.2026).
    expect(within(card).queryByText(/Vorhersage/)).toBeNull();
    // Ersteller mit mehr als 10 Zeichen gekürzt, voller Name als zugänglicher Name.
    expect(await within(card).findByRole('img', { name: 'Maximilian Mustermann' })).toBeTruthy();
    expect(within(card).getByText('Maximilian…')).toBeTruthy();
    expect(within(card).getByText('· Ha 16')).toBeTruthy();
    expect(within(card).getByText('· Transit · RED 558')).toBeTruthy();
    // Prüfen entfällt (AP-77); nicht zugeordnete Aufnahmen als Hinweis.
    expect(within(card).queryByText('ungeprüft')).toBeNull();
    expect(within(card).getByText('nicht zugeordnet: 1')).toBeTruthy();
    expect(
      within(card).getByRole('link', { name: 'Nacht 17./18.09. · Rig A öffnen' }),
    ).toHaveAttribute('href', `/auswertung/naechte/${ID(500)}/2026-09-17`);
    const kpis = screen.getByRole('region', { name: 'Kennzahlen' });
    expect(within(kpis).getByText('12')).toBeTruthy();
    expect(within(kpis).getByText('davon 9 nutzbar (≥ 1 h belichtet)')).toBeTruthy();
    expect(within(kpis).getByText('41,3 h')).toBeTruthy();
    expect(within(kpis).queryByText('Ungeprüft')).toBeNull();
    // Graue Nacht ohne Session (bewölkt erfasst, Standort des einzigen Standorts).
    expect(
      await screen.findByRole('article', { name: 'Nacht 15./16.09. – bewölkt erfasst' }),
    ).toBeTruthy();
    await expectNoSeriousA11y();
  });

  it('Filter in der Adresse: Rig und Zeitraum gehen in Liste und Kennzahlen; weitere Seite; `ungeprueft=1` ignoriert', async () => {
    renderAt(
      `/auswertung/naechte?rig=${ID(500)}&zeitraum=frei&von=2026-09-01&bis=2026-09-20&ungeprueft=1`,
    );
    await screen.findByRole('article', { name: 'Nacht 17./18.09. · Rig A' });
    expect(state.listCalls[0]).toMatchObject({
      rigId: ID(500),
      from: '2026-09-01',
      to: '2026-09-20',
      limit: 30,
    });
    expect(state.listCalls[0]).not.toHaveProperty('unreviewed');
    expect(screen.queryByRole('button', { name: 'Nur ungeprüfte' })).toBeNull();
    expect(state.summaryCalls[0]).toEqual({ rigId: ID(500), from: '2026-09-01', to: '2026-09-20' });
    // Link ins Detail trägt den Filter mit (Zurück führt dorthin).
    expect(
      screen.getByRole('link', { name: 'Nacht 17./18.09. · Rig A öffnen' }).getAttribute('href'),
    ).toBe(
      `/auswertung/naechte/${ID(500)}/2026-09-17?rig=${ID(500)}&zeitraum=frei&von=2026-09-01&bis=2026-09-20`,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Weitere Nächte laden' }));
    expect(await screen.findByRole('article', { name: 'Nacht 14./15.09. · Rig A' })).toBeTruthy();
    expect(state.listCalls.at(-1)).toMatchObject({ cursor: 'bmV4dA' });
    // Zeitraum wechseln: Rig bleibt, Zeitraum in der Adresse.
    fireEvent.change(screen.getByLabelText('Zeitraum'), { target: { value: '90' } });
    expect(screen.getByTestId('where').textContent).toContain(`rig=${ID(500)}&zeitraum=90`);
  });

  it('leere Liste zeigt den Hinweis', async () => {
    state.pages = [{ items: [], nextCursor: null }];
    renderAt(`/auswertung/naechte?rig=${ID(999)}`);
    expect(await screen.findByText('Keine Nächte mit Session im Zeitraum.')).toBeTruthy();
  });
});

describe('S-61 Nacht (AP-64, AP-77)', () => {
  it('Übersicht ohne Reiter und ohne Prüfen: Session-Qualität, Hinweise, Kennzahlen, Bedingungen, Ergebnis mit Qualität; axe', async () => {
    renderAt(`/auswertung/naechte/${ID(500)}/2026-09-17?rig=${ID(500)}&ansicht=aufnahmen`);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Do 17./18.09. · Rig A' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: '← Nächte' })).toHaveAttribute(
      'href',
      `/auswertung/naechte?rig=${ID(500)}`,
    );
    // Keine Reiter mehr; alte Adressen (`ansicht=aufnahmen`) öffnen die Übersicht.
    expect(screen.queryAllByRole('tab')).toEqual([]);
    expect(screen.queryByText(/geprüft/)).toBeNull();
    // Session-Qualität aus den bewerteten Lights der Auswahl.
    const quality = screen.getByRole('region', { name: 'Session-Qualität: sehr gut' });
    expect(within(quality).getByText('100 %')).toBeTruthy();
    expect(
      within(quality).getByText(
        '1 von 1 Lights gut · 0 auffällig · HFR 2,13–2,13 px · Guiding Ø 0,6″',
      ),
    ).toBeTruthy();
    expect(
      within(quality).getByRole('img', { name: 'gut: 1, auffällig: 0, verworfen: 0' }),
    ).toBeTruthy();
    // Hinweis auf nicht zugeordnete Aufnahmen mit Zuordnen.
    expect(
      screen.getByText('Aufnahmen nicht zugeordnet: 1 – sie zählen erst nach dem Zuordnen.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Zuordnen' })).toBeTruthy();
    // Kennzeichen NT-E2/E3 als Hinweis (bisher Symbol im Reiter Aufnahmen).
    expect(
      screen.getByText(
        'Abweichende Aufnahmen: Temperatur 1 · Einstellungen 1 (Details in der CSV)',
      ),
    ).toBeTruthy();
    const facts = screen.getByRole('region', { name: 'Kennzahlen der Nacht' });
    expect(within(facts).getByText('8 h')).toBeTruthy();
    expect(within(facts).getByText('1,3 h · 19 %')).toBeTruthy();
    expect(within(facts).getByText('21 min')).toBeTruthy();
    // Bedingungen mit Spanne; Quelle als Hinweis.
    const conditions = screen.getByRole('region', { name: 'Bedingungen' });
    expect(within(conditions).getByText('2 %')).toBeTruthy();
    expect(within(conditions).getByText('(0–10)')).toBeTruthy();
    expect(within(conditions).getByText('12,4 °C')).toBeTruthy();
    expect(within(conditions).getByText('60 %')).toBeTruthy();
    expect(within(conditions).getByText('Seeing').closest('li')?.getAttribute('title')).toBe(
      'Vorhersage zum Sessionbeginn (Mittel der dunklen Stunden)',
    );
    // Ergebnis je Projekt: Ist/Soll und Qualitätsleiste je Filter.
    const results = screen.getByRole('region', { name: 'Ergebnis je Projekt' });
    expect(within(results).getByText('16/17')).toBeTruthy();
    expect(within(results).getByText('1,3 h')).toBeTruthy();
    expect(
      within(results).getByRole('img', { name: 'gut: 14, auffällig: 1, verworfen: 1' }),
    ).toBeTruthy();
    expect(within(results).getByText('87 % gut')).toBeTruthy();
    expect(within(results).getByText(/6 % ⚠ auffällig \(1 Sterne\)/)).toBeTruthy();
    expect(within(results).getByText(/6 % ✕ verworfen/)).toBeTruthy();
    // Ereignisse eingeklappt am Ende.
    expect(screen.getByText('Alle Ereignisse (2)')).toBeTruthy();
    await expectNoSeriousA11y();
  });

  it('Zuordnen in der Übersicht: Formular je nicht zugeordneter Aufnahme', async () => {
    state.assign.mockResolvedValue(undefined);
    renderAt(`/auswertung/naechte/${ID(500)}/2026-09-17`);
    fireEvent.click(await screen.findByRole('button', { name: 'Zuordnen' }));
    const form = screen.getByRole('form', { name: 'Nicht zugeordnete Aufnahmen' });
    fireEvent.change(within(form).getByLabelText(/Zeile für 21:40/), { target: { value: ID(20) } });
    fireEvent.click(within(form).getByRole('button', { name: 'Zuordnen' }));
    await waitFor(() => expect(state.assign).toHaveBeenCalledWith(ID(31), ID(20)));
  });

  it('Details je Projekt: Qualität je Filter mit Verläufen, Soll/Ist ohne leere Spalten, ohne Korrektur; axe', async () => {
    renderAt(`/auswertung/naechte/${ID(500)}/2026-09-17`);
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }));
    const quality = screen.getByRole('table', { name: 'Bildqualität je Filter von NGC 281' });
    const ha = within(quality).getAllByRole('row')[1] as HTMLElement;
    expect(within(ha).getByText('16')).toBeTruthy();
    expect(within(ha).getByText('2,10 px')).toBeTruthy();
    expect(within(ha).getByText('1,95–2,60')).toBeTruthy();
    expect(within(ha).getByText('0,62″')).toBeTruthy();
    expect(within(ha).getByRole('img', { name: 'HFR-Verlauf Ha: 1 Sterne' })).toBeTruthy();
    expect(within(ha).getByRole('img', { name: 'Guiding-Verlauf Ha' })).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Soll/Ist NGC 281' });
    // Bonus und Bonus verworfen sind 0 → keine Spalten; Verworfen 1 → Spalte.
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Filter', 'Soll', 'Ist', 'Verworfen', 'Integration']);
    // Korrektur und „Akzeptiert“ entfallen (Sven 10.10.2026).
    expect(within(table).queryByRole('button', { name: 'Korrektur' })).toBeNull();
    await expectNoSeriousA11y();
  });

  it('Hinweis bei Fehlern und Warnungen; Ereignisse und Flats eingeklappt; CSV der Nacht', async () => {
    const d = detail();
    d.events = [
      ...d.events,
      {
        id: ID(81),
        occurredAt: '2026-09-18T06:00:00Z',
        kind: 'error',
        message: 'Kamera',
        durationS: null,
      },
      {
        id: ID(82),
        occurredAt: '2026-09-18T06:10:00Z',
        kind: 'center_failed',
        message: null,
        durationS: null,
      },
    ];
    state.detail = d;
    const created: string[] = [];
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      created.push(this.download);
    });
    renderAt(`/auswertung/naechte/${ID(500)}/2026-09-17`);
    expect(await screen.findByText('Fehler: 1 · Warnungen: 1')).toBeTruthy();
    expect(screen.getByText('(Fehler 1, Zentrieren fehlgeschlagen 1)')).toBeTruthy();
    const events = screen.getByText('Alle Ereignisse (4)').closest('details') as HTMLDetailsElement;
    expect(events.open).toBe(false);
    fireEvent.click(screen.getByText('Alle Ereignisse (4)'));
    const timeline = within(events).getByRole('region', { name: 'Ereignisse' });
    expect(within(timeline).getByText('Meridian-Flip')).toBeTruthy();
    expect(within(timeline).getByText('23:33 CDT')).toBeTruthy();
    expect(within(timeline).getByText('HFR 2,1')).toBeTruthy();
    fireEvent.click(screen.getByText('Flats je Kombination'));
    expect(screen.getByRole('list', { name: 'Flats je Kombination' }).textContent).toContain(
      'Flats 20/20 · Dark-Flats 9/10',
    );
    fireEvent.click(screen.getByRole('button', { name: 'CSV der Nacht' }));
    expect(created).toEqual(['session-2026-09-17-Rig_A.csv']);
    click.mockRestore();
  });

  it('Qualitätskurve (AP-72) in der Übersicht: HFR in ″, Kennzahlen umschaltbar, Autofokus-Marke, klar laut Bildern; axe', async () => {
    const d = detail();
    const first = d.captures[0] as (typeof d.captures)[number];
    d.captures = [
      { ...first, quality: { rmsArcsec: 0.6, cloudCoverPct: 0, medianAdu: 1000 } },
      {
        ...first,
        id: ID(33),
        capturedAt: '2026-09-18T03:34:00Z',
        stars: 60,
        quality: { rmsArcsec: 1.4, cloudCoverPct: 80, medianAdu: 1900 },
      },
      ...d.captures.slice(1),
    ];
    d.events = [
      ...d.events,
      {
        id: ID(80),
        occurredAt: '2026-09-18T02:30:00Z',
        kind: 'af',
        message: null,
        durationS: 180,
        af: { ok: true, filter: 'Ha 3nm', position: 2050, temperatureC: 12 },
      },
    ];
    d.quality = {
      ...(d.quality as NonNullable<typeof d.quality>),
      scaleArcsecPx: 0.5,
      refs: [{ projectId: ID(10), filter: 'Ha', stars: 400, hfr: 2.1, medianAdu: 1000, n: 30 }],
    };
    state.detail = d;
    renderAt(`/auswertung/naechte/${ID(500)}/2026-09-17`);
    const figure = await screen.findByRole('img', { name: /Qualitätskurve: 2 Aufnahmen/ });
    // HFR 2,134 px × 0,5 ″/px; eine Stunde klar, eine bewölkt.
    expect(figure.getAttribute('aria-label')).toContain('HFR 1,07 bis 1,07 ″');
    expect(figure.getAttribute('aria-label')).toContain('Autofokus: 2'); // einer im Grundbestand der Nacht
    expect(figure.getAttribute('aria-label')).toContain('1 h klar, 0 h dünne Wolken, 1 h bewölkt');
    const keys = screen.getByRole('group', { name: 'Kennzahlen der Kurve' });
    const clouds = within(keys).getByRole('button', { name: 'Wolken' });
    expect(clouds.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(clouds);
    expect(clouds.getAttribute('aria-pressed')).toBe('true');
    await expectNoSeriousA11y();
  });

  it('User: kein Zuordnen', async () => {
    state.me = me('user');
    const d = detail();
    d.rows = d.rows.map((r) => ({ ...r, canCorrect: false }));
    state.detail = d;
    renderAt(`/auswertung/naechte/${ID(500)}/2026-09-17`);
    expect(
      await screen.findByText('Aufnahmen nicht zugeordnet: 1 – sie zählen erst nach dem Zuordnen.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Zuordnen' })).toBeNull();
  });

  it('ohne Messwerte: „keine Messwerte“ statt Urteil', async () => {
    const d = detail();
    d.captures = d.captures.map((c) => ({ ...c, grade: null, flags: [] }));
    d.quality = { ...(d.quality as NonNullable<typeof d.quality>), lines: [] };
    state.detail = d;
    renderAt(`/auswertung/naechte/${ID(500)}/2026-09-17`);
    const quality = await screen.findByRole('region', {
      name: 'Session-Qualität: keine Messwerte',
    });
    expect(within(quality).getByText('–')).toBeTruthy();
  });
});

describe('Zwei Sessions in einer Nacht (Entscheidung Sven 07.10.2026)', () => {
  const second = () =>
    session({
      id: ID(2),
      startedAt: '2026-09-18T09:20:00Z',
      endedAt: '2026-09-18T11:00:00Z',
      ninaInstanceName: 'Zweit-PC',
      efficiency: { exposureS: 3600, usableDarkS: 3600, pct: 100 },
      projects: [
        {
          projectId: ID(10),
          projectName: 'NGC 281',
          createdBy: ID(3),
          transit: false,
          frames: 4,
          filters: [{ filter: 'Ha', frames: 4 }],
        },
      ],
    });

  it('Nächte: eine Karte mit Summen und Hinweis „2 Sessions“, nicht zugeordnete summiert', async () => {
    state.pages = [{ items: [session(), second()], nextCursor: null }];
    renderAt('/auswertung/naechte');
    const cards = await screen.findAllByRole('article', { name: 'Nacht 17./18.09. · Rig A' });
    expect(cards).toHaveLength(1);
    const card = cards[0] as HTMLElement;
    expect(within(card).getByText('2 Sessions')).toBeTruthy();
    expect(within(card).getByText('· Ha 20')).toBeTruthy();
    expect(within(card).getByText('9,2 von 10,6 h · 87 %')).toBeTruthy();
    expect(within(card).getByText('nicht zugeordnet: 2')).toBeTruthy();
    expect(within(card).getByText(/21:09 CDT – 06:00 CDT/)).toBeTruthy();
  });

  it('Nacht: Auswahl Ganze Nacht | Session 1 | Session 2; Qualität der Auswahl, Soll/Ist je Session', async () => {
    const two = detail();
    two.session = {
      ...two.session,
      ...second(),
      planRevision: 1,
      darknessEndUtc: null,
    };
    two.captures = [
      {
        ...(two.captures[0] as (typeof two.captures)[number]),
        id: ID(35),
        capturedAt: '2026-09-18T09:30:00Z',
      },
    ];
    state.details = [detail(), two];
    state.night = [second(), session()];
    renderAt(`/auswertung/naechte/${ID(500)}/2026-09-17`);
    const choose = await screen.findByRole('group', { name: 'Session wählen' });
    expect(
      within(choose)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Ganze Nacht', 'Session 1 · 21:09–04:14', 'Session 2 · 04:20–06:00']);
    expect(within(choose).getByRole('button', { name: 'Ganze Nacht' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Ganze Nacht: Qualität aus den Lights beider Sessions, Ergebnis je Session.
    expect(
      within(screen.getByRole('region', { name: 'Session-Qualität: sehr gut' })).getByText(
        /^2 von 2 Lights gut/,
      ),
    ).toBeTruthy();
    expect(screen.getByText('Session 1 · 21:09–04:14', { selector: 'strong' })).toBeTruthy();
    expect(screen.getByText('Session 2 · 04:20–06:00', { selector: 'strong' })).toBeTruthy();
    expect(screen.getAllByRole('region', { name: 'Ergebnis je Projekt' })).toHaveLength(2);
    fireEvent.click(within(choose).getByRole('button', { name: 'Session 2 · 04:20–06:00' }));
    expect(screen.getByTestId('where').textContent).toContain(`session=${ID(2)}`);
    expect(
      within(screen.getByRole('region', { name: 'Session-Qualität: sehr gut' })).getByText(
        /^1 von 1 Lights gut/,
      ),
    ).toBeTruthy();
    expect(screen.getAllByRole('region', { name: 'Ergebnis je Projekt' })).toHaveLength(1);
    await expectNoSeriousA11y();
  });
});
