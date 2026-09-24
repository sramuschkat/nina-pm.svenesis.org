// @vitest-environment jsdom
/**
 * S-10 (AP-09c): Sortierkette (Ziehen und Tastatur), Scheduler-Validierung (`afEveryMin = 0` = aus,
 * Flip), 412 beim Speichern, Filterrad-Status und Bestätigungs-Nutzlast.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { FilterWheelView, Me, RigView } from '../../api/client';
import { ApiError, AuthProvider } from '../../auth';
import { confirmPayload, draftRows, slotStatus } from './FilterWheelSection';
import { SchedulerForm } from './RigsPage';
import { moveItem, SortChainEditor } from './SortChainEditor';

const state = vi.hoisted(() => ({ me: null as unknown, scheduler: vi.fn() }));

vi.mock('../../api/client', () => ({
  api: { me: () => Promise.resolve(state.me) },
  equipmentApi: {
    list: () => Promise.resolve({ items: [] }),
    schedulerSettings: (...args: unknown[]) => state.scheduler(...args) as Promise<unknown>,
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

function wrap(children: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <AuthProvider>{children}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.me = me('owner');
  state.scheduler.mockReset();
});

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
    wrap(<SchedulerForm rig={rig} canWrite />);
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
    wrap(<SchedulerForm rig={rig} canWrite />);
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
    wrap(<SchedulerForm rig={rig} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Jemand anderes hat den Datensatz inzwischen geändert');
    expect(within(alert).getByRole('button', { name: 'Neu laden' })).toBeInTheDocument();
  });

  it('ohne rig.settings.write: alles gesperrt, kein Speichern', () => {
    wrap(<SchedulerForm rig={rig} canWrite={false} />);
    expect(screen.getByLabelText('Strategie')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument();
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
