// @vitest-environment jsdom
/**
 * S-30 Projektliste (AP-11c): Filter (Filterleiste mit Chips, AP-26c), Gruppen je Rig mit Zählern,
 * Priorität (Position unter den freigegebenen Projekten), Rechte (Papierkorb nur Admin), Löschen im
 * Zeilenmenü ⋯ (AP-26d) über `ConfirmDialog`, Wiederherstellen ohne Dialog, axe. Seit 30.09.2026: Status-Chips
 * mit Anzahl (Mehrfachauswahl, Adresse), Schalter *Alle / Meine*, Gruppierung je Status bzw. ohne, Kommentar der
 * Freigabe bei zurückgegebenen Projekten, *Einreichen* im Zeilenmenü (vorher „Meine Objekte“/„Entwürfe“).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { Me, ProjectListItem } from '../../api/client';
import { AuthProvider, useAuth } from '../../auth';
import {
  NO_FILTERS,
  NO_RIG,
  filterOptions,
  filterProjects,
  groupByRig,
  groupByStatus,
  lifecycleStatus,
  listStateFromParams,
  movedPosition,
  priorityRank,
  statusCounts,
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
  history: [] as unknown[],
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
    history: () => Promise.resolve({ items: state.history }),
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
    commentCount: 0,
    ...over,
  }) as ProjectListItem;

/** Wie `RequireContext` in der App: die Seite erst mit geladener Sitzung zeichnen (Rechte stehen fest). */
function AfterAuth({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  return me === undefined ? null : children;
}

/** Aktuelle Adresse (Suche und Pfad) für Prüfungen der URL. */
function Where() {
  const loc = useLocation();
  return <span data-testid="where">{`${loc.pathname}${loc.search}`}</span>;
}

function renderPage(path = '/projekte') {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <AfterAuth>
            <ProjectListPage />
            <Where />
          </AfterAuth>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.me = me('owner');
  state.items = [];
  state.deleted = [];
  state.history = [];
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
    expect(filterProjects(all, { ...NO_FILTERS, statuses: ['active'] })).toHaveLength(2);
    expect(filterProjects(all, { ...NO_FILTERS, statuses: ['active', 'draft'] })).toHaveLength(4);
    expect(filterProjects(all, { ...NO_FILTERS, mine: true }, ID(9))).toEqual([c]);
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

  it('Status über die Lebensdauer; Anzahl ohne Statusauswahl; Gruppen je Status; Adresse', () => {
    expect(lifecycleStatus(a)).toBe('active');
    expect(lifecycleStatus(c)).toBe('draft');
    expect(lifecycleStatus(item(8, { approvalStatus: 'returned', status: 'planning' }))).toBe(
      'returned',
    );
    const counts = statusCounts([a, b, c, d], { ...NO_FILTERS, statuses: ['draft'] });
    expect(counts).toEqual({ total: 4, byStatus: { active: 2, draft: 2 } });
    expect(statusCounts([a, b, c, d], { ...NO_FILTERS, mine: true }, ID(9)).total).toBe(1);
    expect(groupByStatus([c, a, b]).map((g) => [g.key, g.items.map((p) => p.name)])).toEqual([
      ['draft', ['Entwurf']],
      ['active', ['A-Ziel', 'B-Ziel']],
    ]);
    expect(
      listStateFromParams(
        new URLSearchParams('status=draft,returned,unsinn&meine=1&gruppe=status'),
      ),
    ).toEqual({ statuses: ['draft', 'returned'], mine: true, groupBy: 'status' });
    expect(listStateFromParams(new URLSearchParams(''))).toEqual({
      statuses: [],
      mine: false,
      groupBy: 'rig',
    });
  });

  it('Verschieben ergibt die Position unter den freigegebenen Projekten', () => {
    expect(movedPosition([a, b, c], a.id, -1)).toBe(1);
    expect(movedPosition([a, b, c], b.id, -1)).toBeNull();
    expect(movedPosition([a, b, c], c.id, 1)).toBeNull(); // Entwurf hat keine Priorität
  });

  it('Prüfung 28.09.2026: mit Filter zählen Priorität und Verschieben in der ganzen Rig-Gruppe', () => {
    const p = (n: number, name: string) =>
      item(n, { approvalStatus: 'approved', status: 'active', priority: n, name });
    const all = [p(1, 'A'), p(2, 'B'), p(3, 'C'), p(4, 'D')];
    const shown = [all[1], all[3]] as typeof all; // sichtbar: B, D
    expect(priorityRank(all, ID(104))).toBe(4);
    // „D nach oben“ in der gefilterten Liste: D rückt vor B, also auf Position 2 (nicht 1).
    expect(movedPosition(all, ID(104), -1, shown)).toBe(2);
    expect(movedPosition(all, ID(102), 1, shown)).toBe(4);
    expect(movedPosition(all, ID(102), -1, shown)).toBeNull();
    expect(priorityRank(all, item(9, {}).id)).toBeNull();
  });
});

describe('S-30 (Komponente)', () => {
  it('Admin: Gruppe mit Kopfzeile, Filter, Löschen über ConfirmDialog; axe', async () => {
    const user = userEvent.setup();
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
    expect(screen.getByRole('button', { name: 'Papierkorb' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    fireEvent.change(screen.getByLabelText('Ersteller'), { target: { value: ID(9) } });
    expect(screen.queryByRole('link', { name: 'NGC 281' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'M 31' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Weitere Aktionen zu M 31' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Löschen' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Papierkorb');
    await expectNoSeriousA11y();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(state.remove).toHaveBeenCalledWith(ID(102)));
  });

  it('Zeilenmenü ⋯: Löschen nur mit Recht, Stern bleibt sichtbar, Abbrechen ohne Aufruf', async () => {
    const user = userEvent.setup();
    state.me = me('user');
    state.items = [
      item(1, { name: 'Mein Entwurf' }),
      item(2, {
        name: 'Fremd',
        createdBy: ID(9),
        createdByName: 'Zoe',
        approvalStatus: 'approved',
        status: 'active',
      }),
    ];
    state.remove.mockResolvedValue(undefined);
    renderPage();
    await screen.findByRole('link', { name: 'Mein Entwurf' });
    // Gruppenzeile schlank: Rig fett, Zähler in derselben Zeile.
    expect(screen.getByRole('columnheader', { name: /Rig A/ })).toHaveTextContent(
      '1 Aktiv · 1 Entwurf',
    );
    expect(screen.getByRole('button', { name: '„Fremd“ als Favorit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Weitere Aktionen zu Fremd' })).toBeNull();
    const more = screen.getByRole('button', { name: 'Weitere Aktionen zu Mein Entwurf' });
    await user.click(more);
    await user.click(await screen.findByRole('menuitem', { name: 'Löschen' }));
    let dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Projekt „Mein Entwurf“ löschen?');
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(state.remove).not.toHaveBeenCalled();
    await user.click(more);
    await user.click(await screen.findByRole('menuitem', { name: 'Löschen' }));
    dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(state.remove).toHaveBeenCalledWith(ID(101)));
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

  it('Kommentare (FA-PRJ-17): Sprechblase mit Zahl in Liste, Karten und Detail; bei 0 nichts', async () => {
    state.items = [item(1, { name: 'M 31', commentCount: 3 }), item(2, { name: 'Leer' })];
    renderPage();
    expect(await screen.findByRole('img', { name: 'Kommentare: 3' })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /^Kommentare/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('radio', { name: 'Karten' }));
    expect(await screen.findByRole('img', { name: 'Kommentare: 3' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Detail' }));
    expect(await screen.findByRole('img', { name: 'Kommentare: 3' })).toBeInTheDocument();
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

  it('Prüfung 28.09.2026: gefiltert zeigt die Liste die echte Priorität und verschiebt absolut', async () => {
    state.items = [1, 2, 3, 4].map((n) =>
      item(n, {
        approvalStatus: 'approved',
        status: 'active',
        priority: n,
        name: n % 2 === 0 ? `Nebel ${String(n)}` : `Galaxie ${String(n)}`,
      }),
    );
    state.priority.mockResolvedValue({});
    renderPage();
    await screen.findByRole('link', { name: 'Nebel 4' });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Suche' }), {
      target: { value: 'Nebel' },
    });
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Galaxie 1' })).not.toBeInTheDocument(),
    );
    const row = (name: string) => screen.getByRole('link', { name }).closest('tr') as HTMLElement;
    expect(within(row('Nebel 2')).getByText('2')).toBeInTheDocument();
    expect(within(row('Nebel 4')).getByText('4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '„Nebel 2“ nach oben' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '„Nebel 4“ nach oben' }));
    await waitFor(() => expect(state.priority).toHaveBeenCalledWith(ID(104), 2));
  });

  it('Chips: Filter setzen ergibt Chip, × entfernt ihn; Suche in Name und Katalognamen', async () => {
    state.items = [
      item(1, { name: 'NGC 281', createdBy: ID(9), createdByName: 'Zoe' }),
      item(2, { name: 'Andromeda', catalogNames: 'M 31, NGC 224', targetType: 'Nebel' }),
    ];
    renderPage();
    await screen.findByRole('link', { name: 'NGC 281' });
    expect(screen.getByRole('status')).toHaveTextContent('2 von 2 Projekten');
    const more = screen.getByRole('button', { name: 'Filter' });
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    fireEvent.change(screen.getByLabelText('Objekttyp'), { target: { value: 'Nebel' } });
    fireEvent.change(screen.getByLabelText('Rig'), { target: { value: 'rig-a' } });
    const chips = screen.getByRole('list', { name: 'Aktive Filter' });
    expect(chips).toHaveTextContent('Objekttyp: Nebel');
    expect(chips).toHaveTextContent('Rig: Rig A');
    expect(screen.queryByRole('link', { name: 'NGC 281' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 von 2 Projekten');
    // Bereich zu: die Chips bleiben, × setzt den Filter zurück.
    fireEvent.click(more);
    expect(screen.queryByLabelText('Objekttyp')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Filter Objekttyp: Nebel entfernen' }));
    expect(screen.getByRole('link', { name: 'NGC 281' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Aktive Filter' })).not.toHaveTextContent('Objekttyp');
    fireEvent.click(screen.getByRole('button', { name: 'Filter Rig: Rig A entfernen' }));
    expect(screen.queryByRole('list', { name: 'Aktive Filter' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Suche' }), {
      target: { value: 'ngc 224' },
    });
    expect(screen.getByRole('link', { name: 'Andromeda' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'NGC 281' })).not.toBeInTheDocument();
    await expectNoSeriousA11y();
  });

  it('Papierkorb: Löschzeitpunkt mit Kürzel, Wiederherstellen ohne Dialog', async () => {
    state.deleted = [item(5, { name: 'Weg', deletedAt: '2026-09-20T18:30:00Z' })];
    state.restore.mockResolvedValue({});
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Papierkorb' }));
    const row = (await screen.findByText('Weg')).closest('tr') as HTMLElement;
    expect(row).toHaveTextContent(/20:30 MESZ/);
    fireEvent.click(within(row).getByRole('button', { name: 'Wiederherstellen' }));
    await waitFor(() => expect(state.restore).toHaveBeenCalledWith(ID(105)));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('Papierkorb-Umschalter: aria-pressed, Fokus bleibt, zurück zur Liste mit Filtern', async () => {
    state.items = [item(1, { name: 'Aktiv' })];
    state.deleted = [item(5, { name: 'Weg', deletedAt: '2026-09-20T18:30:00Z' })];
    renderPage();
    await screen.findByRole('link', { name: 'Aktiv' });
    const trash = screen.getByRole('button', { name: 'Papierkorb' });
    trash.focus();
    fireEvent.click(trash);
    expect(trash).toHaveAttribute('aria-pressed', 'true');
    expect(trash).toHaveFocus();
    expect(await screen.findByText('Weg')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Papierkorb' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Aktiv' })).not.toBeInTheDocument();
    // Im Papierkorb keine Suche, keine Filter, keine Ansichten.
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Filter' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Darstellung' })).not.toBeInTheDocument();
    await expectNoSeriousA11y();
    fireEvent.click(trash);
    expect(trash).toHaveAttribute('aria-pressed', 'false');
    expect(await screen.findByRole('link', { name: 'Aktiv' })).toBeInTheDocument();
  });

  it('User: kein Papierkorb, keine Prioritätsspalte, Freigabestatus-Kennzeichen', async () => {
    state.me = me('user');
    state.items = [item(1, { approvalStatus: 'submitted', name: 'Mein Objekt' })];
    renderPage();
    expect(await screen.findByRole('link', { name: 'Mein Objekt' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Papierkorb' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Priorität' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Eingereicht').length).toBeGreaterThan(0);
  });
});

describe('Status-Chips, Alle/Meine, Gruppierung (30.09.2026)', () => {
  const mix = () => [
    item(1, { approvalStatus: 'approved', status: 'active', priority: 1, name: 'Aktiv A' }),
    item(2, { approvalStatus: 'approved', status: 'on_hold', priority: 2, name: 'Pause B' }),
    item(3, { name: 'Entwurf C', createdBy: ID(9), createdByName: 'Zoe' }),
    item(4, { approvalStatus: 'returned', name: 'Zurück D' }),
  ];
  const chips = () => screen.getByRole('group', { name: 'Status' });
  const chip = (name: RegExp) => within(chips()).getByRole('button', { name });
  const links = () =>
    screen
      .getAllByRole('link')
      .map((l) => l.textContent)
      .filter((x) => /^(Aktiv A|Pause B|Entwurf C|Zurück D)$/.test(x ?? ''));

  it('Chips mit Anzahl; Mehrfachauswahl; *Alle* setzt zurück; Auswahl in der Adresse; axe', async () => {
    state.items = mix();
    renderPage();
    await screen.findByRole('link', { name: 'Aktiv A' });
    expect(chip(/^Alle/)).toHaveTextContent('Alle4');
    expect(chip(/^Alle/)).toHaveAttribute('aria-pressed', 'true');
    expect(chip(/^Entwurf/)).toHaveTextContent('Entwurf1');
    expect(chip(/^Abgeschlossen/)).toHaveTextContent('Abgeschlossen0');
    fireEvent.click(chip(/^Entwurf/));
    expect(chip(/^Entwurf/)).toHaveAttribute('aria-pressed', 'true');
    expect(chip(/^Alle/)).toHaveAttribute('aria-pressed', 'false');
    expect(links()).toEqual(['Entwurf C']);
    fireEvent.click(chip(/^Zurückgegeben/));
    expect(links().sort()).toEqual(['Entwurf C', 'Zurück D']);
    expect(screen.getByTestId('where')).toHaveTextContent('status=draft%2Creturned');
    // Anzahl der übrigen Chips bleibt sichtbar (ohne Statusauswahl gezählt).
    expect(chip(/^Aktiv/)).toHaveTextContent('Aktiv1');
    await expectNoSeriousA11y();
    fireEvent.click(chip(/^Alle/));
    expect(links()).toHaveLength(4);
  });

  it('alte Adresse „Entwürfe“: ?status=draft,returned wählt beide Chips vor', async () => {
    state.items = mix();
    renderPage('/projekte?status=draft,returned');
    await screen.findByRole('link', { name: 'Entwurf C' });
    expect(chip(/^Entwurf/)).toHaveAttribute('aria-pressed', 'true');
    expect(chip(/^Zurückgegeben/)).toHaveAttribute('aria-pressed', 'true');
    expect(links().sort()).toEqual(['Entwurf C', 'Zurück D']);
  });

  it('Schalter *Meine* zeigt nur eigene Projekte, die Anzahl folgt', async () => {
    state.items = mix();
    renderPage();
    await screen.findByRole('link', { name: 'Entwurf C' });
    const who = screen.getByRole('radiogroup', { name: 'Wessen Projekte' });
    fireEvent.click(within(who).getByRole('radio', { name: 'Meine' }));
    expect(within(who).getByRole('radio', { name: 'Meine' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.queryByRole('link', { name: 'Entwurf C' })).not.toBeInTheDocument();
    expect(chip(/^Alle/)).toHaveTextContent('Alle3');
    expect(chip(/^Entwurf/)).toHaveTextContent('Entwurf0');
    expect(screen.getByTestId('where')).toHaveTextContent('meine=1');
  });

  it('Gruppieren je Status: Kopf je Status mit Anzahl, keine Prioritätsspalte; ohne Gruppen', async () => {
    state.items = mix();
    renderPage();
    await screen.findByRole('link', { name: 'Aktiv A' });
    expect(screen.getByRole('columnheader', { name: 'Priorität' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Gruppieren'), { target: { value: 'status' } });
    expect(screen.getByRole('columnheader', { name: /Entwurf.*Anzahl: 1/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Pausiert/ })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Priorität' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /nach oben/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('gruppe=status');
    fireEvent.change(screen.getByLabelText('Gruppieren'), { target: { value: 'none' } });
    expect(screen.queryByRole('columnheader', { name: /Rig A|Entwurf/ })).not.toBeInTheDocument();
    expect(links()).toEqual(['Aktiv A', 'Entwurf C', 'Pause B', 'Zurück D']);
  });

  it('zurückgegeben: Kommentar der Freigabe unter dem Status; ⋯ *Einreichen* öffnet den Editor', async () => {
    const user = userEvent.setup();
    state.me = me('user');
    state.items = [item(4, { approvalStatus: 'returned', name: 'Zurück D' })];
    state.history = [
      { kind: 'approval', action: 'returned', comment: 'Bitte Belichtungszeit prüfen' },
    ];
    renderPage();
    expect(
      await screen.findByText('Kommentar der Freigabe: Bitte Belichtungszeit prüfen'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Weitere Aktionen zu Zurück D' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Einreichen' }));
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(`/projekte/${ID(104)}?einreichen=1`),
    );
  });
});
