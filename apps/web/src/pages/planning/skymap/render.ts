/**
 * Zeichnen der Sternkarte S-20 (AP-21; FA-FRM-03…11): Himmelsgrund, Fotos (HiPS), Milchstraße, Gitter
 * (äquatorial, Alt/Az, Ekliptik, galaktische Ebene), Sternbilder, Sterne, Katalogobjekte mit
 * Winkelgrößen-Ellipsen, Beobachter (Horizont, Mindesthöhe, Meridian, Zenit, Sichtbarkeits-Heatmap),
 * Sonne/Taghimmel/Mond/Planeten, Projekt-Overlays und das Bildfeld des Rigs samt Mosaik und Vergleichs-Rig.
 * Nach der Vorlage `legacy/astro-tools-2026-09-21/js/sky-map.js` (28.09.2026): Himmelsrichtungen unter dem
 * Horizont, deckender Boden, Milchstraße als weiches Bild aus dem 0,5°-Raster, das überfahrene Sternbild
 * hervorgehoben, das gewählte Objekt mit Ring, Beschriftungen nach Vorrang ohne Überlappung. `drawSky` gibt
 * die Trefferliste (Sternbild-Ecken, Sterne, Himmelskörper) für Überfahren und Anklicken zurück.
 * Alle Richtungen als J2000-Einheitsvektoren; Projektion und Rahmen aus `@nina-pm/engine` (`sky`), Panels
 * über `mosaicPanels` (geometry.md §2). Farben ausschließlich über die Tokens `--npm-sky-*`.
 */
import { mosaicPanels, offsetToSky, sky } from '@nina-pm/engine';
import type { DsoMarker } from '../../../api/client';
import { milkyWayAt, type BrightSky, type MilkyWayGrid, type StarField } from './sky-data';

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

/** Himmelskörper des Sonnensystems auf der Karte (`sun`, `moon` oder eine Planeten-ID). */
export type BodyId = 'sun' | 'moon' | sky.PlanetId;

/** Trefferliste einer Zeichnung (Bildpunkte), für Überfahren und Anklicken. */
export interface HitIndex {
  /** Ecken und Mitten der Sternbildlinien sowie die Namenspunkte, je mit IAU-Kürzel. */
  readonly verts: readonly { x: number; y: number; abbr: string }[];
  /** Gezeichnete helle Sterne (Index in `bright.stars`). */
  readonly stars: readonly { x: number; y: number; i: number; mag: number }[];
  readonly bodies: readonly { x: number; y: number; r: number; id: BodyId }[];
}

export const EMPTY_HITS: HitIndex = { verts: [], stars: [], bodies: [] };

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
  /** Richtung des gewählten Objekts (Stern, Himmelskörper, Katalogobjekt) für den Auswahlring. */
  readonly selectedVec: Vec | null;
  /** IAU-Kürzel des überfahrenen Sternbilds. */
  readonly hoverCon: string | null;
  /** Sternbildnamen: Landessprache (DE deutsch, EN englisch) oder lateinisch. */
  readonly names: 'local' | 'latin';
  /** Token der Rahmenfarbe (`--npm-sky-…`), z. B. `frame`, `frame-compare`. */
  readonly frameColor: string;
  readonly lang: 'de' | 'en';
  readonly planetNames: Readonly<Record<string, string>>;
  readonly moonLabel: string;
  readonly sunLabel: string;
  readonly zenithLabel: string;
  /** Himmelsrichtungen N, NO, O, SO, S, SW, W, NW in der Sprache der Oberfläche. */
  readonly compassLabels: readonly string[];
  readonly milkyWayLabel: string;
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
    'const-line-hi',
    'const-label',
    'const-label-hi',
    'compass',
    'compass-dim',
    'selected',
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

/** Farbe `rgb(…)`/`rgba(…)`/`#rrggbb` → Kanäle 0–255 und Deckkraft 0–1 (für Bildpunkte im Offscreen-Bild). */
export function colorParts(c: string): [number, number, number, number] {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c.trim());
  if (hex)
    return [
      parseInt(hex[1] ?? '0', 16),
      parseInt(hex[2] ?? '0', 16),
      parseInt(hex[3] ?? '0', 16),
      1,
    ];
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (!m) return [136, 136, 136, 1];
  const [r = 136, g = 136, b = 136, a = 1] = (m[1] ?? '').split(',').map((x) => Number(x.trim()));
  return [r, g, b, a];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Zeichenfläche für ein grobes Bild (4-px-Zellen), das weich hochskaliert wird; ohne DOM `null`. */
let scratch: HTMLCanvasElement | null = null;
function scratchImage(w: number, h: number) {
  if (typeof document === 'undefined') return null;
  scratch ??= document.createElement('canvas');
  scratch.width = w;
  scratch.height = h;
  const c = scratch.getContext('2d');
  if (!c) return null;
  return { canvas: scratch, ctx: c, img: c.createImageData(w, h) };
}

/** Höhe (Grad) eines J2000-Vektors über dem Horizont. */
const altOf = (H: sky.Mat3, v: Vec) => Math.asin(Math.max(-1, Math.min(1, sky.dot(H[2], v)))) / DEG;

/** Stufe der Dämmerung nach der Sonnenhöhe: 0 Tag, 1 bürgerlich, 2 nautisch, 3 astronomisch, 4 Nacht. */
export function twilightClass(sunAltDeg: number): 0 | 1 | 2 | 3 | 4 {
  if (sunAltDeg > -0.833) return 0;
  if (sunAltDeg > -6) return 1;
  if (sunAltDeg > -12) return 2;
  if (sunAltDeg > -18) return 3;
  return 4;
}

const CELL = 4;

/**
 * Milchstraße wie in der Vorlage (`paintMilkyWay`): jede 4-px-Zelle zurück an den Himmel, Stufe aus dem
 * 0,5°-Raster bilinear, Deckkraft 0,35 für Stufe 1 bis 1 für Stufe 5, zum Horizont hin schwächer; das kleine
 * Bild wird weich hochskaliert. In der Dämmerung und beim Hineinzoomen tritt das Band zurück. Gibt eine
 * helle Stelle nahe der Bildmitte für den Namen zurück.
 */
function paintMilkyWay(
  ctx: CanvasRenderingContext2D,
  view: sky.SkyView,
  mw: MilkyWayGrid,
  color: string,
  observer: Observer | null,
): { x: number; y: number } | null {
  const cls = observer ? twilightClass(observer.sunAltDeg) : 4;
  const gain = Math.max(0, Math.log2(150 / view.fovDeg));
  const fade = [0, 0, 0.3, 0.7, 1][cls] ?? 1;
  const dim = clamp(1 - gain * 0.3, 0.25, 1);
  if (fade * dim <= 0) return null;
  const gw = Math.ceil(view.width / CELL);
  const gh = Math.ceil(view.height / CELL);
  const s = scratchImage(gw, gh);
  if (!s) return null;
  const [r, g, b, strength] = colorParts(color);
  const px = s.img.data;
  let best = Infinity;
  let spot: { x: number; y: number } | null = null;
  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      const x = (gx + 0.5) * CELL;
      const y = (gy + 0.5) * CELL;
      const v = sky.unproject(view, x, y);
      let altF = 1;
      let alt = 90;
      if (observer) {
        alt = altOf(observer.toHorizon, v);
        if (alt < 0) continue;
        altF = clamp(alt / 15, 0.35, 1);
      }
      const rd = sky.vecToRadec(v);
      const level = milkyWayAt(mw, rd.raDeg, rd.decDeg);
      if (!(level > 0)) continue;
      const o = (gy * gw + gx) * 4;
      px[o] = r;
      px[o + 1] = g;
      px[o + 2] = b;
      px[o + 3] = Math.round(
        (clamp(level, 0, 1) * 0.35 + (clamp(level - 1, 0, 4) / 4) * 0.65) * altF * 255,
      );
      if (level >= 3 && alt > 20) {
        const d = Math.abs(x - view.width / 2) + Math.abs(y - view.height / 2);
        if (d < best) {
          best = d;
          spot = { x, y };
        }
      }
    }
  }
  s.ctx.putImageData(s.img, 0, 0);
  ctx.save();
  ctx.globalAlpha = strength * fade * dim;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(s.canvas, 0, 0, gw * CELL, gh * CELL);
  ctx.restore();
  return fade * dim >= 0.5 ? spot : null;
}

/** Boden unter dem Horizont (deckend, weiche Kante) und Heatmap unter der Höhen-Schwelle. */
function paintGround(
  ctx: CanvasRenderingContext2D,
  view: sky.SkyView,
  obs: Observer,
  overlays: ReadonlySet<Overlay>,
  colors: Colors,
) {
  const ground = overlays.has('horizon');
  const heat = overlays.has('heatmap');
  if (!ground && !heat) return;
  const gw = Math.ceil(view.width / CELL);
  const gh = Math.ceil(view.height / CELL);
  const s = scratchImage(gw, gh);
  const [gr, gg, gb, ga] = colorParts(colors.ground ?? 'rgba(28,25,22,0.8)');
  const [hr, hg, hb, ha] = colorParts(colors.heatmap ?? 'rgba(229,72,77,0.22)');
  if (!s) {
    // Ohne Offscreen-Bild (Tests): grobe Zellen direkt.
    for (let y = 0; y < view.height; y += 12)
      for (let x = 0; x < view.width; x += 12) {
        const alt = altOf(obs.toHorizon, sky.unproject(view, x + 6, y + 6));
        if (alt < 0 && ground) ctx.fillStyle = colors.ground ?? '#222';
        else if (heat && alt < obs.heatAltDeg) ctx.fillStyle = colors.heatmap ?? '#a33';
        else continue;
        ctx.fillRect(x, y, 12, 12);
      }
    return;
  }
  const px = s.img.data;
  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      const alt = altOf(obs.toHorizon, sky.unproject(view, (gx + 0.5) * CELL, (gy + 0.5) * CELL));
      const o = (gy * gw + gx) * 4;
      if (alt < 0 && ground) {
        px[o] = gr;
        px[o + 1] = gg;
        px[o + 2] = gb;
        px[o + 3] = Math.round(ga * 255);
      } else if (heat && alt < obs.heatAltDeg) {
        px[o] = hr;
        px[o + 1] = hg;
        px[o + 2] = hb;
        px[o + 3] = Math.round(ha * 255);
      }
    }
  }
  s.ctx.putImageData(s.img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(s.canvas, 0, 0, gw * CELL, gh * CELL);
  ctx.restore();
}

/** Beschriftungen nach Vorrang: eine Beschriftung, die eine frühere überdecken würde, entfällt (Vorlage). */
export class Labels {
  private readonly boxes: [number, number, number, number][] = [];
  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly width: number,
  ) {}
  /** Fläche freihalten (z. B. Scheibe eines Himmelskörpers). */
  block(x0: number, y0: number, x1: number, y1: number) {
    this.boxes.push([x0, y0, x1, y1]);
  }
  put(
    txt: string,
    x: number,
    y: number,
    color: string,
    font: string,
    align: 'left' | 'center' = 'left',
    force = false,
  ): boolean {
    if (!txt) return false;
    const ctx = this.ctx;
    ctx.font = font;
    const w = Number(ctx.measureText(txt).width) || txt.length * 6;
    const x0 = clamp(align === 'center' ? x - w / 2 : x, 2, Math.max(2, this.width - w - 2));
    const box: [number, number, number, number] = [x0 - 2, y - 7, x0 + w + 2, y + 7];
    if (
      !force &&
      this.boxes.some((o) => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1])
    )
      return false;
    this.boxes.push(box);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, x0, y);
    ctx.textBaseline = 'alphabetic';
    return true;
  }
}

const FONT = 'system-ui, sans-serif';

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
  hits?: { x: number; y: number; i: number; mag: number }[],
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
    hits?.push({ x: p.x, y: p.y, i, mag: m });
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
    ctx.fill();
  }
}

function starNameLabels(
  view: sky.SkyView,
  field: StarField,
  lang: 'de' | 'en',
  labels: Labels,
  color: string,
  up: ((v: Vec) => boolean) | null,
) {
  if (!field.names) return;
  const maxMag = view.fovDeg > 90 ? 1.5 : view.fovDeg > 40 ? 2.5 : 4;
  const list = [...field.names]
    .filter(([i]) => (field.mag[i] as number) <= maxMag)
    .sort((x, y) => (field.mag[x[0]] as number) - (field.mag[y[0]] as number));
  for (const [i, name] of list) {
    const v: Vec = [
      field.vec[i * 3] as number,
      field.vec[i * 3 + 1] as number,
      field.vec[i * 3 + 2] as number,
    ];
    if (up && !up(v)) continue;
    const p = sky.project(view, v);
    if (!p || p.x < 0 || p.y < 0 || p.x > view.width || p.y > view.height) continue;
    labels.put(lang === 'en' ? name.en : name.de, p.x + 5, p.y - 6, color, `11px ${FONT}`);
  }
}

function drawDso(
  ctx: CanvasRenderingContext2D,
  view: sky.SkyView,
  items: readonly DsoMarker[],
  sizes: boolean,
  selectedId: string | null,
  colors: Colors,
  observer: Observer | null,
): { txt: string; x: number; y: number; selected: boolean }[] {
  const pxPerDeg = view.width / view.fovDeg;
  const out: { txt: string; x: number; y: number; selected: boolean }[] = [];
  for (const o of items) {
    const v = unit(o.raDeg, o.decDeg);
    const p = sky.project(view, v);
    if (!p || p.x < -50 || p.y < -50 || p.x > view.width + 50 || p.y > view.height + 50) continue;
    const major = ((o.sizeMajorArcmin ?? 0) / 60) * pxPerDeg;
    const minor = ((o.sizeMinorArcmin ?? o.sizeMajorArcmin ?? 0) / 60) * pxPerDeg;
    // Unter dem Horizont blass und ohne Namen (außer dem gewählten Objekt).
    const below = observer !== null && altOf(observer.toHorizon, v) < 0 && o.id !== selectedId;
    ctx.globalAlpha = below ? 0.35 : 1;
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
    ctx.globalAlpha = 1;
    if (below) continue;
    const labelled =
      view.fovDeg <= 20 ||
      o.id === selectedId ||
      (o.mag !== null && o.mag < (view.fovDeg > 60 ? 5 : 7)) ||
      (view.fovDeg <= 60 && o.displayName.startsWith('M '));
    if (labelled)
      out.push({
        txt: o.displayName,
        x: p.x + Math.max(5, minor / 2),
        y: p.y - 6,
        selected: o.id === selectedId,
      });
  }
  return out;
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
  paintGround(ctx, view, obs, overlays, colors);
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

/** Richtung am Horizont (Azimut von Nord über Ost, Höhe) als J2000-Vektor. */
export function horizonVec(H: sky.Mat3, azDeg: number, altDeg: number): Vec {
  const a = azDeg * DEG;
  const h = altDeg * DEG;
  return sky.matVec(sky.transpose(H), [
    Math.sin(a) * Math.cos(h),
    Math.cos(a) * Math.cos(h),
    Math.sin(h),
  ]);
}

/** Höhe und Azimut (Grad, Nord über Ost) eines J2000-Vektors. */
export function toAltAz(H: sky.Mat3, v: Vec): { altDeg: number; azDeg: number } {
  const az = Math.atan2(sky.dot(H[0], v), sky.dot(H[1], v)) / DEG;
  return { altDeg: altOf(H, v), azDeg: (az + 360) % 360 };
}

/** Himmelsrichtungen knapp unter dem Horizont (Vorlage): Haupt-Richtungen kräftiger, Neben-Richtungen blasser. */
function compassLabels(
  view: sky.SkyView,
  obs: Observer,
  names: readonly string[],
  labels: Labels,
  colors: Colors,
) {
  for (let i = 0; i < 8; i += 1) {
    const p = sky.project(view, horizonVec(obs.toHorizon, i * 45, 0));
    const below = sky.project(view, horizonVec(obs.toHorizon, i * 45, -2));
    if (!p || !below) continue;
    const dx = below.x - p.x;
    const dy = below.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const x = p.x + (dx / len) * 15;
    const y = p.y + (dy / len) * 15;
    if (x < 8 || x > view.width - 8 || y < 8 || y > view.height - 8) continue;
    const main = i % 2 === 0;
    labels.put(
      names[i] ?? '',
      x,
      y,
      (main ? colors.compass : colors['compass-dim']) ?? '#8fd19e',
      main ? `600 12px ${FONT}` : `11px ${FONT}`,
      'center',
      true,
    );
  }
}

function drawBodies(
  ctx: CanvasRenderingContext2D,
  view: sky.SkyView,
  input: RenderInput,
  colors: Colors,
  labels: Labels,
  hits: HitIndex['bodies'][number][],
) {
  const b = input.bodies;
  if (!b) return;
  const pending: { txt: string; x: number; y: number }[] = [];
  const obs = input.observer;
  const disc = (id: BodyId, v: Vec, r: number, color: string, label: string) => {
    const p = sky.project(view, v);
    if (!p || p.x < -r || p.y < -r || p.x > view.width + r || p.y > view.height + r) return;
    // Unter dem Horizont nur blass und ohne Namen (der Boden deckt den Himmel dort ab).
    const below = obs !== null && input.overlays.has('horizon') && altOf(obs.toHorizon, v) < 0;
    ctx.globalAlpha = below ? 0.35 : 1;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
    ctx.fill();
    ctx.globalAlpha = 1;
    hits.push({ x: p.x, y: p.y, r, id });
    if (below) return;
    labels.block(p.x - r, p.y - r, p.x + r, p.y + r);
    pending.push({ txt: label, x: p.x + r + 4, y: p.y - r - 2 });
  };
  if (input.overlays.has('sun') && b.sun)
    disc('sun', b.sun, 7, colors.sun ?? '#f6c85f', input.sunLabel);
  if (input.overlays.has('moon') && b.moon)
    disc(
      'moon',
      b.moon.vec,
      6,
      colors.moon ?? '#e8ecf2',
      `${input.moonLabel} ${String(Math.round(b.moon.illumPct))} %`,
    );
  if (input.overlays.has('planets'))
    for (const p of b.planets)
      disc(
        p.id as BodyId,
        p.vec,
        Math.max(2, 4 - p.mag / 2),
        colors.planet ?? '#f7b267',
        input.planetNames[p.id] ?? p.id,
      );
  for (const l of pending)
    labels.put(l.txt, l.x, l.y, colors.label ?? '#ddd', `12px ${FONT}`, 'left', true);
}

/** Name eines Sternbilds nach Einstellung: Latein oder Landessprache (DE deutsch, EN englisch). */
export function constellationName(
  l: { de: string; latin: string; en: string },
  names: 'local' | 'latin',
  lang: 'de' | 'en',
): string {
  if (names === 'latin') return l.latin;
  return lang === 'en' ? l.en : l.de;
}

/** Polylinie wie `polyline`, merkt dazu sichtbare Ecken und Mitten mit dem Kürzel des Sternbilds. */
function constellationLine(
  ctx: CanvasRenderingContext2D,
  view: sky.SkyView,
  pts: readonly Vec[],
  abbr: string,
  verts: { x: number; y: number; abbr: string }[],
  up: ((v: Vec) => boolean) | null,
) {
  polyline(ctx, view, pts);
  let last: { x: number; y: number } | null = null;
  for (const v of pts) {
    const p = up && !up(v) ? null : sky.project(view, v);
    const on = p !== null && p.x >= 0 && p.y >= 0 && p.x <= view.width && p.y <= view.height;
    if (on) {
      verts.push({ x: p.x, y: p.y, abbr });
      if (last) verts.push({ x: (p.x + last.x) / 2, y: (p.y + last.y) / 2, abbr });
    }
    last = on ? p : null;
  }
}

/** Zeichnet alle Ebenen außer den Fotos (die kommen vorher aus `HipsLayer`); gibt die Trefferliste zurück. */
export function drawSky(
  ctx: CanvasRenderingContext2D,
  input: RenderInput,
  colors: Colors,
  drawPhotos: () => void,
): HitIndex {
  const { view, overlays, observer } = input;
  const hits = {
    verts: [] as { x: number; y: number; abbr: string }[],
    stars: [] as { x: number; y: number; i: number; mag: number }[],
    bodies: [] as HitIndex['bodies'][number][],
  };
  const labels = new Labels(ctx, view.width);
  const up = observer ? (v: Vec) => altOf(observer.toHorizon, v) > 0 : null;
  ctx.fillStyle = colors.bg ?? '#000';
  ctx.fillRect(0, 0, view.width, view.height);
  // Taghimmel: Grund aufhellen, solange die Sonne über −6° steht.
  const sunAlt = observer?.sunAltDeg ?? -90;
  if (overlays.has('daySky') && sunAlt > -6) {
    ctx.globalAlpha = Math.min(1, (sunAlt + 6) / 12);
    ctx.fillStyle = colors.day ?? '#5c8ed4';
    ctx.fillRect(0, 0, view.width, view.height);
    ctx.globalAlpha = 1;
  }
  drawPhotos();
  let mwSpot: { x: number; y: number } | null = null;
  if (overlays.has('milkyWay') && input.bright && (!input.photosShown || view.fovDeg > 40))
    mwSpot = paintMilkyWay(
      ctx,
      view,
      input.bright.milkyWay,
      colors['milky-way'] ?? 'rgba(205,215,255,0.3)',
      observer,
    );
  if (overlays.has('eqGrid')) {
    drawGrid(ctx, view, null, colors['grid-eq'] ?? '#468', 1.5);
    drawEqLabels(ctx, view, colors['grid-eq'] ?? '#468');
  }
  if (overlays.has('altAzGrid') && observer)
    drawGrid(ctx, view, observer.toHorizon, colors['grid-altaz'] ?? '#4a6');
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
      for (const b of input.bright.bounds) polyline(ctx, view, b.ring);
      ctx.setLineDash([]);
    }
    if (overlays.has('constLines')) {
      // Das überfahrene Sternbild zuletzt, kräftiger und heller (Vorlage).
      for (const pass of [false, true])
        for (const c of input.bright.lines) {
          if ((c.abbr === input.hoverCon) !== pass) continue;
          ctx.strokeStyle = pass
            ? (colors['const-line-hi'] ?? '#bed4ff')
            : (colors['const-line'] ?? '#678');
          ctx.lineWidth = pass ? 1.8 : 1;
          for (const part of c.parts) constellationLine(ctx, view, part, c.abbr, hits.verts, up);
        }
    }
    const limit = starLimitMag(view.fovDeg);
    drawStars(ctx, view, input.bright.stars, limit, colors.star ?? '#fff', hits.stars);
    if (input.faint && limit > 6) drawStars(ctx, view, input.faint, limit, colors.star ?? '#fff');
  }
  if (observer) drawObserver(ctx, view, observer, overlays, colors, input.zenithLabel);
  const dsoLabels = overlays.has('dso')
    ? drawDso(
        ctx,
        view,
        input.dso,
        overlays.has('dsoSizes'),
        input.selectedId,
        colors,
        overlays.has('horizon') ? observer : null,
      )
    : [];
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
  // Das gewählte Objekt: gestrichelter Ring (Vorlage: Karte offen = cyan).
  if (input.selectedVec) {
    const q = sky.project(view, input.selectedVec);
    if (q && q.x > -12 && q.y > -12 && q.x < view.width + 12 && q.y < view.height + 12) {
      ctx.strokeStyle = colors.selected ?? '#5ce1e6';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.arc(q.x, q.y, 11, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);
      labels.block(q.x - 11, q.y - 11, q.x + 11, q.y + 11);
    }
  }

  // Beschriftungen nach Vorrang (Vorlage): Himmelsrichtungen, überfahrenes Sternbild, Himmelskörper,
  // gewähltes Katalogobjekt, übrige Katalogobjekte, Sternnamen, Sternbildnamen, Milchstraße.
  if (observer && overlays.has('horizon'))
    compassLabels(view, observer, input.compassLabels, labels, colors);
  const placed = (input.bright?.labels ?? [])
    .map((l) => {
      if (up && !up(l.vec)) return null;
      const q = sky.project(view, l.vec);
      if (!q || q.x < 6 || q.y < 6 || q.x > view.width - 6 || q.y > view.height - 6) return null;
      hits.verts.push({ x: q.x, y: q.y, abbr: l.abbr });
      return { l, q };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  for (const { l, q } of placed)
    if (l.abbr === input.hoverCon)
      labels.put(
        constellationName(l, input.names, input.lang),
        q.x,
        q.y,
        colors['const-label-hi'] ?? '#e4e9ef',
        `600 12px ${FONT}`,
        'center',
        true,
      );
  drawBodies(ctx, view, input, colors, labels, hits.bodies);
  for (const d of dsoLabels.filter((x) => x.selected))
    labels.put(d.txt, d.x, d.y, colors['dso-label'] ?? '#aaa', `600 11px ${FONT}`, 'left', true);
  for (const d of dsoLabels.filter((x) => !x.selected))
    labels.put(d.txt, d.x, d.y, colors['dso-label'] ?? '#aaa', `11px ${FONT}`);
  if (input.bright && overlays.has('starNames'))
    starNameLabels(
      view,
      input.bright.stars,
      input.lang,
      labels,
      colors['star-label'] ?? '#ddd',
      overlays.has('horizon') ? up : null,
    );
  if (overlays.has('constLabels')) {
    // Vorlage: schmale Karten nur die bekanntesten, ab 560 px alle; beim Hineinzoomen alle.
    const gain = Math.max(0, Math.log2(150 / view.fovDeg));
    const maxRank = Math.min(
      3,
      (view.width < 440 ? 1 : view.width < 560 ? 2 : 3) + Math.floor(gain),
    );
    for (const { l, q } of placed)
      if (l.rank <= maxRank && l.abbr !== input.hoverCon)
        labels.put(
          constellationName(l, input.names, input.lang),
          q.x,
          q.y,
          colors['const-label'] ?? '#89a',
          `11px ${FONT}`,
          'center',
        );
  }
  if (mwSpot && input.milkyWayLabel)
    labels.put(
      input.milkyWayLabel,
      mwSpot.x,
      mwSpot.y,
      colors['const-label'] ?? '#89a',
      `italic 11px ${FONT}`,
      'center',
    );
  return hits;
}

/** Nächstes Sternbild (Ecke, Linienmitte oder Namenspunkt) im Umkreis von `radius` Pixeln (Vorlage: 24 px). */
export function hitConstellation(hits: HitIndex, x: number, y: number, radius = 24): string | null {
  let best: string | null = null;
  let bd = radius * radius;
  for (const p of hits.verts) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bd) {
      bd = d;
      best = p.abbr;
    }
  }
  return best;
}

/** Himmelskörper unter dem Zeiger (Scheibe + 10 px). */
export function hitBody(hits: HitIndex, x: number, y: number): BodyId | null {
  let best: BodyId | null = null;
  let bd = Infinity;
  for (const b of hits.bodies) {
    const d = (b.x - x) ** 2 + (b.y - y) ** 2;
    if (d < (b.r + 10) ** 2 && d < bd) {
      bd = d;
      best = b.id;
    }
  }
  return best;
}

/** Stern im Umkreis von 16 px; helle gewinnen – jede Größenklasse zählt wie 2 px näher (Vorlage). */
export function hitStar(hits: HitIndex, x: number, y: number): number | null {
  let best: number | null = null;
  let bs = Infinity;
  for (const p of hits.stars) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d > 16) continue;
    const score = d + 2 * p.mag;
    if (score < bs) {
      bs = score;
      best = p.i;
    }
  }
  return best;
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
