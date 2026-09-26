/**
 * Saisondiagramm und Wochen-Sichtbarkeit im Browser (AP-24): ein Jahr Nächte kostet einige hundert
 * Millisekunden, deshalb rechnet ein Web Worker (entprellt, nur das jüngste Ergebnis zählt). Ohne
 * Worker-Unterstützung (Tests) rechnet der Hauptthread dieselben Funktionen.
 */
import type { SeasonBar, SeasonChartData, SeasonRange, SeasonTargetInput } from '@nina-pm/shared';
import { useEffect, useRef, useState } from 'react';
import { seasonApi, type SeasonApi } from './season-api';
import { wrap, type Remote } from './worker-rpc';

export const SEASON_DEBOUNCE_MS = 300;

let remote: Remote<SeasonApi> | null | undefined;

function client(): Remote<SeasonApi> | null {
  if (remote === undefined)
    remote =
      typeof Worker === 'undefined'
        ? null
        : wrap<SeasonApi>(
            new Worker(new URL('./season-worker.ts', import.meta.url), { type: 'module' }),
          );
  return remote;
}

export interface SeasonResult<T> {
  readonly state: 'loading' | 'ready' | 'error';
  readonly data: T | null;
}

function useComputed<T>(key: string | null, compute: () => Promise<T>): SeasonResult<T> {
  const [result, setResult] = useState<SeasonResult<T>>({ state: 'loading', data: null });
  const seq = useRef(0);
  useEffect(() => {
    if (key === null) return undefined;
    seq.current += 1;
    const mine = seq.current;
    setResult((r) => ({ state: 'loading', data: r.data }));
    const timer = setTimeout(() => {
      compute().then(
        (data) => {
          if (seq.current === mine) setResult({ state: 'ready', data });
        },
        () => {
          if (seq.current === mine) setResult({ state: 'error', data: null });
        },
      );
    }, SEASON_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `key` fasst die Eingabe zusammen.
  }, [key]);
  return result;
}

export function useSeasonChart(
  input: SeasonTargetInput | null,
  range: SeasonRange,
): SeasonResult<SeasonChartData> {
  const key = input ? JSON.stringify([input, range]) : null;
  return useComputed(key, () => {
    if (!input) return Promise.reject(new Error('keine Eingabe'));
    const c = client();
    return c ? c.chart(input, range) : Promise.resolve(seasonApi.chart(input, range));
  });
}

export function useVisibilityWeeks(
  inputs: readonly SeasonTargetInput[] | null,
): SeasonResult<SeasonBar[][]> {
  const key = inputs ? JSON.stringify(inputs) : null;
  return useComputed(key, () => {
    if (!inputs) return Promise.reject(new Error('keine Eingabe'));
    const c = client();
    return c ? c.weeks(inputs) : Promise.resolve(seasonApi.weeks(inputs));
  });
}
