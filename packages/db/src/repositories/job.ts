/**
 * Jobs (TK 7.4, 13). `JobRepository` ist mandantengebunden (api: anlegen, lesen); `JobQueue` ist die
 * Warteschlangen-Sicht des `worker` über alle Mandanten – wie der Lease-Sweep eine bewusste Ausnahme
 * von der tenant_id-Regel (TK 6.1), weil `tick-5min` liegengebliebene Jobs aller Mandanten übernimmt.
 */
import {
  JOB_PENDING_STALE_MS,
  JOB_RUNNING_STALE_MS,
  jobPriority,
  MAX_OPEN_USER_JOBS,
  maxJobAttempts,
  ProblemError,
  USER_JOB_KINDS,
  type FieldError,
  type JobKind,
} from '@nina-pm/shared';
import { sql, type Kysely, type Selectable } from 'kysely';
import { withTx, type WithTxOptions } from '../tx';
import type { Database, JobTable } from '../types';
import { TenantRepo, type TenantContext } from './base';

export type Job = Selectable<JobTable>;

export interface EnqueueInput {
  readonly kind: JobKind;
  readonly input?: Record<string, unknown>;
  /** Pflicht für `multi_sim` und `impact` (SEC-51); verhindert einen zweiten offenen Job (DAT5-1). */
  readonly dedupeKey?: string;
  /** Auslösendes Mitglied; `null`/fehlend = Zeitplan oder System. */
  readonly createdBy?: string | null;
  readonly runAfter?: Date;
}

export interface EnqueueResult {
  readonly jobId: string;
  /** `false`, wenn bereits ein offener Job mit demselben `dedupe_key` existiert. */
  readonly created: boolean;
}

/** Fehlergrund eines `failed`-Jobs in `job.error` (JSON): Code aus errors.json und Stellen. */
export interface JobError {
  readonly code: string;
  readonly errors?: readonly FieldError[];
}

export function parseJobError(error: string | null): JobError | null {
  if (!error) return null;
  try {
    const parsed = JSON.parse(error) as Partial<JobError>;
    return typeof parsed.code === 'string' ? (parsed as JobError) : { code: 'internal.error' };
  } catch {
    return { code: 'internal.error' };
  }
}

const OPEN = ['pending', 'running'] as const;

export class JobRepository extends TenantRepo {
  constructor(
    db: Kysely<Database>,
    ctx: TenantContext,
    private readonly txOptions: WithTxOptions = {},
  ) {
    super(db, ctx);
  }

  byId(id: string): Promise<Job | undefined> {
    return this.db
      .selectFrom('job')
      .selectAll()
      .where('id', '=', id)
      .where('tenantId', '=', this.ctx.tenantId)
      .executeTakeFirst();
  }

  async countOpenUserJobs(memberId: string): Promise<number> {
    const row = await this.db
      .selectFrom('job')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('tenantId', '=', this.ctx.tenantId)
      .where('createdBy', '=', memberId)
      .where('kind', 'in', USER_JOB_KINDS)
      .where('status', 'in', OPEN)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  /**
   * Legt einen Job an (TK 7.4): offener Job mit gleichem `dedupe_key` → dessen ID; bei
   * benutzerausgelösten Arten höchstens 3 offene Jobs je Mitglied, sonst `429 auth.rate_limited`
   * (TK 13, SV-06). Die Zeile des Mitglieds ist Wächter, damit parallele Aufrufe die Grenze nicht
   * gemeinsam überschreiten (DSQL OCC).
   */
  enqueue(job: EnqueueInput): Promise<EnqueueResult> {
    const userKind = USER_JOB_KINDS.includes(job.kind);
    if (userKind && !job.dedupeKey)
      throw new Error(`dedupe_key ist für ${job.kind} Pflicht (SEC-51)`);
    if (userKind && !job.createdBy) throw new Error(`${job.kind} braucht das auslösende Mitglied`);
    const tenantId = this.ctx.tenantId;
    return withTx(
      this.db,
      async (trx) => {
        const findOpen = (key: string) =>
          trx
            .selectFrom('job')
            .select('id')
            .where('dedupeActive', '=', key)
            .where('tenantId', '=', tenantId)
            .executeTakeFirst();
        if (job.dedupeKey) {
          const open = await findOpen(job.dedupeKey);
          if (open) return { jobId: open.id, created: false };
        }
        if (userKind && job.createdBy) {
          const row = await trx
            .selectFrom('job')
            .select((eb) => eb.fn.countAll<string>().as('n'))
            .where('tenantId', '=', tenantId)
            .where('createdBy', '=', job.createdBy)
            .where('kind', 'in', USER_JOB_KINDS)
            .where('status', 'in', OPEN)
            .executeTakeFirstOrThrow();
          if (Number(row.n) >= MAX_OPEN_USER_JOBS) throw new ProblemError('auth.rate_limited');
        }
        const inserted = await trx
          .insertInto('job')
          .values({
            tenantId,
            kind: job.kind,
            dedupeKey: job.dedupeKey ?? null,
            dedupeActive: job.dedupeKey ?? null,
            input: JSON.stringify(job.input ?? {}),
            createdBy: job.createdBy ?? null,
            ...(job.runAfter ? { runAfter: job.runAfter } : {}),
          })
          .onConflict((oc) => oc.column('dedupeActive').doNothing())
          .returning('id')
          .executeTakeFirst();
        if (inserted) return { jobId: inserted.id, created: true };
        const open = job.dedupeKey ? await findOpen(job.dedupeKey) : undefined;
        if (!open) throw new Error('Job-Deduplizierung: offener Job nicht gefunden');
        return { jobId: open.id, created: false };
      },
      {
        ...this.txOptions,
        guard:
          userKind && job.createdBy ? [{ table: 'app_user', id: job.createdBy, tenantId }] : [],
      },
    );
  }
}

export interface StaleJob {
  readonly id: string;
  readonly kind: string;
  readonly attempts: number;
}

/** Warteschlange des `worker` (app_job): übernehmen, abschließen, liegengebliebene finden. */
export class JobQueue {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly txOptions: WithTxOptions = {},
  ) {}

  byId(id: string): Promise<Job | undefined> {
    return this.db.selectFrom('job').selectAll().where('id', '=', id).executeTakeFirst();
  }

  /**
   * Setzt einen Job auf `running` (Versuch +1). Nur `pending` oder seit > 20 min `running`, und nur
   * unter der Höchstzahl an Versuchen. `undefined`, wenn ein anderer Lauf ihn schon hat.
   */
  claim(id: string, now: Date): Promise<Job | undefined> {
    const runningBefore = new Date(now.getTime() - JOB_RUNNING_STALE_MS);
    return withTx(
      this.db,
      async (trx) => {
        const job = await trx
          .selectFrom('job')
          .selectAll()
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!job) return undefined;
        const claimable =
          job.status === 'pending' ||
          (job.status === 'running' &&
            job.startedAt !== null &&
            new Date(job.startedAt) < runningBefore);
        if (!claimable || job.attempts >= maxJobAttempts(job.kind as JobKind)) return undefined;
        return trx
          .updateTable('job')
          .set({ status: 'running', startedAt: now, attempts: job.attempts + 1 })
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirst();
      },
      this.txOptions,
    );
  }

  async finish(id: string, now: Date, resultS3Key: string | null = null): Promise<void> {
    await this.db
      .updateTable('job')
      .set({ status: 'done', finishedAt: now, dedupeActive: null, resultS3Key, error: null })
      .where('id', '=', id)
      .where('status', '=', 'running')
      .execute();
  }

  /** Endgültig `failed`; `dedupe_active` wird frei, damit ein späterer Auslöser neu anläuft. */
  async fail(id: string, now: Date, error: JobError): Promise<void> {
    await this.db
      .updateTable('job')
      .set({ status: 'failed', finishedAt: now, dedupeActive: null, error: JSON.stringify(error) })
      .where('id', '=', id)
      .where('status', 'in', OPEN)
      .execute();
  }

  /**
   * Liegengebliebene Jobs für `tick-5min` (TK 7.4): `pending` seit > 2 min oder `running` seit
   * > 20 min. Reihenfolge: Vorrang je Art (Zeitplan vor benutzerausgelöst, TK 13), dann Jobs ohne
   * auslösendes Mitglied, dann Alter.
   */
  async stale(now: Date, limit = 50): Promise<StaleJob[]> {
    const pendingBefore = new Date(now.getTime() - JOB_PENDING_STALE_MS);
    const runningBefore = new Date(now.getTime() - JOB_RUNNING_STALE_MS);
    const rows = await this.db
      .selectFrom('job')
      .select(['id', 'kind', 'attempts', 'createdBy', 'createdAt'])
      .where((eb) =>
        eb.or([
          eb.and([eb('status', '=', 'pending'), eb('runAfter', '<', pendingBefore)]),
          eb.and([eb('status', '=', 'running'), eb('startedAt', '<', runningBefore)]),
        ]),
      )
      .orderBy(sql`created_by IS NULL`, 'desc')
      .orderBy('createdAt', 'asc')
      .limit(limit)
      .execute();
    return rows
      .map((r, index) => ({ r, index }))
      .sort(
        (a, b) =>
          jobPriority(a.r.kind as JobKind) - jobPriority(b.r.kind as JobKind) || a.index - b.index,
      )
      .map(({ r }) => ({ id: r.id, kind: r.kind, attempts: r.attempts }));
  }
}
