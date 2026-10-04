// @vitest-environment jsdom
/**
 * NINA › Hilfe: Sequencer – alle zehn Bausteine mit Art und Verzeichnis-Eintrag, Einstellungen als Tabelle,
 * Sprache folgt der Oberfläche, axe.
 */
import { sequencerHelp } from '@nina-pm/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { Me } from '../../api/client';
import { AuthProvider } from '../../auth';
import { SequencerHelpPage } from './SequencerHelpPage';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const me: Me = {
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
  member: { id: ID(3), displayName: 'Uta User', role: 'user', effectiveRole: 'user' },
  isSuperUser: false,
  mfaRequired: false,
  memberships: [{ tenantKey: 'demo', tenantName: 'Demo', role: 'user' }],
};
vi.mock('../../api/client', () => ({ api: { me: () => Promise.resolve(me) } }));

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/nina/hilfe']}>
        <AuthProvider>
          <SequencerHelpPage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('Sequencer-Hilfe', () => {
  it('Verzeichnis und Bausteine vollständig; Einstellungen als Tabelle; axe', async () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: 'Hilfe: NINA-PM im Advanced Sequencer' }),
    ).toBeInTheDocument();
    const toc = screen.getByRole('navigation', { name: 'Inhalt' });
    for (const item of sequencerHelp.de.items) {
      expect(within(toc).getByRole('link', { name: item.name })).toHaveAttribute(
        'href',
        `#${item.id}`,
      );
      expect(screen.getByRole('heading', { name: item.name, level: 3 })).toBeInTheDocument();
    }
    // Zehn NINA-Bausteine, die Trigger-Paare je in einem Abschnitt.
    expect(
      sequencerHelp.de.items
        .map((i) => i.name)
        .join(' / ')
        .split(' / '),
    ).toHaveLength(10);
    expect(
      screen.getByRole('table', { name: 'Einstellungen: NINA-PM Day Loop' }),
    ).toHaveTextContent('Höchstens Nächte');
    expect(screen.getByRole('table', { name: 'Vorlagenprüfung' })).toHaveTextContent(
      'safety_wait_not_last',
    );
    await expectNoSeriousA11y();
  });

  it('DE und EN haben dieselben Abschnitte', () => {
    const ids = (l: 'de' | 'en') => [
      ...sequencerHelp[l].templates.map((s) => s.id),
      ...sequencerHelp[l].items.map((i) => `${i.id}:${i.kind}:${i.settings.length}`),
      ...sequencerHelp[l].checks.rows.map((r) => r.code),
    ];
    expect(ids('en')).toEqual(ids('de'));
  });
});
