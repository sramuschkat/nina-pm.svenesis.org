/**
 * `POST /nina/v1/heartbeat` (TK 5.6, 7.3, 7.6; FA-SYN-07, FA-RIG-06, NT-05, NT-17, NT-22, NT-E1,
 * NT-E2, M5, M6, M7): Zustand, Versionen, NINA-Einstellungen, Filterrad; Antwort mit Lease,
 * `serverTimeUtc`, `settingsVersion`, `targetsEtag` und `commands[]`.
 */
import { z } from 'zod';
import { blockedReasons, heartbeatStates, ninaCommands } from '../../generated/enums';
import { Angle, Lease, Text, UtcInstant, Uuid, Version } from './common';

export const NinaHeartbeat = z
  .object({
    state: z.enum(heartbeatStates),
    blockedReason: z.enum(blockedReasons).nullable().optional(),
    sessionId: Uuid.nullable().optional(),
    blockId: Uuid.nullable().optional(),
    pluginVersion: Version,
    engineVersion: Version,
    profileLocation: z
      .object({ latDeg: z.number().min(-90).max(90), lonDeg: z.number().min(-180).max(180) })
      .nullable()
      .optional(),
    cameraReadoutModes: z
      .array(z.object({ index: z.number().int().min(0), name: Text }))
      .max(64)
      .optional(),
    meridianFlip: z
      .object({
        /** `null`/fehlt: noch kein NINA-PM-Container gelaufen, Trigger unbekannt (keine Abweichung melden). */
        triggerPresent: z.boolean().nullable().optional(),
        useSideOfPier: z.boolean(),
        recenter: z.boolean(),
        autoFocusAfterFlip: z.boolean(),
        settleTimeS: z.number().min(0),
        pauseBeforeMin: z.number().min(0),
        afterMin: z.number().min(0),
        maxAfterMin: z.number().min(0),
      })
      .nullable()
      .optional(),
    rotator: z
      .object({
        connected: z.boolean(),
        rangeType: z.enum(['FULL', 'HALF', 'QUARTER']),
        rangeStartMechanicalDeg: Angle,
        reverse: z.boolean(),
      })
      .nullable()
      .optional(),
    plateSolve: z
      .object({ rotationToleranceDeg: z.number().min(0) })
      .nullable()
      .optional(),
    mount: z
      .object({
        equatorialSystem: z.enum(['J2000', 'JNOW', 'B1950', 'J2050']),
        siteLatDeg: z.number().min(-90).max(90),
        siteLonDeg: z.number().min(-180).max(180),
        siderealTimeDeltaS: z.number(),
      })
      .nullable()
      .optional(),
    sequenceTriggers: z
      .object({
        autofocus: z.array(Text).max(32),
        autofocusAfterTimeMin: z.number().min(0).nullable(),
        dither: z.array(Text).max(32),
      })
      .nullable()
      .optional(),
    camera: z
      .object({
        temperatureC: z.number().nullable(),
        setPointC: z.number().nullable(),
        coolerOn: z.boolean(),
        coolerPowerPct: z.number().min(0).max(100).nullable(),
      })
      .nullable()
      .optional(),
    lastMeasuredRotationDeg: Angle.nullable().optional(),
    filterWheel: z
      .array(z.object({ position: z.number().int().min(1), name: Text, focusOffset: z.number() }))
      .max(64)
      .nullable()
      .optional(),
    outboxPending: z.number().int().min(0).optional(),
    deadLetters: z.number().int().min(0).optional(),
    settingsVersion: z.number().int().min(0).optional(),
    offlineUntil: UtcInstant.nullable().optional(),
    ackedCommandIds: z.array(Uuid).max(100).optional(),
  })
  .meta({ id: 'NinaHeartbeat' });
export type NinaHeartbeat = z.infer<typeof NinaHeartbeat>;

export const NinaHeartbeatResponse = z
  .object({
    serverTimeUtc: UtcInstant,
    lease: Lease.nullable(),
    settingsVersion: z.number().int().min(0),
    targetsEtag: Text,
    commands: z.array(z.object({ id: Uuid, command: z.enum(ninaCommands) })).max(20),
  })
  .meta({ id: 'NinaHeartbeatResponse' });
export type NinaHeartbeatResponse = z.infer<typeof NinaHeartbeatResponse>;
