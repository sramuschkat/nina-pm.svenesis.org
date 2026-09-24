// @vitest-environment jsdom
/**
 * S-31 Projekt-Editor (AP-11b): Schnelleingabe (Anzahl oder Stunden) und Summen, Zeilen mit Aufnahmen
 * (gesperrte Felder, *Zeile duplizieren* ruft die Route auf, `409 line.locked_by_captures` als i18n-Text),
 * Entwurf → Teiländerung, Vorlagen-Regel, Rechte (User sieht fremde freigegebene Projekte nur lesend).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type {
  CameraView,
  ExposureTemplateView,
  FilterView,
  LineView,
  Me,
  ProjectView,
  RigView,
} from '../../api/client';
import { ApiError, AuthProvider } from '../../auth';
import { ExposurePlan } from './ExposurePlan';
import {
  changedFields,
  countFromHours,
  filterUnassigned,
  planSums,
  quickEntryLine,
  templateAllowed,
  templatesFor,
  toDraft,
} from './model';
import { researchLinks } from './ProjectEditorPage';

const state = vi.hoisted(() => ({
  me: null as unknown,
  addLine: vi.fn(),
  patchLine: vi.fn(),
  duplicateLine: vi.fn(),
  deleteLine: vi.fn(),
  applyTemplate: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  api: { me: () => Promise.resolve(state.me) },
  projectsApi: {
    addLine: (...a: unknown[]) => state.addLine(...a) as Promise<unknown>,
    patchLine: (...a: unknown[]) => state.patchLine(...a) as Promise<unknown>,
    duplicateLine: (...a: unknown[]) => state.duplicateLine(...a) as Promise<unknown>,
    deleteLine: (...a: unknown[]) => state.deleteLine(...a) as Promise<unknown>,
    applyTemplate: (...a: unknown[]) => state.applyTemplate(...a) as Promise<unknown>,
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

const counters = (planned: number, acquired = 0, rejected = 0, exposureS = 300) => ({
  planned,
  acquired,
  rejected,
  accepted: acquired - rejected,
  remaining: Math.max(0, planned - (acquired - rejected)),
  planningNeed: Math.max(0, planned - (acquired - rejected)),
  bonus: 0,
  bonusRejected: 0,
  percentDone: planned === 0 ? 0 : Math.min(100, ((acquired - rejected) / planned) * 100),
  integrationS: (acquired - rejected) * exposureS,
});

const line = (n: number, filter: string, over: Partial<LineView> = {}): LineView => ({
  id: ID(100 + n),
  panelId: ID(50),
  filterId: ID(200 + n),
  filterShortName: filter,
  exposureS: 300,
  plannedCount: 60,
  gain: 100,
  offsetAdu: 50,
  binning: 1,
  readoutMode: 'High Gain',
  moonMode: 'project_default',
  moonProfileId: null,
  enabled: true,
  orderIndex: n,
  notes: '',
  hasCaptures: false,
  counters: counters(60),
  ...over,
});

const filters = [
  {
    id: ID(201),
    shortName: 'Ha',
    colorHex: '#c62828',
    defaultExposureS: 300,
    defaultMoonProfileId: null,
  },
  {
    id: ID(202),
    shortName: 'OIII',
    colorHex: '#00897b',
    defaultExposureS: 600,
    defaultMoonProfileId: ID(300),
  },
] as unknown as FilterView[];

const camera = {
  id: ID(400),
  defaultGain: 100,
  defaultOffset: 50,
  defaultBinning: 1,
  defaultReadoutMode: 'High Gain',
  supportedBinning: [1, 2],
  readoutModes: ['High Gain', 'Low Noise'],
} as unknown as CameraView;

const rig = {
  id: ID(500),
  telescopeId: ID(600),
  cameraId: ID(400),
  filterWheel: [],
} as unknown as RigView;

const project = (lines: LineView[], over: Partial<ProjectView> = {}): ProjectView =>
  ({
    id: ID(10),
    name: 'NGC 281',
    projectType: 'deep_sky',
    rigId: rig.id,
    createdBy: ID(3),
    targetName: 'NGC 281',
    targetType: null,
    catalogNames: '',
    descriptionMd: '',
    raDeg: 13.2,
    decDeg: 56.6,
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
    panels: [
      {
        id: ID(50),
        panelIndex: 0,
        label: 'Main',
        raDeg: 13.2,
        decDeg: 56.6,
        rotationDeg: 0,
        notes: '',
        lines,
      },
    ],
    ...over,
  }) as ProjectView;

function wrap(children: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <AuthProvider>{children}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const plan = (p: ProjectView, canEdit = true, templates: ExposureTemplateView[] = []) =>
  wrap(
    <ExposurePlan
      project={p}
      canEdit={canEdit}
      rig={rig}
      camera={camera}
      filters={filters}
      moonProfiles={[]}
      templates={templates}
      onChange={vi.fn()}
      onReload={() => Promise.resolve()}
      rigPath="/ausruestung/rigs"
    />,
  );

beforeEach(() => {
  state.me = me('owner');
  for (const fn of [state.addLine, state.patchLine, state.duplicateLine, state.deleteLine])
    fn.mockReset();
});

describe('Modell (FA-PRJ-20/21, FA-BPL-03/05)', () => {
  it('Anzahl aus Stunden aufgerundet; Schnelleingabe mit Kamera- und Filter-Standards', () => {
    expect(countFromHours(2.5, 300)).toBe(30);
    expect(countFromHours(1, 420)).toBe(9); // 8,57 → 9
    expect(countFromHours(0, 300)).toBe(0);
    const defaults = {
      gain: 100,
      offsetAdu: 50,
      binning: 1,
      readoutMode: 'High Gain',
      moonProfileId: ID(300),
    };
    expect(
      quickEntryLine({ filterId: ID(202), exposureS: 600, mode: 'hours', value: 5 }, defaults),
    ).toEqual({
      filterId: ID(202),
      exposureS: 600,
      plannedCount: 30,
      gain: 100,
      offsetAdu: 50,
      binning: 1,
      readoutMode: 'High Gain',
      moonMode: 'profile',
      moonProfileId: ID(300),
    });
    expect(
      quickEntryLine({ filterId: '', exposureS: 300, mode: 'count', value: 10 }, defaults),
    ).toBeNull();
    expect(
      quickEntryLine({ filterId: ID(1), exposureS: null, mode: 'count', value: 10 }, defaults),
    ).toBeNull();
  });

  it('Summen: nur aktive Zeilen, Fortschritt ohne Überhang, Integration inkl. Bonus', () => {
    const sums = planSums([
      line(1, 'Ha', { counters: counters(60, 22, 2) }),
      line(2, 'OIII', { plannedCount: 60, counters: counters(60, 70, 0) }),
      line(3, 'SII', { enabled: false, counters: counters(60, 10, 0) }),
    ]);
    expect(sums).toEqual({
      filters: 2,
      plannedFrames: 120,
      plannedS: 36000,
      acceptedFrames: 90,
      acceptedS: 27000,
      percent: ((20 + 60) / 120) * 100,
    });
  });

  it('Teiländerung: nur geänderte Felder und Bedingungen', () => {
    const p = project([]);
    const d = toDraft(p);
    expect(changedFields(d, p)).toEqual({});
    expect(
      changedFields(
        {
          ...d,
          name: 'NGC 281 Pacman',
          dueDate: '2026-12-15',
          conditions: { ...d.conditions, minAltitudeDeg: 35 },
        },
        p,
      ),
    ).toEqual({
      name: 'NGC 281 Pacman',
      dueDate: '2026-12-15',
      conditions: { minAltitudeDeg: 35 },
    });
    expect(changedFields({ ...d, targetName: '  ' }, p)).toEqual({ targetName: null });
  });

  it('Vorlagen-Regel: passende Kombination, gesperrt mit Aufnahmen; Filterrad-Kennzeichen', () => {
    const tpl = (id: number, telescopeId: string | null, cameraId: string | null) =>
      ({ id: ID(id), name: `T${String(id)}`, telescopeId, cameraId }) as ExposureTemplateView;
    expect(
      templatesFor([tpl(1, null, null), tpl(2, ID(600), ID(400)), tpl(3, ID(601), null)], rig).map(
        (x) => x.name,
      ),
    ).toEqual(['T1', 'T2']);
    expect(templateAllowed([line(1, 'Ha')])).toBe(true);
    expect(templateAllowed([line(1, 'Ha', { hasCaptures: true })])).toBe(false);
    const wheel = [
      {
        position: 1,
        filterId: ID(201),
        ninaFilterName: 'Ha',
        ninaConfirmedAt: '2026-09-20T10:00:00Z',
        ninaConfirmedBy: null,
      },
      {
        position: 2,
        filterId: ID(202),
        ninaFilterName: null,
        ninaConfirmedAt: null,
        ninaConfirmedBy: null,
      },
    ];
    expect(filterUnassigned(ID(201), wheel)).toBe(false);
    expect(filterUnassigned(ID(202), wheel)).toBe(true);
    expect(filterUnassigned(ID(202), [])).toBe(false); // OSC ohne Filterrad
  });

  it('Recherche-Links mit kodiertem Zielnamen', () => {
    expect(researchLinks('NGC 281')[0]?.href).toBe(
      'https://simbad.cds.unistra.fr/simbad/sim-id?Ident=NGC%20281',
    );
  });
});

describe('Belichtungsplan (Komponente)', () => {
  it('Schnelleingabe: Stunden → Anzahl, Hinzufügen ruft die Route mit Kamera-Standards', async () => {
    state.addLine.mockResolvedValue(project([line(1, 'Ha')]));
    plan(project([]));
    expect(screen.getByText(/Noch keine Zeilen/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter'), { target: { value: ID(202) } });
    expect(screen.getByLabelText('Belichtung (s)')).toHaveValue(600); // Standard des Filters
    fireEvent.click(screen.getByLabelText('Stunden'));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Stunden' }), {
      target: { value: '5' },
    });
    expect(screen.getByText('= 30 Aufnahmen')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));
    await waitFor(() => expect(state.addLine).toHaveBeenCalledTimes(1));
    const [projectId, body] = state.addLine.mock.calls[0] as [string, Record<string, unknown>];
    expect(projectId).toBe(ID(10));
    expect(body).toMatchObject({
      panelId: ID(50),
      filterId: ID(202),
      exposureS: 600,
      plannedCount: 30,
      gain: 100,
      offsetAdu: 50,
      readoutMode: 'High Gain',
      moonMode: 'profile',
      moonProfileId: ID(300),
    });
  });

  it('Summenzeile: Filter · GEPLANT · AKTUELL · Gesamtfortschritt', () => {
    plan(
      project([
        line(1, 'Ha', { counters: counters(60, 22, 2) }),
        line(2, 'OIII', { counters: counters(60, 10) }),
      ]),
    );
    const sums = screen.getByLabelText('Summen des Panels');
    expect(sums).toHaveTextContent('Filter: 2');
    expect(sums).toHaveTextContent('Geplant 120 Frames / 10,0 h');
    expect(sums).toHaveTextContent('Aktuell 30 Frames / 2,5 h');
    expect(sums).toHaveTextContent('Gesamtfortschritt 25 %');
  });

  it('Zeile mit Aufnahmen: Aufnahmefelder gesperrt, geplant änderbar; Duplizieren ruft die Route', async () => {
    state.duplicateLine.mockResolvedValue(project([line(1, 'Ha')]));
    plan(project([line(1, 'Ha', { hasCaptures: true, counters: counters(60, 22, 2) })]));
    expect(screen.getByText(/Zeilen mit Schloss haben Aufnahmen/)).toBeInTheDocument();
    for (const field of ['Filter', 'Belichtung', 'Gain', 'Offset', 'Binning', 'Auslesemodus'])
      expect(screen.queryByLabelText(`${field} der Zeile Ha`)).not.toBeInTheDocument();
    expect(screen.getAllByLabelText(/Zeile hat Aufnahmen/).length).toBeGreaterThanOrEqual(6);
    expect(screen.getByLabelText('Geplante Aufnahmen der Zeile Ha')).toBeEnabled();
    expect(screen.getByLabelText('Mondprofil der Zeile Ha')).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Zeile Ha duplizieren' }));
    const box = screen.getByRole('group', { name: 'Zeile duplizieren' });
    expect(within(box).getByLabelText('Alte Zeile deaktivieren')).toBeChecked();
    fireEvent.click(within(box).getByRole('button', { name: 'Zeile duplizieren' }));
    await waitFor(() => expect(state.duplicateLine).toHaveBeenCalledTimes(1));
    const [pid, lid, body] = state.duplicateLine.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect([pid, lid]).toEqual([ID(10), ID(101)]);
    expect(body).toMatchObject({ deactivateSource: true });
    expect(typeof body.id).toBe('string');
  });

  it('409 line.locked_by_captures erscheint als i18n-Text; geplant wird per PATCH geändert', async () => {
    state.patchLine.mockRejectedValue(
      new ApiError({ status: 409, code: 'line.locked_by_captures' }),
    );
    plan(project([line(1, 'Ha')]));
    const exposure = screen.getByLabelText('Belichtung der Zeile Ha');
    fireEvent.change(exposure, { target: { value: '600' } });
    fireEvent.blur(exposure);
    await waitFor(() =>
      expect(state.patchLine).toHaveBeenCalledWith(ID(10), ID(101), { exposureS: 600 }),
    );
    expect(
      await screen.findByText(/Zeile hat Aufnahmen – Filter, Belichtungszeit/),
    ).toBeInTheDocument();
  });

  it('Vorlage anwenden gesperrt, sobald eine Zeile Aufnahmen hat; nur lesend ohne Eingaben; axe', async () => {
    const tpl = {
      id: ID(700),
      name: 'SHO 300 s',
      telescopeId: null,
      cameraId: null,
    } as ExposureTemplateView;
    const { unmount } = plan(project([line(1, 'Ha', { hasCaptures: true })]), true, [tpl]);
    expect(screen.getByLabelText('Vorlage')).toBeDisabled();
    expect(
      screen.getByText(/Nicht verfügbar – das Projekt hat bereits Aufnahmen/),
    ).toBeInTheDocument();
    unmount();
    plan(project([line(1, 'Ha')]), false, [tpl]);
    expect(screen.queryByRole('button', { name: 'Hinzufügen' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Vorlage')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zeile Ha löschen' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Zeile Ha aktiv')).toBeDisabled();
    await expectNoSeriousA11y();
  });
});
