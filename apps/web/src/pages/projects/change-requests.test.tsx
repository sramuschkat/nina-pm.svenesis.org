// @vitest-environment jsdom
/**
 * AP-32b: Reiter *Änderungsanträge* (Antrag stellen mit nur den geänderten Feldern, Gegenüberstellung,
 * Zurückziehen) und Entscheidung in der Warteschlange (Annehmen mit gesehener Projektversion, Ablehnen nur
 * mit Kommentar und Bestätigung, Konflikthinweis bei geänderter Fassung); axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { ChangeRequestView, Me, ProjectView, QueueItem } from '../../api/client';
import { ApiError, AuthProvider } from '../../auth';
import { ChangeRequestDecision } from './ChangeRequestDecision';
import { ChangeRequestsTab } from './ChangeRequestsTab';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const state = vi.hoisted(() => ({
  me: null as unknown,
  list: [] as unknown[],
  create: vi.fn(),
  withdraw: vi.fn(),
  decide: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  api: { me: () => Promise.resolve(state.me) },
  equipmentApi: {
    list: () => Promise.resolve({ items: [{ id: ID(202), shortName: 'OIII' }] }),
  },
  changeRequestsApi: {
    list: () => Promise.resolve({ items: state.list }),
    create: (...a: unknown[]) => state.create(...a) as Promise<unknown>,
    update: vi.fn(),
    withdraw: (...a: unknown[]) => state.withdraw(...a) as Promise<unknown>,
    decide: (...a: unknown[]) => state.decide(...a) as Promise<unknown>,
  },
  approvalApi: { impact: vi.fn() },
  jobsApi: { get: vi.fn(), result: vi.fn() },
}));

const me = (role: 'owner' | 'user', memberId = ID(3)): Me => ({
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
    id: memberId,
    displayName: 'Uta',
    role,
    effectiveRole: role === 'user' ? 'user' : 'admin',
  },
  isSuperUser: false,
  mfaRequired: false,
  memberships: [{ tenantKey: 'demo', tenantName: 'Demo', role }],
});

const project = {
  id: ID(10),
  name: 'NGC 281',
  createdBy: ID(3),
  approvalStatus: 'approved',
  descriptionMd: '',
  startDate: null,
  dueDate: null,
  version: 5,
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
  panels: [
    {
      id: ID(20),
      label: '1',
      lines: [
        {
          id: ID(30),
          panelId: ID(20),
          filterShortName: 'Ha',
          exposureS: 300,
          plannedCount: 30,
          enabled: true,
        },
      ],
    },
  ],
} as unknown as ProjectView;

const diff = [
  {
    field: 'line.plannedCount',
    lineId: ID(30),
    lineLabel: 'Ha · 300 s',
    current: 30,
    proposed: 50,
    unchanged: false,
  },
];

const request = (over: Partial<ChangeRequestView> = {}): ChangeRequestView => ({
  id: ID(40),
  projectId: ID(10),
  projectName: 'NGC 281',
  requestedBy: ID(3),
  requestedByName: 'Uta',
  version: 2,
  status: 'open',
  proposal: {},
  comment: 'mehr Ha',
  baseVersion: 5,
  projectVersion: 5,
  projectChangedSince: false,
  diff,
  createdAt: '2026-09-26T10:00:00Z',
  updatedAt: '2026-09-26T10:00:00Z',
  decidedAt: null,
  decidedBy: null,
  decidedByName: null,
  decisionComment: null,
  ...over,
});

const queueItem = (): QueueItem =>
  ({
    kind: 'change-request',
    id: ID(40),
    projectId: ID(10),
    name: 'NGC 281',
    createdBy: ID(3),
    createdByName: 'Uta',
    requestComment: 'mehr Ha',
    votes: {
      count: 1,
      voters: [{ memberId: ID(4), displayName: 'Max', changedSinceVote: false }],
      mine: false,
      mineChangedSince: false,
    },
    version: 2,
    changeRequest: {
      status: 'open',
      proposal: {},
      comment: 'mehr Ha',
      baseVersion: 4,
      projectVersion: 5,
      projectChangedSince: true,
      diff,
    },
  }) as unknown as QueueItem;

const wrap = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <AuthProvider>{ui}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  state.me = me('user');
  state.list = [];
  for (const f of [state.create, state.withdraw, state.decide]) f.mockReset();
});

describe('Reiter Änderungsanträge', () => {
  it('User stellt einen Antrag: nur geänderte Felder, neue Zeile; axe', async () => {
    state.create.mockResolvedValue(request());
    wrap(<ChangeRequestsTab project={project} canEdit={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Änderungsantrag stellen' }));
    const submit = screen.getByRole('button', { name: 'Antrag stellen' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Geplant Ha · 300 s'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Zeile hinzufügen' }));
    const group = screen.getByRole('group', { name: 'Neue Zeile 1' });
    await within(group).findByRole('option', { name: 'OIII' });
    fireEvent.change(within(group).getByLabelText('Filter'), { target: { value: ID(202) } });
    fireEvent.change(within(group).getByLabelText('Anzahl'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Begründung'), {
      target: { value: 'mehr Ha, OIII dazu' },
    });
    await expectNoSeriousA11y();
    fireEvent.click(submit);
    await waitFor(() => expect(state.create).toHaveBeenCalled());
    const [projectId, body] = state.create.mock.calls[0] as [string, Record<string, unknown>];
    expect(projectId).toBe(ID(10));
    expect(body.comment).toBe('mehr Ha, OIII dazu');
    expect(body.proposal).toEqual({
      lines: [{ lineId: ID(30), plannedCount: 50 }],
      newLines: [
        expect.objectContaining({
          panelId: ID(20),
          filterId: ID(202),
          exposureS: 300,
          plannedCount: 20,
        }),
      ],
    });
  });

  it('Liste mit Gegenüberstellung; eigener offener Antrag zurückziehen; Admin stellt keinen', async () => {
    state.list = [request()];
    state.withdraw.mockResolvedValue(request({ status: 'withdrawn' }));
    wrap(<ChangeRequestsTab project={project} canEdit={false} />);
    const card = await screen.findByRole('listitem', { name: 'Antrag von Uta' });
    expect(within(card).getByText('offen')).toBeTruthy();
    const row = within(card).getByRole('row', { name: /Geplant Ha · 300 s/ });
    expect(row.textContent).toContain('30');
    expect(row.textContent).toContain('50');
    fireEvent.click(within(card).getByRole('button', { name: 'Zurückziehen' }));
    await waitFor(() => expect(state.withdraw).toHaveBeenCalledWith(ID(40), 2));
  });

  it('Admin mit Bearbeitungsrecht sieht keinen Knopf zum Beantragen', async () => {
    state.me = me('owner', ID(9));
    wrap(<ChangeRequestsTab project={project} canEdit />);
    expect(await screen.findByText('Noch keine Änderungsanträge.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Änderungsantrag stellen' })).toBeNull();
  });
});

describe('Entscheidung (S-33)', () => {
  it('Annehmen mit gesehener Projektversion und Antragsversion; Hinweis auf geänderte Fassung; axe', async () => {
    state.me = me('owner', ID(9));
    state.decide.mockResolvedValue(request({ status: 'approved' }));
    const done = vi.fn();
    wrap(<ChangeRequestDecision item={queueItem()} own={false} onDone={done} />);
    expect(screen.getByText(/Das Projekt wurde seit dem Antrag geändert/)).toBeTruthy();
    expect(screen.getByRole('row', { name: /Geplant Ha · 300 s/ })).toBeTruthy();
    await expectNoSeriousA11y();
    fireEvent.click(screen.getByRole('button', { name: 'Annehmen' }));
    await waitFor(() =>
      expect(state.decide).toHaveBeenCalledWith(
        ID(40),
        { decision: 'approved', comment: null, projectVersion: 5 },
        2,
      ),
    );
    await waitFor(() => expect(done).toHaveBeenCalled());
  });

  it('Ablehnen nur mit Kommentar und Bestätigung; Konflikt zeigt den Hinweis', async () => {
    state.me = me('owner', ID(9));
    state.decide.mockRejectedValueOnce(
      new ApiError({ status: 409, code: 'change_request.conflict' }),
    );
    wrap(<ChangeRequestDecision item={queueItem()} own={false} onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ablehnen' }));
    expect(screen.getByText('Bitte begründe die Ablehnung.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Annehmen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/inzwischen geändert/);
    state.decide.mockResolvedValue(request({ status: 'rejected' }));
    fireEvent.change(screen.getByLabelText('Kommentar (Pflicht beim Ablehnen)'), {
      target: { value: 'nicht jetzt' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ablehnen' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ablehnen' }));
    await waitFor(() =>
      expect(state.decide).toHaveBeenLastCalledWith(
        ID(40),
        { decision: 'rejected', comment: 'nicht jetzt', projectVersion: 5 },
        2,
      ),
    );
  });
});
