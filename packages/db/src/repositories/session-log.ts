/**
 * Sitzungsprotokoll und Klarnacht-Statistik (AP-30; FA-AUS-14…17; S-61 *Protokoll*, S-64; TK 7.2):
 * - Protokoll je Session lesen (mit NINA-Bedingungen und Wetter-Schnappschuss) und mit `If-Match`
 *   (Version = `updated_at`) speichern.
 * - Klarnacht-Daten je Standort und Zeitraum: `site_night_stat`, Sessions der Rigs des Standorts mit
 *   Schnappschuss, Protokoll und Verworfen-Quote; Nächte ohne Session manuell als „nicht genutzt“ erfassen.
 * - Außerhalb des Mandanten-Repos: Schnappschuss zum Sessionbeginn speichern, Statistik am Sessionende
 *   schreiben (Jobs bzw. NINA-API).
 */
import { ProblemError, isUsableNight, type SessionLogView } from '@nina-pm/shared';
import { sql, type Kysely } from 'kysely';
import { withTx } from '../tx';
import type { Database } from '../types';
import { TenantRepo } from './base';

const iso = (v: Date | string | null | undefined): string | null =>
  v === null || v === undefined ? null : new Date(v).toISOString().replace(/\.\d{3}Z$/, 'Z');
const parseJson = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Version des Protokolls für `ETag`/`If-Match`: Millisekunden von `updated_at`, `0` ohne Protokoll. */
export const sessionLogVersion = (updatedAt: Date | string | null | undefined) =>
  updatedAt === null || updatedAt === undefined ? '0' : String(new Date(updatedAt).getTime());

export interface SessionLogContext {
  readonly session: {
    readonly id: string;
    readonly night: string;
    readonly startedAt: string;
    readonly endedAt: string | null;
    readonly siteId: string;
    readonly ninaConditions: unknown;
    readonly forecastSnapshot: unknown;
  };
  readonly log: {
    readonly values: SessionLogView['values'];
    readonly sources: Record<string, string | null>;
    readonly updatedAt: string;
    readonly updatedBy: string | null;
    readonly updatedByName: string | null;
  } | null;
  readonly version: string;
}

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

export class SessionLogRepository extends TenantRepo {
  /** Session (Rig des Mandanten), Standort und gespeichertes Protokoll. */
  async context(sessionId: string): Promise<SessionLogContext> {
    const row = await this.db
      .selectFrom('session as s')
      .innerJoin('rig as r', (j) =>
        j.onRef('r.id', '=', 's.rigId').onRef('r.tenantId', '=', 's.tenantId'),
      )
      .leftJoin('sessionLog as l', (j) =>
        j.onRef('l.sessionId', '=', 's.id').onRef('l.tenantId', '=', 's.tenantId'),
      )
      .leftJoin('appUser as u', (j) =>
        j.onRef('u.id', '=', 'l.updatedBy').onRef('u.tenantId', '=', 'l.tenantId'),
      )
      .select([
        's.id',
        's.night',
        's.startedAt',
        's.endedAt',
        's.ninaConditions',
        's.forecastSnapshot',
        'r.siteId',
        'l.sessionId as logSessionId',
        'l.startTime',
        'l.endTime',
        'l.seeingArcsec',
        'l.transparencyPct',
        'l.sqm',
        'l.temperatureC',
        'l.humidityPct',
        'l.windKmh',
        'l.cloudsNote',
        'l.weatherNotes',
        'l.notesMd',
        'l.moonIlluminationPct',
        'l.valueSources',
        'l.updatedAt',
        'l.updatedBy',
        'u.displayName as updatedByName',
      ])
      .where('s.tenantId', '=', this.ctx.tenantId)
      .where('s.id', '=', sessionId)
      .executeTakeFirst();
    if (!row) throw new ProblemError('resource.not_found');
    const log =
      row.logSessionId === null
        ? null
        : {
            values: {
              startTime: iso(row.startTime),
              endTime: iso(row.endTime),
              seeingArcsec: numOrNull(row.seeingArcsec),
              transparencyPct: numOrNull(row.transparencyPct),
              sqm: numOrNull(row.sqm),
              temperatureC: numOrNull(row.temperatureC),
              humidityPct: numOrNull(row.humidityPct),
              windKmh: numOrNull(row.windKmh),
              cloudsNote: row.cloudsNote,
              moonIlluminationPct: numOrNull(row.moonIlluminationPct),
              weatherNotes: row.weatherNotes ?? '',
              notesMd: row.notesMd ?? '',
            },
            sources: parseJson<Record<string, string | null>>(row.valueSources ?? {}) ?? {},
            updatedAt: iso(row.updatedAt) as string,
            updatedBy: row.updatedBy ?? null,
            updatedByName: row.updatedByName ?? null,
          };
    return {
      session: {
        id: row.id,
        night: String(row.night).slice(0, 10),
        startedAt: iso(row.startedAt) as string,
        endedAt: iso(row.endedAt),
        siteId: row.siteId,
        ninaConditions: parseJson<unknown>(row.ninaConditions),
        forecastSnapshot: parseJson<unknown>(row.forecastSnapshot),
      },
      log,
      version: sessionLogVersion(row.updatedAt),
    };
  }

  /**
   * Protokoll speichern (FA-AUS-14/15): `expected` = Version aus `If-Match` (`0` = noch keins), sonst
   * `412 resource.version_conflict`. Sperrt die Session (`guard`), damit zwei Speicherungen nicht beide
   * gegen dieselbe Version gewinnen.
   */
  async save(
    sessionId: string,
    values: SessionLogView['values'],
    sources: SessionLogView['sources'],
    expected: string | undefined,
    userId: string | undefined,
    now: Date,
  ): Promise<string> {
    const tenantId = this.ctx.tenantId;
    return withTx(
      this.db,
      async (trx) => {
        const session = await trx
          .selectFrom('session')
          .select('id')
          .where('tenantId', '=', tenantId)
          .where('id', '=', sessionId)
          .executeTakeFirst();
        if (!session) throw new ProblemError('resource.not_found');
        const current = await trx
          .selectFrom('sessionLog')
          .select('updatedAt')
          .where('tenantId', '=', tenantId)
          .where('sessionId', '=', sessionId)
          .executeTakeFirst();
        const version = sessionLogVersion(current?.updatedAt);
        if (expected !== undefined && expected !== version)
          throw new ProblemError('resource.version_conflict');
        // Monotone Version auch bei zwei Speicherungen in derselben Millisekunde.
        const prev = current ? new Date(current.updatedAt).getTime() : 0;
        const at = new Date(Math.max(now.getTime(), prev + 1));
        const row = {
          startTime: values.startTime,
          endTime: values.endTime,
          seeingArcsec: values.seeingArcsec,
          transparencyPct: values.transparencyPct,
          sqm: values.sqm,
          temperatureC: values.temperatureC,
          humidityPct: values.humidityPct,
          windKmh: values.windKmh,
          cloudsNote: values.cloudsNote,
          weatherNotes: values.weatherNotes,
          notesMd: values.notesMd,
          moonIlluminationPct: values.moonIlluminationPct,
          valueSources: JSON.stringify(sources),
          updatedBy: userId ?? null,
          updatedAt: at,
        };
        if (current)
          await trx
            .updateTable('sessionLog')
            .set(row)
            .where('tenantId', '=', tenantId)
            .where('sessionId', '=', sessionId)
            .execute();
        else
          await trx
            .insertInto('sessionLog')
            .values({ ...row, sessionId, tenantId })
            .execute();
        return sessionLogVersion(at);
      },
      { guard: [{ table: 'session', id: sessionId, tenantId }] },
    );
  }

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
    const stats = await this.db
      .selectFrom('siteNightStat')
      .select(['night', 'usable', 'usableHours', 'source'])
      .where('tenantId', '=', this.ctx.tenantId)
      .where('siteId', '=', siteId)
      .where('night', '>=', from)
      .where('night', '<=', to)
      .execute();
    const sessions = await this.db
      .selectFrom('session as s')
      .innerJoin('rig as r', (j) =>
        j.onRef('r.id', '=', 's.rigId').onRef('r.tenantId', '=', 's.tenantId'),
      )
      .leftJoin('sessionLog as l', (j) =>
        j.onRef('l.sessionId', '=', 's.id').onRef('l.tenantId', '=', 's.tenantId'),
      )
      .select((eb) => [
        's.id',
        's.night',
        's.startedAt',
        's.forecastSnapshot',
        'l.seeingArcsec',
        'l.sqm',
        'l.transparencyPct',
        eb
          .selectFrom('capture as c')
          .select(sql<number>`count(*)`.as('n'))
          .whereRef('c.sessionId', '=', 's.id')
          .whereRef('c.tenantId', '=', 's.tenantId')
          .where('c.frameType', '=', 'light')
          .as('lights'),
        eb
          .selectFrom('capture as c')
          .select(sql<number>`count(*)`.as('n'))
          .whereRef('c.sessionId', '=', 's.id')
          .whereRef('c.tenantId', '=', 's.tenantId')
          .where('c.frameType', '=', 'light')
          .where('c.rejected', '=', true)
          .as('rejected'),
      ])
      .where('s.tenantId', '=', this.ctx.tenantId)
      .where('r.siteId', '=', siteId)
      .where('s.night', '>=', from)
      .where('s.night', '<=', to)
      .orderBy('s.startedAt')
      .execute();
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
        lights: Number(s.lights ?? 0),
        rejected: Number(s.rejected ?? 0),
      })),
    };
  }

  /**
   * Nacht ohne Session als „bewölkt/nicht genutzt“ erfassen (FA-AUS-17). Gibt es eine Session-Zeile,
   * bestimmt sie die Statistik – `409 site_night.has_session`.
   */
  async markUnused(siteId: string, night: string): Promise<void> {
    const tenantId = this.ctx.tenantId;
    await withTx(
      this.db,
      async (trx) => {
        const row = await trx
          .selectFrom('siteNightStat')
          .select('source')
          .where('tenantId', '=', tenantId)
          .where('siteId', '=', siteId)
          .where('night', '=', night)
          .executeTakeFirst();
        if (row?.source === 'session') throw new ProblemError('site_night.has_session');
        // Auch eine noch nicht abgeschlossene Session der Nacht (Statistik folgt mit `session_close`).
        const session = await trx
          .selectFrom('session as s')
          .innerJoin('rig as r', (j) =>
            j.onRef('r.id', '=', 's.rigId').onRef('r.tenantId', '=', 's.tenantId'),
          )
          .select('s.id')
          .where('s.tenantId', '=', tenantId)
          .where('r.siteId', '=', siteId)
          .where('s.night', '=', night)
          .limit(1)
          .executeTakeFirst();
        if (session) throw new ProblemError('site_night.has_session');
        if (row) return;
        await trx
          .insertInto('siteNightStat')
          .values({ tenantId, siteId, night, usable: false, usableHours: 0, source: 'manual' })
          .execute();
      },
      { guard: [{ table: 'site', id: siteId, tenantId }] },
    );
  }

  /** Manuelle Erfassung zurücknehmen (nur `source = manual`). */
  async unmarkUnused(siteId: string, night: string): Promise<void> {
    await this.db
      .deleteFrom('siteNightStat')
      .where('tenantId', '=', this.ctx.tenantId)
      .where('siteId', '=', siteId)
      .where('night', '=', night)
      .where('source', '=', 'manual')
      .execute();
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
