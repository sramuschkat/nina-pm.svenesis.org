// @vitest-environment jsdom
/**
 * S-31 Projekt-Editor – Prüfung 28.09.2026 (verlorene Änderungen): Der Entwurf merkt sich seine Basis.
 * Lädt der Fensterfokus eine neuere Fassung, übernimmt der Entwurf fremde Änderungen an anderen Feldern
 * und speichert nur die eigenen mit der neuen Version; ändern beide dasselbe Feld, erscheint der
 * Konflikthinweis und gespeichert wird mit der alten Version (Server: 412).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import '../../../test/setup';
import type { Me, ProjectView } from '../../api/client';
import { AuthProvider } from '../../auth';
import { ProjectEditorPage } from './ProjectEditorPage';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Unbekannte Aufrufe bleiben offen (Diagramme, Katalog, Wetter …) – hier geht es nur ums Speichern. */
const { state, open, pending } = vi.hoisted(() => {
  const pending = () => new Promise(() => undefined);
  return {
    state: {
      me: null as unknown,
      project: null as unknown,
      patch: vi.fn(),
      approve: vi.fn(),
      selfApproval: true,
    },
    pending,
    open: (impl: Record<string, unknown>) =>
      new Proxy(impl, { get: (target, key: string) => target[key] ?? pending }),
  };
});

vi.mock('../../api/client', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    api: open({ me: () => Promise.resolve(state.me) }),
    projectsApi: open({
      get: () => Promise.resolve(state.project),
      patch: (...a: unknown[]) => state.patch(...a) as Promise<unknown>,
    }),
    equipmentApi: open({ list: () => Promise.resolve({ items: [] }) }),
    approvalApi: open({ approve: (...a: unknown[]) => state.approve(...a) as Promise<unknown> }),
    tenantApi: open({
      settings: () => Promise.resolve({ settings: { adminSelfApproval: state.selfApproval } }),
    }),
    catalogApi: open({}),
    changeRequestsApi: open({}),
    tonightApi: open({}),
    forecastApi: open({}),
    reportsApi: open({}),
    sessionsApi: open({}),
  };
});

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

const project = (over: Partial<ProjectView> = {}): ProjectView =>
  ({
    id: ID(10),
    name: 'NGC 281',
    projectType: 'deep_sky',
    rigId: null,
    createdBy: ID(3),
    targetName: 'NGC 281',
    targetType: 'Nebel',
    dsoObjectId: null,
    dsoPrimaryId: null,
    catalogNames: '',
    descriptionMd: '',
    raDeg: null,
    decDeg: null,
    rotationDeg: 0,
    startDate: null,
    dueDate: null,
    requestPeriodFrom: null,
    requestPeriodTo: null,
    requestComment: null,
    conditions: {
      minAltitudeDeg: 30,
      minTimeOnTargetH: 1,
      twilight: 'astronomical',
      moonAvoidanceEnabled: false,
      moonMustBeDown: false,
      moonSeparationDeg: 60,
      moonWidthDays: 5,
      moonRelaxScale: 2,
      moonMinAltDeg: -15,
      moonMaxAltDeg: 5,
      moonMaxIlluminationPct: 60,
    },
    approvalStatus: 'draft',
    status: null,
    priority: 0,
    effortStale: true,
    effort: null,
    favorite: false,
    version: 3,
    deletedAt: null,
    createdAt: '2026-09-24T10:00:00Z',
    updatedAt: '2026-09-24T10:00:00Z',
    progress: {
      targetReached: false,
      finished: false,
      planningNeed: 0,
      percentDone: 0,
      plannedS: 0,
      integrationS: 0,
    },
    mosaic: { cols: 1, rows: 1, overlapPct: 0 },
    panels: [],
    ...over,
  }) as ProjectView;

function renderEditor(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/projekte/${ID(10)}`]}>
        <AuthProvider>
          <Routes>
            <Route path="/projekte/:id" element={<ProjectEditorPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.me = me;
  state.project = project();
  state.patch.mockReset();
  state.approve.mockReset();
  state.selfApproval = true;
});

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

it('fremde Änderung an einem anderen Feld wird übernommen, nicht zurückgesetzt', async () => {
  state.patch.mockImplementation((_id: string, body: object, v: number) =>
    Promise.resolve(project({ ...body, targetName: 'Pacman', version: v + 1 })),
  );
  const client = newClient();
  renderEditor(client);
  const type = await screen.findByLabelText('Objekttyp');
  fireEvent.change(type, { target: { value: 'Emissionsnebel' } });
  // Anderer Admin ändert den Zielnamen (v4); der Fensterfokus lädt neu.
  state.project = project({ targetName: 'Pacman', version: 4 });
  await act(() => client.invalidateQueries({ queryKey: ['project', ID(10)] }));
  await waitFor(() => expect(screen.getByLabelText('Zielname')).toHaveValue('Pacman'));
  expect(screen.getByLabelText('Objekttyp')).toHaveValue('Emissionsnebel');
  expect(screen.queryByText(/Jemand anderes hat den Datensatz/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(1));
  expect(state.patch.mock.calls[0]?.slice(1)).toEqual([{ targetType: 'Emissionsnebel' }, 4]);
});

it('fremde Änderung am selben Feld: Konflikthinweis, gespeichert wird mit der alten Version', async () => {
  state.patch.mockReturnValue(pending());
  const client = newClient();
  renderEditor(client);
  const type = await screen.findByLabelText('Objekttyp');
  fireEvent.change(type, { target: { value: 'Emissionsnebel' } });
  state.project = project({ targetType: 'HII-Region', version: 4 });
  await act(() => client.invalidateQueries({ queryKey: ['project', ID(10)] }));
  expect(await screen.findByText(/Jemand anderes hat den Datensatz/)).toBeInTheDocument();
  expect(screen.getByLabelText('Objekttyp')).toHaveValue('Emissionsnebel');
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(1));
  expect(state.patch.mock.calls[0]?.slice(1)).toEqual([{ targetType: 'Emissionsnebel' }, 3]);
});

it('Admin gibt den eigenen Entwurf direkt frei (FA-PRJ-18, FA-FRG-10): Rig des Projekts, Status aktiv, Version', async () => {
  state.project = project({ rigId: ID(20) });
  state.approve.mockResolvedValue(
    project({ rigId: ID(20), approvalStatus: 'approved', status: 'active', version: 4 }),
  );
  renderEditor(newClient());
  const button = await screen.findByRole('button', { name: 'Freigeben & aktivieren' });
  expect(screen.queryByRole('button', { name: 'Einreichen' })).not.toBeInTheDocument();
  fireEvent.click(button);
  await waitFor(() =>
    expect(state.approve).toHaveBeenCalledWith(ID(10), { rigId: ID(20), status: 'active' }, 3),
  );
});

it('ohne „Admin-Objekte ohne Warteschlange“ bleibt Einreichen; ohne Rig ist Freigeben gesperrt', async () => {
  state.selfApproval = false;
  const first = renderEditor(newClient());
  expect(await screen.findByRole('button', { name: 'Einreichen' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Freigeben & aktivieren' })).not.toBeInTheDocument();
  first.unmount();
  state.selfApproval = true;
  state.project = project({ rigId: null });
  renderEditor(newClient());
  expect(await screen.findByRole('button', { name: 'Freigeben & aktivieren' })).toBeDisabled();
});
