/**
 * Sitzungsprotokoll und Klarnacht-Statistik (AP-30, FA-AUS-15…17): Schnappschuss als Mittel der dunklen
 * Stunden, NINA-Werte und Einheiten, Vorbelegung (NINA vor Vorhersage) mit Quellen, Quellen beim Speichern,
 * Schwelle „nutzbar“, Monatszeilen und Treffsicherheit.
 */
import { describe, expect, it } from 'vitest';
import type { ClearNightNight } from '../src/contracts/session-log';
import {
  clearNightMonths,
  EMPTY_SESSION_LOG,
  forecastAccuracy,
  forecastSnapshot,
  isUsableNight,
  logSuggestions,
  ninaStats,
  prefillSessionLog,
  sourcesOnSave,
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

describe('ninaStats', () => {
  it('rechnet Wind m/s in km/h und nimmt Ersatzschlüssel', () => {
    const s = ninaStats({
      sqm: { avg: 21.345, min: 21, max: 21.6 },
      temperatureC: { avg: 5, min: 4, max: 6 },
      windMs: { avg: 2, min: null, max: 5 },
      starFwhmArcsec: { avg: 2.26 },
      unknownKey: { avg: 1 },
    });
    expect(s).toEqual({
      sqm: { avg: 21.3, min: 21, max: 21.6 },
      temperatureC: { avg: 5, min: 4, max: 6 },
      humidityPct: null,
      windKmh: { avg: 7.2, min: null, max: 18 },
      seeingArcsec: { avg: 2.3, min: null, max: null },
    });
  });

  it('ist tolerant gegenüber fehlenden und kaputten Werten', () => {
    expect(ninaStats(null)).toEqual({
      sqm: null,
      temperatureC: null,
      humidityPct: null,
      windKmh: null,
      seeingArcsec: null,
    });
    expect(ninaStats({ sqm: 'x', humidityPct: { avg: 'y' } }).humidityPct).toBeNull();
  });
});

describe('prefillSessionLog / sourcesOnSave', () => {
  const forecast = forecastSnapshot({
    night: '2026-09-18',
    darkFromUtc: '2026-09-18T21:00:00Z',
    darkToUtc: '2026-09-18T23:00:00Z',
    hours: [hour('2026-09-18T21:00:00Z'), hour('2026-09-18T22:00:00Z', { cloudTotalPct: 30 })],
    ratingIndex: 2,
    nightMean: 0.5,
    moonIllumPct: 12.34,
    fetchedAtUtc: null,
  });
  const nina = ninaStats({ sqm: { avg: 20.8 }, ambientTempC: { avg: 6.5 } });

  it('NINA vor Vorhersage, Beginn/Ende und Mond automatisch, Seeing ohne NINA leer', () => {
    const p = prefillSessionLog({
      startedAt: '2026-09-18T20:00:00Z',
      endedAt: null,
      forecast,
      nina,
    });
    expect(p.values).toMatchObject({
      startTime: '2026-09-18T20:00:00Z',
      endTime: null,
      sqm: 20.8,
      temperatureC: 6.5,
      humidityPct: 80,
      windKmh: 12,
      transparencyPct: 70,
      cloudsNote: '20 %',
      moonIlluminationPct: 12.3,
      seeingArcsec: null,
    });
    expect(p.sources).toMatchObject({
      startTime: 'auto',
      endTime: null,
      sqm: 'nina',
      temperatureC: 'nina',
      humidityPct: 'forecast',
      cloudsNote: 'forecast',
      moonIlluminationPct: 'auto',
      seeingArcsec: null,
    });
  });

  it('ohne Schnappschuss und NINA nur Beginn', () => {
    const p = prefillSessionLog({
      startedAt: '2026-09-18T20:00:00Z',
      endedAt: '2026-09-19T03:00:00Z',
      forecast: null,
      nina: ninaStats(undefined),
    });
    expect(p.values).toEqual({
      ...EMPTY_SESSION_LOG,
      startTime: '2026-09-18T20:00:00Z',
      endTime: '2026-09-19T03:00:00Z',
    });
  });

  it('Vorhersage übernommen, obwohl NINA vorbelegt: Quelle Vorhersage', () => {
    const p = prefillSessionLog({
      startedAt: '2026-09-18T20:00:00Z',
      endedAt: null,
      forecast,
      nina,
    });
    const suggestions = logSuggestions(forecast, nina);
    expect(suggestions.temperatureC).toEqual([
      { value: 6.5, source: 'nina' },
      { value: 10, source: 'forecast' },
    ]);
    const sources = sourcesOnSave({ ...p.values, temperatureC: 10, sqm: 19 }, p, suggestions);
    expect(sources).toMatchObject({ temperatureC: 'forecast', sqm: 'manual' });
    // Gespeichert als manuell und unverändert: bleibt manuell.
    const again = sourcesOnSave(
      { ...p.values, sqm: 19 },
      { values: { ...p.values, sqm: 19 }, sources: { ...p.sources, sqm: 'manual' } },
      suggestions,
    );
    expect(again.sqm).toBe('manual');
  });

  it('übernommene Werte behalten die Quelle, geänderte werden manuell, leere null', () => {
    const p = prefillSessionLog({
      startedAt: '2026-09-18T20:00:00Z',
      endedAt: null,
      forecast,
      nina,
    });
    const sources = sourcesOnSave(
      {
        ...p.values,
        sqm: 20.84, // innerhalb der Rundung
        temperatureC: 4,
        humidityPct: null,
        seeingArcsec: 2.1,
        cloudsNote: 'Zirren ab 1 Uhr',
      },
      p,
    );
    expect(sources).toMatchObject({
      startTime: 'auto',
      sqm: 'nina',
      temperatureC: 'manual',
      humidityPct: null,
      seeingArcsec: 'manual',
      cloudsNote: 'manual',
      transparencyPct: 'forecast',
      moonIlluminationPct: 'auto',
    });
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
