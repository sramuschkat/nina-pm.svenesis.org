// @vitest-environment jsdom
/**
 * Reiter „Qualität“ des Projekts (AP-77, S-31): Matrix Nacht × Filter mit Anteil, Grund und Summen, Stufen als Text und
 * Hinterlegung, Nacht als Link; Verlauf über die Nächte umschaltbar; Dateiliste zum Stacken; leer; axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { ProjectQualityView, QualityStats } from '../../api/client';
import { ProjectQualityTab, shareTier, trendValue } from './ProjectQualityTab';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const state = vi.hoisted(() => ({ view: null as unknown }));

vi.mock('../../api/client', () => ({
  equipmentApi: {
    list: () =>
      Promise.resolve({
        items: [
          { id: '1', shortName: 'L', colorHex: '#9e9e9e' },
          { id: '2', shortName: 'R', colorHex: '#c62828' },
        ],
      }),
  },
  sessionsApi: {
    projectQuality: () => Promise.resolve(state.view),
    projectQualityFilesUrl: (id: string, good: boolean) =>
      `/api/web/v1/projects/${id}/quality/files?good=${String(good)}`,
  },
}));

const none = { hfr: 0, stars: 0, rms: 0, cloud: 0 };
const stats = (o: Partial<QualityStats> = {}): QualityStats => ({
  good: 40,
  flagged: 0,
  rejected: 0,
  none: 0,
  sharePct: 100,
  reasons: none,
  hfr: { median: 1.5, min: 1.45, max: 1.6 },
  stars: { median: 1600, min: 1500, max: 1700 },
  rmsArcsec: { median: 0.6, min: 0.4, max: 0.8 },
  ...o,
});

const view = (): ProjectQualityView => ({
  projectId: ID(10),
  rigId: ID(1),
  settings: { hfrPct: 30, starsPct: 50, rmsArcsec: 1.5, cloudPct: 50 },
  minRef: 10,
  filters: [
    { filter: 'L', ...stats({ good: 77 }) },
    {
      filter: 'R',
      ...stats({ good: 52, flagged: 3, sharePct: 94.5, reasons: { ...none, stars: 3 } }),
    },
  ],
  nights: [
    {
      night: '2026-10-09',
      sessionIds: [ID(21)],
      filters: [
        { filter: 'L', ...stats({ good: 37 }) },
        { filter: 'R', ...stats({ good: 20 }) },
      ],
      total: stats({ good: 57 }),
    },
    {
      night: '2026-10-08',
      sessionIds: [ID(20)],
      filters: [
        {
          filter: 'R',
          ...stats({ good: 32, flagged: 3, sharePct: 91.4, reasons: { ...none, stars: 3 } }),
        },
      ],
      total: stats({ good: 72, flagged: 3, sharePct: 96, reasons: { ...none, stars: 3 } }),
    },
  ],
  sessions: [],
  total: stats({ good: 129, flagged: 3, sharePct: 97.7, reasons: { ...none, stars: 3 } }),
  truncated: false,
});

const wrap = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <ProjectQualityTab projectId={ID(10)} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  state.view = view();
});

describe('Projekt-Reiter „Qualität“ (AP-77)', () => {
  it('Matrix Nacht × Filter mit Anteil, Grund und Summen; Nacht als Link; Dateiliste; axe', async () => {
    wrap();
    const matrix = await screen.findByRole('table', {
      name: 'Anteil guter Lights je Nacht und Filter',
    });
    const rows = within(matrix).getAllByRole('row');
    // Kopf, zwei Nächte (neueste oben), Summe.
    expect(rows).toHaveLength(4);
    const older = rows[2] as HTMLElement;
    expect(within(older).getByRole('link', { name: 'Do 08./09.10.' })).toHaveAttribute(
      'href',
      `/auswertung/naechte/${ID(20)}?nacht=1`,
    );
    // Ohne L in dieser Nacht: leere Zelle; R mit Grund.
    expect(within(older).getByText('91 %').closest('td')?.getAttribute('data-tier')).toBe('fair');
    expect(within(older).getByText('35 · 3 Sterne')).toBeTruthy();
    const total = rows[3] as HTMLElement;
    expect(within(total).getByText('gesamt')).toBeTruthy();
    expect(within(total).getByText('97 %')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Alle Lights (CSV, 132)' })).toHaveAttribute(
      'href',
      `/api/web/v1/projects/${ID(10)}/quality/files?good=false`,
    );
    expect(screen.getByRole('link', { name: 'Nur gute Lights (CSV, 129)' })).toHaveAttribute(
      'href',
      `/api/web/v1/projects/${ID(10)}/quality/files?good=true`,
    );
    await expectNoSeriousA11y();
  });

  it('Verlauf: Kennzahl umschaltbar, Beschriftung mit den letzten Werten', async () => {
    wrap();
    expect(
      await screen.findByRole('img', { name: 'HFR je Nacht und Filter, zuletzt: L 1,50, R 1,50' }),
    ).toBeTruthy();
    const metric = screen.getByRole('group', { name: 'Kennzahl' });
    fireEvent.click(within(metric).getByRole('button', { name: '% gut' }));
    expect(within(metric).getByRole('button', { name: '% gut' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.getByRole('img', { name: '% gut je Nacht und Filter, zuletzt: L 100, R 100' }),
    ).toBeTruthy();
  });

  it('ohne bewertete Lights ein Hinweis', async () => {
    state.view = { ...view(), nights: [], filters: [] };
    wrap();
    expect(await screen.findByText('Noch keine bewerteten Lights in diesem Projekt.')).toBeTruthy();
  });

  it('Stufen und Werte des Verlaufs', () => {
    expect([100, 99.4, 98.9, 95, 94.9, 85, 84.9, null].map(shareTier)).toEqual([
      'top',
      'top',
      'good',
      'good',
      'fair',
      'fair',
      'poor',
      'none',
    ]);
    expect(trendValue(stats(), 'rms')).toBe(0.6);
    expect(trendValue(stats({ hfr: null }), 'hfr')).toBeNull();
    expect(trendValue(stats({ sharePct: 91.4 }), 'share')).toBe(91.4);
  });
});
