/**
 * AP-66 (Entscheidungen Sven 07.10.2026): frei gewordene Zeit im Ablauf neu vergeben (A-33) und kein `slew_center`
 * bei Fortsetzung der Einheit auf der Montierung (A-34). `specs/engine/allocation.md` §8.7, §10.
 *
 * Die Fälle mit fester Zuteilung setzen `SlotAssignment` direkt (wie nach `paint`) und rufen `walk`; so ist die
 * Lücke genau dort, wo der Test sie braucht. Zum Vergleich laufen sie mit abgeschalteten Schaltern (Verhalten bis
 * Engine 0.17.0).
 */
import { describe, expect, it } from 'vitest';
import {
  buildMatrix,
  paint,
  planGrid,
  randomGrid,
  setupFromGrid,
  walk,
  type GridInput,
  type GridLine,
  type GridSettings,
  type GridTonight,
  type GridUnit,
  type SlotRange,
  type WalkBlock,
  type WalkResult,
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
    downloadS: 0,
  },
  flip: { enabled: false, afterMin: 5, maxAfterMin: 15, pauseBeforeMin: 0, durationS: 240 },
};

function line(id: string, exposureS: number, planned: number): GridLine {
  return {
    id,
    filter: id.split('-')[1] ?? 'L',
    exposureS,
    planned,
    accepted: 0,
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
    minTimeOnTargetH: 0.1,
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

function grid(units: GridUnit[], slots: number, over: Partial<GridInput> = {}): GridInput {
  return {
    mode: 'productive',
    slotS: 300,
    slots,
    startAtS: null,
    moonAltDeg: new Array<number>(slots).fill(-10),
    settings: SETTINGS,
    moonProfiles: [],
    units,
    tonight: null,
    ...over,
  };
}

interface RunOptions {
  /** Zuteilung je Slot (Einheiten-ID oder `null`); ohne Angabe malt `paint`. */
  readonly slots?: readonly (string | null)[];
  /** A-33/A-34 aus (Verhalten bis Engine 0.17.0). */
  readonly old?: boolean;
  /** Erst `paint` (Transit-Sperren), dann `slots` nur in nicht gesperrten Slots setzen. */
  readonly paintFirst?: boolean;
  /** Aufrücken (A-35); Vorgabe an, mit `old` immer aus. */
  readonly moveUp?: boolean;
  /** Kurzbesuche zulassen (A-36 aus, Verhalten bis Engine 0.18.0); mit `old` immer zugelassen. */
  readonly shortVisits?: boolean;
}

/** `walk` mit den Einstellungen des Grids (ohne Flip/Meridian), wie `planGrid` sie setzt. */
function run(g: GridInput, opts: RunOptions = {}): WalkResult {
  const base = setupFromGrid(g);
  const setup = {
    ...base,
    switches: {
      ...base.switches,
      ...(opts.old ? { reofferFreedTime: false, continuationNoSlew: false } : {}),
      moveUpBlocks: !opts.old && opts.moveUp !== false,
      minVisitSubs: !opts.old && opts.shortVisits !== true,
    },
  };
  const m = buildMatrix(setup);
  if (opts.slots) {
    if (opts.paintFirst) paint(m);
    const index = new Map(m.rows.map((r) => [r.profile.unitId, r.index]));
    opts.slots.forEach((u, s) => {
      if (!m.locked[s]) m.assignment[s] = u === null ? -1 : (index.get(u) ?? -1);
    });
  } else paint(m);
  const s = g.settings;
  const o = s.overhead;
  return walk(m, {
    slewCenterS: o.slewCenterS,
    filterChangeS: o.filterChangeS,
    ditherSettleS: o.ditherSettleS,
    afEveryMin: o.afEveryMin,
    afDurationS: o.afDurationS,
    downloadS: o.downloadS,
    ditherEnabled: s.dither.enabled,
    ditherEvery: s.dither.every,
    filterSwitchEnabled: s.filterSwitch.enabled,
    filterSwitchEvery: s.filterSwitch.every,
    tolerancePct: s.filterSwitch.tolerancePct,
    bonusEnabled: s.bonusEnabled,
    rotator: false,
    darknessEndS: null,
    twilightEndS: () => null,
    lastAutofocusS: null,
    startAtS: g.startAtS,
    initialCycle: new Map(),
    flip: s.flip,
    meridian: () => [],
    upperMeridian: () => null,
    pierSide: () => null,
    flipDone: new Set(),
  });
}

const blocksOf = (r: { blocks: readonly WalkBlock[] }, unitId: string) =>
  r.blocks.filter((b) => b.unitId === unitId);
const exposures = (r: { blocks: readonly WalkBlock[] }, unitId: string) =>
  blocksOf(r, unitId)
    .flatMap((b) => b.entries)
    .filter((e) => e.cmd === 'expose').length;
const slews = (r: { blocks: readonly WalkBlock[] }, unitId: string) =>
  blocksOf(r, unitId)
    .flatMap((b) => b.entries)
    .filter((e) => e.cmd === 'slew_center' || e.cmd === 'slew_center_rotate');

describe('Frei gewordene Zeit neu vergeben (A-33, Entscheidung Sven 07.10.2026)', () => {
  it('Lücke nach erfülltem Bedarf → Einheit des vorigen Blocks wird verlängert, ohne Slew', () => {
    // B ist nach seiner einen Aufnahme fertig; sein zweiter Lauf (Slots 5–7) hat keine Arbeit mehr. Vorher übernahm A
    // die Slots per Ersatz (A-17) mit neuem Block und Slew ab 1500 s, A-Zeit 1260–1500 s blieb leer.
    const g = grid(
      [unit('A', [[0, 7]], [line('A-L', 300, 20)]), unit('B', [[0, 7]], [line('B-L', 300, 1)])],
      8,
    );
    const slots = ['B', 'B', 'A', 'A', 'A', 'B', 'B', 'B'];
    const now = run(g, { slots, moveUp: false });
    const old = run(g, { slots, old: true, moveUp: false });
    expect(blocksOf(old, 'A')).toHaveLength(2);
    expect(slews(old, 'A')).toHaveLength(2);
    expect(exposures(old, 'A')).toBe(4);

    expect(blocksOf(now, 'A')).toHaveLength(1);
    expect(slews(now, 'A')).toHaveLength(1);
    expect(exposures(now, 'A')).toBe(5);
    expect(now.assignment.slice(5)).toEqual([0, 0, 0].map(() => now.assignment[2]));
  });

  it('Lücke → Einheit des folgenden Blocks beginnt früher (normaler Slew)', () => {
    // A ist nach einer Aufnahme fertig, Slots 2–3 sind frei, B folgt ab Slot 4.
    const g = grid(
      [unit('A', [[0, 7]], [line('A-L', 300, 1)]), unit('B', [[0, 7]], [line('B-L', 300, 10)])],
      8,
    );
    const slots = ['A', 'A', null, null, 'B', 'B', 'B', 'B'];
    const now = run(g, { slots, moveUp: false });
    const old = run(g, { slots, old: true, moveUp: false });
    expect(slews(old, 'B').map((e) => e.atS)).toEqual([1200]);
    expect(exposures(old, 'B')).toBe(3);
    expect(slews(now, 'B').map((e) => e.atS)).toEqual([600]);
    expect(exposures(now, 'B')).toBe(5);
  });

  it('nächste Einheit nur ab dem Slot, in dem sie nutzbar ist', () => {
    const g = grid(
      [unit('A', [[0, 7]], [line('A-L', 300, 1)]), unit('B', [[3, 7]], [line('B-L', 300, 10)])],
      8,
    );
    const now = run(g, { slots: ['A', 'A', null, null, 'B', 'B', 'B', 'B'], moveUp: false });
    expect(slews(now, 'B').map((e) => e.atS)).toEqual([900]);
  });

  it.each([
    [4, false],
    [8, true],
  ] as const)(
    'neue Einheit nur bei lohnendem Rest: Lücke %i Slots → übernimmt %s',
    (gapSlots, taken) => {
      // A ist nach einer Aufnahme fertig, danach folgt kein Block. C (Mindestzeit 30 min) ist nutzbar: 4 Slots
      // (1200 s − 60 s Slew) lohnen nicht, 8 Slots (2400 s − 60 s) schon.
      const n = 2 + gapSlots;
      const g = grid(
        [
          unit('A', [[0, n - 1]], [line('A-L', 300, 1)]),
          unit('C', [[0, n - 1]], [line('C-L', 300, 20)], { minTimeOnTargetH: 0.5 }),
        ],
        n,
      );
      const slots = ['A', 'A', ...new Array<null>(gapSlots).fill(null)];
      const now = run(g, { slots, moveUp: false });
      const old = run(g, { slots, old: true, moveUp: false });
      expect(exposures(old, 'C')).toBe(0);
      if (taken) {
        expect(slews(now, 'C').map((e) => e.atS)).toEqual([600]);
        expect(exposures(now, 'C')).toBe(7);
      } else expect(exposures(now, 'C')).toBe(0);
    },
  );

  it('Restposten: neue Einheit mit kleiner Restarbeit braucht nur diese Restarbeit', () => {
    // C hat 2 Aufnahmen offen (600 s) bei Mindestzeit 30 min: 4 freie Slots reichen (1200 s − 60 s ≥ 600 s).
    const g = grid(
      [
        unit('A', [[0, 5]], [line('A-L', 300, 1)]),
        unit('C', [[0, 5]], [line('C-L', 300, 2)], { minTimeOnTargetH: 0.5 }),
      ],
      6,
    );
    const now = run(g, { slots: ['A', 'A', null, null, null, null], moveUp: false });
    expect(exposures(now, 'C')).toBe(2);
  });

  it('Transitfenster unverändert: Lücke vor dem Vorlauf geht nicht an die Transit-Einheit', () => {
    // A (eine Aufnahme) endet früh; die Transit-Einheit T folgt mit gesperrtem Fenster. Die Lücke davor bleibt leer
    // (T wird nicht vorgezogen); C übernimmt sie nur, wenn sich das lohnt, und endet vor dem Vorlauf.
    const t0 = 12 * 300;
    const transit = unit('T', [[0, 23]], [line('T-V', 60, 200)], {
      transit: { windowS: [t0, t0 + 3600], lineId: 'T-V', lockedAtS: 0 },
    });
    const a = unit('A', [[0, 23]], [line('A-L', 300, 1)]);
    const c = unit('C', [[0, 23]], [line('C-L', 300, 40)], { minTimeOnTargetH: 0.25 });
    const g = grid([a, transit, c], 24);
    // Slots 0–1 A, 2–10 frei; ab Slot 11 sperrt preClaimTransits Vorlauf und Fenster für T.
    const slots = ['A', 'A', ...new Array<null>(22).fill(null)];
    const now = run(g, { slots, paintFirst: true, moveUp: false });
    const old = run(g, { slots, paintFirst: true, old: true });
    const tBlock = (r: WalkResult) => blocksOf(r, 'T')[0];
    expect(tBlock(old)?.entries.some((e) => e.cmd === 'expose_series')).toBe(true);
    expect(tBlock(now)?.entries).toEqual(tBlock(old)?.entries);
    expect(tBlock(now)?.startS).toBe(t0);
    expect(now.assignment.slice(11)).toEqual(old.assignment.slice(11));
    // C übernimmt die Lücke (9 Slots ≥ Mindestzeit 15 min + Slew), der Block endet vor dem Vorlauf.
    expect(exposures(old, 'C')).toBe(0);
    const cBlock = blocksOf(now, 'C')[0];
    expect(cBlock?.startS).toBe(600);
    expect(cBlock?.endS ?? Infinity).toBeLessThanOrEqual(t0 - 60 - 60);
  });
});

describe('Kein Anfahren bei Fortsetzung (A-34, Entscheidung Sven 07.10.2026)', () => {
  const startAtS = 20 * 300 + 130;
  const tonight = (over: Partial<GridTonight> = {}): GridTonight => ({
    pastBlocks: [{ unitId: 'A', fromS: 10 * 300, toS: startAtS }],
    exposedSecByUnit: { A: 3000 },
    lastAutofocusS: null,
    filterCycle: [],
    flipDoneByPanel: {},
    currentUnitId: 'A',
    ...over,
  });
  const g = (t: GridTonight) =>
    grid(
      [unit('A', [[0, 47]], [line('A-L', 300, 40)]), unit('B', [[0, 47]], [line('B-L', 300, 40)])],
      48,
      { startAtS, tonight: t },
    );

  it('erster Block setzt A fort: kein slew_center, Belichtung ab startAtS', () => {
    const r = planGrid(g(tonight()));
    const first = r.blocks[0];
    expect(first?.unitId).toBe('A');
    expect(first?.entries.some((e) => e.cmd === 'slew_center')).toBe(false);
    expect(first?.entries.find((e) => e.cmd === 'expose')?.atS).toBe(startAtS);
    // Spätere Blöcke fahren weiter an (A-18).
    for (const b of r.blocks.slice(1))
      expect(b.entries[0]?.cmd === 'slew_center' || b.kind === 'transit').toBe(true);
  });

  it('mit Rotator: auch kein slew_center_rotate am Fortsetzungsblock, folgende Blöcke rotieren', () => {
    const r = planGrid(g(tonight()), { rotator: true });
    expect(r.blocks[0]?.entries.some((e) => e.cmd === 'slew_center_rotate')).toBe(false);
    expect(r.blocks.slice(1).every((b) => b.entries[0]?.cmd === 'slew_center_rotate')).toBe(true);
  });

  it('ohne currentUnitId: Slew wie bisher', () => {
    const r = planGrid(g(tonight({ currentUnitId: null })));
    expect(r.blocks[0]?.entries[0]?.cmd).toBe('slew_center');
  });

  it('letzter Block der Einheit mehr als 5 min vor startAtS: Slew wie bisher', () => {
    const r = planGrid(
      g(tonight({ pastBlocks: [{ unitId: 'A', fromS: 10 * 300, toS: startAtS - 301 }] })),
    );
    expect(r.blocks[0]?.entries[0]?.cmd).toBe('slew_center');
  });

  it('Schalter aus (Verhalten bis 0.17.0): Slew am Fortsetzungsblock', () => {
    const r = run(g(tonight()), { old: true });
    expect(r.blocks[0]?.unitId).toBe('A');
    expect(r.blocks[0]?.entries[0]?.cmd).toBe('slew_center');
  });
});

describe('Aufrücken (A-35, Entscheidung Sven 07.10.2026)', () => {
  // A ist nach einer Aufnahme um 360 s fertig; B (Slots 2–5) beginnt direkt danach statt an der Slotgrenze 600 s.
  const twoUnits = (bFrom: number) =>
    grid(
      [unit('A', [[0, 5]], [line('A-L', 300, 1)]), unit('B', [[bFrom, 5]], [line('B-L', 300, 10)])],
      6,
    );
  const slots = ['A', 'A', 'B', 'B', 'B', 'B'];

  it('nächster Block beginnt direkt nach der letzten Aktion des vorigen, ohne Überlappung', () => {
    const now = run(twoUnits(0), { slots });
    const old = run(twoUnits(0), { slots, old: true });
    const a = blocksOf(now, 'A')[0];
    const b = blocksOf(now, 'B')[0];
    expect(a?.endS).toBe(360);
    expect(b?.startS).toBe(360);
    expect(slews(now, 'B').map((e) => e.atS)).toEqual([360]);
    expect(slews(old, 'B').map((e) => e.atS)).toEqual([600]);
    // A endet ohne `wait`, B überlappt nicht und belichtet nie über sein Laufende (1800 s).
    expect(a?.entries.some((e) => e.cmd === 'wait')).toBe(false);
    for (const e of b?.entries ?? [])
      if (e.cmd === 'expose') expect(e.atS + e.exposureS).toBeLessThanOrEqual(1800);
    // Die Zuteilung bleibt im 5-min-Raster.
    expect(now.assignment).toEqual(old.assignment);
  });

  it('nicht vor die Slotgrenze, wenn die Einheit im Slot davor nicht nutzbar ist', () => {
    const now = run(twoUnits(2), { slots });
    expect(slews(now, 'B').map((e) => e.atS)).toEqual([600]);
  });

  it('Transitblock rückt nie vor sein Fenster bzw. seinen Vorlauf', () => {
    // A endet früh (Slots 0–10, eine Aufnahme), T ist ab Slot 11 gesperrt (Vorlauf 3480 s, Fenster ab 3600 s).
    const t0 = 12 * 300;
    const transit = unit('T', [[0, 23]], [line('T-V', 60, 200)], {
      transit: { windowS: [t0, t0 + 3600], lineId: 'T-V', lockedAtS: 0 },
    });
    const a = unit('A', [[0, 23]], [line('A-L', 300, 1)]);
    const g = grid([a, transit], 24);
    const s = [...new Array<string>(11).fill('A'), ...new Array<null>(13).fill(null)];
    const now = run(g, { slots: s, paintFirst: true });
    const old = run(g, { slots: s, paintFirst: true, old: true });
    const tb = blocksOf(now, 'T')[0];
    expect(tb?.entries).toEqual(blocksOf(old, 'T')[0]?.entries);
    expect(Math.min(...(tb?.entries ?? []).map((e) => e.atS))).toBe(t0 - 60 - 60);
  });

  it('Zufallsgrids: Blöcke überlappen nie, Belichtungen nur in Slots, in denen die Einheit nutzbar ist', () => {
    for (let i = 1; i <= 120; i++) {
      const g0 = randomGrid(i, { mode: 'productive' });
      const g = {
        ...g0,
        settings: {
          ...g0.settings,
          overhead: { ...g0.settings.overhead, slewCenterS: 90, filterChangeS: 10, downloadS: 3 },
        },
      };
      const r = planGrid(g);
      const usable = new Map(r.matrix.rows.map((x) => [x.profile.unitId, x.usable]));
      for (let k = 1; k < r.blocks.length; k++) {
        const prev = r.blocks[k - 1] as WalkBlock;
        const cur = r.blocks[k] as WalkBlock;
        const first = Math.min(...cur.entries.map((e) => e.atS));
        expect(first, `${String(i)} ${cur.unitId}`).toBeGreaterThanOrEqual(prev.endS);
      }
      for (const b of r.blocks)
        for (const e of b.entries)
          if (e.cmd === 'expose' && !e.lastOfNight)
            expect(
              usable.get(b.unitId)?.[Math.floor(e.atS / 300)],
              `${String(i)} ${b.unitId}`,
            ).toBe(true);
    }
  });
});

describe('Keine Kurzbesuche (A-36, Entscheidung Sven 09.10.2026)', () => {
  // A belegt die Nacht, B hat dazwischen einen Slot: nach 60 s Slew passt eine 200-s-Belichtung, eine zweite nicht.
  const visit = (bPlanned: number, bSlots = 1) => {
    const g = grid(
      [
        unit('A', [[0, 9]], [line('A-L', 200, 40)]),
        unit('B', [[0, 9]], [line('B-L', 200, bPlanned)]),
      ],
      10,
    );
    const slots = [
      ...new Array<string>(4).fill('A'),
      ...new Array<string>(bSlots).fill('B'),
      ...new Array<string>(6 - bSlots).fill('A'),
    ];
    return {
      now: run(g, { slots, moveUp: false }),
      before: run(g, { slots, moveUp: false, shortVisits: true }),
    };
  };

  it('ein Besuch für nur eine Belichtung entfällt, die laufende Einheit behält die Zeit ohne zweiten Slew', () => {
    // Rig-Nacht 08./09.10.2026: IC 1795 ein B-Bild, NGC 7380 ein SII-Bild – jeweils mit Slew und Zentrieren.
    const { now, before } = visit(10);
    expect(exposures(before, 'B')).toBe(1);
    expect(slews(before, 'A')).toHaveLength(2);

    expect(exposures(now, 'B')).toBe(0);
    expect(blocksOf(now, 'B')).toHaveLength(0);
    expect(slews(now, 'A')).toHaveLength(1);
    expect(exposures(now, 'A')).toBeGreaterThan(exposures(before, 'A'));
  });

  it('Ausnahme: die eine Belichtung stellt die Einheit fertig', () => {
    const { now } = visit(1);
    expect(exposures(now, 'B')).toBe(1);
  });

  it('passen zwei Belichtungen, bleibt der Besuch', () => {
    const { now } = visit(10, 2);
    expect(exposures(now, 'B')).toBeGreaterThanOrEqual(2);
  });
});
