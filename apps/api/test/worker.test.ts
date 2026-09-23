import { describe, expect, it, vi } from 'vitest';
import { dispatch, TICKS, type TickTasks } from '../src/worker/dispatch';

const empty: TickTasks = { 'tick-5min': [], 'tick-hourly': [], daily: [], weekly: [] };

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
    expect(await dispatch({ tick: 'daily' }, tasks)).toEqual({ ran: ['a', 'b'] });
    expect(order).toEqual(['a', 'b']);
  });

  it('nimmt {jobId} an (Ausführung folgt mit AP-05)', async () => {
    expect(await dispatch({ jobId: '0199-job' }, empty)).toEqual({ ran: [] });
  });

  it.each([[null], [{}], [{ tick: 'hourly' }], [{ jobId: '' }], ['tick-5min']])(
    'wirft bei unbekanntem Ereignis %j',
    async (event) => {
      await expect(dispatch(event, empty)).rejects.toThrow('Unbekanntes Worker-Ereignis');
    },
  );

  it('gibt den Fehler einer Aufgabe weiter (→ onFailure-SQS)', async () => {
    const failing = vi.fn(() => Promise.reject(new Error('kaputt')));
    await expect(
      dispatch({ tick: 'weekly' }, { ...empty, weekly: [{ name: 'x', run: failing }] }),
    ).rejects.toThrow('kaputt');
  });
});
