/**
 * Auswertung „Himmel“ (AP-69, S-65; FA-AUS-26 … FA-AUS-29), rein: Färbung nach Stunden bzw. Filtermix, Kartenmitte
 * abseits der Projekte, Bildfelder als Ringe der Hammer-Projektion (Engine), Ansicht mit Zoom und Verschieben,
 * Trefferprüfung und das Modell der Zeitachse je Rig.
 */
import { daysFromKey, keyFromDays, offsetToSky, sky } from '@nina-pm/engine';
import type { SkyProject, SkyReport } from '../../api/client';

export type ColorMode = 'hours' | 'mix';
export type FilterMix = 'broadband' | 'narrowband' | 'osc' | 'mixed';
export const FILTER_MIXES: readonly FilterMix[] = ['broadband', 'narrowband', 'osc', 'mixed'];

/** Obergrenzen der Stundenstufen 1–4 (h); darüber Stufe 5. Feste Stufen statt relativer, damit Zeiträume vergleichbar bleiben. */
export const HOURS_BINS = [2, 5, 10, 20] as const;
export type HoursStep = 1 | 2 | 3 | 4 | 5;

export function hoursStep(hours: number): HoursStep {
  const i = HOURS_BINS.findIndex((b) => hours < b);
  return (i < 0 ? 5 : i + 1) as HoursStep;
}

/**
 * Filtermix aus der Integration je Filtertyp im Zeitraum: Breitband (L, RGB, photometrisch), Schmalband, Farbkamera
 * (UV/IR-Sperre, Lichtverschmutzung, sonstige bzw. ohne Filter) – genau eine Klasse, sonst „gemischt“; ohne Stunden `null`.
 */
export function filterMix(byFilter: SkyProject['byFilter']): FilterMix | null {
  const classes = new Set<Exclude<FilterMix, 'mixed'>>();
  for (const f of byFilter) {
    if (f.integrationS <= 0) continue;
    const t = f.filterType;
    classes.add(
      t === 'narrowband'
        ? 'narrowband'
        : t === 'broadband' || t === 'luminance' || t === 'photometric'
          ? 'broadband'
          : 'osc',
    );
  }
  if (classes.size === 0) return null;
  return classes.size === 1 ? ([...classes][0] as FilterMix) : 'mixed';
}

/**
 * Kartenmitte (RA, Grad, Vielfache von 15°) so, dass die Naht bei Mitte + 180° möglichst weit von allen Projekten liegt;
 * ohne Projekte 0h. Bei Gleichstand gewinnt die kleinere RA.
 */
export function defaultCenterRa(points: readonly { raDeg: number }[]): number {
  if (points.length === 0) return 0;
  let best = 0;
  let bestGap = -1;
  for (let c = 0; c < 360; c += 15) {
    const seam = (c + 180) % 360;
    const gap = Math.min(
      ...points.map((p) => {
        const d = Math.abs((((p.raDeg - seam) % 360) + 360) % 360);
        return Math.min(d, 360 - d);
      }),
    );
    if (gap > bestGap + 1e-9) {
      best = c;
      bestGap = gap;
    }
  }
  return best;
}

/** Umriss eines Bildfelds (Tangentialebene, geometry.md §2.1) mit Zwischenpunkten je Kante, Sensor-X = Ost bei pa = 0. */
export function fieldOutline(
  raDeg: number,
  decDeg: number,
  paDeg: number,
  wDeg: number,
  hDeg: number,
  perEdge = 4,
): sky.SkyPos[] {
  const cos = Math.cos((paDeg * Math.PI) / 180);
  const sin = Math.sin((paDeg * Math.PI) / 180);
  const corners: [number, number][] = [
    [wDeg / 2, hDeg / 2],
    [-wDeg / 2, hDeg / 2],
    [-wDeg / 2, -hDeg / 2],
    [wDeg / 2, -hDeg / 2],
  ];
  const out: sky.SkyPos[] = [];
  for (let c = 0; c < 4; c += 1) {
    const [x0, y0] = corners[c] as [number, number];
    const [x1, y1] = corners[(c + 1) % 4] as [number, number];
    for (let k = 0; k < perEdge; k += 1) {
      const f = k / perEdge;
      const xs = x0 + (x1 - x0) * f;
      const ys = y0 + (y1 - y0) * f;
      out.push(offsetToSky(raDeg, decDeg, xs * cos + ys * sin, -xs * sin + ys * cos));
    }
  }
  return out;
}

export interface ProjectShape {
  readonly id: string;
  /** Ringe in der Hammer-Ebene (je Panel, an der Naht geteilt); leer ohne Bildfeld. */
  readonly rings: readonly (readonly sky.AllSkyPoint[])[];
  /** Mitte des Projekts in der Ebene (Punkt für kleine Felder und ohne Bildfeld). */
  readonly center: sky.AllSkyPoint;
}

/** Was die Karte je Projekt braucht (Teil von `SkyProject`). */
export interface ShapeInput {
  readonly id: string;
  readonly raDeg: number;
  readonly decDeg: number;
  readonly rotationDeg: number;
  readonly fov: { readonly widthDeg: number; readonly heightDeg: number } | null;
  readonly panels: readonly { raDeg: number; decDeg: number; rotationDeg: number }[];
}

export function projectShape(p: ShapeInput, centerRaDeg: number): ProjectShape {
  const panels = p.panels.length > 0 ? p.panels : [p];
  const rings = p.fov
    ? panels.flatMap((panel) =>
        sky.splitPolygonAtSeam(
          fieldOutline(
            panel.raDeg,
            panel.decDeg,
            panel.rotationDeg,
            p.fov?.widthDeg ?? 0,
            p.fov?.heightDeg ?? 0,
          ),
          centerRaDeg,
        ),
      )
    : [];
  return { id: p.id, rings, center: sky.hammerProject(p.raDeg, p.decDeg, centerRaDeg) };
}

// ---- Ansicht: Zoom und Verschieben ------------------------------------------------------------------------------

export interface MapView {
  readonly width: number;
  readonly height: number;
  /** 1 = ganze Ellipse sichtbar. */
  readonly zoom: number;
  /** Verschiebung in Pixeln (nur mit Zoom > 1). */
  readonly panX: number;
  readonly panY: number;
  readonly centerRa: number;
}

export const ZOOM_MAX = 40;
const PAD = 12;

/** Pixel je Einheit der Hammer-Ebene bei Zoom 1. */
export const baseScale = (v: Pick<MapView, 'width' | 'height'>) =>
  Math.max(
    1e-6,
    Math.min(
      (v.width - 2 * PAD) / (2 * sky.HAMMER_HALF_WIDTH),
      (v.height - 2 * PAD) / (2 * sky.HAMMER_HALF_HEIGHT),
    ),
  );

export function toScreen(v: MapView, p: sky.AllSkyPoint): { x: number; y: number } {
  const s = baseScale(v) * v.zoom;
  return { x: v.width / 2 + p.x * s + v.panX, y: v.height / 2 - p.y * s + v.panY };
}

export function fromScreen(v: MapView, x: number, y: number): sky.AllSkyPoint {
  const s = baseScale(v) * v.zoom;
  return { x: (x - v.width / 2 - v.panX) / s, y: -(y - v.height / 2 - v.panY) / s };
}

/** Verschiebung so begrenzen, dass die Ellipse die Fläche nicht verlässt. */
export function clampView(v: MapView): MapView {
  const zoom = Math.min(ZOOM_MAX, Math.max(1, v.zoom));
  const s = baseScale(v) * zoom;
  const mx = Math.max(0, sky.HAMMER_HALF_WIDTH * s - v.width / 2 + PAD);
  const my = Math.max(0, sky.HAMMER_HALF_HEIGHT * s - v.height / 2 + PAD);
  return {
    ...v,
    zoom,
    panX: Math.min(mx, Math.max(-mx, v.panX)),
    panY: Math.min(my, Math.max(-my, v.panY)),
  };
}

/** Zoom um den Punkt (x, y): der Himmelspunkt unter dem Zeiger bleibt stehen. */
export function zoomAt(v: MapView, factor: number, x: number, y: number): MapView {
  const before = fromScreen(v, x, y);
  const zoom = Math.min(ZOOM_MAX, Math.max(1, v.zoom * factor));
  const s = baseScale(v) * zoom;
  return clampView({
    ...v,
    zoom,
    panX: x - v.width / 2 - before.x * s,
    panY: y - v.height / 2 + before.y * s,
  });
}

/**
 * Ziehen: in der Gesamtansicht dreht es den Himmel (Kartenmitte wandert, die Naht mit), gezoomt verschiebt es die
 * Ansicht. Nach rechts ziehen bringt östlichere (größere) RA in die Mitte.
 */
export function dragView(v: MapView, dx: number, dy: number): MapView {
  if (v.zoom <= 1.0001) {
    const degPerPx = 360 / (2 * sky.HAMMER_HALF_WIDTH * baseScale(v));
    return { ...v, centerRa: (((v.centerRa + dx * degPerPx) % 360) + 360) % 360 };
  }
  return clampView({ ...v, panX: v.panX + dx, panY: v.panY + dy });
}

// ---- Trefferprüfung ----------------------------------------------------------------------------------------------

/** Punkt im Polygon (gerade/ungerade Regel), Bildschirmkoordinaten. */
export function pointInRing(
  x: number,
  y: number,
  ring: readonly { readonly x: number; readonly y: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i] as { x: number; y: number };
    const b = ring[j] as { x: number; y: number };
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Fläche eines Rings in Pixeln² (zum Bevorzugen kleiner Felder unter großen). */
export function ringArea(ring: readonly { readonly x: number; readonly y: number }[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const p = ring[i] as { x: number; y: number };
    const q = ring[j] as { x: number; y: number };
    a += q.x * p.y - p.x * q.y;
  }
  return Math.abs(a) / 2;
}

/** Felder unter dieser Größe (px) zeigen zusätzlich einen Punkt, damit sie anklickbar bleiben. */
export const MIN_FIELD_PX = 4;
export const MARKER_RADIUS_PX = 4;

export interface ScreenShape {
  readonly id: string;
  readonly rings: readonly (readonly { x: number; y: number }[])[];
  readonly center: { x: number; y: number };
  /** Kleiner als `MIN_FIELD_PX` bzw. ohne Bildfeld: als Punkt gezeichnet. */
  readonly marker: boolean;
  readonly area: number;
}

export function toScreenShapes(v: MapView, shapes: readonly ProjectShape[]): ScreenShape[] {
  return shapes.map((sh) => {
    const rings = sh.rings.map((r) => r.map((p) => toScreen(v, p)));
    const area = rings.reduce((s, r) => s + ringArea(r), 0);
    return {
      id: sh.id,
      rings,
      center: toScreen(v, sh.center),
      marker: rings.length === 0 || Math.sqrt(area) < MIN_FIELD_PX,
      area,
    };
  });
}

/** Oberstes Projekt unter dem Zeiger: das kleinste getroffene Feld bzw. der nächste Punkt. */
export function hitShape(shapes: readonly ScreenShape[], x: number, y: number): string | null {
  let best: { id: string; area: number } | null = null;
  for (const s of shapes) {
    const inMarker = s.marker && Math.hypot(s.center.x - x, s.center.y - y) <= MARKER_RADIUS_PX + 3;
    const inField = s.rings.some((r) => pointInRing(x, y, r));
    if (!inMarker && !inField) continue;
    const area = inMarker ? 0 : s.area;
    if (!best || area < best.area) best = { id: s.id, area };
  }
  return best?.id ?? null;
}

// ---- Zeitachse je Rig ----------------------------------------------------------------------------------------------

export function nightKeys(from: string, to: string): string[] {
  const a = daysFromKey(from);
  const b = daysFromKey(to);
  return Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => keyFromDays(a + i));
}

export interface StackRow {
  readonly rigId: string;
  readonly name: string;
  /** Je Nacht die Stunden je Projekt in fester Reihenfolge (Stapel von unten). */
  readonly nights: ReadonlyMap<string, readonly { projectId: string; hours: number }[]>;
  readonly maxHours: number;
}

/**
 * Zeilen der Zeitachse: je Rig mit Aufnahmen bzw. Projekten eine Zeile; der Stapel je Nacht in der Reihenfolge der
 * Projektfarben (meiste Stunden im Zeitraum unten).
 */
export function stackRows(report: SkyReport, order: ReadonlyMap<string, number>): StackRow[] {
  return report.rigs
    .map((rig) => {
      const nights = new Map<string, { projectId: string; hours: number }[]>();
      let maxHours = 0;
      for (const n of report.nights) {
        if (n.rigId !== rig.id) continue;
        const stack = n.projects
          .map((p) => ({ projectId: p.projectId, hours: p.integrationS / 3600 }))
          .sort((a, b) => (order.get(a.projectId) ?? 0) - (order.get(b.projectId) ?? 0));
        nights.set(n.night, stack);
        maxHours = Math.max(
          maxHours,
          stack.reduce((s, p) => s + p.hours, 0),
        );
      }
      return { rigId: rig.id, name: rig.name, nights, maxHours };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Reihenfolge der Projektfarben: meiste Stunden im Zeitraum zuerst, dann Name. */
export function projectOrder(projects: readonly SkyProject[]): Map<string, number> {
  return new Map(
    [...projects]
      .sort((a, b) => b.periodIntegrationS - a.periodIntegrationS || a.name.localeCompare(b.name))
      .map((p, i) => [p.id, i] as const),
  );
}

/**
 * Neu- und Vollmond in der Mondspur: Nächte mit kleinster bzw. größter Beleuchtung in ihrer Umgebung (± 3 Nächte) unter
 * 5 % bzw. über 95 %.
 */
export function moonMarks(
  moon: readonly { night: string; illumPct: number }[],
): Map<string, 'new' | 'full'> {
  const out = new Map<string, 'new' | 'full'>();
  moon.forEach((m, i) => {
    const around = moon.slice(Math.max(0, i - 3), i + 4).map((x) => x.illumPct);
    if (m.illumPct < 5 && m.illumPct === Math.min(...around)) out.set(m.night, 'new');
    if (m.illumPct > 95 && m.illumPct === Math.max(...around)) out.set(m.night, 'full');
  });
  return out;
}
