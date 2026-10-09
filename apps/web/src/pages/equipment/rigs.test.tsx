// @vitest-environment jsdom
/**
 * S-10 (AP-09c): Sortierkette (Ziehen und Tastatur), Scheduler-Validierung (`afEveryMin = 0` = aus,
 * Flip), 412 beim Speichern, Filterrad-Status und Bestätigungs-Nutzlast; Reiter der Rig-Seite
 * (AP-26b): Tastatur, Sichtbarkeit, Speichern über Reiter hinweg, Fehler im verdeckten Reiter;
 * *Speichern* im Kopf der Rig-Karte sendet das Formular des aktiven Reiters (AP-26d).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { FilterWheelView, Me, RigView } from '../../api/client';
import { ApiError, AuthProvider } from '../../auth';
import { confirmPayload, draftRows, slotStatus } from './FilterWheelSection';
import { FocusOffsets } from './FocusOffsets';
import { MeasuredOverheads } from './MeasuredOverheads';
import { RigsPage, rigTabOf, SchedulerForm } from './RigsPage';
import { moveItem, SortChainEditor } from './SortChainEditor';

const state = vi.hoisted(() => ({
  me: null as unknown,
  lists: {} as Record<string, unknown[]>,
  scheduler: vi.fn(),
  updateRig: vi.fn(),
  wheelVersion: 4,
  putWheel: vi.fn(),
  focus: null as unknown,
}));

vi.mock('../../api/client', () => ({
  api: { me: () => Promise.resolve(state.me) },
  equipmentApi: {
    list: (kind: string) => Promise.resolve({ items: state.lists[kind] ?? [] }),
    schedulerSettings: (...args: unknown[]) => state.scheduler(...args) as Promise<unknown>,
    updateRig: (...args: unknown[]) => state.updateRig(...args) as Promise<unknown>,
    filterWheel: () =>
      Promise.resolve({
        settingsVersion: state.wheelVersion,
        reported: { reportedAt: '2026-09-24T10:00:00Z', slots: [{ position: 1, name: 'Ha' }] },
        slots: [
          {
            position: 1,
            filterId: '00000000-0000-4000-8000-000000000041',
            ninaFilterName: null,
            ninaConfirmedAt: null,
            ninaConfirmedBy: null,
            reportedName: 'Ha',
            suggestion: 'Ha',
            suggestedFilterId: null,
            changedByNina: false,
          },
        ],
      }),
    putFilterWheel: (...args: unknown[]) => state.putWheel(...args) as Promise<unknown>,
    focusOffsets: () => Promise.resolve(state.focus),
  },
  ninaApi: { instances: () => Promise.resolve({ items: [] }) },
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

const scheduler: RigView['scheduler'] = {
  strategy: 'proportional',
  playback: 'time_aware',
  sortChain: ['lowest_peak_altitude', 'setting_soonest', 'most_remaining', 'constrained'],
  bonusEnabled: false,
  overshootPct: 0,
  mosaicPanelsIndependent: true,
  ditherEnabled: true,
  ditherEvery: 1,
  filterSwitchEnabled: false,
  filterSwitchEvery: 10,
  filterSwitchTolerancePct: 50,
  flatsEnabled: false,
  flatsFullSet: false,
  flatCount: 20,
  darkFlatsEnabled: true,
  darkFlatCount: null,
  flatsSource: 'panel',
  flatsAutoMode: 'off',
  flatsAutoIntervalDays: 7,
  flipEnabled: true,
  flipAfterMeridianMin: 5,
  flipMaxAfterMeridianMin: 15,
  flipPauseBeforeMeridianMin: 0,
  flipDurationS: 240,
  overhead: {
    slewCenterS: 120,
    filterChangeS: 10,
    ditherSettleS: 20,
    afEveryMin: 60,
    afDurationS: 180,
    downloadS: 5,
  },
};

const rig = { id: ID(30), settingsVersion: 4, scheduler } as RigView;

function wrap(
  children: ReactNode,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AuthProvider>{children}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.me = me('owner');
  state.lists = {};
  state.scheduler.mockReset();
  state.updateRig.mockReset();
  state.putWheel.mockReset();
  state.wheelVersion = 4;
});

/** Scheduler-Formular mit eigenem *Speichern* im Kopf (seit AP-26i nur noch im Nacht-Simulator). */
function Scheduler({ canWrite = true }: { canWrite?: boolean }) {
  return <SchedulerForm rig={rig} canWrite={canWrite} />;
}

function Chain({ initial }: { initial: string[] }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <SortChainEditor value={value} onChange={setValue} />
      <output data-testid="chain">{value.join(',')}</output>
    </>
  );
}

describe('Sortierkette (FA-SCH-03)', () => {
  it('Tastatur: nach oben/unten, entfernen, hinzufügen, Standard', async () => {
    wrap(<Chain initial={['lowest_peak_altitude', 'setting_soonest', 'most_remaining']} />);
    const chain = () => screen.getByTestId('chain').textContent;
    fireEvent.click(screen.getByRole('button', { name: '„meiste Restarbeit“ nach oben' }));
    expect(chain()).toBe('lowest_peak_altitude,most_remaining,setting_soonest');
    fireEvent.click(screen.getByRole('button', { name: '„geringste Maximalhöhe“ nach unten' }));
    expect(chain()).toBe('most_remaining,lowest_peak_altitude,setting_soonest');
    fireEvent.click(screen.getByRole('button', { name: '„bald untergehend“ entfernen' }));
    expect(chain()).toBe('most_remaining,lowest_peak_altitude');
    fireEvent.click(screen.getByRole('button', { name: 'Zieltermin am nächsten' }));
    expect(chain()).toBe('most_remaining,lowest_peak_altitude,due_soonest');
    expect(screen.getByRole('button', { name: '„meiste Restarbeit“ nach oben' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Standard wiederherstellen' }));
    expect(chain()).toBe('lowest_peak_altitude,setting_soonest,most_remaining,constrained');
    await expectNoSeriousA11y();
  });

  it('Ziehen: dritter Eintrag auf den ersten', () => {
    wrap(<Chain initial={['lowest_peak_altitude', 'setting_soonest', 'most_remaining']} />);
    const items = within(screen.getByRole('list', { name: 'Sortierkette' })).getAllByRole(
      'listitem',
    );
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (k: string, v: string) => data.set(k, v),
      getData: (k: string) => data.get(k) ?? '',
      effectAllowed: 'move',
    };
    const [first, , third] = items as [HTMLElement, HTMLElement, HTMLElement];
    fireEvent(third, Object.assign(createEvent.dragStart(third), { dataTransfer }));
    fireEvent(first, Object.assign(createEvent.dragOver(first), { dataTransfer }));
    fireEvent(first, Object.assign(createEvent.drop(first), { dataTransfer }));
    expect(screen.getByTestId('chain').textContent).toBe(
      'most_remaining,lowest_peak_altitude,setting_soonest',
    );
  });

  it('moveItem hält die Grenzen ein', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 5)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['c', 'a', 'b']);
  });
});

describe('Scheduler-Einstellungen', () => {
  it('Autofokus alle 0 min = aus: Hinweis, Dauer gesperrt; Speichern mit If-Match-Version', async () => {
    state.scheduler.mockResolvedValue({ ...rig, settingsVersion: 5 });
    wrap(<Scheduler />);
    const af = screen.getByLabelText('Autofokus alle (min)');
    fireEvent.change(af, { target: { value: '0' } });
    expect(screen.getByText('Autofokus aus')).toBeInTheDocument();
    expect(screen.getByLabelText('Autofokus-Dauer (s)')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(state.scheduler).toHaveBeenCalledTimes(1));
    const [id, body, version] = state.scheduler.mock.calls[0] as [string, typeof scheduler, number];
    expect([id, version, body.overhead.afEveryMin]).toEqual([rig.id, 4, 0]);
  });

  it('maxAfter < after → Hinweis am Feld, kein Aufruf', async () => {
    wrap(<Scheduler />);
    fireEvent.change(screen.getByLabelText('maximal Minuten nach Meridian (min)'), {
      target: { value: '3' },
    });
    expect(
      screen.getByText('Muss mindestens so groß sein wie „Minuten nach Meridian“.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(state.scheduler).not.toHaveBeenCalled();
  });

  it('412 beim Speichern → Konflikthinweis mit „Neu laden“', async () => {
    state.scheduler.mockRejectedValue(
      new ApiError({ status: 412, code: 'resource.version_conflict' }),
    );
    wrap(<Scheduler />);
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Jemand anderes hat den Datensatz inzwischen geändert');
    expect(within(alert).getByRole('button', { name: 'Neu laden' })).toBeInTheDocument();
  });

  it('ohne rig.settings.write: alles gesperrt, keine Sortier-Knöpfe', () => {
    wrap(<SchedulerForm rig={rig} canWrite={false} />);
    expect(screen.getByLabelText('Strategie')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /nach oben/ })).not.toBeInTheDocument();
  });
});

describe('Filterradbelegung (FA-RIG-14)', () => {
  const slot = (p: Partial<FilterWheelView['slots'][number]>) => ({
    position: 1,
    filterId: null,
    ninaFilterName: null,
    ninaConfirmedAt: null,
    ninaConfirmedBy: null,
    reportedName: null,
    suggestion: null,
    suggestedFilterId: null,
    changedByNina: false,
    ...p,
  });
  const view: FilterWheelView = {
    settingsVersion: 3,
    reported: { reportedAt: '2026-09-24T09:00:00Z', slots: [] },
    slots: [
      slot({
        position: 1,
        filterId: ID(41),
        ninaFilterName: 'L',
        ninaConfirmedAt: '2026-09-20T10:00:00Z',
        reportedName: 'L',
      }),
      slot({ position: 2, reportedName: 'Ha 3nm', suggestedFilterId: ID(42) }),
      slot({ position: 3, filterId: ID(43), reportedName: 'LPro' }),
      slot({
        position: 4,
        filterId: ID(44),
        ninaFilterName: 'OIII',
        reportedName: 'SII',
        changedByNina: true,
      }),
    ],
  };

  it('Status je Platz: bestätigt, Vorschlag, nicht zugeordnet, von NINA geändert', () => {
    expect(view.slots.map(slotStatus)).toEqual(['confirmed', 'suggested', 'unassigned', 'changed']);
  });

  it('Entwurf aus Vorschlag; Bestätigen sendet bestätigte Plätze unverändert, übrige ohne Namen', () => {
    const rows = draftRows(view);
    expect(rows[1]).toEqual({ position: 2, filterId: ID(42), ninaFilterName: 'Ha 3nm' });
    expect(rows[2]).toEqual({ position: 3, filterId: ID(43), ninaFilterName: null });
    expect(confirmPayload(view, rows, new Set([2]))).toEqual([
      { position: 1, filterId: ID(41), ninaFilterName: 'L' },
      { position: 2, filterId: ID(42), ninaFilterName: 'Ha 3nm' },
      { position: 3, filterId: ID(43), ninaFilterName: null },
      { position: 4, filterId: ID(44), ninaFilterName: null },
    ]);
  });
});

describe('Rig-Seite: Reiter (AP-26b)', () => {
  const AT = '2026-09-24T10:00:00Z';
  const site = {
    id: ID(12),
    name: 'Garten',
    pierName: null,
    observatoryType: 'open_air',
    latitudeDeg: 50.1,
    longitudeDeg: 8.7,
    elevationM: 120,
    bortleClass: 5,
    timeZone: 'Europe/Berlin',
    weatherSafetyUrl: null,
    notes: '',
    createdAt: AT,
    updatedAt: AT,
  };
  const telescope = {
    id: ID(10),
    name: 'GT81',
    opticalDesign: 'apochromatic_refractor',
    apertureMm: 81,
    focalLengthMm: 478,
    reducerFactor: 0.8,
  };
  const camera = {
    id: ID(11),
    name: 'Ares-M Pro',
    widthPx: 3008,
    heightPx: 3008,
    pixelSizeUm: 3.76,
    bitDepth: 14,
    isColor: false,
    readNoiseE: 1,
    fullWellE: 50000,
  };
  const full: RigView = {
    ...rig,
    name: 'Rig A',
    siteId: site.id,
    telescopeId: telescope.id,
    cameraId: camera.id,
    showInPlanning: true,
    ninaDeliveryEnabled: true,
    defaultTemplateId: null,
    defaultRotationDeg: null,
    hasRotator: false,
    rotationToleranceDeg: 5,
    skipOnRotationMismatch: false,
    sessionReportDiscord: false,
    notes: '',
    filterWheel: [],
    derived: { effFocalMm: 382, scaleArcsecPx: 2.03, fovWidthDeg: 1.7, fovHeightDeg: 1.7 },
    createdAt: AT,
    updatedAt: AT,
  };

  beforeEach(() => {
    state.lists = { rigs: [full], sites: [site], telescopes: [telescope], cameras: [camera] };
  });

  const tab = (name: RegExp) => screen.getByRole('tab', { name });

  it('Tastatur und Sichtbarkeit: Filterrad-Reiter zeigt die Belegung, Pfeiltasten und Ende', async () => {
    wrap(<RigsPage />);
    await screen.findByRole('heading', { level: 2, name: 'Rig A' });
    expect(screen.getByRole('tablist', { name: 'Rig-Bereiche' })).toBeInTheDocument();
    expect(tab(/^Allgemein/)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Name')).toBeVisible();
    // Verdeckte Reiter bleiben im DOM, sind aber nicht sichtbar.
    expect(screen.getByLabelText('Rotationstoleranz (°)')).not.toBeVisible();
    expect(
      screen.queryByRole('region', { name: 'Filterradbelegung – Zuordnung zu NINA' }),
    ).not.toBeInTheDocument();

    fireEvent.click(tab(/^Filterrad/));
    expect(tab(/^Filterrad/)).toHaveAttribute('aria-selected', 'true');
    expect(
      await screen.findByRole('region', { name: 'Filterradbelegung – Zuordnung zu NINA' }),
    ).toBeVisible();
    expect(screen.getByLabelText('Name')).not.toBeVisible();

    fireEvent.keyDown(tab(/^Filterrad/), { key: 'ArrowLeft' });
    expect(tab(/^Scheduler/)).toHaveAttribute('aria-selected', 'true');
    expect(tab(/^Scheduler/)).toHaveFocus();
    // Seit AP-26i nur Zusammenfassung mit Link in den Simulator.
    const summary = screen.getByRole('region', { name: 'Scheduler-Einstellungen' });
    expect(summary).toBeVisible();
    expect(within(summary).getByRole('link', { name: 'Im Simulator bearbeiten' })).toHaveAttribute(
      'href',
      `/nina/simulator?rig=${full.id}&einstellungen=1`,
    );
    expect(within(summary).getByText('Proportionale Zeit')).toBeInTheDocument();
    fireEvent.keyDown(tab(/^Scheduler/), { key: 'End' });
    expect(tab(/^NINA/)).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByRole('heading', { level: 3, name: 'Übernahmestatus in NINA' }),
    ).toBeVisible();
    await expectNoSeriousA11y();
  });

  it('Speichern aus einem Reiter sendet auch die Felder der übrigen', async () => {
    state.updateRig.mockResolvedValue({ ...full, name: 'Rig Z', settingsVersion: 5 });
    wrap(<RigsPage />);
    await screen.findByRole('heading', { level: 2, name: 'Rig A' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rig Z' } });
    fireEvent.click(tab(/^Ausrüstung/));
    fireEvent.change(screen.getByLabelText('Rotationstoleranz (°)'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(state.updateRig).toHaveBeenCalledTimes(1));
    const [id, body, version] = state.updateRig.mock.calls[0] as [string, RigView, number];
    expect([id, version, body.name, body.rotationToleranceDeg]).toEqual([full.id, 4, 'Rig Z', 8]);
  });

  it('Fehler in einem verdeckten Reiter: dorthin wechseln, Reiter markiert, kein Aufruf', async () => {
    wrap(<RigsPage />);
    await screen.findByRole('heading', { level: 2, name: 'Rig A' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '' } });
    fireEvent.click(tab(/^Ausrüstung/));
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(tab(/^Allgemein/)).toHaveAttribute('aria-selected', 'true');
    expect(tab(/^Allgemein/)).toHaveTextContent('Fehler');
    expect(tab(/^Ausrüstung/)).not.toHaveTextContent('Fehler');
    expect(screen.getByLabelText('Name')).toBeVisible();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rig A' } });
    fireEvent.click(tab(/^Ausrüstung/));
    fireEvent.change(screen.getByLabelText('Rotationstoleranz (°)'), { target: { value: '100' } });
    fireEvent.click(tab(/^Allgemein/));
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(tab(/^Ausrüstung/)).toHaveAttribute('aria-selected', 'true');
    expect(tab(/^Ausrüstung/)).toHaveTextContent('Fehler');
    expect(tab(/^Allgemein/)).not.toHaveTextContent('Fehler');
    await new Promise((r) => setTimeout(r, 0));
    expect(state.updateRig).not.toHaveBeenCalled();
  });

  it('Liste links: Auswahl mit aria-current, Suche, Neu im Seitenkopf', async () => {
    const long = { ...full, id: ID(31), name: 'Rig B mit einem sehr langen Namen am Gartenpier' };
    state.lists.rigs = [full, long];
    wrap(<RigsPage />);
    await screen.findByRole('heading', { level: 2, name: 'Rig A' });
    const list = screen.getByRole('region', { name: 'Rigs' });
    const item = (name: RegExp) => within(list).getByRole('button', { name });
    expect(item(/^Rig A/)).toHaveAttribute('aria-current', 'true');
    fireEvent.click(item(/^Rig B/));
    expect(screen.getByRole('heading', { level: 2, name: long.name })).toBeInTheDocument();
    expect(item(/^Rig B/)).toHaveAttribute('aria-current', 'true');
    expect(item(/^Rig A/)).not.toHaveAttribute('aria-current');

    fireEvent.change(within(list).getByLabelText('Rigs durchsuchen'), {
      target: { value: 'garten' },
    });
    expect(within(list).getAllByRole('button')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Neu' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Neues Rig' })).toBeInTheDocument();
    expect(tab(/^Allgemein/)).toHaveAttribute('aria-selected', 'true');
    expect(within(list).queryByRole('button', { current: true })).not.toBeInTheDocument();
    fireEvent.click(tab(/^Scheduler/));
    expect(
      within(screen.getByRole('tabpanel', { name: 'Scheduler' })).getByText(
        'Verfügbar, sobald das Rig gespeichert ist.',
      ),
    ).toBeVisible();
    await expectNoSeriousA11y();
  });

  it('ohne Rigs: Leerzustand rechts, Neu öffnet das Formular', async () => {
    state.lists.rigs = [];
    wrap(<RigsPage />);
    expect(await screen.findByText('Noch kein Rig angelegt.')).toBeInTheDocument();
    expect(
      screen.getByText('Wähle links einen Eintrag oder lege einen neuen an.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Neu' }));
    expect(screen.getByRole('tablist', { name: 'Rig-Bereiche' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('');
  });

  it('Kartenkopf: Speichern sendet das Formular des aktiven Reiters; auf Scheduler/Filterrad/NINA keins', async () => {
    state.scheduler.mockResolvedValue({ ...full, settingsVersion: 5 });
    wrap(<RigsPage />);
    const title = await screen.findByRole('heading', { level: 2, name: 'Rig A' });
    const head = title.parentElement?.parentElement as HTMLElement;
    expect(within(head).getByText('Einstellungsversion 4')).toBeInTheDocument();
    expect(within(head).getByRole('button', { name: 'Löschen' })).toBeInTheDocument();
    const save = () => within(head).getByRole('button', { name: 'Speichern' });
    expect(save()).toHaveAttribute('form', 'rig-general-form');
    fireEvent.click(tab(/^Ausrüstung/));
    expect(save()).toHaveAttribute('form', 'rig-equipment-form');
    // Scheduler: nur Zusammenfassung (AP-26i) – kein Speichern im Kartenkopf.
    fireEvent.click(tab(/^Scheduler/));
    expect(within(head).queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument();
    fireEvent.click(tab(/^NINA/));
    expect(within(head).queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument();
  });

  it('User: weder Speichern noch Löschen im Kartenkopf, Scheduler nur als Zusammenfassung', async () => {
    state.me = me('user');
    wrap(<RigsPage />);
    await screen.findByRole('heading', { level: 2, name: 'Rig A' });
    fireEvent.click(tab(/^Scheduler/));
    expect(screen.queryByLabelText('Strategie')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Löschen' })).not.toBeInTheDocument();
  });

  describe('Prüfung 28.09.2026: gespeichert wird mit der Version der Entwurfsbasis', () => {
    const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

    it('fremde Änderung an einem anderen Feld: Entwurf übernimmt sie, Speichern mit neuer Version', async () => {
      state.updateRig.mockImplementation((_id: string, body: object, v: number) =>
        Promise.resolve({ ...full, ...body, settingsVersion: v + 1 }),
      );
      const client = newClient();
      wrap(<RigsPage />, client);
      await screen.findByRole('heading', { level: 2, name: 'Rig A' });
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rig Mein Name' } });
      // Anderer Admin speichert Notizen (v5); der Fensterfokus lädt die Liste neu.
      state.lists.rigs = [{ ...full, settingsVersion: 5, notes: 'Notiz vom Kollegen' }];
      await act(() => client.invalidateQueries({ queryKey: ['equipment', 'rigs'] }));
      await waitFor(() =>
        expect(screen.getByLabelText('Notizen')).toHaveValue('Notiz vom Kollegen'),
      );
      expect(screen.getByLabelText('Name')).toHaveValue('Rig Mein Name');
      fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
      await waitFor(() => expect(state.updateRig).toHaveBeenCalled());
      const [, body, version] = state.updateRig.mock.calls[0] as [string, RigView, number];
      expect([version, body.name, body.notes]).toEqual([5, 'Rig Mein Name', 'Notiz vom Kollegen']);
    });

    it('fremde Änderung am selben Feld: Konflikthinweis, Speichern mit alter Version (412)', async () => {
      state.updateRig.mockRejectedValue(
        new ApiError({ status: 412, code: 'resource.version_conflict' }),
      );
      const client = newClient();
      wrap(<RigsPage />, client);
      await screen.findByRole('heading', { level: 2, name: 'Rig A' });
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rig Mein Name' } });
      state.lists.rigs = [{ ...full, settingsVersion: 5, name: 'Rig Kollege' }];
      await act(() => client.invalidateQueries({ queryKey: ['equipment', 'rigs'] }));
      expect(await screen.findByText(/Jemand anderes hat den Datensatz/)).toBeInTheDocument();
      expect(screen.getByLabelText('Name')).toHaveValue('Rig Mein Name');
      fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
      await waitFor(() => expect(state.updateRig).toHaveBeenCalled());
      expect(state.updateRig.mock.calls[0]?.[2]).toBe(4);
      // „Neu laden“ übernimmt die fremde Fassung.
      fireEvent.click(screen.getByRole('button', { name: 'Neu laden' }));
      await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Rig Kollege'));
      expect(screen.queryByText(/Jemand anderes hat den Datensatz/)).not.toBeInTheDocument();
    });

    it('nach dem Speichern lädt das Filterrad die neue Version (kein falsches 412)', async () => {
      state.updateRig.mockImplementation(() => {
        state.wheelVersion = 5;
        state.lists.rigs = [{ ...full, name: 'Rig Z', settingsVersion: 5 }];
        return Promise.resolve({ ...full, name: 'Rig Z', settingsVersion: 5 });
      });
      state.putWheel.mockResolvedValue({ settingsVersion: 6, reported: null, slots: [] });
      state.lists.filters = [{ id: ID(41), shortName: 'Ha', colorHex: '#FF0000', bandwidthNm: 3 }];
      wrap(<RigsPage />);
      await screen.findByRole('heading', { level: 2, name: 'Rig A' });
      fireEvent.click(tab(/^Filterrad/));
      await screen.findByRole('button', { name: 'Platz 1 bestätigen' });
      fireEvent.click(tab(/^Allgemein/));
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rig Z' } });
      fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
      await screen.findByRole('heading', { level: 2, name: 'Rig Z' });
      expect(state.updateRig.mock.calls[0]?.[2]).toBe(4);
      fireEvent.click(tab(/^Filterrad/));
      fireEvent.click(screen.getByRole('button', { name: 'Platz 1 bestätigen' }));
      await waitFor(() => expect(state.putWheel).toHaveBeenCalled());
      expect(state.putWheel.mock.calls[0]?.[2]).toBe(5);
    });
  });

  it('rigTabOf: Ausrüstungsfelder auf „Ausrüstung“, übrige auf „Allgemein“', () => {
    expect(['name', 'siteId', 'notes', 'cameraId', 'rotationToleranceDeg'].map(rigTabOf)).toEqual([
      'general',
      'general',
      'general',
      'equipment',
      'equipment',
    ]);
  });
});

describe('Gemessene Overheads (AP-65, FA-RIG-04b)', () => {
  const value = (
    key: string,
    typedS: number,
    measured: { medianS: number; n: number; p25S: number; p75S: number } | null,
    o: { effectiveS: number; source: 'measured' | 'typed'; fixed?: boolean; deviates?: boolean },
  ) => ({ key, typedS, measured, fixed: false, deviates: false, ...o });
  const measuredRig = {
    ...rig,
    scheduler: { ...scheduler, overheadFixed: [] },
    overheads: {
      minSamples: 10,
      computedAtUtc: '2026-10-07T12:00:00Z',
      fromNight: '2026-09-08',
      toNight: '2026-10-06',
      nights: 4,
      values: [
        value(
          'slewCenterS',
          120,
          { medianS: 35, n: 22, p25S: 30, p75S: 41 },
          {
            effectiveS: 35,
            source: 'measured',
            deviates: true,
          },
        ),
        value(
          'filterChangeS',
          10,
          { medianS: 9, n: 3, p25S: 8, p75S: 10 },
          {
            effectiveS: 10,
            source: 'typed',
          },
        ),
        value(
          'ditherSettleS',
          20,
          { medianS: 18, n: 40, p25S: 17, p75S: 19 },
          {
            effectiveS: 18,
            source: 'measured',
          },
        ),
        value('afDurationS', 180, null, { effectiveS: 180, source: 'typed' }),
        value('downloadS', 5, null, { effectiveS: 5, source: 'typed' }),
        value(
          'flipDurationS',
          240,
          { medianS: 1080, n: 12, p25S: 900, p75S: 1300 },
          {
            effectiveS: 1080,
            source: 'measured',
            deviates: true,
          },
        ),
      ],
    },
  } as RigView;

  it('zeigt getippt, gemessen mit Streuung, Wirkung und Hinweis; „fest“ speichert die Auswahl', async () => {
    state.scheduler.mockResolvedValue({ ...measuredRig, settingsVersion: 5 });
    const { container } = wrap(<MeasuredOverheads rig={measuredRig} canWrite />);
    await screen.findByRole('heading', { name: 'Gemessene Overheads' });
    const row = (name: string) => screen.getByRole('row', { name: new RegExp(name) });
    expect(row('Meridian-Flip').textContent).toContain('1.080 s (18 min)');
    expect(row('Meridian-Flip').textContent).toContain('n = 12 · 900–1.300 s');
    expect(row('Meridian-Flip').textContent).toContain('weicht stark ab');
    expect(within(row('Filterwechsel')).getByText('getippt')).toBeTruthy();
    expect(within(row('Autofokus-Dauer')).getByText('keine Messung')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Meridian-Flip fest (immer getippt)' }));
    await waitFor(() => expect(state.scheduler).toHaveBeenCalled());
    expect(state.scheduler.mock.calls[0]?.[1]).toMatchObject({ overheadFixed: ['flipDurationS'] });
    expect(state.scheduler.mock.calls[0]?.[2]).toBe(4);
    await expectNoSeriousA11y(container);
  });

  it('ohne Schreibrecht nur lesend', async () => {
    wrap(<MeasuredOverheads rig={measuredRig} canWrite={false} />);
    await screen.findByRole('heading', { name: 'Gemessene Overheads' });
    for (const box of screen.getAllByRole('checkbox'))
      expect((box as HTMLInputElement).disabled).toBe(true);
  });
});

describe('Vorgeschlagene Filter-Offsets (AP-72)', () => {
  const rig = { id: ID(700) } as RigView;
  const row = (filter: string, o: Record<string, unknown>) => ({
    filter,
    shortName: null,
    position: null,
    runs: 5,
    positionAtRef: 2020,
    offset: 0,
    scatter: 2.1,
    ninaOffset: 0,
    lastRunAt: '2026-10-09T09:00:00Z',
    ...o,
  });

  it('Bezug, Vorschlag je Filter, „weicht ab“, zu wenig Läufe, Hinweis ohne NINA-Offsets, Text zum Übertragen', async () => {
    state.focus = {
      rigId: ID(700),
      fromNight: '2026-08-11',
      toNight: '2026-10-09',
      minRuns: 3,
      totalRuns: 12,
      reference: 'LUMINOS',
      slopePerC: -5,
      referenceTemperatureC: 10,
      ninaWithoutOffsets: true,
      filters: [
        row('LUMINOS', { shortName: 'L', position: 1 }),
        row('RED', { shortName: 'R', position: 2, offset: 45 }),
        row('SII', { shortName: 'SII', position: 7, runs: 2, offset: null, scatter: 4 }),
      ],
    };
    const { container } = wrap(<FocusOffsets rig={rig} />);
    await screen.findByRole('heading', { name: 'Vorgeschlagene Filter-Offsets' });
    expect(screen.getByText(/Temperaturdrift -5 Schritte\/°C/)).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('NINA hat noch keine Filter-Offsets');
    const red = screen.getByRole('row', { name: /RED/ });
    expect(red.textContent).toContain('+45');
    expect(red.textContent).toContain('weicht ab');
    expect(screen.getByRole('row', { name: /SII/ }).textContent).toContain('unter 3 Läufen');
    expect(screen.getByTestId('focus-transfer').textContent).toBe('LUMINOS 0 · RED +45');
    await expectNoSeriousA11y(container);
  });
});
