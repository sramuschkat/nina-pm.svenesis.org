/**
 * Klarnacht-Statistik (AP-30; FA-AUS-16/17; S-64; TK 7.2) – das Sitzungsprotokoll zum Pflegen entfällt seit AP-77, die Tabelle
 * `session_log` bleibt mit ihren Altwerten stehen (Seeing/SQM/Transparenz der Klarnacht-Daten):
 * - Klarnacht-Daten je Standort und Zeitraum: `site_night_stat`, Sessions der Rigs des Standorts mit
 *   Schnappschuss, Protokoll und Verworfen-Quote. Das manuelle Erfassen „nicht genutzt“ entfällt seit AP-77 (alte
 *   Einträge `source = manual` bleiben gültig).
 * - Außerhalb des Mandanten-Repos: Schnappschuss zum Sessionbeginn speichern, Statistik am Sessionende
 *   schreiben (Jobs bzw. NINA-API), Vorhersage je Standort und Nacht aus dem Wetter-Cache festhalten
 *   (`site_night_forecast`, AP-64b, worker im `tick-5min`).
 */
import { ProblemError, isUsableNight } from '@nina-pm/shared';
import { sql, type Kysely } from 'kysely';
import { withTx } from '../tx';
import type { Database } from '../types';
import { TenantRepo } from './base';

const iso = (v: Date | string | null | undefined): string | null =>
  v === null || v === undefined ? null : new Date(v).toISOString().replace(/\.\d{3}Z$/, 'Z');
const parseJson = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export interface ClearNightRawSession {
  readonly id: string;
  readonly night: string;
  readonly startedAt: string;
  readonly forecastSnapshot: unknown;
  readonly seeingArcsec: number | null;
  readonly sqm: number | null;
  readonly transparencyPct: number | null;
  readonly lights: number;
  readonly rejected: number;
}

/** Gespeicherte Vorhersage einer Nacht (`site_night_forecast`, AP-64b). */
export interface ClearNightForecast {
  readonly night: string;
  readonly ratingIndex: number;
  readonly overallScore: number | null;
}

export class SessionLogRepository extends TenantRepo {
  /** Standort des Mandanten (Name, Zone) – `404`, wenn fremd. */
  async site(siteId: string) {
    const site = await this.db
      .selectFrom('site')
      .select(['id', 'name', 'timeZone'])
      .where('tenantId', '=', this.ctx.tenantId)
      .where('id', '=', siteId)
      .executeTakeFirst();
    if (!site) throw new ProblemError('resource.not_found');
    return site;
  }

  /** Statistik-Einträge und Sessions der Rigs des Standorts im Zeitraum (Nacht-Schlüssel, inklusive). */
  async clearNightData(siteId: string, from: string, to: string) {
    // Drei unabhängige Abfragen gleichzeitig; die Lights je Session danach in **einer** gruppierten Abfrage statt zwei
    // Unterabfragen je Session (Performance 10.10.2026, p95 3,5 s).
    const [stats, sessions, forecasts] = await Promise.all([
      this.db
        .selectFrom('siteNightStat')
        .select(['night', 'usable', 'usableHours', 'source'])
        .where('tenantId', '=', this.ctx.tenantId)
        .where('siteId', '=', siteId)
        .where('night', '>=', from)
        .where('night', '<=', to)
        .execute(),
      this.db
        .selectFrom('session as s')
        .innerJoin('rig as r', (j) =>
          j.onRef('r.id', '=', 's.rigId').onRef('r.tenantId', '=', 's.tenantId'),
        )
        .leftJoin('sessionLog as l', (j) =>
          j.onRef('l.sessionId', '=', 's.id').onRef('l.tenantId', '=', 's.tenantId'),
        )
        .select([
          's.id',
          's.night',
          's.startedAt',
          's.forecastSnapshot',
          'l.seeingArcsec',
          'l.sqm',
          'l.transparencyPct',
        ])
        .where('s.tenantId', '=', this.ctx.tenantId)
        .where('r.siteId', '=', siteId)
        .where('s.night', '>=', from)
        .where('s.night', '<=', to)
        .orderBy('s.startedAt')
        .execute(),
      // Vorhersage je Nacht auch ohne Session (AP-64b); der Schnappschuss einer Session hat Vorrang (clearNightView).
      this.db
        .selectFrom('siteNightForecast')
        .select(['night', 'ratingIndex', 'overallScore'])
        .where('tenantId', '=', this.ctx.tenantId)
        .where('siteId', '=', siteId)
        .where('night', '>=', from)
        .where('night', '<=', to)
        .execute(),
    ]);
    const ids = sessions.map((s) => s.id);
    const counts = new Map(
      (ids.length === 0
        ? []
        : await this.db
            .selectFrom('capture')
            .select([
              'sessionId',
              sql<number>`count(*)`.as('lights'),
              sql<number>`sum(CASE WHEN rejected THEN 1 ELSE 0 END)`.as('rejected'),
            ])
            .where('tenantId', '=', this.ctx.tenantId)
            .where('sessionId', 'in', ids)
            .where('frameType', '=', 'light')
            .groupBy('sessionId')
            .execute()
      ).map((r) => [r.sessionId, r] as const),
    );
    return {
      stats: stats.map((s) => ({
        night: String(s.night).slice(0, 10),
        usable: s.usable,
        usableHours: numOrNull(s.usableHours),
        source: s.source,
      })),
      sessions: sessions.map((s): ClearNightRawSession => ({
        id: s.id,
        night: String(s.night).slice(0, 10),
        startedAt: iso(s.startedAt) as string,
        forecastSnapshot: parseJson<unknown>(s.forecastSnapshot),
        seeingArcsec: numOrNull(s.seeingArcsec),
        sqm: numOrNull(s.sqm),
        transparencyPct: numOrNull(s.transparencyPct),
        lights: Number(counts.get(s.id)?.lights ?? 0),
        rejected: Number(counts.get(s.id)?.rejected ?? 0),
      })),
      forecasts: forecasts.map((f): ClearNightForecast => ({
        night: String(f.night).slice(0, 10),
        ratingIndex: Number(f.ratingIndex),
        overallScore: numOrNull(f.overallScore),
      })),
    };
  }
}

/** Wetter-Schnappschuss zum Sessionbeginn speichern (NINA-API, best effort). Überschreibt nie einen vorhandenen. */
export async function saveForecastSnapshot(
  db: Kysely<Database>,
  tenantId: string,
  sessionId: string,
  snapshot: unknown,
): Promise<void> {
  await db
    .updateTable('session')
    .set({ forecastSnapshot: JSON.stringify(snapshot) })
    .where('tenantId', '=', tenantId)
    .where('id', '=', sessionId)
    .where('forecastSnapshot', 'is', null)
    .execute();
}

/**
 * Klarnacht-Statistik am Sessionende (`session_close`, FA-AUS-17): nutzbare Stunden = Belichtungszeit der
 * akzeptierten Lights (nicht verworfen, einem Projekt zugeordnet) je Session; für den Standort zählt das
 * Maximum über alle Sessions der Nacht an Rigs des Standorts. Nutzbar ab 1 h (Entscheidung Sven
 * 26.09.2026). Eine Session-Zeile ersetzt eine manuelle Erfassung derselben Nacht.
 */
export async function upsertSiteNightStatForSession(
  db: Kysely<Database>,
  tenantId: string,
  sessionId: string,
): Promise<{ siteId: string; night: string; usable: boolean; usableHours: number } | null> {
  return withTx(db, async (trx) => {
    const s = await trx
      .selectFrom('session as s')
      .innerJoin('rig as r', (j) =>
        j.onRef('r.id', '=', 's.rigId').onRef('r.tenantId', '=', 's.tenantId'),
      )
      .select(['s.night', 'r.siteId'])
      .where('s.tenantId', '=', tenantId)
      .where('s.id', '=', sessionId)
      .executeTakeFirst();
    if (!s) return null;
    const night = String(s.night).slice(0, 10);
    const rows = await trx
      .selectFrom('capture as c')
      .innerJoin('session as s', (j) =>
        j.onRef('s.id', '=', 'c.sessionId').onRef('s.tenantId', '=', 'c.tenantId'),
      )
      .innerJoin('rig as r', (j) =>
        j.onRef('r.id', '=', 's.rigId').onRef('r.tenantId', '=', 's.tenantId'),
      )
      .select(['c.sessionId', sql<number>`sum(c.exposure_s)`.as('exposureS')])
      .where('c.tenantId', '=', tenantId)
      .where('r.siteId', '=', s.siteId)
      .where('s.night', '=', night)
      .where('c.frameType', '=', 'light')
      .where('c.rejected', '=', false)
      .where('c.projectId', 'is not', null)
      .groupBy('c.sessionId')
      .execute();
    const best = rows.reduce((m, r) => Math.max(m, Number(r.exposureS ?? 0)), 0);
    const usableHours = Math.round((best / 3600) * 100) / 100;
    const usable = isUsableNight(usableHours);
    const existing = await trx
      .selectFrom('siteNightStat')
      .select('source')
      .where('tenantId', '=', tenantId)
      .where('siteId', '=', s.siteId)
      .where('night', '=', night)
      .executeTakeFirst();
    if (existing)
      await trx
        .updateTable('siteNightStat')
        .set({ usable, usableHours, source: 'session' })
        .where('tenantId', '=', tenantId)
        .where('siteId', '=', s.siteId)
        .where('night', '=', night)
        .execute();
    else
      await trx
        .insertInto('siteNightStat')
        .values({ tenantId, siteId: s.siteId, night, usable, usableHours, source: 'session' })
        .execute();
    return { siteId: s.siteId, night, usable, usableHours };
  });
}

export interface SiteNightForecastInput {
  readonly tenantId: string;
  readonly siteId: string;
  /** Nacht-Schlüssel (lokales Datum des Abends). */
  readonly night: string;
  /** Bewertung 0…4 (FA-WET-03), dieselbe wie `ratingIndex` im Schnappschuss zum Sessionbeginn. */
  readonly ratingIndex: number;
  /** Mittel der Nacht 0…1 (`nightMean`). */
  readonly overallScore: number | null;
  readonly modelSet: string | null;
  /** Abrufzeit der `weather_cache`-Zeile. */
  readonly recordedAt: Date;
  /** Beginn der astronomischen Dunkelheit der Nacht: ab dann bleibt die Zeile unverändert. */
  readonly nightStartsAt: Date;
}

export type SiteNightForecastOutcome = 'written' | 'unchanged' | 'started' | 'no_site';

/**
 * Vorhersage der kommenden Nacht eines Standorts festhalten (AP-64b, FA-AUS-16/17; worker im `tick-5min`).
 * Idempotent: Die jüngere Vorhersage ersetzt die ältere (`recorded_at`), eine gleich alte oder ältere schreibt nichts
 * (`unchanged`). Ab Beginn der Nacht (`nightStartsAt`) wird nichts mehr geschrieben (`started`) – es gilt die letzte
 * Vorhersage davor. Der Standort muss zum Mandanten gehören (`no_site`).
 */
export async function recordSiteNightForecast(
  db: Kysely<Database>,
  input: SiteNightForecastInput,
  now: Date,
): Promise<SiteNightForecastOutcome> {
  const startsAt = input.nightStartsAt.getTime();
  if (now.getTime() >= startsAt || input.recordedAt.getTime() >= startsAt) return 'started';
  if (!Number.isInteger(input.ratingIndex) || input.ratingIndex < 0 || input.ratingIndex > 4)
    throw new Error(`ratingIndex außerhalb 0…4: ${String(input.ratingIndex)}`);
  const { tenantId, siteId, night } = input;
  return withTx(db, async (trx) => {
    const site = await trx
      .selectFrom('site')
      .select('id')
      .where('tenantId', '=', tenantId)
      .where('id', '=', siteId)
      .executeTakeFirst();
    if (!site) return 'no_site';
    const existing = await trx
      .selectFrom('siteNightForecast')
      .select('recordedAt')
      .where('tenantId', '=', tenantId)
      .where('siteId', '=', siteId)
      .where('night', '=', night)
      .executeTakeFirst();
    if (existing && new Date(existing.recordedAt).getTime() >= input.recordedAt.getTime())
      return 'unchanged';
    const values = {
      ratingIndex: input.ratingIndex,
      overallScore: input.overallScore,
      modelSet: input.modelSet,
      recordedAt: input.recordedAt,
    };
    if (existing)
      await trx
        .updateTable('siteNightForecast')
        .set(values)
        .where('tenantId', '=', tenantId)
        .where('siteId', '=', siteId)
        .where('night', '=', night)
        .execute();
    else
      await trx
        .insertInto('siteNightForecast')
        .values({ tenantId, siteId, night, ...values })
        // Zwei Läufe gleichzeitig: beide schreiben dieselbe Vorhersage, der zweite überschreibt nur.
        .onConflict((oc) =>
          oc.columns(['siteId', 'night']).doUpdateSet((eb) => ({
            ratingIndex: eb.ref('excluded.ratingIndex'),
            overallScore: eb.ref('excluded.overallScore'),
            modelSet: eb.ref('excluded.modelSet'),
            recordedAt: eb.ref('excluded.recordedAt'),
          })),
        )
        .execute();
    return 'written';
  });
}
