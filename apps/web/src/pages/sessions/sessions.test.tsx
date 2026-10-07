// @vitest-environment jsdom
/**
 * AP-64 (vorher AP-15/AP-31): Auswertung – Nächte (S-60: Kennzahlen, Karten mit Effizienz, Projekt-Chips mit Ersteller,
 * Filter in der Adresse, „Nur ungeprüfte“, seitenweise) und Nacht (S-61: drei Reiter, Prüf-Banner mit Prüfliste und
 * „Als geprüft markieren“, Kennzahlen, Ergebnis je Projekt mit Details/Korrektur, Aufnahmen mit Typ-Chips, ⋯-Menü
 * zum Verwerfen und Zuordnen, CSV, Verlauf & Notizen; Rechte Admin/User); axe.
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
  listCalls: [] as Record<string, unknown>[],
  summaryCalls: [] as unknown[],
  gaps: null as unknown,
  correct: vi.fn(),
  review: vi.fn(),
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
        unreviewed: 3,
        firstUnreviewedId: ID(1),
      });
    },
    get: () => Promise.resolve(state.detail),
    correct: (...a: unknown[]) => state.correct(...a) as Promise<unknown>,
    review: (...a: unknown[]) => state.review(...a) as Promise<unknown>,
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
    // Protokoll lädt im Test nicht (der Reiter zeigt nur die Ereignisse).
    get: () => new Promise(() => undefined),
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
  reviewed: false,
  ninaInstanceName: 'Beobachtungs-PC',
  frames: 16,
  bonusFrames: 0,
  integrationS: 4800,
  unassigned: 1,
  efficiency: { exposureS: 29_520, usableDarkS: 34_560, pct: 85.4 },
  weather: { ratingIndex: 3, nightMean: 0.89 },
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
    reviewedBy: null,
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
            <Route path="/auswertung/naechte/:id" element={<NightPage />} />
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
      items: [
        session(),
        session({ id: ID(2), night: '2026-09-16', reviewed: true, unassigned: 0, projects: [] }),
      ],
      nextCursor: 'bmV4dA',
    },
    { items: [session({ id: ID(3), night: '2026-09-14', reviewed: true })], nextCursor: null },
  ];
  state.detail = detail();
  state.gaps = [
    {
      fromUtc: Date.parse('2026-09-18T08:22:00Z') / 1000,
      toUtc: Date.parse('2026-09-18T08:43:00Z') / 1000,
      kind: 'idle',
    },
  ];
  state.listCalls = [];
  state.summaryCalls = [];
  for (const fn of [state.correct, state.review, state.assign, state.reject]) fn.mockReset();
});

describe('S-60 Nächte (AP-64)', () => {
  it('Kennzahlen, Karten mit Effizienz, Wetter und Projekt-Chips (Ersteller gekürzt, Transit als Serie); axe', async () => {
    // Eine Seite: graue Nächte auch älter als die letzte Session-Nacht.
    state.pages = [{ ...(state.pages[0] as (typeof state.pages)[number]), nextCursor: null }];
    renderAt('/auswertung/naechte');
    const card = await screen.findByRole('article', { name: 'Nacht 17./18.09. · Rig A' });
    expect(within(card).getByText('Do 17./18.09.')).toBeTruthy();
    expect(within(card).getByText('8,2 von 9,6 h · 85 %')).toBeTruthy();
    expect(within(card).getByText('Gut · 89 %')).toBeTruthy();
    // Ersteller mit mehr als 10 Zeichen gekürzt, voller Name als zugänglicher Name.
    expect(await within(card).findByRole('img', { name: 'Maximilian Mustermann' })).toBeTruthy();
    expect(within(card).getByText('Maximilian…')).toBeTruthy();
    expect(within(card).getByText('· Ha 16')).toBeTruthy();
    expect(within(card).getByText('· Transit · RED 558')).toBeTruthy();
    expect(within(card).getByText('ungeprüft')).toBeTruthy();
    expect(
      within(card).getByRole('link', { name: 'Nacht 17./18.09. · Rig A öffnen' }),
    ).toHaveAttribute('href', `/auswertung/naechte/${ID(1)}`);
    const kpis = screen.getByRole('region', { name: 'Kennzahlen' });
    expect(within(kpis).getByText('12')).toBeTruthy();
    expect(within(kpis).getByText('davon 9 nutzbar (≥ 1 h belichtet)')).toBeTruthy();
    expect(within(kpis).getByText('41,3 h')).toBeTruthy();
    expect(within(kpis).getByRole('link', { name: /Ungeprüft/ })).toHaveAttribute(
      'href',
      `/auswertung/naechte/${ID(1)}`,
    );
    // Graue Nacht ohne Session (bewölkt erfasst, Standort des einzigen Standorts).
    expect(
      await screen.findByRole('article', { name: 'Nacht 15./16.09. – bewölkt erfasst' }),
    ).toBeTruthy();
    await expectNoSeriousA11y();
  });

  it('Filter in der Adresse: Rig und Zeitraum gehen in Liste und Kennzahlen; „Nur ungeprüfte“; weitere Seite', async () => {
    renderAt(`/auswertung/naechte?rig=${ID(500)}&zeitraum=frei&von=2026-09-01&bis=2026-09-20`);
    await screen.findByRole('article', { name: 'Nacht 17./18.09. · Rig A' });
    expect(state.listCalls[0]).toMatchObject({
      rigId: ID(500),
      from: '2026-09-01',
      to: '2026-09-20',
      unreviewed: false,
      limit: 30,
    });
    expect(state.summaryCalls[0]).toEqual({ rigId: ID(500), from: '2026-09-01', to: '2026-09-20' });
    // Link ins Detail trägt den Filter mit (Zurück führt dorthin).
    expect(
      screen.getByRole('link', { name: 'Nacht 17./18.09. · Rig A öffnen' }).getAttribute('href'),
    ).toBe(
      `/auswertung/naechte/${ID(1)}?rig=${ID(500)}&zeitraum=frei&von=2026-09-01&bis=2026-09-20`,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Weitere Nächte laden' }));
    expect(await screen.findByRole('article', { name: 'Nacht 14./15.09. · Rig A' })).toBeTruthy();
    expect(state.listCalls.at(-1)).toMatchObject({ cursor: 'bmV4dA' });
    fireEvent.click(screen.getByRole('button', { name: 'Nur ungeprüfte' }));
    await waitFor(() => expect(state.listCalls.at(-1)).toMatchObject({ unreviewed: true }));
    expect(screen.getByTestId('where').textContent).toContain('ungeprueft=1');
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

describe('S-61 Nacht (AP-64)', () => {
  it('Übersicht: Prüf-Banner mit Prüfliste, Kennzahlen, Ergebnis je Projekt; als geprüft markieren; axe', async () => {
    state.review.mockResolvedValue(undefined);
    renderAt(`/auswertung/naechte/${ID(1)}?rig=${ID(500)}`);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Do 17./18.09. · Rig A' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: '← Nächte' })).toHaveAttribute(
      'href',
      `/auswertung/naechte?rig=${ID(500)}`,
    );
    expect(screen.getAllByRole('tab').map((x) => x.textContent)).toEqual([
      'Übersicht',
      'Aufnahmen3',
      'Verlauf & Notizen',
    ]);
    const banner = screen.getByRole('region', { name: 'Nacht prüfen · offen: 3' });
    expect(within(banner).getByText('Aufnahmen ohne Zuordnung: 1')).toBeTruthy();
    expect(within(banner).getByText('NGC 281 · Ha 16 von 17 geplant')).toBeTruthy();
    expect(within(banner).getByText('21 min Leerlauf (03:22–03:43)')).toBeTruthy();
    const facts = screen.getByRole('region', { name: 'Kennzahlen der Nacht' });
    expect(within(facts).getByText('8 h')).toBeTruthy();
    expect(within(facts).getByText('1,3 h · 19 %')).toBeTruthy();
    expect(within(facts).getByText('1 · 0')).toBeTruthy();
    expect(within(facts).getByText('21 min')).toBeTruthy();
    expect(within(facts).getByText('1 · 1')).toBeTruthy();
    const results = screen.getByRole('region', { name: 'Ergebnis je Projekt' });
    expect(within(results).getByText('16/17')).toBeTruthy();
    expect(within(results).getByText('1,3 h')).toBeTruthy();
    // „Korrektur erfassen“ und „Als geprüft“ stehen nicht mehr im Kopf.
    expect(screen.queryByRole('button', { name: 'Korrektur erfassen' })).toBeNull();
    await expectNoSeriousA11y();
    fireEvent.click(within(banner).getByRole('button', { name: 'Als geprüft markieren' }));
    await waitFor(() => expect(state.review).toHaveBeenCalledWith(ID(1), true));
  });

  it('Banner: „zuordnen“ führt zu den Aufnahmen ohne Zuordnung, Zuordnen über ⋯', async () => {
    state.assign.mockResolvedValue(undefined);
    renderAt(`/auswertung/naechte/${ID(1)}`);
    const banner = await screen.findByRole('region', { name: /Nacht prüfen/ });
    fireEvent.click(within(banner).getByRole('button', { name: 'zuordnen' }));
    expect(screen.getByTestId('where').textContent).toContain('ansicht=aufnahmen');
    expect(screen.getByRole('button', { name: 'Ohne Zuordnung 1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const table = screen.getByRole('table', { name: 'Aufnahmen' });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    fireEvent.pointerDown(
      within(table).getByRole('button', { name: 'Aktionen zur Aufnahme 21:40 Ha' }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Zuordnen' }));
    const form = screen.getByRole('form', { name: 'Nicht zugeordnete Aufnahmen' });
    fireEvent.change(within(form).getByLabelText(/Zeile für 21:40/), { target: { value: ID(20) } });
    fireEvent.click(within(form).getByRole('button', { name: 'Zuordnen' }));
    await waitFor(() => expect(state.assign).toHaveBeenCalledWith(ID(31), ID(20)));
  });

  it('Details je Projekt: Soll/Ist ohne leere Spalten, Korrektur mit Untergrenze und Rückkehr nach Aktiv', async () => {
    state.correct.mockResolvedValue({ rejectedCount: 2, projectStatus: 'active' });
    renderAt(`/auswertung/naechte/${ID(1)}`);
    const banner = await screen.findByRole('region', { name: /Nacht prüfen/ });
    fireEvent.click(within(banner).getByRole('button', { name: 'Grund erfassen' }));
    const table = screen.getByRole('table', { name: 'Soll/Ist NGC 281' });
    // Bonus und Bonus verworfen sind 0 → keine Spalten; Verworfen 1 → Spalte.
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Filter', 'Soll', 'Ist', 'Verworfen', 'Akzeptiert', 'Integration', 'Aktion']);
    const input = screen.getByLabelText('Verworfen') as HTMLInputElement;
    expect(input.min).toBe('1');
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Grund'), { target: { value: 'clouds' } });
    fireEvent.click(screen.getByRole('button', { name: 'Korrektur speichern' }));
    await waitFor(() =>
      expect(state.correct).toHaveBeenCalledWith(ID(1), {
        exposureLineId: ID(20),
        rejected: 2,
        reason: 'clouds',
        comment: null,
      }),
    );
    expect(
      await screen.findByText('Korrektur gespeichert; das Projekt ist wieder aktiv.'),
    ).toBeTruthy();
    await expectNoSeriousA11y();
  });

  it('Aufnahmen: Typ-Chips mit Anzahl, Kennzeichen als Symbol, HFR-Grafik, Flats-Kopfzeile, Verwerfen, CSV; axe', async () => {
    state.reject.mockResolvedValue({
      captureId: ID(30),
      rejected: true,
      rejectedCount: 1,
      bonusRejectedCount: 0,
      projectStatus: null,
    });
    const created: string[] = [];
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      created.push(this.download);
    });
    renderAt(`/auswertung/naechte/${ID(1)}?ansicht=aufnahmen`);
    const chips = await screen.findByRole('group', { name: 'Anzeigen' });
    expect(
      within(chips)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Alle 3', 'Lights 2', 'Flats 1', 'Abweichung 1', 'Ohne Zuordnung 1', 'Verworfen 0']);
    const table = screen.getByRole('table', { name: 'Aufnahmen' });
    const flagged = within(table).getByRole('row', { name: /330 s/ });
    expect(
      within(flagged).getByRole('img', { name: 'Temperaturabweichung · Einstellungen abweichend' }),
    ).toBeTruthy();
    expect(within(flagged).getByText('2,13 px')).toBeTruthy();
    expect(screen.getByTestId('capture-metrics').textContent).toBe(
      'Median HFR 2,13 px · Median Sterne 412 · 1 Aufnahmen mit Messwerten',
    );
    expect(screen.getByRole('img', { name: /HFR- und Sterne-Verlauf: 1 Aufnahmen/ })).toBeTruthy();
    await expectNoSeriousA11y();
    fireEvent.click(within(chips).getByRole('button', { name: 'Flats 1' }));
    expect(screen.getByRole('list', { name: 'Flats je Kombination' }).textContent).toContain(
      'Flats 20/20 · Dark-Flats 9/10',
    );
    fireEvent.click(within(chips).getByRole('button', { name: 'Alle 3' }));
    fireEvent.pointerDown(
      within(screen.getByRole('table', { name: 'Aufnahmen' })).getByRole('button', {
        name: 'Aktionen zur Aufnahme 21:34 Ha',
      }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Verwerfen' }));
    const form = screen.getByRole('form', { name: 'Aufnahme verwerfen' });
    fireEvent.change(within(form).getByLabelText('Grund'), { target: { value: 'clouds' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Verwerfen' }));
    await waitFor(() => expect(state.reject).toHaveBeenCalledWith(ID(30), true, 'clouds'));
    fireEvent.click(screen.getByRole('button', { name: 'CSV exportieren' }));
    expect(created).toEqual(['session-2026-09-17-Rig_A.csv']);
    click.mockRestore();
  });

  it('Verlauf & Notizen: Ereignisse als Zeitachse in Standortzeit', async () => {
    renderAt(`/auswertung/naechte/${ID(1)}?ansicht=verlauf`);
    const events = await screen.findByRole('region', { name: 'Ereignisse' });
    expect(within(events).getByText('Meridian-Flip')).toBeTruthy();
    expect(within(events).getByText('23:33 CDT')).toBeTruthy();
    expect(within(events).getByText('HFR 2,1')).toBeTruthy();
  });

  it('User: kein „Als geprüft markieren“, kein Zuordnen; Korrektur nur mit canCorrect', async () => {
    state.me = me('user');
    const d = detail();
    d.rows = d.rows.map((r) => ({ ...r, canCorrect: false }));
    state.detail = d;
    renderAt(`/auswertung/naechte/${ID(1)}`);
    const banner = await screen.findByRole('region', { name: /Nacht prüfen/ });
    expect(within(banner).queryByRole('button', { name: 'Als geprüft markieren' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.queryByRole('button', { name: 'Korrektur' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Aufnahmen/ }));
    // Ohne Recht keine Einträge → kein ⋯-Knopf.
    expect(screen.queryByRole('button', { name: /Aktionen zur Aufnahme/ })).toBeNull();
  });

  it('geprüfte Nacht: kein Banner, „Prüfung zurücknehmen“ im ⋯-Menü', async () => {
    state.review.mockResolvedValue(undefined);
    const d = detail();
    d.session = { ...d.session, reviewed: true };
    state.detail = d;
    renderAt(`/auswertung/naechte/${ID(1)}`);
    await screen.findByRole('heading', { level: 1, name: 'Do 17./18.09. · Rig A' });
    expect(screen.queryByRole('region', { name: /Nacht prüfen/ })).toBeNull();
    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Weitere Aktionen zur Nacht 17./18.09.' }),
      {
        button: 0,
        ctrlKey: false,
      },
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Prüfung zurücknehmen' }));
    await waitFor(() => expect(state.review).toHaveBeenCalledWith(ID(1), false));
  });
});
