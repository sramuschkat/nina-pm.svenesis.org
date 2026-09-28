/**
 * Zeichenfläche der Sternkarte (S-20): Canvas mit `devicePixelRatio`, `ResizeObserver` und Neuzeichnen
 * höchstens einmal je Frame. Bedienung (FA-FRM-04): Ziehen im Bildfeld verschiebt das Bildfeld (Koordinaten
 * folgen), Ziehen daneben die Ansicht, Mausrad bzw. `+`/`−` zoomen, Doppelklick zoomt hinein (mit Umschalt
 * heraus), Pfeiltasten schwenken, Klick wählt ein Objekt. Wie in der Vorlage (`sky-map.js`) hebt das
 * Überfahren das nächste Sternbild hervor und nennt es samt Stern oben links; ein Tipp ins Leere tut dasselbe
 * auf Touch-Geräten. Der Fokuswert (Blickmitte, Sichtfeld) steht per `aria-live` als Text daneben.
 */
import { sky } from '@nina-pm/engine';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { HipsLayer } from './hips';
import { FOV_MAX, FOV_MIN } from './model';
import {
  EMPTY_HITS,
  constellationName,
  drawSky,
  hitConstellation,
  hitFrame,
  hitStar,
  readColors,
  type FrameSpec,
  type HitIndex,
  type RenderInput,
} from './render';
import type { SurveyId } from './surveys';
import styles from './skymap.module.css';

export interface SkyCanvasProps {
  /** Alles außer der Ansicht, die die Zeichenfläche aus Größe, Blickmitte und Sichtfeld bildet. */
  readonly input: Omit<RenderInput, 'view' | 'photosShown' | 'hoverCon'>;
  readonly center: sky.Vec3;
  readonly up: sky.Vec3;
  readonly fovDeg: number;
  readonly survey: SurveyId | null;
  readonly photoAlpha: number;
  readonly label: string;
  readonly description: string;
  readonly onView: (center: sky.Vec3, fovDeg: number) => void;
  readonly onFrameMove: (center: sky.Vec3) => void;
  readonly onPick: (x: number, y: number, view: sky.SkyView, hits: HitIndex) => void;
  readonly onPhotoStatus?: (status: { shown: number; pending: number }) => void;
}

interface Drag {
  readonly mode: 'pan' | 'frame';
  readonly startX: number;
  readonly startY: number;
  readonly view: sky.SkyView;
  /** Bildschirmversatz Bildfeldmitte − Griffpunkt (nur `frame`). */
  readonly offX: number;
  readonly offY: number;
  moved: boolean;
}

const clampFov = (f: number) => Math.min(FOV_MAX, Math.max(FOV_MIN, f));

export function SkyCanvas(props: SkyCanvasProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [tick, setTick] = useState(0);
  const drag = useRef<Drag | null>(null);
  const hips = useRef<HipsLayer | null>(null);
  const frameRequest = useRef<number | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const hits = useRef<HitIndex>(EMPTY_HITS);
  /** Überfahrenes Sternbild und überfahrener Stern (Index in `bright.stars`). */
  const [hover, setHover] = useState<{ con: string | null; star: number | null } | null>(null);

  // Nachladende Kacheln lösen ein Neuzeichnen aus – höchstens eines je Frame.
  if (!hips.current)
    hips.current = new HipsLayer(() => {
      if (frameRequest.current !== null) return;
      frameRequest.current = requestAnimationFrame(() => {
        frameRequest.current = null;
        setTick((n) => n + 1);
      });
    });

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSize({ w: Math.floor(entry.contentRect.width), h: Math.floor(entry.contentRect.height) });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (frameRequest.current !== null) cancelAnimationFrame(frameRequest.current);
    };
  }, []);

  const view =
    size.w > 0 && size.h > 0
      ? sky.makeView(props.center, props.up, props.fovDeg, size.w, size.h)
      : null;

  useEffect(() => {
    const c = canvas.current;
    if (!c || !view) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(view.width * dpr);
    c.height = Math.round(view.height * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colors = readColors(c);
    const survey = props.survey;
    let status = { shown: 0, pending: 0 };
    hits.current = drawSky(
      ctx,
      { ...props.input, view, photosShown: survey !== null, hoverCon: hover?.con ?? null },
      colors,
      () => {
        if (survey && hips.current)
          status = hips.current.draw(ctx, view, survey, dpr, props.photoAlpha);
      },
    );
    props.onPhotoStatus?.(status);
    // Zeichnet bei jeder Eingabe neu; `tick` zählt nachgeladene Kacheln.
  }, [view?.width, view?.height, props, tick, hover]);

  const hoverAt = (x: number, y: number) => {
    const con = hitConstellation(hits.current, x, y);
    const star = hitStar(hits.current, x, y);
    const next = con || star !== null ? { con, star } : null;
    if (next?.con !== hover?.con || next?.star !== hover?.star) setHover(next);
  };

  const point = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!view) return;
    const { x, y } = point(e);
    const f: FrameSpec | null = props.input.frame;
    let mode: Drag['mode'] = 'pan';
    let offX = 0;
    let offY = 0;
    if (f && hitFrame(view, f, x, y)) {
      const c = sky.project(view, sky.radecToVec(f.raDeg, f.decDeg));
      if (c) {
        mode = 'frame';
        offX = c.x - x;
        offY = c.y - y;
      }
    }
    drag.current = { mode, startX: x, startY: y, view, offX, offY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    const { x, y } = point(e);
    if (!d) {
      if (e.pointerType === 'mouse') hoverAt(x, y);
      return;
    }
    if (!d.moved && Math.hypot(x - d.startX, y - d.startY) < 3) return;
    if (!d.moved && hover) setHover(null);
    d.moved = true;
    if (d.mode === 'frame')
      latest.current.onFrameMove(sky.unproject(d.view, x + d.offX, y + d.offY));
    else
      latest.current.onView(
        sky.normalize(
          sky.unproject(
            d.view,
            d.view.width / 2 - (x - d.startX),
            d.view.height / 2 - (y - d.startY),
          ),
        ),
        latest.current.fovDeg,
      );
  };

  const onPointerUp = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved && view) {
      const { x, y } = point(e);
      // Tipp auf Touch-Geräten: hebt wie das Überfahren hervor.
      if (e.pointerType !== 'mouse') hoverAt(x, y);
      props.onPick(x, y, view, hits.current);
    }
  };

  const onDoubleClick = (e: MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = point(e);
    zoomAt(e.shiftKey ? 2 : 0.5, x, y);
  };

  const zoomAt = (factor: number, x?: number, y?: number) => {
    if (!view) return;
    const fov = clampFov(props.fovDeg * factor);
    if (x === undefined || y === undefined) {
      props.onView(props.center, fov);
      return;
    }
    // Punkt unter dem Zeiger bleibt stehen: neue Mitte so, dass er an derselben Bildstelle liegt.
    const target = sky.unproject(view, x, y);
    const probe = sky.makeView(target, props.up, fov, view.width, view.height);
    const center = sky.unproject(probe, view.width - x, view.height - y);
    props.onView(sky.normalize(center), fov);
  };

  // Mausrad nativ und nicht passiv – sonst scrollt die Seite beim Zoomen mit.
  const zoomRef = useRef(zoomAt);
  zoomRef.current = zoomAt;
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      zoomRef.current(Math.exp(e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    if (!view) return;
    const step = Math.min(view.width, view.height) * 0.1;
    const pan = (dx: number, dy: number) =>
      props.onView(
        sky.normalize(sky.unproject(view, view.width / 2 + dx, view.height / 2 + dy)),
        props.fovDeg,
      );
    if (e.key === '+' || e.key === '=') zoomAt(1 / 1.4);
    else if (e.key === '-' || e.key === '_') zoomAt(1.4);
    else if (e.key === 'ArrowLeft') pan(-step, 0);
    else if (e.key === 'ArrowRight') pan(step, 0);
    else if (e.key === 'ArrowUp') pan(0, -step);
    else if (e.key === 'ArrowDown') pan(0, step);
    else return;
    e.preventDefault();
  };

  const bright = props.input.bright;
  const hoverText = (() => {
    if (!hover || !bright) return '';
    const label = bright.labels.find((l) => l.abbr === hover.con);
    const star = hover.star !== null ? bright.stars.names?.get(hover.star) : undefined;
    const lang = props.input.lang;
    return [
      label ? constellationName(label, props.input.names, lang) : '',
      star ? (lang === 'en' ? star.en : star.de) : '',
    ]
      .filter(Boolean)
      .join(' · ');
  })();

  return (
    <div ref={wrap} className={styles.canvasWrap}>
      <canvas
        ref={canvas}
        className={styles.canvas}
        role="img"
        aria-label={props.label}
        aria-describedby="skymap-description"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        onPointerLeave={() => {
          if (!drag.current && hover) setHover(null);
        }}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        data-hover={hover?.con ?? undefined}
        style={{
          width: `${String(size.w)}px`,
          height: `${String(size.h)}px`,
          cursor: hover?.star !== null && hover?.star !== undefined ? 'pointer' : undefined,
        }}
      />
      {hoverText ? (
        <span className={styles.hoverName} aria-hidden>
          {hoverText}
        </span>
      ) : null}
      <p id="skymap-description" className={styles.srOnly} aria-live="polite">
        {props.description}
      </p>
    </div>
  );
}
