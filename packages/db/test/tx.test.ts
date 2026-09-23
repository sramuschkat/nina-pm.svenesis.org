import type { Kysely } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import {
  isOccConflict,
  orderGuards,
  RowCounterPlugin,
  RowLimitExceededError,
  withTx,
} from '../src/tx';

const occ = (code = '40001') => Object.assign(new Error('conflict'), { code });

/** Gefälschtes Kysely: execute ruft den Callback mit einer Transaktion ohne Datenbank auf. */
function fakeDb() {
  const trx = { withPlugin: () => trx };
  const execute = vi.fn((cb: (t: unknown) => Promise<unknown>) => cb(trx));
  return { db: { transaction: () => ({ execute }) } as unknown as Kysely<unknown>, execute };
}

describe('withTx', () => {
  it.each(['40001', 'OC000', 'OC001'])(
    'wiederholt bei %s mit 50/150/400 ms + Jitter',
    async (code) => {
      const { db } = fakeDb();
      const sleeps: number[] = [];
      let calls = 0;
      const result = await withTx(
        db,
        () => {
          calls += 1;
          return calls < 3 ? Promise.reject(occ(code)) : Promise.resolve('ok');
        },
        { sleep: (ms) => (sleeps.push(ms), Promise.resolve()), jitter: () => 7 },
      );
      expect(result).toBe('ok');
      expect(sleeps).toEqual([57, 157]);
    },
  );

  it('gibt nach drei Wiederholungen auf', async () => {
    const { db } = fakeDb();
    const onRetry = vi.fn();
    const fn = vi.fn(() => Promise.reject(occ()));
    await expect(withTx(db, fn, { sleep: () => Promise.resolve(), onRetry })).rejects.toMatchObject(
      { code: '40001' },
    );
    expect(fn).toHaveBeenCalledTimes(4);
    expect(onRetry).toHaveBeenCalledTimes(3);
  });

  it('wiederholt andere Fehler nicht', async () => {
    const { db } = fakeDb();
    const fn = vi.fn(() => Promise.reject(Object.assign(new Error('x'), { code: '23505' })));
    await expect(withTx(db, fn, { sleep: () => Promise.resolve() })).rejects.toThrow('x');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('erkennt OCC-Konflikte', () => {
    expect(isOccConflict(occ('OC000'))).toBe(true);
    expect(isOccConflict(new Error('x'))).toBe(false);
    expect(isOccConflict(null)).toBe(false);
  });
});

describe('Wächter und Zeilenzähler', () => {
  it('sperrt Wächter stets nach Tabelle und ID (DAT5-20)', () => {
    expect(
      orderGuards([
        { table: 'rig_lease', id: 'b' },
        { table: 'exposure_line', id: 'z' },
        { table: 'exposure_line', id: 'a' },
      ]).map((g) => `${g.table}:${g.id}`),
    ).toEqual(['exposure_line:a', 'exposure_line:z', 'rig_lease:b']);
  });

  it('bricht über 3.000 geänderten Zeilen ab', async () => {
    const plugin = new RowCounterPlugin(3000);
    const result = (n: number) => ({
      result: { rows: [], numAffectedRows: BigInt(n) },
      queryId: { queryId: 'q' },
    });
    await plugin.transformResult(result(2000) as never);
    await plugin.transformResult(result(1000) as never);
    await expect(plugin.transformResult(result(1) as never)).rejects.toBeInstanceOf(
      RowLimitExceededError,
    );
  });
});
