// @vitest-environment jsdom
/**
 * Reiter *Kommentare* (FA-PRJ-17): Stränge mit eingerückten Antworten (oberste Ebene neueste zuerst, Antworten
 * älteste zuerst), Reaktion umschalten, Bearbeiten nur eigener Kommentare in der ersten Stunde, Löschen nur
 * Admin/Owner mit Bestätigung, Emoji-Auswahl fügt an der Cursorposition ein, Antworten; axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { Me, NoteView } from '../../api/client';
import { AuthProvider, useAuth } from '../../auth';
import { canEditComment, commentThreads, CommentsTab } from './CommentsTab';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ME = ID(3);
const OTHER = ID(9);
const PROJECT = ID(100);

const state = vi.hoisted(() => ({
  me: null as unknown,
  notes: [] as unknown[],
  add: vi.fn(),
  edit: vi.fn(),
  remove: vi.fn(),
  react: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  api: { me: () => Promise.resolve(state.me) },
  memberApi: { directory: () => Promise.resolve({ items: [] }) },
  projectsApi: {
    notes: () => Promise.resolve({ items: state.notes }),
    addNote: (...a: unknown[]) => state.add(...a) as Promise<unknown>,
    editNote: (...a: unknown[]) => state.edit(...a) as Promise<unknown>,
    deleteNote: (...a: unknown[]) => state.remove(...a) as Promise<unknown>,
    reactNote: (...a: unknown[]) => state.react(...a) as Promise<unknown>,
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

const NOW = Date.parse('2026-10-04T12:00:00Z');
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

const note = (n: number, over: Partial<NoteView> = {}): NoteView => ({
  id: ID(200 + n),
  userId: OTHER,
  authorName: 'Zoe',
  bodyMd: `Kommentar ${String(n)}`,
  createdAt: at(300 - n),
  parentId: null,
  editedAt: null,
  deletedAt: null,
  reactions: [],
  ...over,
});

function AfterAuth({ children }: { children: ReactNode }) {
  const { me: current } = useAuth();
  return current === undefined ? null : children;
}

const renderTab = (resource = { createdBy: OTHER, approvalStatus: 'approved' as const }) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <AuthProvider>
          <AfterAuth>
            <CommentsTab projectId={PROJECT} resource={resource} />
          </AfterAuth>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  state.me = me('user');
  state.notes = [];
  for (const fn of [state.add, state.edit, state.remove, state.react]) fn.mockReset();
  state.add.mockResolvedValue(note(99));
  state.edit.mockResolvedValue(note(99));
  state.remove.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe('Modell', () => {
  it('Stränge: oberste Ebene neueste zuerst, Antworten älteste zuerst', () => {
    const a = note(1);
    const b = note(2);
    const r1 = note(3, { parentId: a.id });
    const r2 = note(4, { parentId: a.id });
    // API: flach, neueste zuerst.
    const threads = commentThreads([r2, r1, b, a]);
    expect(threads.map((t) => [t.top.id, t.replies.map((r) => r.id)])).toEqual([
      [b.id, []],
      [a.id, [r1.id, r2.id]],
    ]);
  });

  it('Bearbeiten nur eigener, nicht gelöschter Kommentare in der ersten Stunde', () => {
    expect(canEditComment(note(1, { userId: ME, createdAt: at(59) }), ME, NOW)).toBe(true);
    expect(canEditComment(note(1, { userId: ME, createdAt: at(61) }), ME, NOW)).toBe(false);
    expect(canEditComment(note(1, { createdAt: at(1) }), ME, NOW)).toBe(false);
    expect(
      canEditComment(note(1, { userId: ME, createdAt: at(1), deletedAt: at(0) }), ME, NOW),
    ).toBe(false);
  });
});

describe('Reiter Kommentare (FA-PRJ-17)', () => {
  it('Strang mit eingerückten Antworten, „bearbeitet“ und „Kommentar gelöscht“; axe', async () => {
    const top = note(1, { bodyMd: 'Schönes **Framing**' });
    state.notes = [
      note(3, { parentId: top.id, bodyMd: 'Danke', editedAt: at(100) }),
      note(2, { parentId: top.id, bodyMd: '', deletedAt: at(10) }),
      top,
    ];
    const { container } = renderTab();
    const replies = await screen.findByRole('list', {
      name: 'Antworten auf den Kommentar von Zoe',
    });
    const items = within(replies).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Kommentar gelöscht');
    expect(items[1]).toHaveTextContent('Danke');
    expect(items[1]).toHaveTextContent('bearbeitet');
    expect(screen.getByText('Framing').tagName).toBe('STRONG');
    await expectNoSeriousA11y(container);
  });

  it('Reaktion: Klick schaltet die eigene um; Auswahl aus der festen Liste', async () => {
    const c = note(1, { reactions: [{ emoji: '👍', count: 2, mine: true }] });
    state.notes = [c];
    state.react.mockResolvedValue({ ...c, reactions: [{ emoji: '👍', count: 1, mine: false }] });
    renderTab();
    const own = await screen.findByRole('button', { name: 'Reaktion 👍: 2' });
    expect(own).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(own);
    await waitFor(() => expect(state.react).toHaveBeenCalledWith(PROJECT, c.id, '👍', false));
    expect(await screen.findByRole('button', { name: 'Reaktion 👍: 1' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reaktion hinzufügen' }));
    const picker = await screen.findByRole('group', { name: 'Reaktion hinzufügen' });
    expect(
      within(picker)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['👍', '❤️', '🎉', '😄', '😮', '🙏', '🔭']);
    fireEvent.click(within(picker).getByRole('button', { name: '🔭' }));
    await waitFor(() => expect(state.react).toHaveBeenCalledWith(PROJECT, c.id, '🔭', true));
  });

  it('Bearbeiten nur beim eigenen Kommentar in der ersten Stunde', async () => {
    state.notes = [
      note(1, { userId: ME, authorName: 'Uta', createdAt: at(30), bodyMd: 'Tippfeler' }),
      note(2, { userId: ME, authorName: 'Uta', createdAt: at(90), bodyMd: 'Alt' }),
      note(3, { createdAt: at(5), bodyMd: 'Fremd' }),
    ];
    renderTab();
    await screen.findByText('Tippfeler');
    const edits = screen.getAllByRole('button', { name: 'Bearbeiten' });
    expect(edits).toHaveLength(1);
    fireEvent.click(edits[0] as HTMLElement);
    const field = screen.getByLabelText('Kommentar bearbeiten (Markdown)');
    expect(field).toHaveValue('Tippfeler');
    fireEvent.change(field, { target: { value: 'Tippfehler' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(state.edit).toHaveBeenCalledWith(PROJECT, ID(201), 'Tippfehler'));
  });

  it('Löschen nur für Admins, mit Bestätigung', async () => {
    state.notes = [note(1)];
    const user = renderTab();
    await screen.findByText('Kommentar 1');
    expect(screen.queryByRole('button', { name: 'Löschen' })).toBeNull();
    user.unmount();

    state.me = me('owner');
    renderTab();
    await screen.findByText('Kommentar 1');
    fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Kommentar löschen?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(state.remove).toHaveBeenCalledWith(PROJECT, ID(201)));
  });

  it('Emoji-Auswahl fügt an der Cursorposition ein; Kommentar und Antwort senden', async () => {
    const top = note(1);
    state.notes = [top];
    renderTab();
    const field = await screen.findByLabelText('Neuer Kommentar (Markdown, Emoji erlaubt)');
    fireEvent.change(field, { target: { value: 'Klarer Himmel' } });
    (field as HTMLTextAreaElement).setSelectionRange(6, 6);
    const [pickerButton] = screen.getAllByRole('button', { name: 'Emoji einfügen' });
    fireEvent.click(pickerButton as HTMLElement);
    const picker = await screen.findByRole('group', { name: 'Emoji einfügen' });
    fireEvent.click(within(picker).getByRole('button', { name: '🔭' }));
    expect(field).toHaveValue('Klarer🔭 Himmel');
    fireEvent.click(screen.getByRole('button', { name: 'Kommentieren' }));
    await waitFor(() => expect(state.add).toHaveBeenCalledWith(PROJECT, 'Klarer🔭 Himmel', null));
    await waitFor(() => expect(field).toHaveValue(''));

    fireEvent.click(screen.getByRole('button', { name: 'Antworten' }));
    const reply = screen.getByLabelText('Antwort an Zoe (Markdown)');
    fireEvent.change(reply, { target: { value: 'Gern' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Antwort senden' }));
      await Promise.resolve();
    });
    await waitFor(() => expect(state.add).toHaveBeenCalledWith(PROJECT, 'Gern', top.id));
  });

  it('Entwurf eines anderen: User sieht weder Eingabe noch Antworten', async () => {
    state.notes = [note(1)];
    renderTab({ createdBy: OTHER, approvalStatus: 'draft' as never });
    await screen.findByText('Kommentar 1');
    expect(screen.queryByLabelText('Neuer Kommentar (Markdown, Emoji erlaubt)')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Antworten' })).toBeNull();
  });
});
