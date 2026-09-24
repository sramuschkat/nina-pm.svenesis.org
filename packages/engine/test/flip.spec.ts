/**
 * Meridian-Flip, Transit und Rotation (AP-13d; flip-rotation.md §1–§3, transit.md §3,
 * allocation.md §8, NT-25/26/27, L1, M8, NT-E4): Flip-Fälle im Block, außerhalb, passt nicht, aus,
 * Pause vor Meridian, im Transit (Lücke), im Vorlauf, untere Kulmination; Pierseitenwechsel;
 * Rotations-Grenzwerttabelle modulo 180°.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  planGrid,
  planNight,
  rotationDeltaDeg,
  rotationWithinTolerance,
  unixFromIso,
  type GridInput,
  type GridUnit,
  type PlanInput,
  type WalkEntry,
} from '../src';

const flip = (over: Partial<GridInput['settings']['flip']> = {}) => ({
  enabled: true,
  afterMin: 5,
  maxAfterMin: 15,
  pauseBeforeMin: 0,
  durationS: 240,
  ...over,
});

function unit(
  id: string,
  canImage: [number, number],
  meridianAtS: number | null,
  over: Partial<GridUnit> = {},
): GridUnit {
  return {
    unitId: id,
    projectId: id,
    priority: 1,
    minTimeOnTargetH: 0.5,
    dueDate: null,
    peakAltDeg: 60,
    canImage: [canImage],
    meridianAtS,
    transit: null,
    panels: [
      {
        index: 0,
        lines: [
          {
            id: `${id}-L`,
            filter: 'L',
            exposureS: 300,
            planned: 40,
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

function grid(units: GridUnit[], slots: number, flipSettings = flip(), slewCenterS = 0): GridInput {
  return {
    mode: 'productive',
    slotS: 300,
    slots,
    startAtS: null,
    moonAltDeg: new Array<number>(slots).fill(-10),
    settings: {
      strategy: 'proportional',
      sortChain: [],
      bonusEnabled: false,
      overshootPct: 0,
      mosaicPanelsIndependent: true,
      dither: { enabled: false, every: 1 },
      filterSwitch: { enabled: false, every: 10, tolerancePct: 50 },
      overhead: {
        slewCenterS,
        filterChangeS: 0,
        ditherSettleS: 0,
        afEveryMin: 0,
        afDurationS: 0,
        downloadS: 0,
      },
      flip: flipSettings,
    },
    moonProfiles: [],
    units,
    tonight: null,
  };
}

const compact = (entries: readonly WalkEntry[]) =>
  entries.map((e) => `${e.cmd}@${String(e.atS)}`).join(' ');

describe('Flip im regulären Block (flip-rotation.md §2)', () => {
  it('im Block: Beispiel Meridian 1800 s → Belichtungen bis 1800, Flip 2100, weiter ab 2340', () => {
    const r = planGrid(grid([unit('A', [0, 11], 1800)], 12));
    const [b] = r.blocks;
    expect(compact(b?.entries ?? [])).toBe(
      'slew_center@0 filter@0 expose@0 expose@300 expose@600 expose@900 expose@1200 expose@1500 expose@1800 ' +
        'meridian_flip@2100 slew_center@2340 expose@2340 expose@2640 expose@2940 expose@3240 end@3540',
    );
    expect(b?.meridianFlip).toEqual({
      waitStartS: null,
      plannedS: 2100,
      durationS: 240,
      inTransitWindow: false,
      planned: true,
      gapStartS: null,
      gapDurationS: null,
    });
  });

  it('außerhalb des Blocks → kein Flip, keine Metadaten', () => {
    const [b] = planGrid(grid([unit('A', [0, 11], 5000)], 12)).blocks;
    expect(b?.entries.some((e) => e.cmd === 'meridian_flip')).toBe(false);
    expect(b?.meridianFlip).toBeNull();
  });

  it('passt nicht: Flip käme nach dem Blockende → Block wartet bis zum Ende, kein Flip-Eintrag', () => {
    const [b] = planGrid(grid([unit('A', [0, 11], 3150)], 12, flip({ maxAfterMin: 5 }))).blocks;
    expect(compact(b?.entries ?? []).endsWith('expose@3000 wait@3300 end@3600')).toBe(true);
    expect(b?.meridianFlip).toMatchObject({ planned: false, waitStartS: 3300, plannedS: 3450 });
  });

  it('aus → kein Flip und kein Overhead', () => {
    const [b] = planGrid(grid([unit('A', [0, 11], 1800)], 12, flip({ enabled: false }))).blocks;
    expect(b?.entries.some((e) => e.cmd === 'meridian_flip' || e.cmd === 'wait')).toBe(false);
    expect(b?.meridianFlip).toBeNull();
  });

  it('Pause vor Meridian: warten ab der Belichtung, die über tM − Pause liefe, Flip bei tM + afterMin', () => {
    const [b] = planGrid(grid([unit('A', [0, 11], 1800)], 12, flip({ pauseBeforeMin: 10 }))).blocks;
    expect(compact(b?.entries ?? [])).toContain(
      'expose@900 wait@1200 meridian_flip@2100 slew_center@2340',
    );
    expect(b?.meridianFlip).toMatchObject({ waitStartS: 1200, planned: true });
  });

  it('nach dem Flip immer slew_center, auch mit Rotator (NT-E4)', () => {
    const [b] = planGrid(grid([unit('A', [0, 11], 1800)], 12), { rotator: true }).blocks;
    const cmds = b?.entries.map((e) => e.cmd) ?? [];
    expect(cmds[0]).toBe('slew_center_rotate');
    expect(cmds[cmds.indexOf('meridian_flip') + 1]).toBe('slew_center');
  });
});

describe('Pierseitenwechsel zwischen Blöcken (NT-27)', () => {
  it('Folgeblock auf der anderen Pierseite: Slew = slewCenterS + flipDurationS (330 s)', () => {
    // A hat den Meridian schon hinter sich (east), B steht noch östlich davon (west).
    const r = planGrid(grid([unit('A', [0, 11], 0), unit('B', [12, 23], 7200)], 24, flip(), 90));
    const b = r.blocks.find((x) => x.unitId === 'B');
    expect(b?.entries[0]).toMatchObject({ cmd: 'slew_center', durationS: 330 });
    const a = r.blocks.find((x) => x.unitId === 'A');
    expect(a?.entries[0]).toMatchObject({ durationS: 90 });
  });

  it('ohne Flip keine Pierseitenrechnung', () => {
    const r = planGrid(
      grid([unit('A', [0, 11], 0), unit('B', [12, 23], 7200)], 24, flip({ enabled: false }), 90),
    );
    expect(r.blocks.find((x) => x.unitId === 'B')?.entries[0]).toMatchObject({ durationS: 90 });
  });
});

describe('Transit und Flip (transit.md §3, NT-25, L1, M8)', () => {
  const transitUnit = (tm: number | null, windowS: [number, number]) =>
    unit('X', [0, 47], tm, { transit: { windowS, lineId: 'X-L', lockedAtS: 0 } });

  it('Flip im Vorlauf (tM + afterMin = Fensterbeginn − 60 s): Flip vor expose_series, planned', () => {
    const r = planGrid(grid([transitUnit(2640, [3000, 9000])], 48, flip(), 90));
    const [b] = r.blocks;
    expect(compact(b?.entries ?? [])).toBe(
      'slew_center@2850 meridian_flip@2940 slew_center@3180 expose_series@3270 end@9000',
    );
    expect(b?.meridianFlip).toMatchObject({
      planned: true,
      inTransitWindow: false,
      gapStartS: null,
    });
    expect(r.diagnostics).toContainEqual(
      expect.objectContaining({ unitId: 'X', reason: 'flip_in_transit' }),
    );
  });

  it('Flip im Fenster: kein Flip-Eintrag, Lücke ausgewiesen', () => {
    const r = planGrid(grid([transitUnit(5000, [3000, 9000])], 48, flip(), 90));
    const [b] = r.blocks;
    expect(b?.entries.some((e) => e.cmd === 'meridian_flip')).toBe(false);
    // Takt 300 s ab 3000: erste Grenze ≥ 5300 ist 5400; Lücke 240 + 90 s.
    expect(b?.meridianFlip).toEqual({
      waitStartS: null,
      plannedS: 5300,
      durationS: 240,
      inTransitWindow: true,
      planned: false,
      gapStartS: 5400,
      gapDurationS: 330,
    });
  });

  it('tM im Fenster, tM + afterMin danach → inTransitWindow, Lückenfelder null (M8)', () => {
    const [b] = planGrid(grid([transitUnit(8900, [3000, 9000])], 48, flip(), 90)).blocks;
    expect(b?.meridianFlip).toMatchObject({
      inTransitWindow: true,
      planned: false,
      gapStartS: null,
      gapDurationS: null,
    });
  });

  it('Transit-Vorlauf: der Slot vor dem Fenster bleibt frei für andere (Transit gesperrt)', () => {
    const other = unit('A', [0, 47], null);
    const r = planGrid(grid([transitUnit(null, [3000, 9000]), other], 48, flip(), 90));
    // Vorlauf [3000 − 150, 3000) schneidet Slot 9 → Slot 9 gehört dem Transit.
    expect(r.slotAssignment[9]).toBe('X');
    expect(r.slotAssignment[8]).toBe('A');
  });
});

describe('Beispielnacht (planNight, HAT-P-17 b, NT-25)', () => {
  const input: PlanInput = {
    mode: 'productive',
    night: '2026-09-17',
    site: { latitudeDeg: 31.5471, longitudeDeg: -99.3823, elevationM: 400 },
    tzdataVersion: '2026a',
    timeZoneTransitions: [
      { atUtc: '2025-11-02T07:00:00Z', utcOffsetMinutes: -360 },
      { atUtc: '2026-03-08T08:00:00Z', utcOffsetMinutes: -300 },
      { atUtc: '2026-11-01T07:00:00Z', utcOffsetMinutes: -360 },
    ],
    rig: {
      id: 'rig',
      hasRotator: true,
      defaultRotationDeg: null,
      rotationToleranceDeg: 5,
      hasFilterWheel: false,
    },
    scheduler: {
      strategy: 'proportional',
      sortChain: [],
      bonusEnabled: false,
      overshootPct: 0,
      mosaicPanelsIndependent: true,
      ditherEnabled: true,
      ditherEvery: 1,
      filterSwitchEnabled: false,
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
    projects: [
      {
        id: 'hat-p-17',
        raDeg: 324.5366,
        decDeg: 30.4886,
        rotationDeg: 0,
        priority: 1,
        minAltitudeDeg: 30,
        minTimeOnTargetH: 1,
        twilight: 'nautical',
        startDate: null,
        dueDate: null,
        panels: [
          {
            id: 'p9',
            index: 0,
            raDeg: 324.5366,
            decDeg: 30.4886,
            rotationDeg: 0,
            lines: [
              {
                id: 'l9',
                filter: 'R',
                ninaFilterName: 'R',
                exposureS: 60,
                planned: 310,
                accepted: 0,
                pending: 0,
                enabled: true,
                moonProfileId: null,
                gain: 100,
                offset: 20,
                binning: 1,
                readoutMode: 'High Gain Mode',
              },
            ],
          },
        ],
        transit: {
          observationId: 'o5',
          lineId: 'l9',
          windowStartUtc: '2026-09-18T02:08:00Z',
          windowEndUtc: '2026-09-18T07:34:00Z',
          lockedAtUtc: '2026-09-10T12:00:00Z',
        },
      },
    ],
    startAtUtc: null,
    tonight: null,
  };

  it('tM 04:28:23Z (scheinbare RA), Lücke ab 04:33:57Z für 330 s, 305 statt 310 Aufnahmen', () => {
    const plan = planNight(input);
    const [b] = plan.blocks;
    expect(b?.meridianFlip).toEqual({
      waitStartUtc: null,
      plannedUtc: '2026-09-18T04:33:23Z',
      durationS: 240,
      inTransitWindow: true,
      planned: false,
      gapStartUtc: '2026-09-18T04:33:57Z',
      gapDurationS: 330,
    });
    const d = plan.diagnostics.find((x) => x.reason === 'flip_in_transit');
    expect(d?.message).toContain('305 statt 310');
    expect(b?.entries[0]).toMatchObject({
      cmd: 'slew_center_rotate',
      atUtc: '2026-09-18T02:05:30Z',
    });
  });

  it('untere Kulmination als Flip-Kandidat, wenn die Höhe dort ≥ Mindesthöhe (NT-26)', () => {
    const base = input.projects[0];
    const basePanel = base?.panels[0];
    const baseLine = basePanel?.lines[0];
    if (!base || !basePanel || !baseLine) throw new Error('Fixture ohne Projekt/Panel/Zeile');
    // δ = 80°: untere Kulmination bei ≈ 21,5° Höhe; RA so, dass sie in der Nachtmitte liegt.
    const project = {
      ...base,
      id: 'polar',
      raDeg: 168,
      decDeg: 80,
      twilight: 'astronomical' as const,
      minAltitudeDeg: 20,
      transit: null,
      panels: [
        {
          ...basePanel,
          id: 'pp',
          raDeg: 168,
          decDeg: 80,
          lines: [{ ...baseLine, id: 'lp', exposureS: 300, planned: 200 }],
        },
      ],
    };
    const plan = planNight({ ...input, projects: [project as never] });
    const flips = plan.blocks.filter((x) => x.meridianFlip?.planned);
    expect(flips.length).toBe(1);
    const flipAt = unixFromIso(flips[0]?.meridianFlip?.plannedUtc ?? '');
    // Untere Kulmination liegt zwischen 05:00Z und 07:00Z.
    expect(flipAt).toBeGreaterThan(unixFromIso('2026-09-18T05:00:00Z'));
    expect(flipAt).toBeLessThan(unixFromIso('2026-09-18T07:00:00Z'));
  });
  it('gleiche Eingabe → gleicher outputHash (WS-24, zweimal gerechnet)', () => {
    expect(planNight(input).outputHash).toBe(planNight(input).outputHash);
  });
});

describe('Rotation modulo 180° (flip-rotation.md §3, Toleranz 5°)', () => {
  it.each([
    [90, 270, 0, true],
    [90, 95, 5, true],
    [90, 95.000001, 5.000001, false],
    [2, 178, 4, true],
    [0, 185, 5, true],
    [359, 3, 4, true],
    [0, 354.9, 5.1, false],
    [45, 230.000001, 5.000001, false],
  ])('Soll %s, Ist %s → Δ %s', (soll, ist, delta, ok) => {
    expect(rotationDeltaDeg(ist, soll)).toBeCloseTo(delta, 6);
    expect(rotationWithinTolerance(ist, soll, 5)).toBe(ok);
  });
});

describe('tM-Verfahren einheitlich (WS-24)', () => {
  const srcDir = new URL('../src/', import.meta.url);
  const files = (readdirSync(srcDir, { recursive: true }) as string[]).filter((f) =>
    f.endsWith('.ts'),
  );

  it('die Engine kennt nur die geschlossene Form, keine Newton-Iteration', () => {
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const text = readFileSync(new URL(f, srcDir), 'utf8');
      expect(text, f).not.toMatch(/newton/i);
    }
  });

  it('tM wird nur über meridianTransitUtc bestimmt (ein Aufrufer im Plan)', () => {
    const users = files.filter((f) =>
      /meridianTransitUtc\(/.test(readFileSync(new URL(f, srcDir), 'utf8')),
    );
    expect(users.sort()).toEqual(['astro/target.ts', 'plan/plan-night.ts']);
  });
});
