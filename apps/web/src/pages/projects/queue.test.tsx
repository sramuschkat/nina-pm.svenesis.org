// @vitest-environment jsdom
/**
 * S-33 Warteschlange (AP-12c): Filter, Sortierung, abgelaufener Zeitraum; Stimme (eigenes Objekt
 * gesperrt), Admin-Entscheidung (Freigeben mit Position, Zurückgeben nur mit Kommentar, Ablehnen über
 * ConfirmDialog), User ohne Entscheiden; axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { Me, QueueItem } from '../../api/client';
import { AuthProvider } from '../../auth';
import { QueuePage } from './QueuePage';
import { sortRows } from '../../components/DataTable';
import {
  NO_QUEUE_FILTERS,
  filterQueue,
  nightKeyIn,
  periodExpired,
  queueSortValue,
} from './queue-model';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Nacht-Tabelle Starfront (CDT) ab 2026-09-26, 30 Nächte – für die Spalte „Sichtbarkeit 4 Wochen“. */
function nightsTable() {
  const day = (i: number) => new Date(Date.UTC(2026, 8, 26 + i)).toISOString().slice(0, 10);
  return {
    currentNight: day(0),
    tzdataVersion: '2026a',
    timeZoneTransitions: [
      { atUtc: '2026-03-08T08:00:00Z', utcOffsetMinutes: -300 },
      { atUtc: '2026-11-01T07:00:00Z', utcOffsetMinutes: -360 },
    ],
    nights: Array.from({ length: 30 }, (_, i) => ({
      night: day(i),
      noonStartUtc: `${day(i)}T17:00:00Z`,
      noonEndUtc: `${day(i + 1)}T17:00:00Z`,
      nightWindowEndUtc: `${day(i + 1)}T13:00:00Z`,
    })),
  };
}
const ME = ID(3);

const state = vi.hoisted(() => ({
  me: null as unknown,
  queue: [] as unknown[],
  vote: vi.fn(),
  approve: vi.fn(),
  returnToUser: vi.fn(),
  reject: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  api: { me: () => Promise.resolve(state.me) },
  equipmentApi: {
    list: (kind: string) =>
      Promise.resolve({
        items:
          kind === 'rigs'
            ? [{ id: ID(500), name: 'Rig A', siteId: ID(600) }]
            : kind === 'sites'
              ? [
                  {
                    id: ID(600),
                    name: 'Starfront',
                    latitudeDeg: 31.5471,
                    longitudeDeg: -99.3823,
                    timeZone: 'America/Chicago',
                  },
                ]
              : [],
      }),
    nights: () => Promise.resolve(nightsTable()),
  },
  projectsApi: { list: () => Promise.resolve({ items: [{}, {}] }) },
  approvalApi: {
    queue: () => Promise.resolve({ items: state.queue }),
    vote: (...a: unknown[]) => state.vote(...a) as Promise<unknown>,
    approve: (...a: unknown[]) => state.approve(...a) as Promise<unknown>,
    returnToUser: (...a: unknown[]) => state.returnToUser(...a) as Promise<unknown>,
    reject: (...a: unknown[]) => state.reject(...a) as Promise<unknown>,
  },
}));

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
  member: { id: ME, displayName: 'Uta', role, effectiveRole: role === 'user' ? 'user' : 'admin' },
  isSuperUser: false,
  mfaRequired: false,
  memberships: [{ tenantKey: 'demo', tenantName: 'Demo', role }],
});

const item = (n: number, over: Partial<QueueItem> = {}): QueueItem =>
  ({
    kind: 'project',
    id: ID(100 + n),
    projectId: ID(100 + n),
    name: `Objekt ${String(n)}`,
    projectType: 'deep_sky',
    targetName: null,
    targetType: 'Galaxie',
    createdBy: ID(9),
    createdByName: 'Zoe',
    submittedAt: '2026-09-20T18:30:00Z',
    expiresAt: null,
    requestedRigId: ID(500),
    requestPeriodFrom: null,
    requestPeriodTo: null,
    requestComment: 'Gern vor Weihnachten',
    contentChangedAt: null,
    votes: { count: 0, voters: [], mine: false, mineChangedSince: false },
    submitterRank: { rank: 1, of: 1 },
    planSummary: [
      {
        filterId: null,
        filterShortName: 'Ha',
        count: 40,
        exposureS: 300,
        gain: 100,
        offset: 50,
        binning: 1,
        readoutMode: 'High Gain',
        moonMode: 'none',
        moonProfileId: null,
      },
    ],
    panelCount: 1,
    estimatedHours: 3.33,
    effort: null,
    suggestedPriorityPosition: null,
    version: 7,
    target: null,
    conditions: { minAltitudeDeg: 30, minTimeOnTargetH: 1, twilight: 'astronomical' },
    startDate: null,
    ...over,
  }) as QueueItem;

const renderPage = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <AuthProvider>
          <QueuePage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  state.me = me('owner');
  state.queue = [];
  for (const fn of [state.vote, state.approve, state.returnToUser, state.reject]) fn.mockReset();
});

describe('Modell', () => {
  it('Filter „ohne meine Stimme“/„geändert seit meiner Stimme“, Sortierung stabil, abgelaufener Zeitraum', () => {
    const a = item(1, { votes: { count: 2, voters: [], mine: true, mineChangedSince: true } });
    const b = item(2, { name: 'Andromeda', estimatedHours: 10 });
    expect(filterQueue([a, b], { ...NO_QUEUE_FILTERS, withoutMyVote: true })).toEqual([b]);
    expect(filterQueue([a, b], { ...NO_QUEUE_FILTERS, changedSinceMyVote: true })).toEqual([a]);
    const by = (key: Parameters<typeof queueSortValue>[1], dir: 'asc' | 'desc') =>
      sortRows([a, b], (q) => queueSortValue(q, key), dir, 'de');
    expect(by('name', 'asc').map((q) => q.name)).toEqual(['Andromeda', 'Objekt 1']);
    expect(by('hours', 'desc')[0]).toBe(b);
    expect(queueSortValue(item(3, { submitterRank: null }), 'rank')).toBeNull();
    expect(periodExpired({ requestPeriodTo: '2026-09-20' }, '2026-09-24')).toBe(true);
    expect(periodExpired({ requestPeriodTo: null }, '2026-09-24')).toBe(false);
    // 23:30 UTC am 24.09. ist in Berlin schon der 25.09.
    expect(nightKeyIn(Date.UTC(2026, 8, 24, 23, 30), 'Europe/Berlin')).toBe('2026-09-25');
  });
});

describe('S-33 (Komponente)', () => {
  it('Stimme abgeben; eigenes Objekt gesperrt; Plan-Chip mit Tooltip; axe', async () => {
    state.queue = [item(1), item(2, { createdBy: ME, name: 'Meins' })];
    state.vote.mockResolvedValue({});
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Für „Objekt 1“ stimmen' }));
    await waitFor(() => expect(state.vote).toHaveBeenCalledWith(ID(101), true, 'project'));
    expect(
      screen.getByRole('button', { name: 'Eigenes Objekt „Meins“ – keine Stimme möglich' }),
    ).toBeDisabled();
    expect(
      screen.getAllByTitle(/Gain 100 · Offset 50 · Binning 1×1 · Auslesemodus High Gain/),
    ).toHaveLength(2);
    await expectNoSeriousA11y();
  });

  it('Admin: Freigeben mit Position am Ende, Zurückgeben nur mit Kommentar, Ablehnen über ConfirmDialog', async () => {
    state.queue = [item(1)];
    state.approve.mockResolvedValue({});
    state.returnToUser.mockResolvedValue({});
    state.reject.mockResolvedValue({});
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Entscheiden' }));
    const panel = screen.getByRole('region', { name: 'Entscheidung: „Objekt 1“' });
    expect(panel).toHaveTextContent('Gern vor Weihnachten');
    await waitFor(() => expect(within(panel).getByLabelText('Position je Rig')).toHaveValue(3));

    fireEvent.click(within(panel).getByRole('button', { name: 'Zurückgeben' }));
    expect(
      within(panel).getByText('Zum Zurückgeben oder Ablehnen ist ein Kommentar Pflicht.'),
    ).toBeInTheDocument();
    expect(state.returnToUser).not.toHaveBeenCalled();

    fireEvent.change(within(panel).getByLabelText('Kommentar'), {
      target: { value: 'Außerhalb der Saison' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: 'Ablehnen' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ablehnen' }));
    await waitFor(() =>
      expect(state.reject).toHaveBeenCalledWith(ID(101), 'Außerhalb der Saison', 7),
    );
  });

  it('Admin: Freigeben sendet Rig, Position, Status und Kommentar mit Version', async () => {
    state.queue = [item(1, { requestPeriodFrom: '2026-10-01' })];
    state.approve.mockResolvedValue({});
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Entscheiden' }));
    const panel = screen.getByRole('region', { name: 'Entscheidung: „Objekt 1“' });
    await waitFor(() => expect(within(panel).getByLabelText('Position je Rig')).toHaveValue(3));
    fireEvent.change(within(panel).getByLabelText('Position je Rig'), { target: { value: '1' } });
    fireEvent.click(within(panel).getByLabelText('Planung'));
    fireEvent.click(within(panel).getByRole('button', { name: 'Freigeben' }));
    await waitFor(() =>
      expect(state.approve).toHaveBeenCalledWith(
        ID(101),
        {
          rigId: ID(500),
          priorityPosition: 1,
          status: 'planning',
          startDate: '2026-10-01',
          dueDate: null,
          comment: null,
        },
        7,
      ),
    );
  });

  it('User: keine Entscheiden-Spalte', async () => {
    state.me = me('user');
    state.queue = [item(1)];
    renderPage();
    expect(await screen.findByRole('link', { name: 'Objekt 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entscheiden' })).not.toBeInTheDocument();
  });
});

describe('Filterleiste (AP-26c)', () => {
  it('Filter setzen ergibt Chip, × entfernt ihn; Suche nach Objekt und Einreicher; axe', async () => {
    state.me = me('user');
    state.queue = [
      item(1, {
        name: 'M 31',
        votes: { count: 1, voters: [], mine: true, mineChangedSince: true },
      }),
      item(2, { name: 'IC 1396', createdByName: 'Ben' }),
    ];
    renderPage();
    await screen.findByRole('link', { name: 'M 31' });
    expect(screen.getByRole('status')).toHaveTextContent('2 von 2 Einträgen');
    const more = screen.getByRole('button', { name: 'Filter' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('nur ohne meine Stimme')).not.toBeInTheDocument();
    fireEvent.click(more);
    fireEvent.click(screen.getByLabelText('nur ohne meine Stimme'));
    expect(screen.queryByRole('link', { name: 'M 31' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Aufwand'), { target: { value: 'none' } });
    const chips = screen.getByRole('list', { name: 'Aktive Filter' });
    expect(chips).toHaveTextContent('nur ohne meine Stimme');
    expect(chips).toHaveTextContent('Aufwand:');
    await expectNoSeriousA11y();
    fireEvent.click(more);
    fireEvent.click(screen.getByRole('button', { name: 'Filter nur ohne meine Stimme entfernen' }));
    expect(screen.getByRole('link', { name: 'M 31' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Filter Aufwand: .* entfernen$/ }));
    expect(screen.queryByRole('list', { name: 'Aktive Filter' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Suche' }), {
      target: { value: 'ben' },
    });
    expect(screen.getByRole('link', { name: 'IC 1396' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'M 31' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 von 2 Einträgen');
  });
});

describe('Sichtbarkeit 4 Wochen (AP-24)', () => {
  it('vier Mini-Balken je Eintrag am Standort des Wunsch-Rigs; ohne Koordinaten „–“', async () => {
    state.me = me('user');
    state.queue = [
      item(1, { name: 'M 31', target: { raDeg: 10.68, decDeg: 41.27 } }),
      item(2, { name: 'Südziel', target: { raDeg: 0, decDeg: -80 } }),
      item(3, { name: 'Ohne Ziel' }),
    ];
    renderPage();
    const m31 = await screen.findByRole('img', {
      name: /Sichtbarkeit von M 31 in den nächsten 4 Wochen/,
    });
    expect(m31.getAttribute('aria-label')).toMatch(/ab 26\.09\. \d+,\d h je Nacht · ab 03\.10\./);
    expect(m31.children).toHaveLength(4);
    const south = screen.getByRole('img', { name: /Sichtbarkeit von Südziel/ });
    expect(south.getAttribute('aria-label')).toContain(
      '0,0 h je Nacht (Mindestzeit nicht erreicht)',
    );
    const row = screen.getByRole('link', { name: 'Ohne Ziel' }).closest('tr') as HTMLElement;
    expect(within(row).queryByRole('img', { name: /Sichtbarkeit/ })).not.toBeInTheDocument();
    await expectNoSeriousA11y();
  });
});

describe('Sortierung per Spaltenkopf (AP-26a)', () => {
  it('Klick auf „Objekt“ sortiert auf- und absteigend', async () => {
    state.me = me('user');
    state.queue = [
      item(1, { name: 'M 31' }),
      item(2, { name: 'IC 1396' }),
      item(3, { name: 'M 101' }),
    ];
    renderPage();
    const head = await screen.findByRole('columnheader', { name: /Objekt/ });
    const order = () =>
      screen
        .getAllByRole('link')
        .filter((l) => /^(M|IC) /.test(l.textContent ?? ''))
        .map((l) => l.textContent);
    expect(order()).toEqual(['M 31', 'IC 1396', 'M 101']);
    fireEvent.click(within(head).getByRole('button'));
    expect(order()).toEqual(['IC 1396', 'M 31', 'M 101']);
    fireEvent.click(within(head).getByRole('button'));
    expect(order()).toEqual(['M 101', 'M 31', 'IC 1396']);
    expect(head).toHaveAttribute('aria-sort', 'descending');
  });
});
