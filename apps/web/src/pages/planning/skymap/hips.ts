/**
 * Himmelsfotos als HiPS-Kacheln (FA-FRM-03), portiert aus `legacy/astro-tools-2026-09-21/js/sky-map.js`
 * (photoTile, photoAllsky, photoTri, drawPhotos): Kachelordnung nach Bildschirmauflösung, Kacheln über eine
 * 32-px-Abtastung des Bilds gesucht, fehlende Kacheln durch die nächstgröbere bzw. `Allsky` ersetzt; jede
 * Kachel in ein kleines Raster geteilt, dessen Ecken durch die Projektion laufen. Kacheln ohne Referrer (die
 * Koordinaten im Pfad gehen nicht an CDS weiter).
 *
 * Safari (Wunsch Sven 02.10.2026, Sternkarte mit Fotos starr): Die Vorlage zeichnete jede Rasterzelle als zwei
 * Dreiecke mit `clip()` – rund 6.000 geclippte `drawImage` je Bild; WebKit rastert das auf der CPU (gemessen mit
 * Playwright-WebKit 26.6: 734 ms je Bild bei 40°, 914 ms bei 90°; Chrome 33 ms). Jetzt: Kacheln einmal als
 * `ImageBitmap` dekodiert, je Zelle **ein** `drawImage` ohne Clip mit dem Mittel der beiden Dreiecks-Abbildungen
 * und etwa einem Bildschirmpixel Überlappung, Raster nach einem Budget von rund 600 Zellen je Bild
 * (WebKit 33 ms bei 10°/40°/90°, Abweichung zum geclippten Bild ≤ 0,05 % der Pixel).
 */
import { sky } from '@nina-pm/engine';
import { SURVEYS, type SurveyId } from './surveys';

/** Bildquelle einer Kachel: vorab dekodiert (`ImageBitmap`), sonst das Bild selbst. */
type Source = HTMLImageElement | ImageBitmap;

interface Tile {
  readonly img: HTMLImageElement;
  bmp: ImageBitmap | null;
  ok: boolean;
  bad: boolean;
  used: number;
}

const MAX_TILES = 400;
const KEEP_TILES = 300;
/** Rasterzellen je Bild (Safari): mehr kostet in WebKit spürbar, weniger zeigt Knicke bei weiten Feldern. */
const CELL_BUDGET = 600;

/** `ImageBitmap` aus einem geladenen Bild; ohne Unterstützung (ältere Browser, Tests) `null`. */
function decode(img: HTMLImageElement): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== 'function') return Promise.resolve(null);
  return createImageBitmap(img).catch(() => null);
}

export class HipsLayer {
  private readonly cache = new Map<string, Tile>();
  private readonly allsky = new Map<
    string,
    { img: HTMLImageElement; bmp: ImageBitmap | null; ok: boolean; cell: number }
  >();

  constructor(private readonly onLoad: () => void) {}

  private tile(surveyId: SurveyId, order: number, ipix: number): Tile {
    const sv = SURVEYS[surveyId];
    const key = `${sv.url}${String(order)}/${String(ipix)}`;
    let t = this.cache.get(key);
    if (!t) {
      const img = new Image();
      const tile: Tile = { img, bmp: null, ok: false, bad: false, used: 0 };
      img.referrerPolicy = 'no-referrer';
      img.decoding = 'async';
      img.onload = () => {
        void decode(img).then((bmp) => {
          tile.bmp = bmp;
          tile.ok = true;
          this.onLoad();
        });
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
      const entry = { img, bmp: null as ImageBitmap | null, ok: false, cell: 64 };
      img.referrerPolicy = 'no-referrer';
      img.onload = () => {
        void decode(img).then((bmp) => {
          entry.bmp = bmp;
          entry.ok = true;
          entry.cell = img.naturalWidth / 27;
          this.onLoad();
        });
      };
      img.src = `${sv.url}Norder3/Allsky.${sv.ext}`;
      this.allsky.set(sv.url, entry);
      a = entry;
    }
    return a;
  }

  private prune() {
    const keys = [...this.cache.entries()].sort((a, b) => a[1].used - b[1].used).map(([k]) => k);
    for (const k of keys.slice(0, keys.length - KEEP_TILES)) {
      this.cache.get(k)?.bmp?.close();
      this.cache.delete(k);
    }
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
    // Raster je Kachel wie die Vorlage (8/4/2), bei vielen Kacheln gröber (Budget, Safari).
    const grid = Math.max(
      1,
      Math.min(
        order <= 4 ? 8 : order <= 6 ? 4 : 2,
        Math.floor(Math.sqrt(CELL_BUDGET / Math.max(1, list.length))),
      ),
    );
    const base = baseTransform(ctx);
    const sky3 = this.allskyOf(surveyId);
    ctx.save();
    ctx.globalAlpha = alpha;
    for (const pix of list) {
      const t = this.tile(surveyId, order, pix);
      let src: { img: Source; ox: number; oy: number; size: number } | null = null;
      let so = order;
      let sp = pix;
      if (t.ok) src = { img: t.bmp ?? t.img, ox: 0, oy: 0, size: t.img.naturalWidth || 512 };
      else {
        if (!t.bad) pending += 1;
        for (so = order - 1, sp = Math.floor(pix / 4); so >= 3; so -= 1, sp = Math.floor(sp / 4)) {
          const c = this.cached(surveyId, so, sp);
          if (c?.ok) {
            src = { img: c.bmp ?? c.img, ox: 0, oy: 0, size: c.img.naturalWidth || 512 };
            break;
          }
        }
        if (!src && sky3.ok) {
          so = 3;
          sp = Math.floor(pix / 4 ** (order - 3));
          src = {
            img: sky3.bmp ?? sky3.img,
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
          cell(ctx, base, src.img, p00, p10, p01, p11, box);
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

type Affine = [number, number, number, number, number, number];

/** Aktuelle Transformation der Zeichenfläche (Geräte-Pixel-Faktor); ohne `getTransform` die Einheit. */
function baseTransform(ctx: CanvasRenderingContext2D): Affine {
  if (typeof ctx.getTransform !== 'function') return [1, 0, 0, 1, 0, 0];
  const m = ctx.getTransform();
  return [m.a, m.b, m.c, m.d, m.e, m.f];
}

/** Affine Abbildung Bild (u, v) → Bildschirm (x, y) aus drei Punkten; `null` bei entarteten Punkten. */
function affine(p0: P, p1: P, p2: P): Affine | null {
  const du1 = p1.u - p0.u;
  const dv1 = p1.v - p0.v;
  const du2 = p2.u - p0.u;
  const dv2 = p2.v - p0.v;
  const det = du1 * dv2 - du2 * dv1;
  if (Math.abs(det) < 1e-9) return null;
  const a = ((p1.x - p0.x) * dv2 - (p2.x - p0.x) * dv1) / det;
  const c = (du1 * (p2.x - p0.x) - du2 * (p1.x - p0.x)) / det;
  const b = ((p1.y - p0.y) * dv2 - (p2.y - p0.y) * dv1) / det;
  const d = (du1 * (p2.y - p0.y) - du2 * (p1.y - p0.y)) / det;
  return [a, b, c, d, p0.x - a * p0.u - c * p0.v, p0.y - b * p0.u - d * p0.v];
}

/**
 * Abbildung einer Rasterzelle (Ecken p00, p10, p01, p11) ohne Clip: Mittel der Abbildungen der beiden Dreiecke –
 * der Fehler an den Ecken halbiert sich – und ein Rand von etwa einem Bildschirmpixel (in Bildpunkten), damit
 * Nachbarzellen ohne Fugen überlappen. Für Tests exportiert.
 */
export function cellTransform(
  p00: P,
  p10: P,
  p01: P,
  p11: P,
): { m: Affine; marginTexel: number } | null {
  const t1 = affine(p00, p10, p01);
  const t2 = affine(p11, p01, p10);
  if (!t1 || !t2) return null;
  const m = t1.map((v, i) => (v + (t2[i] as number)) / 2) as Affine;
  const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  return { m, marginTexel: 1.2 / scale };
}

/** Eine Rasterzelle: ein `drawImage` mit der Zellabbildung auf der Grundtransformation (Geräte-Pixel). */
function cell(
  ctx: CanvasRenderingContext2D,
  base: Affine,
  img: Source,
  p00: P,
  p10: P,
  p01: P,
  p11: P,
  [bx0, by0, bx1, by1]: readonly [number, number, number, number],
) {
  const t = cellTransform(p00, p10, p01, p11);
  if (!t) return;
  const [a, b, c, d, e, f] = t.m;
  const k = t.marginTexel;
  const su = Math.max(bx0, Math.min(p00.u, p10.u, p01.u, p11.u) - k);
  const sv = Math.max(by0, Math.min(p00.v, p10.v, p01.v, p11.v) - k);
  const eu = Math.min(bx1, Math.max(p00.u, p10.u, p01.u, p11.u) + k);
  const ev = Math.min(by1, Math.max(p00.v, p10.v, p01.v, p11.v) + k);
  if (eu <= su || ev <= sv) return;
  const [A, B, C, D, E, F] = base;
  ctx.setTransform(
    A * a + C * b,
    B * a + D * b,
    A * c + C * d,
    B * c + D * d,
    A * e + C * f + E,
    B * e + D * f + F,
  );
  ctx.drawImage(img, su, sv, eu - su, ev - sv, su, sv, eu - su, ev - sv);
}
