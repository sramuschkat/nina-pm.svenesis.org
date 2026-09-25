/**
 * Nachbildung der drei Open-Meteo-Abrufe (AP-23): Antworten mit `time` (Unix-Sekunden, stündlich) und den
 * Reihen der Variablenlisten; Ausfall je Abruf schaltbar, aufgerufene URLs werden mitgeschrieben.
 */
import { HttpError, type HttpClient } from '../../src/lib/http-client';
import { AEROSOL_HOURLY, MAIN_HOURLY, modelChain } from '../../src/weather/open-meteo';

export type Series = Record<string, (number | null)[]>;

/** Stündliche Zeitachse ab `startUnix` (volle Stunde). */
export const hoursFrom = (startUnix: number, n: number) =>
  Array.from({ length: n }, (_, i) => startUnix + i * 3600);

const MAIN_DEFAULT: Record<(typeof MAIN_HOURLY)[number], number> = {
  cloud_cover: 20,
  cloud_cover_low: 5,
  cloud_cover_mid: 10,
  cloud_cover_high: 20,
  temperature_2m: 18,
  dew_point_2m: 8,
  relative_humidity_2m: 55,
  wind_speed_10m: 12,
  wind_gusts_10m: 25,
  wind_direction_10m: 200,
  wind_speed_250hPa: 90,
  wind_direction_250hPa: 270,
  wind_speed_500hPa: 60,
  wind_direction_500hPa: 260,
  wind_speed_700hPa: 40,
  wind_direction_700hPa: 250,
  wind_speed_850hPa: 30,
  wind_direction_850hPa: 240,
  surface_pressure: 990,
  visibility: 24000,
  precipitation: 0,
  precipitation_probability: 5,
  weather_code: 1,
};

export function mainResponse(time: number[], over: Series = {}) {
  const hourly: Record<string, unknown> = { time };
  for (const [k, v] of Object.entries(MAIN_DEFAULT)) hourly[k] = time.map(() => v);
  Object.assign(hourly, over);
  return { hourly };
}

/** CAMS: eigener, kürzerer Horizont – ab `horizon` Stunden `null`. */
export function aerosolResponse(time: number[], horizon = time.length, over: Series = {}) {
  const hourly: Record<string, unknown> = { time };
  for (const k of AEROSOL_HOURLY)
    hourly[k] = time.map((_, i) => (i < horizon ? (k === 'dust' ? 12 : 0.14) : null));
  Object.assign(hourly, over);
  return { hourly };
}

/** Modellvergleich mit Suffixen je Modell; `nestHours` Stunden gleich dem Hauptmodell (Nest). */
export function compareResponse(
  time: number[],
  lat: number,
  lon: number,
  o: { nestHours?: number; main?: Series; over?: Series } = {},
) {
  const chain = modelChain(lat, lon);
  const hourly: Record<string, unknown> = { time };
  const mainTemp = o.main?.temperature_2m ?? time.map(() => MAIN_DEFAULT.temperature_2m);
  const mainCloud = o.main?.cloud_cover ?? time.map(() => MAIN_DEFAULT.cloud_cover);
  const nest = chain.europe ? 'icon_d2' : 'ncep_hrrr_conus';
  const nestHours = o.nestHours ?? 0;
  for (const m of chain.models) {
    hourly[`cloud_cover_${m}`] = time.map(() => 40);
    hourly[`cloud_cover_low_${m}`] = time.map(() => 10);
    hourly[`cloud_cover_mid_${m}`] = time.map(() => 15);
    hourly[`cloud_cover_high_${m}`] = time.map(() => 30);
    hourly[`total_column_integrated_water_vapour_${m}`] = time.map(() => 18);
    hourly[`temperature_2m_${m}`] = time.map(() => 15);
    hourly[`visibility_${m}`] = time.map(() => 30000);
    hourly[`precipitation_probability_${m}`] = time.map(() => 10);
  }
  hourly[`temperature_2m_${nest}`] = time.map((_, i) =>
    i < nestHours ? (mainTemp[i] ?? null) : 5,
  );
  hourly[`cloud_cover_${nest}`] = time.map((_, i) => (i < nestHours ? (mainCloud[i] ?? null) : 90));
  Object.assign(hourly, o.over ?? {});
  return { hourly };
}

export interface FakeOpenMeteo extends HttpClient {
  readonly urls: string[];
}

export function fakeOpenMeteo(
  responses: { main?: unknown; aerosol?: unknown; compare?: unknown },
  fail: { main?: number | 'network'; aerosol?: boolean; compare?: boolean } = {},
): FakeOpenMeteo {
  const urls: string[] = [];
  return {
    urls,
    getJson(url) {
      urls.push(url);
      if (url.includes('air-quality-api')) {
        if (fail.aerosol) return Promise.reject(new HttpError(503, url));
        return Promise.resolve(responses.aerosol);
      }
      if (url.includes('/v1/forecast')) {
        if (fail.compare) return Promise.reject(new Error('fetch failed'));
        return Promise.resolve(responses.compare);
      }
      if (fail.main === 'network') return Promise.reject(new Error('fetch failed'));
      if (fail.main) return Promise.reject(new HttpError(fail.main, url));
      return Promise.resolve(responses.main);
    },
  };
}
