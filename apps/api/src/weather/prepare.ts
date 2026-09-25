/**
 * Stundenaufbereitung (specs/engine/weather.md §1.2–§1.6; WS-12…WS-15) nach
 * legacy/astro-tools-2026-09-21/js/astro-weather.js `load()`: Intervallwerte vom Stempel `t + 1 h`,
 * Suffix-Vorrang, Nest-Erkennung mit Latch und `NEST_MAX_H`, feines Modell nach dem Nest, NBM für Sicht
 * und Regenwahrscheinlichkeit, `weatherCode` neu ableiten, `modelId` je Stunde. Rein – ohne Uhr und I/O;
 * `nowUnix` und die Mondhöhe kommen vom Aufrufer.
 */
import type { CloudSource, WeatherHourly, WeatherModelId } from '@nina-pm/engine';
import type { HourlyBlock, ModelChain } from './open-meteo';

/** Anzeigefelder über §1.1 hinaus: die beiden Vergleichszeilen (FA-WET-01, S-50). */
export interface PreparedHour extends WeatherHourly {
  readonly cloudEcmwfPct: number | null;
  readonly cloudCmp3Pct: number | null;
}

export type Cmp3Source = 'gem' | 'nbm' | 'base';

export interface PrepareInput {
  readonly chain: ModelChain;
  readonly main: HourlyBlock;
  readonly aerosol: HourlyBlock | null;
  readonly compare: HourlyBlock | null;
  readonly nowUnix: number;
  /** Geometrische topozentrische Mondhöhe zu `tUnix + 1800` (§3.3). */
  readonly moonAltDeg: (tUnix: number) => number | null;
}

/** Nordamerika: HRRR nur für die ersten 30 h (§1.4); Europa ohne Grenze. */
export const NEST_MAX_H_AMERICA = 30;

/** Suffix-Vorrang (§1.3): suffigiertes Feld vor einfachem Feld. */
export function pick(
  block: HourlyBlock,
  ...keys: string[]
): readonly (number | null)[] | undefined {
  for (const key of keys) {
    const series = block[key];
    if (series) return series;
  }
  return undefined;
}

const at = (series: readonly (number | null)[] | undefined, i: number): number | null =>
  series?.[i] ?? null;

/** Wert je Zeitstempel einer Reihe (Vergleichs- und Aerosolabruf haben eigene Zeitachsen). */
function byTime(block: HourlyBlock, series: readonly (number | null)[] | undefined) {
  const out = new Map<number, number | null>();
  if (!series) return out;
  block.time.forEach((t, i) => out.set(t, series[i] ?? null));
  return out;
}

/** Intervallwerte (§1.2): beschreiben die vorangehende Stunde, gehören also zur Spalte `t − 1 h`. */
const INTERVAL = new Set(['wind_gusts_10m', 'precipitation', 'precipitation_probability']);

export function prepareHours(input: PrepareInput): { hours: PreparedHour[]; cmp3: Cmp3Source } {
  const { chain, main, aerosol, compare } = input;
  const n = main.time.length;
  const raw = (key: string, i: number): number | null =>
    INTERVAL.has(key) ? (i + 1 < n ? at(main[key], i + 1) : null) : at(main[key], i);

  const none = new Map<number, number | null>();
  const aod = aerosol ? byTime(aerosol, aerosol.aerosol_optical_depth) : none;
  const dust = aerosol ? byTime(aerosol, aerosol.dust) : none;

  let ecmwf = new Map<number, number | null>();
  let pwv = new Map<number, number | null>();
  let cmp3 = new Map<number, number | null>();
  const nestT = new Map<number, number | null>();
  const nestC = new Map<number, number | null>();
  const fine = new Map<
    number,
    { c: number; low: number | null; mid: number | null; high: number | null; vis: number | null }
  >();
  const nbm = new Map<number, { vis: number | null; prob: number | null }>();
  if (compare) {
    ecmwf = byTime(compare, pick(compare, 'cloud_cover_ecmwf_ifs', 'cloud_cover'));
    pwv = byTime(
      compare,
      pick(
        compare,
        'total_column_integrated_water_vapour_ecmwf_ifs',
        'total_column_integrated_water_vapour',
      ),
    );
    cmp3 = byTime(compare, compare[`cloud_cover_${chain.cmp3}`]);
    const nt = pick(compare, 'temperature_2m_icon_d2', 'temperature_2m_ncep_hrrr_conus');
    const nc = pick(compare, 'cloud_cover_icon_d2', 'cloud_cover_ncep_hrrr_conus');
    const nbmC = compare.cloud_cover_ncep_nbm_conus;
    const fnC = compare[`cloud_cover_${chain.fine}`];
    compare.time.forEach((t, i) => {
      if (nt && nc) {
        nestT.set(t, at(nt, i));
        nestC.set(t, at(nc, i));
      }
      const c = at(fnC, i);
      if (c !== null)
        fine.set(t, {
          c,
          low: at(compare[`cloud_cover_low_${chain.fine}`], i),
          mid: at(compare[`cloud_cover_mid_${chain.fine}`], i),
          high: at(compare[`cloud_cover_high_${chain.fine}`], i),
          vis: at(compare[`visibility_${chain.fine}`], i),
        });
      if (at(nbmC, i) !== null)
        nbm.set(t, {
          vis: at(compare.visibility_ncep_nbm_conus, i),
          prob: at(compare.precipitation_probability_ncep_nbm_conus, i),
        });
    });
  }
  // Kein Wert für die dritte Zeile: sie zeigt dann das Basismodell (Vorlage `cmp3Base`).
  const cmp3Base = cmp3.size === 0;
  const cmp3Source: Cmp3Source = cmp3Base ? 'base' : chain.europe ? 'gem' : 'nbm';

  const nestUntil = chain.europe ? Infinity : input.nowUnix + NEST_MAX_H_AMERICA * 3600;
  let nestSeen = false;
  let nestOver = false;
  const hours = main.time.map((t, i): PreparedHour => {
    const h = {
      tUnix: t,
      cloudTotalPct: raw('cloud_cover', i),
      cloudLowPct: raw('cloud_cover_low', i),
      cloudMidPct: raw('cloud_cover_mid', i),
      cloudHighPct: raw('cloud_cover_high', i),
      tempC: raw('temperature_2m', i),
      dewPointC: raw('dew_point_2m', i),
      humidityPct: raw('relative_humidity_2m', i),
      wind10Kmh: raw('wind_speed_10m', i),
      gust10Kmh: raw('wind_gusts_10m', i),
      windDir10Deg: raw('wind_direction_10m', i),
      wind250Kmh: raw('wind_speed_250hPa', i),
      windDir250Deg: raw('wind_direction_250hPa', i),
      wind500Kmh: raw('wind_speed_500hPa', i),
      windDir500Deg: raw('wind_direction_500hPa', i),
      wind700Kmh: raw('wind_speed_700hPa', i),
      windDir700Deg: raw('wind_direction_700hPa', i),
      wind850Kmh: raw('wind_speed_850hPa', i),
      windDir850Deg: raw('wind_direction_850hPa', i),
      surfacePressureHPa: raw('surface_pressure', i),
      visibilityM: raw('visibility', i),
      precipMm: raw('precipitation', i),
      precipProbPct: raw('precipitation_probability', i),
      weatherCode: raw('weather_code', i),
      aod: aod.get(t) ?? null,
      dustUgM3: dust.get(t) ?? null,
      pwvMm: pwv.get(t) ?? null,
      cloudEcmwfPct: ecmwf.get(t) ?? null,
      cloudCmp3Pct: null as number | null,
      cloudSrc: null as CloudSource | null,
      nest: false,
    };
    h.cloudCmp3Pct = cmp3Base ? h.cloudTotalPct : (cmp3.get(t) ?? null);

    // §1.4 Nest-Erkennung mit Latch: nach dem ersten Verlassen kein Wiedereinstieg.
    const nt = nestT.get(t) ?? null;
    const nc = nestC.get(t) ?? null;
    const nestHere =
      nt !== null &&
      nc !== null &&
      h.tempC !== null &&
      Math.abs(nt - h.tempC) < 0.05 &&
      nc === h.cloudTotalPct;
    if (nestSeen && nt !== null && !nestHere) nestOver = true;
    if (nestHere && !nestOver) nestSeen = true;
    h.nest = nestHere && !nestOver && t <= nestUntil;

    if (!h.nest) {
      const fn = fine.get(t);
      if (fn) {
        h.cloudTotalPct = fn.c;
        h.cloudSrc = chain.europe ? 'dini' : 'gem';
        if (fn.low !== null) h.cloudLowPct = fn.low;
        if (fn.mid !== null) h.cloudMidPct = fn.mid;
        if (fn.high !== null) h.cloudHighPct = fn.high;
        // Eine glatte 0 ist ein Füllwert, keine Nebelstunde.
        if (fn.vis !== null && fn.vis > 0) h.visibilityM = fn.vis;
      }
      const nb = nbm.get(t);
      if (nb) {
        if (nb.vis !== null && nb.vis > 0) h.visibilityM = nb.vis;
        const next = nbm.get(t + 3600); // Intervallwert, §1.2
        if (next && next.prob !== null) h.precipProbPct = next.prob;
      }
    }

    // §1.6: reiner Wolkencode aus der feineren Bedeckung; Niederschlagscodes bleiben.
    if (
      h.cloudSrc !== null &&
      h.weatherCode !== null &&
      h.weatherCode <= 3 &&
      h.cloudTotalPct !== null
    )
      h.weatherCode =
        h.cloudTotalPct < 12.5 ? 0 : h.cloudTotalPct < 37.5 ? 1 : h.cloudTotalPct < 75 ? 2 : 3;

    return { ...h, modelId: modelIdOf(chain.europe, h), moonAltDeg: input.moonAltDeg(t) };
  });
  return { hours, cmp3: cmp3Source };
}

/** §1.5: welches Modell die Stunde trägt. */
export function modelIdOf(
  europe: boolean,
  h: { nest: boolean; cloudSrc: CloudSource | null; visibilityM: number | null },
): WeatherModelId {
  if (europe)
    return h.nest
      ? 'd2'
      : h.cloudSrc === 'dini'
        ? 'dini'
        : h.visibilityM !== null
          ? 'eu'
          : 'global';
  return h.nest ? 'hrrr' : h.cloudSrc === 'gem' ? 'gem' : 'gfs';
}
