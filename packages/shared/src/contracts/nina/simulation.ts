/**
 * `GET /nina/v1/simulation?night=` (AP-53, FA-NIN-18, FA-SIM-05): Simulator im Plugin. Der Server rechnet die Nacht
 * mit derselben Engine und denselben Eingaben wie `POST /plan` (`buildPlanInput` → `planNight`), speichert aber
 * **nichts** (keine Planrevision, keine Session) – das Plugin rechnet nie selbst (Entscheidung Sven 01.10.2026).
 * Antwort wie der Web-Simulator S-40: Kopfzahlen, Zielkarten, nicht zugeteilte Projekte, Plangrafik (Dämmerung,
 * Höhenkurven, Blöcke, Filterleiste, Flips) und Planprotokoll; Zeiten in UTC, Standortzeit über `timeZoneSegments`.
 */
import { z } from 'zod';
import {
  blockKinds,
  diagnosticReasons,
  simulatorWarnings,
  warningLevels,
} from '../../generated/enums';
import { Message, NightKey, Sha256, Text, UtcInstant, Uuid, Version } from './common';
import { ExecutedNight, StoredPlanInfo } from '../executed';

export const NinaSimulationQuery = z
  .object({ night: NightKey })
  .meta({ id: 'NinaSimulationQuery' });
export type NinaSimulationQuery = z.infer<typeof NinaSimulationQuery>;

const check = z.enum(['ok', 'fail', 'warn', 'none']).meta({ id: 'NinaSimulationCheck' });
const altitudeSeries = z
  .array(
    z
      .object({ atUtc: UtcInstant, altDeg: z.number().min(-90).max(90) })
      .meta({ id: 'NinaSimulationAltitude' }),
  )
  .max(300);
const nullableNumber = z.number().nullable();

export const NinaSimulationProtocolRow = z
  .object({
    blockId: Uuid,
    projectId: Uuid,
    cmd: z.enum([
      'slew_center',
      'slew_center_rotate',
      'filter',
      'expose',
      'expose_series',
      'dither',
      'autofocus_hint',
      'wait',
      'meridian_flip',
      'end',
    ]),
    atUtc: UtcInstant,
    untilUtc: UtcInstant.nullable(),
    durationS: z.number().min(0).nullable(),
    projectName: Text,
    /** Panel-Nummer ab 1 bei Mosaiken, sonst leer. */
    panel: Text,
    no: z.number().int().min(1).nullable(),
    filter: Text,
    exposureS: z.number().min(0).nullable(),
    gain: z.number().int().nullable(),
    offset: z.number().int().nullable(),
    binning: z.number().int().min(1).nullable(),
    readoutMode: Text.nullable(),
    rotationDeg: nullableNumber,
    raDeg: nullableNumber,
    decDeg: nullableNumber,
    altDeg: nullableNumber,
    moonSepDeg: nullableNumber,
    moonOk: z.boolean().nullable(),
    requiredSepDeg: nullableNumber,
    dark: z.boolean().nullable(),
    la: z.boolean().nullable(),
    /** Anzeigename des Mondprofils; mitgelieferte Profile als `moonProfile.<key>` (übersetzt das Plugin). */
    moonProfile: Text,
    bonus: z.boolean(),
  })
  .meta({ id: 'NinaSimulationProtocolRow' });

export const NinaSimulationCard = z
  .object({
    projectId: Uuid,
    name: Text,
    /** Zielfarbe: `chart-series-(seriesIndex mod 6 + 1)` aus `packages/ui-tokens`. */
    seriesIndex: z.number().int().min(0),
    allocatedS: z.number().min(0),
    fromUtc: UtcInstant.nullable(),
    toUtc: UtcInstant.nullable(),
    altMinDeg: nullableNumber,
    altMaxDeg: nullableNumber,
    moonSepMinDeg: nullableNumber,
    transit: z.boolean(),
    lines: z
      .array(
        z
          .object({
            lineId: Uuid,
            filter: Text,
            /** Filterfarbe aus den Stammdaten (`#RRGGBB`), `null` für unbekannte Filter. */
            color: Text.nullable(),
            exposureS: z.number().min(0),
            need: z.number().int().min(0),
            tonight: z.number().int().min(0),
            moon: z
              .object({
                name: Text,
                separationDeg: z.number(),
                widthDays: z.number(),
                mustBeDown: z.boolean(),
              })
              .meta({ id: 'NinaSimulationLineMoon' })
              .nullable(),
            enabled: z.boolean(),
          })
          .meta({ id: 'NinaSimulationCardLine' }),
      )
      .max(500),
    checks: z
      .object({
        altitude: check,
        time: check,
        moon: check,
        darkness: check,
        rotation: check,
      })
      .meta({ id: 'NinaSimulationChecks' }),
    flips: z
      .array(
        z
          .object({
            atUtc: UtcInstant,
            durationS: z.number().min(0),
            inTransitWindow: z.boolean(),
          })
          .meta({ id: 'NinaSimulationCardFlip' }),
      )
      .max(200),
  })
  .meta({ id: 'NinaSimulationCard' });

export const NinaSimulation = z
  .object({
    night: NightKey,
    generatedAtUtc: UtcInstant,
    engineVersion: Version,
    inputHash: Sha256,
    outputHash: Sha256.optional(),
    /** Einstellungsversion des Rigs, mit der gerechnet wurde (FA-SIM-09). */
    settingsVersion: z.number().int().min(0),
    /** IANA-Zone des Standorts (nur Anzeige). */
    timeZone: Text,
    /** Standortzeit in der Nacht: Offset und Kürzel ab `fromUtc` (NT-03, Zeitumstellung = zweites Segment). */
    timeZoneSegments: z
      .array(
        z
          .object({ fromUtc: UtcInstant, utcOffsetMinutes: z.number().int(), abbr: Text })
          .meta({ id: 'NinaSimulationTimeZoneSegment' }),
      )
      .min(1)
      .max(10),
    nightWindow: z
      .object({ startUtc: UtcInstant, endUtc: UtcInstant })
      .meta({ id: 'NinaSimulationNightWindow' }),
    darkness: z
      .object({
        civilStartUtc: UtcInstant.nullable(),
        civilEndUtc: UtcInstant.nullable(),
        nauticalStartUtc: UtcInstant.nullable(),
        nauticalEndUtc: UtcInstant.nullable(),
        astronomicalStartUtc: UtcInstant.nullable(),
        astronomicalEndUtc: UtcInstant.nullable(),
      })
      .meta({ id: 'NinaSimulationDarkness' }),
    header: z
      .object({
        darkHours: z.number().min(0),
        targets: z.number().int().min(0),
        frames: z.number().int().min(0),
        moonIllumPct: z.number().min(0).max(100),
      })
      .meta({ id: 'NinaSimulationHeader' }),
    /** Höhenkurven je Ziel (FA-SIM-07), 10-min-Raster über das Nachtfenster. */
    targets: z
      .array(
        z
          .object({
            projectId: Uuid,
            name: Text,
            seriesIndex: z.number().int().min(0),
            minAltitudeDeg: z.number().min(-90).max(90),
            altitude: altitudeSeries,
          })
          .meta({ id: 'NinaSimulationTarget' }),
      )
      .max(200),
    moon: z
      .object({ illuminationPct: z.number().min(0).max(100), altitude: altitudeSeries })
      .meta({ id: 'NinaSimulationMoon' }),
    blocks: z
      .array(
        z
          .object({
            id: Uuid,
            projectId: Uuid,
            kind: z.enum(blockKinds),
            label: Text,
            seriesIndex: z.number().int().min(0),
            startUtc: UtcInstant,
            endUtc: UtcInstant,
          })
          .meta({ id: 'NinaSimulationBlock' }),
      )
      .max(200),
    filterBars: z
      .array(
        z
          .object({
            fromUtc: UtcInstant,
            toUtc: UtcInstant,
            filter: Text,
            color: Text.nullable(),
            count: z.number().int().min(1),
          })
          .meta({ id: 'NinaSimulationFilterBar' }),
      )
      .max(5000),
    flips: z.array(z.object({ atUtc: UtcInstant }).meta({ id: 'NinaSimulationFlip' })).max(200),
    cards: z.array(NinaSimulationCard).max(200),
    unallocated: z
      .array(
        z
          .object({
            projectId: Uuid,
            name: Text,
            reasons: z
              .array(
                z
                  .object({
                    reason: z.enum(diagnosticReasons),
                    lineId: Uuid.optional(),
                    message: Message.optional(),
                  })
                  .meta({ id: 'NinaSimulationReason' }),
              )
              .max(500),
          })
          .meta({ id: 'NinaSimulationUnallocated' }),
      )
      .max(500),
    protocol: z.array(NinaSimulationProtocolRow).max(50000),
    warnings: z
      .array(
        z
          .object({
            code: z.enum(simulatorWarnings),
            level: z.enum(warningLevels),
            unitId: Text.optional(),
            atUtc: UtcInstant.optional(),
            durationS: z.number().min(0).optional(),
            message: Message.optional(),
          })
          .meta({ id: 'NinaSimulationWarning' }),
      )
      .max(1000),
    /**
     * Ist der Nacht aus den Session-Ereignissen und Aufnahmen (AP-53c): nur für die laufende und vergangene Nächte mit
     * Session, sonst `null`. Ältere Server liefern das Feld nicht.
     */
    executed: ExecutedNight.nullable().optional(),
    /** Letzte gespeicherte Planrevision der Nacht und ob die Rig noch mit älterer Eingabe plant (AP-53c). */
    storedPlan: StoredPlanInfo.nullable().optional(),
  })
  .meta({ id: 'NinaSimulation' });
export type NinaSimulation = z.infer<typeof NinaSimulation>;
