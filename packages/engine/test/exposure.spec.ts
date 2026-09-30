/**
 * Belichtungsempfehlung der Transitsuche (transit.md §6): Sättigungsgrenze, Obergrenzen, Defokus mit Variante im
 * Fokus, Genauigkeit und Transit-SNR. Beispiel-Rig: 81-mm-Refraktor mit 0,8×-Reducer und IMX533 (2,03″/px).
 */
import { describe, expect, it } from 'vitest';
import {
  airmass,
  erf,
  exposureAdvice,
  floorExposure,
  MAX_EXPOSURE_S,
  PEAK_TARGET,
  peakPixelFraction,
  skyMagForBortle,
  type ExposureInput,
} from '../src';

const rig: ExposureInput = {
  band: 'Rc',
  mag: 13,
  depthMmag: 6.4,
  durationH: 3.3,
  rpOverRs: 0.08,
  windowS: 5.6 * 3600,
  altMaxDeg: 70,
  altMidDeg: 60,
  apertureMm: 81,
  obstructionPct: 0,
  focalLengthMm: 382,
  pixelSizeUm: 3.76,
  readNoiseE: 4.46,
  saturationE: 73000,
  qePct: 80,
  darkES: 0.002,
  bandwidthNm: 100,
  transmissionPct: 95,
  skyMagArcsec2V: 21.6,
  elevationM: 300,
  downloadS: 3,
};

describe('Hilfsfunktionen', () => {
  it('erf auf 1e-6', () => {
    expect(erf(0)).toBeCloseTo(0, 6);
    expect(erf(0.5)).toBeCloseTo(0.5204999, 6);
    expect(erf(1)).toBeCloseTo(0.8427008, 6);
    expect(erf(-1)).toBeCloseTo(-0.8427008, 6);
  });

  it('Spitzenpixel: scharf viel, breit wenig', () => {
    expect(peakPixelFraction(0.1)).toBeCloseTo(1, 6);
    // große FWHM → ≈ 1/(2πσ²), auf 1 %
    const sigma = 10 / 2.354820045;
    const approx = 1 / (2 * Math.PI * sigma * sigma);
    expect(Math.abs(peakPixelFraction(10) / approx - 1)).toBeLessThan(0.01);
  });

  it('Luftmasse, Bortle, Rundung', () => {
    expect(airmass(90)).toBeCloseTo(1, 12);
    expect(airmass(30)).toBeCloseTo(2, 12);
    expect(airmass(0)).toBe(airmass(10));
    expect(skyMagForBortle(2)).toBe(21.6);
    expect(skyMagForBortle(null)).toBe(20.9);
    expect(floorExposure(7.9)).toBe(7.5);
    expect(floorExposure(0.2)).toBe(0.5);
    expect(floorExposure(47)).toBe(45);
    expect(floorExposure(159)).toBe(150);
  });
});

describe('exposureAdvice', () => {
  it('lichtschwacher Stern: Obergrenze 180 s, Spitze weit unter der Grenze', () => {
    const a = exposureAdvice(rig);
    expect(a.exposureS).toBe(MAX_EXPOSURE_S);
    expect(a.limitedBy).toBe('max_exposure');
    expect(a.defocus).toBe(false);
    expect(a.inFocus).toBeNull();
    expect(a.peakFraction).toBeLessThan(PEAK_TARGET);
    expect(a.framesInWindow).toBe(Math.floor(rig.windowS / 183));
    expect(a.precisionMmag).toBeGreaterThan(7);
    expect(a.precisionMmag).toBeLessThan(10);
    expect(a.transitSnr).toBeGreaterThan(3);
    expect(a.transitSnr).toBeLessThan(5);
  });

  it('mittelhell: Sättigung begrenzt, Spitze knapp unter 50 %', () => {
    const a = exposureAdvice({ ...rig, mag: 10 });
    expect(a.limitedBy).toBe('saturation');
    expect(a.exposureS).toBeGreaterThanOrEqual(30);
    expect(a.exposureS).toBeLessThan(MAX_EXPOSURE_S);
    expect(a.peakFraction).toBeLessThanOrEqual(PEAK_TARGET);
    expect(a.peakFraction).toBeGreaterThan(0.4);
  });

  it('hell: Defokus auf 30 s, dazu die kurze Belichtung im Fokus', () => {
    const a = exposureAdvice({ ...rig, mag: 8 });
    expect(a.limitedBy).toBe('defocus');
    expect(a.defocus).toBe(true);
    expect(a.exposureS).toBe(30);
    expect(a.fwhmArcsec).toBeGreaterThan(3);
    expect(a.fwhmArcsec * 2).toBe(Math.floor(a.fwhmArcsec * 2)); // auf 0,5″
    expect(a.peakFraction).toBeLessThanOrEqual(PEAK_TARGET);
    expect(a.inFocus).not.toBeNull();
    expect(a.inFocus?.fwhmArcsec).toBe(3);
    expect(a.inFocus?.exposureS).toBeLessThan(30);
    expect(a.inFocus?.peakFraction).toBeLessThanOrEqual(PEAK_TARGET);
    expect(a.inFocus?.framesInWindow).toBeGreaterThan(a.framesInWindow);
  });

  it('sehr hell: Defokus reicht nicht, kürzere Belichtung bei 20″', () => {
    const a = exposureAdvice({ ...rig, mag: 3 });
    expect(a.limitedBy).toBe('defocus_limit');
    expect(a.fwhmArcsec).toBe(20);
    expect(a.exposureS).toBeLessThan(30);
    expect(a.peakFraction).toBeLessThanOrEqual(PEAK_TARGET);
  });

  it('kurzer Ingress begrenzt die Belichtung (≥ 4 Aufnahmen je Ingress)', () => {
    const a = exposureAdvice({ ...rig, durationH: 0.8, rpOverRs: 0.05 });
    // Ingress ≈ 0,8 h · 0,05/1,05 = 137 s → höchstens 34 s
    expect(a.limitedBy).toBe('ingress');
    expect(a.exposureS).toBe(30);
  });

  it('größere Öffnung: bessere Genauigkeit', () => {
    const small = exposureAdvice({ ...rig, mag: 12 });
    const big = exposureAdvice({ ...rig, mag: 12, apertureMm: 356, obstructionPct: 32 });
    expect(big.precisionMmag).toBeLessThan(small.precisionMmag);
    expect(big.transitSnr).toBeGreaterThan(small.transitSnr);
  });

  it('deterministisch', () => {
    expect(exposureAdvice({ ...rig, mag: 8 })).toEqual(exposureAdvice({ ...rig, mag: 8 }));
  });
});
