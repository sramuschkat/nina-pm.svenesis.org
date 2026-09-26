/**
 * „Heute Nacht“ S-02 (AP-35; FA-FOL-06, FA-FOL-05 „nur für die kommende Nacht“; TK 7.2 `GET /web/v1/tonight`):
 * je Rig die **aktuelle Nacht** des Standorts (`currentNight`, NT-01) mit Dunkelheit, Mond, Wetter der Nacht
 * (Farbband aus Astro-Wetter), geplanten Projekten mit erwarteten Frames aus der gespeicherten Prognose
 * (Job `forecast`, AP-33) und den NINA-Instanzen. Die Nacht rechnet der Server, nie der Browser.
 */
import { z } from 'zod';
import { NightKey, UtcInstant, Uuid } from './common';
import { WeatherBestWindow } from './weather';

export const TonightQuery = z.object({ rigId: Uuid.optional() }).meta({ id: 'TonightQuery' });

/** Zeile eines geplanten Projekts: erwartete Frames heute Nacht und ob sie nur für diese Nacht aus ist. */
export const TonightLine = z
  .object({
    lineId: Uuid,
    filter: z.string(),
    frames: z.number().int().min(0),
    /** Nur für die aktuelle Nacht abgeschaltet (`exposure_line.disabled_for_night`, FA-FOL-05). */
    disabledTonight: z.boolean(),
  })
  .meta({ id: 'TonightLine' });

export const TonightProject = z
  .object({
    projectId: Uuid,
    name: z.string(),
    priority: z.number().int().nullable(),
    /** Erwartete Frames der Nacht (ungewichtet, Simulation der Prognose). */
    frames: z.number().int().min(0),
    hours: z.number().min(0),
    lines: z.array(TonightLine),
  })
  .meta({ id: 'TonightProject' });

/** Stunde des Farbbands im Nachtfenster (Bewertung wie `WeatherChart`). */
export const TonightWeatherHour = z
  .object({
    tUtc: UtcInstant,
    overallScore: z.number().min(0).max(1).nullable(),
    ratingIndex: z.number().int().min(0).max(4).nullable(),
    sunAltDeg: z.number().nullable(),
  })
  .meta({ id: 'TonightWeatherHour' });

export const TonightWeather = z
  .object({
    nightMean: z.number().min(0).max(1).nullable(),
    ratingIndex: z.number().int().min(0).max(4).nullable(),
    coverage: z.number().min(0).max(1).nullable(),
    bestWindow: WeatherBestWindow.nullable(),
    aerosolMissing: z.boolean(),
    hours: z.array(TonightWeatherHour),
  })
  .meta({ id: 'TonightWeather' });

export const TonightInstance = z
  .object({
    id: Uuid,
    name: z.string(),
    lastSeenAt: UtcInstant.nullable(),
    state: z.string().nullable(),
  })
  .meta({ id: 'TonightInstance' });

export const TonightRig = z
  .object({
    rigId: Uuid,
    rigName: z.string(),
    siteId: Uuid,
    siteName: z.string(),
    siteTimeZone: z.string(),
    /** Link zur Safety-/Wetterseite der Sternwarte (`site.weather_safety_url`). */
    weatherSafetyUrl: z.string().nullable(),
    night: NightKey,
    nightWindow: z.object({ startUtc: UtcInstant, endUtc: UtcInstant }).nullable(),
    /** Astronomische Dunkelheit; `null` = Polartag. */
    dark: z.object({ fromUtc: UtcInstant, toUtc: UtcInstant }).nullable(),
    darkHours: z.number().min(0),
    moon: z.object({
      illumPct: z.number().min(0).max(100),
      events: z.array(z.object({ type: z.enum(['rise', 'set']), atUtc: UtcInstant })),
    }),
    /** `null` = für diese Nacht noch keine Vorhersage. */
    weather: TonightWeather.nullable(),
    forecast: z.object({
      computedAt: UtcInstant.nullable(),
      /** Die gespeicherte Prognose enthält diese Nacht. */
      covered: z.boolean(),
    }),
    projects: z.array(TonightProject),
    /** Aktive Projekte ohne Frames in dieser Nacht. */
    idleProjects: z.number().int().min(0),
    instances: z.array(TonightInstance),
  })
  .meta({ id: 'TonightRig' });

export const TonightView = z
  .object({ generatedAt: UtcInstant, rigs: z.array(TonightRig) })
  .meta({ id: 'TonightView' });

/** Zeile nur für die kommende Nacht ab- bzw. wieder einschalten (FA-FOL-05). */
export const LineTonightInput = z
  .object({ disabled: z.boolean() })
  .strict()
  .meta({ id: 'LineTonightInput' });
