/** Zähler (FK 8.4), Fortschritt (FA-PRJ-12), Übergänge (FA-PRJ-11), Vollständigkeit, isDeliverable (TK 6.3). */
import { describe, expect, it } from 'vitest';
import {
  autoReactivate,
  autoReadyToProcess,
  canTransition,
  isDeliverable,
  lineCounters,
  missingForActivation,
  overshootPermille,
  projectProgress,
} from '../src';

const line = (planned: number, acquired = 0, rejected = 0, bonus = 0, bonusRejected = 0) => ({
  plannedCount: planned,
  acquiredCount: acquired,
  rejectedCount: rejected,
  bonusCount: bonus,
  bonusRejectedCount: bonusRejected,
});

describe('Zähler je Zeile (FK 8.4)', () => {
  it('Akzeptiert, Verbleibend, Planungsbedarf, % erledigt', () => {
    expect(lineCounters(line(60, 22, 2, 3), 10)).toEqual({
      planned: 60,
      acquired: 22,
      rejected: 2,
      accepted: 20,
      remaining: 40,
      planningNeed: 46, // 60 + ⌈60 · 10 %⌉ − 20
      bonus: 3,
      bonusRejected: 0,
      percentDone: (20 / 60) * 100,
    });
  });

  it('Planungsbedarf ganzzahlig: 100 × 7 % = 7 (Gleitkomma ergäbe ⌈7,000000000000001⌉ = 8)', () => {
    expect(Math.ceil(100 * (7 / 100))).toBe(8);
    expect(lineCounters(line(100), 7).planningNeed).toBe(107);
    expect(lineCounters(line(7), 12.5).planningNeed).toBe(8); // ⌈0,875⌉ = 1
    expect(lineCounters(line(3), 33.3).planningNeed).toBe(4); // 3 · 333 ‰ = 999 ‰ → 1
    expect(overshootPermille(12.5)).toBe(125);
  });

  it('Verworfen über Aufgenommen hinaus: Akzeptiert 0; Überschuss aufgenommen: Planungsbedarf 0', () => {
    expect(lineCounters(line(10, 2, 5), 0)).toMatchObject({ accepted: 0, remaining: 10 });
    expect(lineCounters(line(10, 11), 10)).toMatchObject({
      remaining: 0,
      planningNeed: 0,
      percentDone: 100,
    });
    expect(lineCounters(line(0), 10)).toMatchObject({ planningNeed: 0, percentDone: 0 });
  });
});

describe('Soll erreicht / fertig (FA-PRJ-12)', () => {
  it('Soll erreicht bei Verbleibend 0, fertig erst mit Überschuss; inaktive Zeilen zählen nicht', () => {
    const lines = [
      { ...line(10, 10), enabled: true },
      { ...line(5), enabled: false },
    ];
    expect(projectProgress(lines, 10)).toMatchObject({ targetReached: true, finished: false });
    expect(projectProgress([{ ...line(10, 11), enabled: true }], 10)).toMatchObject({
      targetReached: true,
      finished: true,
      planningNeed: 0,
    });
    expect(projectProgress([], 0)).toMatchObject({ targetReached: false, finished: false });
  });

  it('automatische Rückkehr nach Aktiv nur aus ready_to_process/completed und nur mit Einstellung', () => {
    expect(autoReactivate('ready_to_process', 3, true)).toBe('active');
    expect(autoReactivate('completed', 1, true)).toBe('active');
    expect(autoReactivate('ready_to_process', 3, false)).toBeNull();
    expect(autoReactivate('on_hold', 3, true)).toBeNull();
    expect(autoReactivate('completed', 0, true)).toBeNull();
  });

  it('automatisch Bereit zur Bearbeitung nur aus active, fertig, ohne Bonus, Deep-Sky und mit Einstellung', () => {
    const base = {
      status: 'active' as const,
      projectType: 'deep_sky',
      finished: true,
      bonusEnabled: false,
      autoReadyToProcess: true,
    };
    expect(autoReadyToProcess(base)).toBe('ready_to_process');
    expect(autoReadyToProcess({ ...base, autoReadyToProcess: false })).toBeNull();
    expect(autoReadyToProcess({ ...base, finished: false })).toBeNull();
    expect(autoReadyToProcess({ ...base, bonusEnabled: true })).toBeNull();
    expect(autoReadyToProcess({ ...base, projectType: 'exoplanet' })).toBeNull();
    expect(autoReadyToProcess({ ...base, status: 'on_hold' })).toBeNull();
    expect(autoReadyToProcess({ ...base, status: 'ready_to_process' })).toBeNull();
  });
});

describe('Status und Vollständigkeit', () => {
  it('Übergänge nach projectStatusTransitions', () => {
    expect(canTransition('planning', 'active')).toBe(true);
    expect(canTransition('active', 'ready_to_process')).toBe(true);
    expect(canTransition('archived', 'active')).toBe(true);
    expect(canTransition('planning', 'completed')).toBe(false);
    expect(canTransition('completed', 'on_hold')).toBe(false);
  });

  it('Aktivieren verlangt Name, Rig, Koordinaten, Zielname und eine aktive Zeile mit Plan', () => {
    expect(
      missingForActivation({
        name: 'X',
        rigId: null,
        raDeg: null,
        decDeg: 3,
        targetName: '',
        activeLinesWithPlan: 0,
      }),
    ).toEqual(['rigId', 'coordinates', 'targetName', 'lines']);
  });
});

describe('isDeliverable (TK 6.3)', () => {
  const base = {
    approvalStatus: 'approved',
    status: 'active',
    deletedAt: null,
    ninaDeliveryEnabled: true,
    bonusEnabled: false,
    startDate: null,
    projectType: 'deep_sky' as const,
    lines: [{ ...line(10, 3), enabled: true }],
    overshootPct: 0,
  };
  it('aktiv mit Planungsbedarf → ausliefern; gelöscht, pausiert, Rig aus oder vor Startdatum → nicht', () => {
    expect(isDeliverable(base, '2026-09-17')).toBe(true);
    expect(isDeliverable({ ...base, deletedAt: '2026-09-20T10:00:00Z' }, '2026-09-17')).toBe(false);
    expect(isDeliverable({ ...base, status: 'on_hold' }, '2026-09-17')).toBe(false);
    expect(isDeliverable({ ...base, ninaDeliveryEnabled: false }, '2026-09-17')).toBe(false);
    expect(isDeliverable({ ...base, startDate: '2026-09-18' }, '2026-09-17')).toBe(false);
    expect(isDeliverable({ ...base, startDate: '2026-09-17' }, '2026-09-17')).toBe(true);
  });
  it('fertige Zeilen nur mit Bonus; heute abgeschaltete Zeile zählt nicht', () => {
    const done = { ...base, lines: [{ ...line(10, 10), enabled: true }] };
    expect(isDeliverable(done, '2026-09-17')).toBe(false);
    expect(isDeliverable({ ...done, bonusEnabled: true }, '2026-09-17')).toBe(true);
    const off = {
      ...base,
      lines: [{ ...line(10), enabled: true, disabledForNight: '2026-09-17' }],
    };
    expect(isDeliverable(off, '2026-09-17')).toBe(false);
    expect(isDeliverable(off, '2026-09-18')).toBe(true);
  });
});
