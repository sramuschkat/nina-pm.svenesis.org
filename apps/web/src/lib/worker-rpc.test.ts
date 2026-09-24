// @vitest-environment jsdom
/** RPC Seite ↔ Worker (AP-13f): Aufruf, Rückgabe, Fehler, unbekannte Methode – über einen MessageChannel. */
import { describe, expect, it } from 'vitest';
import { expose, wrap } from './worker-rpc';

function channel() {
  const c = new MessageChannel();
  c.port1.start();
  c.port2.start();
  return c;
}

describe('worker-rpc', () => {
  const api = {
    add: (a: number, b: number) => a + b,
    fail: () => {
      throw new Error('kaputt');
    },
  };

  it('ruft Methoden auf und liefert Ergebnis bzw. Fehler als Promise', async () => {
    const c = channel();
    expose(api, c.port2);
    const remote = wrap<typeof api>(c.port1);
    await expect(remote.add(2, 3)).resolves.toBe(5);
    await expect(remote.fail()).rejects.toThrow('kaputt');
    c.port1.close();
  });

  it('unbekannte Methode → Fehler statt Hängen', async () => {
    const c = channel();
    expose(api, c.port2);
    const remote = wrap<typeof api & { nope: () => void }>(c.port1);
    await expect(remote.nope()).rejects.toThrow(/unbekannte Methode/);
    c.port1.close();
  });
});
