// @vitest-environment jsdom
/** Rechteanzeige (AP-06a): Administration nur mit member.manage; Hinweis bei mfaRequired statt stiller Ausblendung (SV-03). */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../test/setup';
import type { Me } from '../api/client';
import { AppearanceProvider } from '../app/theme';
import { AuthProvider } from '../auth';
import { Shell } from './Shell';

const me = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../api/client', () => ({
  api: {
    me: () => Promise.resolve(me.current),
    notifications: () =>
      Promise.resolve({
        items: [
          {
            id: '00000000-0000-4000-8000-0000000000f1',
            kind: 'role.changed',
            payload: { from: 'user', to: 'admin' },
            projectId: null,
            readAt: null,
            createdAt: '2026-09-24T10:00:00.000Z',
          },
        ],
        unreadCount: 1,
        nextCursor: null,
      }),
  },
}));

function member(
  role: 'owner' | 'admin' | 'user',
  effectiveRole: 'admin' | 'user',
  mfa: boolean,
): Me {
  return {
    identity: {
      id: '00000000-0000-4000-8000-000000000001',
      discordUserId: '1',
      username: 'u',
      globalName: 'Uta',
      avatarHash: null,
      mfa,
    },
    context: 'tenant',
    tenant: {
      id: '00000000-0000-4000-8000-00000000000a',
      key: 'demo',
      name: 'Demo',
      timeZone: 'Europe/Berlin',
    },
    member: { id: '00000000-0000-4000-8000-0000000000a1', displayName: 'Uta', role, effectiveRole },
    isSuperUser: false,
    mfaRequired: role !== 'user' && !mfa,
    memberships: [{ tenantKey: 'demo', tenantName: 'Demo', role }],
  };
}

async function renderShell(value: Me) {
  me.current = value;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <AuthProvider>
          <AppearanceProvider>
            <Shell>
              <p>Inhalt</p>
            </Shell>
          </AppearanceProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText('Inhalt');
  await screen.findByRole('button', { name: 'Benutzermenü' });
}

const nav = () => screen.getByRole('navigation', { name: 'Hauptnavigation' });

describe('Rechteanzeige in der Shell', () => {
  it('Admin mit 2FA: Administration sichtbar, kein Hinweis; axe', async () => {
    await renderShell(member('admin', 'admin', true));
    expect(nav()).toHaveTextContent('Administration');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await expectNoSeriousA11y();
  });

  it('User: keine Administration', async () => {
    await renderShell(member('user', 'user', false));
    expect(nav()).not.toHaveTextContent('Administration');
  });

  it('Projekte und Planung sind Links (S-31, S-20); nicht gebaute Bereiche bleiben deaktiviert', async () => {
    await renderShell(member('user', 'user', false));
    expect(within(nav()).getByRole('link', { name: 'Projekte' })).toHaveAttribute(
      'href',
      '/projekte',
    );
    expect(within(nav()).getByRole('link', { name: 'Planung' })).toHaveAttribute(
      'href',
      '/planung/sternkarte',
    );
    expect(within(nav()).queryByRole('link', { name: 'Wetter' })).not.toBeInTheDocument();
  });

  it('Owner ohne 2FA: wirkt als User (keine Administration) und sieht den Hinweis', async () => {
    await renderShell(member('owner', 'user', false));
    expect(nav()).not.toHaveTextContent('Administration');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Admin-Rechte ruhen, bis Discord-2FA aktiv ist',
    );
    expect(screen.getByRole('button', { name: 'Benutzermenü' })).toHaveTextContent('(Owner)');
  });

  it('Glocke im Mandanten zeigt den Zähler ungelesener Benachrichtigungen (AP-06b)', async () => {
    await renderShell(member('user', 'user', false));
    expect(
      await screen.findByRole('button', { name: 'Benachrichtigungen, 1 ungelesen' }),
    ).toHaveTextContent('1');
  });
});
