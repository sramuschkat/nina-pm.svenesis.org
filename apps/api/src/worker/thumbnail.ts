/**
 * Job `thumbnail` (AP-25; FA-PRJ-02, TK 7.4/12/13, Entscheidung Sven 26.09.2026): Vorschaubild des
 * Projekt-Bildfelds aus CDS hips2fits nach `catalog/thumbs/<sha256>.jpg` im Web-Bucket – nie nach
 * `catalog/img/…` (kopierte Katalogbilder, dso-import.md §2). Ausgelöst nach jeder Projektänderung; ist
 * der Schlüssel unverändert, tut der Job nichts. Liegt derselbe Ausschnitt schon bei einem Projekt, wird
 * nicht erneut abgerufen. `tick-hourly` holt Projekte ohne Bild nach (höchstens 20 je Lauf).
 */
import type { EnqueueInput, EnqueueResult, ThumbnailCandidate } from '@nina-pm/db';
import {
  dedupeKeys,
  hips2fitsUrl,
  projectThumbnailParams,
  thumbnailKey,
  type ProjectView,
  type RigView,
} from '@nina-pm/shared';
import { z } from 'zod';
import { logger } from '../lib/logger';
import {
  budgetExhausted,
  runJob,
  type JobHandler,
  type JobRunnerDeps,
  type TickBudget,
} from './jobs';

type Project = z.output<typeof ProjectView>;
type Rig = z.output<typeof RigView>;

/** Zeitlimit für hips2fits (TK 14: 60 s). */
export const HIPS2FITS_TIMEOUT_MS = 60_000;
export const THUMBNAIL_TICK_LIMIT = 20;

export interface ThumbnailDeps {
  readonly load: (
    tenantId: string,
    projectId: string,
  ) => Promise<{ project: Project; rig: Rig } | null>;
  readonly keyInUse: (key: string) => Promise<boolean>;
  readonly fetchImage: (url: string) => Promise<{ bytes: Uint8Array; contentType: string }>;
  readonly put: (key: string, bytes: Uint8Array) => Promise<void>;
  readonly save: (tenantId: string, projectId: string, key: string | null) => Promise<void>;
}

export type ThumbnailOutcome = 'unchanged' | 'reused' | 'fetched' | 'no_frame';

/** Ein Projekt: Schlüssel bilden, Bild bei Bedarf abrufen und ablegen, Schlüssel am Projekt setzen. */
export async function runThumbnail(
  deps: ThumbnailDeps,
  tenantId: string,
  projectId: string,
): Promise<ThumbnailOutcome> {
  const data = await deps.load(tenantId, projectId);
  const params = data ? projectThumbnailParams(data.project, data.rig) : null;
  if (!data || !params) return 'no_frame';
  const key = thumbnailKey(params);
  if (data.project.thumbnailUrl === `/${key}`) return 'unchanged';
  let outcome: ThumbnailOutcome = 'reused';
  if (!(await deps.keyInUse(key))) {
    const image = await deps.fetchImage(hips2fitsUrl(params));
    if (!image.contentType.startsWith('image/jpeg') || image.bytes.length === 0)
      throw new Error(`hips2fits lieferte ${image.contentType || 'nichts'}`);
    await deps.put(key, image.bytes);
    outcome = 'fetched';
  }
  await deps.save(tenantId, projectId, key);
  return outcome;
}

const Input = z.object({ projectId: z.uuid() });

export function thumbnailJobHandler(deps: ThumbnailDeps): JobHandler {
  return async ({ job }) => {
    if (!job.tenantId) throw new Error('thumbnail ohne Mandant');
    const { projectId } = Input.parse(job.input);
    const outcome = await runThumbnail(deps, job.tenantId, projectId);
    logger.info('thumbnail', { projectId, outcome });
    return undefined;
  };
}

export interface ThumbnailTickDeps {
  readonly candidates: (limit: number) => Promise<ThumbnailCandidate[]>;
  readonly enqueue: (tenantId: string, input: EnqueueInput) => Promise<EnqueueResult>;
}

/**
 * `tick-hourly`: fehlende Vorschaubilder nachholen, der Reihe nach (CDS nicht parallel belasten). Nach dem
 * Zeitbudget des Laufs (`HOURLY_FETCH_BUDGET_MS`) kein neuer Abruf; der Rest folgt im nächsten Lauf.
 */
export async function thumbnailTick(
  deps: ThumbnailTickDeps,
  jobs: JobRunnerDeps,
  budget?: TickBudget,
): Promise<number> {
  const exhausted = budgetExhausted(budget);
  const candidates = await deps.candidates(THUMBNAIL_TICK_LIMIT);
  let runs = 0;
  for (const [i, c] of candidates.entries()) {
    if (exhausted()) {
      logger.warn('thumbnail_tick_budget', { runs, skipped: candidates.length - i });
      break;
    }
    try {
      const job = await deps.enqueue(c.tenantId, {
        kind: 'thumbnail',
        input: { projectId: c.projectId },
        dedupeKey: dedupeKeys.thumbnail(c.projectId),
      });
      if (!job.created) continue;
      await runJob(jobs, job.jobId);
      runs += 1;
    } catch (error) {
      logger.warn('thumbnail_tick_failed', {
        projectId: c.projectId,
        error: error instanceof Error ? error.message : 'unbekannt',
      });
    }
  }
  return runs;
}
