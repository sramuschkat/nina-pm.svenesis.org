// @vitest-environment jsdom
/** Live-Aufwand im Editor (AP-13e): entprellt 500 ms, Abbruch bei neuer Eingabe, Rückfall ohne Worker. */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EffortRequest, EffortResponse } from './effort-messages';
import { LIVE_EFFORT_DEBOUNCE_MS, useLiveEffort, type LiveEffortInput } from './use-live-effort';

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((e: MessageEvent<EffortResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  posted: EffortRequest[] = [];
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(m: EffortRequest) {
    this.posted.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  reply(view: EffortResponse['view']) {
    const last = this.posted.at(-1);
    this.onmessage?.({ data: { seq: last?.seq ?? 0, ok: true, view } } as MessageEvent);
  }
}

const factory = () => new FakeWorker() as unknown as Worker;
const input = (raDeg: number) => ({ project: { raDeg } }) as unknown as LiveEffortInput;
const view = { tag: 'single_night', nights: 1 } as never;

beforeEach(() => {
  vi.useFakeTimers();
  FakeWorker.all = [];
});
afterEach(() => vi.useRealTimers());

describe('useLiveEffort', () => {
  it('rechnet erst nach 500 ms Ruhe und liefert das Ergebnis live', () => {
    const { result, rerender } = renderHook(({ i }) => useLiveEffort(i, null, factory), {
      initialProps: { i: input(10) },
    });
    rerender({ i: input(11) });
    act(() => void vi.advanceTimersByTime(LIVE_EFFORT_DEBOUNCE_MS - 1));
    expect(FakeWorker.all).toHaveLength(0);
    act(() => void vi.advanceTimersByTime(1));
    expect(FakeWorker.all).toHaveLength(1);
    expect(result.current.state).toBe('loading');
    act(() => FakeWorker.all[0]?.reply(view));
    expect(result.current).toEqual({ state: 'ready', effort: view, live: true });
  });

  it('neue Eingabe während einer Rechnung beendet den Worker und startet einen neuen', () => {
    const { rerender } = renderHook(({ i }) => useLiveEffort(i, null, factory), {
      initialProps: { i: input(10) },
    });
    act(() => void vi.advanceTimersByTime(LIVE_EFFORT_DEBOUNCE_MS));
    rerender({ i: input(12) });
    act(() => void vi.advanceTimersByTime(LIVE_EFFORT_DEBOUNCE_MS));
    expect(FakeWorker.all).toHaveLength(2);
    expect(FakeWorker.all[0]?.terminated).toBe(true);
  });

  it('ohne Worker bzw. ohne Eingabe: gespeichertes Kennzeichen des Servers', () => {
    const { result } = renderHook(() => useLiveEffort(input(10), view, null));
    expect(result.current).toEqual({ state: 'ready', effort: view, live: false });
    const empty = renderHook(() => useLiveEffort(null, null, factory));
    expect(empty.result.current.state).toBe('empty');
  });
});
