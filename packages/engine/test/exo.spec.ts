/**
 * Katalog-Epochen und Tiefen (AP-40, transit.md §1): Referenz gegen astropy (`tools/reference/gen_exo_epochs.py`,
 * de432s) und die Kontrollwerte der Spec.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  depthMmag,
  geometricDepthMmag,
  normalizeEpoch,
  sunBarycentricDelayS,
  taiMinusUtc,
  tdbMinusUtc,
  transitDurationH,
  LEAP_TABLE_VALID_UNTIL_JD,
} from '../src';

interface EpochCase {
  id: string;
  jd: number;
  raDeg: number;
  decDeg: number;
  taiMinusUtcS: number;
  tdbMinusUtcS: number;
  sunDelayS: number;
  bjdTdbFromBjdUtc: number;
  bjdTdbFromHjdUtc: number;
}

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/exo_epochs.json', import.meta.url)), 'utf8'),
) as { cases: EpochCase[] };

const DAY_S = 86400;

describe('Epochen gegen astropy (TAI−UTC exakt, TDB−UTC ±1 ms, Sonnenversatz ±20 ms)', () => {
  it('enthält Fälle', () => expect(fixture.cases.length).toBeGreaterThan(50));

  for (const c of fixture.cases) {
    it(c.id, () => {
      expect(taiMinusUtc(c.jd).seconds).toBe(c.taiMinusUtcS);
      expect(Math.abs(tdbMinusUtc(c.jd).seconds - c.tdbMinusUtcS)).toBeLessThan(0.001);
      expect(Math.abs(sunBarycentricDelayS(c.jd, c.raDeg, c.decDeg) - c.sunDelayS)).toBeLessThan(
        0.02,
      );
      const bjd = normalizeEpoch(c.jd, 'bjd_utc', c.raDeg, c.decDeg);
      const hjd = normalizeEpoch(c.jd, 'hjd_utc', c.raDeg, c.decDeg);
      if (!bjd.ok || !hjd.ok) throw new Error('unerwartet außerhalb');
      expect(Math.abs(bjd.t0BjdTdb - c.bjdTdbFromBjdUtc) * DAY_S).toBeLessThan(0.001);
      expect(Math.abs(hjd.t0BjdTdb - c.bjdTdbFromHjdUtc) * DAY_S).toBeLessThan(0.02);
    });
  }

  it('Sonnenversatz bleibt unter 5 s (transit.md §1: 0,15 … 4,6 s)', () => {
    for (const c of fixture.cases)
      expect(Math.abs(sunBarycentricDelayS(c.jd, c.raDeg, c.decDeg))).toBeLessThan(5);
  });
});

describe('Schaltsekunden zum Datum (AST-T7)', () => {
  it('Stufen an den Grenzen, nicht je Jahr', () => {
    expect(taiMinusUtc(2451179.4999).seconds).toBe(31); // 1998-12-31
    expect(taiMinusUtc(2451179.5).seconds).toBe(32); // 1999-01-01
    expect(taiMinusUtc(2456109.4999).seconds).toBe(34); // 2012-06-30
    expect(taiMinusUtc(2456109.5).seconds).toBe(35); // 2012-07-01
    expect(taiMinusUtc(2461300.5).seconds).toBe(37);
  });

  it('nach validUntil gilt der letzte Wert mit Kennzeichen', () => {
    expect(taiMinusUtc(LEAP_TABLE_VALID_UNTIL_JD).expired).toBe(false);
    expect(taiMinusUtc(LEAP_TABLE_VALID_UNTIL_JD + 1)).toEqual({ seconds: 37, expired: true });
    const n = normalizeEpoch(LEAP_TABLE_VALID_UNTIL_JD + 10, 'bjd_utc', 0, 0);
    expect(n.ok && n.leapTableExpired).toBe(true);
  });
});

describe('normalizeEpoch: Quellsysteme und Plausibilität', () => {
  it('BJD_TDB unverändert', () => {
    expect(normalizeEpoch(2455757.84302, 'bjd_tdb', 324.536, 30.4885)).toEqual({
      ok: true,
      t0BjdTdb: 2455757.84302,
      system: 'bjd_tdb',
      leapTableExpired: false,
    });
  });

  it('BTJD und BKJD mit festem Offset', () => {
    const b = normalizeEpoch(1325.7258, 'btjd', 0, 0);
    expect(b.ok && b.t0BjdTdb).toBeCloseTo(2458325.7258, 9);
    expect(b.ok && b.system).toBe('btjd');
    const k = normalizeEpoch(100.5, 'bkjd', 0, 0);
    expect(k.ok && k.t0BjdTdb).toBeCloseTo(2454933.5, 9);
  });

  it('JD_UTC und unbekannt → unknown, Epoche unverändert (Puffer + 10 min in AP-41)', () => {
    expect(normalizeEpoch(2455000.1, 'jd_utc', 10, 10)).toMatchObject({
      ok: true,
      t0BjdTdb: 2455000.1,
      system: 'unknown',
    });
    expect(normalizeEpoch(2455000.1, 'unknown', 10, 10)).toMatchObject({ system: 'unknown' });
  });

  it('außerhalb 2 400 000 … 2 500 000 → exo.epoch_out_of_range, nicht geraten', () => {
    // MJD bzw. RJD ohne Offset: nicht nach der Größe umdeuten.
    expect(normalizeEpoch(55757.34, 'bjd_tdb', 0, 0)).toEqual({
      ok: false,
      code: 'exo.epoch_out_of_range',
      value: 55757.34,
    });
    expect(normalizeEpoch(2_500_000, 'bjd_tdb', 0, 0).ok).toBe(false);
    expect(normalizeEpoch(Number.NaN, 'bjd_tdb', 0, 0).ok).toBe(false);
  });
});

describe('Tiefe je Einheit (AST-D1/D2)', () => {
  it('Kontrollwerte der Spec', () => {
    expect(depthMmag(1, 'percent')).toBeCloseTo(10.912, 3);
    expect(depthMmag(10_000, 'ppm')).toBeCloseTo(10.912, 3);
    expect(depthMmag(0.2, 'percent')).toBeCloseTo(2.174, 3);
    expect(depthMmag(3, 'percent')).toBeCloseTo(33.071, 3);
    expect(depthMmag(12.5, 'mmag')).toBe(12.5);
  });

  it('fehlende, nicht positive oder unmögliche Werte → null', () => {
    expect(depthMmag(null, 'percent')).toBeNull();
    expect(depthMmag(0, 'ppm')).toBeNull();
    expect(depthMmag(-1, 'mmag')).toBeNull();
    expect(depthMmag(100, 'percent')).toBeNull();
  });

  it('geometrische Tiefe (Rp/R★)² – HAT-P-17 b (k = 0,1238) 16,77 mmag, gemessen 20,37', () => {
    expect(geometricDepthMmag(0.1238)).toBeCloseTo(16.769, 3);
    expect(geometricDepthMmag(null)).toBeNull();
  });
});

describe('Transitdauer aus der Geometrie (Kreisbahn)', () => {
  // ExoClock-Werte kreisförmiger Bahnen (e = 0) gegen deren Katalogdauer; exzentrische Bahnen (HAT-P-17 b,
  // e = 0,34) weichen ab – deshalb nur Ersatzwert mit Kennzeichen `duration_estimated`.
  it.each([
    ['HD 209458 b', 3.52474918, 8.76, 0.12086, 86.71, 3.09],
    ['WASP-12 b', 1.091418859, 3.04, 0.1178, 83.4, 3.0],
    ['Qatar-1 b', 1.420024447, 6.25, 0.1463, 84.08, 1.66],
  ])('%s: T14 auf ±10 %% der Katalogdauer', (_name, p, a, k, i, t14) => {
    const t = transitDurationH(p, a, k, i);
    expect(t).not.toBeNull();
    expect(Math.abs((t ?? 0) - t14) / t14).toBeLessThan(0.1);
  });

  it('ohne Bedeckung oder mit fehlenden Größen → null', () => {
    expect(transitDurationH(3, 5, 0.1, 60)).toBeNull();
    expect(transitDurationH(3, null, 0.1, 89)).toBeNull();
  });
});
