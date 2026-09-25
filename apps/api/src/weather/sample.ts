/**
 * Beispiel-Anbieter für die lokale Entwicklung und E2E (nur `local.ts`, nie im Lambda-Bundle der Worker-
 * Kette): bildet die drei Open-Meteo-Antworten deterministisch aus Ort und Zeit nach – wechselnde
 * Bewölkung über die Tage, Nest in den ersten 24 h, Aerosol nur 5 Tage (CAMS-Horizont). Echte Abrufe lokal
 * mit `LOCAL_WEATHER=live`.
 */
import type { HttpClient } from '../lib/http-client';
import { AEROSOL_HOURLY, MAIN_HOURLY, modelChain } from './open-meteo';

const HOUR = 3600;

/** Weiche Schwingung 0…1 aus Zeit und Phase (keine Zufallszahlen – gleiche Eingabe, gleiche Antwort). */
const wave = (t: number, periodH: number, phase: number) =>
  0.5 + 0.5 * Math.sin((2 * Math.PI * t) / (periodH * HOUR) + phase);

export function sampleOpenMeteo(now: () => Date): HttpClient {
  return {
    getJson(url) {
      const q = new URL(url).searchParams;
      const lat = Number(q.get('latitude'));
      const lon = Number(q.get('longitude'));
      const day = Math.floor(now().getTime() / 86_400_000) * 86_400;
      const time = Array.from({ length: 8 * 24 }, (_, i) => day - 86_400 + i * HOUR);
      const cloud = (t: number) => Math.round(100 * wave(t, 53, lat) ** 2);
      const series = (f: (t: number, i: number) => number | null) => time.map((t, i) => f(t, i));
      if (url.includes('air-quality-api')) {
        const hourly: Record<string, unknown> = { time };
        for (const k of AEROSOL_HOURLY)
          hourly[k] = series((t, i) =>
            i >= 6 * 24
              ? null
              : k === 'dust'
                ? 5 + 20 * wave(t, 70, 1)
                : 0.04 + 0.2 * wave(t, 40, 2),
          );
        return Promise.resolve({ hourly });
      }
      if (url.includes('/v1/forecast')) {
        const chain = modelChain(lat, lon);
        const nest = chain.europe ? 'icon_d2' : 'ncep_hrrr_conus';
        const hourly: Record<string, unknown> = { time };
        for (const m of chain.models) {
          hourly[`cloud_cover_${m}`] = series((t) => Math.min(100, cloud(t) + 8));
          hourly[`cloud_cover_low_${m}`] = series((t) => Math.round(cloud(t) / 3));
          hourly[`cloud_cover_mid_${m}`] = series((t) => Math.round(cloud(t) / 2));
          hourly[`cloud_cover_high_${m}`] = series((t) => cloud(t));
          hourly[`total_column_integrated_water_vapour_${m}`] = series(
            (t) => 8 + 30 * wave(t, 90, 0),
          );
          hourly[`temperature_2m_${m}`] = series((t) => 12 + 10 * wave(t, 24, 3));
          hourly[`visibility_${m}`] = series(() => 30_000);
          hourly[`precipitation_probability_${m}`] = series((t) => Math.round(cloud(t) / 2));
        }
        const inNest = (i: number) => i < 48;
        hourly[`temperature_2m_${nest}`] = series((t, i) =>
          inNest(i) ? 12 + 10 * wave(t, 24, 3) : null,
        );
        hourly[`cloud_cover_${nest}`] = series((t, i) => (inNest(i) ? cloud(t) : null));
        return Promise.resolve({ hourly });
      }
      const values: Record<(typeof MAIN_HOURLY)[number], (t: number) => number | null> = {
        cloud_cover: cloud,
        cloud_cover_low: (t) => Math.round(cloud(t) / 3),
        cloud_cover_mid: (t) => Math.round(cloud(t) / 2),
        cloud_cover_high: cloud,
        temperature_2m: (t) => 12 + 10 * wave(t, 24, 3),
        dew_point_2m: (t) => 6 + 6 * wave(t, 36, 1),
        relative_humidity_2m: (t) => 40 + 50 * wave(t, 30, 2),
        wind_speed_10m: (t) => 4 + 30 * wave(t, 19, 0),
        wind_gusts_10m: (t) => 10 + 40 * wave(t, 19, 0),
        wind_direction_10m: (t) => (200 + 90 * wave(t, 31, 0)) % 360,
        wind_speed_250hPa: (t) => 30 + 120 * wave(t, 61, 1),
        wind_direction_250hPa: () => 270,
        wind_speed_500hPa: (t) => 20 + 50 * wave(t, 47, 2),
        wind_direction_500hPa: () => 260,
        wind_speed_700hPa: (t) => 15 + 30 * wave(t, 41, 3),
        wind_direction_700hPa: () => 250,
        wind_speed_850hPa: (t) => 10 + 25 * wave(t, 37, 4),
        wind_direction_850hPa: () => 240,
        surface_pressure: () => 990,
        visibility: () => 24_000,
        precipitation: (t) => (cloud(t) > 85 ? 1.2 : 0),
        precipitation_probability: (t) => Math.round(cloud(t) / 1.5),
        weather_code: (t) => (cloud(t) > 90 ? 61 : cloud(t) > 60 ? 3 : cloud(t) > 30 ? 2 : 0),
      };
      const hourly: Record<string, unknown> = { time };
      for (const k of MAIN_HOURLY) hourly[k] = series(values[k]);
      return Promise.resolve({ hourly });
    },
  };
}
