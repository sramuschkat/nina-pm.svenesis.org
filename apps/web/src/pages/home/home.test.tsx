// @vitest-environment jsdom
/**
 * Startseite (AP-73): im Mandanten „Heute“ (Tests in `today.test.tsx`), im System-Kontext unverändert der Hinweis zur
 * Verwaltung; Monatsintegration der aktiven Projekte.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { Me, NightSession } from '../../api/client';
import { AuthProvider } from '../../auth';
import { HomePage } from './HomePage';
import { monthIntegration } from './today-parts';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const state = vi.hoisted(() => ({ me: null as unknown }));

vi.mock('../../api/client', () => ({
  api: { me: () => Promise.resolve(state.me) },
}));

const systemMe: Me = {
  identity: {
    id: ID(1),
    discordUserId: '1',
    username: 'u',
    globalName: 'Uta',
    avatarHash: null,
    mfa: true,
  },
  context: 'system',
  tenant: null,
  member: null,
  isSuperUser: true,
  mfaRequired: false,
  memberships: [{ tenantKey: 'demo', tenantName: 'Demo', role: 'owner' }],
};

const session = (n: number, over: Partial<NightSession> = {}): NightSession => ({
  id: ID(300 + n),
  rigId: ID(500),
  rigName: 'Rig A',
  siteTimeZone: 'America/Chicago',
  night: `2026-09-${String(10 + n)}`,
  status: 'completed',
  startedAt: `2026-09-${String(11 + n)}T02:00:00Z`,
  endedAt: `2026-09-${String(11 + n)}T09:00:00Z`,
  sessionEndUtc: null,
  createdOffline: false,
  ninaInstanceName: null,
  frames: 10,
  bonusFrames: 0,
  integrationS: 7_200,
  unassigned: 0,
  efficiency: null,
  weather: null,
  projects: [],
  ...over,
});

beforeEach(() => {
  state.me = systemMe;
});

describe('Modell', () => {
  it('monthIntegration: Summe und Nächte mit Aufnahmen im Monat', () => {
    const sessions = [
      session(1, { night: '2026-09-01', integrationS: 3_600 }),
      session(2, { night: '2026-09-01', integrationS: 1_800 }),
      session(3, { night: '2026-09-05', integrationS: 0 }),
      session(4, { night: '2026-08-31', integrationS: 7_200 }),
    ];
    expect(monthIntegration(sessions, '2026-09')).toEqual({ seconds: 5_400, nights: 1 });
    expect(monthIntegration([], '2026-09')).toEqual({ seconds: 0, nights: 0 });
  });
});

describe('Startseite (System-Kontext)', () => {
  it('bleibt der Hinweis zur Verwaltung, keine Seite „Heute“', async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <AuthProvider>
            <HomePage />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'System-Kontext' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'Willkommen bei NINA-PM' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Heute' })).toBeNull();
    await expectNoSeriousA11y();
  });
});
