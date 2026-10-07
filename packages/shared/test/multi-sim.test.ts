/**
 * Mehrnacht-Simulation und Auswirkungsvorschau (AP-32a; FA-SIM-04, FA-FRG-05): Restbedarf wird fortgeschrieben
 * (nie mehr als der Bedarf), alle Projekte konkurrieren in jeder Nacht, Wettergewichtung nach FK 8.5,
 * Vergleich mit/ohne Objekt.
 */
import { daysFromKey, keyFromDays } from '@nina-pm/engine';
import { describe, expect, it } from 'vitest';
import {
  impactComparison,
  MultiSimResult,
  simulateNights,
  weatherWeight,
  type SimulateNightsInput,
} from '../src';
import { moonProfiles, NGC281, NGC7000, nights, projects, rig, STARFRONT } from './fixtures/plan';

const FROM = '2026-09-17';
const table = {
  ...nights,
  currentNight: FROM,
  nights: Array.from({ length: 16 }, (_, i) => {
    const night = keyFromDays(daysFromKey(FROM) + i);
    return {
      night,
      noonStartUtc: `${night}T17:00:00Z`,
      noonEndUtc: `${keyFromDays(daysFromKey(night) + 1)}T17:00:00Z`,
      nightWindowEndUtc: `${keyFromDays(daysFromKey(night) + 1)}T13:00:00Z`,
    };
  }),
};
const planned = projects.filter((p) => p.panels.length > 0);
const base: SimulateNightsInput = {
  rig,
  projects: planned,
  moonProfiles,
  nightsTable: table,
  site: STARFRONT,
  nightFrom: FROM,
  count: 7,
};

describe('weatherWeight', () => {
  it('Klassengrenzen 65 % und 45 %; ohne Bewertung 1', () => {
    expect([0.9, 0.65, 0.64, 0.45, 0.44, 0].map(weatherWeight)).toEqual([1, 1, 0.5, 0.5, 0.1, 0.1]);
    expect(weatherWeight(null)).toBe(1);
  });
});

describe('simulateNights', () => {
  it('Exoplanet nur in der Nacht seines festgelegten Transits, als Transitblock (07.10.2026)', () => {
    // Vorher plante die Prognose ein Exoplaneten-Projekt wie Deep-Sky über alle Nächte – oder gar nicht.
    const exo = planned.map((p) =>
      p.id === NGC281 ? { ...p, projectType: 'exoplanet' as const } : p,
    );
    const line = exo.find((p) => p.id === NGC281)?.panels[0]?.lines[0];
    if (!line) throw new Error('Fixture ohne Zeile');
    const without = simulateNights({ ...base, projects: exo });
    expect(without.detail.every((d) => (d.lineFrames[line.id] ?? 0) === 0)).toBe(true);

    const transit = {
      night: '2026-09-19',
      projectId: NGC281,
      observationId: '0190c3f4-0000-7000-8000-0000000000e2',
      lineId: line.id,
      windowStartUtc: '2026-09-20T04:00:00Z',
      windowEndUtc: '2026-09-20T05:00:00Z',
      lockedAtUtc: '2026-09-17T12:00:00Z',
    };
    const withTransit = simulateNights({ ...base, projects: exo, transits: [transit] });
    const frames = withTransit.detail.map((d) => d.lineFrames[line.id] ?? 0);
    expect(frames[2]).toBeGreaterThan(0); // Nacht 19./20.09.
    expect(frames.filter((_, i) => i !== 2).every((n) => n === 0)).toBe(true);
    // Deep-Sky-Projekt plant wie bisher weiter.
    expect(withTransit.detail.some((d) => Object.keys(d.projectHours).includes(NGC7000))).toBe(
      true,
    );
  });

  it('schreibt den Restbedarf fort: NGC 281 (17 Ha offen) nie mehr als der Bedarf', () => {
    const r = simulateNights(base);
    expect(r.nights.map((n) => n.night)).toEqual([
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
    ]);
    const ngc = r.projects.find((p) => p.projectId === NGC281);
    expect(ngc?.needFrames).toBe(17);
    expect(ngc?.simulatedFrames).toBeLessThanOrEqual(17);
    // Frames je Nacht summieren sich zu den simulierten Frames.
    const nightly = r.nights.reduce(
      (s, n) => s + (n.projects.find((p) => p.projectId === NGC281)?.frames ?? 0),
      0,
    );
    expect(nightly).toBeGreaterThanOrEqual(ngc?.simulatedFrames ?? 0);
    if (ngc?.completesNight) {
      // Nach der Fertigstellung bekommt das Projekt keine Zeit mehr.
      const after = r.nights.filter((n) => n.night > (ngc.completesNight as string));
      expect(after.every((n) => !n.projects.some((p) => p.projectId === NGC281))).toBe(true);
    }
    // Ergebnisform passt zum Vertrag.
    const view = {
      kind: 'multi_sim',
      rigId: rig.id,
      rigName: rig.name,
      siteTimeZone: 'America/Chicago',
      nightFrom: FROM,
      nightCount: 7,
      weather: false,
      computedAt: '2026-09-17T18:00:00Z',
      ...r,
    };
    expect(MultiSimResult.safeParse(view).error?.issues ?? []).toEqual([]);
  });

  it('Anteile summieren sich auf 100 %; beide Projekte erscheinen', () => {
    const r = simulateNights(base);
    const withHours = r.projects.filter((p) => p.hours > 0);
    expect(withHours.length).toBeGreaterThan(0);
    const share = withHours.reduce((s, p) => s + p.sharePct, 0);
    expect(share).toBeGreaterThan(99.5);
    expect(share).toBeLessThan(100.5);
    expect(r.projects.map((p) => p.projectId).sort()).toEqual([NGC281, NGC7000].sort());
  });

  it('Wettergewichtung: halbe Klar-Wahrscheinlichkeit halbiert die Frames der Nacht', () => {
    const one = { ...base, count: 1 };
    const clear = simulateNights(one);
    const half = simulateNights({
      ...one,
      weather: new Map([[FROM, { nightMean: 0.5, ratingIndex: 2 }]]),
    });
    expect(half.nights[0]).toMatchObject({ weight: 0.5, ratingIndex: 2, hasForecast: true });
    const f = (r: typeof clear) =>
      r.projects.find((p) => p.projectId === NGC281)?.simulatedFrames ?? 0;
    expect(f(half)).toBeCloseTo(f(clear) / 2, 1);
    // Nacht ohne Vorhersage: ungewichtet, gekennzeichnet.
    const none = simulateNights({ ...one, weather: new Map() });
    expect(none.nights[0]).toMatchObject({ weight: 1, hasForecast: false, ratingIndex: null });
  });

  it('Auswirkungsvorschau: Objekt erhält Zeit, die anderen stehen mit/ohne daneben', () => {
    const without = simulateNights({ ...base, projects: planned.filter((p) => p.id !== NGC7000) });
    const withTarget = simulateNights(base);
    const cmp = impactComparison(without, withTarget, NGC7000);
    expect(cmp.target?.projectId).toBe(NGC7000);
    const other = cmp.shifts.find((s) => s.projectId === NGC281);
    expect(other).toBeDefined();
    expect(other?.framesWith ?? 0).toBeLessThanOrEqual(17);
    expect(other?.framesWithout).toBe(17);
    expect(cmp.hoursWith).toBeGreaterThanOrEqual(cmp.hoursWithout);
    expect(cmp.shifts.some((s) => s.projectId === NGC7000)).toBe(false);
  });
});
