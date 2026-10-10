/**
 * `AllSkyMap` (components.md §2.26, AP-69, S-65): Ganzhimmelkarte in der flächentreuen Hammer-Projektion (Engine
 * `sky.hammerProject`), äquatorial, Nord oben, RA wächst nach links. Gradnetz (RA alle 2 h, Dec alle 30°), Milchstraße,
 * Sternbildlinien mit hellen Sternen, Sternbildgrenzen und Ekliptik (abschaltbar); Projekte als Bildfelder in echter
 * Größe (je Panel, an der Naht geteilt), zu kleine Felder zusätzlich als Punkt. Zoom (Rad, Zwei-Finger-Geste, Knöpfe),
 * Ziehen dreht in der Gesamtansicht den Himmel und verschiebt gezoomt. Farben nur aus `--npm-sky-*`.
 */
import { sky } from '@nina-pm/engine';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { loadBrightSky, type BrightSky } from '../../pages/planning/skymap/sky-data';
import {
  clampView,
  defaultCenterRa,
  dragView,
  hitShape,
  MARKER_RADIUS_PX,
  projectShape,
  toScreen,
  toScreenShapes,
  zoomAt,
  type MapView,
} from '../../pages/sessions/sky-model';
import styles from './AllSkyMap.module.css';

export const SKY_LAYERS = ['milkyWay', 'constellations', 'bounds', 'ecliptic'] as const;
export type SkyLayer = (typeof SKY_LAYERS)[number];

export interface AllSkyItem {
  readonly id: string;
  readonly raDeg: number;
  readonly decDeg: number;
  readonly rotationDeg: number;
  readonly fov: { readonly widthDeg: number; readonly heightDeg: number } | null;
  readonly panels: readonly { raDeg: number; decDeg: number; rotationDeg: number }[];
}

export interface AllSkyMapProps<T extends AllSkyItem> {
  readonly items: readonly T[];
  /** Füllfarbe (CSS-Farbe); `null` = nur Umriss (geplant, ohne Aufnahmen). */
  readonly colorOf: (item: T) => string | null;
  readonly layers: ReadonlySet<SkyLayer>;
  readonly highlight: string | null;
  readonly onHover: (id: string | null) => void;
  readonly onOpen: (id: string) => void;
  readonly tooltip: (item: T) => ReactNode;
  readonly label: string;
}

interface Pt {
  x: number;
  y: number;
}
const DEG = Math.PI / 180;
const OBLIQUITY = 23.4393;

function readSky(el: Element) {
  const cs = getComputedStyle(el);
  const v = (n: string) => cs.getPropertyValue(`--npm-sky-${n}`).trim() || '#888';
  return {
    bg: v('bg'),
    milky: v('milky-way'),
    grid: v('grid-eq'),
    ecliptic: v('ecliptic'),
    line: v('const-line'),
    star: v('star'),
    label: v('label'),
    planned: v('planned'),
    selected: v('selected'),
    frame: cs.getPropertyValue('--npm-chart-frame').trim() || '#10151c',
    axis: cs.getPropertyValue('--npm-chart-axis').trim() || '#9aa7b6',
  };
}

const vecToPos = (v: readonly number[]): sky.SkyPos => ({
  raDeg: (((Math.atan2(v[1] ?? 0, v[0] ?? 0) / DEG) % 360) + 360) % 360,
  decDeg: Math.asin(Math.max(-1, Math.min(1, v[2] ?? 0))) / DEG,
});

export function AllSkyMap<T extends AllSkyItem>(props: AllSkyMapProps<T>) {
  const { items, colorOf, layers, highlight, onHover, onOpen, tooltip, label } = props;
  const { t } = useTranslation();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<Omit<MapView, 'width' | 'height'>>({
    zoom: 1,
    panX: 0,
    panY: 0,
    centerRa: defaultCenterRa(items),
  });
  const [data, setData] = useState<BrightSky | null>(null);
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  const centered = useRef(items.length > 0);

  // Kartenmitte einmal nach den ersten Projekten setzen (Naht abseits der Felder).
  useEffect(() => {
    if (centered.current || items.length === 0) return;
    centered.current = true;
    setView((v) => ({ ...v, centerRa: defaultCenterRa(items) }));
  }, [items]);

  useEffect(() => {
    let alive = true;
    loadBrightSky()
      .then((d) => alive && setData(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const width = Math.round(el.clientWidth);
      // Hammer-Ellipse 2 : 1 plus Rand; nie höher als drei Viertel des Fensters.
      const height = Math.round(Math.min(width / 2 + 24, window.innerHeight * 0.75));
      setSize({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const full: MapView = useMemo(
    () => clampView({ ...view, width: size.width, height: size.height }),
    [view, size],
  );
  const shapes = useMemo(
    () =>
      toScreenShapes(
        full,
        items.map((p) => projectShape(p, full.centerRa)),
      ),
    [items, full],
  );
  const byId = useMemo(() => new Map(items.map((p) => [p.id, p])), [items]);

  // Zeichnen.
  useEffect(() => {
    const cv = canvas.current;
    if (!cv || full.width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(full.width * dpr);
    cv.height = Math.round(full.height * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = readSky(cv);
    const scr = (p: sky.AllSkyPoint) => toScreen(full, p);
    const path = (pts: readonly Pt[], close = false) => {
      if (pts.length === 0) return;
      ctx.moveTo((pts[0] as Pt).x, (pts[0] as Pt).y);
      for (const p of pts) ctx.lineTo(p.x, p.y);
      if (close) ctx.closePath();
    };
    const line = (pos: readonly sky.SkyPos[]) => {
      for (const part of sky.splitPolylineAtSeam(pos, full.centerRa)) path(part.map(scr));
    };

    ctx.clearRect(0, 0, full.width, full.height);
    ctx.fillStyle = c.frame;
    ctx.fillRect(0, 0, full.width, full.height);
    // Ellipse als Rand und Maske.
    const rim: Pt[] = [];
    for (let k = 0; k <= 180; k += 1)
      rim.push(scr(sky.hammerProject(full.centerRa + 180 - 1e-9, 90 - k, full.centerRa)));
    for (let k = 0; k <= 180; k += 1)
      rim.push(scr(sky.hammerProject(full.centerRa + 180 + 1e-9, -90 + k, full.centerRa)));
    ctx.save();
    ctx.beginPath();
    path(rim, true);
    ctx.fillStyle = c.bg;
    ctx.fill();
    ctx.clip();

    const s = toScreen(full, { x: 1, y: 0 }).x - toScreen(full, { x: 0, y: 0 }).x;
    if (data && layers.has('milkyWay')) {
      const mw = data.milkyWay;
      const px = Math.max(1.5, ((mw.step * DEG * s) / Math.SQRT2) * 1.25);
      ctx.fillStyle = c.milky;
      for (let r = 0; r < mw.h; r += 1)
        for (let q = 0; q < mw.w; q += 1) {
          const level = mw.cells[r * mw.w + q] ?? 0;
          if (level === 0) continue;
          const p = scr(
            sky.hammerProject((q + 0.5) * mw.step, 90 - (r + 0.5) * mw.step, full.centerRa),
          );
          if (p.x < -px || p.y < -px || p.x > full.width + px || p.y > full.height + px) continue;
          // Zurückhaltender als in der Sternkarte: die Felder sollen vorn stehen.
          ctx.globalAlpha = level / 8;
          ctx.fillRect(p.x - px / 2, p.y - px / 2, px, px);
        }
      ctx.globalAlpha = 1;
    }

    // Gradnetz: Deklination alle 30°, RA alle 2 h.
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let dec = -60; dec <= 60; dec += 30)
      line(Array.from({ length: 181 }, (_, k) => ({ raDeg: k * 2, decDeg: dec })));
    for (let ra = 0; ra < 360; ra += 30)
      line(Array.from({ length: 91 }, (_, k) => ({ raDeg: ra, decDeg: -90 + k * 2 })));
    ctx.stroke();

    if (layers.has('ecliptic')) {
      ctx.strokeStyle = c.ecliptic;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      line(
        Array.from({ length: 181 }, (_, k) => {
          const l = k * 2 * DEG;
          const e = OBLIQUITY * DEG;
          return {
            raDeg: (((Math.atan2(Math.sin(l) * Math.cos(e), Math.cos(l)) / DEG) % 360) + 360) % 360,
            decDeg: Math.asin(Math.sin(e) * Math.sin(l)) / DEG,
          };
        }),
      );
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (data && layers.has('bounds')) {
      ctx.strokeStyle = c.line;
      ctx.globalAlpha = 0.45;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      for (const b of data.bounds)
        line([...b.ring.map(vecToPos), vecToPos(b.ring[0] ?? [1, 0, 0])]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    if (data && layers.has('constellations')) {
      ctx.strokeStyle = c.line;
      ctx.beginPath();
      for (const l of data.lines) for (const part of l.parts) line(part.map(vecToPos));
      ctx.stroke();
      ctx.fillStyle = c.star;
      const st = data.stars;
      for (let i = 0; i < st.count; i += 1) {
        const mag = st.mag[i] ?? 9;
        if (mag > 4.5) continue;
        const pos = vecToPos([st.vec[3 * i] ?? 0, st.vec[3 * i + 1] ?? 0, st.vec[3 * i + 2] ?? 0]);
        const p = scr(sky.hammerProject(pos.raDeg, pos.decDeg, full.centerRa));
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.6, 2.4 - mag * 0.4), 0, 2 * Math.PI);
        ctx.fill();
      }
    }

    // Projekte: große zuerst, damit kleine darüber liegen.
    const ordered = [...shapes].sort((a, b) => b.area - a.area);
    for (const sh of ordered) {
      const item = byId.get(sh.id);
      if (!item) continue;
      const color = colorOf(item);
      const hot = sh.id === highlight;
      ctx.lineWidth = hot ? 2.5 : 1.2;
      for (const ring of sh.rings) {
        ctx.beginPath();
        path(ring, true);
        if (color) {
          ctx.globalAlpha = 0.78;
          ctx.fillStyle = color;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = hot ? c.selected : color;
        } else {
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = hot ? c.selected : c.planned;
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (sh.marker) {
        ctx.beginPath();
        ctx.arc(sh.center.x, sh.center.y, MARKER_RADIUS_PX, 0, 2 * Math.PI);
        if (color) {
          ctx.fillStyle = color;
          ctx.fill();
        }
        ctx.strokeStyle = hot ? c.selected : (color ?? c.planned);
        ctx.lineWidth = hot ? 2.5 : 1.2;
        ctx.stroke();
      }
    }
    ctx.restore();

    // Rand und Beschriftung (RA am Äquator, Dec am Mittelmeridian).
    ctx.strokeStyle = c.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    path(rim, true);
    ctx.stroke();
    ctx.fillStyle = c.label;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (let h = 0; h < 24; h += 2) {
      const p = scr(sky.hammerProject(h * 15, 0, full.centerRa));
      if (p.x < 12 || p.x > full.width - 12) continue;
      ctx.fillText(`${String(h)}h`, p.x, p.y + 13);
    }
    ctx.textAlign = 'left';
    for (const dec of [-60, -30, 30, 60]) {
      const p = scr(sky.hammerProject(full.centerRa, dec, full.centerRa));
      ctx.fillText(`${dec > 0 ? '+' : ''}${String(dec)}°`, p.x + 4, p.y - 3);
    }
  }, [full, shapes, data, layers, colorOf, highlight, byId]);

  // Zeiger: Ziehen, Klick, Überfahren; zwei Finger zoomen.
  const pointers = useRef(new Map<number, Pt>());
  const moved = useRef(0);
  const pinch = useRef<number | null>(null);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  const hover = (p: Pt) => {
    const id = hitShape(shapes, p.x, p.y);
    setTip(id ? { id, ...p } : null);
    onHover(id);
  };

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      setView((v) => {
        const z = zoomAt(
          { ...v, width: size.width, height: size.height },
          Math.exp(-e.deltaY * 0.0015),
          p.x,
          p.y,
        );
        return { zoom: z.zoom, panX: z.panX, panY: z.panY, centerRa: z.centerRa };
      });
    };
    cv.addEventListener('wheel', onWheel, { passive: false });
    return () => cv.removeEventListener('wheel', onWheel);
  }, [size]);

  const zoomBy = (f: number) =>
    setView((v) => {
      const z = zoomAt(
        { ...v, width: size.width, height: size.height },
        f,
        size.width / 2,
        size.height / 2,
      );
      return { zoom: z.zoom, panX: z.panX, panY: z.panY, centerRa: z.centerRa };
    });

  const item = tip ? byId.get(tip.id) : undefined;
  return (
    <div ref={wrap} className={styles.wrap} style={{ height: size.height || undefined }}>
      <canvas
        ref={canvas}
        className={styles.canvas}
        style={{ width: size.width, height: size.height }}
        role="img"
        aria-label={label}
        data-testid="all-sky-map"
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          pointers.current.set(e.pointerId, local(e));
          moved.current = 0;
          pinch.current = null;
        }}
        onPointerMove={(e) => {
          const p = local(e);
          const prev = pointers.current.get(e.pointerId);
          if (!prev) {
            hover(p);
            return;
          }
          pointers.current.set(e.pointerId, p);
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()] as [Pt, Pt];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (pinch.current !== null && d > 0) {
              const f = d / pinch.current;
              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2;
              setView((v) => {
                const z = zoomAt({ ...v, width: size.width, height: size.height }, f, mx, my);
                return { zoom: z.zoom, panX: z.panX, panY: z.panY, centerRa: z.centerRa };
              });
            }
            pinch.current = d;
            moved.current += 10;
            return;
          }
          const dx = p.x - prev.x;
          const dy = p.y - prev.y;
          moved.current += Math.abs(dx) + Math.abs(dy);
          setView((v) => {
            const d = dragView({ ...v, width: size.width, height: size.height }, dx, dy);
            return { zoom: d.zoom, panX: d.panX, panY: d.panY, centerRa: d.centerRa };
          });
          setTip(null);
        }}
        onPointerUp={(e) => {
          const p = local(e);
          pointers.current.delete(e.pointerId);
          if (moved.current < 5) {
            const id = hitShape(shapes, p.x, p.y);
            if (id) onOpen(id);
          }
        }}
        onPointerLeave={() => {
          if (pointers.current.size === 0) {
            setTip(null);
            onHover(null);
          }
        }}
      />
      <div className={styles.controls}>
        <button type="button" onClick={() => zoomBy(1.6)} aria-label={t('evaluation.sky.zoomIn')}>
          +
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1 / 1.6)}
          aria-label={t('evaluation.sky.zoomOut')}
        >
          −
        </button>
        <button
          type="button"
          onClick={() => setView({ zoom: 1, panX: 0, panY: 0, centerRa: defaultCenterRa(items) })}
          aria-label={t('evaluation.sky.reset')}
          title={t('evaluation.sky.reset')}
        >
          ⟲
        </button>
      </div>
      {item && tip ? (
        <div
          className={styles.tooltip}
          role="tooltip"
          style={{
            left: Math.min(tip.x + 14, size.width - 260),
            top: Math.min(tip.y + 14, size.height - 120),
          }}
        >
          {tooltip(item)}
        </div>
      ) : null}
    </div>
  );
}
