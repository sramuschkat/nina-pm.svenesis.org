/**
 * Nachtwerte im Objektbrowser (`catalog/night.ts`): Gipfelhöhe im Dunkeln auch an den Rändern der Dunkelheit
 * (Astronomie-Prüfung 28.09.2026). M 57 geht über Hannover am 28.09.2026 nach der astronomischen
 * Abenddämmerung unter – der höchste Stand im Dunkeln liegt genau an deren Beginn; das 5-min-Raster allein
 * lieferte rund ein halbes Grad zu wenig.
 */
import { targetAt } from '@nina-pm/engine';
import { describe, expect, it } from 'vitest';
import { nightEvaluator } from '../src/catalog/night';
import type { CatalogRow } from '../src/catalog/search';

const at = (iso: string) => Date.parse(iso) / 1000;

describe('Nachtwerte: Gipfelhöhe an den Rändern der Dunkelheit', () => {
  const ev = nightEvaluator({
    site: { latDeg: 52.3705, lonDeg: 9.7332, timeZone: 'Europe/Berlin' },
    night: '2026-09-28',
    timeZoneTransitions: [
      { atUtc: at('2026-03-29T01:00:00Z'), utcOffsetMinutes: 120 },
      { atUtc: at('2026-10-25T01:00:00Z'), utcOffsetMinutes: 60 },
    ],
    minAltDeg: 30,
    twilight: 'astronomical',
  });

  it('M 57: höchster Stand am Beginn der Dunkelheit = Höhe dort (scheinbar)', () => {
    const m57 = {
      id: 'm57',
      primaryId: 'NGC 6720',
      raDeg: 283.396,
      decDeg: 33.029,
    } as unknown as CatalogRow;
    const n = ev.metrics(m57);
    expect(n.peakUtc).toBe(ev.meta.darkStartUtc);
    const start = Date.parse(ev.meta.darkStartUtc ?? '') / 1000;
    const exact = targetAt({ raJ2000Deg: 283.396, decJ2000Deg: 33.029 }, start, {
      latDeg: 52.3705,
      lonDeg: 9.7332,
    }).altDeg;
    expect(Math.abs((n.peakAltDeg ?? 0) - exact)).toBeLessThanOrEqual(0.05);
  });

  it('Objekt mit Kulmination mitten in der Nacht: unverändert eine Slotgrenze', () => {
    const m31 = {
      id: 'm31',
      primaryId: 'NGC 224',
      raDeg: 10.6847,
      decDeg: 41.2687,
    } as unknown as CatalogRow;
    const n = ev.metrics(m31);
    expect(n.peakUtc).not.toBe(ev.meta.darkStartUtc);
    expect(n.peakUtc).not.toBe(ev.meta.darkEndUtc);
    expect(n.peakAltDeg).toBeGreaterThan(78);
  });
});
