/**
 * Regressionen Mosaik je Panel und Neuplanung im Transit (allocation.md §3 Nr. 1/4, §8, §9, A-19, A-20,
 * A-29; transit.md §3). Seit den Masken je Panel (28.09.2026) ist `CanImage` einer Einheit ohne
 * Panel-Einheiten das ODER über ihre Panels; Zuteilung und Ablauf müssen je Panel prüfen.
 */
import { describe, expect, it } from 'vitest';
import {
  planGrid,
  randomGrid,
  type GridInput,
  type GridLine,
  type GridPanel,
  type GridSettings,
  type GridUnit,
  type PlanGridResult,
  type SlotRange,
} from '../src';

const SETTINGS: GridSettings = {
  strategy: 'proportional',
  sortChain: ['lowest_peak_altitude', 'setting_soonest', 'most_remaining', 'constrained'],
  bonusEnabled: false,
  overshootPct: 0,
  mosaicPanelsIndependent: false,
  dither: { enabled: false, every: 3 },
  filterSwitch: { enabled: false, every: 3, tolerancePct: 100 },
  overhead: {
    slewCenterS: 0,
    filterChangeS: 0,
    ditherSettleS: 0,
    afEveryMin: 0,
    afDurationS: 0,
    downloadS: 0,
  },
  flip: { enabled: false, afterMin: 5, maxAfterMin: 15, pauseBeforeMin: 0, durationS: 240 },
};

function grid(over: Partial<GridInput> & { readonly slots: number }): GridInput {
  return {
    mode: 'productive',
    slotS: 300,
    startAtS: null,
    moonAltDeg: new Array<number>(over.slots).fill(-10),
    settings: SETTINGS,
    moonProfiles: [],
    units: [],
    tonight: null,
    ...over,
  };
}

function line(
  id: string,
  exposureS: number,
  planned: number,
  extra: { filter?: string; moonProfile?: string; safe?: SlotRange[] } = {},
): GridLine {
  return {
    id,
    filter: extra.filter ?? 'L',
    exposureS,
    planned,
    accepted: 0,
    enabled: true,
    moonProfile: extra.moonProfile ?? null,
    safe: extra.safe ?? [],
  };
}

function unit(
  id: string,
  canImage: SlotRange[],
  panels: GridPanel[],
  extra: Partial<GridUnit> = {},
): GridUnit {
  return {
    unitId: id,
    projectId: id,
    priority: 1,
    minTimeOnTargetH: 1,
    dueDate: null,
    peakAltDeg: 60,
    canImage,
    meridianAtS: null,
    transit: null,
    panels,
    ...extra,
  };
}

const exposures = (r: PlanGridResult) =>
  r.blocks.flatMap((b) =>
    b.entries.flatMap((e) => (e.cmd === 'expose' ? [{ ...e, panelIndex: b.panelIndex }] : [])),
  );
const codes = (r: PlanGridResult) => r.warnings.map((w) => w.code);

/** Zwei Panels, Panel 0 geht früher unter als Panel 1 (Einheit = ODER). */
function twoPanels(slots: number, p0Last: number, settings = SETTINGS): GridInput {
  return grid({
    slots,
    settings,
    units: [
      unit(
        'P',
        [[0, slots - 1]],
        [
          { index: 0, canImage: [[0, p0Last]], peakAltDeg: 50, lines: [line('P0', 300, 100)] },
          { index: 1, canImage: [[0, slots - 1]], peakAltDeg: 60, lines: [line('P1', 300, 100)] },
        ],
      ),
    ],
  });
}

describe('Mosaik ohne Panel-Einheiten: Ablauf je Panel (A-19)', () => {
  it('Belichtung nur, wenn das Panel über die ganze Belichtung samt Download nutzbar ist', () => {
    // Panel 0 bis Slot 3 (≤ 1200 s); 300 s + 60 s Download: die vierte Belichtung (1080–1440) liefe hinein.
    const settings = { ...SETTINGS, overhead: { ...SETTINGS.overhead, downloadS: 60 } };
    const r = planGrid(twoPanels(12, 3, settings));
    const list = exposures(r);
    for (const e of list.filter((x) => x.panelIndex === 0))
      expect(e.atS + e.exposureS + 60, `P0 ${String(e.atS)}`).toBeLessThanOrEqual(1200);
    expect(list.filter((x) => x.panelIndex === 0).map((x) => x.atS)).toEqual([0, 360, 720]);
    // Danach Panel 1 statt Freigabe: kein Leerlauf, jeder Slot belichtet.
    expect(list.find((x) => x.panelIndex === 1)?.atS).toBe(1080);
    expect(r.walkSlotAssignment.every((u) => u === 'P')).toBe(true);
    expect(codes(r)).not.toContain('idle_gap');
  });

  it('Sperre kurz vor Blockende nur, solange das aktuelle Panel noch belichten kann', () => {
    // Panel 0 geht in Slot 31 unter; bisher sperrte der Ablauf auf Panel 0 und gab 31–35 frei (idle_gap).
    const r = planGrid(twoPanels(36, 30));
    const list = exposures(r);
    expect(list.every((e) => e.panelIndex !== 0 || e.atS + e.exposureS <= 31 * 300)).toBe(true);
    const tail = list.filter((e) => e.atS >= 31 * 300);
    expect(tail.length).toBe(5);
    expect(tail.every((e) => e.panelIndex === 1)).toBe(true);
    expect(r.walkSlotAssignment.every((u) => u === 'P')).toBe(true);
    expect(codes(r)).not.toContain('idle_gap');
  });

  it('Panelwechsel am Blockende nur, wenn Slew und Filterwahl noch passen', () => {
    // Lauf 0–1800 s, 200 s Slew: Panel 0 (bis 1500 s) belichtet 200–1400 s; die nächste Belichtung liefe
    // über seinen Untergang. Panel 1 bräuchte 200 s Slew + 300 s > 400 s Rest → Rest freigeben, kein
    // leerer Block, der den angeschnittenen Slot 4 der letzten Belichtung mit freigibt.
    const settings = { ...SETTINGS, overhead: { ...SETTINGS.overhead, slewCenterS: 200 } };
    const g = grid({
      slots: 6,
      settings,
      units: [
        unit(
          'P',
          [[0, 5]],
          [
            { index: 0, canImage: [[0, 4]], lines: [line('P0', 300, 100)] },
            { index: 1, canImage: [[0, 5]], lines: [line('P1', 300, 100)] },
          ],
          { minTimeOnTargetH: 0.5 },
        ),
      ],
    });
    const r = planGrid(g);
    expect(r.blocks).toHaveLength(1);
    expect(exposures(r).map((e) => [e.panelIndex, e.atS])).toEqual([
      [0, 200],
      [0, 500],
      [0, 800],
      [0, 1100],
    ]);
    expect(r.blocks[0]?.endS).toBe(1400);
    expect(r.walkSlotAssignment).toEqual(['P', 'P', 'P', 'P', 'P', null]);
  });
});

describe('Mosaik ohne Panel-Einheiten: Zuteilung je Panel (A-19, A-28)', () => {
  // Mond oben: Panel 0 (mondsicher) nur bis Slot 11 sichtbar, Panel 1 (bis Slot 23) nie mondsicher.
  const moonGrid = (strategy: GridSettings['strategy']) =>
    grid({
      slots: 24,
      moonAltDeg: new Array<number>(24).fill(20),
      settings: { ...SETTINGS, strategy },
      moonProfiles: [
        { id: 'mp', distanceDeg: 60, maxIllumPct: 50, mustBeDown: false, widthDays: 7 },
      ],
      units: [
        unit(
          'P',
          [[0, 23]],
          [
            {
              index: 0,
              canImage: [[0, 11]],
              peakAltDeg: 30,
              lines: [line('P0', 300, 100, { moonProfile: 'mp', safe: [[0, 23]] })],
            },
            {
              index: 1,
              canImage: [[0, 23]],
              peakAltDeg: 30,
              lines: [line('P1', 300, 100, { moonProfile: 'mp', safe: [] })],
            },
          ],
          { minTimeOnTargetH: 0.5, peakAltDeg: 30 },
        ),
        unit('B', [[0, 23]], [{ index: 0, lines: [line('B-L', 300, 12)] }], {
          minTimeOnTargetH: 0.5,
          priority: strategy === 'manual_priority' ? 2 : 1,
        }),
      ],
    });

  it.each(['proportional', 'manual_priority'] as const)(
    '%s: kein Slot für das Mosaik, in dem kein Panel sicher belichten kann',
    (strategy) => {
      const r = planGrid(moonGrid(strategy));
      for (let s = 12; s < 24; s++) expect(r.slotAssignment[s], `Slot ${String(s)}`).not.toBe('P');
      expect(r.slotAssignment.slice(12)).toEqual(new Array<string>(12).fill('B'));
      expect(codes(r)).not.toContain('idle_gap');
      const tier = r.matrix.rows.find((x) => x.profile.unitId === 'P')?.profile.tierSafe[1];
      expect(tier?.map((x, s) => (x ? s : -1)).filter((s) => s >= 0)).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
      ]);
    },
  );
});

describe('Neuplanung mitten im Transit (A-20, transit.md §3, §5.3)', () => {
  const settings = { ...SETTINGS, overhead: { ...SETTINGS.overhead, slewCenterS: 90 } };
  const units = [
    unit('A', [[0, 11]], [{ index: 0, lines: [line('A-L', 300, 100)] }], {
      minTimeOnTargetH: 0.25,
      peakAltDeg: 40,
    }),
    unit('T', [[0, 11]], [{ index: 0, lines: [line('T-V', 60, 10, { filter: 'V' })] }], {
      minTimeOnTargetH: 0.25,
      transit: { windowS: [900, 2700], lineId: 'T-V', lockedAtS: 0 },
    }),
  ];
  const replan = (pastBlocks: { unitId: string; fromS: number; toS: number }[]) =>
    planGrid(
      grid({
        slots: 12,
        settings,
        units,
        startAtS: 1720,
        tonight: {
          pastBlocks,
          exposedSecByUnit: {},
          lastAutofocusS: null,
          filterCycle: [],
          flipDoneByPanel: {},
          currentUnitId: pastBlocks.length > 0 ? 'T' : null,
        },
      }),
    );

  it('eigene vergangene Transit-Slots sind kein Konflikt: die Serie läuft bis Fensterende weiter', () => {
    const r = replan([
      { unitId: 'A', fromS: 0, toS: 600 },
      { unitId: 'T', fromS: 750, toS: 1720 },
    ]);
    expect(r.diagnostics.some((d) => d.reason === 'transit_conflict')).toBe(false);
    const t = r.blocks.find((b) => b.kind === 'transit');
    expect(t?.entries.map((e) => e.cmd)).toEqual(['slew_center', 'expose_series', 'end']);
    expect(t?.entries[1]).toMatchObject({ atS: 1810, untilS: 2700 });
    expect(r.walkSlotAssignment.slice(5, 9)).toEqual(['T', 'T', 'T', 'T']);
  });

  it('Serie beginnt erst nach Uhrstart und Slew, nicht vor dem Vorlauf', () => {
    const r = replan([]);
    const t = r.blocks.find((b) => b.kind === 'transit');
    expect(t?.entries[0]).toMatchObject({ cmd: 'slew_center', atS: 1720, durationS: 90 });
    expect(t?.entries[1]).toMatchObject({ cmd: 'expose_series', atS: 1810, untilS: 2700 });
    expect(t?.startS).toBe(1810);
  });
});

describe('Eigenschaften über Zufallsgrids mit Masken je Panel', () => {
  // Mosaike ohne Panel-Einheiten bekommen je Panel eine verkürzte Maske; die Einheit bleibt das ODER.
  const grids = Array.from({ length: 200 }, (_, i): GridInput => {
    const g = randomGrid(i + 1, { mode: 'productive' });
    const units = g.units.map((u): GridUnit => {
      if (u.panels.length < 2) return u;
      const panels = u.panels.map((p, k): GridPanel => ({
        ...p,
        canImage: u.canImage.map(([a, b]): SlotRange => {
          const cut = Math.floor(((b - a) * ((i + k) % 3)) / 4);
          return k % 2 === 0 ? [a, b - cut] : [a + cut, b];
        }),
      }));
      return { ...u, panels };
    });
    return {
      ...g,
      units,
      settings: {
        ...g.settings,
        mosaicPanelsIndependent: false,
        overhead: {
          slewCenterS: 90,
          filterChangeS: 10,
          ditherSettleS: 15,
          afEveryMin: 60,
          afDurationS: 120,
          downloadS: 3,
        },
      },
    };
  });

  it('jede Belichtung auf einem Panel, das über die ganze Dauer nutzbar ist; nie über das Laufende', () => {
    let checked = 0;
    for (const g of grids) {
      const r = planGrid(g);
      const dl = g.settings.overhead.downloadS;
      const masks = new Map(
        r.matrix.setup.projects.flatMap((p) =>
          p.panels.map((x) => [`${p.projectId}|${String(x.index)}`, x.canImage] as const),
        ),
      );
      const unitMask = new Map(r.matrix.rows.map((x) => [x.profile.unitId, x.profile.canImage]));
      for (const b of r.blocks) {
        if (b.kind !== 'regular') continue;
        for (const e of b.entries) {
          if (e.cmd !== 'expose') continue;
          const end = e.atS + e.exposureS + dl;
          const s0 = Math.floor(e.atS / 300);
          let runEnd = s0;
          while (runEnd < r.walkSlotAssignment.length && r.walkSlotAssignment[runEnd] === b.unitId)
            runEnd++;
          if (!e.lastOfNight)
            expect(end, `${b.unitId} ${String(e.atS)}`).toBeLessThanOrEqual(runEnd * 300);
          const mask = masks.get(`${b.projectId}|${String(b.panelIndex)}`);
          if (!mask) continue;
          const own = unitMask.get(b.unitId) ?? [];
          for (let s = s0; s * 300 < end && s < mask.length; s++)
            if (s === s0 || own[s] === true) {
              expect(
                mask[s],
                `${b.unitId} p${String(b.panelIndex)} ${String(e.atS)} Slot ${String(s)}`,
              ).toBe(true);
              checked++;
            }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('kein Block ohne Belichtung; jeder zugeteilte Lauf enthält eine Belichtung (A-29)', () => {
    for (const g of grids) {
      const r = planGrid(g);
      const dl = g.settings.overhead.downloadS;
      const covered = new Set<string>();
      for (const b of r.blocks) {
        expect(b.entries.some((e) => e.cmd === 'expose' || e.cmd === 'expose_series')).toBe(true);
        for (const e of b.entries) {
          if (e.cmd !== 'expose' && e.cmd !== 'expose_series') continue;
          const end = e.cmd === 'expose' ? e.atS + e.exposureS + dl : e.untilS;
          const from = e.cmd === 'expose_series' ? (b.entries[0]?.atS ?? e.atS) : e.atS;
          for (let s = Math.floor(from / 300); s * 300 < end; s++)
            covered.add(`${b.unitId}|${String(s)}`);
        }
      }
      const a = r.walkSlotAssignment;
      let s = 0;
      while (s < a.length) {
        const u = a[s];
        let e = s;
        while (e + 1 < a.length && a[e + 1] === u) e++;
        if (u !== null && u !== undefined) {
          let any = false;
          for (let k = s; k <= e; k++) if (covered.has(`${u}|${String(k)}`)) any = true;
          expect(any, `Lauf ${u} ${String(s)}–${String(e)}`).toBe(true);
        }
        s = e + 1;
      }
    }
  });
});
