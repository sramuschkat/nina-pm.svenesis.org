// @vitest-environment jsdom
/**
 * AP-14c: S-42 NINA-Instanzen & Tokens (Token nur einmal, Widerrufen und Session übernehmen über den
 * ConfirmDialog, Profil-Abweichung, Zustand, Diagnose), S-41 „An NINA ausgeliefert“ (Karten, Filter,
 * Gruppieren, Aus Auslieferung nehmen nur Admin), Übernahmestatus (FA-SIM-09, Standortzeit mit Kürzel),
 * Reiter nach Rolle; axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { Me, NinaInstance, NinaRigDelivery } from '../../api/client';
import { AuthProvider } from '../../auth';
import { DeliveryPage } from './DeliveryPage';
import { InstancesPage } from './InstancesPage';
import { NinaLayout } from './NinaLayout';
import { uptakeText } from './UptakeStatus';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TOKEN = `npm_${'Q'.repeat(43)}`;

const state = vi.hoisted(() => ({
  me: null as unknown,
  instances: [] as unknown[],
  deliveries: {} as Record<string, unknown>,
  create: vi.fn(),
  revoke: vi.fn(),
  release: vi.fn(),
  setStatus: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  api: { me: () => Promise.resolve(state.me) },
  equipmentApi: {
    list: (kind: string) =>
      Promise.resolve({
        items:
          kind === 'rigs'
            ? [
                { id: ID(500), name: 'Rig A', siteId: ID(1), telescopeId: ID(2), cameraId: ID(3) },
                { id: ID(501), name: 'Rig B', siteId: ID(4), telescopeId: ID(2), cameraId: ID(3) },
              ]
            : kind === 'sites'
              ? [
                  { id: ID(1), name: 'Starfront' },
                  { id: ID(4), name: 'Garten' },
                ]
              : [],
      }),
  },
  projectsApi: { setStatus: (...a: unknown[]) => state.setStatus(...a) as Promise<unknown> },
  ninaApi: {
    instances: () => Promise.resolve({ items: state.instances }),
    create: (...a: unknown[]) => state.create(...a) as Promise<unknown>,
    revoke: (...a: unknown[]) => state.revoke(...a) as Promise<unknown>,
    releaseLease: (...a: unknown[]) => state.release(...a) as Promise<unknown>,
    diagnostics: (id: string) =>
      Promise.resolve({
        instance: state.instances.find((i) => (i as { id: string }).id === id),
        calls: [
          {
            atUtc: '2026-09-18T14:00:00Z',
            method: 'GET',
            route: '/targets',
            status: 200,
            code: null,
            durationMs: 12,
          },
        ],
        errors: [
          {
            atUtc: '2026-09-18T13:00:00Z',
            method: 'POST',
            route: '/plan',
            status: 422,
            code: 'nina.night_invalid',
            durationMs: 30,
          },
        ],
        heartbeat: { state: 'running', pluginVersion: '1.0.0' },
      }),
    delivery: (rigId: string) => Promise.resolve(state.deliveries[rigId]),
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

const instance = (over: Partial<NinaInstance> = {}): NinaInstance => ({
  id: ID(10),
  rigId: ID(500),
  name: 'Beobachtungs-PC',
  tokenPrefix: 'npm_AbCd',
  status: 'active',
  pluginVersion: '1.0.0',
  engineVersion: '0.6.0',
  lastSeenAt: '2026-09-18T14:00:00Z',
  settingsVersionFetched: 12,
  settingsFetchedAt: '2026-09-17T18:02:00Z',
  createdAt: '2026-09-01T10:00:00Z',
  rigName: 'Rig A',
  rigSettingsVersion: 12,
  siteTimeZone: 'America/Chicago',
  profileLocation: { latDeg: 48.1, lonDeg: 11.6 },
  profileSiteMismatch: true,
  lastState: {
    state: 'running',
    blockedReason: null,
    sessionId: ID(70),
    receivedAtUtc: '2026-09-18T14:00:00Z',
    mismatchCodes: ['af_time_trigger_missing'],
  },
  lease: { activeSessionId: ID(70), untilUtc: '2026-09-18T14:03:00Z', offlineUntilUtc: null },
  ...over,
});

const delivery = (rigId: string, over: Partial<NinaRigDelivery> = {}): NinaRigDelivery => ({
  rigId,
  rigName: rigId === ID(500) ? 'Rig A' : 'Rig B',
  deliveryEnabled: true,
  night: '2026-09-18',
  generatedAtUtc: '2026-09-18T14:00:00Z',
  settingsVersion: 12,
  targetsEtag: '"t-1"',
  items: [],
  ...over,
});

const item = (n: number, over: Partial<NinaRigDelivery['items'][number]> = {}) => ({
  id: ID(200 + n),
  name: `Ziel ${String(n)}`,
  targetName: null,
  projectType: 'deep_sky' as const,
  status: 'active' as const,
  priority: n,
  version: 3,
  updatedAt: '2026-09-17T10:00:00Z',
  panelCount: 1,
  raDeg: 13.2,
  decDeg: 56.6,
  rotationDeg: 12.5,
  filters: [
    {
      filterId: ID(300),
      filterShortName: 'Ha',
      ninaFilterName: 'Ha 3nm',
      planned: 40,
      accepted: 10,
    },
    { filterId: ID(301), filterShortName: 'OIII', ninaFilterName: null, planned: 20, accepted: 0 },
  ],
  ...over,
});

const renderAt = (path: string, element: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes>
            <Route path="/nina" element={<NinaLayout />}>
              <Route path="instanzen" element={element} />
              <Route path="ausgeliefert" element={element} />
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  state.me = me('owner');
  state.instances = [instance()];
  state.deliveries = {
    [ID(500)]: delivery(ID(500), { items: [item(1), item(2, { panelCount: 4, name: 'Mosaik' })] }),
    [ID(501)]: delivery(ID(501), { deliveryEnabled: false }),
  };
  for (const fn of [state.create, state.revoke, state.release, state.setStatus]) fn.mockReset();
});

describe('Übernahmestatus (FA-SIM-09)', () => {
  const t = (k: string, o?: Record<string, unknown>) => `${k} ${JSON.stringify(o ?? {})}`;
  it('übernommen, noch nicht abgerufen, nie abgerufen – Standortzeit mit Kürzel', () => {
    expect(uptakeText(instance(), t, 'de')).toEqual({
      text: 'nina.uptake.taken {"version":12,"at":"17.09.2026 13:02 CDT"}',
      current: true,
    });
    expect(uptakeText(instance({ rigSettingsVersion: 13 }), t, 'de').current).toBe(false);
    expect(uptakeText(instance({ rigSettingsVersion: 13 }), t, 'de').text).toContain(
      'nina.uptake.pending',
    );
    expect(
      uptakeText(instance({ settingsVersionFetched: null, settingsFetchedAt: null }), t, 'de').text,
    ).toContain('nina.uptake.never');
  });
});

describe('S-42 NINA-Instanzen & Tokens', () => {
  it('Tabelle mit Präfix, Versionen, Profil-Abweichung, Zustand; Reiter nur für Admin; axe', async () => {
    renderAt('/nina/instanzen', <InstancesPage />);
    expect(await screen.findByRole('button', { name: 'Beobachtungs-PC' })).toBeTruthy();
    expect(screen.getByText('npm_AbCd…')).toBeTruthy();
    expect(screen.getByText('1.0.0 / 0.6.0')).toBeTruthy();
    expect(screen.getByText('weicht vom Rig-Standort ab')).toBeTruthy();
    expect(screen.getByText('läuft')).toBeTruthy();
    expect(screen.getByText('1 Abweichungen')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'NINA-Instanzen' })).toBeTruthy();
    await expectNoSeriousA11y();
  });

  it('Neue Instanz: Token genau einmal sichtbar, nach „Fertig“ weg', async () => {
    state.create.mockResolvedValue({ ...instance({ id: ID(11), name: 'Neu' }), token: TOKEN });
    renderAt('/nina/instanzen', <InstancesPage />);
    await screen.findByRole('button', { name: 'Beobachtungs-PC' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Neu' } });
    await waitFor(() =>
      expect((screen.getByLabelText('Rig') as HTMLSelectElement).value).toBe(ID(500)),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Instanz anlegen' }));
    expect((await screen.findByTestId('nina-token')).textContent).toBe(TOKEN);
    expect(state.create).toHaveBeenCalledWith(
      expect.objectContaining({ rigId: ID(500), name: 'Neu' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fertig' }));
    expect(screen.queryByText(TOKEN)).toBeNull();
  });

  it('Widerrufen und Session übernehmen nur über den ConfirmDialog; Diagnose mit Aufrufen und Fehlern', async () => {
    state.revoke.mockResolvedValue(instance({ status: 'revoked' }));
    state.release.mockResolvedValue({ releasedSessionId: ID(70) });
    renderAt('/nina/instanzen', <InstancesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Beobachtungs-PC' }));
    const detail = screen.getByRole('region', { name: 'Beobachtungs-PC' });
    expect(await within(detail).findByText('GET /targets')).toBeTruthy();
    expect(within(detail).getByText('nina.night_invalid')).toBeTruthy();
    expect(within(detail).getByText('Trigger „Autofokus nach Zeit“ fehlt')).toBeTruthy();
    expect(
      within(detail).getByText(/Lease: Session 00000000 bis 18\.09\.2026 09:03 CDT/),
    ).toBeTruthy();

    fireEvent.click(within(detail).getByRole('button', { name: 'Widerrufen' }));
    let dialog = await screen.findByRole('alertdialog');
    expect(state.revoke).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Widerrufen' }));
    await waitFor(() => expect(state.revoke).toHaveBeenCalledWith(ID(10)));

    fireEvent.click(within(detail).getByRole('button', { name: 'Session übernehmen' }));
    dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Session übernehmen' }));
    await waitFor(() => expect(state.release).toHaveBeenCalledWith(ID(500)));
    await expectNoSeriousA11y();
  });

  it('freies Rig: Session übernehmen gesperrt; leere Liste zeigt den Hinweis', async () => {
    state.instances = [instance({ lease: null, lastState: null, profileLocation: null })];
    const { unmount } = renderAt('/nina/instanzen', <InstancesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Beobachtungs-PC' }));
    const detail = screen.getByRole('region', { name: 'Beobachtungs-PC' });
    expect(
      (within(detail).getByRole('button', { name: 'Session übernehmen' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText('nicht gemeldet')).toBeTruthy();
    unmount();
    state.instances = [];
    renderAt('/nina/instanzen', <InstancesPage />);
    expect(await screen.findByText('Noch keine NINA-Instanz gekoppelt.')).toBeTruthy();
  });
});

describe('S-41 An NINA ausgeliefert', () => {
  it('Karten mit Einzelfeld/Mosaik, RA/Dec, Rotation, Rig, Fortschritt je Filter; Hinweis ausgeschaltet; axe', async () => {
    renderAt('/nina/ausgeliefert', <DeliveryPage />);
    const card = (await screen.findByRole('article', { name: 'Ziel 1' })) as HTMLElement;
    expect(within(card).getByText('Einzelfeld')).toBeTruthy();
    expect(within(card).getByText(/^RA .* · Dec /)).toBeTruthy();
    expect(within(card).getByText('Rotation 12.5°')).toBeTruthy();
    expect(within(card).getByText('Rig Rig A')).toBeTruthy();
    expect(within(card).getByText('ohne NINA-Filter')).toBeTruthy();
    expect(screen.getByText('Mosaik mit 4 Panels')).toBeTruthy();
    expect(screen.getByText('An NINA ausliefern ist für Rig B ausgeschaltet.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Rig Rig A · Nacht 18./19.09.' })).toBeTruthy();
    await expectNoSeriousA11y();
  });

  it('Filter Standort und Sortierung nach Name; Gruppieren nach Status', async () => {
    renderAt('/nina/ausgeliefert', <DeliveryPage />);
    await screen.findByRole('article', { name: 'Ziel 1' });
    fireEvent.change(screen.getByLabelText('Standort'), { target: { value: ID(4) } });
    expect(await screen.findByText('NINA erhält derzeit keine Ziele.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Standort'), { target: { value: '' } });
    await screen.findByRole('article', { name: 'Ziel 1' });
    fireEvent.change(screen.getByLabelText('Sortieren'), { target: { value: 'name' } });
    fireEvent.change(screen.getByLabelText('Gruppieren'), { target: { value: 'status' } });
    expect(screen.getByRole('heading', { name: 'Aktiv' })).toBeTruthy();
    expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-labelledby'))).toEqual([
      `delivery-${ID(202)}`,
      `delivery-${ID(201)}`,
    ]);
  });

  it('Admin nimmt ein Ziel über den ConfirmDialog aus der Auslieferung (Pausiert); User sieht die Aktion nicht', async () => {
    state.setStatus.mockResolvedValue({});
    const { unmount } = renderAt('/nina/ausgeliefert', <DeliveryPage />);
    const card = (await screen.findByRole('article', { name: 'Ziel 1' })) as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Aus Auslieferung nehmen' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Aus Auslieferung nehmen' }));
    await waitFor(() => expect(state.setStatus).toHaveBeenCalledWith(ID(201), 'on_hold'));
    unmount();
    state.me = me('user');
    renderAt('/nina/ausgeliefert', <DeliveryPage />);
    await screen.findByRole('article', { name: 'Ziel 1' });
    expect(screen.queryByRole('button', { name: 'Aus Auslieferung nehmen' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'NINA-Instanzen' })).toBeNull();
  });
});
