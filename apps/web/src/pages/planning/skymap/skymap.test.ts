/**
 * AP-21 Sternkarte (S-20): URL-Modell, Sterndaten (sky.json, stars-8.bin, Milchstraße), Standortzeit über
 * Temporal inkl. Zeitumstellung (rules/ui.md NT-04), Projekt-Kategorien, Bildfeld-Polygon und Treffer,
 * und ein Zeichenlauf aller Ebenen gegen einen aufzeichnenden 2D-Kontext. Seit 28.09.2026 (Vorlage
 * `sky-map.js`): Rundblick als Start, verankerte Blickrichtung, Sternbildnamen, Milchstraßen-Raster,
 * Treffer für Überfahren und Anklicken, Sternbild eines Orts, Himmelsrichtungen.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sky } from '@nina-pm/engine';
import { describe, expect, it } from 'vitest';
import { effectiveRotation, projectCategory } from '../SkyMapPage';
import { constellationAt } from './constellation';
import { hillAlt, LANDSCAPE_MAX_DEG, landscapeAlt, TREES } from './landscape';
import {
  DEFAULT_STATE,
  OVERVIEW_ALT,
  OVERVIEW_FOV,
  fovForFrame,
  paramsFromState,
  skyMapHref,
  stateFromParams,
} from './model';
import {
  behindLand,
  colorParts,
  constellationName,
  drawSky,
  framePanels,
  framePolygon,
  hitBody,
  hitConstellation,
  hitFrame,
  hitMarker,
  hitStar,
  horizonVec,
  OVERLAYS,
  toAltAz,
  twilightClass,
  type HitIndex,
  type RenderInput,
} from './render';
import { fromZoned, nightKeyAt, sceneAt, zonedParts } from './scene';
import { decodeFaintStars, decodeMilkyWay, milkyWayAt, parseSky } from './sky-data';

const skyJson = () =>
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL('../../../../../../packages/catalog-data/sky/sky.json', import.meta.url),
      ),
      'utf8',
    ),
  );

describe('URL-Modell', () => {
  it('leere Adresse: Rundblick wie in der Vorlage (Horizont unten, 150°, Blickmitte 40° hoch)', () => {
    const s = stateFromParams(new URLSearchParams('rig=r1'));
    expect(s).toMatchObject({
      fov: OVERVIEW_FOV,
      orient: 'horizon',
      vaz: null,
      valt: OVERVIEW_ALT,
      names: 'local',
      rig: 'r1',
    });
    // Nach der ersten Änderung steht die Ausrichtung in der Adresse, der Rundblick bleibt.
    const back = stateFromParams(paramsFromState({ ...s, t: 1797368400 }));
    expect(back).toMatchObject({ orient: 'horizon', fov: OVERVIEW_FOV, vaz: null, valt: 40 });
  });

  it('verankerte Blickrichtung und lateinische Namen in der Adresse', () => {
    const s = stateFromParams(
      new URLSearchParams('ra=10&dec=20&ausrichtung=horizont&az=135&hoehe=25&namen=latein'),
    );
    expect(s).toMatchObject({ orient: 'horizon', vaz: 135, valt: 25, names: 'latin' });
    const p = paramsFromState(s);
    expect(p.get('az')).toBe('135');
    expect(p.get('hoehe')).toBe('25');
    expect(p.get('namen')).toBe('latein');
    // „Norden oben“ trägt keine Blickrichtung am Horizont.
    const n = stateFromParams(new URLSearchParams('ra=10&dec=20&az=135&hoehe=25'));
    expect(n).toMatchObject({ orient: 'north', vaz: null, valt: null });
  });

  it('Standard und Rundreise', () => {
    const s = stateFromParams(new URLSearchParams('ra=83.82&dec=-5.39'));
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
    expect(stateFromParams(p)).toMatchObject({
      fra: 83.82,
      fdec: -5.39,
      fov: 5,
      rig: 'r1',
      orient: 'north',
    });
    expect(fovForFrame(2, 1)).toBe(5);
    expect(fovForFrame(2, 1, 3, 1)).toBe(15);
  });
});

describe('Sterndaten', () => {
  it('sky.json: Sterne, Linien, Sternbilder, Milchstraße', () => {
    const s = parseSky(skyJson());
    expect(s.stars.count).toBeGreaterThan(5000);
    expect(s.stars.names?.get(0)).toEqual({ de: 'Sirius', en: 'Sirius' });
    expect(s.stars.bayer?.get(0)).toBe('α');
    expect(s.labels).toHaveLength(89); // Serpens zweimal (Caput, Cauda)
    expect(s.lines.length).toBe(88); // Serpens als ein Sternbild
    expect(s.lines.find((l) => l.abbr === 'UMa')?.parts.length).toBeGreaterThan(3);
    expect(s.bounds.find((b) => b.abbr === 'Ori')?.corners.length).toBeGreaterThan(20);
    expect(s.milkyWay.cells).toHaveLength(720 * 360);
    expect(s.milkyWay.cells.filter((c) => c > 0).length).toBeGreaterThan(20000);
    // Galaktisches Zentrum (Sgr A*, 266,4° −29,0°) hell, galaktischer Nordpol (192,9° +27,1°) dunkel.
    expect(milkyWayAt(s.milkyWay, 266.4, -29)).toBeGreaterThan(2);
    expect(milkyWayAt(s.milkyWay, 192.9, 27.1)).toBe(0);
  });

  it('Milchstraße: Lauflängen auf dem Raster, bilinear dazwischen', () => {
    const mw = decodeMilkyWay({ w: 4, h: 2, step: 45, rle: 'a1c1a2a4' });
    expect([...mw.cells]).toEqual([0, 2, 0, 0, 0, 0, 0, 0]);
    // Zellmitte (67,5°, 67,5°) = Stufe 2, halbe Zelle daneben die Hälfte.
    expect(milkyWayAt(mw, 67.5, 67.5)).toBeCloseTo(2, 9);
    expect(milkyWayAt(mw, 90, 67.5)).toBeCloseTo(1, 9);
  });

  it('Sternbild eines Orts (IAU-Grenzen über B1875, Vorlage)', () => {
    const s = parseSky(skyJson());
    expect(constellationAt(s.bounds, 88.79, 7.41)).toBe('Ori'); // Beteigeuze
    expect(constellationAt(s.bounds, 101.29, -16.72)).toBe('CMa'); // Sirius
    expect(constellationAt(s.bounds, 37.95, 89.26)).toBe('UMi'); // Polaris
    expect(constellationAt(s.bounds, 10.68, 41.27)).toBe('And'); // M 31
    expect(constellationAt(s.bounds, 266.42, -29.01)).toBe('Sgr'); // galaktisches Zentrum
    expect(constellationAt(s.bounds, 201.3, -11.16)).toBe('Vir'); // Spica
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
    const texts: string[] = [];
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
                if (prop === 'fillText') texts.push(String(args[0]));
              }
            : prop === 'measureText'
              ? (txt: string) => ({ width: txt.length * 6 })
              : undefined,
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D;
    const bright = parseSky(skyJson());
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
      selectedVec: sky.radecToVec(83.82, -5.39),
      hoverCon: 'Ori',
      names: 'latin',
      frameColor: 'frame',
      lang: 'de',
      planetNames: {},
      moonLabel: 'Mond',
      sunLabel: 'Sonne',
      zenithLabel: 'Zenit',
      compassLabels: ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'],
      milkyWayLabel: 'Milchstraße',
    };
    let photos = 0;
    const hits = drawSky(ctx, input, {}, () => (photos += 1));
    expect(photos).toBe(1);
    expect(calls.filter((c) => c === 'ellipse')).not.toHaveLength(0);
    expect(calls.filter((c) => c === 'stroke').length).toBeGreaterThan(50);
    expect(calls).toContain('fillText');
    // Trefferliste: Orion (Linien und Name), helle Sterne; Sternbildnamen lateinisch, Orion zuerst (hervorgehoben).
    expect(hits.verts.some((v) => v.abbr === 'Ori')).toBe(true);
    expect(hits.stars.length).toBeGreaterThan(20);
    expect(texts).toContain('Orion');
    expect(texts).toContain('M 42');
    // Blick nach Süden am 15.12. um 22 Uhr MEZ, 120° weit: SO, S, SW unter dem Horizont, Osten links.
    const southView = sky.makeView(
      horizonVec(scene.observer.toHorizon, 180, 20),
      sky.matVec(sky.transpose(scene.observer.toHorizon), [0, 0, 1]),
      120,
      800,
      600,
    );
    texts.length = 0;
    drawSky(ctx, { ...input, view: southView }, {}, () => undefined);
    expect(texts).toEqual(expect.arrayContaining(['S', 'SW', 'SO']));
    expect(texts).not.toContain('N');
  });
});

describe('Überfahren, Anklicken, Horizont (Vorlage sky-map.js)', () => {
  const hits: HitIndex = {
    verts: [
      { x: 100, y: 100, abbr: 'Ori' },
      { x: 300, y: 100, abbr: 'Tau' },
    ],
    stars: [
      { x: 205, y: 200, i: 1, mag: 5 },
      { x: 212, y: 200, i: 2, mag: 0.5 },
    ],
    bodies: [{ x: 400, y: 400, r: 6, id: 'moon' }],
  };

  it('nächstes Sternbild innerhalb von 24 px', () => {
    expect(hitConstellation(hits, 110, 110)).toBe('Ori');
    expect(hitConstellation(hits, 290, 95)).toBe('Tau');
    expect(hitConstellation(hits, 200, 300)).toBeNull();
  });

  it('Sterne: helle gewinnen (2 px je Größenklasse), höchstens 16 px', () => {
    expect(hitStar(hits, 205, 200)).toBe(2);
    expect(hitStar(hits, 205, 230)).toBeNull();
  });

  it('Himmelskörper: Scheibe plus 10 px', () => {
    expect(hitBody(hits, 414, 400)).toBe('moon');
    expect(hitBody(hits, 420, 400)).toBeNull();
  });

  it('Horizont: Azimut/Höhe hin und zurück, Dämmerungsstufen, Namen, Farben', () => {
    const scene = sceneAt(
      Date.UTC(2026, 8, 28, 3) / 1000,
      { latitudeDeg: 31.5, longitudeDeg: -98.5, timeZone: 'America/Chicago' },
      { raDeg: 0, decDeg: 0 },
      30,
      30,
    );
    const v = horizonVec(scene.observer.toHorizon, 225, 33);
    const h = toAltAz(scene.observer.toHorizon, v);
    expect(h.azDeg).toBeCloseTo(225, 9);
    expect(h.altDeg).toBeCloseTo(33, 9);
    expect([5, -3, -8, -15, -30].map(twilightClass)).toEqual([0, 1, 2, 3, 4]);
    const l = { de: 'Großer Bär', latin: 'Ursa Major', en: 'Great Bear' };
    expect(constellationName(l, 'local', 'de')).toBe('Großer Bär');
    expect(constellationName(l, 'local', 'en')).toBe('Great Bear');
    expect(constellationName(l, 'latin', 'de')).toBe('Ursa Major');
    expect(colorParts('rgba(205, 215, 255, 0.3)')).toEqual([205, 215, 255, 0.3]);
    expect(colorParts('#5ce1e6')).toEqual([92, 225, 230, 1]);
  });
});

describe('Landschaft am Horizont (28.09.2026)', () => {
  it('niedrig: Hügel 0,15–1,5°, mit Bäumen höchstens gut 3°; fest erzeugt', () => {
    const hills = Array.from({ length: 3600 }, (_, i) => hillAlt(i / 10));
    expect(Math.min(...hills)).toBeGreaterThanOrEqual(0.15);
    expect(Math.max(...hills)).toBeLessThan(1.6);
    expect(LANDSCAPE_MAX_DEG).toBeGreaterThan(1.5);
    expect(LANDSCAPE_MAX_DEG).toBeLessThan(3.6);
    expect(TREES.length).toBeGreaterThan(100);
    expect(TREES.some((t) => t.kind === 'conifer')).toBe(true);
    expect(TREES.some((t) => t.kind === 'broadleaf')).toBe(true);
    // Ein Baum ragt über die Hügellinie hinaus.
    const t = TREES[0];
    if (!t) throw new Error('keine Bäume');
    expect(landscapeAlt(t.azDeg)).toBeGreaterThan(hillAlt(t.azDeg) + 0.5);
    expect(landscapeAlt(t.azDeg + 360)).toBe(landscapeAlt(t.azDeg));
  });

  it('verdeckt: unter der Oberkante von Hügeln und Bäumen', () => {
    const scene = sceneAt(
      Date.UTC(2026, 8, 28, 3) / 1000,
      { latitudeDeg: 31.5, longitudeDeg: -98.5, timeZone: 'America/Chicago' },
      { raDeg: 0, decDeg: 0 },
      30,
      30,
    );
    const H = scene.observer.toHorizon;
    const az = 123.4;
    expect(behindLand(H, horizonVec(H, az, landscapeAlt(az) - 0.05))).toBe(true);
    expect(behindLand(H, horizonVec(H, az, landscapeAlt(az) + 0.05))).toBe(false);
    expect(behindLand(H, horizonVec(H, az, 10))).toBe(false);
  });
});
