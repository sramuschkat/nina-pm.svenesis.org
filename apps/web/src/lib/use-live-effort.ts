/**
 * Live-Aufwand-Kennzeichen im Projekt-Editor (FA-PRJ-23, effort.md: Browser `stride` 5, entprellt
 * 500 ms, Abbruch bei neuer Eingabe). Rechnet in einem Web Worker; eine neue Eingabe während einer
 * Rechnung beendet den Worker und startet einen neuen. Ohne Worker-Unterstützung (Tests, alte Browser)
 * bleibt das gespeicherte Kennzeichen des Servers.
 */
import type { EffortView } from '@nina-pm/shared';
import { useEffect, useRef, useState } from 'react';
import type { EffortRequest, EffortResponse } from './effort-messages';

export const LIVE_EFFORT_DEBOUNCE_MS = 500;

export type LiveEffortInput = Omit<EffortRequest, 'seq' | 'computedAt'>;

export interface LiveEffort {
  readonly state: 'loading' | 'ready' | 'error' | 'empty';
  readonly effort: EffortView | null;
  /** `true`, wenn das Kennzeichen im Browser gerechnet wurde. */
  readonly live: boolean;
}

type WorkerFactory = () => Worker;

const defaultFactory: WorkerFactory = () =>
  new Worker(new URL('./effort-worker.ts', import.meta.url), { type: 'module' });

export function useLiveEffort(
  input: LiveEffortInput | null,
  fallback: EffortView | null,
  factory: WorkerFactory | null = typeof Worker === 'undefined' ? null : defaultFactory,
): LiveEffort {
  const [result, setResult] = useState<LiveEffort>({
    state: fallback ? 'ready' : 'empty',
    effort: fallback,
    live: false,
  });
  const worker = useRef<Worker | null>(null);
  const busy = useRef(false);
  const seq = useRef(0);
  // Eingabe als Schlüssel: gleiche Daten → keine neue Rechnung.
  const key = input ? JSON.stringify(input) : '';

  useEffect(() => {
    if (!input || !factory) return undefined;
    const timer = setTimeout(() => {
      seq.current += 1;
      const mine = seq.current;
      if (busy.current && worker.current) {
        worker.current.terminate();
        worker.current = null;
      }
      const w = worker.current ?? factory();
      worker.current = w;
      busy.current = true;
      setResult((r) => ({ ...r, state: 'loading' }));
      w.onmessage = (e: MessageEvent<EffortResponse>) => {
        if (e.data.seq !== mine) return;
        busy.current = false;
        setResult(
          e.data.ok
            ? { state: e.data.view ? 'ready' : 'empty', effort: e.data.view, live: true }
            : { state: 'error', effort: null, live: true },
        );
      };
      w.onerror = () => {
        busy.current = false;
        setResult({ state: 'error', effort: null, live: true });
      };
      const request: EffortRequest = { ...input, seq: mine, computedAt: new Date().toISOString() };
      w.postMessage(request);
    }, LIVE_EFFORT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `key` fasst `input` zusammen; `factory` ist stabil.
  }, [key, factory]);

  useEffect(
    () => () => {
      worker.current?.terminate();
      worker.current = null;
    },
    [],
  );

  if (!input || !factory)
    return { state: fallback ? 'ready' : 'empty', effort: fallback, live: false };
  return result;
}
