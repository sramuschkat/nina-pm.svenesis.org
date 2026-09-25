/**
 * Himmelsfotos als HiPS-Kacheln (FA-FRM-03), portiert aus `legacy/astro-tools-2026-09-21/js/sky-map.js`
 * (photoTile, photoAllsky, photoTri, drawPhotos): Kachelordnung nach Bildschirmauflösung, Kacheln über eine
 * 32-px-Abtastung des Bilds gesucht, fehlende Kacheln durch die nächstgröbere bzw. `Allsky` ersetzt; jede
 * Kachel in ein kleines Raster geteilt, dessen Ecken durch die Projektion laufen, und als affin abgebildete
 * Dreiecke gezeichnet. Kacheln ohne Referrer (die Koordinaten im Pfad gehen nicht an CDS weiter).
 */
import { sky } from '@nina-pm/engine';
import { SURVEYS, type SurveyId } from './surveys';

interface Tile {
  readonly img: HTMLImageElement;
  ok: boolean;
  bad: boolean;
  used: number;
}

const MAX_TILES = 400;
const KEEP_TILES = 300;

export class HipsLayer {
  private readonly cache = new Map<string, Tile>();
  private readonly allsky = new Map<string, { img: HTMLImageElement; ok: boolean; cell: number }>();

  constructor(private readonly onLoad: () => void) {}

  private tile(surveyId: SurveyId, order: number, ipix: number): Tile {
    const sv = SURVEYS[surveyId];
    const key = `${sv.url}${String(order)}/${String(ipix)}`;
    let t = this.cache.get(key);
    if (!t) {
      const img = new Image();
      const tile: Tile = { img, ok: false, bad: false, used: 0 };
      img.referrerPolicy = 'no-referrer';
      img.decoding = 'async';
      img.onload = () => {
        tile.ok = true;
        this.onLoad();
      };
      img.onerror = () => {
        tile.bad = true;
      };
      img.src = `${sv.url}${sky.hipsTilePath(order, ipix)}.${sv.ext}`;
      this.cache.set(key, tile);
      t = tile;
      if (this.cache.size > MAX_TILES) this.prune();
    }
    t.used = performance.now();
    return t;
  }

  private cached(surveyId: SurveyId, order: number, ipix: number): Tile | undefined {
    return this.cache.get(`${SURVEYS[surveyId].url}${String(order)}/${String(ipix)}`);
  }

  private allskyOf(surveyId: SurveyId) {
    const sv = SURVEYS[surveyId];
    let a = this.allsky.get(sv.url);
    if (!a) {
      const img = new Image();
      const entry = { img, ok: false, cell: 64 };
      img.referrerPolicy = 'no-referrer';
      img.onload = () => {
        entry.ok = true;
        entry.cell = img.naturalWidth / 27;
        this.onLoad();
      };
      img.src = `${sv.url}Norder3/Allsky.${sv.ext}`;
      this.allsky.set(sv.url, entry);
      a = entry;
    }
    return a;
  }

  private prune() {
    const keys = [...this.cache.entries()].sort((a, b) => a[1].used - b[1].used).map(([k]) => k);
    for (const k of keys.slice(0, keys.length - KEEP_TILES)) this.cache.delete(k);
  }

  /** Zeichnet die Fotos der Durchmusterung; liefert gezeigte und noch ladende Kacheln. */
  draw(
    ctx: CanvasRenderingContext2D,
    view: sky.SkyView,
    surveyId: SurveyId,
    dpr: number,
    alpha: number,
  ): { shown: number; pending: number } {
    const sv = SURVEYS[surveyId];
    const W = view.width;
    const H = view.height;
    const degPx = view.fovDeg / (W * dpr);
    const order = sky.hipsOrderFor(degPx, sv.maxOrder);
    const nside = 1 << order;
    const need = new Set<number>();
    const list: number[] = [];
    for (let sy = 0; sy <= H + 31; sy += 32) {
      for (let sx = 0; sx <= W + 31; sx += 32) {
        const v = sky.unproject(view, Math.min(sx, W - 1), Math.min(sy, H - 1));
        const ra = (Math.atan2(v[1], v[0]) * 180) / Math.PI;
        const dec = (Math.asin(Math.max(-1, Math.min(1, v[2]))) * 180) / Math.PI;
        const pix = sky.hpxPix(order, ra < 0 ? ra + 360 : ra, dec);
        if (!need.has(pix)) {
          need.add(pix);
          list.push(pix);
        }
      }
    }
    let shown = 0;
    let pending = 0;
    const grid = order <= 4 ? 8 : order <= 6 ? 4 : 2;
    const sky3 = this.allskyOf(surveyId);
    ctx.save();
    ctx.globalAlpha = alpha;
    for (const pix of list) {
      const t = this.tile(surveyId, order, pix);
      let src: { img: HTMLImageElement; ox: number; oy: number; size: number } | null = null;
      let so = order;
      let sp = pix;
      if (t.ok) src = { img: t.img, ox: 0, oy: 0, size: t.img.naturalWidth || 512 };
      else {
        if (!t.bad) pending += 1;
        for (so = order - 1, sp = Math.floor(pix / 4); so >= 3; so -= 1, sp = Math.floor(sp / 4)) {
          const c = this.cached(surveyId, so, sp);
          if (c?.ok) {
            src = { img: c.img, ox: 0, oy: 0, size: c.img.naturalWidth || 512 };
            break;
          }
        }
        if (!src && sky3.ok) {
          so = 3;
          sp = Math.floor(pix / 4 ** (order - 3));
          src = {
            img: sky3.img,
            ox: (sp % 27) * sky3.cell,
            oy: Math.floor(sp / 27) * sky3.cell,
            size: sky3.cell,
          };
        }
      }
      if (!src) continue;
      const f = sky.hpxXyf(order, pix);
      const fs = sky.hpxXyf(so, sp);
      const ns = 1 << so;
      const pts: ({ x: number; y: number; u: number; v: number } | null)[] = [];
      for (let a = 0; a <= grid; a += 1) {
        for (let b = 0; b <= grid; b += 1) {
          const X = (f.ix + a / grid) / nside;
          const Y = (f.iy + b / grid) / nside;
          const loc = sky.hpxLoc(f.face, X, Y);
          const q = sky.project(view, sky.radecToVec(loc.raDeg, loc.decDeg));
          // In einer Kachel laufen die Spalten längs der Flächenkoordinate y, die Zeilen längs x (wie Aladin).
          pts.push(
            q
              ? {
                  x: q.x,
                  y: q.y,
                  u: (Y * ns - fs.iy) * src.size + src.ox,
                  v: (X * ns - fs.ix) * src.size + src.oy,
                }
              : null,
          );
        }
      }
      for (let ga = 0; ga < grid; ga += 1) {
        for (let gb = 0; gb < grid; gb += 1) {
          const p00 = pts[ga * (grid + 1) + gb];
          const p01 = pts[ga * (grid + 1) + gb + 1];
          const p10 = pts[(ga + 1) * (grid + 1) + gb];
          const p11 = pts[(ga + 1) * (grid + 1) + gb + 1];
          if (!p00 || !p01 || !p10 || !p11) continue;
          const minX = Math.min(p00.x, p01.x, p10.x, p11.x);
          const maxX = Math.max(p00.x, p01.x, p10.x, p11.x);
          const minY = Math.min(p00.y, p01.y, p10.y, p11.y);
          const maxY = Math.max(p00.y, p01.y, p10.y, p11.y);
          // außerhalb des Bilds oder hinter dem Betrachter zerrissen
          if (
            maxX < 0 ||
            minX > W ||
            maxY < 0 ||
            minY > H ||
            maxX - minX > W * 2 ||
            maxY - minY > H * 2
          )
            continue;
          const box = [src.ox, src.oy, src.ox + src.size, src.oy + src.size] as const;
          tri(ctx, src.img, p00, p10, p11, box);
          tri(ctx, src.img, p00, p11, p01, box);
        }
      }
      shown += 1;
    }
    ctx.restore();
    return { shown, pending };
  }
}

interface P {
  x: number;
  y: number;
  u: number;
  v: number;
}

/**
 * Ein Dreieck der Kachel affin auf den Bildschirm: Abbildung aus drei Bild- auf drei Bildschirmpunkte,
 * geklippt auf das um einen halben Pixel vergrößerte Dreieck, damit Nachbarn ohne Haarlinien anschließen.
 */
function tri(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  p0: P,
  p1: P,
  p2: P,
  [bx0, by0, bx1, by1]: readonly [number, number, number, number],
) {
  const du1 = p1.u - p0.u;
  const dv1 = p1.v - p0.v;
  const du2 = p2.u - p0.u;
  const dv2 = p2.v - p0.v;
  const det = du1 * dv2 - du2 * dv1;
  if (Math.abs(det) < 1e-9) return;
  const a = ((p1.x - p0.x) * dv2 - (p2.x - p0.x) * dv1) / det;
  const c = (du1 * (p2.x - p0.x) - du2 * (p1.x - p0.x)) / det;
  const b = ((p1.y - p0.y) * dv2 - (p2.y - p0.y) * dv1) / det;
  const d = (du1 * (p2.y - p0.y) - du2 * (p1.y - p0.y)) / det;
  const mx = (p0.x + p1.x + p2.x) / 3;
  const my = (p0.y + p1.y + p2.y) / 3;
  const grow = (p: P) => {
    const dx = p.x - mx;
    const dy = p.y - my;
    const l = Math.sqrt(dx * dx + dy * dy) || 1;
    return [p.x + (dx / l) * 0.6, p.y + (dy / l) * 0.6] as const;
  };
  const g0 = grow(p0);
  const g1 = grow(p1);
  const g2 = grow(p2);
  const su = Math.max(bx0, Math.floor(Math.min(p0.u, p1.u, p2.u)) - 1);
  const sv = Math.max(by0, Math.floor(Math.min(p0.v, p1.v, p2.v)) - 1);
  const eu = Math.min(bx1, Math.ceil(Math.max(p0.u, p1.u, p2.u)) + 1);
  const ev = Math.min(by1, Math.ceil(Math.max(p0.v, p1.v, p2.v)) + 1);
  if (eu <= su || ev <= sv) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(g0[0], g0[1]);
  ctx.lineTo(g1[0], g1[1]);
  ctx.lineTo(g2[0], g2[1]);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, p0.x - a * p0.u - c * p0.v, p0.y - b * p0.u - d * p0.v);
  ctx.drawImage(img, su, sv, eu - su, ev - sv, su, sv, eu - su, ev - sv);
  ctx.restore();
}
