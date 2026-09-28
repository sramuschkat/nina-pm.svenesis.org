// @vitest-environment jsdom
/**
 * AP-15: S-60 Sessions (Liste, Filter, Standortzeit mit Kürzel) und S-61 Detail (Soll/Ist, Korrektur mit
 * Untergrenze und Rückkehr nach *Aktiv*, Aufnahmen mit beiden Kennzeichen und Filter, Zuordnen, Ereignisse,
 * Flats, *Als geprüft* nur Admin); axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { Me, NightSession, NightSessionDetail } from '../../api/client';
import { AuthProvider } from '../../auth';
import { SessionDetailPage } from './SessionDetailPage';
import { SessionsPage } from './SessionsPage';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const state = vi.hoisted(() => ({
  me: null as unknown,
  list: [] as unknown[],
  detail: null as unknown,
  listCalls: [] as unknown[],
  correct: vi.fn(),
  review: vi.fn(),
  assign: vi.fn(),
  reject: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  api: { me: () => Promise.resolve(state.me) },
  equipmentApi: {
    list: () => Promise.resolve({ items: [{ id: ID(500), name: 'Rig A' }] }),
  },
  sessionsApi: {
    list: (q: unknown) => {
      state.listCalls.push(q);
      return Promise.resolve({ items: state.list });
    },
    get: () => Promise.resolve(state.detail),
    correct: (...a: unknown[]) => state.correct(...a) as Promise<unknown>,
    review: (...a: unknown[]) => state.review(...a) as Promise<unknown>,
    assign: (...a: unknown[]) => state.assign(...a) as Promise<unknown>,
    reject: (...a: unknown[]) => state.reject(...a) as Promise<unknown>,
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

const session = (over: Partial<NightSession> = {}): NightSession => ({
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
      acquired: 16,
      rejected: 1,
      rejectedIndividual: 1,
      rejectedCorrection: 0,
      accepted: 15,
      bonus: 0,
      bonusRejected: 0,
      integrationS: 4500,
    },
  ],
  captures: [
    {
      id: ID(30),
      capturedAt: '2026-09-18T02:34:00Z',
      frameType: 'light',
      projectId: ID(10),
      projectName: 'NGC 281',
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
    },
    {
      id: ID(31),
      capturedAt: '2026-09-18T02:40:00Z',
      frameType: 'light',
      projectId: null,
      projectName: null,
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
    },
  ],
  capturesTruncated: false,
  events: [
    { id: ID(40), occurredAt: '2026-09-18T04:33:00Z', kind: 'flip', message: null, durationS: 180 },
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

const renderAt = (path: string) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes>
            <Route path="/auswertung/sessions" element={<SessionsPage />} />
            <Route path="/auswertung/sessions/:id" element={<SessionDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  state.me = me('owner');
  state.list = [
    session(),
    session({ id: ID(2), night: '2026-09-16', reviewed: true, unassigned: 0 }),
  ];
  state.detail = detail();
  state.listCalls = [];
  for (const fn of [state.correct, state.review, state.assign, state.reject]) fn.mockReset();
});

describe('S-60 Sessions', () => {
  it('Liste mit Doppeldatum, Status, Standortzeit mit Kürzel, Frames, Integration; Filter; axe', async () => {
    renderAt('/auswertung/sessions');
    const link = await screen.findByRole('link', { name: '17./18.09.' });
    expect(link.getAttribute('href')).toBe(`/auswertung/sessions/${ID(1)}`);
    expect(screen.getAllByText('21:09 CDT').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1.3 h').length).toBeGreaterThan(0);
    expect(screen.getByText('ungeprüft')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Nur ungeprüfte'));
    await waitFor(() => expect(state.listCalls.at(-1)).toMatchObject({ unreviewed: true }));
    await expectNoSeriousA11y();
  });

  it('Sortierung per Spaltenkopf (AP-26a): Klick auf „Nacht“ sortiert auf- und absteigend', async () => {
    state.list = [
      session({ id: ID(1), night: '2026-09-17' }),
      session({ id: ID(2), night: '2026-09-15' }),
      session({ id: ID(3), night: '2026-09-16' }),
    ];
    renderAt('/auswertung/sessions');
    await screen.findByRole('link', { name: '17./18.09.' });
    const head = screen.getByRole('columnheader', { name: /Nacht/ });
    const order = () =>
      within(screen.getByRole('table'))
        .getAllByRole('link')
        .map((l) => l.textContent);
    expect(order()).toEqual(['17./18.09.', '15./16.09.', '16./17.09.']);
    fireEvent.click(within(head).getByRole('button'));
    expect(order()).toEqual(['15./16.09.', '16./17.09.', '17./18.09.']);
    fireEvent.click(within(head).getByRole('button'));
    expect(order()).toEqual(['17./18.09.', '16./17.09.', '15./16.09.']);
    expect(head).toHaveAttribute('aria-sort', 'descending');
  });

  it('leere Liste zeigt den Hinweis', async () => {
    state.list = [];
    renderAt('/auswertung/sessions');
    expect(await screen.findByText('Noch keine Sessions.')).toBeTruthy();
  });
});

describe('S-61 Session-Detail', () => {
  it('Soll/Ist je Zeile; Korrektur mit Untergrenze; Rückkehr nach Aktiv; axe', async () => {
    state.correct.mockResolvedValue({ rejectedCount: 2, projectStatus: 'active' });
    renderAt(`/auswertung/sessions/${ID(1)}`);
    expect(await screen.findByRole('heading', { name: '17./18.09. · Rig A' })).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Soll/Ist' });
    const row = within(table).getByRole('row', { name: /NGC 281/ });
    expect(
      within(row)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['NGC 281', 'Ha', '17', '16', '1', '15', '1.3 h', '0', '0', 'Korrektur']);
    fireEvent.click(within(row).getByRole('button', { name: 'Korrektur' }));
    const input = screen.getByLabelText('Verworfen') as HTMLInputElement;
    expect(input.min).toBe('1');
    expect(screen.getByText('mindestens 1 (einzeln verworfen)')).toBeTruthy();
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

  it('Aufnahmen mit beiden Kennzeichen, Filter Abweichungen, Zuordnen; Ereignisse und Flats; axe', async () => {
    state.assign.mockResolvedValue(undefined);
    renderAt(`/auswertung/sessions/${ID(1)}`);
    await screen.findByRole('heading', { name: '17./18.09. · Rig A' });
    fireEvent.click(screen.getByRole('tab', { name: 'Aufnahmen' }));
    const captures = screen.getByRole('table', { name: 'Aufnahmen' });
    const flagged = within(captures).getByRole('row', { name: /330 s/ });
    expect(within(flagged).getByText('Temperaturabweichung')).toBeTruthy();
    expect(within(flagged).getByText('Einstellungen abweichend')).toBeTruthy();
    expect(within(flagged).getByText('21:34 CDT')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Anzeigen'), { target: { value: 'deviations' } });
    expect(
      within(screen.getByRole('table', { name: 'Aufnahmen' })).getAllByRole('row'),
    ).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Anzeigen'), { target: { value: 'unassigned' } });
    fireEvent.change(screen.getByLabelText(/Zeile für 21:40/), { target: { value: ID(20) } });
    fireEvent.click(screen.getByRole('button', { name: 'Zuordnen' }));
    await waitFor(() => expect(state.assign).toHaveBeenCalledWith(ID(31), ID(20)));
    await expectNoSeriousA11y();
    fireEvent.click(screen.getByRole('tab', { name: 'Ereignisse' }));
    expect(screen.getByText('Meridian-Flip')).toBeTruthy();
    expect(screen.getByText('23:33 CDT')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Flats' }));
    expect(screen.getByText('9/10')).toBeTruthy();
    expect(screen.getByText('270.4°')).toBeTruthy();
  });

  it('Aufnahme verwerfen mit Grund und zurücknehmen; nur verworfene; CSV (AP-31, FA-AUS-20); axe', async () => {
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
    renderAt(`/auswertung/sessions/${ID(1)}`);
    await screen.findByRole('heading', { name: '17./18.09. · Rig A' });
    fireEvent.click(screen.getByRole('tab', { name: 'Aufnahmen' }));
    const table = screen.getByRole('table', { name: 'Aufnahmen' });
    // Nicht zugeordnete Aufnahme: kein Verwerfen.
    const row = within(table).getByRole('row', { name: /330 s/ });
    fireEvent.click(within(row).getByRole('button', { name: 'Verwerfen' }));
    expect(within(table).getAllByRole('button', { name: 'Verwerfen' })).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Grund'), { target: { value: 'clouds' } });
    await expectNoSeriousA11y();
    // Stand nach dem Neuladen: verworfen mit Grund, Zurücknehmen direkt.
    const d = detail();
    d.captures[0] = {
      ...d.captures[0],
      rejected: true,
      rejectReason: 'clouds',
    } as (typeof d.captures)[number];
    state.detail = d;
    const form = screen.getByRole('form', { name: 'Aufnahme verwerfen' });
    fireEvent.click(within(form).getByRole('button', { name: 'Verwerfen' }));
    await waitFor(() => expect(state.reject).toHaveBeenCalledWith(ID(30), true, 'clouds'));
    fireEvent.change(screen.getByLabelText('Anzeigen'), { target: { value: 'rejected' } });
    await screen.findByText('verworfen · Wolken');
    const only = screen.getByRole('table', { name: 'Aufnahmen' });
    expect(within(only).getAllByRole('row')).toHaveLength(2);
    fireEvent.click(within(only).getByRole('button', { name: 'Zurücknehmen' }));
    await waitFor(() => expect(state.reject).toHaveBeenCalledWith(ID(30), false, null));
    fireEvent.click(screen.getByRole('button', { name: 'CSV exportieren' }));
    expect(created).toEqual(['session-2026-09-17-Rig_A.csv']);
    click.mockRestore();
  });

  it('Reiter Kennzahlen: Effizienz, Overhead, Plan-Treue, Gründe (AP-31); axe', async () => {
    renderAt(`/auswertung/sessions/${ID(1)}`);
    await screen.findByRole('heading', { name: '17./18.09. · Rig A' });
    expect(screen.getAllByRole('tab').map((x) => x.textContent)).toEqual([
      'Soll/Ist',
      'Ereignisse',
      'Aufnahmen',
      'Protokoll',
      'Kennzahlen',
      'Flats',
    ]);
    fireEvent.click(screen.getByRole('tab', { name: 'Kennzahlen' }));
    expect(screen.getByText('19,1 %')).toBeTruthy();
    expect(screen.getByText('1 h 20 min Belichtung / 6 h 59 min nutzbare Dunkelzeit')).toBeTruthy();
    expect(screen.getByText('Autofokus 4 min · Flip 3 min · sonstiger 5 h 38 min')).toBeTruthy();
    expect(screen.getByText('94,1 %')).toBeTruthy();
    expect(screen.getByText('16 von 17 geplanten Frames (erster Plan)')).toBeTruthy();
    const reasons = screen.getByRole('table', { name: 'Abweichungsgründe' });
    expect(within(reasons).getByRole('row', { name: /Meridian-Flip/ }).textContent).toContain(
      '3 min',
    );
    expect(
      within(reasons).getByRole('row', { name: /Zentrieren fehlgeschlagen/ }).textContent,
    ).toContain('2');
    await expectNoSeriousA11y();
  });

  it('Admin markiert als geprüft; User sieht weder Prüfen noch Zuordnen, Korrektur nur fürs eigene Projekt', async () => {
    state.review.mockResolvedValue(undefined);
    const { unmount } = renderAt(`/auswertung/sessions/${ID(1)}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Als geprüft markieren' }));
    await waitFor(() => expect(state.review).toHaveBeenCalledWith(ID(1), true));
    unmount();
    state.me = me('user');
    renderAt(`/auswertung/sessions/${ID(1)}`);
    await screen.findByRole('heading', { name: '17./18.09. · Rig A' });
    expect(screen.queryByRole('button', { name: 'Als geprüft markieren' })).toBeNull();
    // Eigenes Projekt (createdBy = eigenes Mitglied): Korrektur sichtbar – die API prüft den Mandanten.
    expect(screen.getByRole('button', { name: 'Korrektur' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Aufnahmen' }));
    expect(screen.queryByRole('button', { name: 'Zuordnen' })).toBeNull();
  });

  it('Korrektur: Zeilenwechsel übernimmt die Zahl der neuen Zeile (P1-12)', async () => {
    state.correct.mockResolvedValue({ rejectedCount: 0, projectStatus: null });
    const d = detail();
    const first = d.rows[0] as NightSessionDetail['rows'][number];
    d.rows = [
      { ...first, rejected: 5, rejectedIndividual: 0, rejectedCorrection: 5 },
      {
        ...first,
        exposureLineId: ID(21),
        filterShortName: 'OIII',
        rejected: 0,
        rejectedIndividual: 0,
        rejectedCorrection: 0,
      },
    ];
    state.detail = d;
    renderAt(`/auswertung/sessions/${ID(1)}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Korrektur erfassen' }));
    const input = screen.getByLabelText('Verworfen') as HTMLInputElement;
    expect(input.value).toBe('5');
    fireEvent.change(screen.getByLabelText('Zeile'), { target: { value: ID(21) } });
    expect(input.value).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: 'Korrektur speichern' }));
    await waitFor(() =>
      expect(state.correct).toHaveBeenCalledWith(ID(1), {
        exposureLineId: ID(21),
        rejected: 0,
        reason: null,
        comment: null,
      }),
    );
  });

  it('ohne Recht auf eine Zeile (API: canCorrect = false) kein „Korrektur erfassen“, kein Verwerfen', async () => {
    state.me = me('user');
    const d = detail();
    // Auch das eigene Projekt, wenn der Mandant `userCorrections` abgeschaltet hat – die API liefert false.
    d.rows = d.rows.map((r) => ({ ...r, canCorrect: false }));
    state.detail = d;
    renderAt(`/auswertung/sessions/${ID(1)}`);
    await screen.findByRole('heading', { name: '17./18.09. · Rig A' });
    expect(screen.queryByRole('button', { name: 'Korrektur erfassen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Korrektur' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Verwerfen' })).toBeNull();
  });
});
