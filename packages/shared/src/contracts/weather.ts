/**
 * Astro-Wetter (AP-23; FA-WET-01…09, S-50; TK 8.2, specs/engine/weather.md §3.4): Sicht der API auf die
 * Zeile `weather_cache` eines Standorts. Scores sind hier **gerundet** (`q(x, 1e3)` unmittelbar vor der
 * Ausgabe, WS-08) – im `payload` stehen sie ungerundet. Zeitpunkte ISO-UTC (rules/api.md); `tUtc` ist der
 * Stundenanfang (`tUnix` im `payload`).
 */
import { z } from 'zod';
import { cloudSources, weatherModels } from '../generated/enums';
import { UtcInstant } from './common';

const num = z.number().nullable();
const score = z.number().min(0).max(1).nullable();

export const WeatherHourView = z
  .object({
    tUtc: UtcInstant,
    cloudTotalPct: num,
    cloudLowPct: num,
    cloudMidPct: num,
    cloudHighPct: num,
    /** Zweite Meinung ECMWF IFS (nur Anzeige). */
    cloudEcmwfPct: num,
    /** Dritte Meinung (`WeatherView.cmp3`; nur Anzeige). */
    cloudCmp3Pct: num,
    tempC: num,
    dewPointC: num,
    humidityPct: num,
    wind10Kmh: num,
    gust10Kmh: num,
    windDir10Deg: num,
    wind250Kmh: num,
    windDir250Deg: num,
    wind500Kmh: num,
    windDir500Deg: num,
    wind700Kmh: num,
    windDir700Deg: num,
    wind850Kmh: num,
    windDir850Deg: num,
    surfacePressureHPa: num,
    visibilityM: num,
    precipMm: num,
    precipProbPct: num,
    weatherCode: z.number().int().nullable(),
    aod: num,
    dustUgM3: num,
    pwvMm: num,
    jetKmh: num,
    shearKmh: num,
    /** Geometrische topozentrische Mondhöhe zur Stundenmitte – nur Grundlage von `moonFreeSec`. */
    moonAltDeg: num,
    /** Geometrische Sonnenhöhe zur Stundenmitte (Tageslicht-Abstufung, components.md §2.5). */
    sunAltDeg: z.number(),
    /** Rohwert erlaubt: ein neuer Wert von `weatherModels` darf die Anzeige nicht brechen. */
    modelId: z.union([z.enum(weatherModels), z.string()]),
    cloudSrc: z.enum(cloudSources).nullable(),
    nest: z.boolean(),
    aerosolMissing: z.boolean(),
    seeingIncomplete: z.boolean(),
    cloudScore: score,
    seeingScore: score,
    transparencyScore: score,
    overallScore: score,
    ratingIndex: z.number().int().min(0).max(4).nullable(),
  })
  .meta({ id: 'WeatherHourView' });

export const WeatherBestWindow = z
  .object({
    fromUtc: UtcInstant,
    toUtc: UtcInstant,
    sec: z.number().int(),
    moonFreeSec: z.number().int(),
    meanScore: z.number().min(0).max(1),
    fair: z.boolean(),
  })
  .meta({ id: 'WeatherBestWindow' });

export const WeatherNightView = z
  .object({
    night: z.iso.date(),
    /** Astronomische Dunkelheit (−18°, night.md §2); `null` = Polartag. */
    darkFromUtc: UtcInstant.nullable(),
    darkToUtc: UtcInstant.nullable(),
    nightMean: score,
    ratingIndex: z.number().int().min(0).max(4).nullable(),
    coveredSec: z.number().int(),
    darknessSec: z.number().int(),
    coverage: z.number().min(0).max(1).nullable(),
    /** Dunkle Sekunden mit Mond unter −0,833° (Konvention der Vorlage, nur Anzeige). */
    moonlessSec: z.number().int(),
    bestWindow: WeatherBestWindow.nullable(),
    aerosolMissing: z.boolean(),
    seeingIncomplete: z.boolean(),
    moonIllumPct: z.number().min(0).max(100),
    moonEvents: z.array(z.object({ type: z.enum(['rise', 'set']), atUtc: UtcInstant })),
  })
  .meta({ id: 'WeatherNightView' });

export const WeatherWindow = z.object({
  night: z.iso.date(),
  startUtc: UtcInstant,
  endUtc: UtcInstant,
});

export const WeatherView = z
  .object({
    siteId: z.uuid(),
    latitudeDeg: z.number(),
    longitudeDeg: z.number(),
    timeZone: z.string(),
    /** `pending`: noch kein Abruf für diesen Standort (der stündliche Lauf holt ihn nach). */
    status: z.enum(['ready', 'pending']),
    fetchedAtUtc: UtcInstant.nullable(),
    expiresAtUtc: UtcInstant.nullable(),
    /** Modellsatz des Laufs (`weather_cache.model_set`, WS-16). */
    modelSet: z.string().nullable(),
    region: z.enum(['europe', 'other']),
    /** Quelle der dritten Wolkenzeile: GEM (Europa), NBM (Nordamerika) oder das Basismodell. */
    cmp3: z.enum(['gem', 'nbm', 'base']),
    /** Vorhersagehorizont der Stundenreihe (`forecast_days=7`, TK 14). */
    days: z.literal(7),
    hours: z.array(WeatherHourView),
    nights: z.array(WeatherNightView),
    /** Nachtfenster (night.md §3) je Nacht der Stundenreihe. */
    nightWindows: z.array(WeatherWindow),
    /** Astronomische Dunkelheit je Nacht; Polartag-Nächte fehlen. */
    darkWindows: z.array(WeatherWindow),
    tzdataVersion: z.string(),
    timeZoneTransitions: z.array(
      z.object({ atUtc: UtcInstant, utcOffsetMinutes: z.number().int() }),
    ),
  })
  .meta({ id: 'WeatherView' });
