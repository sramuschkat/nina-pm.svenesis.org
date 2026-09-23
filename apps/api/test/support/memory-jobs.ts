/**
 * In-Memory-Nachbildung von JobRepository/JobQueue für API- und Worker-Tests ohne Datenbank.
 * Die SQL-Fassung prüft die Suite D-07 gegen PostgreSQL (CI) bzw. DSQL (`pnpm test:dsql`).
 */
import type { EnqueueInput, EnqueueResult, Job, JobError, StaleJob } from '@nina-pm/db';
import {
  JOB_PENDING_STALE_MS,
  JOB_RUNNING_STALE_MS,
  jobPriority,
  MAX_OPEN_USER_JOBS,
  maxJobAttempts,
  ProblemError,
  USER_JOB_KINDS,
  type JobKind,
} from '@nina-pm/shared';
import type { JobQueueLike } from '../../src/worker/jobs';

export class MemoryJobs implements JobQueueLike {
  readonly rows = new Map<string, Job>();
  private seq = 0;
  constructor(private readonly clock: () => Date) {}

  forTenant(tenantId: string) {
    return {
      byId: (id: string) => {
        const job = this.rows.get(id);
        return Promise.resolve(job && job.tenantId === tenantId ? job : undefined);
      },
      enqueue: (input: EnqueueInput) => this.enqueue(tenantId, input),
    };
  }

  enqueue(tenantId: string, input: EnqueueInput): Promise<EnqueueResult> {
    const open = (j: Job) => j.status === 'pending' || j.status === 'running';
    if (input.dedupeKey) {
      const existing = [...this.rows.values()].find(
        (j) => j.dedupeActive === input.dedupeKey && j.tenantId === tenantId,
      );
      if (existing) return Promise.resolve({ jobId: existing.id, created: false });
    }
    if (USER_JOB_KINDS.includes(input.kind)) {
      const count = [...this.rows.values()].filter(
        (j) =>
          j.tenantId === tenantId &&
          j.createdBy === input.createdBy &&
          USER_JOB_KINDS.includes(j.kind as JobKind) &&
          open(j),
      ).length;
      if (count >= MAX_OPEN_USER_JOBS) return Promise.reject(new ProblemError('auth.rate_limited'));
    }
    this.seq += 1;
    const id = `00000000-0000-4000-8000-${String(this.seq).padStart(12, '0')}`;
    const now = this.clock();
    this.rows.set(id, {
      id,
      tenantId,
      kind: input.kind,
      status: 'pending',
      dedupeKey: input.dedupeKey ?? null,
      dedupeActive: input.dedupeKey ?? null,
      input: input.input ?? {},
      resultS3Key: null,
      error: null,
      attempts: 0,
      runAfter: input.runAfter ?? now,
      startedAt: null,
      finishedAt: null,
      createdBy: input.createdBy ?? null,
      createdAt: now,
    });
    return Promise.resolve({ jobId: id, created: true });
  }

  claim(id: string, now: Date): Promise<Job | undefined> {
    const job = this.rows.get(id);
    if (!job) return Promise.resolve(undefined);
    const staleRunning =
      job.status === 'running' &&
      job.startedAt !== null &&
      now.getTime() - new Date(job.startedAt).getTime() > JOB_RUNNING_STALE_MS;
    if (
      (job.status !== 'pending' && !staleRunning) ||
      job.attempts >= maxJobAttempts(job.kind as JobKind)
    ) {
      return Promise.resolve(undefined);
    }
    const next = { ...job, status: 'running' as const, startedAt: now, attempts: job.attempts + 1 };
    this.rows.set(id, next);
    return Promise.resolve(next);
  }

  finish(id: string, now: Date, resultS3Key: string | null = null): Promise<void> {
    const job = this.rows.get(id);
    if (job?.status === 'running') {
      this.rows.set(id, {
        ...job,
        status: 'done',
        finishedAt: now,
        dedupeActive: null,
        resultS3Key,
        error: null,
      });
    }
    return Promise.resolve();
  }

  fail(id: string, now: Date, error: JobError): Promise<void> {
    const job = this.rows.get(id);
    if (job && (job.status === 'pending' || job.status === 'running')) {
      this.rows.set(id, {
        ...job,
        status: 'failed',
        finishedAt: now,
        dedupeActive: null,
        error: JSON.stringify(error),
      });
    }
    return Promise.resolve();
  }

  stale(now: Date): Promise<StaleJob[]> {
    const t = now.getTime();
    const list = [...this.rows.values()]
      .filter(
        (j) =>
          (j.status === 'pending' && t - new Date(j.runAfter).getTime() > JOB_PENDING_STALE_MS) ||
          (j.status === 'running' &&
            j.startedAt !== null &&
            t - new Date(j.startedAt).getTime() > JOB_RUNNING_STALE_MS),
      )
      .sort(
        (a, b) =>
          jobPriority(a.kind as JobKind) - jobPriority(b.kind as JobKind) ||
          Number(a.createdBy !== null) - Number(b.createdBy !== null) ||
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    return Promise.resolve(list.map((j) => ({ id: j.id, kind: j.kind, attempts: j.attempts })));
  }
}
