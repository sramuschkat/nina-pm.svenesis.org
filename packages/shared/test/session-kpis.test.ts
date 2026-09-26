/**
 * Kennzahlen und Abweichungsgründe (AP-31; FA-AUS-04, FA-AUS-05, FA-AUS-09): nutzbare Dunkelzeit als
 * Schnitt aus Laufzeit und astronomischer Dunkelheit, Effizienz, Overhead-Aufteilung, Block- und
 * Filterwechsel, Plan-Treue gegen den ersten Plan, Gründe mit Anzahl und Dauer.
 */
import { describe, expect, it } from 'vitest';
import { sessionKpis, type KpiInput, type KpiLight } from '../src/session-kpis';

const light = (t: string, o: Partial<KpiLight> = {}): KpiLight => ({
  capturedAt: `2026-09-18T${t}:00Z`,
  exposureS: 300,
  result: 'saved',
  isBonus: false,
  assigned: true,
  filter: 'Ha',
  blockId: 'b1',
  ...o,
});

const base: KpiInput = {
  startedAt: '2026-09-18T20:00:00Z',
  endedAt: '2026-09-19T02:00:00Z', // 6 h Laufzeit
  darkness: { fromUtc: '2026-09-18T21:00:00Z', toUtc: '2026-09-19T04:00:00Z' }, // Schnitt 5 h
  planEntries: [
    { cmd: 'expose', atUtc: '2026-09-18T21:00:00Z', exposureS: 300 },
    { cmd: 'expose', atUtc: '2026-09-18T21:05:00Z', exposureS: 300 },
    { cmd: 'expose', atUtc: '2026-09-18T21:10:00Z', exposureS: 300 },
    { cmd: 'expose', atUtc: '2026-09-18T21:15:00Z', exposureS: 300 },
    // Transit-Serie 30 min à 120 s → 15 Frames.
    {
      cmd: 'expose_series',
      atUtc: '2026-09-18T23:00:00Z',
      untilUtc: '2026-09-18T23:30:00Z',
      exposureS: 120,
    },
  ],
  lights: [],
  events: [],
};

describe('sessionKpis', () => {
  it('Effizienz, Overhead, Wechsel und Plan-Treue', () => {
    const { kpis } = sessionKpis({
      ...base,
      lights: [
        light('21:00'),
        light('21:05', { filter: 'OIII' }),
        light('21:10', { filter: 'OIII', result: 'aborted' }),
        light('22:00', { filter: 'Ha', blockId: 'b2', exposureS: 330 }),
        light('22:05', { isBonus: true, blockId: 'b2' }),
        light('22:10', { assigned: false, blockId: 'b2' }),
      ],
      events: [
        { kind: 'af', occurredAt: '2026-09-18T20:30:00Z', durationS: 120 },
        { kind: 'flip', occurredAt: '2026-09-18T23:00:00Z', durationS: 180 },
        { kind: 'safety_pause', occurredAt: '2026-09-19T00:00:00Z', durationS: null },
        { kind: 'safety_resume', occurredAt: '2026-09-19T01:00:00Z', durationS: null },
      ],
    });
    // Gespeichert: 300 + 300 + 330 + 300 (Bonus) + 300 (ohne Zuordnung) = 1530 s.
    expect(kpis.exposureS).toBe(1530);
    expect(kpis.runtimeS).toBe(6 * 3600);
    expect(kpis.usableDarkS).toBe(5 * 3600);
    expect(kpis.efficiencyPct).toBe(8.5);
    expect(kpis.safetyPauseS).toBe(3600);
    // Basis = 6 h − 1 h Pause = 18000 s; Leerlauf 16470 s; davon AF 120, Flip 180.
    expect(kpis.overhead).toEqual({ autofocusS: 120, flipS: 180, otherS: 16170, pct: 91.5 });
    // Ohne `block_start`: Wechsel aus den Aufnahmen (b1 → b2); Filter Ha → OIII → Ha.
    expect(kpis.blockChanges).toBe(1);
    expect(kpis.filterChanges).toBe(2);
    // Plan: 4 + 15 Frames, 1200 + 1800 s; Ist: zugeordnet, gespeichert, ohne Bonus → 3 Frames, 930 s.
    expect(kpis.plan).toEqual({
      plannedFrames: 19,
      plannedExposureS: 3000,
      acquiredFrames: 3,
      acquiredExposureS: 930,
      framesPct: 15.8,
      timePct: 31,
    });
  });

  it('laufende Session: keine Laufzeit, keine Effizienz; ohne Plan keine Plan-Treue', () => {
    const { kpis } = sessionKpis({
      ...base,
      endedAt: null,
      planEntries: null,
      lights: [light('21:00')],
      events: [
        { kind: 'block_start', occurredAt: '2026-09-18T21:00:00Z', durationS: null },
        { kind: 'block_start', occurredAt: '2026-09-18T22:00:00Z', durationS: null },
        { kind: 'block_start', occurredAt: '2026-09-18T23:00:00Z', durationS: null },
      ],
    });
    expect(kpis).toMatchObject({
      runtimeS: null,
      usableDarkS: null,
      efficiencyPct: null,
      overhead: null,
      plan: null,
      blockChanges: 2,
    });
  });

  it('ohne astronomische Dunkelheit keine nutzbare Dunkelzeit', () => {
    const { kpis } = sessionKpis({ ...base, darkness: { fromUtc: null, toUtc: null } });
    expect(kpis.usableDarkS).toBeNull();
    expect(kpis.efficiencyPct).toBeNull();
  });

  it('Gründe: Anzahl und Dauer, offene Pause bis Sessionende, nach Dauer sortiert', () => {
    const { reasons } = sessionKpis({
      ...base,
      lights: [
        light('21:00', { result: 'aborted' }),
        light('21:10', { result: 'failed', exposureS: 60 }),
      ],
      events: [
        { kind: 'center_failed', occurredAt: '2026-09-18T20:10:00Z', durationS: null },
        { kind: 'block_skipped', occurredAt: '2026-09-18T20:11:00Z', durationS: null },
        { kind: 'af', occurredAt: '2026-09-18T20:30:00Z', durationS: null },
        { kind: 'transit_start', occurredAt: '2026-09-18T22:00:00Z', durationS: null },
        { kind: 'transit_end', occurredAt: '2026-09-18T23:30:00Z', durationS: null },
        { kind: 'skipped_timeaware', occurredAt: '2026-09-18T23:31:00Z', durationS: 300 },
        { kind: 'skipped_timeaware', occurredAt: '2026-09-18T23:36:00Z', durationS: 300 },
        { kind: 'error', occurredAt: '2026-09-18T23:40:00Z', durationS: null },
        { kind: 'lease_lost', occurredAt: '2026-09-18T23:41:00Z', durationS: null },
        // Offene Pause: zählt bis zum Sessionende 02:00 (30 min).
        { kind: 'safety_pause', occurredAt: '2026-09-19T01:30:00Z', durationS: null },
      ],
    });
    expect(reasons).toEqual([
      { reason: 'transit', count: 1, durationS: 5400 },
      { reason: 'safety_pause', count: 1, durationS: 1800 },
      { reason: 'skipped_timeaware', count: 2, durationS: 600 },
      { reason: 'exposure_aborted', count: 1, durationS: 300 },
      { reason: 'exposure_failed', count: 1, durationS: 60 },
      { reason: 'autofocus', count: 1, durationS: null },
      { reason: 'center_failed', count: 1, durationS: null },
      { reason: 'block_skipped', count: 1, durationS: null },
      { reason: 'device_error', count: 1, durationS: null },
      { reason: 'lease_lost', count: 1, durationS: null },
    ]);
  });
});
