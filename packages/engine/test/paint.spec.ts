/**
 * Zuteilung `paint` (AP-13b, `specs/engine/allocation.md` §5–7, §11.3; `sort-chain.md` Pflicht-Tests):
 * Budgets (A-27), Sortierkette, Eigenschaften über Zufallsgrids in beiden Modi.
 */
import { describe, expect, it } from 'vitest';
import {
  applySortChain,
  budgetSlots,
  buildMatrix,
  moonDownChain,
  paintGrid,
  randomGrid,
  seededRandom,
  setupFromGrid,
  type GridInput,
  type GridUnit,
  type Row,
} from '../src';

const SLOT = 300;

function unit(id: string, over: Partial<GridUnit> = {}, planned = 20): GridUnit {
  return {
    unitId: id,
    projectId: id,
    priority: 1,
    minTimeOnTargetH: 1,
    dueDate: null,
    peakAltDeg: 60,
    canImage: [[0, 47]],
    meridianAtS: null,
    transit: null,
    panels: [
      {
        index: 0,
        lines: [
          {
            id: `${id}-L`,
            filter: 'L',
            exposureS: 300,
            planned,
            accepted: 0,
            enabled: true,
            moonProfile: null,
            safe: [],
          },
        ],
      },
    ],
    ...over,
  };
}

function grid(units: GridUnit[], over: Partial<GridInput> = {}): GridInput {
  return {
    mode: 'productive',
    slotS: 300,
    slots: 48,
    startAtS: null,
    moonAltDeg: new Array<number>(48).fill(-10),
    settings: {
      strategy: 'proportional',
      sortChain: ['lowest_peak_altitude', 'setting_soonest', 'most_remaining', 'constrained'],
      bonusEnabled: false,
      overshootPct: 0,
      mosaicPanelsIndependent: true,
      dither: { enabled: false, every: 3 },
      filterSwitch: { enabled: false, every: 10, tolerancePct: 50 },
      overhead: {
        slewCenterS: 0,
        filterChangeS: 0,
        ditherSettleS: 0,
        afEveryMin: 0,
        afDurationS: 0,
        downloadS: 0,
      },
      flip: { enabled: false, afterMin: 5, maxAfterMin: 15, pauseBeforeMin: 0, durationS: 240 },
    },
    moonProfiles: [],
    units,
    tonight: null,
    ...over,
  };
}

const rowsOf = (g: GridInput): Row[] => buildMatrix(setupFromGrid(g)).rows;

describe('budgetSlots (A-10, A-27)', () => {
  it('ohne Vergangenes: Bedarf ≤ Angebot → Bedarf in ganzen Slots', () => {
    expect(
      budgetSlots({
        demand: [3000, 1500],
        past: [0, 0],
        existingSlots: [0, 0],
        currentSlots: [0, 0],
        minChunk: [1800, 1500],
        supply: 6000,
      }),
    ).toEqual([10, 5]);
  });

  it('Gegenbeispiel ENG5-1: supply 600, Einheit 1 mit past 3000 → Σ ≤ Angebot', () => {
    const n = budgetSlots({
      demand: [3000, 3000],
      past: [3000, 0],
      existingSlots: [10, 0],
      currentSlots: [0, 0],
      minChunk: [600, 600],
      supply: 600,
    });
    expect((n[0] ?? 0) + (n[1] ?? 0)).toBeLessThanOrEqual(2);
    expect(n[1]).toBe(2);
  });

  it('Eigenschaft: Σ n·300 ≤ supply, n ≤ ⌈d/300⌉, nie negativ (2000 Zufallsfälle)', () => {
    const rnd = seededRandom(42);
    const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
    for (let k = 0; k < 2000; k++) {
      const units = int(1, 6);
      const demand = Array.from({ length: units }, () => int(0, 40) * 150 + int(0, 299));
      const past = Array.from({ length: units }, () => (rnd() < 0.3 ? int(1, 20) * SLOT : 0));
      const input = {
        demand,
        past,
        existingSlots: past.map((p) => p / SLOT + int(0, 3)),
        currentSlots: past.map(() => int(0, 3)),
        minChunk: demand.map(() => int(1, 8) * SLOT),
        supply: int(0, 60) * SLOT,
      };
      const n = budgetSlots(input);
      const total = n.reduce((a, b) => a + b, 0);
      expect(total * SLOT, JSON.stringify(input)).toBeLessThanOrEqual(input.supply);
      n.forEach((x, i) => {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(x)).toBe(true);
        expect(x).toBeLessThanOrEqual(Math.ceil((demand[i] ?? 0) / SLOT));
      });
    }
  });
});

describe('Sortierkette (sort-chain.md, Pflicht-Tests)', () => {
  it('1. Standardkette: Höhe ↑, Untergang ↑, Restarbeit ↓, knapp zuerst', () => {
    const rows = rowsOf(
      grid([
        unit('A', { peakAltDeg: 70 }),
        unit('B', { peakAltDeg: 40 }),
        unit('C', { peakAltDeg: 70, canImage: [[0, 30]] }),
      ]),
    );
    expect(
      applySortChain(rows, grid([]).settings.sortChain, true).map((r) => r.profile.unitId),
    ).toEqual(['B', 'C', 'A']);
  });

  it('2. Gleichstand in allen Schlüsseln → Matrix-Reihenfolge (produktiv Projekt-ID)', () => {
    const rows = rowsOf(grid([unit('Z'), unit('M'), unit('A')]));
    expect(rows.map((r) => r.profile.unitId)).toEqual(['A', 'M', 'Z']);
    expect(
      applySortChain(rows, ['lowest_peak_altitude'], true).map((r) => r.profile.unitId),
    ).toEqual(['A', 'M', 'Z']);
  });

  it('3. due_soonest: ohne Termin zuletzt', () => {
    const rows = rowsOf(
      grid([unit('A'), unit('B', { dueDate: '2026-12-01' }), unit('C', { dueDate: '2026-10-01' })]),
    );
    expect(applySortChain(rows, ['due_soonest'], true).map((r) => r.profile.unitId)).toEqual([
      'C',
      'B',
      'A',
    ]);
  });

  it('4. moonDownChain stellt most_moon_limited an den Anfang, ohne Duplikat', () => {
    expect(moonDownChain(['setting_soonest', 'most_moon_limited', 'constrained'])).toEqual([
      'most_moon_limited',
      'setting_soonest',
      'constrained',
    ]);
  });

  it('5. Knapp-Fall: Umordnen der Kette ändert, wer seine Mindestzeit erhält', () => {
    // 12 Slots, drei Einheiten mit je 1 h Mindestzeit (12 Slots) → nur eine bekommt ihren Block.
    const units = [
      unit('A', { canImage: [[0, 11]], peakAltDeg: 30 }, 40),
      unit('B', { canImage: [[0, 11]], peakAltDeg: 80 }, 60),
    ];
    const base = grid(units, { slots: 12, moonAltDeg: new Array<number>(12).fill(-10) });
    const byAltitude = paintGrid({
      ...base,
      settings: { ...base.settings, sortChain: ['lowest_peak_altitude'] },
    });
    const byWork = paintGrid({
      ...base,
      settings: { ...base.settings, sortChain: ['most_remaining'] },
    });
    expect(new Set(byAltitude.slotAssignment)).toEqual(new Set(['A']));
    expect(new Set(byWork.slotAssignment)).toEqual(new Set(['B']));
  });
});

describe('Eigenschaften (§11.3) über Zufallsgrids', () => {
  const grids = Array.from({ length: 300 }, (_, i) => [
    randomGrid(i + 1),
    randomGrid(i + 1, { mode: 'productive' }),
  ]).flat();

  it('jeder zugeteilte Slot: Einheit kann dort belichten oder der Slot ist gesperrt', () => {
    for (const g of grids) {
      const { matrix } = paintGrid(g);
      matrix.assignment.forEach((r, s) => {
        if (r < 0) return;
        const row = matrix.rows[r];
        expect(row?.profile.canImage[s] === true || matrix.locked[s], `slot ${String(s)}`).toBe(
          true,
        );
      });
    }
  });

  it('gesperrte Slots bleiben bei ihrer Transit-Einheit', () => {
    for (const g of grids) {
      const { matrix } = paintGrid(g);
      matrix.locked.forEach((l, s) => {
        if (!l) return;
        expect(matrix.rows[matrix.assignment[s] ?? -1]?.profile.transit).not.toBeNull();
      });
    }
  });

  it('deterministisch: gleiche Eingabe → gleiche Zuteilung', () => {
    for (const g of grids.slice(0, 100))
      expect(paintGrid(g).slotAssignment).toEqual(paintGrid(structuredClone(g)).slotAssignment);
  });

  it('Neuplanung mit leerem tonight und startAtS = Nachtbeginn ≡ Erstplan', () => {
    for (const g of grids.filter((x) => x.mode === 'productive').slice(0, 100)) {
      const replan = {
        ...g,
        startAtS: 0,
        tonight: {
          pastBlocks: [],
          exposedSecByUnit: {},
          lastAutofocusS: null,
          filterCycle: [],
          flipDoneByPanel: {},
          currentUnitId: null,
        },
      };
      expect(paintGrid(replan).slotAssignment).toEqual(paintGrid(g).slotAssignment);
    }
  });

  it('Kompatibilitätsmodus ohne Neuplanung: tonight wird ignoriert (A-10/A-11 aus)', () => {
    const g = randomGrid(9);
    const withTonight = {
      ...g,
      tonight: {
        pastBlocks: g.units[0] ? [{ unitId: g.units[0].unitId, fromS: 0, toS: 3600 }] : [],
        exposedSecByUnit: {},
        lastAutofocusS: null,
        filterCycle: [],
        flipDoneByPanel: {},
        currentUnitId: null,
      },
    };
    expect(paintGrid(withTonight).slotAssignment).toEqual(paintGrid(g).slotAssignment);
  });
});
