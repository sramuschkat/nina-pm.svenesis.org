/**
 * Sessions und Auswertung R1 (AP-15; FA-AUS-01…03, FA-AUS-06, FA-AUS-07, FA-AUS-22; S-60, S-61; TK 7.2):
 * Liste je Rig und Nacht, Detail mit Soll/Ist je Projekt und Filter, Aufnahmen mit den Kennzeichen
 * *Temperaturabweichung* (NT-E2) und *Einstellungen abweichend* (NT-E3), Ereignisse und Flats.
 * R3 (AP-31; FA-AUS-04, FA-AUS-05, FA-AUS-09, FA-AUS-20): Kennzahlen, Abweichungsgründe, einzelne
 * Aufnahmen verwerfen.
 */
import { z } from 'zod';
import {
  captureAssignments,
  captureResults,
  deviationReasons,
  rejectReasons,
  sessionStatuses,
} from '../generated/enums';
import { NightKey, UtcInstant, Uuid } from './common';

export const NightSessionQuery = z.object({
  rigId: Uuid.optional(),
  /** Nur ungeprüfte Sessions (FA-AUS-07). */
  unreviewed: z.enum(['true', 'false']).optional(),
  from: NightKey.optional(),
  to: NightKey.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const NightSession = z
  .object({
    id: Uuid,
    rigId: Uuid,
    rigName: z.string(),
    /** Zone des Standorts: Zeiten der Nacht in Standortzeit mit Kürzel (NT-03). */
    siteTimeZone: z.string(),
    night: NightKey,
    status: z.enum(sessionStatuses),
    startedAt: UtcInstant,
    endedAt: UtcInstant.nullable(),
    /** Sessionende der letzten Planrevision (= Nachtende, NT-09). */
    sessionEndUtc: UtcInstant.nullable(),
    createdOffline: z.boolean(),
    reviewed: z.boolean(),
    ninaInstanceName: z.string().nullable(),
    /** Gespeicherte, zugeordnete Lights ohne Bonus bzw. Bonus (FK 8.4). */
    frames: z.number().int().min(0),
    bonusFrames: z.number().int().min(0),
    /** Summe der gemeldeten Belichtungszeiten nicht verworfener Lights (NT-E3). */
    integrationS: z.number().min(0),
    unassigned: z.number().int().min(0),
  })
  .meta({ id: 'NightSession' });
export type NightSession = z.infer<typeof NightSession>;

export const NightSessionList = z
  .object({ items: z.array(NightSession) })
  .meta({ id: 'NightSessionList' });

/** Soll/Ist je Zeile in der Nacht der Session (FA-AUS-03); Soll aus der ersten Planrevision. */
export const NightSessionLineRow = z
  .object({
    projectId: Uuid,
    projectName: z.string(),
    /** Eigentümer (für *Korrektur erfassen* als User, FA-AUS-06). */
    projectCreatedBy: Uuid.nullable(),
    /**
     * Darf der Aufrufer diese Zeile korrigieren und ihre Aufnahmen verwerfen (`session.correct` mit der
     * Mandanteneinstellung `userCorrections`, FA-AUS-06)? Vom Server gerechnet, weil User die Einstellung
     * nicht lesen dürfen (Entscheidung Sven 28.09.2026).
     */
    canCorrect: z.boolean(),
    exposureLineId: Uuid,
    filterShortName: z.string(),
    exposureS: z.number().min(0),
    /** Geplante Frames dieses Projekts und Filters laut erstem Plan der Session; `null` = ohne Plan. */
    planned: z.number().int().min(0).nullable(),
    acquired: z.number().int().min(0),
    /** Verworfen in der Nacht = max(Korrektur, einzeln verworfene) (FA-AUS-06). */
    rejected: z.number().int().min(0),
    rejectedIndividual: z.number().int().min(0),
    rejectedCorrection: z.number().int().min(0),
    accepted: z.number().int().min(0),
    bonus: z.number().int().min(0),
    /** Einzeln verworfene Bonus-Aufnahmen (FA-AUS-20, FK 8.4). */
    bonusRejected: z.number().int().min(0),
    integrationS: z.number(),
  })
  .meta({ id: 'NightSessionLineRow' });
export type NightSessionLineRow = z.infer<typeof NightSessionLineRow>;

export const NightSessionCapture = z
  .object({
    id: Uuid,
    capturedAt: UtcInstant,
    frameType: z.enum(['light', 'flat', 'dark_flat']),
    projectId: Uuid.nullable(),
    projectName: z.string().nullable(),
    /** Ersteller des Projekts (`app_user.id`) – neben dem Projektnamen angezeigt (01.10.2026). */
    projectCreatedBy: Uuid.nullable(),
    exposureLineId: Uuid.nullable(),
    assignment: z.enum(captureAssignments),
    filterShortName: z.string(),
    filterActual: z.string().nullable(),
    exposureS: z.number().min(0),
    gain: z.number().int().nullable(),
    offset: z.number().int().nullable(),
    binning: z.number().int().nullable(),
    result: z.enum(captureResults),
    isBonus: z.boolean(),
    temperatureDeviation: z.boolean(),
    settingsDeviation: z.boolean(),
    rejected: z.boolean(),
    rejectReason: z.enum(rejectReasons).nullable(),
    fileName: z.string().nullable(),
    /**
     * Optionale NINA-Metriken (AP-62, `capture.metrics`): mittlerer HFR in Pixeln und Zahl der erkannten Sterne aus
     * NINAs Sternanalyse; `null`, wenn NINA nichts gemessen hat (Sternanalyse aus, Flats, keine Sterne).
     */
    hfr: z.number().min(0).nullable(),
    stars: z.number().int().min(0).nullable(),
  })
  .meta({ id: 'NightSessionCapture' });
export type NightSessionCapture = z.infer<typeof NightSessionCapture>;

export const NightSessionEvent = z
  .object({
    id: Uuid,
    occurredAt: UtcInstant,
    kind: z.string(),
    message: z.string().nullable(),
    durationS: z.number().nullable(),
  })
  .meta({ id: 'NightSessionEvent' });

export const NightSessionFlat = z
  .object({
    filterShortName: z.string(),
    rotatorMechDeg: z.number(),
    binning: z.number().int(),
    status: z.string(),
    flatsPlanned: z.number().int().min(0),
    flatsTaken: z.number().int().min(0),
    darkFlatsPlanned: z.number().int().min(0),
    darkFlatsTaken: z.number().int().min(0),
    flatExposureS: z.number().nullable(),
  })
  .meta({ id: 'NightSessionFlat' });

/**
 * Kennzahlen der Session (FA-AUS-05, FA-AUS-09). Zeiten in Sekunden. *Nutzbare Dunkelzeit* = Laufzeit der
 * Session ∩ astronomische Dunkelheit laut erstem Plan; *Belichtung* = gemeldete Belichtungszeiten
 * gespeicherter Lights (mit Bonus). Overhead = Laufzeit − Belichtung − Safety-Pausen; Autofokus und Flip
 * aus den gemeldeten Dauern, der Rest (Slew, Zentrieren, Dither, Download) als *sonstiger Overhead* –
 * das Plugin meldet dafür keine Einzeldauern.
 */
export const NightSessionKpis = z
  .object({
    darkFromUtc: UtcInstant.nullable(),
    darkToUtc: UtcInstant.nullable(),
    runtimeS: z.number().min(0).nullable(),
    usableDarkS: z.number().min(0).nullable(),
    exposureS: z.number().min(0),
    /** Belichtung / nutzbare Dunkelzeit in % (kann bei Belichtung außerhalb der Dunkelheit > 100 sein). */
    efficiencyPct: z.number().min(0).nullable(),
    overhead: z
      .object({
        autofocusS: z.number().min(0),
        flipS: z.number().min(0),
        otherS: z.number().min(0),
        /** Anteil an der Laufzeit ohne Safety-Pausen, %. */
        pct: z.number().min(0).max(100),
      })
      .nullable(),
    safetyPauseS: z.number().min(0),
    blockChanges: z.number().int().min(0),
    filterChanges: z.number().int().min(0),
    /** Plan-Treue gegen den ersten Plan der Session (FA-AUS-09); `null` ohne Plan. */
    plan: z
      .object({
        plannedFrames: z.number().int().min(0),
        plannedExposureS: z.number().min(0),
        acquiredFrames: z.number().int().min(0),
        acquiredExposureS: z.number().min(0),
        framesPct: z.number().min(0).nullable(),
        timePct: z.number().min(0).nullable(),
      })
      .nullable(),
  })
  .meta({ id: 'NightSessionKpis' });
export type NightSessionKpis = z.infer<typeof NightSessionKpis>;

/** Abweichungsgrund aus Ereignissen und Aufnahmen (FA-AUS-04): Anzahl und – wo messbar – Dauer. */
export const NightSessionReason = z
  .object({
    reason: z.enum(deviationReasons),
    count: z.number().int().min(0),
    durationS: z.number().min(0).nullable(),
  })
  .meta({ id: 'NightSessionReason' });
export type NightSessionReason = z.infer<typeof NightSessionReason>;

/** Höchstzahl Aufnahmen im Detail (eine Nacht hat ~ 100…600). */
export const NIGHT_SESSION_CAPTURE_LIMIT = 2000;

export const NightSessionDetail = z
  .object({
    session: NightSession.extend({
      reviewedBy: Uuid.nullable(),
      planRevision: z.number().int().min(1).nullable(),
      darknessEndUtc: UtcInstant.nullable(),
    }),
    rows: z.array(NightSessionLineRow),
    captures: z.array(NightSessionCapture).max(NIGHT_SESSION_CAPTURE_LIMIT),
    capturesTruncated: z.boolean(),
    events: z.array(NightSessionEvent),
    flats: z.array(NightSessionFlat),
    kpis: NightSessionKpis,
    reasons: z.array(NightSessionReason),
  })
  .meta({ id: 'NightSessionDetail' });
export type NightSessionDetail = z.infer<typeof NightSessionDetail>;

/** *Korrektur erfassen* je Zeile und Nacht der Session (FA-AUS-06); Untergrenze = einzeln verworfene. */
export const NightSessionCorrection = z
  .strictObject({
    exposureLineId: Uuid,
    rejected: z.number().int().min(0).max(100_000),
    reason: z.enum(rejectReasons).nullable().default(null),
    comment: z.string().trim().max(500).nullable().default(null),
  })
  .meta({ id: 'NightSessionCorrection' });

export const NightSessionReviewed = z
  .strictObject({ reviewed: z.boolean() })
  .meta({ id: 'NightSessionReviewed' });

/** Einzelne Aufnahme verwerfen bzw. zurücknehmen (FA-AUS-20; `PATCH /web/v1/captures/{id}`). */
export const CaptureReject = z
  .strictObject({
    rejected: z.boolean(),
    reason: z.enum(rejectReasons).nullable().default(null),
  })
  .meta({ id: 'CaptureReject' });

export const CaptureRejectResult = z
  .object({
    captureId: Uuid,
    rejected: z.boolean(),
    /** Verworfen der Zeile in dieser Nacht nach der Regel max (FA-AUS-06). */
    rejectedCount: z.number().int().min(0),
    bonusRejectedCount: z.number().int().min(0),
    /** Neuer Projektstatus, wenn das Projekt nach *Aktiv* zurückging (FA-PRJ-12), sonst `null`. */
    projectStatus: z.string().nullable(),
  })
  .meta({ id: 'CaptureRejectResult' });
