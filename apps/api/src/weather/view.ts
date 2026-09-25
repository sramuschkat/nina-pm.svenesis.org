/**
 * Sicht `WeatherView` (AP-23, S-50) aus der jüngsten `weather_cache`-Zeile des Orts: Scores aus dem
 * `payload` (ungerundet) werden **hier**, unmittelbar vor der Ausgabe, mit `q(x, 1e3)` gerundet (WS-08).
 * Nachtfenster, Dunkelheit, Sonnenhöhe, Mondbeleuchtung und Mondauf-/-untergänge rechnet der Server je
 * Anfrage aus der Zeitzonentabelle (night.md §1); der Baustein `WeatherChart` bewertet nichts.
 */
import {
  moonAt,
  moonEvents,
  MOON_FREE_BELOW_DEG,
  q,
  ratingIndex,
  sunAt,
  type DarkWindow,
} from '@nina-pm/engine';
import type { WeatherCacheEntry } from '@nina-pm/db';
import type { WeatherView } from '@nina-pm/shared';
import type { z } from 'zod';
import { isoUtc } from '../lib/format';
import { tzdataVersion } from '../lib/night-table';
import type { WeatherPayload } from './job';
import { weatherNightTable, type WeatherSiteGeo } from './nights';
import { inEurope } from './open-meteo';

type View = z.infer<typeof WeatherView>;

const iso = (unix: number) => isoUtc(new Date(unix * 1000));
const r3 = (x: number | null) => (x === null ? null : q(x, 1e3));
const HOUR = 3600;

export function weatherView(
  site: WeatherSiteGeo & { readonly id: string },
  entry: WeatherCacheEntry | undefined,
  now: Date,
): View {
  const payload = entry?.payload as WeatherPayload | undefined;
  const hoursRaw = payload?.hours ?? [];
  const lastHour = hoursRaw[hoursRaw.length - 1]?.tUnix ?? Math.floor(now.getTime() / 1000);
  const table = weatherNightTable(site, now, lastHour);
  const keepFrom = table.nights[0]?.noonStartUtc ?? 0;
  const geo = { latDeg: site.latitudeDeg, lonDeg: site.longitudeDeg };
  const hours = hoursRaw.filter((h) => h.tUnix >= keepFrom);
  const stored = new Map((payload?.nights ?? []).map((n) => [n.night, n]));
  const darkOf = new Map<string, DarkWindow>();
  for (const n of table.nights) if (n.dark) darkOf.set(n.night, n.dark);

  const nights = table.nights
    .filter((n) => hours.some((h) => h.tUnix < n.noonEndUtc && h.tUnix + HOUR > n.noonStartUtc))
    .map((n) => {
      const s = stored.get(n.night);
      const dark = darkOf.get(n.night) ?? null;
      let moonlessSec = 0;
      if (dark)
        for (const h of hours) {
          const part = Math.min(h.tUnix + HOUR, dark.toUtc) - Math.max(h.tUnix, dark.fromUtc);
          if (part > 0 && h.moonAltDeg !== null && h.moonAltDeg < MOON_FREE_BELOW_DEG)
            moonlessSec += part;
        }
      const mid = dark ? (dark.fromUtc + dark.toUtc) / 2 : (n.noonStartUtc + n.noonEndUtc) / 2;
      const nightMean = s?.nightMean ?? null;
      return {
        night: n.night,
        darkFromUtc: dark ? iso(dark.fromUtc) : null,
        darkToUtc: dark ? iso(dark.toUtc) : null,
        nightMean: r3(nightMean),
        ratingIndex: ratingIndex(r3(nightMean)),
        coveredSec: s?.coveredSec ?? 0,
        darknessSec: s?.darknessSec ?? (dark ? dark.toUtc - dark.fromUtc : 0),
        coverage: s ? r3(s.coverage) : dark ? 0 : null,
        moonlessSec,
        bestWindow: s?.bestWindow
          ? { ...s.bestWindow, meanScore: q(s.bestWindow.meanScore, 1e3) }
          : null,
        aerosolMissing: s?.aerosolMissing ?? false,
        seeingIncomplete: s?.seeingIncomplete ?? false,
        moonIllumPct: q(moonAt(mid, geo).illumPct, 10),
        moonEvents: moonEvents(geo, n.noonStartUtc, n.noonEndUtc).map((e) => ({
          type: e.type,
          atUtc: iso(e.atUtc),
        })),
      };
    });

  const shown = new Set(nights.map((n) => n.night));
  const frames = table.nights.filter((n) => shown.has(n.night));
  return {
    siteId: site.id,
    latitudeDeg: site.latitudeDeg,
    longitudeDeg: site.longitudeDeg,
    timeZone: site.timeZone,
    status: entry ? 'ready' : 'pending',
    fetchedAtUtc: entry ? isoUtc(entry.fetchedAt) : null,
    expiresAtUtc: entry ? isoUtc(entry.expiresAt) : null,
    modelSet: entry?.modelSet ?? null,
    region: inEurope(site.latitudeDeg, site.longitudeDeg) ? 'europe' : 'other',
    cmp3: payload?.cmp3 ?? 'base',
    days: 7,
    hours: hours.map((h) => ({
      tUtc: iso(h.tUnix),
      cloudTotalPct: h.cloudTotalPct,
      cloudLowPct: h.cloudLowPct,
      cloudMidPct: h.cloudMidPct,
      cloudHighPct: h.cloudHighPct,
      cloudEcmwfPct: h.cloudEcmwfPct,
      cloudCmp3Pct: h.cloudCmp3Pct,
      tempC: h.tempC,
      dewPointC: h.dewPointC,
      humidityPct: h.humidityPct,
      wind10Kmh: h.wind10Kmh,
      gust10Kmh: h.gust10Kmh,
      windDir10Deg: h.windDir10Deg,
      wind250Kmh: h.wind250Kmh,
      windDir250Deg: h.windDir250Deg,
      wind500Kmh: h.wind500Kmh,
      windDir500Deg: h.windDir500Deg,
      wind700Kmh: h.wind700Kmh,
      windDir700Deg: h.windDir700Deg,
      wind850Kmh: h.wind850Kmh,
      windDir850Deg: h.windDir850Deg,
      surfacePressureHPa: h.surfacePressureHPa,
      visibilityM: h.visibilityM,
      precipMm: h.precipMm,
      precipProbPct: h.precipProbPct,
      weatherCode: h.weatherCode,
      aod: h.aod,
      dustUgM3: h.dustUgM3,
      pwvMm: h.pwvMm,
      jetKmh: h.jetKmh,
      shearKmh: h.shearKmh,
      moonAltDeg: h.moonAltDeg,
      sunAltDeg: q(sunAt(h.tUnix + 1800, geo).altDeg, 1e3),
      modelId: h.modelId,
      cloudSrc: h.cloudSrc,
      nest: h.nest,
      aerosolMissing: h.aerosolMissing,
      seeingIncomplete: h.seeingIncomplete,
      cloudScore: r3(h.cloudScore),
      seeingScore: r3(h.seeingScore),
      transparencyScore: r3(h.transparencyScore),
      overallScore: r3(h.overallScore),
      ratingIndex: h.ratingIndex,
    })),
    nights,
    nightWindows: frames.map((n) => ({
      night: n.night,
      startUtc: iso(n.nightWindow.startUtc),
      endUtc: iso(n.nightWindow.endUtc),
    })),
    darkWindows: frames.flatMap((n) =>
      n.dark ? [{ night: n.night, startUtc: iso(n.dark.fromUtc), endUtc: iso(n.dark.toUtc) }] : [],
    ),
    tzdataVersion: payload?.tzdataVersion ?? tzdataVersion(),
    timeZoneTransitions: table.transitions.map((t) => ({
      atUtc: iso(t.atUtc),
      utcOffsetMinutes: t.utcOffsetMinutes,
    })),
  };
}
