/**
 * `GET /nina/v1/bootstrap` (TK 7.3, 7.6; NT-02, NT-05, NT-E1, NT-E2, NT-38, NT-40, FA-SYN-02):
 * Rig mit Standort, Optik, Kamera, bestätigter Filterradbelegung und Scheduler-Einstellungen,
 * Mondprofile, Nacht-Tabelle ab der Mittagsnacht und `serverTimeUtc` als einzige Uhrquelle.
 */
import { z } from 'zod';
import {
  filterTypes,
  flatsAutoModes,
  flatsSources,
  playbackModes,
  sortChainKeys,
  strategies,
} from '../../generated/enums';
import { NightKey, Text, UtcInstant, Uuid, Version } from './common';

export const NinaReadoutMode = z.object({ index: z.number().int().min(0), name: Text });

/** Abend- (`duskUtc`, Abwärtsdurchgang) und Morgendurchgang (`dawnUtc`) einer Dämmerungsgrenze; `null` ohne Durchgang. */
export const NinaTwilightCrossing = z.object({
  duskUtc: UtcInstant.nullable(),
  dawnUtc: UtcInstant.nullable(),
});

export const NinaNightRow = z.object({
  night: NightKey,
  noonStartUtc: UtcInstant,
  noonEndUtc: UtcInstant,
  nightWindowEndUtc: UtcInstant,
  /**
   * Dämmerungen der Nacht für *NINA-PM Warten auf Zeit* (AP-52, FA-NIN-26): vom Server mit derselben Engine gerechnet,
   * das Plugin rechnet keine Astronomie (H1). Nur im Bootstrap, nicht in Plan-Eingaben (`inputHash` unverändert).
   */
  twilight: z
    .object({
      civil: NinaTwilightCrossing,
      nautical: NinaTwilightCrossing,
      astronomical: NinaTwilightCrossing,
    })
    .optional(),
});

export const NinaBootstrap = z
  .object({
    apiVersion: z.literal('1'),
    serverTimeUtc: UtcInstant,
    server: z.object({ engineVersion: Version, minPluginVersion: Version }),
    instance: z.object({ id: Uuid, name: Text }),
    tenant: z.object({ key: Text, name: Text, timeZone: Text }),
    rig: z.object({
      id: Uuid,
      name: Text,
      settingsVersion: z.number().int().min(0),
      site: z.object({
        name: Text,
        latDeg: z.number().min(-90).max(90),
        lonDeg: z.number().min(-180).max(180),
        elevationM: z.number(),
        timeZone: Text,
      }),
      telescope: z.object({
        name: Text,
        apertureMm: z.number().positive(),
        focalLengthMm: z.number().positive(),
        reducerFactor: z.number().positive(),
      }),
      camera: z.object({
        name: Text,
        pixelSizeUm: z.number().positive(),
        widthPx: z.number().int().positive(),
        heightPx: z.number().int().positive(),
        defaultGain: z.number().int().nullable(),
        defaultOffset: z.number().int().nullable(),
        readoutModes: z.array(NinaReadoutMode).max(64),
        binning: z.array(z.number().int().min(1)).max(16),
        setpointC: z.number().nullable(),
        toleranceC: z.number().min(0),
      }),
      rotator: z.object({
        present: z.boolean(),
        defaultRotationDeg: z.number().min(0).lt(360).nullable(),
        toleranceDeg: z.number().min(0).max(90),
        skipOnMismatch: z.boolean(),
      }),
      filters: z
        .array(
          z.object({
            shortName: Text,
            name: Text,
            color: Text,
            position: z.number().int().min(1),
            ninaFilterName: Text.nullable(),
            /** Filtertyp (Reihenfolge der Himmelsflats Schmalband → Breitband → L, NT-40, AP-50); fehlt bei älteren Servern. */
            type: z.enum(filterTypes).optional(),
          }),
        )
        .max(64),
      scheduler: z.object({
        strategy: z.enum(strategies),
        playback: z.enum(playbackModes),
        sortChain: z.array(z.enum(sortChainKeys)).max(16),
        bonus: z.object({ enabled: z.boolean() }),
        mosaicPanelsIndependent: z.boolean(),
        dither: z.object({ enabled: z.boolean(), every: z.number().int().min(0) }),
        filterSwitch: z.object({
          enabled: z.boolean(),
          every: z.number().int().min(0),
          tolerancePct: z.number().min(0).max(100),
        }),
        flats: z.object({
          enabled: z.boolean(),
          source: z.enum(flatsSources),
          fullSet: z.boolean(),
          count: z.number().int().min(0),
          darkFlats: z.object({ enabled: z.boolean(), count: z.number().int().min(0).nullable() }),
          /** Auto-Flats je Projekt (AP-50b); fehlt bei älteren Servern (= aus). */
          auto: z
            .object({
              mode: z.enum(flatsAutoModes),
              intervalDays: z.number().int().min(1).max(30),
            })
            .optional(),
        }),
        meridianFlip: z.object({
          enabled: z.boolean(),
          afterMin: z.number().min(0),
          maxAfterMin: z.number().min(0),
          pauseBeforeMin: z.number().min(0),
          durationS: z.number().min(0),
        }),
        overhead: z.object({
          slewCenterS: z.number().min(0),
          filterChangeS: z.number().min(0),
          ditherSettleS: z.number().min(0),
          afEveryMin: z.number().min(0),
          afDurationS: z.number().min(0),
          downloadS: z.number().min(0),
        }),
        overshootPct: z.number().min(0).max(100),
      }),
      leaseMinutes: z.number().int().positive(),
    }),
    moonProfiles: z
      .array(
        z.object({
          id: Uuid,
          name: Text,
          separationDeg: z.number().min(0).max(180),
          widthDays: z.number().min(0),
          relax: z.number().min(0),
          minAltDeg: z.number().min(-90).max(90),
          maxAltDeg: z.number().min(-90).max(90),
          maxIlluminationPct: z.number().min(0).max(100),
          moonMustBeDown: z.boolean(),
        }),
      )
      .max(200),
    tzdataVersion: Text,
    nights: z.array(NinaNightRow).min(1).max(400),
    timeZoneTransitions: z
      .array(z.object({ atUtc: UtcInstant, utcOffsetMinutes: z.number().int() }))
      .min(1)
      .max(1000),
  })
  .meta({ id: 'NinaBootstrap' });
export type NinaBootstrap = z.infer<typeof NinaBootstrap>;
