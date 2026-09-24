/**
 * Job `effort` (TK 7.4, 13; `specs/engine/effort.md`; AP-13e, FA-PRJ-23, NT-08/NT-48):
 * - Projekt-Job `{projectId}`: Projekt, Rig, Standort, Mondprofile und Nacht-Tabelle laden, Schätzung mit
 *   `stride` 3, speichern nur bei geändertem `inputHash`. Laufzeit > 5 s → Abbruch, `effort_stale` bleibt.
 * - Standortlauf `{siteId, night}`: legt die Projekt-Jobs des Standorts an (höchstens 200, veraltete zuerst).
 * - `tick-hourly`: je Standort einmal je `(site, night)` nach dem lokalen Mittag der Nacht `currentNight`.
 */
import type { EffortSaveOutcome, EnqueueInput, EnqueueResult } from '@nina-pm/db';
import { EffortAbortedError, EFFORT_STRIDE_SERVER } from '@nina-pm/engine';
import {
  currentNightRow,
  dedupeKeys,
  EffortDetail,
  EffortJobInput,
  projectEffort,
  type EffortView,
  type PlanMoonProfileSource,
  type ProjectView,
  type RigView,
  type SiteNightsView,
} from '@nina-pm/shared';
import type { z } from 'zod';
import { logger } from '../lib/logger';
import type { JobHandler, JobRunnerDeps } from './jobs';
import { runJob } from './jobs';

/** Laufzeitziel je Projekt (effort.md „Leistung“, TK 8.3). */
export const EFFORT_BUDGET_MS = 5_000;
/** Nacht-Tabelle ab der Mittagsnacht: 180 Nächte Zeitraum + 30 Nächte Saisonpause + Reserve. */
export const EFFORT_NIGHT_COUNT = 215;

export interface EffortProjectData {
  readonly project: z.output<typeof ProjectView>;
  /** `project.version` beim Laden (Speichern nur bei unveränderter Version). */
  readonly version: number;
  readonly rig: z.output<typeof RigView>;
  readonly site: {
    readonly latitudeDeg: number;
    readonly longitudeDeg: number;
    readonly elevationM: number;
    readonly timeZone: string;
  };
  readonly moonProfiles: readonly PlanMoonProfileSource[];
}

export interface EffortSiteInfo {
  readonly tenantId: string;
  readonly siteId: string;
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly timeZone: string;
}

export interface EffortDeps {
  load(tenantId: string, projectId: string): Promise<EffortProjectData | null>;
  nights(
    site: { latitudeDeg: number; longitudeDeg: number; timeZone: string },
    now: Date,
    count: number,
  ): z.output<typeof SiteNightsView>;
  save(
    tenantId: string,
    projectId: string,
    version: number,
    row: {
      tag: string | null;
      nights: number | null;
      detail: Record<string, unknown>;
      inputHash: string;
      computedAt: Date;
    },
  ): Promise<EffortSaveOutcome>;
  candidates(tenantId: string, siteId: string, now: Date): Promise<string[]>;
  enqueue(tenantId: string, input: EnqueueInput): Promise<EnqueueResult>;
  /** Millisekunden-Uhr für das Laufzeitbudget. */
  readonly clock?: () => number;
}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Versuche, wenn sich das Projekt während der Rechnung ändert (Speichern mit veralteter Version). */
export const EFFORT_MAX_ATTEMPTS = 3;

/**
 * Projekt-Job: rechnen und speichern. Ändert sich das Projekt während der Rechnung (`changed`), wird
 * neu geladen und gerechnet – ein zweiter Auslöser findet den offenen Job und legt keinen neuen an.
 */
export async function runProjectEffort(
  deps: EffortDeps,
  tenantId: string,
  projectId: string,
  now: Date,
): Promise<{ outcome: EffortSaveOutcome | 'skipped' | 'aborted'; view?: EffortView }> {
  let last: { outcome: EffortSaveOutcome | 'skipped' | 'aborted'; view?: EffortView } = {
    outcome: 'skipped',
  };
  for (let attempt = 0; attempt < EFFORT_MAX_ATTEMPTS; attempt++) {
    last = await computeOnce(deps, tenantId, projectId, now);
    if (last.outcome !== 'changed') break;
  }
  return last;
}

async function computeOnce(
  deps: EffortDeps,
  tenantId: string,
  projectId: string,
  now: Date,
): Promise<{ outcome: EffortSaveOutcome | 'skipped' | 'aborted'; view?: EffortView }> {
  const data = await deps.load(tenantId, projectId);
  if (!data) return { outcome: 'skipped' };
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const nights = deps.nights(data.site, now, EFFORT_NIGHT_COUNT);
  try {
    const r = projectEffort(data.project, data.rig, data.moonProfiles, {
      site: data.site,
      nights,
      stride: EFFORT_STRIDE_SERVER,
      computedAt: iso(now),
      shouldAbort: () => clock() - started > EFFORT_BUDGET_MS,
    });
    if (!r) return { outcome: 'skipped' };
    const outcome = await deps.save(tenantId, projectId, data.version, {
      tag: r.view.tag,
      nights: r.view.nights,
      detail: EffortDetail.parse(r.view),
      inputHash: r.inputHash,
      computedAt: now,
    });
    logger.info('effort_done', {
      projectId,
      outcome,
      tag: r.view.tag,
      planRuns: r.planRuns,
      durationMs: clock() - started,
    });
    return { outcome, view: r.view };
  } catch (error) {
    if (!(error instanceof EffortAbortedError)) throw error;
    // effort_stale bleibt gesetzt; der nächste Auslöser bzw. Standortlauf rechnet erneut.
    logger.warn('effort_aborted', { projectId, durationMs: clock() - started });
    return { outcome: 'aborted' };
  }
}

/** Standortlauf: Projekt-Jobs anlegen (übernimmt `tick-5min`); liefert die Anzahl. */
export async function runSiteEffort(
  deps: EffortDeps,
  tenantId: string,
  siteId: string,
  now: Date,
): Promise<number> {
  let created = 0;
  for (const projectId of await deps.candidates(tenantId, siteId, now)) {
    const r = await deps.enqueue(tenantId, {
      kind: 'effort',
      input: { projectId },
      dedupeKey: dedupeKeys.effort(projectId),
    });
    if (r.created) created += 1;
  }
  return created;
}

export function effortJobHandler(deps: EffortDeps): JobHandler {
  return async ({ job, now }) => {
    if (!job.tenantId) throw new Error('effort-Job ohne Mandant');
    const input = EffortJobInput.parse(job.input);
    if ('projectId' in input) await runProjectEffort(deps, job.tenantId, input.projectId, now());
    else {
      const created = await runSiteEffort(deps, job.tenantId, input.siteId, now());
      logger.info('effort_site_run', { siteId: input.siteId, night: input.night, created });
    }
    return undefined;
  };
}

export interface EffortTickDeps {
  sites(): Promise<EffortSiteInfo[]>;
  runDone(tenantId: string, key: string): Promise<boolean>;
  enqueue(tenantId: string, input: EnqueueInput): Promise<EnqueueResult>;
  nights: EffortDeps['nights'];
}

/**
 * `tick-hourly` (NT-08): je Standort, sobald der lokale Mittag der Nacht `currentNight` erreicht ist,
 * einmal den Standortlauf anlegen und sofort ausführen; idempotent über `effort:<siteId>:<night>`.
 */
export async function effortSiteTick(
  deps: EffortTickDeps,
  jobs: JobRunnerDeps,
  now: Date,
): Promise<number> {
  let runs = 0;
  for (const site of await deps.sites()) {
    try {
      const table = deps.nights(site, now, 2);
      const row = currentNightRow(table, iso(now));
      if (now.getTime() < Date.parse(row.noonStartUtc)) continue;
      const key = dedupeKeys.effortSiteNight(site.siteId, row.night);
      if (await deps.runDone(site.tenantId, key)) continue;
      const job = await deps.enqueue(site.tenantId, {
        kind: 'effort',
        input: { siteId: site.siteId, night: row.night },
        dedupeKey: key,
      });
      if (!job.created) continue;
      await runJob(jobs, job.jobId);
      runs += 1;
    } catch (error) {
      logger.warn('effort_site_tick_failed', {
        siteId: site.siteId,
        error: error instanceof Error ? error.message : 'unbekannt',
      });
    }
  }
  return runs;
}
