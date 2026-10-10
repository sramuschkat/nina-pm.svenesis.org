// @vitest-environment jsdom
/**
 * Standort-Statistik (S-64, AP-77): Einstufung der Nächte (gemessene Bewölkung vor Vorhersage bei Nächten ohne Session),
 * Tabelle aller Nächte immer sichtbar mit Qualität, Wolken, SQM, Mond und Seeing; kein „bewölkt erfassen“, keine
 * SQM-/Seeing-Balken; axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { ClearNightNight, Me } from '../../api/client';
import { AuthProvider } from '../../auth';
import { dayKind, SiteStatsPage } from './SiteStatsPage';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const state = vi.hoisted(() => ({ me: null as unknown, nights: [] as unknown[] }));

vi.mock('../../api/client', () => ({
  api: { me: () => Promise.resolve(state.me) },
  equipmentApi: {
    list: (kind: string) =>
      Promise.resolve({
        items:
          kind === 'rigs'
            ? [{ id: ID(500), name: 'Rig A', siteId: ID(600) }]
            : kind === 'sites'
              ? [{ id: ID(600), name: 'Starfront', timeZone: 'America/Chicago' }]
              : [],
      }),
  },
  sessionLogApi: {
    clearNights: () =>
      Promise.resolve({
        siteId: ID(600),
        siteName: 'Starfront',
        timeZone: 'America/Chicago',
        from: '2026-09-11',
        to: '2026-10-10',
        months: [
          { month: '2026-10', recorded: 1, usable: 1, usablePct: 100, meanUsableHours: 5.7 },
        ],
        nights: state.nights,
        accuracy: { hits: 1, compared: 1, hitPct: 100 },
      }),
  },
}));

const night = (n: Partial<ClearNightNight> & { night: string }): ClearNightNight => ({
  source: null,
  usable: null,
  usableHours: null,
  sessionIds: [],
  forecastRatingIndex: null,
  forecastNightMean: null,
  seeingArcsec: null,
  sqm: null,
  transparencyPct: null,
  forecastTransparencyPct: null,
  rejectedPct: null,
  ...n,
});

const me = (): Me => ({
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
  member: { id: ID(92), displayName: 'Uta', role: 'owner', effectiveRole: 'admin' },
  isSuperUser: false,
  mfaRequired: false,
  memberships: [{ tenantKey: 'demo', tenantName: 'Demo', role: 'owner' }],
});

beforeEach(() => {
  state.me = me();
  state.nights = [
    night({
      night: '2026-10-09',
      source: 'session',
      usable: true,
      usableHours: 5.7,
      sessionIds: [ID(1)],
      forecastRatingIndex: 3,
      qualityPct: 99.4,
      cloudPct: 2,
      cloudSource: 'images',
      sqmMeasured: 21.42,
      moonIllumPct: 1,
      forecastSeeingScore: 0.62,
    }),
    // Ohne Session: Vorhersage „gut“, gemessen aber bewölkt → bewölkt.
    night({ night: '2026-10-08', forecastRatingIndex: 3, cloudPct: 80, cloudSource: 'device' }),
  ];
});

describe('Standort-Statistik (S-64, AP-77)', () => {
  it('Einstufung: gemessene Bewölkung vor Vorhersage bei Nächten ohne Session', () => {
    const n = (o: Partial<ClearNightNight>) => night({ night: '2026-10-01', ...o });
    expect(dayKind(n({ cloudPct: 10, cloudSource: 'device' }))).toBe('clearUnused');
    expect(dayKind(n({ cloudPct: 40, cloudSource: 'device', forecastRatingIndex: 4 }))).toBe(
      'partial',
    );
    expect(dayKind(n({ cloudPct: 60, cloudSource: 'device', forecastRatingIndex: 4 }))).toBe(
      'cloudy',
    );
    // Ohne Messung zählt die Vorhersage; mit Session die Session.
    expect(dayKind(n({ forecastRatingIndex: 3 }))).toBe('clearUnused');
    expect(dayKind(n({ forecastRatingIndex: 1 }))).toBe('cloudy');
    expect(
      dayKind(n({ source: 'session', sessionIds: [ID(1)], cloudPct: 80, cloudSource: 'device' })),
    ).toBe('partial');
    expect(dayKind(n({ source: 'manual' }))).toBe('cloudy');
    expect(dayKind(undefined)).toBe('none');
  });

  it('Tabelle immer sichtbar mit den neuen Spalten; keine Balken, kein „bewölkt erfassen“; axe', async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/auswertung/standort']}>
          <AuthProvider>
            <SiteStatsPage />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const table = await screen.findByRole('table', { name: 'Alle Nächte' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent?.trim()),
    ).toEqual([
      'Nacht',
      'Status',
      'Belichtet',
      'Vorhersage',
      'Laut Bildern',
      'Qualität',
      'Wolken Ø',
      'SQM Ø',
      'Mond',
      'Seeing',
    ]);
    const first = within(table).getAllByRole('row')[1] as HTMLElement;
    expect(within(first).getByRole('link', { name: '09./10.10.' })).toBeTruthy();
    expect(within(first).getByText('klar, belichtet')).toBeTruthy();
    expect(within(first).getByText('99 % gut')).toBeTruthy();
    expect(within(first).getByText('21,42')).toBeTruthy();
    expect(within(first).getByText('62 %')).toBeTruthy();
    const second = within(table).getAllByRole('row')[2] as HTMLElement;
    expect(within(second).getByText('bewölkt')).toBeTruthy();
    expect(within(second).getByText('80 %')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /bewölkt erfassen/i })).toBeNull();
    expect(screen.queryByText('Alle Nächte als Tabelle')).toBeNull();
    expect(screen.queryByRole('img', { name: /SQM in/ })).toBeNull();
    await expectNoSeriousA11y();
  });
});
