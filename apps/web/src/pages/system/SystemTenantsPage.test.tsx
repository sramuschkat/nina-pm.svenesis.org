// @vitest-environment jsdom
/** S-80 (AP-07d, FA-SU-03): Spalte „Dateien“ mit Wert und Messzeitpunkt in Betreiberzeit mit Kürzel. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import '../../../test/setup';
import { formatBytes } from '../../lib/bytes';
import { SystemTenantsPage } from './SystemTenantsPage';

const tenant = (over: Record<string, unknown>) => ({
  id: '00000000-0000-4000-8000-00000000000a',
  tenantKey: 'alpha',
  displayName: 'Alpha',
  contact: null,
  status: 'active',
  ownerMemberId: null,
  ownerDisplayName: null,
  admins: 0,
  users: 0,
  rigs: 0,
  ninaInstances: 0,
  ninaLastSeenAt: null,
  lastLoginAt: null,
  storageBytes: null,
  storageFileCount: null,
  storageMeasuredAt: null,
  createdAt: '2026-09-24T10:00:00Z',
  ...over,
});

vi.mock('../../api/client', () => ({
  systemApi: {
    tenants: () =>
      Promise.resolve({
        tenants: [
          tenant({
            storageBytes: 12_400_000,
            storageFileCount: 7,
            storageMeasuredAt: '2026-09-25T03:00:00Z',
          }),
          tenant({ id: '00000000-0000-4000-8000-00000000000b', tenantKey: 'beta' }),
        ],
      }),
  },
}));

describe('S-80 Speicherbedarf', () => {
  it('zeigt Größe mit Anzahl und Stand (MESZ) bzw. „noch nicht gemessen“', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <SystemTenantsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const value = await screen.findByText('12,4 MB');
    expect(value).toHaveAttribute('title', '7 Dateien, gemessen 25.09.2026 05:00 MESZ');
    expect(screen.getByText('noch nicht gemessen')).toBeInTheDocument();
  });

  it('formatBytes: SI-Einheiten, eine Nachkommastelle unter 100', () => {
    expect(formatBytes(0, 'de')).toBe('0 B');
    expect(formatBytes(999, 'de')).toBe('999 B');
    expect(formatBytes(1500, 'de')).toBe('1,5 kB');
    expect(formatBytes(12_400_000, 'en')).toBe('12.4 MB');
    expect(formatBytes(250_000_000_000, 'de')).toBe('250 GB');
  });
});
