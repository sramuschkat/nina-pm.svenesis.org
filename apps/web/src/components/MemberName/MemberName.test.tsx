// @vitest-environment jsdom
/**
 * `MemberName` (components.md §2.22) und die Anbindung `lib/member.tsx`: Bild aus dem Mitgliederverzeichnis,
 * Name aus der Zeile; ohne Bild bzw. bei Ladefehler das Personen-Symbol; ohne Anmelde-Kontext kein Verzeichnis.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { Me } from '../../api/client';
import { AuthProvider } from '../../auth';
import { Person } from '../../lib/member';
import { compactName, MemberName } from '.';

const state = vi.hoisted(() => ({ me: null as unknown, directory: vi.fn() }));
vi.mock('../../api/client', () => ({
  api: { me: () => Promise.resolve(state.me) },
  memberApi: { directory: () => state.directory() as Promise<unknown> },
}));

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const me: Me = {
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
  member: { id: ID(3), displayName: 'Uta', role: 'user', effectiveRole: 'user' },
  isSuperUser: false,
  mfaRequired: false,
  memberships: [{ tenantKey: 'demo', tenantName: 'Demo', role: 'user' }],
};

const wrap = (children: ReactNode, withAuth = true) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {withAuth ? <AuthProvider>{children}</AuthProvider> : children}
    </QueryClientProvider>,
  );

describe('MemberName (Baustein)', () => {
  it('Bild und Name; Ladefehler → Symbol; ohne Bild Symbol', () => {
    const { container, rerender } = render(
      <MemberName name="Zoe" avatarUrl="https://cdn.discordapp.com/avatars/7/abc.png?size=64" />,
    );
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('alt', '');
    fireEvent.error(img as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
    rerender(<MemberName name="Max" />);
    expect(screen.getByText('Max')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('MemberName compact (AP-64): Kürzung ab mehr als 10 Zeichen', () => {
  it('10 Zeichen bleiben, 11 Zeichen werden auf 10 + „…“ gekürzt', () => {
    expect(compactName('Maximilian')).toBe('Maximilian');
    expect(compactName('Maximiliane')).toBe('Maximilian…');
    expect(compactName('Maximilian Mustermann')).toBe('Maximilian…');
    expect(compactName('SvenR')).toBe('SvenR');
  });

  it('Umlaute zählen als ein Zeichen – auch zerlegt geschrieben', () => {
    expect(compactName('Jürgen Müll')).toBe('Jürgen Mül…');
    expect(compactName('Jürgen Mül')).toBe('Jürgen Mül');
    const decomposed = 'Ju\u0308rgen Mu\u0308l';
    expect(compactName(decomposed)).toBe(decomposed);
    expect(compactName(`${decomposed}x`)).toBe(`${decomposed}…`);
  });

  it('gekürzt: voller Name als Tooltip und aria-label; ungekürzt ohne; axe', async () => {
    const { container } = render(
      <>
        <MemberName name="Maximilian Mustermann" compact />
        <MemberName name="SvenR" compact />
      </>,
    );
    const cut = screen.getByRole('img', { name: 'Maximilian Mustermann' });
    expect(cut).toHaveAttribute('title', 'Maximilian Mustermann');
    expect(cut.textContent).toBe('Maximilian…');
    expect(screen.getByText('SvenR').closest('[title]')).toBeNull();
    expect(container.querySelectorAll('[aria-label]')).toHaveLength(1);
    await expectNoSeriousA11y();
  });
});

describe('Person (Verzeichnis)', () => {
  it('Bild aus dem Verzeichnis, Name aus der Zeile, sonst aus dem Verzeichnis; axe', async () => {
    state.me = me;
    state.directory.mockResolvedValue({
      items: [
        {
          id: ID(7),
          displayName: 'Zoe (neu)',
          avatarUrl: 'https://cdn.discordapp.com/avatars/7/abc.png?size=64',
          status: 'active',
        },
        { id: ID(8), displayName: 'Max', avatarUrl: null, status: 'active' },
      ],
    });
    const { container } = wrap(
      <>
        <Person id={ID(7)} name="Zoe" />
        <Person id={ID(8)} />
        <Person id={ID(9)} />
      </>,
    );
    expect(await screen.findByText('Max')).toBeInTheDocument();
    expect(screen.getByText('Zoe')).toBeInTheDocument();
    expect(screen.getByText('–')).toBeInTheDocument();
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'https://cdn.discordapp.com/avatars/7/abc.png?size=64',
    );
    await expectNoSeriousA11y();
  });

  it('ohne Anmelde-Kontext: kein Verzeichnis, nur Symbol und Name', () => {
    state.directory.mockClear();
    const { container } = wrap(<Person id={ID(7)} name="Zoe" />, false);
    expect(screen.getByText('Zoe')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(state.directory).not.toHaveBeenCalled();
  });
});
