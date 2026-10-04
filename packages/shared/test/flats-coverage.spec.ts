import { describe, expect, it } from 'vitest';
import { flatCoverage, flatToleranceDg, type FlatRecordData } from '../src/flats-coverage';

const rec = (over: Partial<FlatRecordData> = {}): FlatRecordData => ({
  filterShortName: 'Ha',
  rotatorMechDg: 900,
  gain: 100,
  offset: 10,
  binning: 1,
  readoutModeIndex: 0,
  lastUtc: '2026-10-01T12:00:00Z',
  count: 20,
  ...over,
});
const key = {
  filterShortName: 'Ha',
  rotatorMechDg: 905,
  gain: 100,
  offset: 10,
  binning: 1,
  readoutModeIndex: 0,
};
const once = { mode: 'once_per_project' as const, intervalDays: 7, rotationToleranceDeg: 5 };
const timed = { ...once, mode: 'time_based' as const };

describe('Auto-Flats je Projekt (AP-50b)', () => {
  it('Toleranz wie die Kombinationsbildung: max(1°, Toleranz/2)', () => {
    expect(flatToleranceDg(5)).toBe(25);
    expect(flatToleranceDg(0.5)).toBe(10);
  });

  it('einmal je Projekt: passende Flats genügen, Winkel innerhalb der Toleranz', () => {
    expect(flatCoverage([rec()], key, once, '2026-12-01T00:00:00Z')).toEqual({
      covered: true,
      lastUtc: '2026-10-01T12:00:00Z',
      count: 20,
    });
    expect(
      flatCoverage([rec({ rotatorMechDg: 931 })], key, once, '2026-10-02T00:00:00Z').covered,
    ).toBe(false);
    expect(
      flatCoverage(
        [rec({ rotatorMechDg: 3595 })],
        { ...key, rotatorMechDg: 10 },
        once,
        '2026-10-02T00:00:00Z',
      ).covered,
    ).toBe(true);
  });

  it('Kamera-Schlüssel muss genau passen (Binning, Gain, Auslesemodus)', () => {
    for (const other of [
      { binning: 2 },
      { gain: -1 },
      { offset: 0 },
      { readoutModeIndex: 1 },
      { filterShortName: 'OIII' },
    ])
      expect(flatCoverage([rec(other)], key, once, '2026-10-02T00:00:00Z').covered).toBe(false);
  });

  it('zeitbasiert: jünger als N Tage gilt, genau N Tage alt nicht mehr; die neuesten zählen', () => {
    expect(flatCoverage([rec()], key, timed, '2026-10-08T11:59:59Z').covered).toBe(true);
    expect(flatCoverage([rec()], key, timed, '2026-10-08T12:00:00Z').covered).toBe(false);
    const both = [rec({ lastUtc: '2026-09-01T12:00:00Z', count: 5 }), rec()];
    expect(flatCoverage(both, key, timed, '2026-10-05T00:00:00Z')).toEqual({
      covered: true,
      lastUtc: '2026-10-01T12:00:00Z',
      count: 25,
    });
  });

  it('ohne Winkel (Zeile ohne Lights) zählt jeder Winkel; aus = nie gültig', () => {
    expect(
      flatCoverage(
        [rec({ rotatorMechDg: 2700 })],
        { ...key, rotatorMechDg: null },
        once,
        '2026-10-02T00:00:00Z',
      ).covered,
    ).toBe(true);
    expect(
      flatCoverage([rec()], key, { ...once, mode: 'off' }, '2026-10-02T00:00:00Z').covered,
    ).toBe(false);
  });
});
