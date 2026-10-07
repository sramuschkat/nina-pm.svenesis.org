/**
 * Analyse 07.10.2026 (Entscheidungen Sven): Fortsetzung ohne Mindestzeit (A-32), Flip-Fixkosten nur vor dem
 * Meridian (A-16) und Transit-Zeile „nur heute aus“ (A-21). `specs/engine/allocation.md` §2, §3, §4, §5.4, §10.
 */
import { describe, expect, it } from 'vitest';
import {
  buildMatrix,
  planGrid,
  setupFromGrid,
  type GridInput,
  type GridLine,
  type GridSettings,
  type GridTonight,
  type GridUnit,
  type PlanGridResult,
  type SlotRange,
} from '../src';

const SETTINGS: GridSettings = {
  strategy: 'proportional',
  sortChain: ['lowest_peak_altitude', 'setting_soonest', 'most_remaining', 'constrained'],
  bonusEnabled: false,
  overshootPct: 0,
  mosaicPanelsIndependent: true,
  dither: { enabled: false, every: 3 },
  filterSwitch: { enabled: false, every: 10, tolerancePct: 50 },
  overhead: {
    slewCenterS: 60,
    filterChangeS: 0,
    ditherSettleS: 0,
    afEveryMin: 0,
    afDurationS: 0,
    downloadS: 5,
  },
  flip: { enabled: false, afterMin: 5, maxAfterMin: 15, pauseBeforeMin: 0, durationS: 240 },
};

function line(id: string, exposureS: number, planned: number, accepted = 0): GridLine {
  return {
    id,
    filter: id.split('-')[1] ?? 'L',
    exposureS,
    planned,
    accepted,
    enabled: true,
    moonProfile: null,
    safe: [],
  };
}

function unit(id: string, canImage: SlotRange[], lines: GridLine[], over: Partial<GridUnit> = {}) {
  const u: GridUnit = {
    unitId: id,
    projectId: id,
    priority: 1,
    minTimeOnTargetH: 0.5,
    dueDate: null,
    peakAltDeg: 60,
    canImage,
    meridianAtS: null,
    transit: null,
    panels: [{ index: 0, lines }],
    ...over,
  };
  return u;
}

function tonight(over: Partial<GridTonight> = {}): GridTonight {
  return {
    pastBlocks: [],
    exposedSecByUnit: {},
    lastAutofocusS: null,
    filterCycle: [],
    flipDoneByPanel: {},
    currentUnitId: null,
    ...over,
  };
}

function grid(units: GridUnit[], over: Partial<GridInput> = {}): GridInput {
  return {
    mode: 'productive',
    slotS: 300,
    slots: 144,
    startAtS: null,
    moonAltDeg: new Array<number>(144).fill(-10),
    settings: SETTINGS,
    moonProfiles: [],
    units,
    tonight: null,
    ...over,
  };
}

const exposes = (r: PlanGridResult, unitId: string) =>
  r.blocks
    .filter((b) => b.unitId === unitId)
    .flatMap((b) => b.entries)
    .filter((e) => e.cmd === 'expose');

/**
 * Rig-Nacht 06./07.10.2026: Neuplanung um 06:04 Ortszeit, noch ~16 min Dunkelheit; das Rig arbeitet an IC 1795
 * (SII 600 s, 5 Aufnahmen offen), Mindestzeit 30 min. Nachtfenster hier 12 h ab Slot 0; IC 1795 ist bis Slot 120
 * (Ende 36 300 s) nutzbar, `startAtS` liegt 16 min davor.
 */
describe('Fortsetzung ohne Mindestzeit (A-32, Entscheidung Sven 07.10.2026)', () => {
  const darkEnd = 121 * 300;
  const startAtS = darkEnd - 16 * 60;
  const ic = unit('IC1795', [[40, 120]], [line('IC1795-SII', 600, 20, 15)]);
  const replan = (t: GridTonight, strategy: GridSettings['strategy'] = 'proportional') =>
    grid([ic], {
      startAtS,
      darknessEndS: darkEnd,
      settings: { ...SETTINGS, strategy },
      tonight: t,
    });
  const current = tonight({
    pastBlocks: [{ unitId: 'IC1795', fromS: 30000, toS: startAtS }],
    exposedSecByUnit: { IC1795: 5400 },
    currentUnitId: 'IC1795',
  });

  it.each(['proportional', 'manual_priority'] as const)(
    '%s: laufende Einheit belichtet weiter, was bis zur Dämmerung passt',
    (strategy) => {
      const r = planGrid(replan(current, strategy));
      expect(r.prefiltered).not.toContain('IC1795');
      const ex = exposes(r, 'IC1795');
      expect(ex.length).toBeGreaterThanOrEqual(1);
      // Kein Slew bei Fortsetzung (A-34, Engine 0.18.0): SII 600 s + 5 s Download ab startAtS bis vor das Ende der
      // Dunkelheit (vorher Slew 60 s ab startAtS).
      expect(ex[0]?.atS).toBe(startAtS);
      for (const e of ex) expect(e.atS + 605).toBeLessThanOrEqual(darkEnd);
      expect(r.diagnostics.filter((d) => d.unitId === 'IC1795' && !('lineId' in d))).toEqual([]);
    },
  );

  it('MinChunk der fortgesetzten Einheit = nutzbarer Lauf ab startAtS (4 Slots)', () => {
    const row = buildMatrix(setupFromGrid(replan(current))).rows[0];
    expect(row?.continued).toBe(true);
    expect(row?.minChunkSec).toBe(4 * 300);
  });

  it('ohne currentUnitId gilt die Mindestzeit weiter (vorgefiltert)', () => {
    const r = planGrid(replan({ ...current, currentUnitId: null }));
    expect(r.prefiltered).toContain('IC1795');
    expect(exposes(r, 'IC1795')).toEqual([]);
  });

  it('letzter Block der Einheit liegt mehr als 5 min zurück → keine Fortsetzung', () => {
    const r = planGrid(
      replan({
        ...current,
        pastBlocks: [{ unitId: 'IC1795', fromS: 30000, toS: startAtS - 301 }],
      }),
    );
    expect(r.prefiltered).toContain('IC1795');
  });

  it('Ziel im Slot von startAtS nicht mehr nutzbar → keine Ausnahme', () => {
    const late = grid([unit('IC1795', [[40, 110]], [line('IC1795-SII', 600, 20, 15)])], {
      startAtS,
      darknessEndS: darkEnd,
      tonight: current,
    });
    const row = buildMatrix(setupFromGrid(late)).rows[0];
    expect(row?.continued).toBe(false);
    expect(exposes(planGrid(late), 'IC1795')).toEqual([]);
  });

  it('nur die fortgesetzte Einheit: eine zweite Einheit in derselben Lage bleibt vorgefiltert', () => {
    const other = unit('NGC7000', [[40, 120]], [line('NGC7000-Ha', 600, 20, 15)]);
    const r = planGrid(grid([ic, other], { startAtS, darknessEndS: darkEnd, tonight: current }));
    expect(r.prefiltered).toContain('NGC7000');
    expect(exposes(r, 'IC1795').length).toBeGreaterThanOrEqual(1);
  });

  it('Kompatibilitätsmodus ignoriert die Fortsetzung (tonight wird ignoriert, A-11)', () => {
    const setup = setupFromGrid({ ...replan(current), mode: 'compat' });
    expect(setup.continuedUnitId).toBeNull();
  });
});

describe('Flip-Fixkosten nur vor dem Meridian (A-16, Entscheidung Sven 07.10.2026)', () => {
  const flip = { ...SETTINGS.flip, enabled: true };
  const fixOf = (g: GridInput) => setupFromGrid(g).profiles[0]?.fixSec;
  const base = (meridianAtS: number | null, over: Partial<GridInput> = {}) =>
    grid([unit('A', [[20, 100]], [line('A-L', 300, 40)], { meridianAtS })], {
      settings: { ...SETTINGS, flip },
      ...over,
    });

  it('Meridian in der nutzbaren Zeit → slew + flip', () => {
    expect(fixOf(base(60 * 300))).toBe(60 + 240);
  });

  it('Meridian vor dem nutzbaren Lauf (z. B. in der Dämmerung) → nur slew', () => {
    expect(fixOf(base(10 * 300))).toBe(60);
  });

  it('Meridian nach dem nutzbaren Lauf → nur slew', () => {
    expect(fixOf(base(110 * 300))).toBe(60);
  });

  it('Neuplanung nach dem Meridian → nur slew', () => {
    expect(fixOf(base(60 * 300, { startAtS: 70 * 300, tonight: tonight() }))).toBe(60);
  });

  it('Neuplanung vor dem Meridian → slew + flip', () => {
    expect(fixOf(base(60 * 300, { startAtS: 50 * 300, tonight: tonight() }))).toBe(300);
  });

  it('Flip laut flipDoneByPanel erledigt → nur slew', () => {
    expect(
      fixOf(
        base(60 * 300, { startAtS: 50 * 300, tonight: tonight({ flipDoneByPanel: { A: true } }) }),
      ),
    ).toBe(60);
  });

  it('Restposten: MinChunk ohne Flip, wenn der Meridian schon vorbei ist', () => {
    // 2 × 300 s Rest + 2 × 5 s Download; Meridian vor dem Planstart → MinChunk = work + slew.
    const g = grid([unit('A', [[20, 100]], [line('A-L', 300, 2)], { meridianAtS: 30 * 300 })], {
      settings: { ...SETTINGS, flip },
      startAtS: 40 * 300,
      tonight: tonight(),
    });
    expect(buildMatrix(setupFromGrid(g)).rows[0]?.minChunkSec).toBe(2 * 305 + 60);
  });
});

describe('Transit-Zeile „nur heute aus“ (A-21, FA-FOL-05)', () => {
  const transitUnit = (enabled: boolean) =>
    unit('X', [[0, 40]], [{ ...line('X-V', 60, 100), enabled }], {
      transit: { windowS: [3000, 9000], lineId: 'X-V', lockedAtS: 0 },
    });

  it('aktive Transit-Zeile: Serie bis Fensterende', () => {
    const r = planGrid(grid([transitUnit(true)]));
    expect(r.blocks.some((b) => b.entries.some((e) => e.cmd === 'expose_series'))).toBe(true);
  });

  it('Zeile nur für diese Nacht abgeschaltet (enabled: false): keine Transit-Einheit, Diagnose no_need', () => {
    const r = planGrid(grid([transitUnit(false)]));
    expect(r.blocks).toEqual([]);
    expect(r.slotAssignment.every((x) => x === null)).toBe(true);
    expect(r.diagnostics).toContainEqual({ unitId: 'X', reason: 'no_need' });
  });

  it('abgeschaltete Transit-Zeile gibt die Slots für andere Ziele frei', () => {
    const a = unit('A', [[0, 40]], [line('A-L', 300, 40)]);
    const r = planGrid(grid([transitUnit(false), a]));
    expect(r.slotAssignment.slice(10, 30).every((x) => x === 'A')).toBe(true);
  });
});
