// @vitest-environment jsdom
/**
 * „Heute Nacht“-Plan (Analyse 07.10.2026): Die laufende Nacht rechnet ab jetzt (`nowUtc`) wie Simulator und Plugin;
 * Ist und gespeicherter Plan stehen auch, wenn die Rechnung im Worker scheitert (nur `computeError`); der Rig-Schalter
 * *An NINA ausliefern* wird gemeldet.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { SimulationRequest } from './simulate';
import { useNightPlan } from './use-night-plan';

const RIG = '0190c3f4-0000-7000-8000-0000000000e1';
const SITE = '0190c3f4-0000-7000-8000-0000000000e2';
const P = '0190c3f4-0000-7000-8000-0000000000e3';
const B_DONE = '0190c3f4-0000-7000-8000-0000000000e4';
const B_OPEN = '0190c3f4-0000-7000-8000-0000000000e5';
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const now = Date.now();

const state = vi.hoisted(() => ({
  requests: [] as unknown[],
  fail: true,
}));

vi.mock('../equipment/shared', () => ({
  useEquipmentList: (kind: string) => ({
    data:
      kind === 'rigs'
        ? [{ id: RIG, siteId: SITE, ninaDeliveryEnabled: false }]
        : kind === 'sites'
          ? [
              {
                id: SITE,
                latitudeDeg: 31.5,
                longitudeDeg: -99.4,
                elevationM: 500,
                timeZone: 'America/Chicago',
              },
            ]
          : [],
  }),
}));

vi.mock('./use-simulator', () => ({
  useSimulator: () => (req: unknown) => {
    state.requests.push(req);
    return state.fail ? Promise.reject(new Error('Worker kaputt')) : Promise.resolve(null);
  },
}));

vi.mock('../../api/client', () => ({
  equipmentApi: {
    nights: () =>
      Promise.resolve({ currentNight: '2026-10-06', nights: [], timeZoneTransitions: [] }),
  },
  projectsApi: { list: () => Promise.resolve({ items: [] }), get: vi.fn() },
  simulationApi: {
    transits: () => Promise.resolve({ items: [] }),
    input: () =>
      Promise.resolve({
        night: '2026-10-06',
        currentNight: '2026-10-06',
        inputHash: 'sha256:abc',
        input: { projects: [{ id: P }] },
        projectNames: { [P]: 'IC 1795' },
        moonProfileNames: {},
        filterColors: {},
        executed: {
          night: '2026-10-06',
          sessions: 1,
          blocks: [
            {
              blockId: B_DONE,
              nightPlanId: null,
              projectId: P,
              panelId: null,
              title: 'IC 1795',
              kind: 'regular',
              startUtc: iso(now - 3 * 3_600_000),
              endUtc: iso(now - 3_600_000),
              endReason: 'completed',
              exposures: 12,
              running: false,
            },
          ],
          segments: [],
          events: [],
          gaps: [],
          counters: { saved: 12, skipped: 0, failed: 0 },
        },
        storedPlan: {
          nightPlanId: '0190c3f4-0000-7000-8000-0000000000e0',
          revision: 4,
          reason: 'refresh',
          createdAtUtc: iso(now - 4 * 3_600_000),
          stale: false,
          staleCause: null,
          blocks: [
            {
              id: B_OPEN,
              kind: 'regular',
              projectId: P,
              panelId: null,
              startUtc: iso(now + 10 * 60_000),
              endUtc: iso(now + 3_600_000),
              raDeg: 0,
              decDeg: 0,
              rotationDeg: 0,
              meridianFlip: null,
              entries: [],
            },
          ],
        },
        firstPlan: null,
        endedBlockIds: [],
      }),
  },
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('useNightPlan', () => {
  it('laufende Nacht: rechnet ab jetzt; Ist + gespeicherter Plan auch ohne Rechnung; Auslieferung aus', async () => {
    const { result } = renderHook(
      () =>
        useNightPlan(RIG, '2026-10-06', {
          current: true,
          window: { startUtc: iso(now - 5 * 3_600_000), endUtc: iso(now + 5 * 3_600_000) },
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.computeError).toBe(true));
    // P1: „jetzt“ geht an die Rechnung (vorher ganze Nacht ab Dämmerung).
    const req = state.requests.at(-1) as SimulationRequest;
    expect(Math.abs(Date.parse(req.nowUtc ?? '') - now)).toBeLessThan(120_000);
    // Rechnung gescheitert: Ist (blass) und gespeicherter Plan (kräftig) stehen trotzdem.
    expect(result.current.result).toBeNull();
    expect(result.current.actual?.blocks.map((b) => [b.tense, b.label])).toEqual([
      ['past', 'IC 1795'],
      ['planned', 'IC 1795'],
    ]);
    expect(result.current.rigNight?.projects.get(P)).toMatchObject({
      state: 'planned',
      exposures: 12,
    });
    expect(result.current.done?.map((d) => [d.name, d.state])).toEqual([['IC 1795', 'planned']]);
    expect(result.current.deliveryOff).toBe(true);
  });

  it('künftige Nacht: ganze Nacht, ohne Ist', async () => {
    state.requests.length = 0;
    const { result } = renderHook(
      () =>
        useNightPlan(RIG, '2026-10-06', {
          current: false,
          window: { startUtc: iso(now + 5 * 3_600_000), endUtc: iso(now + 15 * 3_600_000) },
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.computeError).toBe(true));
    expect((state.requests.at(-1) as SimulationRequest).nowUtc).toBeNull();
    expect(result.current.actual).toBeNull();
    expect(result.current.rigNight).toBeNull();
  });
});
