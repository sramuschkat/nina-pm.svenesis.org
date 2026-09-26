// @vitest-environment jsdom
/**
 * S-70 Mitglieder & Einladungen (AP-26b): Reiter *Mitglieder* / *Offene Einladungen (n)*, *Einladen* und
 * *Owner übertragen* als Dialoge aus dem Seitenkopf (Fokus aufs erste Feld, `Esc` schließt, Fokus zurück
 * zum Knopf), *Owner übertragen* nur für den Owner und weiterhin mit `ConfirmDialog`; axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { Invitation, Me, Member } from '../../api/client';
import { AuthProvider } from '../../auth';
import { MembersPage } from './MembersPage';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const state = vi.hoisted(() => ({
  me: null as unknown,
  members: [] as unknown[],
  invitations: [] as unknown[],
  invite: vi.fn(),
  transferOwner: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  api: { me: () => Promise.resolve(state.me) },
  memberApi: {
    list: () => Promise.resolve({ members: state.members }),
    invitations: () => Promise.resolve({ invitations: state.invitations }),
    invite: (...a: unknown[]) => state.invite(...a) as Promise<unknown>,
    patch: () => Promise.resolve(undefined),
    remove: () => Promise.resolve(undefined),
    setRole: () => Promise.resolve(undefined),
    endSessions: () => Promise.resolve(undefined),
    revokeInvitation: () => Promise.resolve(undefined),
  },
  tenantApi: {
    transferOwner: (...a: unknown[]) => state.transferOwner(...a) as Promise<unknown>,
  },
}));

const member = (n: number, displayName: string, role: Member['role']): Member => ({
  id: ID(n),
  displayName,
  discordUsername: displayName.toLowerCase().replace(' ', '.'),
  avatarHash: null,
  role,
  status: 'active',
  mfa: true,
  rightsDormant: false,
  lastLoginAt: '2026-09-20T18:00:00Z',
  objects: { draft: 1, submitted: 0, approved: 2 },
});

const me = (role: 'owner' | 'admin'): Me => ({
  identity: {
    id: ID(90),
    discordUserId: '1',
    username: 'u',
    globalName: role === 'owner' ? 'Olivia' : 'Anton',
    avatarHash: null,
    mfa: true,
  },
  context: 'tenant',
  tenant: { id: ID(91), key: 'demo', name: 'Demo', timeZone: 'Europe/Berlin' },
  member: {
    id: role === 'owner' ? ID(1) : ID(2),
    displayName: role === 'owner' ? 'Olivia Owner' : 'Anton Admin',
    role,
    effectiveRole: 'admin',
  },
  isSuperUser: false,
  mfaRequired: false,
  memberships: [{ tenantKey: 'demo', tenantName: 'Demo', role }],
});

const invitation = (over: Partial<Invitation> = {}): Invitation => ({
  id: ID(50),
  role: 'user',
  discordUserId: null,
  note: 'Für Ben',
  maxUses: 1,
  usedCount: 0,
  expiresAt: '2999-01-01T00:00:00Z',
  revokedAt: null,
  createdAt: '2026-09-20T10:00:00Z',
  ownerOnly: false,
  ...over,
});

const renderPage = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/verwaltung/mitglieder']}>
        <AuthProvider>
          <MembersPage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  state.me = me('owner');
  state.members = [
    member(1, 'Olivia Owner', 'owner'),
    member(2, 'Anton Admin', 'admin'),
    member(3, 'Uta User', 'user'),
  ];
  state.invitations = [
    invitation(),
    // Widerrufen und abgelaufen zählen nicht als offen.
    invitation({ id: ID(51), note: 'Alt widerrufen', revokedAt: '2026-09-21T10:00:00Z' }),
    invitation({ id: ID(52), note: 'Abgelaufen', expiresAt: '2020-01-01T00:00:00Z' }),
  ];
  state.invite.mockReset();
  state.transferOwner.mockReset();
});

describe('S-70 Reiter', () => {
  it('Mitglieder zuerst; „Offene Einladungen (1)“ zeigt nur offene Einladungen; axe', async () => {
    renderPage();
    const membersTab = screen.getByRole('tab', { name: 'Mitglieder' });
    expect(membersTab).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('button', { name: 'Anton Admin' })).toBeInTheDocument();
    const invTab = await screen.findByRole('tab', { name: 'Offene Einladungen (1)' });
    await expectNoSeriousA11y();

    fireEvent.click(invTab);
    expect(invTab).toHaveAttribute('aria-selected', 'true');
    const table = screen.getByRole('table', { name: 'Offene Einladungen' });
    expect(within(table).getByText('Für Ben')).toBeInTheDocument();
    expect(within(table).queryByText('Alt widerrufen')).toBeNull();
    expect(within(table).queryByText('Abgelaufen')).toBeNull();
    expect(screen.queryByRole('table', { name: 'Mitglieder' })).toBeNull();

    fireEvent.click(membersTab);
    expect(screen.getByRole('table', { name: 'Mitglieder' })).toBeInTheDocument();
  });

  it('Mitglied wählen: Liste bleibt sichtbar, Detail mit Aktionen daneben', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Anton Admin' }));
    expect(screen.getByRole('heading', { name: 'Anton Admin' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Admin-Rechte entziehen' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Mitglieder' })).toBeInTheDocument();
  });
});

describe('S-70 Dialog „Einladen“', () => {
  it('öffnet mit Fokus aufs erste Feld, Esc schließt, Fokus zurück zum Knopf', async () => {
    renderPage();
    await screen.findByRole('tab', { name: 'Offene Einladungen (1)' });
    const trigger = screen.getByRole('button', { name: 'Einladen' });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Einladen' });
    // Owner: erstes Feld ist die Rolle (User vorausgewählt).
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: 'User' })).toHaveFocus());
    expect(within(dialog).getByRole('radio', { name: 'Admin' })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('erzeugt die Einladung und zeigt den Link im Dialog; Schließen', async () => {
    state.invite.mockResolvedValue({
      id: ID(60),
      role: 'user',
      link: 'https://nina-pm.svenesis.org/einladung#abc',
      expiresAt: '2026-10-03T10:00:00Z',
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Einladen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Einladen' });
    fireEvent.change(within(dialog).getByLabelText('Notiz'), { target: { value: 'Für Uwe' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'User einladen' }));
    expect(await within(dialog).findByTestId('invitation-link')).toHaveTextContent(
      '/einladung#abc',
    );
    expect(state.invite).toHaveBeenCalledWith(
      'user',
      expect.objectContaining({ note: 'Für Uwe', maxUses: 1, validDays: 7 }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schließen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Admin: keine Rollenwahl, Fokus auf dem Discord-ID-Feld', async () => {
    state.me = me('admin');
    renderPage();
    await screen.findByRole('tab', { name: 'Offene Einladungen (1)' });
    fireEvent.click(screen.getByRole('button', { name: 'Einladen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Einladen' });
    expect(within(dialog).queryByRole('radio')).toBeNull();
    await waitFor(() =>
      expect(within(dialog).getByLabelText('An Discord-User-ID binden (optional)')).toHaveFocus(),
    );
  });
});

describe('S-70 „Owner übertragen“', () => {
  it('nur für den Owner sichtbar', async () => {
    state.me = me('admin');
    renderPage();
    await screen.findByRole('button', { name: 'Olivia Owner' });
    expect(screen.getByRole('button', { name: 'Einladen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Owner übertragen' })).toBeNull();
  });

  it('Owner: Dialog → Admin wählen → ConfirmDialog → Übertragung', async () => {
    state.transferOwner.mockResolvedValue(undefined);
    renderPage();
    await screen.findByRole('button', { name: 'Anton Admin' });
    const trigger = screen.getByRole('button', { name: 'Owner übertragen' });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Owner übertragen' });
    const select = within(dialog).getByLabelText('Neuer Owner');
    await waitFor(() => expect(select).toHaveFocus());
    const submit = within(dialog).getByRole('button', { name: 'Owner übertragen' });
    expect(submit).toBeDisabled();
    fireEvent.change(select, { target: { value: ID(2) } });
    fireEvent.click(submit);
    const confirm = await screen.findByRole('alertdialog', {
      name: 'Owner-Rolle an „Anton Admin“ übertragen?',
    });
    expect(confirm).toHaveTextContent('Du bleibst Admin.');
    expect(state.transferOwner).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Owner übertragen' }));
    await waitFor(() => expect(state.transferOwner).toHaveBeenCalledWith(ID(2)));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
