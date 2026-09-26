/**
 * Vorschaubild des Projekt-Bildfelds (AP-25; FA-PRJ-02, TK 12): Ausschnitt aus Rig-Bildfeld bzw. Mosaik,
 * Drehung (ohne Rotator Kamerawinkel, NT-30), Testvektor des Schlüssels (kanonische Zahlform `q(x,1e6)`,
 * feste Reihenfolge), hips2fits-Aufruf in Dezimalgrad mit `rotation_angle = −pa`; T-KAT-12 Teil
 * `catalog/thumbs/…`: nie unter `catalog/img/…`, Schlüssel eindeutig und stabil.
 */
import { describe, expect, it } from 'vitest';
import {
  hips2fitsUrl,
  projectThumbnailParams,
  THUMBNAIL_PREFIX,
  thumbnailCanonical,
  thumbnailKey,
  thumbnailSize,
  thumbnailUrl,
} from '../src/thumbnail';

const rig = (over: Partial<Parameters<typeof projectThumbnailParams>[1]> = {}) => ({
  hasRotator: true,
  defaultRotationDeg: null,
  derived: { fovWidthDeg: 2.5, fovHeightDeg: 1.7 },
  ...over,
});
const project = (over: Partial<Parameters<typeof projectThumbnailParams>[0]> = {}) => ({
  raDeg: 10.6847 as number | null,
  decDeg: 41.269 as number | null,
  rotationDeg: 35,
  mosaic: { cols: 1, rows: 1, overlapPct: 20 },
  ...over,
});

describe('projectThumbnailParams', () => {
  it('Einzelfeld: Rig-Bildfeld mit 15 % Rand, Projektwinkel', () => {
    const p = projectThumbnailParams(project(), rig());
    expect(p).toMatchObject({ raDeg: 10.6847, decDeg: 41.269, rotationDeg: 35 });
    expect(p?.fovWidthDeg).toBeCloseTo(2.875, 12);
    expect(p?.fovHeightDeg).toBeCloseTo(1.955, 12);
  });
  it('Mosaik 3 × 2 mit 20 % Überlappung: n · fov − (n − 1) · Überlappung', () => {
    const p = projectThumbnailParams(
      project({ mosaic: { cols: 3, rows: 2, overlapPct: 20 } }),
      rig(),
    );
    expect(p?.fovWidthDeg).toBeCloseTo(2.5 * 2.6 * 1.15, 12);
    expect(p?.fovHeightDeg).toBeCloseTo(1.7 * 1.8 * 1.15, 12);
  });
  it('ohne Rotator: Kamerawinkel des Rigs (NT-30); Winkel auf [0, 360)', () => {
    expect(
      projectThumbnailParams(project(), rig({ hasRotator: false, defaultRotationDeg: 12 }))
        ?.rotationDeg,
    ).toBe(12);
    expect(
      projectThumbnailParams(project(), rig({ hasRotator: false, defaultRotationDeg: null }))
        ?.rotationDeg,
    ).toBe(0);
    expect(projectThumbnailParams(project({ rotationDeg: -10 }), rig())?.rotationDeg).toBe(350);
  });
  it('ohne Koordinaten oder Bildfeld kein Ausschnitt', () => {
    expect(projectThumbnailParams(project({ raDeg: null }), rig())).toBeNull();
    expect(
      projectThumbnailParams(project(), rig({ derived: { fovWidthDeg: 0, fovHeightDeg: 1 } })),
    ).toBeNull();
  });
});

describe('Schlüssel (TK 12)', () => {
  const p = projectThumbnailParams(project(), rig());
  it('Testvektor: kanonische Form und sha256', () => {
    expect(p).not.toBeNull();
    if (!p) return;
    expect(thumbnailCanonical(p)).toBe('v1|10.6847|41.269|2.875|1.955|35|CDS/P/DSS2/color');
    expect(thumbnailKey(p)).toBe(
      'catalog/thumbs/092ed19e645b0370a3caff8f850428cd65336c71961a3ea0e8a946a2ae8e17bf.jpg',
    );
    expect(thumbnailUrl(thumbnailKey(p))).toBe(`/${thumbnailKey(p)}`);
  });
  it('gleicher Ausschnitt → gleicher Schlüssel (Rundung 1e-6), anderer Ausschnitt → anderer', () => {
    if (!p) return;
    expect(thumbnailKey({ ...p, raDeg: p.raDeg + 4e-7 })).toBe(thumbnailKey(p));
    expect(thumbnailKey({ ...p, raDeg: p.raDeg + 360 })).toBe(thumbnailKey(p));
    expect(thumbnailKey({ ...p, rotationDeg: 36 })).not.toBe(thumbnailKey(p));
    expect(thumbnailKey({ ...p, survey: 'CDS/P/DSS2/red' })).not.toBe(thumbnailKey(p));
  });
  it('T-KAT-12 (Teil AP-25): nur unter catalog/thumbs/, nie unter catalog/img/; eindeutig', () => {
    const keys = new Set<string>();
    for (let ra = 0; ra < 360; ra += 7.5)
      for (const dec of [-60, 0, 45])
        for (const rot of [0, 90]) {
          const q = projectThumbnailParams(
            project({ raDeg: ra, decDeg: dec, rotationDeg: rot }),
            rig(),
          );
          if (!q) continue;
          const key = thumbnailKey(q);
          expect(key.startsWith(THUMBNAIL_PREFIX)).toBe(true);
          expect(key.startsWith('catalog/img/')).toBe(false);
          expect(key).toMatch(/^catalog\/thumbs\/[0-9a-f]{64}\.jpg$/);
          keys.add(key);
        }
    expect(keys.size).toBe(48 * 3 * 2);
  });
});

describe('hips2fits (AST-D26)', () => {
  it('Dezimalgrad, fov = Breite, icrs, TAN, rotation_angle = −pa, Seitenverhältnis', () => {
    const p = projectThumbnailParams(project(), rig());
    if (!p) throw new Error('kein Ausschnitt');
    const url = new URL(hips2fitsUrl(p));
    expect(url.origin + url.pathname).toBe(
      'https://alasky.cds.unistra.fr/hips-image-services/hips2fits',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      hips: 'CDS/P/DSS2/color',
      width: '320',
      height: '218',
      fov: '2.875',
      projection: 'TAN',
      coordsys: 'icrs',
      ra: '10.6847',
      dec: '41.269',
      rotation_angle: '-35',
      format: 'jpg',
    });
    expect(thumbnailSize({ ...p, fovWidthDeg: 1, fovHeightDeg: 2 })).toEqual({
      width: 160,
      height: 320,
    });
    expect(new URL(hips2fitsUrl({ ...p, rotationDeg: 0 })).searchParams.get('rotation_angle')).toBe(
      '0',
    );
  });
});
