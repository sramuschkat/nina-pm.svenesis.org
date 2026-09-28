// @vitest-environment jsdom
/**
 * S-11 Standorte – Prüfung 28.09.2026: Koordinaten werden erst beim Verlassen übernommen („9° 8′ W“ ist
 * West, kein Teilwert +9,13), ungültige Koordinaten sperren *Speichern*, eine offene Remote-Verbindung
 * gehört zu ihrem Standort, ein Cache-Rest des vorigen Mandanten gilt nicht als gewählt, Zeitzonen wie
 * „UTC“ und „Asia/Kolkata“ sind gültig.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../test/setup';
import type { Me } from '../../api/client';
import { AuthProvider } from '../../auth';
import { isTimeZone } from '../../lib/time-zones';
import { SitesPage } from './SitesPage';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const state = vi.hoisted(() => ({
  me: null as unknown,
  lists: {} as Record<string, unknown[]>,
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  api: { me: () => Promise.resolve(state.me) },
  equipmentApi: {
    list: (kind: string) => Promise.resolve({ items: state.lists[kind] ?? [] }),
    create: (...a: unknown[]) => state.create(...a) as Promise<unknown>,
    update: (...a: unknown[]) => state.update(...a) as Promise<unknown>,
    weather: () => new Promise(() => undefined),
    nights: () => new Promise(() => undefined),
  },
}));

const me: Me = {
  identity: {
    id: ID(1),
    discordUserId: '1',
    username: 'u',
    globalName: 'Uta',
    avatarHash: null,
    mfa: true,
  },
  context: 'tenant',
  tenant: { id: ID(2), key: 'demo', name: 'Demo', timeZone: 'Europe/Berlin' },
  member: { id: ID(3), displayName: 'Uta', role: 'owner', effectiveRole: 'admin' },
  isSuperUser: false,
  mfaRequired: false,
  memberships: [{ tenantKey: 'demo', tenantName: 'Demo', role: 'owner' }],
};

const site = (n: number, name: string, over: Record<string, unknown> = {}) => ({
  id: ID(n),
  name,
  pierName: null,
  observatoryType: 'open_air',
  latitudeDeg: 52,
  longitudeDeg: 9.7,
  elevationM: 50,
  bortleClass: 4,
  timeZone: 'Europe/Berlin',
  weatherSafetyUrl: null,
  notes: '',
  ...over,
});

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
function wrap(children: ReactNode, client = newClient()) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AuthProvider>{children}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.me = me;
  state.lists = {
    sites: [site(12, 'Lissabon', { longitudeDeg: -9.1, timeZone: 'Europe/Lisbon' })],
  };
  state.create.mockReset();
  state.update.mockReset();
  state.update.mockImplementation((_k: string, id: string, body: object) =>
    Promise.resolve({ ...site(12, 'x'), id, ...body }),
  );
});

describe('S-11 Standorte: Koordinaten (Prüfung 28.09.2026)', () => {
  it('„9° 8′ W“ Taste für Taste: gespeichert wird West (−9,13), nicht der Teilwert', async () => {
    wrap(<SitesPage />);
    const lon = await screen.findByRole('textbox', { name: 'Länge' });
    fireEvent.focus(lon);
    for (const s of ['9', '9°', '9° ', '9° 8', '9° 8′', '9° 8′ ', '9° 8′ W'])
      fireEvent.change(lon, { target: { value: s } });
    fireEvent.blur(lon);
    fireEvent.submit(lon.closest('form') as HTMLFormElement);
    await waitFor(() => expect(state.update).toHaveBeenCalled());
    const body = state.update.mock.calls[0]?.[2] as { longitudeDeg: number };
    expect(body.longitudeDeg).toBeCloseTo(-9.1333, 3);
  });

  it('ungültige Koordinate: Fehler am Feld, Speichern gesperrt', async () => {
    wrap(<SitesPage />);
    const lat = await screen.findByRole('textbox', { name: 'Breite' });
    fireEvent.focus(lat);
    fireEvent.change(lat, { target: { value: '38° 43′ Q' } });
    fireEvent.blur(lat);
    expect(lat).toHaveAttribute('aria-invalid', 'true');
    expect(lat).toHaveValue('38° 43′ Q');
    fireEvent.submit(lat.closest('form') as HTMLFormElement);
    await new Promise((r) => setTimeout(r, 20));
    expect(state.update).not.toHaveBeenCalled();
    expect(lat).toHaveFocus();
    // Korrigiert: Speichern geht wieder.
    fireEvent.change(lat, { target: { value: '38° 43′ N' } });
    fireEvent.blur(lat);
    fireEvent.submit(lat.closest('form') as HTMLFormElement);
    await waitFor(() => expect(state.update).toHaveBeenCalled());
    const body = state.update.mock.calls[0]?.[2] as { latitudeDeg: number };
    expect(body.latitudeDeg).toBeCloseTo(38 + 43 / 60, 5);
  });
});

describe('S-11 Standorte: Auswahl und Mandant (Prüfung 28.09.2026)', () => {
  it('Remote-Verbindung in Bearbeitung wird beim Standortwechsel verworfen', async () => {
    state.lists = {
      sites: [site(10, 'Alpha'), site(11, 'Beta')],
      'site-links': [
        {
          id: ID(50),
          siteId: ID(10),
          serviceType: 'anydesk',
          name: 'Alpha-PC',
          remoteIdOrUrl: '123',
          notes: '',
          isDefault: false,
        },
      ],
      rigs: [],
    };
    wrap(<SitesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Alpha-PC' }));
    expect(screen.getAllByDisplayValue('Alpha-PC')).toHaveLength(1);
    const list = screen.getByRole('region', { name: /Standorte/ });
    fireEvent.click(within(list).getByRole('button', { name: /Beta/ }));
    await screen.findByRole('heading', { level: 2, name: 'Beta' });
    expect(screen.queryAllByDisplayValue('Alpha-PC')).toHaveLength(0);
    expect(state.update).not.toHaveBeenCalled();
  });

  it('Cache-Rest des vorigen Mandanten: nach dem Neuladen gilt der neue Standort als gewählt', async () => {
    const client = newClient();
    client.setQueryData(['equipment', 'sites'], [site(10, 'Mandant-A-Sternwarte')]);
    state.lists = { sites: [site(20, 'Mandant-B-Garten')], rigs: [], 'site-links': [] };
    wrap(<SitesPage />, client);
    await screen.findByRole('heading', { level: 2, name: 'Mandant-B-Garten' });
    expect(screen.queryByDisplayValue('Mandant-A-Sternwarte')).not.toBeInTheDocument();
    fireEvent.submit(
      screen.getByDisplayValue('Mandant-B-Garten').closest('form') as HTMLFormElement,
    );
    await waitFor(() => expect(state.update).toHaveBeenCalled());
    expect(state.update.mock.calls[0]?.[1]).toBe(ID(20));
  });
});

describe('Zeitzonen (Prüfung 28.09.2026)', () => {
  it('gültig ist, was die Laufzeit kennt – auch „UTC“, „Asia/Kolkata“, „Europe/Kyiv“', () => {
    for (const zone of ['UTC', 'Asia/Kolkata', 'Europe/Kyiv', 'America/Chicago'])
      expect(isTimeZone(zone)).toBe(true);
    expect(isTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isTimeZone('')).toBe(false);
  });

  it('Standort in „UTC“: kein Hinweis „Unbekannte Zeitzone“', async () => {
    state.lists = { sites: [site(12, 'Station', { timeZone: 'UTC', longitudeDeg: 0 })] };
    wrap(<SitesPage />);
    await screen.findByRole('heading', { level: 2, name: 'Station' });
    expect(screen.queryByText('Unbekannte Zeitzone')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Zeitzone'), { target: { value: 'Mars/Olympus' } });
    expect(screen.getByText('Unbekannte Zeitzone')).toBeInTheDocument();
  });
});
