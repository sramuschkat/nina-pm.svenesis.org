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
  /**
   * Fortsetzung (AP-64, Liste lädt seitenweise): `nextCursor` der vorigen Seite. Eine Seite endet nie mitten in einer
   * Nacht eines Rigs (eine Karte je Nacht) und kann deshalb etwas mehr als `limit` Einträge haben.
   */
  cursor: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,200}$/)
    .optional(),
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

/**
 * Projekt-Chip einer Nacht (AP-64, S-60 Nächte): gespeicherte, zugeordnete, nicht verworfene Lights dieser Session
 * je Filter (mit Bonus); Exoplaneten-Projekte zeigen die Oberfläche als Transit-Serie („Transit · RED 558“).
 */
export const NightSessionProject = z
  .object({
    projectId: Uuid,
    projectName: z.string(),
    /** Ersteller (`app_user.id`) – neben dem Projektnamen (Entscheidung Sven 07.10.2026). */
    createdBy: Uuid.nullable(),
    transit: z.boolean(),
    frames: z.number().int().min(0),
    filters: z.array(z.object({ filter: z.string(), frames: z.number().int().min(0) })),
  })
  .meta({ id: 'NightSessionProject' });
export type NightSessionProject = z.infer<typeof NightSessionProject>;

/**
 * Effizienz einer Session (wie `NightSessionKpis`, FA-AUS-05): Belichtung gespeicherter Lights / nutzbare
 * Dunkelzeit (Laufzeit ∩ astronomische Dunkelheit des ersten Plans); `null`, solange die Session läuft oder ohne Plan.
 */
export const NightSessionEfficiency = z
  .object({
    exposureS: z.number().min(0),
    usableDarkS: z.number().min(0),
    pct: z.number().min(0).nullable(),
  })
  .meta({ id: 'NightSessionEfficiency' });

/** Listeneintrag S-60 (AP-64): Session plus Effizienz, Wetterbewertung zum Sessionbeginn und Projekt-Chips. */
export const NightSessionListItem = NightSession.extend({
  efficiency: NightSessionEfficiency.nullable(),
  /** Wetter-Schnappschuss zum Sessionbeginn (AP-30); `null` ohne Schnappschuss. */
  weather: z
    .object({
      ratingIndex: z.number().int().min(0).max(4).nullable(),
      nightMean: z.number().min(0).max(1).nullable(),
    })
    .nullable(),
  projects: z.array(NightSessionProject),
}).meta({ id: 'NightSessionListItem' });
export type NightSessionListItem = z.infer<typeof NightSessionListItem>;

export const NightSessionList = z
  .object({
    items: z.array(NightSessionListItem),
    /** Weitere Seite (Cursor für `cursor`); `null` am Ende. */
    nextCursor: z.string().nullable(),
  })
  .meta({ id: 'NightSessionList' });

/** Kennzahlen der Nächte für Rig und Zeitraum (AP-64, S-60): `GET /web/v1/sessions/summary`. */
export const NightSessionSummaryQuery = z.object({
  rigId: Uuid.optional(),
  from: NightKey.optional(),
  to: NightKey.optional(),
});

export const NightSessionSummary = z
  .object({
    /** Nächte mit mindestens einer Session. */
    nights: z.number().int().min(0),
    /** Davon nutzbar: ≥ 1 h Belichtung akzeptierter Lights in der Nacht (wie Klarnacht-Statistik, FA-AUS-17). */
    usableNights: z.number().int().min(0),
    /** Gemeldete Belichtung nicht verworfener, zugeordneter Lights (mit Bonus). */
    integrationS: z.number().min(0),
    lights: z.number().int().min(0),
    projects: z.number().int().min(0),
    /** Summe Belichtung / Summe nutzbare Dunkelzeit über beendete Sessions mit Plan; `null` ohne solche. */
    efficiencyPct: z.number().min(0).nullable(),
    /** Ungeprüfte Nächte (je Rig): mindestens eine Session der Nacht ist ungeprüft. */
    unreviewed: z.number().int().min(0),
    /** Neueste ungeprüfte Nacht (Link „Jetzt prüfen“). */
    firstUnreviewed: z.object({ rigId: Uuid, night: NightKey }).nullable(),
  })
  .meta({ id: 'NightSessionSummary' });
export type NightSessionSummary = z.infer<typeof NightSessionSummary>;

/**
 * Soll/Ist je Zeile der Session (FA-AUS-03). Entscheidung Sven 07.10.2026: **Soll** = Belichtungen des ersten
 * Plans dieser Session (niedrigste Revision) **ohne Bonus**, **Ist** = gespeicherte Lights **dieser** Session
 * (nicht der ganzen Nacht über mehrere Sessions); Bonus-Aufnahmen nur in *Bonus* und *Bonus verworfen*.
 */
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
    /**
     * Geplante Frames dieser Zeile laut erstem Plan der Session ohne Bonus-Einträge; `0`, wenn die Zeile
     * dort nicht (oder nur als Transit-Serie) vorkommt; `null` = Session ohne Plan.
     */
    planned: z.number().int().min(0).nullable(),
    /** Transit-Serie im ersten Plan (`expose_series`): Soll ist das Zeitfenster, keine Anzahl. */
    plannedSeries: z.object({ fromUtc: UtcInstant, untilUtc: UtcInstant }).nullable(),
    /** Nicht im ersten Plan, aber in einer späteren Revision dieser Session eingeplant. */
    plannedLater: z.boolean(),
    /** Gespeicherte Lights dieser Session ohne Bonus (einschließlich verworfener). */
    acquired: z.number().int().min(0),
    /**
     * Verworfen in dieser Session: einzeln verworfene Aufnahmen der Session plus ihr Anteil an einer
     * Korrektur der Nacht (FA-AUS-06), der über die einzeln verworfenen hinausgeht – den Überhang tragen
     * die Sessions der Nacht nach Beginn, jede höchstens bis zu ihren nicht verworfenen Aufnahmen.
     */
    rejected: z.number().int().min(0),
    accepted: z.number().int().min(0),
    /** Bonus-Aufnahmen dieser Session (einschließlich verworfener). */
    bonus: z.number().int().min(0),
    /** Einzeln verworfene Bonus-Aufnahmen dieser Session (FA-AUS-20, FK 8.4). */
    bonusRejected: z.number().int().min(0),
    /** Gemeldete Belichtung nicht verworfener Lights dieser Session (mit Bonus, NT-E3). */
    integrationS: z.number(),
    /**
     * Werte der Zeile in der ganzen Nacht (alle Sessions) – Grundlage für *Korrektur erfassen*, die je
     * Zeile und Nacht gilt (FA-AUS-06): Untergrenze = einzeln verworfene der Nacht.
     */
    night: z.object({
      acquired: z.number().int().min(0),
      /** Verworfen der Nacht = max(Korrektur, einzeln verworfene). */
      rejected: z.number().int().min(0),
      rejectedIndividual: z.number().int().min(0),
      rejectedCorrection: z.number().int().min(0),
    }),
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
    /**
     * Plan-Treue gegen den ersten Plan der Session (FA-AUS-09); `null` ohne Plan. Gleiche Begriffe wie
     * der Reiter Soll/Ist (07.10.2026): Frames = Belichtungen ohne Bonus; Transit-Serien zählen nur in
     * der Zeit (Soll = Zeitfenster), nicht in den Frames; Ist = Lights dieser Session ohne Bonus.
     */
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
