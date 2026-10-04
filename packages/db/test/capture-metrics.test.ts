/**
 * Optionale NINA-Metriken (AP-62): HFR und Sterne aus `capture.metrics` – fehlende oder ungültige Werte werden `null`,
 * nie 0 (NIN5-10).
 */
import { describe, expect, it } from 'vitest';
import { captureMetrics } from '../src/repositories/session-review';

describe('captureMetrics', () => {
  it('liest HFR und Sterne aus jsonb (Objekt oder Text)', () => {
    expect(captureMetrics({ hfr: 2.13, stars: 412, meanAdu: 1800 })).toEqual({
      hfr: 2.13,
      stars: 412,
    });
    expect(captureMetrics('{"hfr":1.9,"stars":88}')).toEqual({ hfr: 1.9, stars: 88 });
  });

  it('ohne Messwerte, mit 0 oder ungültigen Werten → null', () => {
    expect(captureMetrics(null)).toEqual({ hfr: null, stars: null });
    expect(captureMetrics({ meanAdu: 1200 })).toEqual({ hfr: null, stars: null });
    expect(captureMetrics({ hfr: 0, stars: 0 })).toEqual({ hfr: null, stars: null });
    expect(captureMetrics({ hfr: 'x', stars: 2.5 })).toEqual({ hfr: null, stars: null });
    expect(captureMetrics('kein json')).toEqual({ hfr: null, stars: null });
  });
});
