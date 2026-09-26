// @vitest-environment jsdom
/**
 * S-30 Projektliste (AP-11c): Filter, Gruppen je Rig mit Zählern, Priorität (Position unter den
 * freigegebenen Projekten), Rechte (Ansicht „Gelöscht“ nur Admin), Löschen über `ConfirmDialog`,
 * Wiederherstellen ohne Dialog, axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { Me, ProjectListItem } from '../../api/client';
import { AuthProvider } from '../../auth';
import {
  NO_FILTERS,
  NO_RIG,
  filterOptions,
  filterProjects,
  groupByRig,
  movedPosition,
} from './list-model';
import { ProjectListPage } from './ProjectListPage';

const state = vi.hoisted(() => ({
  me: null as unknown,
  items: [] as unknown[],
  deleted: [] as unknown[],
  remove: vi.fn(),
  restore: vi.fn(),
  priority: vi.fn(),
  favorite: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  api: { me: () => Promise.resolve(state.me) },
  equipmentApi: {
    list: (kind: string) =>
      Promise.resolve({
        items:
          kind === 'rigs'
            ? [
                {
                  id: 'rig-a',
                  name: 'Rig A',
                  siteId: 's',
                  telescopeId: 't',
                  cameraId: 'c',
                  filterWheel: [],
                },
              ]
            : [],
      }),
    nights: () => Promise.reject(new Error('nicht im Test')),
  },
  projectsApi: {
    list: (q?: string) =>
      Promise.resolve({ items: q === '?deleted=true' ? state.deleted : state.items }),
    remove: (...a: unknown[]) => state.remove(...a) as Promise<unknown>,
    restore: (...a: unknown[]) => state.restore(...a) as Promise<unknown>,
    priority: (...a: unknown[]) => state.priority(...a) as Promise<unknown>,
    favorite: (...a: unknown[]) => state.favorite(...a) as Promise<unknown>,
  },
}));

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const me = (role: 'owner' | 'user'): Me => ({
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
  member: {
    id: ID(3),
    displayName: 'Uta',
    role,
    effectiveRole: role === 'user' ? 'user' : 'admin',
  },
  isSuperUser: false,
  mfaRequired: false,
  memberships: [{ tenantKey: 'demo', tenantName: 'Demo', role }],
});

const item = (n: number, over: Partial<ProjectListItem> = {}): ProjectListItem =>
  ({
    id: ID(100 + n),
    name: `Projekt ${String(n)}`,
    projectType: 'deep_sky',
    rigId: 'rig-a',
    createdBy: ID(3),
    createdByName: 'Uta',
    targetName: null,
    targetType: 'Galaxie',
    catalogNames: '',
    raDeg: 10,
    decDeg: 41,
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
    version: 1,
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
    panelCount: 1,
    filters: [],
    ...over,
  }) as ProjectListItem;

function renderPage() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <AuthProvider>
          <ProjectListPage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.me = me('owner');
  state.items = [];
  state.deleted = [];
  for (const fn of [state.remove, state.restore, state.priority, state.favorite]) fn.mockReset();
});

describe('Modell (FA-PRJ-13/14/19)', () => {
  const a = item(1, { approvalStatus: 'approved', status: 'active', priority: 2, name: 'B-Ziel' });
  const b = item(2, { approvalStatus: 'approved', status: 'active', priority: 1, name: 'A-Ziel' });
  const c = item(3, { name: 'Entwurf', createdBy: ID(9), createdByName: 'Zoe', targetType: null });
  const d = item(4, { rigId: null, name: 'Ohne Rig', favorite: true });

  it('Filter nach Ersteller, Freigabestatus, Favoriten, ohne Rig; Auswahlwerte aus der Liste', () => {
    const all = [a, b, c, d];
    expect(filterProjects(all, { ...NO_FILTERS, createdBy: ID(9) }).map((p) => p.id)).toEqual([
      c.id,
    ]);
    expect(filterProjects(all, { ...NO_FILTERS, approvalStatus: 'approved' })).toHaveLength(2);
    expect(filterProjects(all, { ...NO_FILTERS, favorites: true })).toEqual([d]);
    expect(filterProjects(all, { ...NO_FILTERS, rigId: NO_RIG })).toEqual([d]);
    expect(filterOptions(all)).toEqual({
      targetTypes: ['Galaxie'],
      creators: [
        { id: ID(3), name: 'Uta' },
        { id: ID(9), name: 'Zoe' },
      ],
    });
  });

  it('Gruppen je Rig: freigegebene nach Priorität, dann übrige; Zähler je Status; ohne Rig zuletzt', () => {
    const groups = groupByRig([d, a, c, b], ['rig-a']);
    expect(groups.map((g) => g.rigId)).toEqual(['rig-a', NO_RIG]);
    expect(groups[0]?.items.map((p) => p.name)).toEqual(['A-Ziel', 'B-Ziel', 'Entwurf']);
    expect(groups[0]?.counts).toEqual([
      { key: 'active', kind: 'project', n: 2 },
      { key: 'draft', kind: 'approval', n: 1 },
    ]);
  });

  it('Verschieben ergibt die Position unter den freigegebenen Projekten', () => {
    expect(movedPosition([a, b, c], a.id, -1)).toBe(1);
    expect(movedPosition([a, b, c], b.id, -1)).toBeNull();
    expect(movedPosition([a, b, c], c.id, 1)).toBeNull(); // Entwurf hat keine Priorität
  });
});

describe('S-30 (Komponente)', () => {
  it('Admin: Gruppe mit Kopfzeile, Filter, Löschen über ConfirmDialog; axe', async () => {
    state.items = [
      item(1, { approvalStatus: 'approved', status: 'active', priority: 1, name: 'NGC 281' }),
      item(2, { name: 'M 31', createdBy: ID(9), createdByName: 'Zoe' }),
    ];
    state.remove.mockResolvedValue(undefined);
    renderPage();
    // Rig-Gruppe als Zwischenüberschrift in einer gemeinsamen Tabelle (AP-26a)
    const group = await screen.findByRole('columnheader', { name: /Rig A/ });
    expect(group).toHaveTextContent('1 Aktiv · 1 Entwurf');
    expect(screen.getAllByRole('table')).toHaveLength(1);
    // Sortieren per Spaltenkopf: Name aufsteigend, Pfeile der Priorität verschwinden
    const names = () =>
      screen.getAllByRole('link').filter((l) => ['NGC 281', 'M 31'].includes(l.textContent ?? ''));
    expect(names().map((l) => l.textContent)).toEqual(['NGC 281', 'M 31']);
    expect(screen.getByRole('button', { name: /NGC 281.*oben|nach oben/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Name/ }));
    expect(names().map((l) => l.textContent)).toEqual(['M 31', 'NGC 281']);
    expect(screen.queryByRole('button', { name: /nach oben/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Name/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Name/ }));
    expect(screen.getByRole('tab', { name: 'Gelöscht' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Ersteller'), { target: { value: ID(9) } });
    expect(screen.queryByRole('link', { name: 'NGC 281' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'M 31' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '„M 31“ löschen' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Papierkorb');
    await expectNoSeriousA11y();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(state.remove).toHaveBeenCalledWith(ID(102)));
  });

  it('Karte: Katalogbild bei verknüpftem Katalogobjekt, sonst Platzhalter (AP-20)', async () => {
    state.items = [
      item(1, { name: 'M 31 – Andromeda', targetName: 'M 31', dsoPrimaryId: 'NGC 224' }),
      item(2, { name: 'Frei', dsoPrimaryId: null }),
    ];
    renderPage();
    fireEvent.click(await screen.findByRole('radio', { name: 'Karten' }));
    const img = await screen.findByRole('img', { name: 'Vorschaubild M 31' });
    expect(img).toHaveAttribute('src', '/catalog/img/ngc-l/ngc224.jpg');
    expect(screen.getAllByText('Vorschaubild folgt')).toHaveLength(1);
    // 320 px fehlt → 128 px, fehlt auch das → Platzhalter.
    fireEvent.error(img);
    fireEvent.error(screen.getByRole('img', { name: 'Vorschaubild M 31' }));
    expect(screen.getAllByText('Vorschaubild folgt')).toHaveLength(2);
  });

  it('Priorität mit Pfeilen (nur Admin, freigegebene Projekte)', async () => {
    state.items = [
      item(1, { approvalStatus: 'approved', status: 'active', priority: 1, name: 'Erstes' }),
      item(2, { approvalStatus: 'approved', status: 'active', priority: 2, name: 'Zweites' }),
    ];
    state.priority.mockResolvedValue({});
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '„Zweites“ nach oben' }));
    await waitFor(() => expect(state.priority).toHaveBeenCalledWith(ID(102), 1));
    expect(screen.getByRole('button', { name: '„Erstes“ nach oben' })).toBeDisabled();
  });

  it('Gelöscht: Löschzeitpunkt mit Kürzel, Wiederherstellen ohne Dialog', async () => {
    state.deleted = [item(5, { name: 'Weg', deletedAt: '2026-09-20T18:30:00Z' })];
    state.restore.mockResolvedValue({});
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'Gelöscht' }));
    const row = (await screen.findByText('Weg')).closest('tr') as HTMLElement;
    expect(row).toHaveTextContent(/20:30 MESZ/);
    fireEvent.click(within(row).getByRole('button', { name: 'Wiederherstellen' }));
    await waitFor(() => expect(state.restore).toHaveBeenCalledWith(ID(105)));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('User: keine Ansicht „Gelöscht“, keine Prioritätsspalte, Freigabestatus-Kennzeichen', async () => {
    state.me = me('user');
    state.items = [item(1, { approvalStatus: 'submitted', name: 'Mein Objekt' })];
    renderPage();
    expect(await screen.findByRole('link', { name: 'Mein Objekt' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Gelöscht' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Priorität' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Eingereicht').length).toBeGreaterThan(0);
  });
});
