/**
 * Belichtungsempfehlung (FA-EXO-14a, transit.md §6): Rig-Kennwerte (Gain-Modus, Sättigung, Kühlung, Reducer)
 * und die Liste fehlender Angaben.
 */
import { describe, expect, it } from 'vitest';
import { exposureFor, exposureRig, type ExposureTarget } from '@nina-pm/shared';

const camera = {
  pixelSizeUm: 3.76,
  bitDepth: 14,
  readNoiseE: 3.5,
  fullWellE: 50000,
  gainEPerAdu: 1,
  quantumEfficiencyPct: 80,
  darkCurrentES20c: 0.064,
  isCooled: true,
  coolingSetpointC: -10,
  defaultGain: null as number | null,
  gainModes: [{ gain: 0, readNoiseE: 7, fullWellE: 50000, ePerAdu: 3.05 }],
};
const telescope = { apertureMm: 81, focalLengthMm: '478', reducerFactor: 0.8, obstructionPct: 0 };
const site = { elevationM: 400, bortleClass: 2 };
const filters = [{ id: 'red', bandwidthNm: 100, transmissionPct: 95 }];

const target: ExposureTarget = {
  band: 'Rc',
  choice: { filterId: 'red', shortName: 'R', match: 'substitute' },
  magR: 11,
  magV: 11.4,
  mag: 11.4,
  depthMmag: 15,
  durationH: 2.5,
  rpOverRs: 0.12,
  windowS: 5 * 3600,
  altMaxDeg: 70,
  altMidDeg: 65,
};

describe('exposureRig', () => {
  it('Sättigung = min(Full Well, ADC · e⁻/ADU); Reducer; Dunkelstrom gekühlt', () => {
    const r = exposureRig({ telescope, camera, site, downloadS: 3, filters });
    expect(r.saturationE).toBe(16383);
    expect(r.focalLengthMm).toBeCloseTo(382.4, 6);
    expect(r.darkES).toBeCloseTo(0.064 / 32, 9); // −10 °C: 30 °C unter 20 °C = 5 Halbierungen
    expect(r.readNoiseE).toBe(3.5);
    expect(r.filters.get('red')).toEqual({ bandwidthNm: 100, transmissionPct: 95 });
  });

  it('Gain-Modus des Standard-Gains vor den Kamerawerten', () => {
    const r = exposureRig({
      telescope,
      camera: { ...camera, defaultGain: 0 },
      site,
      downloadS: 3,
      filters,
    });
    expect(r.gain).toBe(0);
    expect(r.readNoiseE).toBe(7);
    expect(r.saturationE).toBe(Math.min(50000, 16383 * 3.05));
  });
});

describe('exposureFor', () => {
  const rig = exposureRig({ telescope, camera, site, downloadS: 3, filters });

  it('Empfehlung mit Filter, Himmel aus Bortle 2 in R', () => {
    const e = exposureFor(target, rig);
    expect(e.status).toBe('ok');
    if (e.status !== 'ok') return;
    expect(e.filterShortName).toBe('R');
    expect(e.skyMagArcsec2).toBe(20.7);
    expect(e.bortle).toBe(2);
    expect(e.peakPct).toBeLessThanOrEqual(50);
  });

  it('Filter eines unbestätigten Platzes wird als solcher gemeldet', () => {
    const confirmed = exposureFor(target, rig);
    const provisional = exposureFor({ ...target, filterConfirmed: false }, rig);
    expect(confirmed).toMatchObject({ status: 'ok', filterConfirmed: true });
    expect(provisional).toMatchObject({
      status: 'ok',
      filterConfirmed: false,
      filterShortName: 'R',
    });
  });

  it('fehlende Angaben werden genannt statt geschätzt', () => {
    const bare = exposureRig({
      telescope: undefined,
      camera: { ...camera, readNoiseE: null, fullWellE: null, gainEPerAdu: null, gainModes: [] },
      site,
      downloadS: 3,
      filters,
    });
    expect(exposureFor({ ...target, choice: null, depthMmag: null }, bare)).toEqual({
      status: 'missing',
      missing: ['telescope', 'camera_noise', 'camera_saturation', 'filter', 'depth'],
    });
  });
});
