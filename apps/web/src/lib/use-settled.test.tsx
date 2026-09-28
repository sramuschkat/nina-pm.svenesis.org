// @vitest-environment jsdom
/** `useSettled`: Wert erst nach Stillstand weitergeben (Sternkarte, Logs 25.09.2026). */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettled } from './use-settled';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useSettled', () => {
  it('erster Wert sofort, Änderungen erst nach der Wartezeit ohne weitere Änderung', () => {
    const { result, rerender } = renderHook(({ v }) => useSettled(v, 300), {
      initialProps: { v: 'a' },
    });
    expect(result.current).toBe('a');
    rerender({ v: 'b' });
    act(() => vi.advanceTimersByTime(200));
    rerender({ v: 'c' });
    act(() => vi.advanceTimersByTime(200));
    // 400 ms seit „b“, aber erst 200 ms seit „c“: noch der alte Wert, „b“ wird übersprungen.
    expect(result.current).toBe('a');
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe('c');
  });

  it('gleicher Wert bei neuem Rendern startet keine Wartezeit', () => {
    const { result, rerender } = renderHook(({ v }) => useSettled(v, 300), {
      initialProps: { v: 'a' },
    });
    rerender({ v: 'a' });
    expect(vi.getTimerCount()).toBe(0);
    expect(result.current).toBe('a');
  });
});
