/**
 * `pnpm engine:bench` → `packages/engine/build/jint-bench.json` (AP-S2a, TK 10.4): Eingaben mit steigender Last
 * für die Messung von `planNight` unter Jint (`spikes/jint-runtime`) und dieselbe Messung in Node als Vergleich.
 * Last wie der Richtwert aus rules/engine.md Nr. 10 (30 Projekte × 3 Panels × 5 Zeilen) und darüber hinaus;
 * Standort Starfront (Texas, Rig des Betreibers), Nacht 2026-09-17, Mosaik-Panels als eigene Einheiten
 * (schwerster Fall), Flip, Dither und Neuplanung aktiv. Deterministisch, kein Zufall.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { ENGINE_VERSION, planNight, type PlanInput, type PlanProject } from '@nina-pm/engine';
import { BUILD_DIR } from './paths';

export const BENCH = `${BUILD_DIR}jint-bench.json`;

const CHICAGO = [
  { atUtc: '2025-11-02T07:00:00Z', utcOffsetMinutes: -360 },
  { atUtc: '2026-03-08T08:00:00Z', utcOffsetMinutes: -300 },
  { atUtc: '2026-11-01T07:00:00Z', utcOffsetMinutes: -360 },
];
const FILTERS = ['L', 'R', 'G', 'B', 'Ha', 'OIII', 'SII'];

const hex = (n: number) => n.toString(16).padStart(12, '0');

export function benchInput(
  projects: number,
  panels: number,
  lines: number,
  replan: boolean,
): PlanInput {
  let seq = 0;
  const id = () => `00000000-0000-4000-8000-${hex(++seq)}`;
  const list: PlanProject[] = Array.from({ length: projects }, (_, i) => {
    const raDeg = (i * 360) / projects;
    const decDeg = -10 + ((i * 7) % 70);
    return {
      id: id(),
      raDeg,
      decDeg,
      rotationDeg: (i * 15) % 180,
      priority: (i % 5) + 1,
      minAltitudeDeg: 30,
      minTimeOnTargetH: 1,
      twilight: 'astronomical',
      startDate: null,
      dueDate: null,
      transit: null,
      panels: Array.from({ length: panels }, (_, k) => ({
        id: id(),
        index: k,
        raDeg: (raDeg + k * 0.8) % 360,
        decDeg,
        rotationDeg: (i * 15) % 180,
        lines: Array.from({ length: lines }, (_, l) => {
          const filter = FILTERS[(i + l) % FILTERS.length] ?? 'L';
          return {
            id: id(),
            filter,
            ninaFilterName: `${filter} 36mm`,
            exposureS: [60, 120, 300][l % 3] ?? 300,
            planned: 40,
            accepted: (i * 3 + l) % 20,
            pending: 0,
            enabled: true,
            moonProfileId: null,
            gain: 100,
            offset: 20,
            binning: 1,
            readoutMode: null,
          };
        }),
      })),
    };
  });
  const first = list[0];
  return {
    mode: 'productive',
    night: '2026-09-17',
    site: { latitudeDeg: 31.5471, longitudeDeg: -99.3823, elevationM: 400 },
    tzdataVersion: '2026a',
    timeZoneTransitions: CHICAGO,
    rig: {
      id: '00000000-0000-4000-8000-ffffffffffff',
      hasRotator: true,
      defaultRotationDeg: null,
      rotationToleranceDeg: 5,
      hasFilterWheel: true,
    },
    scheduler: {
      strategy: 'proportional',
      sortChain: ['lowest_peak_altitude', 'setting_soonest', 'most_remaining', 'constrained'],
      bonusEnabled: true,
      overshootPct: 10,
      mosaicPanelsIndependent: true,
      ditherEnabled: true,
      ditherEvery: 3,
      filterSwitchEnabled: true,
      filterSwitchEvery: 10,
      filterSwitchTolerancePct: 50,
      flatsSource: 'panel',
      flip: { enabled: true, afterMin: 5, maxAfterMin: 15, pauseBeforeMin: 0, durationS: 240 },
      overhead: {
        slewCenterS: 90,
        filterChangeS: 10,
        ditherSettleS: 15,
        afEveryMin: 60,
        afDurationS: 120,
        downloadS: 3,
      },
    },
    moonProfiles: [],
    projects: list,
    startAtUtc: replan ? '2026-09-18T06:30:00Z' : null,
    tonight:
      replan && first
        ? {
            pastBlocks: [
              {
                unitId: `${first.id}/p0`,
                fromUtc: '2026-09-18T02:00:00Z',
                toUtc: '2026-09-18T04:00:00Z',
              },
            ],
            exposedSecByUnit: { [`${first.id}/p0`]: 3600 },
            lastAutofocusUtc: '2026-09-18T06:00:00Z',
            filterCycle: [],
            flipDoneByPanel: {},
            currentUnitId: null,
          }
        : null,
  };
}

/** Laststufen: Projekte × Panels × Zeilen, jeweils Erstplan; die Richtgröße zusätzlich als Neuplanung. */
export const CASES = [
  { name: 'klein', projects: 5, panels: 1, lines: 3, replan: false },
  { name: 'mittel', projects: 15, panels: 2, lines: 4, replan: false },
  { name: 'richtwert', projects: 30, panels: 3, lines: 5, replan: false },
  { name: 'richtwert-neuplanung', projects: 30, panels: 3, lines: 5, replan: true },
  { name: 'doppelt', projects: 60, panels: 3, lines: 5, replan: false },
  { name: 'gross', projects: 100, panels: 4, lines: 6, replan: false },
] as const;

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

const runs = Number(process.env.BENCH_RUNS ?? '5');
const cases = CASES.map((c) => {
  const input = benchInput(c.projects, c.panels, c.lines, c.replan);
  const times: number[] = [];
  let blocks = 0;
  let outputHash = '';
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    const plan = planNight(input);
    times.push(performance.now() - t0);
    blocks = plan.blocks.length;
    outputHash = plan.outputHash;
  }
  const inputJson = JSON.stringify(input);
  const units = c.projects * c.panels;
  console.log(
    `${c.name.padEnd(22)} ${String(c.projects).padStart(3)}×${String(c.panels)}×${String(c.lines)} ` +
      `(${String(units)} Einheiten, ${String(Math.round(inputJson.length / 1024))} KiB): Node ${median(times).toFixed(0)} ms, ${String(blocks)} Blöcke`,
  );
  return {
    ...c,
    units,
    inputKiB: Math.round(inputJson.length / 1024),
    nodeMs: Math.round(median(times)),
    blocks,
    outputHash,
    input,
  };
});

mkdirSync(BUILD_DIR, { recursive: true });
writeFileSync(BENCH, `${JSON.stringify({ engineVersion: ENGINE_VERSION, runs, cases })}\n`);
console.log(`✓ ${BENCH}`);
