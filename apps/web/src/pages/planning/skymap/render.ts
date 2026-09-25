/**
 * Zeichnen der Sternkarte S-20 (AP-21; FA-FRM-03…11): Himmelsgrund, Fotos (HiPS), Milchstraße, Gitter
 * (äquatorial, Alt/Az, Ekliptik, galaktische Ebene), Sternbilder, Sterne, Katalogobjekte mit
 * Winkelgrößen-Ellipsen, Beobachter (Horizont, Mindesthöhe, Meridian, Zenit, Sichtbarkeits-Heatmap),
 * Sonne/Taghimmel/Mond/Planeten, Projekt-Overlays und das Bildfeld des Rigs samt Mosaik und Vergleichs-Rig.
 * Alle Richtungen als J2000-Einheitsvektoren; Projektion und Rahmen aus `@nina-pm/engine` (`sky`), Panels
 * über `mosaicPanels` (geometry.md §2). Farben ausschließlich über die Tokens `--npm-sky-*`.
 */
import { mosaicPanels, offsetToSky, sky } from '@nina-pm/engine';
import type { DsoMarker } from '../../../api/client';
import type { BrightSky, StarField } from './sky-data';

export type Vec = readonly [number, number, number];

export const OVERLAYS = [
  'milkyWay',
  'eqGrid',
  'altAzGrid',
  'ecliptic',
  'galactic',
  'constLines',
  'constBounds',
  'constLabels',
  'starNames',
  'dso',
  'dsoSizes',
  'horizon',
  'minAlt',
  'meridian',
  'zenith',
  'heatmap',
  'sun',
  'daySky',
  'moon',
  'planets',
] as const;
export type Overlay = (typeof OVERLAYS)[number];

export const PROJECT_OVERLAYS = [
  'submitted',
  'planning',
  'active',
  'favorite',
  'unfinished',
  'completed',
] as const;
export type ProjectOverlay = (typeof PROJECT_OVERLAYS)[number];

export interface FrameSpec {
  readonly raDeg: number;
  readonly decDeg: number;
  /** Positionswinkel (Grad, Nord über Ost, flip-rotation.md §3). */
  readonly paDeg: number;
  readonly fovWidthDeg: number;
  readonly fovHeightDeg: number;
  readonly cols: number;
  readonly rows: number;
  readonly overlapPct: number;
}

export interface ProjectFrame {
  readonly id: string;
  readonly name: string;
  readonly category: ProjectOverlay;
  readonly frame: FrameSpec;
}

export interface Observer {
  /** J2000 → horizontal (Ost, Nord, Zenit). */
  readonly toHorizon: sky.Mat3;
  readonly minAltDeg: number;
  readonly heatAltDeg: number;
  readonly sunAltDeg: number;
}

export interface Bodies {
  readonly sun: Vec | null;
  readonly moon: { vec: Vec; illumPct: number } | null;
  readonly planets: readonly { id: string; vec: Vec; mag: number }[];
}

export interface RenderInput {
  readonly view: sky.SkyView;
  readonly overlays: ReadonlySet<Overlay>;
  readonly projectOverlays: ReadonlySet<ProjectOverlay>;
  readonly photosShown: boolean;
  readonly bright: BrightSky | null;
  readonly faint: StarField | null;
  readonly dso: readonly DsoMarker[];
  readonly observer: Observer | null;
  readonly bodies: Bodies | null;
  readonly projects: readonly ProjectFrame[];
  readonly frame: FrameSpec | null;
  readonly compare: FrameSpec | null;
  readonly selectedId: string | null;
  /** Token der Rahmenfarbe (`--npm-sky-…`), z. B. `frame`, `frame-compare`. */
  readonly frameColor: string;
  readonly lang: 'de' | 'en';
  readonly planetNames: Readonly<Record<string, string>>;
  readonly moonLabel: string;
  readonly sunLabel: string;
  readonly zenithLabel: string;
}

/** Aufgelöste Farben aus den Tokens (`--npm-sky-*`), einmal je Zeichnung gelesen. */
export type Colors = Readonly<Record<string, string>>;

export function readColors(el: Element): Colors {
  const cs = getComputedStyle(el);
  const names = [
    'bg',
    'ground',
    'milky-way',
    'grid-eq',
    'grid-altaz',
    'ecliptic',
    'galactic',
    'const-line',
    'const-label',
    'star',
    'star-label',
    'dso',
    'dso-label',
    'horizon',
    'min-alt',
    'meridian',
    'heatmap',
    'sun',
    'day',
    'moon',
    'planet',
    'frame',
    'frame-compare',
    'label',
    ...PROJECT_OVERLAYS.map((p) => `project-${p}`),
  ];
  return Object.fromEntries(
    names.map((n) => [n, cs.getPropertyValue(`--npm-sky-${n}`).trim() || '#888']),
  );
}

const DEG = Math.PI / 180;
const unit = (raDeg: number, decDeg: number): Vec => [
  Math.cos(decDeg * DEG) * Math.cos(raDeg * DEG),
  Math.cos(decDeg * DEG) * Math.sin(raDeg * DEG),
  Math.sin(decDeg * DEG),
];

/** Sichtbarer Radius der Ansicht (Grad) – Kreis um die Bildmitte, der das ganze Bild enthält. */
export function viewRadiusDeg(view: sky.SkyView): number {
  const corner = sky.unproject(view, 0, 0);
  const d = sky.dot(corner, view.center);
  return (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI;
}

/** Polylinie aus Vektoren; bricht bei nicht darstellbaren Punkten und großen Sprüngen ab. */
function polyline(ctx: CanvasRenderingContext2D, view: sky.SkyView, pts: readonly Vec[]) {
  let pen = false;
  let last: { x: number; y: number } | null = null;
  const maxJump = Math.max(view.width, view.height);
  ctx.beginPath();
  for (const v of pts) {
    const p = sky.project(view, v);
    if (!p || (last && Math.hypot(p.x - last.x, p.y - last.y) > maxJump)) {
      pen = false;
      last = p;
      continue;
    }
    if (pen) ctx.lineTo(p.x, p.y);
    else ctx.moveTo(p.x, p.y);
    pen = true;
    last = p;
  }
  ctx.stroke();
}

/** Großkreis bzw. Breitenkreis in einem Rahmen `toFrame` (Zeilen = Achsen des Rahmens). */
function frameCircle(
  toFrame: sky.Mat3 | null,
  latDeg: number | null,
  lonDeg: number | null,
  steps = 180,
): Vec[] {
  const back = toFrame ? sky.transpose(toFrame) : null;
  const pts: Vec[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const f = i / steps;
    const v = latDeg !== null ? unit(f * 360, latDeg) : unit(lonDeg ?? 0, -90 + f * 180);
    pts.push(back ? sky.matVec(back, v) : v);
  }
  return pts;
}

/** Rasterweite (Grad) für ein Sichtfeld – etwa sechs Linien über das Bild. */
function gridStep(fovDeg: number): number {
  const steps = [30, 15, 10, 5, 2, 1, 0.5, 0.25, 1 / 6, 1 / 12];
  return steps.find((s) => fovDeg / s >= 4) ?? steps[steps.length - 1] ?? 1;
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  view: sky.SkyView,
  toFrame: sky.Mat3 | null,
  color: string,
  lonScale = 1,
) {
  const step = gridStep(view.fovDeg);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let lat = -90 + step; lat < 90 - 1e-9; lat += step)
    polyline(ctx, view, frameCircle(toFrame, lat, null, 240));
  const lonStep = step * lonScale;
  for (let lon = 0; lon < 360 - 1e-9; lon += lonStep)
    polyline(ctx, view, frameCircle(toFrame, null, lon, 120));
}

/** Äquatoriale Beschriftung an den Kreuzungen nahe der Bildmitte. */
function drawEqLabels(ctx: CanvasRenderingContext2D, view: sky.SkyView, color: string) {
  const step = gridStep(view.fovDeg);
  const c = sky.vecToRadec(view.center);
  ctx.fillStyle = color;
  ctx.font = '11px system-ui, sans-serif';
  const raStep = step * 1.5; // RA in Stunden: 15° = 1 h
  const ra0 = Math.round(c.raDeg / raStep) * raStep;
  const dec0 = Math.round(c.decDeg / step) * step;
  for (let k = -3; k <= 3; k += 1) {
    const ra = (((ra0 + k * raStep) % 360) + 360) % 360;
    const p = sky.project(view, unit(ra, Math.max(-89, Math.min(89, dec0))));
    if (p && p.x > 4 && p.x < view.width - 40 && p.y > 12 && p.y < view.height - 4) {
      const h = ra / 15;
      const hh = Math.floor(h + 1e-9);
      const mm = Math.round((h - hh) * 60);
      ctx.fillText(
        `${String(hh)}h${mm ? String(mm).padStart(2, '0') + 'm' : ''}`,
        p.x + 3,
        p.y - 3,
      );
    }
    const dec = dec0 + k * step;
    if (dec <= -90 || dec >= 90) continue;
    const q = sky.project(view, unit(ra0, dec));
    if (q && q.x > 4 && q.x < view.width - 40 && q.y > 12 && q.y < view.height - 4)
      ctx.fillText(
        `${dec > 0 ? '+' : ''}${String(Math.round(dec * 100) / 100)}°`,
        q.x + 3,
        q.y + 12,
      );
  }
}

function drawMilkyWay(
  ctx: CanvasRenderingContext2D,
  view: sky.SkyView,
  mw: BrightSky['milkyWay'],
  color: string,
) {
  const px = Math.max(1.5, (view.width / view.fovDeg) * 1.2);
  const limit = Math.cos(Math.min(179, viewRadiusDeg(view) + 2) * DEG);
  ctx.fillStyle = color;
  for (const cell of mw) {
    if (sky.dot(cell.vec, view.center) < limit) continue;
    const p = sky.project(view, cell.vec);
    if (!p) continue;
    ctx.globalAlpha = Math.min(1, cell.level / 2.5);
    ctx.fillRect(p.x - px / 2, p.y - px / 2, px, px);
  }
  ctx.globalAlpha = 1;
}

/** Grenzhelligkeit der Sterne je Sichtfeld: 5 mag bei 180°, 8 mag unter 10°. */
export function starLimitMag(fovDeg: number): number {
  if (fovDeg >= 120) return 5;
  if (fovDeg >= 60) return 5.5;
  if (fovDeg >= 30) return 6;
  if (fovDeg >= 15) return 7;
  return 8;
}

function drawStars(
  ctx: CanvasRenderingContext2D,
  view: sky.SkyView,
  field: StarField,
  limitMag: number,
  color: string,
) {
  const limit = Math.cos(Math.min(179, viewRadiusDeg(view) + 1) * DEG);
  ctx.fillStyle = color;
  const { vec, mag } = field;
  for (let i = 0; i < field.count; i += 1) {
    const m = mag[i] as number;
    if (m > limitMag) continue;
    const v: Vec = [vec[i * 3] as number, vec[i * 3 + 1] as number, vec[i * 3 + 2] as number];
    if (sky.dot(v, view.center) < limit) continue;
    const p = sky.project(view, v);
    if (!p || p.x < -4 || p.y < -4 || p.x > view.width + 4 || p.y > view.height + 4) continue;
    const r = Math.max(0.5, 0.45 * (limitMag + 1.5 - m));
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
    ctx.fill();
  }
}

function drawStarNames(
  ctx: CanvasRenderingContext2D,
  view: sky.SkyView,
  field: StarField,
  lang: 'de' | 'en',
  color: string,
) {
  if (!field.names) return;
  const maxMag = view.fovDeg > 90 ? 1.5 : view.fovDeg > 40 ? 2.5 : 4;
  ctx.fillStyle = color;
  ctx.font = '11px system-ui, sans-serif';
  for (const [i, name] of field.names) {
    if ((field.mag[i] as number) > maxMag) continue;
    const v: Vec = [
      field.vec[i * 3] as number,
      field.vec[i * 3 + 1] as number,
      field.vec[i * 3 + 2] as number,
    ];
    const p = sky.project(view, v);
    if (!p || p.x < 0 || p.y < 0 || p.x > view.width || p.y > view.height) continue;
    ctx.fillText(lang === 'en' ? name.en : name.de, p.x + 5, p.y - 4);
  }
}

function drawDso(
  ctx: CanvasRenderingContext2D,
  view: sky.SkyView,
  items: readonly DsoMarker[],
  sizes: boolean,
  selectedId: string | null,
  colors: Colors,
) {
  const pxPerDeg = view.width / view.fovDeg;
  ctx.font = '11px system-ui, sans-serif';
  for (const o of items) {
    const v = unit(o.raDeg, o.decDeg);
    const p = sky.project(view, v);
    if (!p || p.x < -50 || p.y < -50 || p.x > view.width + 50 || p.y > view.height + 50) continue;
    const major = ((o.sizeMajorArcmin ?? 0) / 60) * pxPerDeg;
    const minor = ((o.sizeMinorArcmin ?? o.sizeMajorArcmin ?? 0) / 60) * pxPerDeg;
    ctx.strokeStyle = colors.dso ?? '#8fd3a8';
    ctx.lineWidth = o.id === selectedId ? 2.5 : 1.2;
    ctx.beginPath();
    if (sizes && major >= 6) {
      // Positionswinkel Nord über Ost; auf dem Bild um den Winkel der Nordrichtung gedreht.
      const north = sky.screenNorthAngle(view, v);
      const pa = ((o.positionAngleDeg ?? 0) + north) * DEG;
      ctx.ellipse(p.x, p.y, Math.max(2, minor / 2), major / 2, -pa, 0, 2 * Math.PI);
    } else ctx.arc(p.x, p.y, 3.5, 0, 2 * Math.PI);
    ctx.stroke();
    const labelled =
      view.fovDeg <= 20 ||
      o.id === selectedId ||
      (o.mag !== null && o.mag < (view.fovDeg > 60 ? 5 : 7)) ||
      (view.fovDeg <= 60 && o.displayName.startsWith('M '));
    if (labelled) {
      ctx.fillStyle = colors['dso-label'] ?? '#aaa';
      ctx.fillText(o.displayName, p.x + Math.max(5, minor / 2), p.y - 4);
    }
  }
}

/** Ecken eines Bildfelds (Tangentialebene, geometry.md §2.1) als Vektorfolge mit Zwischenpunkten. */
export function framePolygon(
  raDeg: number,
  decDeg: number,
  paDeg: number,
  wDeg: number,
  hDeg: number,
  perEdge = 8,
): Vec[] {
  const cos = Math.cos(paDeg * DEG);
  const sin = Math.sin(paDeg * DEG);
  const corners: [number, number][] = [
    [wDeg / 2, hDeg / 2],
    [-wDeg / 2, hDeg / 2],
    [-wDeg / 2, -hDeg / 2],
    [wDeg / 2, -hDeg / 2],
  ];
  const out: Vec[] = [];
  for (let c = 0; c < 4; c += 1) {
    const [x0, y0] = corners[c] as [number, number];
    const [x1, y1] = corners[(c + 1) % 4] as [number, number];
    for (let k = 0; k < perEdge; k += 1) {
      const f = k / perEdge;
      const xs = x0 + (x1 - x0) * f; // Sensor-X (+ = links im Bild = Ost bei pa = 0)
      const ys = y0 + (y1 - y0) * f; // Sensor-Y (+ = oben = Nord bei pa = 0)
      const xi = xs * cos + ys * sin;
      const eta = -xs * sin + ys * cos;
      const s = offsetToSky(raDeg, decDeg, xi, eta);
      out.push(unit(s.raDeg, s.decDeg));
    }
  }
  out.push(out[0] as Vec);
  return out;
}

/** Panels eines Rahmens (Mosaik über die Engine, geometry.md §2) als Polygone mit NINA-Nummer. */
export function framePanels(f: FrameSpec) {
  const panels = mosaicPanels({
    raDeg: f.raDeg,
    decDeg: f.decDeg,
    paDeg: f.paDeg,
    cols: f.cols,
    rows: f.rows,
    overlapPct: f.overlapPct,
    fovWidthDeg: f.fovWidthDeg,
    fovHeightDeg: f.fovHeightDeg,
  });
  return panels.map((p) => ({
    n: p.n,
    center: unit(p.raDeg, p.decDeg),
    polygon: framePolygon(p.raDeg, p.decDeg, p.paDeg, f.fovWidthDeg, f.fovHeightDeg),
  }));
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  view: sky.SkyView,
  f: FrameSpec,
  color: string,
  options: { dashed?: boolean; label?: string; numbers?: boolean; width?: number },
) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = options.width ?? 2;
  ctx.setLineDash(options.dashed ? [6, 4] : []);
  const panels = framePanels(f);
  ctx.font = '12px system-ui, sans-serif';
  for (const p of panels) {
    polyline(ctx, view, p.polygon);
    if (options.numbers && panels.length > 1) {
      const c = sky.project(view, p.center);
      if (c) ctx.fillText(String(p.n), c.x - 4, c.y + 4);
    }
  }
  if (options.label) {
    const top = sky.project(view, panels[0]?.polygon[0] ?? unit(f.raDeg, f.decDeg));
    if (top) ctx.fillText(options.label, top.x + 4, top.y - 6);
  }
  ctx.setLineDash([]);
}

function drawObserver(
  ctx: CanvasRenderingContext2D,
  view: sky.SkyView,
  obs: Observer,
  overlays: ReadonlySet<Overlay>,
  colors: Colors,
  zenithLabel: string,
) {
  const H = obs.toHorizon;
  // Boden und Heatmap aus einer groben Abtastung des Bilds (Höhe je Zelle).
  if (overlays.has('horizon') || overlays.has('heatmap')) {
    const cell = 12;
    for (let y = 0; y < view.height; y += cell) {
      for (let x = 0; x < view.width; x += cell) {
        const v = sky.unproject(view, x + cell / 2, y + cell / 2);
        const alt = Math.asin(Math.max(-1, Math.min(1, sky.dot(H[2], v)))) / DEG;
        if (alt < 0 && overlays.has('horizon')) {
          ctx.fillStyle = colors.ground ?? '#222';
          ctx.fillRect(x, y, cell, cell);
        } else if (overlays.has('heatmap') && alt < obs.heatAltDeg) {
          ctx.fillStyle = colors.heatmap ?? 'rgba(229,72,77,0.2)';
          ctx.fillRect(x, y, cell, cell);
        }
      }
    }
  }
  if (overlays.has('horizon')) {
    ctx.strokeStyle = colors.horizon ?? '#e67e22';
    ctx.lineWidth = 1.8;
    polyline(ctx, view, frameCircle(H, 0, null, 360));
  }
  if (overlays.has('minAlt')) {
    ctx.strokeStyle = colors['min-alt'] ?? '#e5484d';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 4]);
    polyline(ctx, view, frameCircle(H, obs.minAltDeg, null, 360));
    ctx.setLineDash([]);
  }
  if (overlays.has('meridian')) {
    ctx.strokeStyle = colors.meridian ?? '#ccc';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    polyline(ctx, view, frameCircle(H, null, 0, 180));
    ctx.setLineDash([]);
  }
  if (overlays.has('zenith')) {
    const z = sky.project(view, sky.matVec(sky.transpose(H), [0, 0, 1]));
    if (z) {
      ctx.strokeStyle = colors.meridian ?? '#ccc';
      ctx.fillStyle = colors.label ?? '#ddd';
      ctx.beginPath();
      ctx.moveTo(z.x - 6, z.y);
      ctx.lineTo(z.x + 6, z.y);
      ctx.moveTo(z.x, z.y - 6);
      ctx.lineTo(z.x, z.y + 6);
      ctx.stroke();
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText(zenithLabel, z.x + 8, z.y - 6);
    }
  }
}

function drawBodies(
  ctx: CanvasRenderingContext2D,
  view: sky.SkyView,
  input: RenderInput,
  colors: Colors,
) {
  const b = input.bodies;
  if (!b) return;
  ctx.font = '12px system-ui, sans-serif';
  const disc = (v: Vec, r: number, color: string, label: string) => {
    const p = sky.project(view, v);
    if (!p) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = colors.label ?? '#ddd';
    ctx.fillText(label, p.x + r + 4, p.y - r);
  };
  if (input.overlays.has('sun') && b.sun) disc(b.sun, 7, colors.sun ?? '#f6c85f', input.sunLabel);
  if (input.overlays.has('moon') && b.moon)
    disc(
      b.moon.vec,
      6,
      colors.moon ?? '#e8ecf2',
      `${input.moonLabel} ${String(Math.round(b.moon.illumPct))} %`,
    );
  if (input.overlays.has('planets'))
    for (const p of b.planets)
      disc(
        p.vec,
        Math.max(2, 4 - p.mag / 2),
        colors.planet ?? '#f7b267',
        input.planetNames[p.id] ?? p.id,
      );
}

/** Zeichnet alle Ebenen außer den Fotos (die kommen vorher aus `HipsLayer`). */
export function drawSky(
  ctx: CanvasRenderingContext2D,
  input: RenderInput,
  colors: Colors,
  drawPhotos: () => void,
) {
  const { view, overlays } = input;
  ctx.fillStyle = colors.bg ?? '#000';
  ctx.fillRect(0, 0, view.width, view.height);
  // Taghimmel: Grund aufhellen, solange die Sonne über −6° steht.
  const sunAlt = input.observer?.sunAltDeg ?? -90;
  if (overlays.has('daySky') && sunAlt > -6) {
    ctx.globalAlpha = Math.min(1, (sunAlt + 6) / 12);
    ctx.fillStyle = colors.day ?? '#5c8ed4';
    ctx.fillRect(0, 0, view.width, view.height);
    ctx.globalAlpha = 1;
  }
  drawPhotos();
  if (overlays.has('milkyWay') && input.bright && (!input.photosShown || view.fovDeg > 40))
    drawMilkyWay(ctx, view, input.bright.milkyWay, colors['milky-way'] ?? '#223');
  if (overlays.has('eqGrid')) {
    drawGrid(ctx, view, null, colors['grid-eq'] ?? '#468', 1.5);
    drawEqLabels(ctx, view, colors['grid-eq'] ?? '#468');
  }
  if (overlays.has('altAzGrid') && input.observer)
    drawGrid(ctx, view, input.observer.toHorizon, colors['grid-altaz'] ?? '#4a6');
  if (overlays.has('ecliptic')) {
    ctx.strokeStyle = colors.ecliptic ?? '#dc5';
    ctx.lineWidth = 1.3;
    polyline(ctx, view, frameCircle(sky.EQ_TO_ECLIPTIC, 0, null, 360));
  }
  if (overlays.has('galactic')) {
    ctx.strokeStyle = colors.galactic ?? '#c8e';
    ctx.lineWidth = 1.3;
    polyline(ctx, view, frameCircle(sky.EQ_TO_GALACTIC, 0, null, 360));
  }
  if (input.bright) {
    if (overlays.has('constBounds')) {
      ctx.strokeStyle = colors['const-line'] ?? '#678';
      ctx.lineWidth = 0.6;
      ctx.setLineDash([3, 3]);
      for (const ring of input.bright.bounds) polyline(ctx, view, ring);
      ctx.setLineDash([]);
    }
    if (overlays.has('constLines')) {
      ctx.strokeStyle = colors['const-line'] ?? '#678';
      ctx.lineWidth = 1;
      for (const line of input.bright.lines) polyline(ctx, view, line);
    }
    if (overlays.has('constLabels')) {
      ctx.fillStyle = colors['const-label'] ?? '#89a';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      for (const l of input.bright.labels) {
        if (view.fovDeg > 100 && l.rank > 1) continue;
        if (view.fovDeg > 50 && l.rank > 2) continue;
        const p = sky.project(view, l.vec);
        if (p && p.x > 0 && p.y > 0 && p.x < view.width && p.y < view.height)
          ctx.fillText(input.lang === 'en' ? l.latin : l.de, p.x, p.y);
      }
      ctx.textAlign = 'left';
    }
    const limit = starLimitMag(view.fovDeg);
    drawStars(ctx, view, input.bright.stars, limit, colors.star ?? '#fff');
    if (input.faint && limit > 6) drawStars(ctx, view, input.faint, limit, colors.star ?? '#fff');
    if (overlays.has('starNames'))
      drawStarNames(ctx, view, input.bright.stars, input.lang, colors['star-label'] ?? '#ddd');
  }
  if (input.observer) drawObserver(ctx, view, input.observer, overlays, colors, input.zenithLabel);
  if (overlays.has('dso'))
    drawDso(ctx, view, input.dso, overlays.has('dsoSizes'), input.selectedId, colors);
  drawBodies(ctx, view, input, colors);
  for (const p of input.projects) {
    if (!input.projectOverlays.has(p.category)) continue;
    drawFrame(ctx, view, p.frame, colors[`project-${p.category}`] ?? '#aaa', {
      label: p.name,
      width: p.id === input.selectedId ? 2.5 : 1.3,
    });
  }
  if (input.compare)
    drawFrame(ctx, view, input.compare, colors['frame-compare'] ?? '#7fc8f8', { dashed: true });
  if (input.frame)
    drawFrame(ctx, view, input.frame, colors[input.frameColor] ?? colors.frame ?? '#ff4fd8', {
      numbers: true,
      width: 2,
    });
}

// ---- Treffer ------------------------------------------------------------------------------------

/** Liegt der Bildpunkt im (äußeren) Bildfeld? Punkt-in-Polygon über die projizierte Hülle der Panels. */
export function hitFrame(view: sky.SkyView, f: FrameSpec, x: number, y: number): boolean {
  return framePanels(f).some((p) => {
    const pts = p.polygon
      .map((v) => sky.project(view, v))
      .filter((q): q is { x: number; y: number } => q !== null);
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
      const a = pts[i] as { x: number; y: number };
      const b = pts[j] as { x: number; y: number };
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x)
        inside = !inside;
    }
    return inside;
  });
}

/** Nächstes Katalogobjekt bzw. Projekt im Umkreis von `radius` Pixeln. */
export function hitMarker<T extends { raDeg: number; decDeg: number }>(
  view: sky.SkyView,
  items: readonly T[],
  x: number,
  y: number,
  radius = 10,
): T | null {
  let best: T | null = null;
  let bestD = radius;
  for (const o of items) {
    const p = sky.project(view, unit(o.raDeg, o.decDeg));
    if (!p) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= bestD) {
      best = o;
      bestD = d;
    }
  }
  return best;
}
