/**
 * Mehrnacht-Prognose je Rig (AP-33; TK 13 `tick-hourly`, FA-FOL-01…03): 14 Nächte als
 * `night_plan(origin = 'forecast_job', reason = 'forecast')` – `summary` trägt je Nacht die Frames je Zeile
 * und die belegten Stunden je Projekt (ungewichtet), `blocks` bleibt leer. **Idempotent:** je Rig werden die
 * Prognosezeilen in einer Transaktion (Wächter auf das Rig) gelöscht und neu geschrieben.
 */
import type { Kysely } from 'kysely';
import { withTx } from '../tx';
import type { Database } from '../types';

export interface ForecastNightRow {
  readonly night: string;
  readonly darkHours: number | null;
  readonly lineFrames: Readonly<Record<string, number>>;
  readonly projectHours: Readonly<Record<string, number>>;
  readonly engineVersion: string;
  readonly inputHash: string;
}

export async function replaceForecast(
  db: Kysely<Database>,
  tenantId: string,
  rigId: string,
  nights: readonly ForecastNightRow[],
  now: Date,
): Promise<void> {
  await withTx(
    db,
    async (trx) => {
      await trx
        .deleteFrom('nightPlan')
        .where('tenantId', '=', tenantId)
        .where('rigId', '=', rigId)
        .where('origin', '=', 'forecast_job')
        .execute();
      if (nights.length === 0) return;
      await trx
        .insertInto('nightPlan')
        .values(
          nights.map((n) => ({
            tenantId,
            rigId,
            night: n.night,
            origin: 'forecast_job',
            sessionId: null,
            reason: 'forecast',
            engineVersion: n.engineVersion,
            inputHash: n.inputHash,
            summary: JSON.stringify({
              darkHours: n.darkHours,
              lineFrames: n.lineFrames,
              projectHours: n.projectHours,
            }),
            blocks: JSON.stringify([]),
            createdAt: now,
          })),
        )
        .execute();
    },
    { guard: [{ table: 'rig', id: rigId, tenantId }] },
  );
}

/** Gespeicherte Prognosenächte eines Rigs (aufsteigend) und ihr Berechnungszeitpunkt. */
export async function forecastNights(
  db: Kysely<Database>,
  tenantId: string,
  rigId: string,
): Promise<{ computedAt: Date | null; nights: ForecastNightRow[] }> {
  const rows = await db
    .selectFrom('nightPlan')
    .select(['night', 'summary', 'engineVersion', 'inputHash', 'createdAt'])
    .where('tenantId', '=', tenantId)
    .where('rigId', '=', rigId)
    .where('origin', '=', 'forecast_job')
    .orderBy('night')
    .execute();
  const parse = (v: unknown) =>
    (typeof v === 'string' ? JSON.parse(v) : v) as {
      darkHours?: number | null;
      lineFrames?: Record<string, number>;
      projectHours?: Record<string, number>;
    } | null;
  return {
    computedAt: rows[0] ? new Date(rows[0].createdAt) : null,
    nights: rows.map((r) => {
      const s = parse(r.summary);
      return {
        night: String(r.night).slice(0, 10),
        darkHours: s?.darkHours ?? null,
        lineFrames: s?.lineFrames ?? {},
        projectHours: s?.projectHours ?? {},
        engineVersion: r.engineVersion,
        inputHash: r.inputHash,
      };
    }),
  };
}

/** Klarnacht-Statistik des Standorts seit `fromNight` (FA-AUS-17): erfasste und nutzbare Nächte. */
export async function clearNightCounts(
  db: Kysely<Database>,
  tenantId: string,
  siteId: string,
  fromNight: string,
): Promise<{ usable: number; recorded: number }> {
  const rows = await db
    .selectFrom('siteNightStat')
    .select('usable')
    .where('tenantId', '=', tenantId)
    .where('siteId', '=', siteId)
    .where('night', '>=', fromNight)
    .execute();
  return { recorded: rows.length, usable: rows.filter((r) => r.usable).length };
}
