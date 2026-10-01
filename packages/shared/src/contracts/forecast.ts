/**
 * Folgeplanung und Prognose (AP-33; FA-FOL-01…05, FA-FOL-07; FK 8.5; S-62): Ansicht je Rig aus der
 * gespeicherten Mehrnacht-Prognose (Job `forecast`, 14 Nächte, `night_plan(origin = 'forecast_job')`), der
 * aktuellen Wettervorhersage (7 Nächte: `nightMean`, `coverage`, `bestWindow`, Kennzeichen, Regen) und der
 * Klarnacht-Quote des Standorts (darüber hinaus). Die Prognose rechnet keine Wetterwerte selbst.
 */
import { z } from 'zod';
import { NightKey, UtcInstant, Uuid } from './common';
import { TonightLine } from './tonight';
import { WeatherBestWindow } from './weather';

/** Wetter einer Kandidatennacht (aus `weather_cache`, FA-FOL-03, WS-E2). */
export const ForecastNightWeather = z
  .object({
    nightMean: z.number().min(0).max(1).nullable(),
    ratingIndex: z.number().int().min(0).max(4).nullable(),
    coverage: z.number().min(0).max(1).nullable(),
    bestWindow: WeatherBestWindow.nullable(),
    /** „ohne Aerosol – Bewertung optimistisch“ (ab Tag 5). */
    aerosolMissing: z.boolean(),
    seeingIncomplete: z.boolean(),
    /** „Nacht unvollständig“: Vorhersage deckt die Dunkelheit nicht ganz ab (`coverage` < 1). */
    incomplete: z.boolean(),
    /** Regen nur zur Anzeige – die Bewertung kennt keinen Niederschlag (FA-WET-09). */
    precipProbPct: z.number().min(0).max(100).nullable(),
    precipMm: z.number().min(0).nullable(),
  })
  .meta({ id: 'ForecastNightWeather' });

export const ForecastNight = z
  .object({
    night: NightKey,
    darkHours: z.number().min(0).nullable(),
    /** Gewicht der Nacht: Klar-Wahrscheinlichkeit aus der Vorhersage bzw. Klarnacht-Quote. */
    weight: z.number().min(0).max(1),
    weightSource: z.enum(['forecast', 'quota']),
    /** Nur innerhalb des Vorhersagehorizonts (7 Nächte). */
    weather: ForecastNightWeather.nullable(),
  })
  .meta({ id: 'ForecastNight' });

export const ForecastFilterNeed = z
  .object({
    filter: z.string(),
    /** Verbleibende Frames (Geplant − Akzeptiert). */
    frames: z.number().int().min(0),
    /** Stunden inkl. Overhead-Aufschlag je Belichtung (FA-FOL-01). */
    hours: z.number().min(0),
  })
  .meta({ id: 'ForecastFilterNeed' });

/** Kandidatennacht eines Projekts (FA-FOL-03): erwartete Frames laut Simulation × Wetterfaktor. */
export const ForecastCandidate = z
  .object({
    night: NightKey,
    frames: z.number().min(0),
    hours: z.number().min(0),
    /** Nutzen = erwartete Frames × Wetterfaktor (FK 8.5). */
    benefit: z.number().min(0),
    light: z.enum(['green', 'yellow', 'red']),
    filters: z.array(z.object({ filter: z.string(), frames: z.number().int().min(0) })),
  })
  .meta({ id: 'ForecastCandidate' });

export const ForecastEstimate = z
  .object({
    /** Nächte mit Zeit für das Projekt bis zur Fertigstellung; `null` = nicht absehbar. */
    nights: z.number().int().min(0).nullable(),
    completesNight: NightKey.nullable(),
    /** Über die 14 simulierten Nächte hinaus fortgeschrieben (Mittel je Nacht). */
    extrapolated: z.boolean(),
  })
  .meta({ id: 'ForecastEstimate' });

export const ForecastAction = z
  .object({
    /** `raise_priority`/`pause` mit Ein-Klick-Umsetzung (Admin); die übrigen als Hinweis. */
    kind: z.enum(['raise_priority', 'pause', 'reduce_frames', 'other_rig', 'next_year']),
    oneClick: z.boolean(),
  })
  .meta({ id: 'ForecastAction' });

export const ForecastProject = z
  .object({
    projectId: Uuid,
    name: z.string(),
    /** Ersteller (`app_user.id`) – neben dem Projektnamen angezeigt (01.10.2026). */
    createdBy: Uuid,
    priority: z.number().int(),
    status: z.string().nullable(),
    need: z.array(ForecastFilterNeed),
    needFrames: z.number().int().min(0),
    needHours: z.number().min(0),
    /** Spanne (FA-FOL-02): optimistisch ohne Wetter, realistisch mit Wetter bzw. Klarnacht-Quote. */
    optimistic: ForecastEstimate,
    realistic: ForecastEstimate,
    candidates: z.array(ForecastCandidate),
    /** Saisonwarnung (FA-FOL-04): Rest passt nicht in die verbleibende Saison. */
    seasonWarning: z
      .object({
        achievablePct: z.number().int().min(0).max(100).nullable(),
        seasonEnd: NightKey.nullable(),
      })
      .nullable(),
    suggestions: z.array(ForecastAction),
    /** Aktive Zeilen mit „nur für die kommende Nacht aus“ (FA-FOL-05); Frames der aktuellen Nacht. */
    lines: z.array(TonightLine),
  })
  .meta({ id: 'ForecastProject' });

/**
 * Wiederaufnahme (FA-FOL-07): unfertige bzw. pausierte Projekte des Rigs mit Restbedarf; die Oberfläche zeigt
 * die Sichtbarkeit der nächsten Wochen (Saisonbeginn) aus Ziel und Bedingungen.
 */
export const ForecastResume = z
  .object({
    projectId: Uuid,
    name: z.string(),
    /** Ersteller (`app_user.id`), 01.10.2026. */
    createdBy: Uuid,
    status: z.string(),
    needFrames: z.number().int().min(0),
    target: z.object({ raDeg: z.number(), decDeg: z.number() }).nullable(),
    conditions: z.object({
      minAltitudeDeg: z.number(),
      minTimeOnTargetH: z.number(),
      twilight: z.enum(['astronomical', 'nautical', 'civil']),
    }),
  })
  .meta({ id: 'ForecastResume' });

export const ForecastView = z
  .object({
    rigId: Uuid,
    rigName: z.string(),
    siteTimeZone: z.string(),
    /** Zeitpunkt der gespeicherten Prognose; `null` = noch nicht berechnet. */
    computedAt: UtcInstant.nullable(),
    /** Aktuelle Nacht des Standorts (NT-01) – Bezug für „nur für die kommende Nacht“. */
    currentNight: NightKey,
    nights: z.array(ForecastNight),
    /** Klarnacht-Quote des Standorts (FA-AUS-17) jenseits der Vorhersage. */
    clearQuota: z.object({
      rate: z.number().min(0).max(1),
      source: z.enum(['stats', 'default']),
      recordedNights: z.number().int().min(0),
    }),
    projects: z.array(ForecastProject),
    resume: z.array(ForecastResume),
  })
  .meta({ id: 'ForecastView' });
export type ForecastView = z.infer<typeof ForecastView>;

export const ForecastQuery = z.object({ rigId: Uuid });
