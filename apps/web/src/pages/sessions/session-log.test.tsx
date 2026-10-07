// @vitest-environment jsdom
/**
 * AP-30: S-61 *Protokoll* (Vorbelegung mit Quellen, NINA Ø/min/max, *übernehmen* mit Kennzeichen-Vorschau, Speichern
 * mit Version, nur Admin bearbeitet) und – seit AP-64 – Standort-Statistik (Kalender mit Klassen und Tooltip, Klick
 * öffnet die Nacht bzw. „bewölkt erfassen“ nur Admin, Kacheln, SQM/Seeing-Balken, Tabelle auf Wunsch); axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { ClearNightView, Me, SessionLogView } from '../../api/client';
import { AuthProvider } from '../../auth';
import { calendarMonths, dayKind, SiteStatsPage } from './SiteStatsPage';
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
    list: (kind: string) =>
      Promise.resolve({
        items:
          kind === 'sites'
            ? [{ id: ID(600), name: 'Starfront' }]
            : kind === 'rigs'
              ? [{ id: ID(500), name: 'Rig A', siteId: ID(600) }]
              : [],
      }),
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

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname}</output>;
}

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
          <Where />
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

describe('Auswertung – Standort-Statistik (AP-64)', () => {
  const path = '/auswertung/standort?zeitraum=frei&von=2026-09-01&bis=2026-09-25';

  it('Kalender mit Klassen und Tooltip, Kacheln, SQM/Seeing; Klick öffnet die Nacht; axe', async () => {
    state.clear = {
      ...clearView(),
      from: '2026-09-01',
      to: '2026-09-25',
      nights: [
        ...clearView().nights,
        nightRow('2026-09-15', {
          source: 'session',
          usable: false,
          usableHours: 0.3,
          sessionIds: [ID(2)],
          forecastRatingIndex: 4,
        }),
        // Ohne Session, nur gespeicherte Vorhersage der Nacht (AP-64b).
        nightRow('2026-09-14', { forecastRatingIndex: 3, forecastNightMean: 0.7 }),
      ],
    };
    wrap(<SiteStatsPage />, path);
    const clear = await screen.findByRole('button', {
      name: /^18\.\/19\.09\. · klar, belichtet · 5,2 h nutzbar · Vorhersage Gut · Seeing 2,4″ · SQM 21,3$/,
    });
    expect(clear).toHaveAttribute('data-kind', 'clear');
    expect(screen.getByRole('button', { name: /^17\.\/18\.09\. · bewölkt/ })).toHaveAttribute(
      'data-kind',
      'cloudy',
    );
    expect(state.clearCalls[0]).toEqual([ID(600), '2026-09-01', '2026-09-25']);
    const tiles = screen.getByRole('region', { name: 'Kennzahlen des Standorts' });
    expect(within(tiles).getByText('50 %')).toBeTruthy();
    // Klar, aber nicht genutzt: eigene Klasse im Kalender und Zahl in der Kachel.
    expect(
      screen.getByRole('button', { name: /^15\.\/16\.09\. · klar, nicht genutzt/ }),
    ).toHaveAttribute('data-kind', 'clearUnused');
    expect(
      screen.getByRole('button', {
        name: /^14\.\/15\.09\. · klar, nicht genutzt · Vorhersage Gut$/,
      }),
    ).toHaveAttribute('data-kind', 'clearUnused');
    expect(within(tiles).getByText(/davon klar, ungenutzt: 2/)).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Legende' }).textContent).toContain(
      'klar, nicht genutzt',
    );
    expect(within(tiles).getByText('100 %')).toBeTruthy();
    expect(
      screen.getByRole('img', { name: 'SQM in 1 Nächten, 21,3 mag/″² bis 21,3 mag/″²' }),
    ).toBeTruthy();
    await expectNoSeriousA11y();
    fireEvent.click(clear);
    expect(screen.getByTestId('where').textContent).toBe(`/auswertung/naechte/${ID(1)}`);
  });

  it('Nacht ohne Session: „bewölkt erfassen“ bzw. zurücknehmen (Admin); Tabelle auf Wunsch', async () => {
    state.mark.mockResolvedValue(undefined);
    state.clear = { ...clearView(), from: '2026-09-01', to: '2026-09-25' };
    wrap(<SiteStatsPage />, path);
    fireEvent.click(await screen.findByRole('button', { name: /^16\.\/17\.09\. · keine Angabe/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Als bewölkt erfassen' }));
    await waitFor(() => expect(state.mark).toHaveBeenCalledWith(ID(600), '2026-09-16', true));
    fireEvent.click(screen.getByRole('button', { name: /^17\.\/18\.09\. · bewölkt/ }));
    expect(screen.getByText('Nacht 17./18.09. ist als bewölkt erfasst.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'zurücknehmen' }));
    await waitFor(() => expect(state.mark).toHaveBeenCalledWith(ID(600), '2026-09-17', false));
    fireEvent.click(screen.getByRole('button', { name: 'Alle Nächte als Tabelle' }));
    const table = screen.getByRole('table', { name: 'Nächte' });
    expect(within(table).getByRole('row', { name: /18\.\/19\.09\./ })).toBeTruthy();
  });

  it('User: Nächte ohne Session sind nicht anklickbar', async () => {
    state.me = me('user');
    state.clear = { ...clearView(), from: '2026-09-01', to: '2026-09-25' };
    wrap(<SiteStatsPage />, path);
    await screen.findByRole('button', { name: /^18\.\/19\.09\./ });
    expect(screen.queryByRole('button', { name: /^16\.\/17\.09\./ })).toBeNull();
  });

  it('Klassen und Kalendermonate', () => {
    expect(dayKind(undefined)).toBe('none');
    expect(
      dayKind(nightRow('2026-09-01', { source: 'session', usable: true, sessionIds: [ID(1)] })),
    ).toBe('clear');
    expect(
      dayKind(nightRow('2026-09-01', { source: 'session', usable: false, sessionIds: [ID(1)] })),
    ).toBe('partial');
    expect(dayKind(nightRow('2026-09-01', { source: 'manual', usable: false }))).toBe('cloudy');
    // Klar, aber nicht genutzt (Entscheidung Sven 07.10.2026): Vorhersage gut oder besser, unter 1 h belichtet.
    expect(
      dayKind(
        nightRow('2026-09-01', {
          source: 'session',
          usable: false,
          usableHours: 0.4,
          sessionIds: [ID(1)],
          forecastRatingIndex: 3,
        }),
      ),
    ).toBe('clearUnused');
    expect(dayKind(nightRow('2026-09-01', { sessionIds: [ID(1)], forecastRatingIndex: 4 }))).toBe(
      'clearUnused',
    );
    expect(
      dayKind(nightRow('2026-09-01', { source: 'manual', usable: false, forecastRatingIndex: 4 })),
    ).toBe('cloudy');
    expect(
      dayKind(nightRow('2026-09-01', { source: 'session', usable: false, forecastRatingIndex: 2 })),
    ).toBe('partial');
    // Nacht ohne Session mit gespeicherter Vorhersage (AP-64b): gut oder besser → klar, nicht genutzt; sonst keine Angabe.
    expect(dayKind(nightRow('2026-09-01', { forecastRatingIndex: 3 }))).toBe('clearUnused');
    expect(dayKind(nightRow('2026-09-01', { forecastRatingIndex: 4 }))).toBe('clearUnused');
    expect(dayKind(nightRow('2026-09-01', { forecastRatingIndex: 2 }))).toBe('none');
    expect(calendarMonths('2026-07-15', '2026-10-07')).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(calendarMonths('2026-09-08', '2026-10-07')).toEqual(['2026-09', '2026-10']);
    expect(calendarMonths('2025-11-01', '2026-01-05')).toEqual(['2025-11', '2025-12', '2026-01']);
  });
});
