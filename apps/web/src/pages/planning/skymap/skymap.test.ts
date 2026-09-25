/**
 * AP-21 Sternkarte (S-20): URL-Modell, Sterndaten (sky.json, stars-8.bin, Milchstraße), Standortzeit über
 * Temporal inkl. Zeitumstellung (rules/ui.md NT-04), Projekt-Kategorien, Bildfeld-Polygon und Treffer,
 * und ein Zeichenlauf aller Ebenen gegen einen aufzeichnenden 2D-Kontext.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sky } from '@nina-pm/engine';
import { describe, expect, it } from 'vitest';
import { effectiveRotation, projectCategory } from '../SkyMapPage';
import { DEFAULT_STATE, fovForFrame, paramsFromState, skyMapHref, stateFromParams } from './model';
import {
  drawSky,
  framePanels,
  framePolygon,
  hitFrame,
  hitMarker,
  OVERLAYS,
  type RenderInput,
} from './render';
import { fromZoned, nightKeyAt, sceneAt, zonedParts } from './scene';
import { decodeFaintStars, decodeMilkyWay, parseSky } from './sky-data';

describe('URL-Modell', () => {
  it('Standard und Rundreise', () => {
    const s = stateFromParams(new URLSearchParams(''));
    expect(s).toMatchObject({ fov: 8, orient: 'north', survey: 'dss2color', cols: 1, rows: 1 });
    const t = {
      ...s,
      ra: 10.68,
      dec: 41.27,
      fra: 10.7,
      fdec: 41.3,
      rot: 35,
      cols: 2,
      rows: 3,
      overlap: 15,
      rig: 'r1',
      t: 1797368400,
      survey: 'panstarrs' as const,
      orient: 'horizon' as const,
      heat: 25,
    };
    const back = stateFromParams(paramsFromState(t));
    expect(back).toMatchObject({
      ra: 10.68,
      dec: 41.27,
      fra: 10.7,
      fdec: 41.3,
      rot: 35,
      cols: 2,
      rows: 3,
      overlap: 15,
      rig: 'r1',
      t: 1797368400,
      survey: 'panstarrs',
      orient: 'horizon',
      heat: 25,
    });
  });

  it('ungültige Werte fallen auf den Standard zurück', () => {
    const s = stateFromParams(
      new URLSearchParams('fov=0&h=99&foto=xyz&dec=120&ebenen=eqGrid,bogus'),
    );
    expect(s.fov).toBe(DEFAULT_STATE.fov);
    expect(s.cols).toBe(1);
    expect(s.survey).toBe('dss2color');
    expect([...s.overlays]).toEqual(['eqGrid']);
    expect(stateFromParams(new URLSearchParams('foto=keins')).survey).toBe('none');
  });

  it('Link aus Objektbrowser und Editor', () => {
    const href = skyMapHref({ ra: 83.82, dec: -5.39, rig: 'r1', object: 'NGC 1976', fov: 5 });
    expect(href).toMatch(/^\/planung\/sternkarte\?/);
    const p = new URLSearchParams(href.split('?')[1]);
    expect(p.get('objekt')).toBe('NGC 1976');
    expect(stateFromParams(p)).toMatchObject({ fra: 83.82, fdec: -5.39, fov: 5, rig: 'r1' });
    expect(fovForFrame(2, 1)).toBe(5);
    expect(fovForFrame(2, 1, 3, 1)).toBe(15);
  });
});

describe('Sterndaten', () => {
  it('sky.json: Sterne, Linien, Sternbilder, Milchstraße', () => {
    const path = fileURLToPath(
      new URL('../../../../../../packages/catalog-data/sky/sky.json', import.meta.url),
    );
    const s = parseSky(JSON.parse(readFileSync(path, 'utf8')));
    expect(s.stars.count).toBeGreaterThan(5000);
    expect(s.stars.names?.get(0)).toEqual({ de: 'Sirius', en: 'Sirius' });
    expect(s.labels).toHaveLength(89); // Serpens zweimal (Caput, Cauda)
    expect(s.lines.length).toBeGreaterThan(88);
    expect(s.milkyWay.length).toBeGreaterThan(1000);
  });

  it('Milchstraße: Lauflängen auf 1° zusammengefasst', () => {
    const mw = decodeMilkyWay({ w: 4, h: 2, step: 45, rle: 'a1c1a2a4' });
    expect(mw).toHaveLength(1);
    expect(mw[0]?.level).toBe(2);
  });

  it('stars-8.bin: Kopf und Sätze', () => {
    const buf = new ArrayBuffer(12 + 2 * 12);
    const dv = new DataView(buf);
    [...'SVST'].forEach((ch, i) => dv.setUint8(i, ch.charCodeAt(0)));
    dv.setUint16(4, 2, true);
    dv.setUint16(6, 12, true);
    dv.setUint32(8, 2, true);
    dv.setUint16(12, 16384, true); // 90°
    dv.setInt16(14, 0, true);
    dv.setUint8(16, 130); // 6,5 mag
    dv.setUint16(24, 0, true);
    dv.setInt16(26, 32767, true); // Pol
    dv.setUint8(28, 160);
    const f = decodeFaintStars(buf);
    expect(f.count).toBe(2);
    expect(f.mag[0]).toBeCloseTo(6.5, 5);
    expect(f.vec[1]).toBeCloseTo(1, 6);
    expect(f.vec[5]).toBeCloseTo(1, 6);
    expect(() => decodeFaintStars(new ArrayBuffer(12))).toThrow(/Format/);
  });
});

describe('Standortzeit (Temporal)', () => {
  it('Chicago: Nacht 17./18.09.2026, 19:00 CDT = 00:00 UTC', () => {
    const t = Date.UTC(2026, 8, 18, 0, 0) / 1000;
    expect(zonedParts(t, 'America/Chicago')).toEqual({ date: '2026-09-17', time: '19:00' });
    expect(fromZoned('2026-09-17', '19:00', 'America/Chicago')).toBe(t);
    expect(nightKeyAt(t, 'America/Chicago')).toBe('2026-09-17');
    // 09:00 CDT gehört noch zur Nacht davor (Mittag bis Mittag).
    expect(nightKeyAt(Date.UTC(2026, 8, 18, 14) / 1000, 'America/Chicago')).toBe('2026-09-17');
  });

  it('Zeitumstellung 01.11.2026: 01:30 kommt zweimal vor – die frühere gilt', () => {
    const t = fromZoned('2026-11-01', '01:30', 'America/Chicago');
    expect(t).toBe(Date.UTC(2026, 10, 1, 6, 30) / 1000);
    expect(fromZoned('2026-11-01', 'kaputt', 'America/Chicago')).toBeNull();
  });

  it('Szene: Mond und Planeten, Horizont-Matrix', () => {
    const s = sceneAt(
      Date.UTC(2026, 11, 15, 21) / 1000,
      { latitudeDeg: 48, longitudeDeg: 11, timeZone: 'Europe/Berlin' },
      { raDeg: 83.82, decDeg: -5.39 },
      30,
      30,
    );
    expect(s.bodies.planets).toHaveLength(7);
    expect(s.sunAltDeg).toBeLessThan(-18);
    const alt = sky.altAzOf(sky.matVec(s.observer.toHorizon, sky.radecToVec(83.82, -5.39))).altDeg;
    expect(alt).toBeGreaterThan(20);
    expect(alt).toBeLessThan(40);
  });
});

describe('Projekte und Rotation', () => {
  it('Kategorien der Projekt-Overlays', () => {
    expect(projectCategory({ approvalStatus: 'submitted', status: null })).toBe('submitted');
    expect(projectCategory({ approvalStatus: 'approved', status: 'active' })).toBe('active');
    expect(projectCategory({ approvalStatus: 'approved', status: 'on_hold' })).toBe('unfinished');
    expect(projectCategory({ approvalStatus: 'approved', status: 'ready_to_process' })).toBe(
      'completed',
    );
    expect(projectCategory({ approvalStatus: 'draft', status: null })).toBe('planning');
  });

  it('Rotation: Projektwinkel, sonst Rig-Standard', () => {
    expect(effectiveRotation({ hasRotator: false, defaultRotationDeg: 12 }, null)).toBe(12);
    expect(effectiveRotation({ hasRotator: true, defaultRotationDeg: 12 }, 40)).toBe(40);
    expect(effectiveRotation(null, null)).toBe(0);
  });
});

describe('Bildfeld und Treffer', () => {
  const view = sky.makeView(sky.radecToVec(83.82, -5.39), [0, 0, 1], 5, 800, 600);
  const frame = {
    raDeg: 83.82,
    decDeg: -5.39,
    paDeg: 0,
    fovWidthDeg: 2,
    fovHeightDeg: 1,
    cols: 1,
    rows: 1,
    overlapPct: 20,
  };

  it('Polygon: vier Kanten mit Zwischenpunkten, geschlossen', () => {
    const poly = framePolygon(83.82, -5.39, 0, 2, 1, 4);
    expect(poly).toHaveLength(17);
    expect(poly[0]).toEqual(poly[16]);
  });

  it('Mosaik über die Engine: NINA-Nummern 1…n', () => {
    expect(
      framePanels({ ...frame, cols: 2, rows: 2 })
        .map((p) => p.n)
        .sort(),
    ).toEqual([1, 2, 3, 4]);
  });

  it('Treffer im Bildfeld und bei Markern', () => {
    expect(hitFrame(view, frame, 400, 300)).toBe(true);
    expect(hitFrame(view, frame, 20, 20)).toBe(false);
    const m = [{ raDeg: 83.82, decDeg: -5.39, id: 'a' }];
    expect(hitMarker(view, m, 402, 301)?.id).toBe('a');
    expect(hitMarker(view, m, 450, 350)).toBeNull();
  });

  it('zeichnet alle Ebenen ohne Fehler', () => {
    const calls: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_, prop) =>
          typeof prop === 'string' &&
          /^(fill|stroke|arc|ellipse|moveTo|lineTo|beginPath|fillRect|fillText|save|restore|setLineDash|closePath|clip|transform|drawImage)/.test(
            prop,
          )
            ? (...args: unknown[]) => {
                calls.push(prop);
                void args;
              }
            : undefined,
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D;
    const path = fileURLToPath(
      new URL('../../../../../../packages/catalog-data/sky/sky.json', import.meta.url),
    );
    const bright = parseSky(JSON.parse(readFileSync(path, 'utf8')));
    const scene = sceneAt(
      Date.UTC(2026, 11, 15, 21) / 1000,
      { latitudeDeg: 48, longitudeDeg: 11, timeZone: 'Europe/Berlin' },
      frame,
      30,
      30,
    );
    const input: RenderInput = {
      view: sky.makeView(sky.radecToVec(83.82, -5.39), [0, 0, 1], 60, 800, 600),
      overlays: new Set(OVERLAYS),
      projectOverlays: new Set(['active']),
      photosShown: false,
      bright,
      faint: null,
      dso: [
        {
          id: 'm42',
          primaryId: 'NGC 1976',
          displayName: 'M 42',
          group: 'emission_nebula',
          raDeg: 83.82,
          decDeg: -5.39,
          mag: 4,
          sizeMajorArcmin: 85,
          sizeMinorArcmin: 60,
          positionAngleDeg: 0,
        },
      ],
      observer: scene.observer,
      bodies: scene.bodies,
      projects: [{ id: 'p', name: 'Orion', category: 'active', frame }],
      frame: { ...frame, cols: 2, rows: 2 },
      compare: frame,
      selectedId: 'm42',
      frameColor: 'frame',
      lang: 'de',
      planetNames: {},
      moonLabel: 'Mond',
      sunLabel: 'Sonne',
      zenithLabel: 'Zenit',
    };
    let photos = 0;
    drawSky(ctx, input, {}, () => (photos += 1));
    expect(photos).toBe(1);
    expect(calls.filter((c) => c === 'ellipse')).not.toHaveLength(0);
    expect(calls.filter((c) => c === 'stroke').length).toBeGreaterThan(50);
    expect(calls).toContain('fillText');
  });
});
