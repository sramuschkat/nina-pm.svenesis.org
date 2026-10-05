/**
 * `planNight` und Ablauf `walk` (AP-13c; allocation.md §8, §8.1, §8.4, §11.3; night.md §3–§4; TK 7.6):
 * Zeitmarken `darknessEndUtc`/`flatsNotBeforeUtc` (NT-12), Nachtende-Kulanz (NT-13, M4),
 * Filterzuordnung (NT-E1), Determinismus (`outputHash`), Leistung, Eigenschaften des Ablaufs.
 */
import { describe, expect, it } from 'vitest';
import {
  ENGINE_VERSION,
  isoFromUnix,
  paintGrid,
  planGrid,
  planNight,
  randomGrid,
  unixFromIso,
  type GridInput,
  type PlanInput,
  type PlanProject,
  type WalkEntry,
} from '../src';

const CHICAGO = [
  { atUtc: '2025-11-02T07:00:00Z', utcOffsetMinutes: -360 },
  { atUtc: '2026-03-08T08:00:00Z', utcOffsetMinutes: -300 },
  { atUtc: '2026-11-01T07:00:00Z', utcOffsetMinutes: -360 },
];
const BERLIN = [
  { atUtc: '2025-10-26T01:00:00Z', utcOffsetMinutes: 60 },
  { atUtc: '2026-03-29T01:00:00Z', utcOffsetMinutes: 120 },
  { atUtc: '2026-10-25T01:00:00Z', utcOffsetMinutes: 60 },
];
const STARFRONT = { latitudeDeg: 31.5471, longitudeDeg: -99.3823, elevationM: 400 };
const HANNOVER = { latitudeDeg: 52.3705, longitudeDeg: 9.7332, elevationM: 55 };

let seq = 0;
const id = (prefix: string) => {
  seq += 1;
  return `00000000-0000-4000-8000-${prefix}${String(seq).padStart(12 - prefix.length, '0')}`;
};

function project(
  over: Partial<PlanProject> & { lines?: number; ninaFilterName?: string | null } = {},
): PlanProject {
  const panelId = id('a');
  const { lines = 1, ninaFilterName = 'Ha', ...rest } = over;
  return {
    id: id('b'),
    raDeg: 13.2046,
    decDeg: 56.6297,
    rotationDeg: 90,
    priority: 1,
    minAltitudeDeg: 30,
    minTimeOnTargetH: 1,
    twilight: 'astronomical',
    startDate: null,
    dueDate: null,
    panels: [
      {
        id: panelId,
        index: 0,
        raDeg: rest.raDeg ?? 13.2046,
        decDeg: rest.decDeg ?? 56.6297,
        rotationDeg: 90,
        lines: Array.from({ length: lines }, (_, k) => ({
          id: id('c'),
          filter: ['Ha', 'OIII', 'SII', 'L', 'R'][k % 5] ?? 'L',
          ninaFilterName,
          exposureS: 300,
          planned: 40,
          accepted: 0,
          pending: 0,
          enabled: true,
          moonProfileId: null,
          gain: 100,
          offset: 20,
          binning: 1,
          readoutMode: 'High Gain Mode',
        })),
      },
    ],
    transit: null,
    ...rest,
  };
}

function input(projects: PlanProject[], over: Partial<PlanInput> = {}): PlanInput {
  return {
    mode: 'productive',
    night: '2026-09-17',
    site: STARFRONT,
    tzdataVersion: '2026a',
    timeZoneTransitions: CHICAGO,
    rig: {
      id: '00000000-0000-4000-8000-00000000r001'.replace('r', '0'),
      hasRotator: true,
      defaultRotationDeg: null,
      rotationToleranceDeg: 5,
      hasFilterWheel: true,
    },
    scheduler: {
      strategy: 'proportional',
      sortChain: ['lowest_peak_altitude', 'setting_soonest', 'most_remaining', 'constrained'],
      bonusEnabled: false,
      overshootPct: 0,
      mosaicPanelsIndependent: true,
      ditherEnabled: true,
      ditherEvery: 1,
      filterSwitchEnabled: false,
      filterSwitchEvery: 10,
      filterSwitchTolerancePct: 50,
      flatsSource: 'panel',
      flip: { enabled: false, afterMin: 5, maxAfterMin: 15, pauseBeforeMin: 0, durationS: 240 },
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
    projects,
    startAtUtc: null,
    tonight: null,
    ...over,
  };
}

const near = (actual: string | null, iso: string, tol: number) => {
  expect(actual).not.toBeNull();
  expect(Math.abs(unixFromIso(actual ?? '') - unixFromIso(iso))).toBeLessThanOrEqual(tol);
};

describe('Zeitpunkte ohne Date', () => {
  it('isoFromUnix ↔ unixFromIso', () => {
    for (const iso of ['2026-09-18T00:00:00Z', '2026-12-31T23:59:59Z', '2000-02-29T12:34:56Z'])
      expect(isoFromUnix(unixFromIso(iso))).toBe(iso);
    expect(unixFromIso('2026-09-18T11:30:42Z')).toBe(Date.parse('2026-09-18T11:30:42Z') / 1000);
  });
});

describe('Zeitmarken (night.md §3–§4, NT-12)', () => {
  it('Starfront 2026-09-17: astronomisch + nautisch → darknessEndUtc 11:30:42Z; Nachtfenster 00:00–13:00', () => {
    const plan = planNight(
      input([project(), project({ twilight: 'nautical', raDeg: 324.5366, decDeg: 30.4886 })]),
    );
    expect(plan.nightWindow).toEqual({
      startUtc: '2026-09-18T00:00:00Z',
      endUtc: '2026-09-18T13:00:00Z',
    });
    near(plan.darknessEndUtc, '2026-09-18T11:30:42Z', 1);
    expect(plan.flatsNotBeforeUtc).toBe(plan.darknessEndUtc);
    expect(plan.flatsNotAfterUtc).toBeNull();
    expect(plan.sessionEndUtc).toBe('2026-09-18T13:00:00Z');
    near(plan.darkness.astronomicalEndUtc, '2026-09-18T11:01:56Z', 1);
  });

  it('nur astronomisch → 11:01:56Z', () => {
    near(planNight(input([project()])).darknessEndUtc, '2026-09-18T11:01:56Z', 1);
  });

  it('ohne Projekte (alle fertig) → astronomische Grenze 11:01:56Z, Flats ab dort (real-all-done)', () => {
    const plan = planNight(input([]));
    near(plan.darknessEndUtc, '2026-09-18T11:01:56Z', 1);
    expect(plan.flatsNotBeforeUtc).toBe(plan.darknessEndUtc);
    expect(plan.blocks).toEqual([]);
  });

  it('Hannover 21.06. nur astronomisch → null, flatsNotBeforeUtc = Nachtfensterende − 1 h', () => {
    const plan = planNight(
      input([project({ raDeg: 250, decDeg: 36 })], {
        night: '2026-06-21',
        site: HANNOVER,
        timeZoneTransitions: BERLIN,
      }),
    );
    expect(plan.darknessEndUtc).toBeNull();
    expect(unixFromIso(plan.flatsNotBeforeUtc)).toBe(unixFromIso(plan.nightWindow.endUtc) - 3600);
    // Astronomisches Projekt: nie dunkel genug → keine Blöcke, Diagnose not_visible/below_min_time.
    expect(plan.blocks).toEqual([]);
    expect(plan.diagnostics.length).toBeGreaterThan(0);
  });
});

describe('Plan (TK 7.6)', () => {
  it('Blöcke mit UUID, end-Eintrag, Belichtungsparametern, twilightEndUtc; deterministisch', () => {
    const p = input([project({ lines: 2 })]);
    const plan = planNight(p);
    expect(plan.engineVersion).toBe(ENGINE_VERSION);
    expect(plan.blocks.length).toBeGreaterThan(0);
    for (const b of plan.blocks) {
      expect(b.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(b.entries.at(-1)?.cmd).toBe('end');
      expect(b.entries[0]?.cmd).toBe('slew_center_rotate');
      expect(b.rotationMode).toBe('rotator');
      near(b.twilightEndUtc, '2026-09-18T11:01:56Z', 1);
      b.entries.forEach((e, i) => expect(e.seq).toBe(i + 1));
    }
    const expose = plan.blocks.flatMap((b) => b.entries).find((e) => e.cmd === 'expose');
    expect(expose).toMatchObject({
      gain: 100,
      offset: 20,
      binning: 1,
      readoutMode: 'High Gain Mode',
    });
    expect(plan.summary.targets).toBe(1);
    const again = planNight(structuredClone(p));
    expect(again.outputHash).toBe(plan.outputHash);
    expect(again.inputHash).toBe(plan.inputHash);
    expect(plan.outputHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('Neuplanung mit startAtUtc vor dem Nachtfenster ≡ Erstplan (§5.3); danach kein Absturz', () => {
    const target = project({ lines: 2 });
    const first = planNight(input([target]));
    const tonight = {
      pastBlocks: [],
      exposedSecByUnit: {},
      lastAutofocusUtc: null,
      filterCycle: [],
      flipDoneByPanel: {},
      currentUnitId: null,
    };
    const early = planNight(input([target], { startAtUtc: '2026-09-17T14:05:00Z', tonight }));
    const strip = (p: typeof first) =>
      p.blocks.map((b) => Object.fromEntries(Object.entries(b).filter(([k]) => k !== 'id')));
    expect(strip(early)).toEqual(strip(first));
    const late = planNight(input([target], { startAtUtc: '2026-09-18T14:00:00Z', tonight }));
    expect(late.blocks).toEqual([]);
  });

  it('Filterrad: Zeile ohne ninaFilterName nimmt nicht teil → filter_not_found mit lineId (NT-E1)', () => {
    const p = project({ ninaFilterName: null });
    const lineId = p.panels[0]?.lines[0]?.id ?? '';
    const plan = planNight(input([p]));
    expect(plan.blocks).toEqual([]);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ projectId: p.id, lineId, reason: 'filter_not_found' }),
    );
    // Ohne Filterrad (OSC) plant dieselbe Zeile normal.
    const osc = planNight(input([p], { rig: { ...input([]).rig, hasFilterWheel: false } }));
    expect(osc.blocks.length).toBeGreaterThan(0);
  });

  it('Sonderfall nur Transit: ein Transitblock mit Vorlauf und Serie bis Fensterende, kein regulärer Block', () => {
    const p = project({ raDeg: 324.5366, decDeg: 30.4886, twilight: 'nautical' });
    const lineId = p.panels[0]?.lines[0]?.id ?? '';
    const transitProject = {
      ...p,
      transit: {
        observationId: '00000000-0000-4000-8000-00000000f001',
        lineId,
        windowStartUtc: '2026-09-18T02:08:00Z',
        windowEndUtc: '2026-09-18T07:34:00Z',
        lockedAtUtc: '2026-09-10T12:00:00Z',
      },
    };
    const plan = planNight(input([transitProject]));
    expect(plan.blocks).toHaveLength(1);
    const [b] = plan.blocks;
    expect(b).toMatchObject({
      kind: 'transit',
      startUtc: '2026-09-18T02:08:00Z',
      endUtc: '2026-09-18T07:34:00Z',
    });
    expect(b?.entries.map((e) => e.cmd)).toEqual(['slew_center_rotate', 'expose_series', 'end']);
    // Vorlauf: Fensterbeginn − Slew 90 s − 60 s = 02:05:30Z (transit.md §3).
    expect(b?.entries[0]?.atUtc).toBe('2026-09-18T02:05:30Z');
    expect(b?.transitObservationId).toBe('00000000-0000-4000-8000-00000000f001');
  });

  it('Mosaik ohne Panel-Einheiten: Höhe je Panel – ein Panel unter der Mindesthöhe wird nie belichtet (Prüfung 28.09.2026)', () => {
    // Panel 0 steigt in Starfront (31,5° N) bis 65°, Panel 1 (δ −35°) nie über 23,5° < 30°. Früher galt für
    // beide die Höhe der Projektmitte (= Panel 0), Panel 1 wurde mitbelichtet.
    const base = project({ lines: 1 });
    const p0 = base.panels[0];
    if (!p0) throw new Error('Panel fehlt');
    const low = {
      ...p0,
      id: id('a'),
      index: 1,
      decDeg: -35,
      lines: p0.lines.map((l) => ({ ...l, id: id('c') })),
    };
    const mosaic = { ...base, panels: [p0, low] };
    const plan = planNight(
      input([mosaic], {
        scheduler: { ...input([]).scheduler, mosaicPanelsIndependent: false },
      }),
    );
    const exposed = new Set(
      plan.blocks
        .flatMap((b) => b.entries)
        .flatMap((e) => (e.cmd === 'expose' ? [e.exposureLineId] : [])),
    );
    expect(exposed.has(p0.lines[0]?.id ?? '')).toBe(true);
    expect(exposed.has(low.lines[0]?.id ?? '')).toBe(false);
  });

  it('Kompatibilitätsmodus gibt es nur für Grids (Orakel)', () => {
    expect(() => planNight(input([project()], { mode: 'compat' }))).toThrow(/productive/);
  });

  it('ohne Rotator: slew_center und Kamerawinkel (NT-30)', () => {
    const plan = planNight(
      input([project()], {
        rig: { ...input([]).rig, hasRotator: false, defaultRotationDeg: 12 },
      }),
    );
    for (const b of plan.blocks) {
      expect(b.rotationMode).toBe('fixed_camera');
      expect(b.rotationDeg).toBe(12);
      expect(b.entries[0]?.cmd).toBe('slew_center');
    }
  });

  it('Benchmark: 30 Projekte × 3 Panels × 5 Zeilen ≤ 300 ms (Richtwert, CI mit Reserve)', () => {
    const projects = Array.from({ length: 30 }, (_, i) => {
      const base = project({ lines: 5, raDeg: (i * 12) % 360, decDeg: 20 + (i % 5) * 8 });
      const p0 = base.panels[0];
      if (!p0) throw new Error('Panel fehlt');
      return {
        ...base,
        panels: [0, 1, 2].map((k) => ({
          ...p0,
          id: id('d'),
          index: k,
          raDeg: base.raDeg + k * 0.5,
          lines: p0.lines.map((l) => ({ ...l, id: id('e') })),
        })),
      };
    });
    const started = performance.now();
    const plan = planNight(input(projects));
    const ms = performance.now() - started;
    expect(plan.blocks.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(1500);
  });
});

describe('Nachtende-Kulanz (A-24, NT-13, M4)', () => {
  const grid = (twilightEndS: number | null, darknessEndS: number | null): GridInput => ({
    mode: 'productive',
    slotS: 300,
    slots: 12,
    startAtS: null,
    moonAltDeg: new Array<number>(12).fill(-10),
    settings: {
      strategy: 'proportional',
      sortChain: [],
      bonusEnabled: false,
      overshootPct: 0,
      mosaicPanelsIndependent: true,
      dither: { enabled: false, every: 1 },
      filterSwitch: { enabled: false, every: 10, tolerancePct: 50 },
      overhead: {
        slewCenterS: 100,
        filterChangeS: 0,
        ditherSettleS: 0,
        afEveryMin: 0,
        afDurationS: 0,
        downloadS: 0,
      },
      flip: { enabled: false, afterMin: 5, maxAfterMin: 15, pauseBeforeMin: 0, durationS: 240 },
    },
    moonProfiles: [],
    units: [
      {
        unitId: 'A',
        projectId: 'A',
        priority: 1,
        minTimeOnTargetH: 0.5,
        dueDate: null,
        peakAltDeg: 50,
        canImage: [[0, 11]],
        meridianAtS: null,
        transit: null,
        twilightEndS,
        panels: [
          {
            index: 0,
            lines: [
              {
                id: 'A-L',
                filter: 'L',
                exposureS: 600,
                planned: 20,
                accepted: 0,
                enabled: true,
                moonProfile: null,
                safe: [],
              },
            ],
          },
        ],
      },
    ],
    tonight: null,
    darknessEndS,
  });
  const exposes = (g: GridInput) =>
    planGrid(g)
      .blocks.flatMap((b) => b.entries)
      .filter((e) => e.cmd === 'expose');

  it('letzte Belichtung läuft über das Blockende, endet aber spätestens bei min(darknessEnd, twilightEnd)', () => {
    // Nacht 3600 s, Slew 100 s, Belichtungen 600 s: 100 + 5·600 = 3100, die sechste endete 3700.
    const last = exposes(grid(3800, 4000)).at(-1);
    expect(last).toMatchObject({ atS: 3100, lastOfNight: true });
  });

  it('eigene Dämmerungsgrenze früher als darknessEnd → keine Kulanz über sie hinaus', () => {
    const list = exposes(grid(3650, 4000));
    expect(list.at(-1)).toMatchObject({ atS: 2500, lastOfNight: false });
    expect(list.some((e) => e.cmd === 'expose' && e.lastOfNight)).toBe(false);
  });

  it('beide null → Grenze ist das Blockende (keine Kulanz)', () => {
    expect(exposes(grid(null, null)).some((e) => e.cmd === 'expose' && e.lastOfNight)).toBe(false);
  });
});

describe('Eigenschaften des Ablaufs (§11.3) über Zufallsgrids', () => {
  const grids = Array.from({ length: 200 }, (_, i) => {
    const g = randomGrid(i + 1, { mode: 'productive' });
    return {
      ...g,
      settings: {
        ...g.settings,
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
  const cost = (e: WalkEntry, dl: number) => (e.cmd === 'expose' ? e.exposureS + dl : 0);

  it('jeder Block endet mit end; höchstens ein lastOfNight je Nacht', () => {
    for (const g of grids) {
      const r = planGrid(g);
      let lastOfNight = 0;
      for (const b of r.blocks) {
        expect(b.entries.at(-1)?.cmd).toBe('end');
        lastOfNight += b.entries.filter((e) => e.cmd === 'expose' && e.lastOfNight).length;
      }
      expect(lastOfNight).toBeLessThanOrEqual(1);
    }
  });

  it('keine Belichtung über das Ende ihres Laufs (außer Kulanz); LA-Belichtung sicher über die ganze Dauer', () => {
    for (const g of grids) {
      const r = planGrid(g);
      const dl = g.settings.overhead.downloadS;
      const lines = new Map(
        r.matrix.setup.projects.flatMap((p) =>
          p.panels.flatMap((x) => x.lines.map((l) => [l.id, l] as const)),
        ),
      );
      for (const b of r.blocks)
        for (const e of b.entries) {
          if (e.cmd !== 'expose') continue;
          const end = e.atS + cost(e, dl);
          const s0 = Math.floor(e.atS / 300);
          let runEnd = s0;
          while (runEnd < r.walkSlotAssignment.length && r.walkSlotAssignment[runEnd] === b.unitId)
            runEnd++;
          if (!e.lastOfNight)
            expect(end, `${b.unitId} ${String(e.atS)}`).toBeLessThanOrEqual(runEnd * 300);
          const line = lines.get(e.lineId);
          if (line && line.tier > 0)
            for (let s = s0; s * 300 < end && s < line.safe.length; s++)
              expect(line.safe[s], `LA ${e.lineId} Slot ${String(s)}`).toBe(true);
        }
    }
  });

  it('kein zugeteilter Slot ohne Belichtung im Plan (A-29)', () => {
    for (const g of grids) {
      const r = planGrid(g);
      const dl = g.settings.overhead.downloadS;
      const covered = new Set<string>();
      for (const b of r.blocks)
        for (const e of b.entries) {
          if (e.cmd !== 'expose' && e.cmd !== 'expose_series') continue;
          const end = e.cmd === 'expose' ? e.atS + cost(e, dl) : e.untilS;
          // Transit: Vorlauf-Slots gehören zum Block (transit.md §3).
          const from = e.cmd === 'expose_series' ? (b.entries[0]?.atS ?? e.atS) : e.atS;
          for (let s = Math.floor(from / 300); s * 300 < end; s++)
            covered.add(`${b.unitId}|${String(s)}`);
        }
      // Jeder Lauf einer Einheit enthält mindestens einen Slot mit Belichtung.
      let s = 0;
      const a = r.walkSlotAssignment;
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

  it('Neuplanungs-Fairness: zwei gleiche Ziele, Neuplanung vor Block 2 → Anteile ±1 Slot (A-10)', () => {
    const unit = (u: string, accepted: number) => ({
      unitId: u,
      projectId: u,
      priority: 1,
      minTimeOnTargetH: 1,
      dueDate: null,
      peakAltDeg: 60,
      canImage: [[0, 47]] as [number, number][],
      meridianAtS: null,
      transit: null,
      panels: [
        {
          index: 0,
          lines: [
            {
              id: `${u}-L`,
              filter: 'L',
              exposureS: 300,
              planned: 40,
              accepted,
              enabled: true,
              moonProfile: null,
              safe: [],
            },
          ],
        },
      ],
    });
    const base = grids[0] as GridInput;
    const g: GridInput = {
      ...base,
      slots: 48,
      moonAltDeg: new Array<number>(48).fill(-10),
      moonProfiles: [],
      settings: { ...base.settings, strategy: 'proportional', bonusEnabled: false },
      units: [unit('A', 12), unit('B', 0)],
      startAtS: 3600,
      tonight: {
        pastBlocks: [{ unitId: 'A', fromS: 0, toS: 3600 }],
        exposedSecByUnit: { A: 3600 },
        lastAutofocusS: null,
        filterCycle: [],
        flipDoneByPanel: {},
        currentUnitId: 'A',
      },
    };
    const a = paintGrid(g).slotAssignment;
    const countA = a.filter((x) => x === 'A').length;
    const countB = a.filter((x) => x === 'B').length;
    expect(Math.abs(countA - countB)).toBeLessThanOrEqual(1);
  });
});
