// @vitest-environment jsdom
/**
 * AP-30: S-61 Reiter *Protokoll* (Vorbelegung mit Quellen, NINA Ø/min/max, *übernehmen* mit
 * Kennzeichen-Vorschau, Speichern mit Version, nur Admin bearbeitet) und S-64 Klarnacht-Statistik
 * (Kennzahlen, Monatsbalken, Nächte, „bewölkt/nicht genutzt“ erfassen nur Admin); axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { ClearNightView, Me, SessionLogView } from '../../api/client';
import { AuthProvider } from '../../auth';
import { ClearNightsPage, periodRange } from './ClearNightsPage';
import { SessionLogPanel } from './SessionLogPanel';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const state = vi.hoisted(() => ({
  me: null as unknown,
  log: null as unknown,
  clear: null as unknown,
  save: vi.fn(),
  mark: vi.fn(),
  clearCalls: [] as unknown[][],
}));

vi.mock('../../api/client', () => ({
  api: { me: () => Promise.resolve(state.me) },
  equipmentApi: {
    list: () => Promise.resolve({ items: [{ id: ID(600), name: 'Starfront' }] }),
  },
  sessionLogApi: {
    get: () => Promise.resolve(state.log),
    save: (...a: unknown[]) => state.save(...a) as Promise<unknown>,
    clearNights: (...a: unknown[]) => {
      state.clearCalls.push(a);
      return Promise.resolve(state.clear);
    },
    markUnused: (...a: unknown[]) => state.mark(...a) as Promise<unknown>,
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

const logView = (): SessionLogView => ({
  sessionId: ID(1),
  version: '0',
  saved: false,
  values: {
    startTime: '2026-09-18T02:09:00Z',
    endTime: '2026-09-18T09:14:00Z',
    seeingArcsec: null,
    transparencyPct: 71.5,
    sqm: 21.3,
    temperatureC: 8.1,
    humidityPct: 78,
    windKmh: 7.2,
    cloudsNote: '12 %',
    moonIlluminationPct: 41.8,
    weatherNotes: '',
    notesMd: '',
  },
  sources: {
    startTime: 'auto',
    endTime: 'auto',
    seeingArcsec: null,
    transparencyPct: 'forecast',
    sqm: 'nina',
    temperatureC: 'nina',
    humidityPct: 'forecast',
    windKmh: 'nina',
    cloudsNote: 'forecast',
    moonIlluminationPct: 'auto',
  },
  forecast: {
    transparencyPct: 71.5,
    temperatureC: 9.3,
    humidityPct: 78,
    windKmh: 11.2,
    cloudPct: 12.4,
    ratingIndex: 3,
    nightMean: 0.72,
    seeingScore: 0.6,
  },
  nina: {
    sqm: { avg: 21.3, min: 21.1, max: 21.5 },
    temperatureC: { avg: 8.1, min: 6.9, max: 9.4 },
    humidityPct: null,
    windKmh: { avg: 7.2, min: 1.8, max: 14.4 },
    seeingArcsec: null,
  },
  updatedAt: null,
  updatedBy: null,
  updatedByName: null,
});

const nightRow = (night: string, over: Partial<ClearNightView['nights'][number]> = {}) => ({
  night,
  source: null,
  usable: null,
  usableHours: null,
  sessionIds: [],
  forecastRatingIndex: null,
  forecastNightMean: null,
  seeingArcsec: null,
  sqm: null,
  transparencyPct: null,
  forecastTransparencyPct: null,
  rejectedPct: null,
  ...over,
});

const clearView = (): ClearNightView => ({
  siteId: ID(600),
  siteName: 'Starfront',
  timeZone: 'America/Chicago',
  from: '2025-09-26',
  to: '2026-09-25',
  months: [{ month: '2026-09', recorded: 2, usable: 1, usablePct: 50, meanUsableHours: 5.2 }],
  nights: [
    nightRow('2026-09-18', {
      source: 'session',
      usable: true,
      usableHours: 5.2,
      sessionIds: [ID(1)],
      forecastRatingIndex: 3,
      seeingArcsec: 2.4,
      sqm: 21.3,
      transparencyPct: 70,
      rejectedPct: 6.3,
    }),
    nightRow('2026-09-17', { source: 'manual', usable: false, usableHours: 0 }),
    nightRow('2026-09-16', { forecastTransparencyPct: 40 }),
  ],
  accuracy: { compared: 1, hits: 1, hitPct: 100 },
});

const wrap = (ui: React.ReactNode, path = '/') =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes>
            <Route path="*" element={ui} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  state.me = me('owner');
  state.log = logView();
  state.clear = clearView();
  state.clearCalls = [];
  state.save.mockReset();
  state.mark.mockReset();
});

describe('S-61 Protokoll', () => {
  it('Vorbelegung mit Quellen und NINA-Werten; übernehmen setzt Wert und Kennzeichen; speichern; axe', async () => {
    const saved = { ...logView(), version: '1760000000000', saved: true };
    state.save.mockResolvedValue(saved);
    wrap(<SessionLogPanel sessionId={ID(1)} siteTimeZone="America/Chicago" />);
    expect(await screen.findByRole('heading', { name: 'Sitzungsprotokoll' })).toBeTruthy();
    expect(screen.getByText(/Noch nicht gespeichert/)).toBeTruthy();
    expect(screen.getByText(/Gut, Wolken 12,4 %/)).toBeTruthy();
    const temp = screen.getByLabelText(/Temperatur/) as HTMLInputElement;
    expect(temp.value).toBe('8.1');
    const tempField = temp.closest('[data-field]') as HTMLElement;
    expect(within(tempField).getByText('NINA')).toBeTruthy();
    expect(within(tempField).getByText('NINA Ø 8,1 (min 6,9, max 9,4)')).toBeTruthy();
    // Vorhersagewert übernehmen: Kennzeichen wechselt auf „Vorhersage“.
    fireEvent.click(within(tempField).getByRole('button', { name: 'Vorhersage 9,3 übernehmen' }));
    expect(temp.value).toBe('9.3');
    expect(within(tempField).getByText('Vorhersage')).toBeTruthy();
    // Eigener Wert: „manuell“.
    const seeing = screen.getByLabelText(/Seeing/) as HTMLInputElement;
    fireEvent.change(seeing, { target: { value: '2.4' } });
    expect(within(seeing.closest('[data-field]') as HTMLElement).getByText('manuell')).toBeTruthy();
    await expectNoSeriousA11y();
    fireEvent.click(screen.getByRole('button', { name: 'Protokoll speichern' }));
    await waitFor(() =>
      expect(state.save).toHaveBeenCalledWith(
        ID(1),
        expect.objectContaining({ temperatureC: 9.3, seeingArcsec: 2.4 }),
        '0',
      ),
    );
    expect(await screen.findByText('Protokoll gespeichert.')).toBeTruthy();
  });

  it('User sieht das Protokoll nur lesend', async () => {
    state.me = me('user');
    state.log = { ...logView(), saved: true, notesMd: '', updatedByName: 'Sven' };
    wrap(<SessionLogPanel sessionId={ID(1)} siteTimeZone="America/Chicago" />);
    await screen.findByRole('heading', { name: 'Sitzungsprotokoll' });
    expect(screen.getByLabelText(/Temperatur/)).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Protokoll speichern' })).toBeNull();
    expect(screen.queryByRole('button', { name: /übernehmen/ })).toBeNull();
  });
});

describe('S-64 Klarnacht-Statistik', () => {
  it('Kennzahlen, Monatsbalken, Nächte; Erfassen und Zurücknehmen (Admin); axe', async () => {
    state.mark.mockResolvedValue(undefined);
    wrap(<ClearNightsPage />, '/auswertung/klarnacht');
    expect(await screen.findByText('1 von 2 (50 %)')).toBeTruthy();
    expect(screen.getByText('100 %')).toBeTruthy();
    expect(
      screen.getByRole('listitem', { name: /1 von 2 Nächten nutzbar, im Mittel 5,2 h/ }),
    ).toBeTruthy();
    expect(state.clearCalls[0]?.[0]).toBe(ID(600));
    const table = screen.getByRole('table', { name: 'Nächte' });
    const first = within(table).getByRole('row', { name: /18\.\/19\.09\./ });
    expect(within(first).getByText('nutzbar')).toBeTruthy();
    expect(within(first).getByRole('link').getAttribute('href')).toBe(
      `/auswertung/sessions/${ID(1)}`,
    );
    expect(within(first).queryByRole('button', { name: /bewölkt/ })).toBeNull();
    const manual = within(table).getByRole('row', { name: /17\.\/18\.09\./ });
    expect(within(manual).getByText('manuell erfasst')).toBeTruthy();
    const open = within(table).getByRole('row', { name: /16\.\/17\.09\./ });
    expect(within(open).getByText('40 % (Vorhersage)')).toBeTruthy();
    await expectNoSeriousA11y();
    fireEvent.click(within(open).getByRole('button', { name: 'bewölkt erfassen' }));
    await waitFor(() => expect(state.mark).toHaveBeenCalledWith(ID(600), '2026-09-16', true));
    fireEvent.click(within(manual).getByRole('button', { name: 'zurücknehmen' }));
    await waitFor(() => expect(state.mark).toHaveBeenCalledWith(ID(600), '2026-09-17', false));
  });

  it('User erfasst keine Nächte; Filter „nur ohne Angabe“', async () => {
    state.me = me('user');
    wrap(<ClearNightsPage />, '/auswertung/klarnacht');
    await screen.findByText('1 von 2 (50 %)');
    expect(screen.queryByRole('button', { name: /bewölkt/ })).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Nächte' }), {
      target: { value: 'open' },
    });
    const table = screen.getByRole('table', { name: 'Nächte' });
    expect(within(table).getAllByRole('row').length).toBe(2);
  });

  it('Zeitraum bis gestern, Monate zurück', () => {
    expect(periodRange(12, new Date(Date.UTC(2026, 8, 26, 10)))).toEqual({
      from: '2025-09-26',
      to: '2026-09-25',
    });
  });
});
