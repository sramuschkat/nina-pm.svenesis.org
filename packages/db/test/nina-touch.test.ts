/**
 * `ninaTouch` (Lambda-Log 09.10.2026): zwei Anfragen derselben NINA-Instanz in derselben Sekunde schreiben dieselbe
 * Zeile – der OCC-Konflikt der zweiten heißt nur, dass die erste den Zeitstempel eben gesetzt hat. Vorher landete er
 * als Warnung `nina_touch_failed` im Log.
 */
import type { Kysely } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/types';
import { NINA_SEEN_INTERVAL_MS, ninaTouch } from '../src/repositories/nina';

const occ = (code: string) =>
  Object.assign(new Error('change conflicts with another transaction'), { code });

/** Gefälschtes Kysely für `updateTable(…).set(…).where(…)…execute()`; `execute` wirft bzw. zählt. */
function fakeDb(execute: () => Promise<unknown>) {
  const wheres: unknown[] = [];
  const chain = {
    set: () => chain,
    where: (...args: unknown[]) => {
      wheres.push(args);
      return chain;
    },
    execute: vi.fn(execute),
  };
  return { db: { updateTable: () => chain } as unknown as Kysely<Database>, chain, wheres };
}

const principal = (lastSeenAt: Date | null) => ({ instanceId: 'i1', tenantId: 't1', lastSeenAt });
const now = new Date('2026-10-09T08:41:40Z');

describe('ninaTouch', () => {
  it('schreibt nur, wenn die letzte Nutzung älter als das Intervall ist (auch in der Datenbank)', async () => {
    const { db, chain, wheres } = fakeDb(() => Promise.resolve([]));
    await ninaTouch(db, principal(new Date(now.getTime() - 60_000)), now);
    expect(chain.execute).not.toHaveBeenCalled();

    await ninaTouch(db, principal(new Date(now.getTime() - NINA_SEEN_INTERVAL_MS - 1)), now);
    expect(chain.execute).toHaveBeenCalledOnce();
    // Mandant, Instanz und die Bedingung „Zeile ist alt oder leer“ – nicht nur die Prüfung im Speicher.
    expect(wheres).toHaveLength(3);
  });

  it.each(['40001', 'OC000', 'OC001'])('übergeht einen OCC-Konflikt (%s) still', async (code) => {
    const { db } = fakeDb(() => Promise.reject(occ(code)));
    await expect(ninaTouch(db, principal(null), now)).resolves.toBeUndefined();
  });

  it('wirft andere Fehler weiter', async () => {
    const { db } = fakeDb(() => Promise.reject(new Error('connection lost')));
    await expect(ninaTouch(db, principal(null), now)).rejects.toThrow('connection lost');
  });
});
