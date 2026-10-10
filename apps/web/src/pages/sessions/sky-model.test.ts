/** AP-69 (S-65): reines Modell der Auswertung „Himmel“ – Färbung, Kartenmitte, Ansicht, Treffer, Zeitachse, Mond. */
import { sky } from '@nina-pm/engine';
import { describe, expect, it } from 'vitest';
import {
  clampView,
  defaultCenterRa,
  dragView,
  filterMix,
  fromScreen,
  hitShape,
  hoursStep,
  moonMarks,
  nightKeys,
  projectOrder,
  projectShape,
  stackRows,
  toScreen,
  toScreenShapes,
  zoomAt,
  type MapView,
} from './sky-model';
import type { SkyProject, SkyReport } from '../../api/client';

const f = (filterType: SkyProject['byFilter'][number]['filterType'], integrationS = 3600) => ({
  filter: 'x',
  filterType,
  integrationS,
});

const project = (id: string, raDeg: number, decDeg: number, hours = 1): SkyProject => ({
  id,
  name: id,
  createdBy: id,
  projectType: 'deep_sky',
  status: 'active',
  rigId: null,
  raDeg,
  decDeg,
  rotationDeg: 0,
  fov: { widthDeg: 3, heightDeg: 2 },
  panels: [{ raDeg, decDeg, rotationDeg: 0 }],
  periodIntegrationS: hours * 3600,
  totalIntegrationS: hours * 3600,
  plannedS: 0,
  percentDone: 0,
  byFilter: [],
});

const VIEW: MapView = { width: 1000, height: 520, zoom: 1, panX: 0, panY: 0, centerRa: 0 };

describe('Färbung', () => {
  it('Stundenstufen mit festen Grenzen', () => {
    expect([0.5, 2, 4.9, 5, 12, 20, 80].map(hoursStep)).toEqual([1, 2, 2, 3, 4, 5, 5]);
  });
  it('Filtermix: eine Klasse oder gemischt, ohne Stunden null', () => {
    expect(filterMix([f('narrowband'), f('narrowband')])).toBe('narrowband');
    expect(filterMix([f('luminance'), f('broadband')])).toBe('broadband');
    expect(filterMix([f('uv_ir_cut')])).toBe('osc');
    expect(filterMix([f(null)])).toBe('osc');
    expect(filterMix([f('narrowband'), f('luminance')])).toBe('mixed');
    expect(filterMix([f('narrowband', 0)])).toBeNull();
    expect(filterMix([])).toBeNull();
  });
});

describe('Kartenmitte', () => {
  it('Naht möglichst weit von den Projekten', () => {
    expect(defaultCenterRa([])).toBe(0);
    // Projekte um 0h: Naht bei 12h, also Mitte 0h.
    expect(defaultCenterRa([{ raDeg: 350 }, { raDeg: 10 }])).toBe(0);
    // Projekte um 12h: Mitte 12h (Naht bei 0h).
    expect(defaultCenterRa([{ raDeg: 170 }, { raDeg: 190 }])).toBe(180);
  });
});

describe('Ansicht', () => {
  it('toScreen und fromScreen sind invers; Zoom hält den Punkt unter dem Zeiger', () => {
    const p = { x: 0.7, y: -0.4 };
    const s = toScreen(VIEW, p);
    const back = fromScreen(VIEW, s.x, s.y);
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
    const z = zoomAt(VIEW, 3, s.x, s.y);
    expect(z.zoom).toBe(3);
    const after = toScreen(z, p);
    expect(after.x).toBeCloseTo(s.x, 6);
    expect(after.y).toBeCloseTo(s.y, 6);
  });
  it('Zoom zwischen 1 und 40, Verschieben begrenzt, Ziehen dreht in der Gesamtansicht', () => {
    expect(zoomAt(VIEW, 0.1, 500, 260).zoom).toBe(1);
    expect(zoomAt(VIEW, 1000, 500, 260).zoom).toBe(40);
    expect(clampView({ ...VIEW, panX: 5000 }).panX).toBeCloseTo(0, 6);
    expect(clampView({ ...VIEW, zoom: 4, panX: 5000 }).panX).toBeLessThan(5000);
    const turned = dragView(VIEW, 50, 0);
    expect(turned.centerRa).toBeGreaterThan(0);
    expect(turned.panX).toBe(0);
    const zoomed = dragView({ ...VIEW, zoom: 4 }, 50, -20);
    expect([zoomed.panX, zoomed.panY, zoomed.centerRa]).toEqual([50, -20, 0]);
  });
});

describe('Treffer', () => {
  it('kleines Feld über großem gewinnt; zu kleine Felder als Punkt anklickbar', () => {
    const big = { ...project('big', 30, 20), fov: { widthDeg: 20, heightDeg: 20 } };
    const small = { ...project('small', 30, 20), fov: { widthDeg: 4, heightDeg: 4 } };
    const tiny = { ...project('tiny', 120, -10), fov: { widthDeg: 0.2, heightDeg: 0.2 } };
    const none = { ...project('none', 200, 40), fov: null };
    const shapes = toScreenShapes(
      VIEW,
      [big, small, tiny, none].map((p) => projectShape(p, 0)),
    );
    const at = (p: SkyProject) => toScreen(VIEW, sky.hammerProject(p.raDeg, p.decDeg, 0));
    expect(hitShape(shapes, at(small).x, at(small).y)).toBe('small');
    expect(shapes.find((s) => s.id === 'tiny')?.marker).toBe(true);
    expect(hitShape(shapes, at(tiny).x + 3, at(tiny).y)).toBe('tiny');
    expect(hitShape(shapes, at(none).x, at(none).y)).toBe('none');
    expect(hitShape(shapes, 2, 2)).toBeNull();
  });
});

describe('Zeitachse', () => {
  it('Nächte des Zeitraums, Zeilen je Rig mit Stapel nach Farbreihenfolge', () => {
    expect(nightKeys('2026-09-29', '2026-10-02')).toEqual([
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ]);
    const a = project('a', 0, 0, 10);
    const b = project('b', 0, 0, 2);
    const order = projectOrder([b, a]);
    expect([...order.keys()]).toEqual(['a', 'b']);
    const report = {
      from: '2026-10-01',
      to: '2026-10-02',
      generatedAt: '2026-10-02T12:00:00Z',
      rigs: [
        { id: 'r2', name: 'Zweites' },
        { id: 'r1', name: 'Erstes' },
      ],
      projects: [a, b],
      nights: [
        {
          rigId: 'r1',
          night: '2026-10-01',
          projects: [
            { projectId: 'b', integrationS: 3600 },
            { projectId: 'a', integrationS: 7200 },
          ],
        },
      ],
      moon: [],
    } as SkyReport;
    const rows = stackRows(report, order);
    expect(rows.map((r) => r.name)).toEqual(['Erstes', 'Zweites']);
    expect(rows[0]?.nights.get('2026-10-01')?.map((p) => p.projectId)).toEqual(['a', 'b']);
    expect(rows[0]?.maxHours).toBe(3);
    expect(rows[1]?.nights.size).toBe(0);
  });
  it('Neu- und Vollmond als Extremwerte der Umgebung', () => {
    const moon = [40, 20, 6, 1, 4, 18, 60, 96, 99.5, 97, 80].map((illumPct, i) => ({
      night: `2026-10-${String(i + 1).padStart(2, '0')}`,
      illumPct,
    }));
    expect([...moonMarks(moon).entries()]).toEqual([
      ['2026-10-04', 'new'],
      ['2026-10-09', 'full'],
    ]);
  });
});
