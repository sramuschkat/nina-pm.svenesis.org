// @vitest-environment jsdom
/**
 * AP-67: Rig-Zustand S-43 – Rechnungen (Zeitraum, Taupunktabstand, y-Achse, Linien mit Lücken, Hover-Index) und
 * Seite (Lade-, Leer-, Fehlerzustand, Zeitraumwahl, Kennzahlen mit Warnung beim Taupunktabstand, „zuletzt
 * empfangen“ und still); axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { Me, TelemetrySeries, TelemetryView } from '../../api/client';
import { ApiError, AuthProvider } from '../../auth';
import { TelemetryPage } from './TelemetryPage';
import {
  column,
  gapLimitMs,
  latestValue,
  linePath,
  maxPoint,
  nearestIndex,
  rangeWindow,
  smooth,
  smoothWindowMs,
  yDomain,
} from './telemetry-model';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = Date.parse('2026-10-08T06:10:00Z'); // 01:10 CDT

const state = vi.hoisted(() => ({
  me: null as unknown,
  view: null as unknown,
  error: null as unknown,
  get: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  api: { me: () => Promise.resolve(state.me) },
  equipmentApi: {
    list: (kind: string) =>
      Promise.resolve({
        items:
          kind === 'rigs'
            ? [
                {
                  id: ID(500),
                  name: 'SFRO-Rig',
                  siteId: ID(1),
                  telescopeId: ID(2),
                  cameraId: ID(3),
                  showInPlanning: true,
                  derived: { scaleArcsecPx: 2.03, fovWidthDeg: 3.5, fovHeightDeg: 2.3 },
                },
              ]
            : kind === 'sites'
              ? [{ id: ID(1), name: 'Starfront', timeZone: 'America/Chicago' }]
              : [],
      }),
  },
  telemetryApi: {
    get: (...a: unknown[]) => {
      state.get(...a);
      return state.error ? Promise.reject(state.error as Error) : Promise.resolve(state.view);
    },
  },
}));

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
  member: { id: ID(92), displayName: 'Uta', role: 'user', effectiveRole: 'user' },
  isSuperUser: false,
  mfaRequired: false,
  memberships: [{ tenantKey: 'demo', tenantName: 'Demo', role: 'user' }],
});

const series = (
  source: TelemetrySeries['source'],
  over: Partial<TelemetrySeries> = {},
): TelemetrySeries => ({
  source,
  resolution: 'raw',
  stepS: 0,
  t: [],
  series: {},
  latest: null,
  ...over,
});

const t1 = '2026-10-08T06:00:00Z';
const t2 = '2026-10-08T06:01:00Z';
const pcView = series('pc', {
  t: [t1, t2],
  series: {
    cpuMaxC: { avg: [57, 58.5], min: [57, 58.5], max: [57, 58.5] },
    loadPct: { avg: [40, 43], min: [40, 43], max: [40, 43] },
  },
  latest: { atUtc: t2, values: { cpuMaxC: 58.5, loadPct: 43, diskC: 35 } },
});
const boxView = series('power_box', {
  t: [t1, t2],
  series: {
    airC: { avg: [18.4, 18.2], min: [18.4, 18.2], max: [18.4, 18.2] },
    dewPointC: { avg: [13.4, 15.6], min: [13.4, 15.6], max: [13.4, 15.6] },
  },
  latest: { atUtc: t2, values: { airC: 18.2, dewPointC: 15.6, humidityPct: 74 } },
});
const view = (sources: TelemetrySeries[]): TelemetryView => ({
  rigId: ID(500),
  from: '2026-10-07T06:10:00Z',
  to: '2026-10-08T06:10:00Z',
  sources,
});

const renderAt = (path: string) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes>
            <Route path="/rig-zustand" element={<TelemetryPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  state.me = me();
  state.view = view([pcView, boxView]);
  state.error = null;
  state.get.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('telemetry-model', () => {
  it('Zeitraum bis zur nächsten vollen Minute', () => {
    expect(rangeWindow('24h', Date.parse('2026-10-08T06:09:30Z'))).toEqual({
      from: '2026-10-07T06:10:00Z',
      to: '2026-10-08T06:10:00Z',
    });
  });

  it('Taupunktabstand aus Luft und Taupunkt, fehlende Werte bleiben null', () => {
    const s = series('power_box', {
      t: [t1, t2],
      series: {
        airC: { avg: [18, null], min: [18, null], max: [18, null] },
        dewPointC: { avg: [13.5, 14], min: [13.5, 14], max: [13.5, 14] },
      },
      latest: { atUtc: t2, values: { airC: 18.2, dewPointC: 15.6 } },
    });
    expect(column(s, 'dewGapK')).toEqual([4.5, null]);
    expect(latestValue(s, 'dewGapK')).toBe(2.6);
    expect(latestValue(s, 'humidityPct')).toBeNull();
  });

  it('y-Achse mit Luft, feste Grenzen und Bezugslinie gewinnen', () => {
    expect(yDomain([40, 43], { yMin: 0, yMax: 100 })).toEqual([0, 100]);
    expect(yDomain([5, 6], { yMin: 0, reference: 3 })).toEqual([0, 6.5]);
    const [lo, hi] = yDomain([20, 30], {});
    expect(lo).toBe(19);
    expect(hi).toBe(31);
  });

  it('feste Achsgrenzen erweitern sich nur, wenn Werte darüber liegen', () => {
    expect(yDomain([50, 70], { yMin: 20, yMax: 100 })).toEqual([20, 100]);
    expect(yDomain([50, 104], { yMin: 20, yMax: 100 })).toEqual([20, 104]);
  });

  it('gleitendes Mittel über das Fenster, nicht über Lücken; Höchstwert', () => {
    const t = [0, 30_000, 60_000, 90_000, 120_000, 1_000_000];
    const v = [50, 60, 50, 60, null, 80];
    // Fenster 60 s → je Nachbar links und rechts
    expect(smooth(t, v, 60_000, 120_000)).toEqual([55, 53.33, 56.67, 55, null, 80]);
    expect(smoothWindowMs(12 * 3_600_000)).toBe(300_000);
    expect(smoothWindowMs(24 * 3_600_000)).toBe(432_000);
    expect(maxPoint(v)).toEqual({ i: 5, v: 80 });
    expect(maxPoint([null, null])).toBeNull();
  });

  it('Linie bricht bei null und bei Lücken über dem Grenzwert', () => {
    const x = (ms: number) => ms / 1000;
    const y = (v: number) => v;
    expect(linePath([0, 1000, 2000, 10_000], [1, null, 2, 3], x, y, 3000)).toBe(
      'M0.0,1.00M2.0,2.00M10.0,3.00',
    );
    expect(gapLimitMs([0, 60_000, 120_000], 0)).toBe(180_000);
    expect(gapLimitMs([], 3600)).toBe(10_800_000);
    expect(nearestIndex([0, 100, 200], 140)).toBe(1);
    expect(nearestIndex([0, 100, 200], 160)).toBe(2);
  });
});

describe('S-43 Rig-Zustand', () => {
  it('zeigt Kennzahlen je Quelle, Warnung beim Taupunktabstand und die Diagramme', async () => {
    const { container } = renderAt('/rig-zustand');
    expect(await screen.findByRole('heading', { name: 'Rig-Zustand', level: 1 })).toBeTruthy();
    expect(await screen.findByText('Mini-PC', { selector: 'h2' })).toBeTruthy();
    expect(state.get).toHaveBeenCalledWith(ID(500), '2026-10-07T06:10:00Z', '2026-10-08T06:10:00Z');
    // Taupunktabstand 18,2 − 15,6 = 2,6 K < 3 K → Warnung
    expect(screen.getByText('2,6 K')).toBeTruthy();
    expect(screen.getAllByText(/zuletzt 01:01 CDT \(vor 9 min\)/)).toHaveLength(2);
    expect(screen.getByRole('img', { name: /Temperaturen: CPU max/ })).toBeTruthy();
    expect(screen.getAllByText('Keine Werte im Zeitraum.').length).toBeGreaterThan(0);
    await expectNoSeriousA11y(container);
  });

  it('Zeitraum wählen lädt neu und steht in der Adresse', async () => {
    renderAt('/rig-zustand');
    await screen.findByText('Mini-PC', { selector: 'h2' });
    fireEvent.click(screen.getByRole('button', { name: '7 Tage' }));
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        ID(500),
        '2026-10-01T06:10:00Z',
        '2026-10-08T06:10:00Z',
      ),
    );
    expect(screen.getByRole('button', { name: '7 Tage' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('still seit mehr als 15 min wird hervorgehoben', async () => {
    state.view = view([
      series('pc', { latest: { atUtc: '2026-10-08T05:30:00Z', values: { cpuMaxC: 50 } } }),
      series('power_box'),
    ]);
    renderAt('/rig-zustand');
    expect(await screen.findByText(/still seit 00:30 CDT \(vor 40 min\)/)).toBeTruthy();
    expect(screen.getByText('noch nie empfangen')).toBeTruthy();
  });

  it('ohne jede Telemetrie: Leerzustand mit Hinweis auf die Einrichtung', async () => {
    state.view = view([series('pc'), series('power_box')]);
    renderAt('/rig-zustand');
    expect(await screen.findByText('Noch keine Telemetrie')).toBeTruthy();
  });

  it('Fehler der API: Problemanzeige mit Wiederholen', async () => {
    state.error = new ApiError({
      title: 'Fehler',
      status: 500,
      code: 'internal.error',
    });
    renderAt('/rig-zustand');
    expect(await screen.findByRole('button', { name: 'Erneut versuchen' })).toBeTruthy();
  });
});
