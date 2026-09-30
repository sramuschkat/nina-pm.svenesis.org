/**
 * Regeln der Transit-Beobachtungen (transit.md §8): Konflikte auf dem Rig (FA-EXO-33), Frist (FA-FRG-09) und
 * Richtwert *Geplant* (FA-EXO-20).
 */
import { describe, expect, it } from 'vitest';
import {
  sameTransitLine,
  transitConflict,
  transitDeadlineMs,
  transitPlannedFrames,
  type RigObservation,
  type TransitLine,
} from '../src';

const H = 3_600_000;
const line: TransitLine = {
  filterId: 'r',
  exposureS: 60,
  gain: 100,
  offsetAdu: 20,
  binning: 1,
  readoutMode: null,
};
const obs = (over: Partial<RigObservation>): RigObservation => ({
  id: 'o1',
  projectId: 'p1',
  projectName: 'HAT-P-17b',
  createdBy: null,
  createdByName: 'Bea',
  planet: 'HAT-P-17b',
  epoch: 402,
  windowStartMs: 0,
  windowEndMs: 5 * H,
  status: 'locked',
  orderMs: 0,
  primaryObservationId: null,
  line,
  ...over,
});
const cand = {
  projectId: 'p2',
  planet: 'HAT-P-17 b',
  epoch: 402,
  windowStartMs: H,
  windowEndMs: 6 * H,
  line,
};

describe('transitConflict (FA-EXO-33)', () => {
  it('frei ohne Überlappung', () => {
    expect(transitConflict(cand, [obs({ windowStartMs: 6 * H, windowEndMs: 8 * H })])).toBeNull();
  });

  it('dasselbe Ereignis mit gleicher Zeile → verknüpfen mit der früheren Festlegung', () => {
    const early = obs({ id: 'early', orderMs: 1 });
    const later = obs({ id: 'later', orderMs: 2, primaryObservationId: 'early', projectId: 'p3' });
    expect(transitConflict(cand, [later, early])).toEqual({ kind: 'share', primary: early });
  });

  it('dasselbe Ereignis mit anderer Zeile → share_mismatch', () => {
    const c = transitConflict({ ...cand, line: { ...line, exposureS: 90 } }, [obs({})]);
    expect(c?.kind).toBe('share_mismatch');
  });

  it('anderes Ereignis im Fenster → overlap, auch im eigenen Projekt', () => {
    expect(transitConflict(cand, [obs({ planet: 'WASP-12b', epoch: 7 })])?.kind).toBe('overlap');
    expect(transitConflict(cand, [obs({ projectId: 'p2', epoch: 401 })])?.kind).toBe('overlap');
  });

  it('Überlappung schlägt Verknüpfung', () => {
    const c = transitConflict(cand, [obs({}), obs({ id: 'x', planet: 'WASP-12b', epoch: 1 })]);
    expect(c).toMatchObject({ kind: 'overlap', with: { id: 'x' } });
  });

  it('Zeilenvergleich: Auslesemodus null = null, fehlende Zeile nie gleich', () => {
    expect(sameTransitLine(line, { ...line })).toBe(true);
    expect(sameTransitLine(line, null)).toBe(false);
  });
});

describe('Frist und Richtwert', () => {
  it('Frist = Fensterbeginn − (Slew/Zentrieren + 60 s) − 15 min (FA-FRG-09)', () => {
    expect(transitDeadlineMs(10 * H, 120)).toBe(10 * H - 180_000 - 900_000);
  });

  it('Geplant = ⌊Fenster / (Belichtung + Download)⌋ (FA-EXO-20)', () => {
    expect(transitPlannedFrames(0, 5 * H, 60, 3)).toBe(Math.floor(18000 / 63));
    expect(transitPlannedFrames(0, H, 0, 0)).toBe(0);
  });
});
