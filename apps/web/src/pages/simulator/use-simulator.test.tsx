// @vitest-environment jsdom
/**
 * P1-16 (28.09.2026): Verlässt man Simulator oder Heute Nacht, während der Worker rechnet, wird er beendet. Vorher
 * blieb die Anfrage offen und TanStack Query zeigte beim Wiederkommen für immer „Plan wird berechnet“.
 */
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimulationRequest } from './simulate';
import { useSimulator } from './use-simulator';

type Listener = (e: MessageEvent) => void;

const workers: FakeWorker[] = [];
let delayMs = 1000;

class FakeWorker {
  readonly listeners = new Map<string, Listener[]>();
  terminated = false;
  constructor() {
    workers.push(this);
  }
  addEventListener(type: string, l: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), l]);
  }
  emit(type: string, data?: unknown) {
    for (const l of this.listeners.get(type) ?? []) l({ data } as MessageEvent);
  }
  postMessage(msg: { id: number }) {
    setTimeout(() => {
      if (!this.terminated) this.emit('message', { id: msg.id, ok: true, value: 'ERGEBNIS' });
    }, delayMs);
  }
  terminate() {
    this.terminated = true;
  }
}

function Probe() {
  const run = useSimulator();
  const q = useQuery({
    queryKey: ['simulation', 'k'],
    queryFn: ({ signal }) => run({} as SimulationRequest, signal) as Promise<unknown>,
    staleTime: Infinity,
    retry: false,
  });
  return <p>{q.isError ? 'fehler' : q.isPending ? 'rechnet' : String(q.data)}</p>;
}

const withClient = (client: QueryClient, strict = false) => {
  const tree = (
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  );
  return strict ? <StrictMode>{tree}</StrictMode> : tree;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Worker', FakeWorker);
  workers.length = 0;
  delayMs = 1000;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useSimulator + useQuery', () => {
  it('Verlassen während der Rechnung und Wiederkommen liefert ein Ergebnis', async () => {
    const client = new QueryClient();
    const first = render(withClient(client));
    expect(screen.getByText('rechnet')).toBeTruthy();
    first.unmount();
    expect(workers[0]?.terminated).toBe(true);
    delayMs = 1;
    render(withClient(client));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.getByText('ERGEBNIS')).toBeTruthy();
  });

  it('StrictMode (doppeltes Einhängen) hängt nicht', async () => {
    const client = new QueryClient();
    render(withClient(client, true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.getByText('ERGEBNIS')).toBeTruthy();
  });

  it('Skriptfehler im Worker beendet die Anfrage mit Fehler; der nächste Lauf legt einen neuen Worker an', async () => {
    const client = new QueryClient();
    render(withClient(client));
    await act(async () => {
      workers[0]?.emit('error');
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('fehler')).toBeTruthy();
    delayMs = 1;
    await act(async () => {
      void client.refetchQueries({ queryKey: ['simulation', 'k'] });
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(workers).toHaveLength(2);
    expect(screen.getByText('ERGEBNIS')).toBeTruthy();
  });
});
