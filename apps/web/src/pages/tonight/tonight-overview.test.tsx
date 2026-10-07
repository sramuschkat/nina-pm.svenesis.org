// @vitest-environment jsdom
/**
 * Kopf von „Heute Nacht“ (Analyse 07.10.2026): Laufende Nacht mit gespeichertem Plan → Kennzahl „Plan“ aus dessen Rest
 * plus Ist (eine Quelle mit Simulator und Tabelle); Ist und gespeicherter Plan in der Zeitleiste auch ohne Rechnung,
 * mit Hinweis nur für die Rechnung; bei abgeschalteter Auslieferung keine Frames „als ob NINA sie bekäme“.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../../../test/setup';
import type { TonightRig } from '../../api/client';
import type { NightPlanState } from '../simulator/use-night-plan';
import type { NightSky } from './night-sky';
import { KpiTiles, TonightTimeline } from './TonightOverview';

const rig = {
  rigId: '0190c3f4-0000-7000-8000-0000000000f1',
  rigName: 'Rig A',
  siteId: '0190c3f4-0000-7000-8000-0000000000f2',
  siteName: 'Starfront',
  siteTimeZone: 'America/Chicago',
  weatherSafetyUrl: null,
  night: '2026-09-18',
  currentNight: '2026-09-18',
  calendar: [],
  nightWindow: { startUtc: '2026-09-19T00:00:00Z', endUtc: '2026-09-19T13:00:00Z' },
  dark: { fromUtc: '2026-09-19T01:10:00Z', toUtc: '2026-09-19T10:40:00Z' },
  darkHours: 9.5,
  moon: { illumPct: 48, events: [] },
  weather: null,
  forecast: { computedAt: null, covered: true },
  projects: [],
  idleProjects: 0,
  instances: [],
} as unknown as TonightRig;

const sky: NightSky = {
  geo: { latDeg: 31.5, lonDeg: -99.4 },
  window: {
    from: Date.parse('2026-09-19T00:00:00Z') / 1000,
    to: Date.parse('2026-09-19T13:00:00Z') / 1000,
  },
  bodies: [],
  showers: [],
  moonIllumPct: 48,
  galactic: null,
  season: null,
  eclipses: [],
  passes: null,
  satellitesGenerated: null,
};

const at = (iso: string) => Date.parse(iso) / 1000;

const plan = (over: Partial<NightPlanState> = {}): NightPlanState => ({
  result: null,
  projects: [],
  isPending: false,
  isError: true,
  refetch: () => undefined,
  computeError: true,
  actual: {
    blocks: [
      {
        id: 'ist',
        fromUtc: at('2026-09-19T02:00:00Z'),
        toUtc: at('2026-09-19T04:00:00Z'),
        label: 'IC 1795',
        kind: 'regular',
        color: 'var(--npm-chart-series-1)',
        tense: 'past',
      },
      {
        id: 'plan',
        fromUtc: at('2026-09-19T05:00:00Z'),
        toUtc: at('2026-09-19T07:00:00Z'),
        label: 'NGC 281',
        kind: 'regular',
        color: 'var(--npm-chart-series-2)',
        tense: 'planned',
      },
    ],
    filterBars: [],
    gaps: [],
    outline: [],
    protocol: [],
    counters: { saved: 12, skipped: 0, failed: 0 },
    fromStored: true,
  },
  rigNight: {
    blocks: [],
    projects: new Map(),
    flips: ['2026-09-19T06:00:00Z'],
    frames: 24,
    targets: 2,
    saved: 12,
  },
  ...over,
});

describe('Heute Nacht – Kennzahlen und Zeitleiste', () => {
  it('Kennzahl „Plan“ aus gespeichertem Plan + Ist, auch wenn die Rechnung scheitert', () => {
    render(<KpiTiles rig={rig} sky={sky} plan={plan()} />);
    expect(screen.getByText('2 Projekte')).toBeInTheDocument();
    expect(screen.getByText(/24 Frames · 12 belichtet/)).toBeInTheDocument();
  });

  it('Auslieferung aus: Frames nur „wenn ausgeliefert“', () => {
    render(<KpiTiles rig={rig} sky={sky} plan={plan({ deliveryOff: true })} />);
    expect(screen.getByText(/24 Frames, wenn ausgeliefert/)).toBeInTheDocument();
  });

  it('Zeitleiste zeigt Ist und gespeicherten Plan ohne Rechnung; Hinweis nur für die Rechnung', () => {
    render(
      <TonightTimeline rig={rig} sky={sky} plan={plan()} nowUtc={at('2026-09-19T04:30:00Z')} />,
    );
    expect(screen.getAllByText(/NGC 281/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/IC 1795/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Plan konnte nicht gerechnet werden')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/Rechnung ab jetzt ist fehlgeschlagen/);
  });
});
