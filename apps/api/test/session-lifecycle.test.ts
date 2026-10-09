/**
 * Analyse Plugin ↔ Server 04.10.2026, Paket 4: Einstellungsabweichungen ohne Fehlalarm – unbekannte Trigger (noch kein
 * NINA-PM-Container gelaufen) melden nichts, Autofokus nur bei `afEveryMin > 0` und erst über 0,5 min Abweichung.
 */
import { nina } from '@nina-pm/shared';
import { describe, expect, it } from 'vitest';
import { settingsMismatch } from '../src/nina/session';

const rig = {
  hasRotator: false,
  rotationToleranceDeg: 1,
  flipEnabled: true,
  flipAfterMeridianMin: 5,
  flipMaxAfterMeridianMin: 10,
  flipPauseBeforeMeridianMin: 5,
  afEveryMin: 60,
  site: { latitudeDeg: 31.9, longitudeDeg: -104.5 },
  filterWheel: [],
};
const flip = {
  useSideOfPier: true,
  recenter: false,
  autoFocusAfterFlip: false,
  settleTimeS: 0,
  afterMin: 5,
  maxAfterMin: 10,
  pauseBeforeMin: 5,
};
const hb = (over: Record<string, unknown>) =>
  nina.NinaHeartbeat.parse({
    state: 'idle',
    pluginVersion: '0.3.0',
    engineVersion: '0.6.0',
    ...over,
  });

describe('Einstellungsabweichungen (execution.md §6)', () => {
  it('Trigger unbekannt (noch kein Container) → kein flip_trigger_missing, kein af_time_trigger_missing', () => {
    const { codes } = settingsMismatch(
      hb({ meridianFlip: { ...flip, triggerPresent: null }, sequenceTriggers: null }),
      rig,
    );
    expect(codes).toEqual([]);
  });

  it('bekannt ohne Trigger → beide Codes; afEveryMin = 0 → kein Autofokus-Code; Abweichung erst über 0,5 min', () => {
    const missing = hb({
      meridianFlip: { ...flip, triggerPresent: false },
      sequenceTriggers: { autofocus: [], dither: [], autofocusAfterTimeMin: null },
    });
    expect(settingsMismatch(missing, rig).codes.slice().sort()).toEqual([
      'af_time_trigger_missing',
      'flip_trigger_missing',
    ]);
    expect(settingsMismatch(missing, { ...rig, afEveryMin: 0 }).codes).toEqual([
      'flip_trigger_missing',
    ]);
    const af = (min: number) =>
      settingsMismatch(
        hb({ sequenceTriggers: { autofocus: [], dither: [], autofocusAfterTimeMin: min } }),
        rig,
      ).codes;
    expect(af(60.4)).toEqual([]);
    expect(af(61)).toEqual(['af_time_mismatch']);
  });

  it('optics_mismatch: Brennweite über 2 %, Pixel- oder Sensorgröße anders; unbekannt prüft nichts (AP-71)', () => {
    const optics = { effFocalMm: 1000, pixelSizeUm: 3.76, widthPx: 6248, heightPx: 4176 };
    const o = (over: Record<string, unknown>) =>
      settingsMismatch(
        hb({
          optics: {
            focalLengthMm: 1000,
            focalRatio: 5,
            pixelSizeUm: 3.76,
            sensorWidthPx: 6248,
            sensorHeightPx: 4176,
            cameraName: 'ZWO ASI6200MM Pro',
            telescopeName: 'Planewave CDK',
            ninaVersion: '3.2.0.9001',
            ...over,
          },
        }),
        { ...rig, optics },
      ).codes;
    expect(o({})).toEqual([]);
    expect(o({ focalLengthMm: 1019 })).toEqual([]);
    expect(o({ focalLengthMm: 1021 })).toEqual(['optics_mismatch']);
    expect(o({ focalLengthMm: 700 })).toEqual(['optics_mismatch']);
    expect(o({ pixelSizeUm: 4.63 })).toEqual(['optics_mismatch']);
    expect(o({ sensorWidthPx: 4176, sensorHeightPx: 6248 })).toEqual([]);
    expect(o({ sensorWidthPx: 3000, sensorHeightPx: 2000 })).toEqual(['optics_mismatch']);
    expect(
      o({ focalLengthMm: null, pixelSizeUm: null, sensorWidthPx: null, sensorHeightPx: null }),
    ).toEqual([]);
    // Ohne Rig-Optik (Teleskop/Kamera nicht gefunden) keine Prüfung.
    expect(
      settingsMismatch(
        hb({
          optics: {
            ...{
              focalLengthMm: 700,
              focalRatio: null,
              pixelSizeUm: null,
              sensorWidthPx: null,
              sensorHeightPx: null,
              cameraName: null,
              telescopeName: null,
              ninaVersion: null,
            },
          },
        }),
        rig,
      ).codes,
    ).toEqual([]);
  });
});
