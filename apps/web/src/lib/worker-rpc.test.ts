// @vitest-environment jsdom
/** RPC Seite ↔ Worker (AP-13f): Aufruf, Rückgabe, Fehler, unbekannte Methode – über einen MessageChannel. */
import { describe, expect, it } from 'vitest';
import { connect, expose, wrap } from './worker-rpc';

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

  it('dispose beendet offene Aufrufe mit Fehler, spätere scheitern sofort (P1-16)', async () => {
    const c = channel();
    // Kein `expose`: die Antwort käme nie – wie bei einem beendeten Worker.
    const conn = connect<typeof api>(c.port1);
    const open = conn.remote.add(1, 2);
    conn.dispose();
    await expect(open).rejects.toThrow('Worker beendet');
    expect(conn.closed).toBe(true);
    await expect(conn.remote.add(1, 2)).rejects.toThrow('Worker beendet');
    c.port1.close();
  });

  it('error/messageerror des Workers beenden offene Aufrufe', async () => {
    const listeners = new Map<string, ((e: MessageEvent) => void)[]>();
    const port = {
      postMessage: () => undefined,
      addEventListener: (type: string, l: (e: MessageEvent) => void) =>
        listeners.set(type, [...(listeners.get(type) ?? []), l]),
    };
    const emit = (type: string) => {
      for (const l of listeners.get(type) ?? []) l({} as MessageEvent);
    };
    const conn = connect<typeof api>(port);
    const a = conn.remote.add(1, 2);
    emit('messageerror');
    await expect(a).rejects.toThrow('Worker-Nachricht unlesbar');
    expect(conn.closed).toBe(false);
    const b = conn.remote.add(1, 2);
    emit('error');
    await expect(b).rejects.toThrow('Worker-Fehler');
    expect(conn.closed).toBe(true);
  });

  it('unbekannte Methode → Fehler statt Hängen', async () => {
    const c = channel();
    expose(api, c.port2);
    const remote = wrap<typeof api & { nope: () => void }>(c.port1);
    await expect(remote.nope()).rejects.toThrow(/unbekannte Methode/);
    c.port1.close();
  });
});
