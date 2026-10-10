/**
 * Wetter-Schnappschuss und Klarnacht-Statistik (AP-30, FA-AUS-16/17): Schnappschuss als Mittel der dunklen
 * Stunden, Schwelle „nutzbar“, Monatszeilen und Treffsicherheit.
 */
import { describe, expect, it } from 'vitest';
import type { ClearNightNight } from '../src/contracts/session-log';
import {
  clearNightMonths,
  forecastAccuracy,
  forecastSnapshot,
  isUsableNight,
  type ForecastHour,
} from '../src/session-log';

const hour = (tUtc: string, o: Partial<ForecastHour> = {}): ForecastHour => ({
  tUtc,
  cloudTotalPct: 10,
  transparencyScore: 0.7,
  seeingScore: 0.5,
  tempC: 10,
  humidityPct: 80,
  wind10Kmh: 12,
  ...o,
});

describe('forecastSnapshot', () => {
  const base = {
    night: '2026-09-18',
    darkFromUtc: '2026-09-18T20:30:00Z',
    darkToUtc: '2026-09-19T02:00:00Z',
    ratingIndex: 3,
    nightMean: 0.71,
    moonIllumPct: 40,
    fetchedAtUtc: '2026-09-18T12:00:00Z',
  };

  it('mittelt nur die Stunden, die das dunkle Fenster überlappen', () => {
    const hours = [
      hour('2026-09-18T19:00:00Z', { cloudTotalPct: 100, tempC: 30 }), // vor dem Fenster
      hour('2026-09-18T20:00:00Z', { cloudTotalPct: 20, tempC: 12 }), // überlappt 20:30–21:00
      hour('2026-09-18T21:00:00Z', { cloudTotalPct: 0, tempC: 8, transparencyScore: 0.9 }),
      hour('2026-09-19T01:00:00Z', { cloudTotalPct: 10, tempC: 7, transparencyScore: null }),
      hour('2026-09-19T02:00:00Z', { cloudTotalPct: 100, tempC: 0 }), // ab Fensterende
    ];
    const snap = forecastSnapshot({ ...base, hours });
    expect(snap).toEqual({
      night: '2026-09-18',
      fetchedAtUtc: '2026-09-18T12:00:00Z',
      hours: 3,
      cloudPct: 10,
      transparencyPct: 80,
      seeingScore: 0.5,
      temperatureC: 9,
      humidityPct: 80,
      windKmh: 12,
      ratingIndex: 3,
      nightMean: 0.71,
      moonIllumPct: 40,
    });
  });

  it('ohne dunkles Fenster oder ohne Stunden darin null', () => {
    expect(
      forecastSnapshot({ ...base, darkFromUtc: null, hours: [hour(base.darkToUtc)] }),
    ).toBeNull();
    expect(forecastSnapshot({ ...base, hours: [hour('2026-09-17T22:00:00Z')] })).toBeNull();
  });
});

const night = (n: Partial<ClearNightNight> & { night: string }): ClearNightNight => ({
  source: null,
  usable: null,
  usableHours: null,
  sessionIds: [],
  forecastRatingIndex: null,
  forecastNightMean: null,
  seeingArcsec: null,
  sqm: null,
  transparencyPct: null,
  forecastTransparencyPct: null,
  rejectedPct: null,
  ...n,
});

describe('Klarnacht-Statistik', () => {
  it('nutzbar ab genau 1 h', () => {
    expect(isUsableNight(0.99)).toBe(false);
    expect(isUsableNight(1)).toBe(true);
    expect(isUsableNight(6.5)).toBe(true);
  });

  it('Monatszeilen zählen nur erfasste Nächte; Mittel über nutzbare', () => {
    const months = clearNightMonths([
      night({ night: '2026-10-02', source: 'session', usable: true, usableHours: 4 }),
      night({ night: '2026-09-30', source: 'session', usable: true, usableHours: 2.5 }),
      night({ night: '2026-09-29', source: 'session', usable: true, usableHours: 5.5 }),
      night({ night: '2026-09-28', source: 'manual', usable: false, usableHours: 0 }),
      night({ night: '2026-09-27', source: 'session', usable: false, usableHours: 0.4 }),
      night({ night: '2026-09-26' }),
    ]);
    expect(months).toEqual([
      { month: '2026-09', recorded: 4, usable: 2, usablePct: 50, meanUsableHours: 4 },
      { month: '2026-10', recorded: 1, usable: 1, usablePct: 100, meanUsableHours: 4 },
    ]);
    expect(clearNightMonths([night({ night: '2026-09-01' })])).toEqual([]);
  });

  it('Treffsicherheit: nur Session-Nächte mit Vorhersage, Grenze Gut (3)', () => {
    const acc = forecastAccuracy([
      night({ night: 'a', source: 'session', usable: true, forecastRatingIndex: 3 }), // Treffer
      night({ night: 'b', source: 'session', usable: false, forecastRatingIndex: 1 }), // Treffer
      night({ night: 'c', source: 'session', usable: false, forecastRatingIndex: 4 }), // daneben
      night({ night: 'd', source: 'session', usable: true, forecastRatingIndex: 2 }), // daneben
      night({ night: 'e', source: 'session', usable: true, forecastRatingIndex: null }), // ohne
      night({ night: 'f', source: 'manual', usable: false, forecastRatingIndex: 0 }), // manuell
    ]);
    expect(acc).toEqual({ compared: 4, hits: 2, hitPct: 50 });
    expect(forecastAccuracy([])).toEqual({ compared: 0, hits: 0, hitPct: null });
  });
});
