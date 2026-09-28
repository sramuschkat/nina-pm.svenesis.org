// @vitest-environment jsdom
/**
 * S-01b Mandantenauswahl – Prüfung 28.09.2026: Beim Wechsel wird der Cache des vorigen Mandanten verworfen
 * (nur die Anmeldung bleibt), sonst zeigen Seiten kurz dessen Daten und Editoren wählen dessen Objekte vor.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { expect, it, vi } from 'vitest';
import '../../test/setup';
import type { Me } from '../api/client';
import { AuthProvider } from '../auth';
import { SelectTenantPage } from './auth';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const state = vi.hoisted(() => ({ me: null as unknown, setContext: vi.fn() }));
vi.mock('../api/client', () => ({
  api: {
    me: () => Promise.resolve(state.me),
    setContext: (...a: unknown[]) => state.setContext(...a) as Promise<unknown>,
  },
}));

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
  tenant: { id: ID(2), key: 'a', name: 'Mandant A', timeZone: 'Europe/Berlin' },
  member: { id: ID(3), displayName: 'Uta', role: 'owner', effectiveRole: 'admin' },
  isSuperUser: false,
  mfaRequired: false,
  memberships: [
    { tenantKey: 'a', tenantName: 'Mandant A', role: 'owner' },
    { tenantKey: 'b', tenantName: 'Mandant B', role: 'user' },
  ],
};

it('Mandantenwechsel verwirft alle Abfragen außer der Anmeldung', async () => {
  state.me = me;
  state.setContext.mockResolvedValue({});
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['equipment', 'sites'], [{ id: ID(10), name: 'A-Sternwarte' }]);
  client.setQueryData(['projects', 'list'], []);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/mandant-waehlen']}>
        <AuthProvider>
          <Routes>
            <Route path="/mandant-waehlen" element={<SelectTenantPage />} />
            <Route path="*" element={<p>Start</p>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /Mandant B/ }));
  await screen.findByText('Start');
  expect(state.setContext).toHaveBeenCalledWith({ tenantKey: 'b' });
  await waitFor(() => expect(client.getQueryData(['equipment', 'sites'])).toBeUndefined());
  expect(client.getQueryData(['projects', 'list'])).toBeUndefined();
  expect(client.getQueryData(['auth', 'me'])).toBeDefined();
});
