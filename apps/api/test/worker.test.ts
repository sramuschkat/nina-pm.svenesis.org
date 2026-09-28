import type { EnqueueInput, EnqueueResult } from '@nina-pm/db';
import { describe, expect, it, vi } from 'vitest';
import { weatherTick } from '../src/weather/job';
import { dispatch, TICKS, type DispatchDeps, type TickTasks } from '../src/worker/dispatch';
import { HOURLY_FETCH_BUDGET_MS, type JobRunnerDeps } from '../src/worker/jobs';
import { tickTasks } from '../src/worker/tasks';
import { thumbnailTick } from '../src/worker/thumbnail';

const empty: TickTasks = { 'tick-5min': [], 'tick-hourly': [], daily: [], weekly: [] };
const deps = (
  tasks: TickTasks = empty,
  runJob = vi.fn(() => Promise.resolve('done')),
): DispatchDeps => ({
  tasks,
  runJob,
});

describe('Worker-Dispatcher', () => {
  it('kennt genau die vier Zeitpläne aus TK 13', () => {
    expect([...TICKS]).toEqual(['tick-5min', 'tick-hourly', 'daily', 'weekly']);
  });

  it('führt die Aufgaben eines Zeitplans der Reihe nach aus', async () => {
    const order: string[] = [];
    const tasks: TickTasks = {
      ...empty,
      daily: [
        { name: 'a', run: () => Promise.resolve(void order.push('a')) },
        { name: 'b', run: () => Promise.resolve(void order.push('b')) },
      ],
    };
    expect(await dispatch({ tick: 'daily' }, deps(tasks))).toEqual({ ran: ['a', 'b'] });
    expect(order).toEqual(['a', 'b']);
  });

  it('daily räumt abgelaufene Einladungen auf (TK 13)', async () => {
    const cleanupInvitations = vi.fn(() => Promise.resolve(3));
    const tasks = tickTasks(
      { queue: () => Promise.reject(new Error('nicht benutzt')) },
      { cleanupInvitations },
    );
    expect(await dispatch({ tick: 'daily' }, deps(tasks))).toEqual({ ran: ['invitation_cleanup'] });
    expect(cleanupInvitations).toHaveBeenCalledOnce();
  });

  it('tick-hourly lässt überfällige Einreichungen verfallen (AP-12a)', async () => {
    const expireSubmissions = vi.fn(() => Promise.resolve(2));
    const tasks = tickTasks(
      { queue: () => Promise.reject(new Error('nicht benutzt')) },
      { cleanupInvitations: () => Promise.resolve(0), expireSubmissions },
    );
    expect(await dispatch({ tick: 'tick-hourly' }, deps(tasks))).toEqual({
      ran: ['submission_expiry'],
    });
    expect(expireSubmissions).toHaveBeenCalledOnce();
  });

  it('führt {jobId} über den Job-Runner aus', async () => {
    const runJob = vi.fn(() => Promise.resolve('done'));
    expect(await dispatch({ jobId: '0199-job' }, deps(empty, runJob))).toEqual({
      ran: ['job:0199-job'],
    });
    expect(runJob).toHaveBeenCalledWith('0199-job');
  });

  it.each([[null], [{}], [{ tick: 'hourly' }], [{ jobId: '' }], ['tick-5min']])(
    'wirft bei unbekanntem Ereignis %j',
    async (event) => {
      await expect(dispatch(event, deps())).rejects.toThrow('Unbekanntes Worker-Ereignis');
    },
  );

  it('gibt den Fehler einer Aufgabe weiter (→ onFailure-SQS)', async () => {
    const failing = vi.fn(() => Promise.reject(new Error('kaputt')));
    await expect(
      dispatch({ tick: 'weekly' }, deps({ ...empty, weekly: [{ name: 'x', run: failing }] })),
    ).rejects.toThrow('kaputt');
  });

  it('eine fehlschlagende Aufgabe hält die übrigen nicht auf; danach Sammelfehler (28.09.2026)', async () => {
    const order: string[] = [];
    const ok = (name: string) => ({
      name,
      run: () => Promise.resolve(void order.push(name)),
    });
    const fail = (name: string, message: string) => ({
      name,
      run: () => {
        order.push(name);
        return Promise.reject(new Error(message));
      },
    });
    const tasks: TickTasks = {
      ...empty,
      'tick-hourly': [
        fail('submission_expiry', 'permission denied for table change_request'),
        ok('effort_site_nights'),
        fail('forecast_site_nights', 'kaputt'),
        ok('reconcile_site_nights'),
      ],
    };
    const error = await dispatch({ tick: 'tick-hourly' }, deps(tasks)).catch((e: unknown) => e);
    expect(order).toEqual([
      'submission_expiry',
      'effort_site_nights',
      'forecast_site_nights',
      'reconcile_site_nights',
    ]);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toHaveLength(2);
    expect((error as Error).message).toBe(
      'tick-hourly: 2 Aufgabe(n) fehlgeschlagen – submission_expiry: permission denied for table change_request; forecast_site_nights: kaputt',
    );
  });

  it('tick-hourly: erst die Aufgaben je Standort, dann Wetter und Vorschaubilder', async () => {
    const n = () => Promise.resolve(0);
    const tasks = tickTasks(
      { queue: () => Promise.reject(new Error('nicht benutzt')) },
      {
        cleanupInvitations: n,
        weather: n,
        thumbnails: n,
        expireSubmissions: n,
        effortSiteNights: n,
        forecastSiteNights: n,
        reconcileSiteNights: n,
      },
    );
    expect(tasks['tick-hourly'].map((t) => t.name)).toEqual([
      'submission_expiry',
      'effort_site_nights',
      'forecast_site_nights',
      'reconcile_site_nights',
      'weather',
      'thumbnails',
    ]);
  });
});

describe('Zeitbudget der Abrufe im tick-hourly (Lambda-Timeout 15 min)', () => {
  const MIN = 60_000;
  const jobs: JobRunnerDeps = { queue: () => Promise.reject(new Error('nicht benutzt')) };
  /** Jeder Abruf „dauert“ 5 min; `created: false` hält den Job-Runner heraus. */
  const slowEnqueue = (clock: { t: number }) =>
    vi.fn<(tenantId: string, input: EnqueueInput) => Promise<EnqueueResult>>(() => {
      clock.t += 5 * MIN;
      return Promise.resolve({ jobId: 'j', created: false });
    });

  it('ist 8 Minuten', () => {
    expect(HOURLY_FETCH_BUDGET_MS).toBe(8 * MIN);
  });

  it('Vorschaubilder: nach dem Budget kein neuer Abruf', async () => {
    const clock = { t: 0 };
    const enqueue = slowEnqueue(clock);
    const candidates = ['a', 'b', 'c', 'd'].map((p) => ({ tenantId: 't', projectId: p }));
    await thumbnailTick({ candidates: () => Promise.resolve(candidates), enqueue }, jobs, {
      startedAt: 0,
      clock: () => clock.t,
    });
    // 0 min → a, 5 min → b, 10 min > 8 min → Schluss.
    expect(enqueue.mock.calls.map((c) => (c[1].input as { projectId: string }).projectId)).toEqual([
      'a',
      'b',
    ]);
  });

  it('Vorschaubilder: Budget zählt ab Beginn des Laufs, nicht ab Beginn der Aufgabe', async () => {
    const clock = { t: 9 * MIN };
    const enqueue = slowEnqueue(clock);
    await thumbnailTick(
      { candidates: () => Promise.resolve([{ tenantId: 't', projectId: 'a' }]), enqueue },
      jobs,
      { startedAt: 0, clock: () => clock.t },
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('Wetter: nach dem Budget kein neuer Ort', async () => {
    const clock = { t: 0 };
    const enqueue = slowEnqueue(clock);
    const sites = [10, 20, 30, 40].map((lat) => ({
      tenantId: 't',
      siteId: `s${lat}`,
      latitudeDeg: lat,
      longitudeDeg: 10,
      timeZone: 'Europe/Berlin',
    }));
    await weatherTick(
      {
        sites: () => Promise.resolve(sites),
        enqueue,
        runDone: () => Promise.resolve(false),
      },
      jobs,
      new Date('2026-09-28T12:00:00Z'),
      { startedAt: 0, clock: () => clock.t },
    );
    expect(enqueue.mock.calls.map((c) => (c[1].input as { siteId: string }).siteId)).toEqual([
      's10',
      's20',
    ]);
  });
});
