/**
 * Job-Ausführung im `worker` (TK 7.4, 13): Registry je `kind`, Übernahme, Abschluss; `tick-5min`
 * übernimmt liegengebliebene Jobs (pending > 2 min, running > 20 min; höchstens 3 Versuche,
 * `discord_post` 5) – Zeitplan-Jobs vor benutzerausgelösten.
 */
import type { Job, JobError, StaleJob } from '@nina-pm/db';
import { isProblemError, maxJobAttempts, type JobKind } from '@nina-pm/shared';
import { logger } from '../lib/logger';
import { redact } from '../lib/redact';

export interface JobQueueLike {
  claim(id: string, now: Date): Promise<Job | undefined>;
  finish(id: string, now: Date, resultS3Key?: string | null): Promise<void>;
  fail(id: string, now: Date, error: JobError): Promise<void>;
  stale(now: Date, limit?: number): Promise<StaleJob[]>;
  retry?(id: string, runAfter: Date, error: JobError): Promise<void>;
}

/**
 * Vorübergehender Fehler mit festem nächsten Versuch (Backoff, TK 7.7): der Runner setzt den Job auf
 * `pending` ab `runAfter`; ist die Höchstzahl an Versuchen erreicht, wird er `failed`.
 */
export class RetryLater extends Error {
  constructor(
    readonly runAfter: Date,
    readonly code: string,
  ) {
    super(code);
    this.name = 'RetryLater';
  }
}

export interface JobRunContext {
  readonly job: Job;
  readonly now: () => Date;
}

export interface JobResult {
  /** Großes Ergebnis unter `tenant/<tid>/jobs/<jobId>.json` (TK 7.4). */
  readonly resultS3Key?: string;
}

export type JobHandler = (ctx: JobRunContext) => Promise<JobResult | undefined>;

/** Handler je Art; Folgepakete ergänzen ihre Arten (effort, multi_sim, import …). */
export const JOB_HANDLERS: Partial<Record<JobKind, JobHandler>> = {
  // Beispiel-Job (AP-05): prüft den Weg api → worker → job ohne Fachlogik.
  noop: () => Promise.resolve(undefined),
};

export interface JobRunnerDeps {
  readonly queue: () => Promise<JobQueueLike>;
  readonly handlers?: Partial<Record<JobKind, JobHandler>>;
  readonly now?: () => Date;
}

export type RunOutcome = 'done' | 'failed' | 'skipped' | 'retry';

export async function runJob(deps: JobRunnerDeps, jobId: string): Promise<RunOutcome> {
  const now = deps.now ?? (() => new Date());
  const queue = await deps.queue();
  const job = await queue.claim(jobId, now());
  if (!job) {
    logger.info('job_skipped', { jobId });
    return 'skipped';
  }
  const handler = (deps.handlers ?? JOB_HANDLERS)[job.kind as JobKind];
  const started = Date.now();
  if (!handler) {
    logger.error('job_unknown_kind', { jobId, kind: job.kind });
    await queue.fail(jobId, now(), { code: 'internal.error' });
    return 'failed';
  }
  try {
    const result = await handler({ job, now });
    await queue.finish(jobId, now(), result?.resultS3Key ?? null);
    logger.info('job_done', {
      jobId,
      kind: job.kind,
      attempt: job.attempts,
      durationMs: Date.now() - started,
    });
    return 'done';
  } catch (error) {
    if (
      error instanceof RetryLater &&
      queue.retry &&
      job.attempts < maxJobAttempts(job.kind as JobKind)
    ) {
      logger.warn('job_retry_later', {
        jobId,
        kind: job.kind,
        attempt: job.attempts,
        code: error.code,
        runAfter: error.runAfter.toISOString(),
      });
      await queue.retry(jobId, error.runAfter, { code: error.code });
      return 'retry';
    }
    if (error instanceof RetryLater) {
      logger.warn('job_failed', { jobId, kind: job.kind, code: error.code, attempt: job.attempts });
      await queue.fail(jobId, now(), { code: error.code });
      return 'failed';
    }
    if (isProblemError(error)) {
      logger.warn('job_failed', { jobId, kind: job.kind, code: error.code, errors: error.errors });
      await queue.fail(jobId, now(), {
        code: error.code,
        ...(error.errors ? { errors: error.errors } : {}),
      });
    } else {
      logger.error('job_error', { jobId, kind: job.kind, error: redact(error) });
      await queue.fail(jobId, now(), { code: 'internal.error' });
    }
    return 'failed';
  }
}

/** Zeitbudget je `tick-5min`-Lauf (Lambda-Timeout 15 min). */
export const PICKUP_BUDGET_MS = 10 * 60_000;

/**
 * Zeitbudget der Abrufe im `tick-hourly`-Lauf (Wetter, Vorschaubilder), gemessen ab Beginn des Laufs:
 * danach startet keine neue Arbeit mehr. Ein laufender Abruf darf noch zu Ende gehen (hips2fits bis
 * 3 × 60 s), der Rest bleibt für den nächsten Lauf – so bleibt der Lauf unter dem Lambda-Timeout von 15 min.
 */
export const HOURLY_FETCH_BUDGET_MS = 8 * 60_000;

export interface TickBudget {
  /** Beginn des Laufs (ms, `clock`); ohne Angabe der Aufruf selbst. */
  readonly startedAt?: number;
  readonly budgetMs?: number;
  readonly clock?: () => number;
}

/** Liefert „Budget erschöpft?“ für einen Lauf (Muster wie `pickupStaleJobs`). */
export function budgetExhausted(budget: TickBudget = {}, defaultMs = HOURLY_FETCH_BUDGET_MS) {
  const clock = budget.clock ?? Date.now;
  const startedAt = budget.startedAt ?? clock();
  const budgetMs = budget.budgetMs ?? defaultMs;
  return () => clock() - startedAt > budgetMs;
}

export async function pickupStaleJobs(
  deps: JobRunnerDeps & { readonly budgetMs?: number; readonly clock?: () => number },
): Promise<{ run: number; exhausted: number }> {
  const now = deps.now ?? (() => new Date());
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const queue = await deps.queue();
  const stale = await queue.stale(now());
  let run = 0;
  let exhausted = 0;
  for (const job of stale) {
    if (clock() - started > (deps.budgetMs ?? PICKUP_BUDGET_MS)) break;
    if (job.attempts >= maxJobAttempts(job.kind as JobKind)) {
      await queue.fail(job.id, now(), {
        code: 'internal.error',
        errors: [{ path: 'attempts', message: 'Höchstzahl an Versuchen erreicht' }],
      });
      exhausted += 1;
      continue;
    }
    await runJob(deps, job.id);
    run += 1;
  }
  logger.info('job_pickup_done', { candidates: stale.length, run, exhausted });
  return { run, exhausted };
}
