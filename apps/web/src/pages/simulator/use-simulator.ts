/**
 * Rechnen im Web Worker (AP-13f, TK 7.4: Einzelnacht im Browser). Ohne Worker-Unterstützung (Tests)
 * läuft dieselbe Funktion im UI-Thread – das Ergebnis ist identisch (FA-SIM-05).
 */
import { useEffect, useMemo } from 'react';
import { wrap, type Remote } from '../../lib/worker-rpc';
import { simulate, type SimulationRequest, type SimulationResult } from './simulate';
import type { SimulatorApi } from './simulator-worker';

export type RunSimulation = (req: SimulationRequest) => Promise<SimulationResult>;

export function useSimulator(): RunSimulation {
  const worker = useMemo(
    () =>
      typeof Worker === 'undefined'
        ? null
        : new Worker(new URL('./simulator-worker.ts', import.meta.url), { type: 'module' }),
    [],
  );
  useEffect(() => () => worker?.terminate(), [worker]);
  return useMemo(() => {
    if (!worker) return (req) => Promise.resolve().then(() => simulate(req));
    const remote: Remote<SimulatorApi> = wrap<SimulatorApi>(worker);
    return (req) => remote.simulate(req);
  }, [worker]);
}
