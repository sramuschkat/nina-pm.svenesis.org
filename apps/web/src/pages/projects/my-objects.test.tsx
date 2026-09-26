// @vitest-environment jsdom
/**
 * S-32 Meine Objekte und S-34 Entwürfe (AP-12b): Reiter je Freigabestatus mit Zählern, Rangliste mit
 * Pfeilen (vollständige Liste an die API), Zurückziehen, Einreichen mit fehlenden Pflichtangaben,
 * Entwürfe nur für Admins; axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { Me } from '../../api/client';
import { ApiError, AuthProvider } from '../../auth';
import { DraftsPage } from './DraftsPage';
import { MyObjectsPage, reorder } from './MyObjectsPage';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ME = ID(3);

const state = vi.hoisted(() => ({
  me: null as unknown,
  mine: [] as unknown[],
  queue: [] as unknown[],
  drafts: [] as unknown[],
  ranking: vi.fn(),
  withdraw: vi.fn(),
  submit: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  api: { me: () => Promise.resolve(state.me) },
  equipmentApi: { list: () => Promise.resolve({ items: [] }) },
  projectsApi: {
    list: () => Promise.resolve({ items: state.mine }),
    history: () => Promise.resolve({ items: [] }),
  },
  approvalApi: {
    queue: () => Promise.resolve({ items: state.queue }),
    drafts: () => Promise.resolve({ items: state.drafts }),
    ranking: (...a: unknown[]) => state.ranking(...a) as Promise<unknown>,
    withdraw: (...a: unknown[]) => state.withdraw(...a) as Promise<unknown>,
    submit: (...a: unknown[]) => state.submit(...a) as Promise<unknown>,
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

const listItem = (n: number, approvalStatus: string, name = `Objekt ${String(n)}`) => ({
  id: ID(100 + n),
  name,
  approvalStatus,
  status: approvalStatus === 'approved' ? 'active' : null,
  createdBy: ME,
  createdByName: 'Uta',
  rigId: null,
  requestPeriodFrom: null,
  requestPeriodTo: null,
  requestComment: null,
  version: 4,
  updatedAt: '2026-09-20T18:30:00Z',
  progress: { percentDone: 0 },
  filters: [],
});

const queueItem = (n: number, rank: number, name: string) => ({
  kind: 'project',
  id: ID(100 + n),
  projectId: ID(100 + n),
  name,
  createdBy: ME,
  version: 5,
  expiresAt: n === 1 ? '2026-10-01T10:00:00Z' : null,
  votes: {
    count: 2,
    mine: false,
    mineChangedSince: false,
    voters: [
      { memberId: ID(7), displayName: 'Zoe', changedSinceVote: false },
      { memberId: ID(8), displayName: 'Max', changedSinceVote: false },
    ],
  },
  submitterRank: { rank, of: 2 },
});

function wrap(children: ReactNode) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <AuthProvider>{children}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.me = me('user');
  state.mine = [];
  state.queue = [];
  state.drafts = [];
  for (const fn of [state.ranking, state.withdraw, state.submit]) fn.mockReset();
});

describe('reorder', () => {
  it('verschiebt an die neue Stelle, die übrigen rücken nach', () => {
    expect(reorder(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(reorder(['a', 'b', 'c'], 'a', 5)).toEqual(['b', 'c', 'a']);
  });
});

describe('S-32 Meine Objekte', () => {
  it('Rangliste: Reiter mit Zählern, Pfeil schickt die vollständige Reihenfolge, Frist mit Kürzel; axe', async () => {
    state.mine = [
      listItem(1, 'submitted', 'Erstes'),
      listItem(2, 'submitted', 'Zweites'),
      listItem(3, 'draft'),
    ];
    state.queue = [queueItem(1, 1, 'Erstes'), queueItem(2, 2, 'Zweites')];
    state.ranking.mockResolvedValue(undefined);
    wrap(<MyObjectsPage />);
    expect(await screen.findByRole('tab', { name: 'Eingereicht (2)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Entwurf (1)' })).toBeInTheDocument();
    const list = await screen.findByRole('list', {
      name: 'Rangfolge deiner eingereichten Objekte',
    });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Erstes');
    expect(items[0]).toHaveTextContent(/Frist .*MESZ/);
    expect(items[1]).toHaveTextContent('ohne Frist');
    expect(within(items[0] as HTMLElement).getByText('Stimmen: 2')).toHaveAttribute(
      'title',
      'Zoe, Max',
    );
    fireEvent.click(screen.getByRole('button', { name: '„Zweites“ nach oben' }));
    await waitFor(() => expect(state.ranking).toHaveBeenCalledWith([ID(102), ID(101)]));
    await expectNoSeriousA11y();
  });

  it('Zurückziehen mit Version; Einreichen zeigt fehlende Pflichtangaben', async () => {
    state.mine = [listItem(1, 'submitted', 'Eingereicht'), listItem(2, 'draft', 'Mein Entwurf')];
    state.queue = [queueItem(1, 1, 'Eingereicht')];
    state.withdraw.mockResolvedValue({});
    state.submit.mockRejectedValue(
      new ApiError({
        status: 422,
        code: 'approval.incomplete',
        errors: [
          { path: 'coordinates', message: 'fehlt' },
          { path: 'lines', message: 'fehlt' },
        ],
      }),
    );
    wrap(<MyObjectsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Zurückziehen' }));
    await waitFor(() => expect(state.withdraw).toHaveBeenCalledWith(ID(101), 5));

    fireEvent.click(screen.getByRole('tab', { name: 'Entwurf (1)' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Einreichen' }));
    const form = screen.getByRole('form', { name: '„Mein Entwurf“ einreichen' });
    fireEvent.change(within(form).getByLabelText('Begründung / Kommentar'), {
      target: { value: 'Bitte vor Weihnachten' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Einreichen' }));
    const alert = await within(form).findByRole('alert');
    expect(alert).toHaveTextContent('Koordinaten (RA/Dec)');
    expect(alert).toHaveTextContent('aktive Belichtungszeile');
    expect(state.submit).toHaveBeenCalledWith(
      ID(102),
      {
        requestedRigId: null,
        requestPeriodFrom: null,
        requestPeriodTo: null,
        requestComment: 'Bitte vor Weihnachten',
      },
      4,
    );
  });
});

describe('S-34 Entwürfe', () => {
  it('Admin: Liste mit Ersteller und „zuletzt geändert“ in Mandantenzeit', async () => {
    state.me = me('owner');
    state.drafts = [{ ...listItem(4, 'returned', 'Zurück'), createdByName: 'Zoe' }];
    wrap(<DraftsPage />);
    const row = (await screen.findByRole('link', { name: 'Zurück' })).closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('Zoe');
    expect(row).toHaveTextContent(/20:30 MESZ/);
    expect(row).toHaveTextContent('Zurückgegeben');
  });

  it('Sortierung per Spaltenkopf (AP-26a): Klick auf „Ersteller“ sortiert auf- und absteigend', async () => {
    state.me = me('owner');
    state.drafts = [
      { ...listItem(4, 'draft', 'Mitte'), createdByName: 'Max' },
      { ...listItem(5, 'draft', 'Letzter'), createdByName: 'Zoe' },
      { ...listItem(6, 'returned', 'Erster'), createdByName: 'Anna' },
    ];
    wrap(<DraftsPage />);
    const head = await screen.findByRole('columnheader', { name: /Ersteller/ });
    const order = () =>
      screen.getAllByRole('link', { name: /^(Mitte|Letzter|Erster)$/ }).map((l) => l.textContent);
    expect(order()).toEqual(['Mitte', 'Letzter', 'Erster']);
    fireEvent.click(within(head).getByRole('button'));
    expect(order()).toEqual(['Erster', 'Mitte', 'Letzter']);
    fireEvent.click(within(head).getByRole('button'));
    expect(order()).toEqual(['Letzter', 'Mitte', 'Erster']);
    expect(head).toHaveAttribute('aria-sort', 'descending');
  });

  it('User: keine Berechtigung, kein Reiter „Entwürfe“', async () => {
    wrap(<DraftsPage />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Entwürfe' })).not.toBeInTheDocument();
  });
});
