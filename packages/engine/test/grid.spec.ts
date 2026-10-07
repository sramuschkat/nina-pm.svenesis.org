/**
 * Grid-Format (AP-13a, contracts/golden-plans/README.md, allocation.md §11): Querbezüge, Masken,
 * Zufallsgrids (Seed-Determinismus) und die Schalterliste des Kompatibilitätsmodus.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checkGrid,
  compatSwitches,
  DEFAULT_SORT_CHAIN,
  DEVIATION_IDS,
  gridMasks,
  maskToRanges,
  panelUnitIndex,
  randomGrid,
  rangesToMask,
  SORT_CHAIN_KEYS,
  type GridInput,
  type GridUnit,
} from '../src';

const enums = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../docs/contracts/enums.json', import.meta.url)),
    'utf8',
  ),
) as { sortChainKeys: string[]; sortChainDefault: string[] };

const unit = (over: Partial<GridUnit> = {}): GridUnit => ({
  unitId: 'A',
  projectId: 'A',
  priority: 1,
  minTimeOnTargetH: 1,
  dueDate: null,
  peakAltDeg: 60,
  canImage: [[0, 9]],
  meridianAtS: null,
  transit: null,
  panels: [
    {
      index: 0,
      lines: [
        {
          id: 'A-Ha',
          filter: 'Ha',
          exposureS: 300,
          planned: 10,
          accepted: 0,
          enabled: true,
          moonProfile: 'strict',
          safe: [[2, 3]],
        },
        {
          id: 'A-R',
          filter: 'R',
          exposureS: 300,
          planned: 10,
          accepted: 0,
          enabled: true,
          moonProfile: 'nomoon',
          safe: [[0, 9]],
        },
        {
          id: 'A-L',
          filter: 'L',
          exposureS: 60,
          planned: 10,
          accepted: 0,
          enabled: true,
          moonProfile: null,
          safe: [],
        },
      ],
    },
  ],
  ...over,
});

const grid = (over: Partial<GridInput> = {}): GridInput => ({
  mode: 'compat',
  slotS: 300,
  slots: 10,
  startAtS: null,
  moonAltDeg: [-5, -1, 0, 3, 8, 12, 12, 8, 3, -2],
  settings: {
    strategy: 'proportional',
    sortChain: DEFAULT_SORT_CHAIN,
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
  moonProfiles: [
    { id: 'strict', distanceDeg: 90, maxIllumPct: 30, mustBeDown: false, widthDays: 8 },
    { id: 'nomoon', distanceDeg: 180, maxIllumPct: 0, mustBeDown: true },
  ],
  units: [unit()],
  tonight: null,
  ...over,
});

const codes = (g: GridInput) => checkGrid(g).map((i) => i.code);

describe('Sortierschlüssel', () => {
  it('entsprechen enums.json (sortChainKeys, sortChainDefault)', () => {
    expect([...SORT_CHAIN_KEYS]).toEqual(enums.sortChainKeys);
    expect([...DEFAULT_SORT_CHAIN]).toEqual(enums.sortChainDefault);
  });
});

describe('checkGrid', () => {
  it('gültiges Grid ohne Befund', () => {
    expect(checkGrid(grid())).toEqual([]);
  });

  it('Kompatibilitätsmodus lehnt due_soonest ab, Produktivmodus nicht', () => {
    const settings = { ...grid().settings, sortChain: ['due_soonest' as const] };
    expect(codes(grid({ settings }))).toEqual(['grid.unsupported_sort_key']);
    expect(codes(grid({ mode: 'productive', settings }))).toEqual([]);
  });

  it('Querbezüge: Profile, Zeilen, Bereiche, Mondwerte, Transit, Einheiten', () => {
    expect(codes(grid({ moonAltDeg: [1, 2] }))).toContain('grid.moon_length');
    expect(codes(grid({ units: [unit({ canImage: [[5, 10]] })] }))).toContain('grid.range');
    expect(codes(grid({ units: [unit(), unit()] }))).toEqual(
      expect.arrayContaining(['grid.duplicate_unit', 'grid.duplicate_line', 'grid.project_mixed']),
    );
    expect(codes(grid({ moonProfiles: [] }))).toContain('grid.unknown_profile');
    expect(
      codes(
        grid({ units: [unit({ transit: { windowS: [600, 300], lineId: 'A-L', lockedAtS: 0 } })] }),
      ),
    ).toContain('grid.transit');
    expect(codes(grid({ units: [unit({ unitId: 'B' })] }))).toContain('grid.unit_id');
  });

  it('Panel-Einheiten: eigenes Panel, mindestens zwei je Projekt, gleiche Projektwerte', () => {
    const base = unit();
    const p0 = base.panels[0];
    if (!p0) throw new Error('Panel fehlt');
    const panel = (index: number) => ({
      ...p0,
      index,
      lines: p0.lines.map((l) => ({ ...l, id: `${l.id}-${String(index)}` })),
    });
    const ok = [
      unit({ unitId: 'A/p0', panels: [panel(0)] }),
      unit({ unitId: 'A/p1', panels: [panel(1)] }),
    ];
    expect(checkGrid(grid({ units: ok }))).toEqual([]);
    expect(codes(grid({ units: [ok[0] as GridUnit] }))).toContain('grid.panels');
    expect(codes(grid({ units: [unit({ unitId: 'A/p1', panels: [panel(0)] })] }))).toContain(
      'grid.panels',
    );
    expect(
      codes(grid({ units: [ok[0] as GridUnit, { ...(ok[1] as GridUnit), priority: 3 }] })),
    ).toContain('grid.project_inconsistent');
    expect(panelUnitIndex('A/p12')).toBe(12);
    expect(panelUnitIndex('A')).toBeNull();
  });
});

describe('Masken', () => {
  it('Bereiche ↔ Masken', () => {
    expect(
      rangesToMask(
        [
          [1, 2],
          [5, 5],
        ],
        7,
      ),
    ).toEqual([false, true, true, false, false, true, false]);
    expect(maskToRanges([false, true, true, false, false, true, false])).toEqual([
      [1, 2],
      [5, 5],
    ]);
    expect(maskToRanges(rangesToMask([[0, 6]], 7))).toEqual([[0, 6]]);
  });

  it('Mond unten ⇔ Höhe ≤ 0°; „Kein Mond“ nur bei Mond unten; ohne Profil immer sicher', () => {
    const m = gridMasks(grid());
    expect(m.moonDown).toEqual([true, true, true, false, false, false, false, false, false, true]);
    const lines = m.units[0]?.panels[0]?.lines ?? [];
    const [ha, r, l] = lines;
    // strict: sicher bei Mond unten und in [2, 3]
    expect(ha?.safe).toEqual([true, true, true, true, false, false, false, false, false, true]);
    // mustBeDown ignoriert `safe`
    expect(r?.mustBeDown).toBe(true);
    expect(r?.safe).toEqual(m.moonDown);
    expect(l?.moonAvoid).toBe(false);
    expect(l?.safe.every(Boolean)).toBe(true);
  });

  it('Panel-Werte nur im Produktivmodus (A-19)', () => {
    const base = unit();
    const p0 = base.panels[0];
    if (!p0) throw new Error('Panel fehlt');
    const u = unit({ panels: [{ ...p0, canImage: [[4, 5]], peakAltDeg: 40 }] });
    const compat = gridMasks(grid({ units: [u] })).units[0]?.panels[0];
    const productive = gridMasks(grid({ mode: 'productive', units: [u] })).units[0]?.panels[0];
    expect(maskToRanges(compat?.canImage ?? [])).toEqual([[0, 9]]);
    expect(compat?.peakAltDeg).toBe(60);
    expect(maskToRanges(productive?.canImage ?? [])).toEqual([[4, 5]]);
    expect(productive?.peakAltDeg).toBe(40);
  });
});

describe('Zufallsgrids', () => {
  it('gleicher Seed → gleiches Grid; verschiedene Seeds → verschiedene Grids', () => {
    expect(randomGrid(7)).toEqual(randomGrid(7));
    expect(JSON.stringify(randomGrid(7))).not.toBe(JSON.stringify(randomGrid(8)));
  });

  it('500 Seeds je Modus sind gültig; Kompatibilitätsmodus ohne due_soonest', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const compat = randomGrid(seed);
      expect(checkGrid(compat), `compat ${String(seed)}`).toEqual([]);
      expect(compat.settings.sortChain).not.toContain('due_soonest');
      expect(
        checkGrid(randomGrid(seed, { mode: 'productive' })),
        `productive ${String(seed)}`,
      ).toEqual([]);
    }
  });

  it('decken die Pfade des Originals ab', () => {
    const grids = Array.from({ length: 500 }, (_, i) => randomGrid(i + 1));
    const some = (f: (g: GridInput) => boolean) => grids.some(f);
    expect(some((g) => g.settings.strategy === 'manual_priority')).toBe(true);
    expect(some((g) => g.units.some((u) => u.transit !== null))).toBe(true);
    expect(some((g) => g.units.some((u) => u.unitId.includes('/p')))).toBe(true);
    expect(some((g) => g.units.some((u) => !u.unitId.includes('/p') && u.panels.length > 1))).toBe(
      true,
    );
    expect(some((g) => g.moonProfiles.some((p) => p.mustBeDown))).toBe(true);
    expect(some((g) => g.moonAltDeg.some((a) => a === 0))).toBe(true);
    expect(some((g) => g.settings.bonusEnabled && g.settings.filterSwitch.enabled)).toBe(true);
    expect(some((g) => g.settings.overshootPct > 0)).toBe(true);
  });
});

describe('Kompatibilitätsschalter (allocation.md §11.1)', () => {
  it('produktiv alle an, compat alle aus; IDs eindeutig, A-8 und A-30 ohne Schalter', () => {
    const on = compatSwitches('productive');
    const off = compatSwitches('compat');
    expect(Object.values(on).every((v) => v)).toBe(true);
    expect(Object.values(off).every((v) => !v)).toBe(true);
    const ids = Object.values(DEVIATION_IDS);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('A-8');
    expect(ids).not.toContain('A-30');
    expect(ids).toHaveLength(33);
    expect(Object.keys(on).sort()).toEqual(Object.keys(DEVIATION_IDS).sort());
  });
});
