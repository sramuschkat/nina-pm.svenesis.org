/**
 * Wetter-Cache `weather_cache` (AP-23; TK 13 Job `weather`, WS-16): systemweit, ohne Mandanten – derselbe
 * Ort teilt sich eine Zeile je Modellsatz, gleich welcher Mandant ihn als Standort führt.
 * - `saveWeather` (Rolle `app_job`): Upsert `ON CONFLICT (lat_round, lon_round, model_set)`.
 * - `latestWeather` (`app_rw` und `app_job`): jüngste Zeile des Orts über alle Modellsätze.
 * - `weatherSites` (`app_job`): Standorte aktiver Mandanten für den stündlichen Lauf.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../types';

/** Rundung des Orts auf 3 Nachkommastellen (≈ 100 m) als Cache-Schlüssel; `-0.000` → `0.000`. */
export function weatherCoord(deg: number): string {
  const s = deg.toFixed(3);
  return s === '-0.000' ? '0.000' : s;
}

export interface WeatherCacheEntry {
  readonly latRound: string;
  readonly lonRound: string;
  readonly modelSet: string;
  readonly payload: unknown;
  readonly fetchedAt: Date;
  readonly expiresAt: Date;
}

export async function latestWeather(
  db: Kysely<Database>,
  latitudeDeg: number,
  longitudeDeg: number,
): Promise<WeatherCacheEntry | undefined> {
  const row = await db
    .selectFrom('weatherCache')
    .select(['latRound', 'lonRound', 'modelSet', 'payload', 'fetchedAt', 'expiresAt'])
    .where('latRound', '=', weatherCoord(latitudeDeg))
    .where('lonRound', '=', weatherCoord(longitudeDeg))
    .orderBy('fetchedAt', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!row) return undefined;
  return {
    ...row,
    payload: typeof row.payload === 'string' ? (JSON.parse(row.payload) as unknown) : row.payload,
  };
}

export async function saveWeather(
  db: Kysely<Database>,
  entry: {
    readonly latitudeDeg: number;
    readonly longitudeDeg: number;
    readonly modelSet: string;
    readonly payload: unknown;
    readonly fetchedAt: Date;
    readonly expiresAt: Date;
  },
): Promise<void> {
  await db
    .insertInto('weatherCache')
    .values({
      latRound: weatherCoord(entry.latitudeDeg),
      lonRound: weatherCoord(entry.longitudeDeg),
      modelSet: entry.modelSet,
      payload: JSON.stringify(entry.payload),
      fetchedAt: entry.fetchedAt,
      expiresAt: entry.expiresAt,
    })
    .onConflict((oc) =>
      oc.columns(['latRound', 'lonRound', 'modelSet']).doUpdateSet((eb) => ({
        payload: eb.ref('excluded.payload'),
        fetchedAt: eb.ref('excluded.fetchedAt'),
        expiresAt: eb.ref('excluded.expiresAt'),
      })),
    )
    .execute();
}

export interface WeatherSite {
  readonly tenantId: string;
  readonly siteId: string;
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly timeZone: string;
}

/** Standorte aktiver Mandanten, nach Ort sortiert (gleiche Orte folgen aufeinander). */
export async function weatherSites(db: Kysely<Database>): Promise<WeatherSite[]> {
  const rows = await db
    .selectFrom('site as s')
    .innerJoin('tenant as t', 't.id', 's.tenantId')
    .select(['s.tenantId', 's.id', 's.latitudeDeg', 's.longitudeDeg', 's.timeZone'])
    .where('t.status', '=', 'active')
    .orderBy('s.latitudeDeg')
    .orderBy('s.longitudeDeg')
    .orderBy('s.id')
    .execute();
  return rows.map((r) => ({
    tenantId: r.tenantId,
    siteId: r.id,
    latitudeDeg: r.latitudeDeg,
    longitudeDeg: r.longitudeDeg,
    timeZone: r.timeZone,
  }));
}
