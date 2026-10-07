/**
 * Sitzungsprotokoll und Klarnacht-Statistik (AP-30; FA-AUS-14…17; S-61 Reiter *Protokoll*, S-64; TK 7.2).
 *
 * **Protokoll** je Session (`session_log`): Werte mit Quelle je Feld – *Vorhersage* (Mittel der astronomisch
 * dunklen Stunden aus dem Wetter-Schnappschuss zum Sessionbeginn, Entscheidung Sven 26.09.2026), *NINA*
 * (Mittel/Min/Max der verbundenen Geräte, `session.nina_conditions`), *manuell* und *automatisch*
 * (Beginn/Ende, Mondphase). Ohne gespeichertes Protokoll belegt der Server vor: NINA vor Vorhersage.
 * Die Vorhersage liefert kein Seeing in Bogensekunden (nur eine Bewertung) – das Feld bleibt dort leer.
 *
 * **Klarnacht-Statistik** je Standort und Monat (`site_night_stat`): eine Nacht mit Session ist *nutzbar* ab
 * **1 h** Belichtungszeit akzeptierter Lights (Entscheidung Sven 26.09.2026), nutzbare Stunden = diese
 * Belichtungszeit (bei mehreren Rigs am Standort das Maximum). Nächte ohne Session können Admins als
 * „bewölkt/nicht genutzt“ erfassen (Quelle `manual`); eine spätere Session überschreibt das.
 */
import { z } from 'zod';
import { sessionLogSources, siteNightStatSources } from '../generated/enums';
import { NightKey, UtcInstant, Uuid } from './common';

/** Felder des Protokolls, die eine Quelle tragen (Reihenfolge = Anzeige). */
export const SESSION_LOG_FIELDS = [
  'startTime',
  'endTime',
  'seeingArcsec',
  'transparencyPct',
  'sqm',
  'temperatureC',
  'humidityPct',
  'windKmh',
  'cloudsNote',
  'moonIlluminationPct',
] as const;
export type SessionLogField = (typeof SESSION_LOG_FIELDS)[number];

const nullableNumber = (min: number, max: number) => z.number().min(min).max(max).nullable();

export const SessionLogValues = z
  .strictObject({
    startTime: UtcInstant.nullable(),
    endTime: UtcInstant.nullable(),
    seeingArcsec: nullableNumber(0, 20),
    transparencyPct: nullableNumber(0, 100),
    /** Himmelshelligkeit mag/″² (Schema: 14…23). */
    sqm: nullableNumber(14, 23),
    temperatureC: nullableNumber(-60, 60),
    humidityPct: nullableNumber(0, 100),
    windKmh: nullableNumber(0, 300),
    cloudsNote: z.string().trim().max(200).nullable(),
    moonIlluminationPct: nullableNumber(0, 100),
    weatherNotes: z.string().max(2000),
    notesMd: z.string().max(20_000),
  })
  .meta({ id: 'SessionLogValues' });
export type SessionLogValues = z.infer<typeof SessionLogValues>;

/** Mittel/Min/Max eines NINA-Geräts über die Session (FA-AUS-15 b). */
export const SessionLogStat = z
  .object({
    avg: z.number().nullable(),
    min: z.number().nullable(),
    max: z.number().nullable(),
  })
  .meta({ id: 'SessionLogStat' });

export const SessionLogView = z
  .object({
    sessionId: Uuid,
    /** Version für `If-Match` (`"0"` = noch nicht gespeichert); entspricht dem `ETag`. */
    version: z.string(),
    /** `false` = noch nicht gespeichert, Werte sind die Vorbelegung. */
    saved: z.boolean(),
    values: SessionLogValues,
    /** Quelle je Feld; `null` = leer. */
    sources: z.record(z.enum(SESSION_LOG_FIELDS), z.enum(sessionLogSources).nullable()),
    /** Vorschläge der Vorhersage (Mittel der dunklen Stunden) – `null` ohne Schnappschuss. */
    forecast: z
      .object({
        transparencyPct: z.number().nullable(),
        temperatureC: z.number().nullable(),
        humidityPct: z.number().nullable(),
        windKmh: z.number().nullable(),
        cloudPct: z.number().nullable(),
        /** Bewertung der Nacht 0…4 (FA-WET-03) und Mittel 0…1. */
        ratingIndex: z.number().int().min(0).max(4).nullable(),
        nightMean: z.number().min(0).max(1).nullable(),
        seeingScore: z.number().min(0).max(1).nullable(),
      })
      .nullable(),
    /** Messwerte aus NINA, umgerechnet auf die Einheiten des Protokolls (Wind km/h). */
    nina: z.object({
      sqm: SessionLogStat.nullable(),
      temperatureC: SessionLogStat.nullable(),
      humidityPct: SessionLogStat.nullable(),
      windKmh: SessionLogStat.nullable(),
      seeingArcsec: SessionLogStat.nullable(),
    }),
    updatedAt: UtcInstant.nullable(),
    /** Zuletzt gespeichert von (`app_user.id`) – Bild neben dem Namen (30.09.2026). */
    updatedBy: Uuid.nullable(),
    updatedByName: z.string().nullable(),
  })
  .meta({ id: 'SessionLogView' });
export type SessionLogView = z.infer<typeof SessionLogView>;

// ---- Klarnacht-Statistik (S-64) ---------------------------------------------------------------------

/** Nutzbar ab so vielen Stunden akzeptierter Lights (Entscheidung Sven 26.09.2026). */
export const USABLE_NIGHT_MIN_HOURS = 1;

export const ClearNightQuery = z.object({
  from: NightKey,
  to: NightKey,
});

export const ClearNightNight = z
  .object({
    night: NightKey,
    /** Eintrag der Statistik; `null` = keine Angabe (weder Session noch manuell). */
    source: z.enum(siteNightStatSources).nullable(),
    usable: z.boolean().nullable(),
    usableHours: z.number().min(0).nullable(),
    /** Sessions dieser Nacht an Rigs des Standorts. */
    sessionIds: z.array(Uuid),
    /**
     * Vorhersage der Nacht: Schnappschuss zum Sessionbeginn (erste Session der Nacht mit Schnappschuss), sonst die
     * gespeicherte Vorhersage je Standort und Nacht (`site_night_forecast`, letzte vor Beginn der Dunkelheit,
     * AP-64b) – auch für Nächte ohne Session („klar, aber nicht genutzt“).
     */
    forecastRatingIndex: z.number().int().min(0).max(4).nullable(),
    forecastNightMean: z.number().min(0).max(1).nullable(),
    /** Aus dem Protokoll (erste Session der Nacht mit Protokoll). */
    seeingArcsec: z.number().nullable(),
    sqm: z.number().nullable(),
    transparencyPct: z.number().nullable(),
    forecastTransparencyPct: z.number().nullable(),
    /** Verworfen-Quote der Nacht (verworfen / aufgenommen, Lights). `null` ohne Aufnahmen. */
    rejectedPct: z.number().min(0).max(100).nullable(),
  })
  .meta({ id: 'ClearNightNight' });
export type ClearNightNight = z.infer<typeof ClearNightNight>;

export const ClearNightMonth = z
  .object({
    /** `YYYY-MM` (Monat des Nacht-Schlüssels). */
    month: z.string().regex(/^\d{4}-\d{2}$/),
    /** Nächte mit Angabe (Session oder manuell). */
    recorded: z.number().int().min(0),
    usable: z.number().int().min(0),
    /** Anteil nutzbarer Nächte an den erfassten, 0…100; `null` ohne erfasste Nacht. */
    usablePct: z.number().min(0).max(100).nullable(),
    /** Mittlere nutzbare Stunden je nutzbarer Nacht. */
    meanUsableHours: z.number().min(0).nullable(),
  })
  .meta({ id: 'ClearNightMonth' });

export const ClearNightView = z
  .object({
    siteId: Uuid,
    siteName: z.string(),
    timeZone: z.string(),
    from: NightKey,
    to: NightKey,
    months: z.array(ClearNightMonth),
    nights: z.array(ClearNightNight),
    /**
     * Treffsicherheit der Vorhersage (FA-AUS-16): Nächte mit Session und Vorhersage (Schnappschuss, sonst
     * gespeicherte Vorhersage der Nacht); „Treffer“ = Bewertung ≥ *Gut* (Index 3) und nutzbar bzw. < *Gut* und nicht
     * nutzbar. Nächte ohne Session zählen nicht (nichts beobachtet, AP-64b).
     */
    accuracy: z.object({
      compared: z.number().int().min(0),
      hits: z.number().int().min(0),
      hitPct: z.number().min(0).max(100).nullable(),
    }),
  })
  .meta({ id: 'ClearNightView' });
export type ClearNightView = z.infer<typeof ClearNightView>;

/** Nacht ohne Session als „bewölkt/nicht genutzt“ erfassen (FA-AUS-17, Admin). */
export const ClearNightMark = z
  .strictObject({ usable: z.literal(false) })
  .meta({ id: 'ClearNightMark' });
