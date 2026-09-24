/** Job-Infrastruktur (TK 7.4, 13; AP-05): enqueueJob, Grenzen, Dispatcher, tick-5min-Übernahme. */
import { dedupeKeys, MultiSimInput, parseUploadedJson, boundedList } from '@nina-pm/shared';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { enqueueJob, type JobInvoker } from '../src/jobs/enqueue';
import { dispatch } from '../src/worker/dispatch';
import { pickupStaleJobs, runJob, type JobHandler, type JobRunnerDeps } from '../src/worker/jobs';
import { tickTasks } from '../src/worker/tasks';
import { MemoryJobs } from './support/memory-jobs';

const TENANT_A = '0190c3f4-0000-7000-8000-00000000000a';
const MEMBER = {
  user: '0190c3f4-0000-7000-8000-0000000000a3',
  admin: '0190c3f4-0000-7000-8000-0000000000a2',
};

function setup(handlers?: JobRunnerDeps['handlers']) {
  let now = new Date('2026-09-23T12:00:00Z');
  const clock = () => now;
  const jobs = new MemoryJobs(clock);
  const deps: JobRunnerDeps = {
    queue: () => Promise.resolve(jobs),
    now: clock,
    ...(handlers ? { handlers } : {}),
  };
  const worker = (event: unknown) =>
    dispatch(event, { tasks: tickTasks(deps), runJob: (id) => runJob(deps, id) });
  return {
    jobs,
    repo: jobs.forTenant(TENANT_A),
    worker,
    advance: (ms: number) => (now = new Date(now.getTime() + ms)),
  };
}

const sim = (day: number) => {
  const input = MultiSimInput.parse({
    rigId: '0190c3f4-0000-7000-8000-00000000c0de',
    nightFrom: `2026-09-${day}`,
    nights: 14,
  });
  return {
    kind: 'multi_sim' as const,
    input,
    dedupeKey: dedupeKeys.multiSim(input),
    createdBy: MEMBER.user,
  };
};

describe('enqueueJob', () => {
  it('ruft worker asynchron nur mit {jobId} auf; der Beispiel-Job noop läuft durch', async () => {
    const { repo, jobs, worker } = setup();
    const invoked: string[] = [];
    // Asynchroner Aufruf (InvocationType Event): der worker läuft entkoppelt vom API-Aufruf.
    const pending: Promise<unknown>[] = [];
    const invoker: JobInvoker = {
      invoke: (jobId) => {
        invoked.push(jobId);
        pending.push(
          new Promise((resolve) => setTimeout(resolve, 0)).then(() => worker({ jobId })),
        );
        return Promise.resolve();
      },
    };
    const { jobId, created } = await enqueueJob(repo, invoker, { kind: 'noop' });
    expect(created).toBe(true);
    expect(jobs.rows.get(jobId)?.status).toBe('pending');
    await Promise.all(pending);
    expect(invoked).toEqual([jobId]);
    expect(jobs.rows.get(jobId)).toMatchObject({ status: 'done', attempts: 1, dedupeActive: null });
  });

  it('unterdrückter Invoke: Job bleibt pending und tick-5min übernimmt ihn nach 2 min', async () => {
    const { repo, jobs, worker, advance } = setup();
    const failing: JobInvoker = {
      invoke: vi.fn(() => Promise.reject(new Error('Invoke gedrosselt'))),
    };
    const { jobId } = await enqueueJob(repo, failing, { kind: 'noop' });
    expect(failing.invoke).toHaveBeenCalledOnce();
    expect(jobs.rows.get(jobId)?.status).toBe('pending');

    advance(60_000);
    await worker({ tick: 'tick-5min' });
    expect(jobs.rows.get(jobId)?.status).toBe('pending');

    advance(90_000);
    expect(await worker({ tick: 'tick-5min' })).toEqual({ ran: ['job_pickup'] });
    expect(jobs.rows.get(jobId)).toMatchObject({ status: 'done', attempts: 1 });
  });

  it('Dedupe: zweiter Auslöser mit offenem dedupe_key legt keinen Job an und ruft nicht erneut auf', async () => {
    const { repo } = setup();
    const invoker = { invoke: vi.fn(() => Promise.resolve()) };
    const first = await enqueueJob(repo, invoker, sim(18));
    const second = await enqueueJob(repo, invoker, sim(18));
    expect(second).toEqual({ jobId: first.jobId, created: false });
    expect(invoker.invoke).toHaveBeenCalledOnce();
  });

  it('Grenze (SV-06): der 4. offene multi_sim eines Mitglieds → 429 auth.rate_limited', async () => {
    const { repo } = setup();
    const invoker = { invoke: () => Promise.resolve() };
    for (const day of [18, 19, 20]) await enqueueJob(repo, invoker, sim(day));
    await expect(enqueueJob(repo, invoker, sim(21))).rejects.toMatchObject({
      code: 'auth.rate_limited',
      status: 429,
    });
    // Andere Mitglieder und Zeitplan-Jobs sind nicht betroffen.
    await expect(
      enqueueJob(repo, invoker, { ...sim(21), createdBy: MEMBER.admin }),
    ).resolves.toMatchObject({ created: true });
    await expect(enqueueJob(repo, invoker, { kind: 'noop' })).resolves.toMatchObject({
      created: true,
    });
  });

  it('nights ≤ 14 im zod-Schema', () => {
    expect(() =>
      MultiSimInput.parse({
        rigId: '0190c3f4-0000-7000-8000-00000000c0de',
        nightFrom: '2026-09-18',
        nights: 15,
      }),
    ).toThrow();
  });
});

describe('Dispatcher und tick-5min', () => {
  it('bevorzugt Zeitplan-Jobs vor benutzerausgelösten', async () => {
    const order: string[] = [];
    const record: JobHandler = ({ job }) => Promise.resolve(void order.push(job.kind));
    const { repo, worker, advance } = setup({ multi_sim: record, noop: record, effort: record });
    await repo.enqueue(sim(18));
    await repo.enqueue({ kind: 'noop' });
    await repo.enqueue({ kind: 'effort', dedupeKey: 'effort:p1' });
    advance(3 * 60_000);
    await worker({ tick: 'tick-5min' });
    expect(order).toEqual(['noop', 'effort', 'multi_sim']);
  });

  it('running > 20 min wird erneut übernommen; nach 3 Versuchen failed', async () => {
    const { repo, jobs, advance } = setup();
    const { jobId } = await repo.enqueue({ kind: 'noop' });
    const job = jobs.rows.get(jobId);
    if (!job) throw new Error('Job fehlt');
    jobs.rows.set(jobId, {
      ...job,
      status: 'running',
      attempts: 3,
      startedAt: new Date('2026-09-23T12:00:00Z'),
    });
    advance(21 * 60_000);
    const result = await pickupStaleJobs({
      queue: () => Promise.resolve(jobs),
      now: () => new Date('2026-09-23T12:21:00Z'),
    });
    expect(result).toEqual({ run: 0, exhausted: 1 });
    expect(jobs.rows.get(jobId)?.status).toBe('failed');
  });

  it('discord_post darf 5 Versuche haben', async () => {
    const { repo, jobs } = setup({ discord_post: () => Promise.resolve(undefined) });
    const { jobId } = await repo.enqueue({ kind: 'discord_post', dedupeKey: 'c:e:o' });
    const job = jobs.rows.get(jobId);
    if (job) jobs.rows.set(jobId, { ...job, attempts: 4 });
    expect(
      await runJob(
        {
          queue: () => Promise.resolve(jobs),
          handlers: { discord_post: () => Promise.resolve(undefined) },
        },
        jobId,
      ),
    ).toBe('done');
  });

  it('unbekannte Art und unerwarteter Fehler → failed mit internal.error (Details nur im Log)', async () => {
    const { repo, jobs } = setup({ noop: () => Promise.reject(new Error('SELECT * FROM geheim')) });
    const a = await repo.enqueue({ kind: 'noop' });
    const b = await repo.enqueue({ kind: 'weather', dedupeKey: 'weather:s:1' });
    const deps = {
      queue: () => Promise.resolve(jobs),
      handlers: { noop: () => Promise.reject(new Error('SELECT * FROM geheim')) },
    };
    expect(await runJob(deps, a.jobId)).toBe('failed');
    expect(await runJob(deps, b.jobId)).toBe('failed');
    expect(JSON.parse(jobs.rows.get(a.jobId)?.error ?? '{}')).toEqual({ code: 'internal.error' });
    expect(jobs.rows.get(b.jobId)?.dedupeActive).toBeNull();
  });

  it('Import-Parser: ungültiges JSON bzw. Liste über .max() → Job failed mit validation.failed', async () => {
    const Import = z.object({ projects: boundedList(z.object({ name: z.string() }), 2) });
    const files: Record<string, string> = {
      bad: '{"projects": [',
      big: JSON.stringify({ projects: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] }),
      good: JSON.stringify({ projects: [{ name: 'a' }] }),
    };
    // Muster des späteren Import-Jobs: Datei aus S3 lesen, parsen, Grenzen prüfen.
    const importHandler: JobHandler = ({ job }) => {
      parseUploadedJson(files[(job.input as { file: string }).file] ?? '', Import);
      return Promise.resolve(undefined);
    };
    const { repo, jobs } = setup();
    const deps = { queue: () => Promise.resolve(jobs), handlers: { import: importHandler } };
    const results: Record<string, unknown> = {};
    for (const file of Object.keys(files)) {
      const { jobId } = await repo.enqueue({
        kind: 'import',
        input: { file },
        dedupeKey: `import:${file}`,
      });
      await runJob(deps, jobId);
      const row = jobs.rows.get(jobId);
      results[file] = {
        status: row?.status,
        error: row?.error ? (JSON.parse(row.error) as { code: string }).code : null,
      };
    }
    expect(results).toEqual({
      bad: { status: 'failed', error: 'validation.failed' },
      big: { status: 'failed', error: 'validation.failed' },
      good: { status: 'done', error: null },
    });
  });
});
