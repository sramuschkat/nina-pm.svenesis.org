/**
 * AP-21 Sternkarte (S-20): URL-Modell, Sterndaten (sky.json, stars-8.bin, Milchstraße), Standortzeit über
 * Temporal inkl. Zeitumstellung (rules/ui.md NT-04), Projekt-Kategorien, Bildfeld-Polygon und Treffer,
 * und ein Zeichenlauf aller Ebenen gegen einen aufzeichnenden 2D-Kontext. Seit 28.09.2026 (Vorlage
 * `sky-map.js`): Rundblick als Start, verankerte Blickrichtung, Sternbildnamen, Milchstraßen-Raster,
 * Treffer für Überfahren und Anklicken, Sternbild eines Orts, Himmelsrichtungen.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { apparentAltitudeDeg, sky } from '@nina-pm/engine';
import { describe, expect, it } from 'vitest';
import { effectiveRotation, projectCategory } from '../SkyMapPage';
import { constellationAt } from './constellation';
import { cellTransform } from './hips';
import { hillAlt, LANDSCAPE_MAX_DEG, landscapeAlt, TREES } from './landscape';
import {
  DEFAULT_OVERLAYS,
  DEFAULT_STATE,
  OVERVIEW_ALT,
  OVERVIEW_FOV,
  angleDiffDeg,
  fovForFrame,
  newProjectCoords,
  paramsFromState,
  roundAngle,
  skyMapHref,
  stateFromParams,
} from './model';
import {
  behindLand,
  colorParts,
  heatColor,
  constellationName,
  dayStarLimit,
  daylight,
  drawSky,
  formatDecLabel,
  formatRaLabel,
  framePanels,
  geometricForApparent,
  framePolygon,
  hitBody,
  hitConstellation,
  hitFrame,
  hitMarker,
  hitStar,
  horizonVec,
  meridianPoints,
  OVERLAYS,
  toAltAz,
  twilightClass,
  type HitIndex,
  type RenderInput,
} from './render';
import { atNightClock, fromZoned, nightKeyAt, sceneAt, zonedParts } from './scene';
import { decodeFaintStars, decodeMilkyWay, milkyWayAt, moveStar, parseSky } from './sky-data';

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
    // So liefert der Build die Tokens (Minifier): vorher deckendes Grau für Heatmap, Schimmer, Milchstraße.
    expect(colorParts('#ffbe6e1f')).toEqual([255, 190, 110, 0.122]);
    expect(colorParts('#788cb433')).toEqual([120, 140, 180, 0.2]);
    expect(colorParts('var(--fehlt)')).toEqual([136, 136, 136, 1]);
  });

  it('Heatmap als Verlauf: an der Schwelle hell und zart, zum Horizont dunkler und kräftiger (02.10.2026)', () => {
    const top = [255, 190, 110, 0.12] as const;
    const bottom = [196, 52, 44, 0.5] as const;
    expect(heatColor(top, bottom, 30, 30)).toEqual([255, 190, 110, 0.12]);
    expect(heatColor(top, bottom, 0, 30)).toEqual([196, 52, 44, 0.5]);
    const mid = heatColor(top, bottom, 15, 30);
    expect(mid.slice(0, 3)).toEqual([226, 121, 77]);
    expect(mid[3]).toBeCloseTo(0.31, 9);
    // Unter dem Horizont bleibt es bei der dunkelsten Stufe; ohne Schwelle ebenso.
    expect(heatColor(top, bottom, -5, 30)).toEqual([196, 52, 44, 0.5]);
    expect(heatColor(top, bottom, 10, 0)).toEqual([196, 52, 44, 0.5]);
  });
});

describe('Himmelsfotos ohne Clip (Safari, 02.10.2026)', () => {
  const at = (m: readonly number[], u: number, v: number) => [
    (m[0] as number) * u + (m[2] as number) * v + (m[4] as number),
    (m[1] as number) * u + (m[3] as number) * v + (m[5] as number),
  ];

  it('Parallelogramm: Zellabbildung trifft alle vier Ecken exakt', () => {
    // u → x mit Faktor 2, v → y mit Faktor 3, verschoben; p11 liegt genau auf der Abbildung.
    const p = (u: number, v: number) => ({ u, v, x: 10 + 2 * u, y: 20 + 3 * v });
    const t = cellTransform(p(0, 0), p(64, 0), p(0, 64), p(64, 64));
    expect(t).not.toBeNull();
    for (const [u, v] of [
      [0, 0],
      [64, 0],
      [0, 64],
      [64, 64],
    ] as const) {
      const [x, y] = at(t?.m ?? [], u, v);
      expect(x).toBeCloseTo(10 + 2 * u, 9);
      expect(y).toBeCloseTo(20 + 3 * v, 9);
    }
    // Rand ≈ 1,2 Bildschirmpixel: Maßstab √(2·3) Pixel je Bildpunkt.
    expect(t?.marginTexel).toBeCloseTo(1.2 / Math.sqrt(6), 9);
  });

  it('verzerrte Zelle: Fehler an jeder Ecke höchstens die halbe Abweichung der vierten Ecke', () => {
    const p = (u: number, v: number, dx = 0) => ({ u, v, x: u + dx, y: v });
    // p11 liegt 4 px neben dem Parallelogramm aus den drei anderen Ecken.
    const corners = [p(0, 0), p(64, 0), p(0, 64), p(64, 64, 4)] as const;
    const t = cellTransform(...corners);
    for (const c of corners) {
      const [x, y] = at(t?.m ?? [], c.u, c.v);
      expect(Math.hypot((x as number) - c.x, (y as number) - c.y)).toBeLessThanOrEqual(2 + 1e-9);
    }
  });

  it('entartete Zelle (alle Bildpunkte auf einer Linie) wird übersprungen', () => {
    const p = (u: number) => ({ u, v: 0, x: u, y: 0 });
    expect(cellTransform(p(0), p(1), p(2), p(3))).toBeNull();
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

describe('Eigenbewegung der Sterne (Astronomie-Prüfung 28.09.2026)', () => {
  it('Epoche 2000 unverändert, 36 Jahre bewegen um μ·36', () => {
    expect(moveStar(10, 20, 500, -300, 2000)).toEqual([10, 20]);
    const [ra, dec] = moveStar(0, 0, 1000, -1000, 2036);
    expect(ra).toBeCloseTo(0.01, 9);
    expect(dec).toBeCloseTo(-0.01, 9);
  });

  it('sky.json trägt die Eigenbewegung: Arktur (μ ≈ 2,3″/Jahr) liegt 2026 gut 1′ neben 2000', () => {
    const at2000 = parseSky(skyJson(), 2000);
    const at2026 = parseSky(skyJson(), 2026);
    const i = [...(at2000.stars.names ?? [])].find(([, n]) => n.en === 'Arcturus')?.[0];
    if (i === undefined) throw new Error('Arktur fehlt');
    const v0: [number, number, number] = [
      at2000.stars.vec[i * 3] ?? 0,
      at2000.stars.vec[i * 3 + 1] ?? 0,
      at2000.stars.vec[i * 3 + 2] ?? 0,
    ];
    const v1: [number, number, number] = [
      at2026.stars.vec[i * 3] ?? 0,
      at2026.stars.vec[i * 3 + 1] ?? 0,
      at2026.stars.vec[i * 3 + 2] ?? 0,
    ];
    const sepArcmin = (Math.acos(Math.min(1, sky.dot(v0, v1))) * 180 * 60) / Math.PI;
    expect(sepArcmin).toBeGreaterThan(0.9);
    expect(sepArcmin).toBeLessThan(1.1);
  });
});

describe('Karte: Meridian, Mindesthöhe, Nacht, Gitter (Astronomie-Prüfung 28.09.2026)', () => {
  const scene = sceneAt(
    Date.UTC(2026, 8, 28, 3) / 1000,
    { latitudeDeg: 31.5, longitudeDeg: -98.5, timeZone: 'America/Chicago' },
    { raDeg: 0, decDeg: 0 },
    30,
    30,
  );

  it('Meridian: jeder Punkt liegt im Azimut 0° oder 180° (vorher die Ost-West-Linie bei 90°)', () => {
    for (const v of meridianPoints(scene.observer.toHorizon)) {
      const h = toAltAz(scene.observer.toHorizon, v);
      if (Math.abs(h.altDeg) > 89.9) continue; // Zenit/Nadir: Azimut unbestimmt
      const az = Math.round(h.azDeg * 1e6) / 1e6;
      expect([0, 180, 360]).toContain(az);
    }
  });

  it('Mindesthöhe: geometrische Linie + Refraktion = scheinbare Grenze der Planung', () => {
    for (const alt of [0, 10, 20, 30, 60]) {
      const h = geometricForApparent(alt);
      expect(apparentAltitudeDeg(h)).toBeCloseTo(alt, 6);
    }
    // Bei 20° liegt die Linie 2,7′ tiefer als die geometrische 20°-Linie.
    expect(20 - geometricForApparent(20)).toBeCloseTo(0.0458, 3);
  });

  it('Nacht-Schlüssel über die Ortszeit, auch an Umstellungstagen', () => {
    // Berlin 29.03.2026 12:30 MESZ (10:30Z) → Nacht 29.03. (vorher 28.03.)
    expect(nightKeyAt(Date.UTC(2026, 2, 29, 10, 30) / 1000, 'Europe/Berlin')).toBe('2026-03-29');
    // Berlin 25.10.2026 11:30 MEZ (10:30Z) → noch Nacht 24.10. (vorher 25.10.)
    expect(nightKeyAt(Date.UTC(2026, 9, 25, 10, 30) / 1000, 'Europe/Berlin')).toBe('2026-10-24');
    expect(nightKeyAt(Date.UTC(2026, 8, 28, 3) / 1000, 'America/Chicago')).toBe('2026-09-27');
  });

  it('Gitterbeschriftung: ganze Sekunden mit Übertrag, Bogenminuten bei feinem Dec-Raster', () => {
    expect(formatRaLabel(0.375, 0.375)).toBe('0h01m30s'); // Linien alle 1m30s
    expect(formatRaLabel(0.75, 0.375)).toBe('0h03m00s'); // gleiche Form in einem Raster
    expect(formatRaLabel(0.75, 0.25)).toBe('0h03m');
    expect(formatRaLabel(0.375, 0.125)).toBe('0h01m30s');
    expect(formatRaLabel(14.875, 0.125)).toBe('0h59m30s');
    expect(formatRaLabel(14.99999, 1.5)).toBe('1h');
    expect(formatRaLabel(30, 15)).toBe('2h');
    expect(formatDecLabel(45 + 10 / 60, 1 / 6)).toBe('+45°10′');
    expect(formatDecLabel(-0.5, 0.25)).toBe('−0°30′');
    expect(formatDecLabel(60, 10)).toBe('+60°');
  });
});

describe('Sternkarte: Winkel, Uhrzeit in der Nacht, Ziel für Neues Projekt (28.09.2026)', () => {
  it('roundAngle legt gerundete Winkel in [0, 360); paramsFromState schreibt nie 360', () => {
    expect(roundAngle(359.9999997, 6)).toBe(0);
    expect(roundAngle(-0.5, 2)).toBe(359.5);
    expect(roundAngle(720.25, 2)).toBe(0.25);
    const p = paramsFromState({ ...DEFAULT_STATE, ra: 359.999997, fra: 359.999997, rot: 359.999 });
    expect(p.get('ra')).toBe('0');
    expect(p.get('fra')).toBe('0');
    expect(p.get('rot')).toBe('0');
    expect(stateFromParams(p).fra).toBe(0);
  });

  it('angleDiffDeg rechnet über 0°/360° hinweg', () => {
    expect(angleDiffDeg(359.98, 0)).toBeCloseTo(0.02, 9);
    expect(angleDiffDeg(10, 350)).toBeCloseTo(20, 9);
    expect(angleDiffDeg(90, 270)).toBe(180);
  });

  it('atNightClock: vor 12:00 der Morgen nach dem Abend der Nacht (NT-01)', () => {
    const zone = 'America/Chicago';
    expect(atNightClock('2026-09-17', '01:30', zone)).toBe(fromZoned('2026-09-18', '01:30', zone));
    expect(atNightClock('2026-09-17', '23:00', zone)).toBe(fromZoned('2026-09-17', '23:00', zone));
    expect(nightKeyAt(atNightClock('2026-09-17', '11:59', zone) as number, zone)).toBe(
      '2026-09-17',
    );
    expect(nightKeyAt(atNightClock('2026-09-17', '12:00', zone) as number, zone)).toBe(
      '2026-09-17',
    );
    expect(atNightClock('2026-09-17', '', zone)).toBeNull();
  });

  it('newProjectCoords: Objekt außerhalb des Bildfelds → Koordinaten des Objekts, sonst Bildfeldmitte', () => {
    const size = { fovWidthDeg: 2.8, fovHeightDeg: 1.9, cols: 1, rows: 1, overlapPct: 20 };
    const m42 = { raDeg: 83.82, decDeg: -5.39 };
    // Bildfeld irgendwo anders: der Editor bekäme sonst die fremde Mitte samt Katalogobjekt.
    expect(newProjectCoords({ raDeg: 10, decDeg: 40 }, m42, size)).toEqual(m42);
    // Bewusst leicht versetzt ausgerichtet: Bildfeldmitte bleibt.
    expect(newProjectCoords({ raDeg: 83.5, decDeg: -5.2 }, m42, size)).toEqual({
      raDeg: 83.5,
      decDeg: -5.2,
    });
    // Mosaik 3×1 vergrößert die Toleranz nur bis zur halben kürzeren Kante.
    expect(newProjectCoords({ raDeg: 83.82, decDeg: -4.2 }, m42, { ...size, cols: 3 })).toEqual(
      m42,
    );
    expect(newProjectCoords({ raDeg: 1, decDeg: 2 }, null, size)).toEqual({ raDeg: 1, decDeg: 2 });
    // Ohne Rig kein Bildfeld: immer das Objekt.
    expect(newProjectCoords({ raDeg: 83.83, decDeg: -5.39 }, m42, null)).toEqual(m42);
  });
});

describe('Taghimmel (Wunsch Sven 30.09.2026)', () => {
  it('Tageslicht: Nacht ab −12°, voller Tag ab +4°, dazwischen stetig steigend', () => {
    expect(daylight(-18)).toBe(0);
    expect(daylight(-12)).toBe(0);
    expect(daylight(4)).toBe(1);
    expect(daylight(30)).toBe(1);
    expect(daylight(-4)).toBeCloseTo(0.5, 6);
    expect(daylight(-6)).toBeLessThan(daylight(-2));
  });

  it('Sterngrenze: nachts unverändert, am Tag nur die hellsten (≤ 1 mag)', () => {
    expect(dayStarLimit(6, 0)).toBe(6);
    expect(dayStarLimit(6, 1)).toBe(1);
    expect(dayStarLimit(6, 0.5)).toBe(3.5);
  });

  it('Taghimmel ist standardmäßig an', () => {
    expect(DEFAULT_OVERLAYS).toContain('daySky');
  });
});
