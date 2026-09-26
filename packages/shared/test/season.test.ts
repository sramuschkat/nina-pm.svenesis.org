/**
 * Saisondiagramm und Wochen-Sichtbarkeit (AP-24, FA-SIC-02/04, S-33): Balken je Nacht bzw. Woche,
 * Saisonbeginn/-ende aus `seasonWindow`, Mondanteil, zirkumpolar, außerhalb der Saison, vier Wochen.
 */
import { daysFromKey, keyFromDays } from '@nina-pm/engine';
import { describe, expect, it } from 'vitest';
import {
  seasonBars,
  seasonChartData,
  visibilityWeeks,
  type SeasonTargetInput,
} from '../src/season';

/** Nacht-Tabelle Hannover (MEZ/MESZ) ab `from`, 400 Nächte. */
const table = (from: string) => ({
  currentNight: from,
  tzdataVersion: '2026a',
  timeZoneTransitions: [
    { atUtc: '2025-10-26T01:00:00Z', utcOffsetMinutes: 60 },
    { atUtc: '2026-03-29T01:00:00Z', utcOffsetMinutes: 120 },
    { atUtc: '2026-10-25T01:00:00Z', utcOffsetMinutes: 60 },
    { atUtc: '2027-03-28T01:00:00Z', utcOffsetMinutes: 120 },
    { atUtc: '2027-10-31T01:00:00Z', utcOffsetMinutes: 60 },
  ],
  nights: Array.from({ length: 400 }, (_, i) => {
    const night = keyFromDays(daysFromKey(from) + i);
    return {
      night,
      noonStartUtc: `${night}T10:00:00Z`,
      noonEndUtc: `${keyFromDays(daysFromKey(night) + 1)}T10:00:00Z`,
      nightWindowEndUtc: `${keyFromDays(daysFromKey(night) + 1)}T05:00:00Z`,
    };
  }),
});

const input = (
  from: string,
  target: { raDeg: number; decDeg: number },
  minTimeOnTargetH = 1,
): SeasonTargetInput => ({
  site: { latitudeDeg: 52.37, longitudeDeg: 9.73 },
  nights: table(from),
  target,
  conditions: { minAltitudeDeg: 30, minTimeOnTargetH, twilight: 'astronomical' },
});

const M31 = { raDeg: 10.68, decDeg: 41.27 };
const ORION = { raDeg: 83.82, decDeg: -5.39 };
const POLARIS = { raDeg: 37.95, decDeg: 89.26 };

// Ein Jahr Nächte je Test (Sonne, Mond, Ziel je 5 min): lokal rund 1 s, auf ausgelasteten CI-Runnern bis
// fünfmal langsamer – eigenes Zeitlimit statt der 5 s Standard.
describe('seasonChartData (FA-SIC-02)', { timeout: 20_000 }, () => {
  it('Balken je Nacht (1 Monat) bzw. je Woche; heute; Mondanteil 0–100', () => {
    const m = seasonChartData(input('2026-09-26', M31), '1m');
    expect(m.months).toHaveLength(30);
    expect(m.months[0]?.month).toBe('2026-09-26');
    expect(m.months.every((b) => b.nights === 1)).toBe(true);
    expect(m.today).toBe('2026-09-26');
    expect(m.status).toBe('in_season');
    for (const b of m.months) {
      expect(b.moonPct).toBeGreaterThanOrEqual(0);
      expect(b.moonPct).toBeLessThanOrEqual(100);
    }
    // Vollmond 26.09.2026: M31 im Herbst mit viel Mond, zwei Wochen später kaum.
    expect(m.months[0]?.moonPct).toBeGreaterThan(50);
    expect(m.months[14]?.moonPct).toBeLessThan(m.months[0]?.moonPct ?? 0);
    expect(m.months[0]?.usableHours).toBeGreaterThan(6);
    expect(m.months[0]?.peakAltDeg).toBeGreaterThan(75);
    const y = seasonChartData(input('2026-09-26', M31), '1y');
    expect(y.months).toHaveLength(52);
    expect(y.months.every((b) => b.nights === 7)).toBe(true);
    expect(seasonChartData(input('2026-09-26', M31), '3m').months).toHaveLength(13);
  });

  it('Saisonende mit nutzbaren Stunden bis dahin (FA-SIC-04)', () => {
    const m = seasonChartData(input('2026-09-26', M31, 3), '1y');
    expect(m.seasonEnd).not.toBeNull();
    expect((m.seasonEnd ?? '') > '2027-01-01').toBe(true);
    expect(m.usableHoursToSeasonEnd).toBeGreaterThan(300);
    expect(m.minTimeH).toBe(3);
  });

  // Hannover 52,37° N: tiefste Sonnenhöhe zur Sonnenwende −(90 − 52,37 − 23,44) = −14,2° – die astronomische
  // Dunkelheit (−18°) fehlt im Hochsommer, die nautische (−12°) wird ganzjährig erreicht (≈ 2,8 h).
  // „Saison“ = Aufnahmezeit nach der Dämmerungsgrenze des Projekts, nicht Sichtbarkeit mit bloßem Auge.
  it('zirkumpolar: kein Saisonende mit nautischer Grenze', () => {
    const base = input('2026-09-26', POLARIS);
    const m = seasonChartData(
      { ...base, conditions: { ...base.conditions, twilight: 'nautical' } },
      '6m',
    );
    expect(m.status).toBe('in_season');
    expect(m.seasonEnd).toBeNull();
    // Mit astronomischer Grenze endet die Saison im Mai (keine Dunkelheit bis Ende Juli).
    expect(seasonChartData(base, '6m').seasonEnd).toMatch(/^2027-05-/);
  });

  it('außerhalb der Saison: Saisonbeginn später, Balken davor nicht nutzbar', () => {
    const m = seasonChartData(input('2026-06-01', ORION), '6m');
    expect(m.status).toBe('out_of_season');
    expect(m.seasonStart).not.toBeNull();
    expect((m.seasonStart ?? '') > '2026-08-01').toBe(true);
    expect(m.months[0]?.usable).toBe(false);
    expect(m.months[0]?.peakAltDeg ?? null).toBeNull();
  });
});

describe('visibilityWeeks (S-33)', () => {
  it('vier Wochen, je Woche nutzbare Stunden je Nacht', () => {
    const w = visibilityWeeks(input('2026-09-26', M31));
    expect(w).toHaveLength(4);
    expect(w.map((b) => b.month)).toEqual(['2026-09-26', '2026-10-03', '2026-10-10', '2026-10-17']);
    expect(w.every((b) => b.usable)).toBe(true);
    // ohne Mondrechnung
    expect(w.every((b) => b.moonPct === 0)).toBe(true);
    const never = visibilityWeeks(input('2026-09-26', { raDeg: 0, decDeg: -80 }));
    expect(never.every((b) => !b.usable && b.usableHours === 0)).toBe(true);
  });
});

describe('seasonBars', () => {
  it('Mittel je Nacht, Mondanteil der nutzbaren Zeit, höchste Höhe', () => {
    const n = (usableSec: number, moonUpSec: number, peak: number | null, sufficient: boolean) => ({
      night: '2026-01-01',
      usableSec,
      longestRunSec: usableSec,
      sufficient,
      peakAltDeg: peak,
      moonUpSec,
    });
    const [b] = seasonBars(
      [n(3600, 1800, 40, true), n(7200, 0, 55, false), n(0, 0, null, false)],
      7,
    );
    expect(b).toEqual({
      month: '2026-01-01',
      nights: 3,
      usableHours: 1,
      moonPct: (100 * 1800) / 10800,
      usable: true,
      peakAltDeg: 55,
    });
  });
});
