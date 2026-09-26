/**
 * Job `forecast` (AP-33; TK 7.4, 13; FA-FOL-01…03): Mehrnacht-Prognose je Rig eines Standorts – 14 Nächte ab
 * `currentNight` mit allen aktiven, freigegebenen Projekten des Rigs (Konkurrenz), **ungewichtet**; das
 * Wetter gewichtet erst die Ansicht (`forecastView`), weil sich die Vorhersage stündlich ändert. Gespeichert
 * als `night_plan(origin = 'forecast_job')`, je Rig ersetzt (idempotent). `tick-hourly` legt den Job einmal
 * je `(site, night)` nach dem lokalen Mittag an (NT-08); S-62 kann ihn neu anstoßen.
 */
import type { ForecastNightRow } from '@nina-pm/db';
import {
  currentNightRow,
  dedupeKeys,
  FORECAST_NIGHTS,
  ForecastJobInput,
  simulateNights,
} from '@nina-pm/shared';
import { isoUtc } from '../lib/format';
import { logger } from '../lib/logger';
import type { EffortTickDeps } from './effort';
import { runJob, type JobHandler, type JobRunnerDeps } from './jobs';
import type { MultiSimDeps } from './multi-sim';

export interface ForecastDeps extends Pick<MultiSimDeps, 'loadRig' | 'nights'> {
  rigIdsOfSite(tenantId: string, siteId: string): Promise<string[]>;
  replace(
    tenantId: string,
    rigId: string,
    rows: readonly ForecastNightRow[],
    now: Date,
  ): Promise<void>;
}

export function forecastJobHandler(deps: ForecastDeps): JobHandler {
  return async ({ job, now }) => {
    if (!job.tenantId) throw new Error('forecast ohne Mandant');
    const { siteId } = ForecastJobInput.parse(job.input);
    const at = now();
    let rigs = 0;
    for (const rigId of await deps.rigIdsOfSite(job.tenantId, siteId)) {
      const ctx = await deps.loadRig(job.tenantId, rigId);
      if (!ctx) continue;
      const projects = ctx.projects.filter(
        (p) => p.rigId === rigId && p.approvalStatus === 'approved' && p.status === 'active',
      );
      const table = deps.nights(ctx.site, at, undefined, FORECAST_NIGHTS + 2);
      const sim = simulateNights({
        rig: ctx.rig,
        projects,
        moonProfiles: ctx.moonProfiles,
        nightsTable: table,
        site: ctx.site,
        nightFrom: table.currentNight,
        count: FORECAST_NIGHTS,
      });
      await deps.replace(job.tenantId, rigId, sim.detail, at);
      rigs += 1;
    }
    logger.info('forecast', { siteId, rigs, at: isoUtc(at) });
    return undefined;
  };
}

/** `tick-hourly` (NT-08): je Standort nach dem lokalen Mittag einmal `forecast:<siteId>:<night>`. */
export async function forecastSiteTick(
  deps: EffortTickDeps,
  jobs: JobRunnerDeps,
  now: Date,
): Promise<number> {
  let runs = 0;
  for (const site of await deps.sites()) {
    try {
      const row = currentNightRow(deps.nights(site, now, 2), isoUtc(now));
      if (now.getTime() < Date.parse(row.noonStartUtc)) continue;
      const key = dedupeKeys.forecastSiteNight(site.siteId, row.night);
      if (await deps.runDone(site.tenantId, key)) continue;
      const job = await deps.enqueue(site.tenantId, {
        kind: 'forecast',
        input: { siteId: site.siteId, night: row.night },
        dedupeKey: key,
      });
      if (!job.created) continue;
      await runJob(jobs, job.jobId);
      runs += 1;
    } catch (error) {
      logger.warn('forecast_site_tick_failed', {
        siteId: site.siteId,
        error: error instanceof Error ? error.message : 'unbekannt',
      });
    }
  }
  return runs;
}
