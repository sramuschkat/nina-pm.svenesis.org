/**
 * Mosaik-Geometrie (`specs/engine/geometry.md` §2.3, Pflicht-Tests; AP-13b): Panelzentren über die
 * inverse Gnomonik, Feldrotation `γ` über Vektoren, NINA-Nummerierung (NT-32), Normalisierung (NT-31).
 * Toleranz: Koordinaten 1e-5°, `γ` 1e-4°.
 */
import { describe, expect, it } from 'vitest';
import {
  fieldRotationDeg,
  mosaicPanels,
  normAngle,
  offsetToSky,
  panelCell,
  panelNumber,
} from '../src';

const near = (a: number, b: number, tol: number) =>
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

describe('Panelzentren und Feldrotation (§2.3)', () => {
  it.each([
    [0, 0.45, 0.45, 0.44999, 0.44998, 0],
    [30, 6.75, 6.75, 8.30442, 36.43003, 4.1696],
    [70, 6.75, 6.75, 26.98992, 75.1637, 25.4278],
    [70, 6.75, -6.75, 14.58621, 62.51981, 13.7841],
    [80, 6.75, 6.75, 63.9338, 82.56704, 62.9581],
    [-45, 6.75, 6.75, 8.47745, -37.97525, -6.0245],
  ])('δ₀ = %s°, ξ = %s°, η = %s° → α %s°, δ %s°, γ %s°', (d0, xi, eta, ra, dec, gamma) => {
    const sky = offsetToSky(0, d0, xi, eta);
    near(sky.raDeg, ra, 1e-5);
    near(sky.decDeg, dec, 1e-5);
    near(fieldRotationDeg(0, d0, xi, eta), gamma, 1e-4);
  });

  it('1×1: Panel = Projektzentrum, paPanel = pa₀', () => {
    const [p] = mosaicPanels({
      raDeg: 83.8,
      decDeg: -5.4,
      paDeg: 12,
      cols: 1,
      rows: 1,
      overlapPct: 10,
      fovWidthDeg: 1,
      fovHeightDeg: 1,
    });
    expect(p).toMatchObject({ n: 1, raDeg: 83.8, decDeg: -5.4, gammaDeg: 0, paDeg: 12 });
  });

  it('2×2, pa₀ = 0, δ₀ = 0, 1°×1°, 10 %: Offsets ±0,45°, Panel 1 = Nordost, γ = 0', () => {
    const panels = mosaicPanels({
      raDeg: 0,
      decDeg: 0,
      paDeg: 0,
      cols: 2,
      rows: 2,
      overlapPct: 10,
      fovWidthDeg: 1,
      fovHeightDeg: 1,
    });
    const p1 = panels[0];
    expect(p1).toMatchObject({ n: 1, i: 1, j: 0, xiDeg: 0.45, etaDeg: 0.45, gammaDeg: 0 });
    near(p1?.raDeg ?? 0, 0.44999, 1e-5);
    near(p1?.decDeg ?? 0, 0.44998, 1e-5);
    expect(panels[3]).toMatchObject({ n: 4, i: 0, j: 1, xiDeg: -0.45, etaDeg: -0.45 });
    // Panel 2 liegt westlich des Zentrums → α knapp unter 360° (keine Sprünge, NT-31)
    expect(panels[1]?.raDeg).toBeGreaterThan(359.5);
    expect(panels[1]?.raDeg).toBeLessThan(360);
  });

  it('3×3, pa₀ = 30°: Raster gedreht, γ hängt nur von ξ, η ab', () => {
    const rotated = mosaicPanels({
      raDeg: 10,
      decDeg: 40,
      paDeg: 30,
      cols: 3,
      rows: 3,
      overlapPct: 0,
      fovWidthDeg: 2,
      fovHeightDeg: 2,
    });
    for (const p of rotated) {
      near(p.gammaDeg, fieldRotationDeg(10, 40, p.xiDeg, p.etaDeg), 1e-6);
      near(p.paDeg, normAngle(30 + p.gammaDeg), 1e-6);
    }
    const corner = rotated.find((p) => p.i === 2 && p.j === 0);
    // ξ' = +2, η' = +2 um 30° gedreht: ξ = 2·cos30 + 2·sin30, η = −2·sin30 + 2·cos30
    near(corner?.xiDeg ?? 0, 2 * Math.cos(Math.PI / 6) + 1, 1e-6);
    near(corner?.etaDeg ?? 0, -1 + 2 * Math.cos(Math.PI / 6), 1e-6);
  });

  it('4×4, δ₀ = 70°, Abstand 4,5°: max |Δα| = 26,99°, max |γ| = 25,43°', () => {
    const panels = mosaicPanels({
      raDeg: 0,
      decDeg: 70,
      paDeg: 0,
      cols: 4,
      rows: 4,
      overlapPct: 0,
      fovWidthDeg: 4.5,
      fovHeightDeg: 4.5,
    });
    const dra = Math.max(...panels.map((p) => Math.abs(p.raDeg > 180 ? p.raDeg - 360 : p.raDeg)));
    const g = Math.max(...panels.map((p) => Math.abs(p.gammaDeg)));
    near(dra, 26.98992, 1e-4);
    near(g, 25.4278, 1e-4);
  });

  it('Zentrum α₀ = 0,5°, Panel links → α = 359,x° (Normalisierung)', () => {
    const [west] = mosaicPanels({
      raDeg: 0.5,
      decDeg: 0,
      paDeg: 0,
      cols: 1,
      rows: 1,
      overlapPct: 0,
      fovWidthDeg: 1,
      fovHeightDeg: 1,
    }).map(() => offsetToSky(0.5, 0, -1, 0));
    expect(normAngle(west?.raDeg ?? 0)).toBeGreaterThan(359);
  });

  it('Nummerierung NT-32: 2×2 und Hin-/Rückrechnung 3×2', () => {
    expect(panelNumber(1, 0, 2)).toBe(1);
    expect(panelNumber(0, 0, 2)).toBe(2);
    expect(panelNumber(1, 1, 2)).toBe(3);
    expect(panelNumber(0, 1, 2)).toBe(4);
    for (let n = 1; n <= 6; n++) {
      const { i, j } = panelCell(n, 3);
      expect(panelNumber(i, j, 3)).toBe(n);
    }
  });

  it('ohne Rotator: Raster mit pa₀ = Kamerawinkel (NT-30)', () => {
    const panels = mosaicPanels({
      raDeg: 50,
      decDeg: 20,
      paDeg: 12,
      cols: 2,
      rows: 1,
      overlapPct: 10,
      fovWidthDeg: 1,
      fovHeightDeg: 1,
    });
    for (const p of panels) near(p.paDeg, normAngle(12 + p.gammaDeg), 1e-9);
  });

  it('Normalisierung NT-31: 359,9999999 → 0; −0 → 0', () => {
    expect(normAngle(359.9999999)).toBe(0);
    expect(Object.is(normAngle(-0), 0)).toBe(true);
    expect(normAngle(-10)).toBe(350);
  });
});
