/**
 * Rechnen im Web Worker (AP-13f, TK 7.4: Einzelnacht im Browser). Ohne Worker-Unterstützung (Tests)
 * läuft dieselbe Funktion im UI-Thread – das Ergebnis ist identisch (FA-SIM-05). Der Worker entsteht
 * beim ersten Aufruf und wird beim Verlassen der Seite beendet; ein erneuter Aufruf danach legt ihn
 * neu an (React StrictMode ruft die Aufräumfunktion in der Entwicklung einmal zusätzlich auf).
 *
 * Offene Aufrufe hängen nie (28.09.2026, P1-16): Beim Beenden scheitern sie (`dispose`), und mit dem
 * `signal` der Abfrage bricht TanStack Query beim Verlassen ab und setzt den Zustand zurück – beim
 * Wiederkommen rechnet die Abfrage neu, statt für immer „Plan wird berechnet“ zu zeigen.
 */
import { useCallback, useEffect, useRef } from 'react';
import { connect, type Connection } from '../../lib/worker-rpc';
import { simulate, type SimulationRequest, type SimulationResult } from './simulate';
import type { SimulatorApi } from './simulator-worker';

export type RunSimulation = (
  req: SimulationRequest,
  signal?: AbortSignal,
) => Promise<SimulationResult>;

/** `promise` mit dem Abbruch von `signal` verknüpfen (die Rechnung selbst läuft ggf. weiter, ihr Ergebnis zählt nicht). */
function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new Error('abgebrochen'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('abgebrochen'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error('Fehler'));
      },
    );
  });
}

export function useSimulator(): RunSimulation {
  const current = useRef<{ worker: Worker; connection: Connection<SimulatorApi> } | null>(null);
  useEffect(
    () => () => {
      current.current?.connection.dispose();
      current.current?.worker.terminate();
      current.current = null;
    },
    [],
  );
  return useCallback((req: SimulationRequest, signal?: AbortSignal) => {
    if (typeof Worker === 'undefined')
      return abortable(
        Promise.resolve().then(() => simulate(req)),
        signal,
      );
    if (current.current?.connection.closed) {
      // Nach einem Skriptfehler im Worker einen frischen anlegen.
      current.current.worker.terminate();
      current.current = null;
    }
    if (!current.current) {
      const worker = new Worker(new URL('./simulator-worker.ts', import.meta.url), {
        type: 'module',
      });
      current.current = { worker, connection: connect<SimulatorApi>(worker) };
    }
    return abortable(current.current.connection.remote.simulate(req), signal);
  }, []);
}
