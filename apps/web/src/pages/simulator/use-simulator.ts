/**
 * Rechnen im Web Worker (AP-13f, TK 7.4: Einzelnacht im Browser). Ohne Worker-Unterstützung (Tests)
 * läuft dieselbe Funktion im UI-Thread – das Ergebnis ist identisch (FA-SIM-05). Der Worker entsteht
 * beim ersten Aufruf und wird beim Verlassen der Seite beendet; ein erneuter Aufruf danach legt ihn
 * neu an (React StrictMode ruft die Aufräumfunktion in der Entwicklung einmal zusätzlich auf).
 */
import { useCallback, useEffect, useRef } from 'react';
import { wrap, type Remote } from '../../lib/worker-rpc';
import { simulate, type SimulationRequest, type SimulationResult } from './simulate';
import type { SimulatorApi } from './simulator-worker';

export type RunSimulation = (req: SimulationRequest) => Promise<SimulationResult>;

export function useSimulator(): RunSimulation {
  const current = useRef<{ worker: Worker; remote: Remote<SimulatorApi> } | null>(null);
  useEffect(
    () => () => {
      current.current?.worker.terminate();
      current.current = null;
    },
    [],
  );
  return useCallback((req: SimulationRequest) => {
    if (typeof Worker === 'undefined') return Promise.resolve().then(() => simulate(req));
    if (!current.current) {
      const worker = new Worker(new URL('./simulator-worker.ts', import.meta.url), {
        type: 'module',
      });
      current.current = { worker, remote: wrap<SimulatorApi>(worker) };
    }
    return current.current.remote.simulate(req);
  }, []);
}
