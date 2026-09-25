/**
 * Die drei Open-Meteo-Abrufe je Standort und Lauf (specs/engine/weather.md §1.3, TK 14, WS-13) nach
 * legacy/astro-tools-2026-09-21/js/astro-weather.js `load()` – mit **`timezone=UTC`** statt `auto`
 * (AST-D25): Nacht- und Stundenzuordnung liegen in der Zeitzonentabelle des Servers.
 */

/** Rohvariablen des Hauptabrufs (§1.1 ohne Aerosol, Staub und Wasserdampf). */
export const MAIN_HOURLY = [
  'cloud_cover',
  'cloud_cover_low',
  'cloud_cover_mid',
  'cloud_cover_high',
  'temperature_2m',
  'dew_point_2m',
  'relative_humidity_2m',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'wind_speed_250hPa',
  'wind_direction_250hPa',
  'wind_speed_500hPa',
  'wind_direction_500hPa',
  'wind_speed_700hPa',
  'wind_direction_700hPa',
  'wind_speed_850hPa',
  'wind_direction_850hPa',
  'surface_pressure',
  'visibility',
  'precipitation',
  'precipitation_probability',
  'weather_code',
] as const;

export const AEROSOL_HOURLY = ['aerosol_optical_depth', 'dust'] as const;

export const COMPARE_HOURLY = [
  'cloud_cover',
  'cloud_cover_low',
  'cloud_cover_mid',
  'cloud_cover_high',
  'total_column_integrated_water_vapour',
  'temperature_2m',
  'visibility',
  'precipitation_probability',
] as const;

/** ICON-EU-Gebiet (§1.3): innerhalb Europa-Kette, sonst GFS (über Nordamerika mit HRRR). */
export function inEurope(latDeg: number, lonDeg: number): boolean {
  return latDeg >= 29.5 && latDeg <= 70.5 && lonDeg >= -23.5 && lonDeg <= 62.5;
}

export interface ModelChain {
  readonly europe: boolean;
  /** Feines Modell nach dem Nest (Wolkenzeilen und Sicht). */
  readonly fine: string;
  /** Dritte Wolkenzeile (nur Anzeige). */
  readonly cmp3: string;
  readonly models: readonly string[];
}

export function modelChain(latDeg: number, lonDeg: number): ModelChain {
  const europe = inEurope(latDeg, lonDeg);
  const fine = europe ? 'dmi_harmonie_arome_europe' : 'cmc_gem_seamless';
  const cmp3 = europe ? 'cmc_gem_seamless' : 'ncep_nbm_conus';
  const models = [
    ...new Set([
      'ecmwf_ifs',
      fine,
      cmp3,
      ...(europe ? ['icon_d2'] : ['ncep_hrrr_conus', 'ncep_nbm_conus']),
    ]),
  ];
  return { europe, fine, cmp3, models };
}

/** Gemeinsame Abfrage `q` (§1.3); Koordinaten wie der Cache-Schlüssel auf 3 Stellen. */
export function commonQuery(lat: string, lon: string): string {
  return `latitude=${lat}&longitude=${lon}&forecast_days=7&past_days=1&timeformat=unixtime&timezone=UTC`;
}

export interface WeatherUrls {
  readonly main: string;
  readonly aerosol: string;
  readonly compare: string;
}

export function weatherUrls(lat: string, lon: string): WeatherUrls {
  const chain = modelChain(Number(lat), Number(lon));
  const q = commonQuery(lat, lon);
  return {
    main:
      `https://api.open-meteo.com/v1/${chain.europe ? 'dwd-icon' : 'gfs'}?${q}` +
      `&wind_speed_unit=kmh&hourly=${MAIN_HOURLY.join(',')}`,
    aerosol: `https://air-quality-api.open-meteo.com/v1/air-quality?${q}&hourly=${AEROSOL_HOURLY.join(',')}`,
    compare:
      `https://api.open-meteo.com/v1/forecast?${q}` +
      `&hourly=${COMPARE_HOURLY.join(',')}&models=${chain.models.join(',')}`,
  };
}

/** `weather_cache.model_set` (WS-16): ein ausgefallener optionaler Abruf fehlt mit seinen Kürzeln. */
export function modelSet(europe: boolean, compareOk: boolean, aerosolOk: boolean): string {
  const parts = europe
    ? [
        ...(compareOk ? ['icon-d2', 'harmonie'] : []),
        'icon',
        ...(compareOk ? ['ecmwf', 'gem'] : []),
      ]
    : [...(compareOk ? ['hrrr', 'gem'] : []), 'gfs', ...(compareOk ? ['ecmwf', 'nbm'] : [])];
  return [...parts, ...(aerosolOk ? ['cams'] : [])].join('+');
}

/** `hourly`-Block einer Antwort: `time` plus Reihen (Werte oder `null`). */
export type HourlyBlock = { readonly time: readonly number[] } & Readonly<
  Record<string, readonly (number | null)[] | undefined>
>;

/** `hourly` einer Antwort, wenn sie die erwartete Form hat; sonst `null`. */
export function hourlyOf(body: unknown): HourlyBlock | null {
  if (typeof body !== 'object' || body === null) return null;
  const hourly = (body as { hourly?: unknown }).hourly;
  if (typeof hourly !== 'object' || hourly === null) return null;
  const time = (hourly as { time?: unknown }).time;
  if (!Array.isArray(time) || !time.every((t) => typeof t === 'number')) return null;
  return hourly as HourlyBlock;
}
