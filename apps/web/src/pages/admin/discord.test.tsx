// @vitest-environment jsdom
/**
 * S-71 Reiter *Discord* (AP-60, FA-DIS-01…05): Kanal-Liste mit Webhook-Hinweis statt URL, letzte
 * Zustellung/letzter Fehler, Testnachricht, Kanal anlegen (URL-Prüfung im Formular, Kategorien,
 * Ereignisfilter), Löschen nur über den `ConfirmDialog`, Fehlerzustand, axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { DiscordChannelView, Me } from '../../api/client';
import { AuthProvider } from '../../auth';
import { DiscordSettingsPage } from './DiscordSettingsPage';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const state = vi.hoisted(() => ({
  me: null as unknown,
  settings: null as unknown,
  fail: false,
  createChannel: vi.fn(),
  deleteChannel: vi.fn(),
  testChannel: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  api: { me: () => Promise.resolve(state.me) },
  discordApi: {
    settings: () =>
      state.fail ? Promise.reject(new Error('down')) : Promise.resolve(state.settings),
    saveGuild: (g: unknown) => Promise.resolve(g),
    createChannel: (...a: unknown[]) => state.createChannel(...a) as Promise<unknown>,
    updateChannel: () => Promise.resolve(undefined),
    deleteChannel: (...a: unknown[]) => state.deleteChannel(...a) as Promise<unknown>,
    testChannel: (...a: unknown[]) => state.testChannel(...a) as Promise<unknown>,
  },
}));

const channel = (over: Partial<DiscordChannelView> = {}): DiscordChannelView => ({
  id: ID(10),
  name: '#np-alarme',
  webhookSet: true,
  webhookHint: 'wxyz',
  categories: ['alerts'],
  eventFilter: { disabledEvents: [], showNames: true },
  enabled: true,
  lastDeliveryAt: '2026-09-20T18:00:00Z',
  lastError: 'http_404',
  lastErrorAt: '2026-09-21T18:00:00Z',
  updatedAt: '2026-09-21T18:00:00Z',
  ...over,
});

const me: Me = {
  identity: {
    id: ID(90),
    discordUserId: '1',
    username: 'u',
    globalName: 'Olivia',
    avatarHash: null,
    mfa: true,
  },
  context: 'tenant',
  tenant: { id: ID(91), key: 'demo', name: 'Demo', timeZone: 'Europe/Berlin' },
  member: { id: ID(1), displayName: 'Olivia Owner', role: 'owner', effectiveRole: 'admin' },
  isSuperUser: false,
  mfaRequired: false,
  memberships: [{ tenantKey: 'demo', tenantName: 'Demo', role: 'owner' }],
};

const renderPage = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/verwaltung/discord']}>
        <AuthProvider>
          <DiscordSettingsPage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  state.me = me;
  state.fail = false;
  state.settings = {
    guild: { guildName: 'Sternfreunde', guildId: null, inviteUrl: null },
    channels: [channel()],
  };
  state.createChannel.mockReset().mockResolvedValue(channel({ id: ID(11) }));
  state.deleteChannel.mockReset().mockResolvedValue(undefined);
  state.testChannel.mockReset().mockResolvedValue({ ok: true, sentAt: '2026-09-22T10:00:00Z' });
});

describe('S-71 Discord', () => {
  it('Liste: Hinweis statt URL, Fehlertext, Testnachricht; axe', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Kanäle' });
    expect(within(table).getByText('#np-alarme')).toBeInTheDocument();
    expect(within(table).getByText('gesetzt – endet auf wxyz')).toBeInTheDocument();
    expect(within(table).getByText('Discord: Webhook unbekannt (404)')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Sternfreunde')).toBeInTheDocument();
    await expectNoSeriousA11y();
    fireEvent.click(within(table).getByRole('button', { name: 'Testnachricht' }));
    expect(await screen.findByText('Testnachricht an #np-alarme gesendet.')).toBeInTheDocument();
    expect(state.testChannel).toHaveBeenCalledWith(ID(10));
  });

  it('Kanal anlegen: fremder Host gesperrt, gültige URL mit Kategorien und Filter', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Kanal anlegen' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: '#np-freigaben' } });
    const url = within(dialog).getByLabelText('Webhook-URL');
    fireEvent.change(url, { target: { value: 'https://evil.example/api/webhooks/1/x' } });
    expect(url).toHaveAttribute('aria-invalid', 'true');
    const create = within(dialog).getByRole('button', { name: 'Anlegen' });
    expect(create).toBeDisabled();
    fireEvent.change(url, { target: { value: 'https://discord.com/api/webhooks/123456/abc-DEF' } });
    expect(create).toBeEnabled();
    fireEvent.click(within(dialog).getByLabelText('Einreichung zurückgezogen'));
    fireEvent.click(within(dialog).getByLabelText('Alarme & Betrieb'));
    await expectNoSeriousA11y();
    fireEvent.click(create);
    await waitFor(() => expect(state.createChannel).toHaveBeenCalled());
    expect(state.createChannel.mock.calls[0]?.[0]).toEqual({
      name: '#np-freigaben',
      webhookUrl: 'https://discord.com/api/webhooks/123456/abc-DEF',
      categories: ['approvals', 'alerts'],
      eventFilter: { disabledEvents: ['submission.withdrawn'], showNames: true },
      enabled: true,
    });
  });

  it('Löschen nur über den Bestätigungsdialog', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Kanäle' });
    fireEvent.pointerDown(
      within(table).getByRole('button', { name: 'Weitere Aktionen zu #np-alarme' }),
      {
        button: 0,
        ctrlKey: false,
      },
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Löschen' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Kanal #np-alarme löschen?' });
    expect(state.deleteChannel).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(state.deleteChannel).toHaveBeenCalledWith(ID(10)));
  });

  it('leer und Fehler', async () => {
    state.settings = { guild: { guildName: null, guildId: null, inviteUrl: null }, channels: [] };
    const { unmount } = renderPage();
    expect(await screen.findByText(/Noch keine Kanäle/)).toBeInTheDocument();
    unmount();
    state.fail = true;
    renderPage();
    expect(await screen.findByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument();
  });
});
