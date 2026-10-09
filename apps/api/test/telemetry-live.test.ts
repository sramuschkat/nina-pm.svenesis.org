/**
 * „Rig jetzt“ (AP-70, FA-RIG-19): jüngster Heartbeat unter den Instanzen des Rigs; Instanzen ohne Heartbeat (Telemetrie-
 * Instanz) zählen nicht, ältere Plugins ohne `devices` liefern `null` dafür.
 */
import { describe, expect, it } from 'vitest';
import { rigLive } from '../src/telemetry/view';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const devices = {
  connected: {
    camera: true,
    mount: true,
    focuser: true,
    filterWheel: true,
    rotator: false,
    guider: true,
    safetyMonitor: true,
    weather: true,
    flatDevice: true,
    switch: true,
    dome: false,
  },
  focuser: { position: 2050, temperatureC: 17.4, moving: false },
  mountState: {
    pierSide: 'east',
    tracking: true,
    atPark: false,
    slewing: false,
    altitudeDeg: 42.5,
    azimuthDeg: 359.4,
  },
  guider: { rmsTotalArcsec: 0.62, rmsRaArcsec: 0.41, rmsDecArcsec: 0.46 },
  filter: 'LUMINOS',
  safe: true,
  weather: { cloudCoverPct: 0, skyQualityMag: 21.6, temperatureC: 17.1, dewPointC: 8.3 },
};

describe('rigLive', () => {
  it('nimmt den jüngsten Heartbeat; Instanz ohne Heartbeat zählt nicht; jsonb auch als Text', () => {
    const live = rigLive([
      { id: ID(1), name: 'SFRO-Telemetrie', lastState: null },
      {
        id: ID(2),
        name: 'Alt',
        lastState: {
          receivedAtUtc: '2026-10-09T05:00:00Z',
          state: 'idle',
          pluginVersion: '0.4.19',
        },
      },
      {
        id: ID(3),
        name: 'SFRO',
        lastState: JSON.stringify({
          receivedAtUtc: '2026-10-09T06:10:00Z',
          state: 'running',
          pluginVersion: '0.4.21',
          camera: { temperatureC: -10, setPointC: -10, coolerOn: true, coolerPowerPct: 38 },
          filterWheel: [{ position: 1, name: 'LUMINOS', focusOffset: 0 }],
          devices,
        }),
      },
    ]);
    expect(live).toMatchObject({
      instanceId: ID(3),
      instanceName: 'SFRO',
      receivedAtUtc: '2026-10-09T06:10:00Z',
      state: 'running',
      pluginVersion: '0.4.21',
      camera: { coolerPowerPct: 38 },
      devices: { filter: 'LUMINOS', weather: { skyQualityMag: 21.6 } },
    });
  });

  it('älteres Plugin ohne Gerätestatus: devices null; ohne jeden Heartbeat: null', () => {
    const live = rigLive([
      {
        id: ID(2),
        name: 'Alt',
        lastState: { receivedAtUtc: '2026-10-09T05:00:00Z', state: 'idle' },
      },
    ]);
    expect(live).toMatchObject({
      devices: null,
      camera: null,
      filterWheel: null,
      pluginVersion: null,
    });
    expect(rigLive([{ id: ID(1), name: 'Telemetrie', lastState: null }])).toBeNull();
    expect(rigLive([])).toBeNull();
  });

  it('Optik aus dem Heartbeat und Pixelmaßstab 206,265 · Pixel / Brennweite (AP-71)', () => {
    const optics = {
      focalLengthMm: 2938,
      focalRatio: 6.8,
      pixelSizeUm: 3.76,
      sensorWidthPx: 9576,
      sensorHeightPx: 6388,
      cameraName: 'ZWO ASI6200MM Pro',
      telescopeName: 'CDK17',
      ninaVersion: '3.2.0.9001',
    };
    const at = (st: Record<string, unknown>) =>
      rigLive([
        { id: ID(3), name: 'SFRO', lastState: { receivedAtUtc: '2026-10-09T06:10:00Z', ...st } },
      ]);
    expect(at({ optics })).toMatchObject({
      optics: { cameraName: 'ZWO ASI6200MM Pro' },
      pixelScaleArcsecPx: 0.264,
    });
    expect(at({ optics: { ...optics, focalLengthMm: null } })?.pixelScaleArcsecPx).toBeNull();
    expect(at({})).toMatchObject({ optics: null, pixelScaleArcsecPx: null });
  });
});
