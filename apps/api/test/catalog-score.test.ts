/**
 * Zielvorschläge (FA-FRM-13, AP-21): Bewertungslogik der Website (`observing-planner.js` computeObjects,
 * `sky-map.js` rigFraming/imagingCandidate) mit den Prüfungen aus `verify-planner.js:383–393`.
 */
import { describe, expect, it } from 'vitest';
import {
  brightnessFactor,
  filterHint,
  framingFactor,
  imagingCandidate,
  photoScore,
  sampleWeight,
} from '../src/catalog/score';

describe('Bewertung „Beste der Nacht“', () => {
  it('Bildfeld-Füllung wie die Website (Feld 101,5′)', () => {
    const RF = (s: number | null) => framingFactor(s, 101.5);
    expect(RF(1)).toBe(0.3);
    expect(RF(12)).toBeCloseTo(1, 9);
    expect(RF(30)).toBe(1);
    expect(RF(90)).toBe(1);
    expect(RF(150)).toBeLessThan(1);
    expect(RF(150)).toBeGreaterThan(0.45);
    expect(RF(500)).toBe(0.45);
    expect(RF(null)).toBe(0.6);
  });

  it('Bildkandidaten: Größe 3′–3°, Helligkeitsgrenzen, keine Komponenten, keine Sterne', () => {
    const c = (o: Partial<Parameters<typeof imagingCandidate>[0]>) =>
      imagingCandidate({ primaryId: 'NGC 1', group: 'galaxy', sizeMajorArcmin: 10, mag: 10, ...o });
    expect(c({})).toBe(true);
    expect(c({ mag: 12.5 })).toBe(false);
    expect(c({ sizeMajorArcmin: 2 })).toBe(false);
    expect(c({ sizeMajorArcmin: 200 })).toBe(false);
    expect(c({ primaryId: 'NGC 1234A' })).toBe(false);
    expect(c({ group: 'globular_cluster', mag: 10.5 })).toBe(false);
    expect(c({ group: 'open_cluster', mag: 7, sizeMajorArcmin: 4 })).toBe(false);
    expect(c({ group: 'emission_nebula', mag: null })).toBe(true);
    expect(c({ group: 'multiple_star' })).toBe(false);
  });

  it('Gewicht: unter 20° nichts, ab 60° voll; Mond trifft Galaxien stärker als Emissionsnebel', () => {
    expect(sampleWeight(15, null, 'Gx')).toBe(0);
    expect(sampleWeight(60, null, 'Gx')).toBe(1);
    expect(sampleWeight(40, null, 'Gx')).toBeCloseTo(0.5, 9);
    const moon = { up: true, illumFraction: 1, sepDeg: 10 };
    expect(sampleWeight(60, moon, 'Gx')).toBeCloseTo(0.15, 9);
    expect(sampleWeight(60, moon, 'EN')).toBeCloseTo(1 - 0.85 * 0.25, 9);
    expect(sampleWeight(60, { ...moon, sepDeg: 95 }, 'Gx')).toBe(1);
  });

  it('Helligkeit und Gesamtwertung', () => {
    expect(brightnessFactor(7)).toBe(1);
    expect(brightnessFactor(12)).toBeCloseTo(0.5, 9);
    expect(brightnessFactor(null)).toBe(0.7);
    expect(photoScore(8, 8, 30, 101.5, 5)).toBe(1);
    expect(photoScore(4, 8, 30, 101.5, 5)).toBeCloseTo(0.5, 9);
  });

  it('Filterempfehlung: Schmalband für Emissionsobjekte', () => {
    expect(filterHint('emission_nebula')).toBe('narrowband');
    expect(filterHint('planetary_nebula')).toBe('narrowband');
    expect(filterHint('galaxy')).toBe('broadband');
    expect(filterHint('multiple_star')).toBeNull();
    // Haufen mit Nebel (M 42, IC 1805) werden wie Emissionsnebel fotografiert.
    expect(filterHint('open_cluster', 'Cl+N')).toBe('narrowband');
    expect(filterHint('open_cluster', 'OCl')).toBe('broadband');
  });
});
