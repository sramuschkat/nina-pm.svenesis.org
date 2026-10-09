// @vitest-environment jsdom
/**
 * Rechteanzeige (AP-06a): Administration nur mit member.manage; Hinweis bei mfaRequired statt stiller
 * Ausblendung (SV-03). Rahmen (AP-26c): eine Kopfleiste mit Menü *Svenesis.org*; unter 1024 px
 * Navigation eingeklappt, aufgeklappt als Überlagerung (Esc und Klick daneben schließen). Rollenansicht
 * „Als User ansehen“ (30.09.2026): Menüeintrag nur für Admin/Owner mit 2FA, Hinweis mit *Zurück*.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../test/setup';
import type { Me } from '../api/client';
import { AppearanceProvider } from '../app/theme';
import { AuthProvider } from '../auth';
import { Shell } from './Shell';

const me = vi.hoisted(() => ({ current: null as unknown, viewAs: vi.fn() }));
vi.mock('../api/client', () => ({
  api: {
    me: () => Promise.resolve(me.current),
    viewAs: (asUser: boolean) => me.viewAs(asUser) as Promise<unknown>,
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

async function renderShell(value: Me, path = '/') {
  me.current = value;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
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

  it('Heute, Projekte, Planung und Wetter sind Links (S-02, S-31, S-20, S-50)', async () => {
    await renderShell(member('user', 'user', false));
    expect(within(nav()).getByRole('link', { name: 'Projekte' })).toHaveAttribute(
      'href',
      '/projekte',
    );
    expect(within(nav()).getByRole('link', { name: 'Planung' })).toHaveAttribute(
      'href',
      '/planung/objekte',
    );
    expect(within(nav()).getByRole('link', { name: 'Wetter' })).toHaveAttribute('href', '/wetter');
    // AP-73: „Heute Nacht“ ist Teil der Startseite „Heute“, kein eigener Menüpunkt mehr.
    expect(within(nav()).queryByRole('link', { name: 'Heute Nacht' })).toBeNull();
    expect(within(nav()).queryByRole('link', { name: 'Übersicht' })).toBeNull();
  });

  it('„Heute“ als eigener Menüpunkt ganz oben, aktiv nur auf der Startseite (AP-73)', async () => {
    await renderShell(member('user', 'user', false));
    const links = within(nav()).getAllByRole('link');
    expect(links[0]).toHaveAccessibleName('Heute');
    expect(links[0]).toHaveAttribute('href', '/');
    expect(links[0]).toHaveAttribute('aria-current', 'page');
  });

  it('„Heute“ ist auf anderen Seiten nicht aktiv', async () => {
    await renderShell(member('user', 'user', false), '/projekte');
    expect(within(nav()).getByRole('link', { name: 'Heute' })).not.toHaveAttribute('aria-current');
    expect(within(nav()).getByRole('link', { name: 'Projekte' })).toHaveAttribute(
      'aria-current',
      'page',
    );
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

/** Fensterbreite für `matchMedia` vortäuschen (jsdom kennt kein Layout). */
function mockNarrow(narrow: boolean) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: narrow && query.includes('max-width: 1023px'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('Rahmen (AP-26c)', () => {
  it('eine Kopfleiste: NINA-PM, Mandant, Menü Svenesis.org mit den Website-Links, Sprache', async () => {
    const user = userEvent.setup();
    await renderShell(member('user', 'user', false));
    const bar = screen.getAllByRole('banner')[0] as HTMLElement;
    expect(within(bar).getByRole('link', { name: 'NINA-PM' })).toHaveAttribute('href', '/');
    expect(bar).toHaveTextContent('Demo');
    expect(within(bar).getByRole('group', { name: 'Sprache' })).toBeInTheDocument();
    await user.click(within(bar).getByRole('button', { name: /Svenesis\.org/ }));
    const blog = await screen.findByRole('menuitem', { name: 'Blog' });
    expect(blog).toHaveAttribute('href', 'https://www.svenesis.org/blog/blog_de.html');
    await expectNoSeriousA11y();
  });

  it('breites Fenster: Navigation mit Beschriftung, einklappbar', async () => {
    mockNarrow(false);
    await renderShell(member('user', 'user', false));
    const toggle = within(nav()).getByRole('button', { name: 'Navigation einklappen' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(within(nav()).getByRole('button', { name: 'Navigation ausklappen' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('unter 1024 px: nur Symbole; aufgeklappt als Überlagerung, Esc und Klick daneben schließen', async () => {
    mockNarrow(true);
    await renderShell(member('user', 'user', false));
    const open = within(nav()).getByRole('button', { name: 'Navigation ausklappen' });
    expect(open).toHaveAttribute('aria-expanded', 'false');
    expect(nav().className).not.toMatch(/Overlay/);
    fireEvent.click(open);
    expect(nav().className).toMatch(/Overlay/);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(nav().className).not.toMatch(/Overlay/);
    fireEvent.click(within(nav()).getByRole('button', { name: 'Navigation ausklappen' }));
    const scrim = document.querySelector('[class*=scrim]') as HTMLElement;
    fireEvent.click(scrim);
    expect(nav().className).not.toMatch(/Overlay/);
  });
});

describe('Rollenansicht „Als User ansehen“ (30.09.2026)', () => {
  const asUserView = (): Me => {
    const m = member('owner', 'user', true);
    return { ...m, member: m.member ? { ...m.member, viewAsUser: true } : null };
  };

  it('Owner mit 2FA: Menüeintrag schaltet um; danach User-Rechte, Hinweis mit Zurück; axe', async () => {
    const user = userEvent.setup();
    me.viewAs.mockImplementation((asUser: boolean) => {
      me.current = asUser ? asUserView() : member('owner', 'admin', true);
      return Promise.resolve(me.current);
    });
    await renderShell(member('owner', 'admin', true));
    expect(within(nav()).getByRole('link', { name: 'Administration' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Benutzermenü' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Als User ansehen' }));
    expect(me.viewAs).toHaveBeenCalledWith(true);
    const banner = await screen.findByText(
      /Rollenansicht: Du siehst und handelst mit User-Rechten/,
    );
    expect(banner).toHaveTextContent('(Owner)');
    expect(within(nav()).queryByRole('link', { name: 'Administration' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Benutzermenü' })).toHaveTextContent(
      '(User-Ansicht)',
    );
    await expectNoSeriousA11y();
    await user.click(screen.getByRole('button', { name: 'Zurück zur Owner-Ansicht' }));
    expect(me.viewAs).toHaveBeenLastCalledWith(false);
    expect(await within(nav()).findByRole('link', { name: 'Administration' })).toBeInTheDocument();
    expect(screen.queryByText(/Rollenansicht:/)).toBeNull();
  });

  for (const [label, value] of [
    ['User', () => member('user', 'user', true)],
    ['Admin ohne 2FA', () => member('admin', 'user', false)],
  ] as const) {
    it(`${label}: kein Menüeintrag`, async () => {
      const user = userEvent.setup();
      await renderShell(value());
      await user.click(screen.getByRole('button', { name: 'Benutzermenü' }));
      await screen.findByRole('menuitem', { name: 'Abmelden' });
      expect(screen.queryByRole('menuitem', { name: 'Als User ansehen' })).toBeNull();
    });
  }
});
