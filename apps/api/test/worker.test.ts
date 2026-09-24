import { describe, expect, it, vi } from 'vitest';
import { dispatch, TICKS, type DispatchDeps, type TickTasks } from '../src/worker/dispatch';
import { tickTasks } from '../src/worker/tasks';

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
});
