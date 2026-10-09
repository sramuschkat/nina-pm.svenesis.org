/**
 * AP-71 „Block passt noch“ – ein Plan für Engine und Plugin: `docs/contracts/nina/plan.response.tight.example.json` ist
 * dieser Ablauf (SFRO-Overheads: Slew 90 s, Filter 10 s, Download 5 s, 180-s-Belichtungen) mit `t0` = 08:31:56Z. Der
 * Kern-Test `BlockFitsTests` spielt ihn im Plugin ab. Die Engine legt `endUtc` auf das Ende der letzten Aktion, und der
 * nächste Block rückt direkt dahinter (A-35): kein Spiel. Das Plugin darf darum einen Verzug bis 60 s mitnehmen
 * (`Playback.LateGraceMax`), statt den Block zu überspringen (Rig-Nacht 08./09.10.2026: 0,7 s → `elapsed`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildMatrix, setupFromGrid, walk, type GridInput, type GridUnit } from '../src';

const SLOTS = 10;
const T0 = Date.parse('2026-10-09T08:31:56Z') / 1000;
const iso = (s: number) => new Date((T0 + s) * 1000).toISOString().replace('.000Z', 'Z');

const unit = (id: string, planned: number): GridUnit => ({
  unitId: id,
  projectId: id,
  priority: 1,
  minTimeOnTargetH: 0.1,
  dueDate: null,
  peakAltDeg: 60,
  canImage: [[0, SLOTS - 1]],
  meridianAtS: null,
  transit: null,
  panels: [
    {
      index: 0,
      lines: [
        {
          id: `${id}-L`,
          filter: 'L',
          exposureS: 180,
          planned,
          accepted: 0,
          enabled: true,
          moonProfile: null,
          safe: [],
        },
      ],
    },
  ],
});

function tightWalk() {
  const g: GridInput = {
    mode: 'productive',
    slotS: 300,
    slots: SLOTS,
    startAtS: null,
    moonAltDeg: new Array<number>(SLOTS).fill(-10),
    moonProfiles: [],
    tonight: null,
    settings: {
      strategy: 'proportional',
      sortChain: ['lowest_peak_altitude', 'setting_soonest', 'most_remaining', 'constrained'],
      bonusEnabled: false,
      overshootPct: 0,
      mosaicPanelsIndependent: true,
      dither: { enabled: false, every: 3 },
      filterSwitch: { enabled: false, every: 10, tolerancePct: 50 },
      overhead: {
        slewCenterS: 90,
        filterChangeS: 10,
        ditherSettleS: 18,
        afEveryMin: 0,
        afDurationS: 0,
        downloadS: 5,
      },
      flip: { enabled: false, afterMin: 5, maxAfterMin: 15, pauseBeforeMin: 0, durationS: 240 },
    },
    // B stellt mit einer Belichtung fertig (Ausnahme von A-36), wie IC 1795 am Ende der Rig-Nacht.
    units: [unit('A', 40), unit('B', 1), unit('C', 40)],
  };
  const m = buildMatrix(setupFromGrid(g));
  const index = new Map(m.rows.map((r) => [r.profile.unitId, r.index]));
  ['A', 'A', 'B', 'C', 'C', 'C', null, null, null, null].forEach((u, s) => {
    m.assignment[s] = u === null ? -1 : (index.get(u) ?? -1);
  });
  const o = g.settings.overhead;
  return walk(m, {
    slewCenterS: o.slewCenterS,
    filterChangeS: o.filterChangeS,
    ditherSettleS: o.ditherSettleS,
    afEveryMin: 0,
    afDurationS: 0,
    downloadS: o.downloadS,
    ditherEnabled: false,
    ditherEvery: 3,
    filterSwitchEnabled: false,
    filterSwitchEvery: 10,
    tolerancePct: 50,
    bonusEnabled: false,
    rotator: false,
    darknessEndS: null,
    twilightEndS: () => null,
    lastAutofocusS: null,
    startAtS: null,
    initialCycle: new Map(),
    flip: g.settings.flip,
    meridian: () => [],
    upperMeridian: () => null,
    pierSide: () => null,
    flipDone: new Set(),
  });
}

interface FixtureEntry {
  seq: number;
  cmd: string;
  atUtc: string;
  durationS?: number;
  exposureS?: number;
}
const fixture = JSON.parse(
  readFileSync(
    new URL('../../../docs/contracts/nina/plan.response.tight.example.json', import.meta.url),
    'utf8',
  ),
) as { blocks: { startUtc: string; endUtc: string; entries: FixtureEntry[] }[] };

describe('Block passt noch (AP-71): gemeinsamer Plan für Engine und Plugin', () => {
  it('der Ablauf der Engine ist der Plan des Kern-Tests', () => {
    const walked = tightWalk().blocks.map((b) => ({
      startUtc: iso(b.startS),
      endUtc: iso(b.endS),
      entries: b.entries.map((e, i) => ({
        seq: i + 1,
        cmd: e.cmd,
        atUtc: iso(e.atS),
        ...('durationS' in e ? { durationS: e.durationS } : {}),
        ...(e.cmd === 'expose' ? { exposureS: e.exposureS } : {}),
      })),
    }));
    const expected = fixture.blocks.map((b) => ({
      startUtc: b.startUtc,
      endUtc: b.endUtc,
      entries: b.entries.map((e) => ({
        seq: e.seq,
        cmd: e.cmd,
        atUtc: e.atUtc,
        ...(e.durationS !== undefined ? { durationS: e.durationS } : {}),
        ...(e.cmd === 'expose' ? { exposureS: e.exposureS } : {}),
      })),
    }));
    expect(walked).toEqual(expected);
  });

  it('kein Spiel: endUtc = Ende der letzten Belichtung, der nächste Block beginnt dort', () => {
    const blocks = tightWalk().blocks;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (!b) continue;
      const last = b.entries.filter((e) => e.cmd === 'expose').at(-1);
      if (!last || last.cmd !== 'expose') throw new Error('Block ohne Belichtung');
      expect(b.endS).toBe(last.atS + last.exposureS + 5);
      const next = blocks[i + 1];
      if (next) expect(next.startS).toBe(b.endS);
    }
  });
});
