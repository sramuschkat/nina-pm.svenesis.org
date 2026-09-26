/**
 * Nachtdiagramm (FA-SIC-01, FK 6.5; Vertrag der Nacht-Zeitleiste components.md §2.3, AP-10):
 * Canvas mit Dämmerungsbändern, Mondhöhe, Höhenkurven je Ziel, Mindesthöhe und Marken; Zeitachse in
 * Standortzeit mit Kürzel (optional zweite Zone). Rendert ohne eigene Datenabfrage, kennt keine Rechte.
 * Tastatur: fokussierbar, ←/→ tastet in 5-min-Schritten ab (Wert per `aria-live`); Textalternative als
 * `<details>`-Tabelle mit denselben Werten.
 */
import { formatTzAbbr } from '@nina-pm/shared';
import { SKY_STOPS } from '@nina-pm/ui-tokens';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  aboveSpan,
  clock,
  hourBands,
  hourTicks,
  iso,
  peak,
  skyColor,
  sunAltFromTwilight,
  twilightCrossings,
  valueAt,
  type AltPoint,
  type AltitudeSeries,
  type Band,
  type BandKey,
  type FilterBar,
  type TimelineBlock,
  type Interval,
  type NightMarker,
  type TwilightSpan,
} from './model';
import styles from './NightChart.module.css';

export type {
  AltitudeSeries,
  AltPoint,
  FilterBar,
  Interval,
  NightMarker,
  TimelineBlock,
  TwilightSpan,
} from './model';

export interface NightChartProps {
  /** Nachtfenster in Unix-Sekunden; fehlt es, ist das Diagramm im Fehlerzustand. */
  window: { startUtc: number; endUtc: number } | null;
  twilight?: {
    civil: TwilightSpan;
    nautical: TwilightSpan;
    astronomical: TwilightSpan;
  };
  /** Sonnenhöhe im Fenster (Himmelsfarbe); ohne sie wird der Himmel aus `twilight` gestuft. */
  sun?: readonly AltPoint[];
  /**
   * Höhenkurven je Ziel; die erste ist das Hauptziel der Stundenstreifen. `color` ist eine CSS-Farbe
   * oder ein Token `var(--npm-…)`.
   */
  series?: readonly AltitudeSeries[];
  moon?: { points: readonly AltPoint[]; illuminationPct: number };
  /** Nutzbare Zeit des Hauptziels aus der Engine (Streifen „Empfohlene Belichtungszeit“). */
  recommended?: readonly Interval[];
  markers?: readonly NightMarker[];
  /** Belegte Blöcke als Balken unter dem Diagramm (Simulator, Session-Soll/Ist). */
  blocks?: readonly TimelineBlock[];
  /** Filterbalken über den Blöcken in Filterfarben (FA-SIM-07). */
  filterBars?: readonly FilterBar[];
  /** Gestrichelte Linie der Mindesthöhe. */
  minAltDeg?: number;
  /** IANA-Zone des Standorts (Beschriftung, NT-03). */
  timeZone: string;
  /** Zweite, gedämpfte Beschriftungszeile (z. B. Mandantenzeit). */
  secondaryTimeZone?: string;
  /** Höhe der Zeichenfläche in px; Standard ist die Diagrammhöhe der Dichtestufe (`--npm-chart-h`). */
  height?: number;
  state?: 'loading' | 'error' | 'ready';
  /** `errors.*`-Schlüssel im Fehlerzustand. */
  errorKey?: string;
  onRetry?: () => void;
  onSelect?: (atUtc: number) => void;
  /**
   * Lage der Legende: `side` (Standard) rechts neben dem Diagramm, bei schmalem Container darunter;
   * `top` als kompakte, umbrechende Zeile über dem Diagramm (Projekt-Editor, AP-26d).
   */
  legend?: 'side' | 'top';
}

const MAX_SERIES = 12;
const MIN_WIDTH = 320;
const STEP = 300;
/** Stundenstreifen: Höhe je Zeile und Abstand (px). */
const BAND_ROW = 6;
const BAND_GAP = 3;
/** Filter- und Blockzeile unter den Stundenstreifen (px). */
const FILTER_ROW = 5;
const BLOCK_ROW = 12;
const PAD = { left: 34, right: 40, top: 18, axis: 32 };

/** CSS-Variable am Element (Tokens aus `@nina-pm/ui-tokens`, keine festen Farben). */
function token(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(`--npm-${name}`).trim() || '#888';
}

/** Farbe einer Reihe: CSS-Farbe oder `var(--npm-…)`, für das Canvas aufgelöst. */
function resolveColor(el: Element, color: string): string {
  const m = /^var\(--npm-([\w-]+)\)$/.exec(color);
  return m?.[1] ? token(el, m[1]) : color;
}

const BAND_TOKEN: Record<BandKey, string> = {
  recommended: 'chart-recommended',
  moonless: 'chart-moonless',
  moonlit: 'chart-moonlit',
  above: 'chart-above',
  dark: 'chart-dark',
};

export function NightChart(props: NightChartProps) {
  const { t, i18n } = useTranslation();
  const {
    window: win,
    series = [],
    moon,
    sun,
    recommended,
    markers = [],
    blocks = [],
    filterBars = [],
    minAltDeg,
    timeZone,
    secondaryTimeZone,
    twilight,
  } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null);
  /** Ausgeblendete Ebenen der Legende: `series:<id>`, `moon`, `minAlt`, Streifen-Schlüssel. */
  const [off, setOff] = useState<ReadonlySet<string>>(() => new Set());
  /** Neu zeichnen, wenn Theme oder Dichte wechseln (Tokens am `<html>`, das Canvas liest sie beim Zeichnen). */
  const [appearance, setAppearance] = useState(0);
  const liveId = useId();
  const shown = series.slice(0, MAX_SERIES);
  const hidden = series.length - shown.length;
  const primary = shown[0];

  const bands: Band[] = useMemo(
    () =>
      win
        ? hourBands({
            window: { fromUtc: win.startUtc, toUtc: win.endUtc },
            sun,
            twilight,
            target: primary?.points,
            moon: moon?.points,
            minAltDeg,
            recommended,
          })
        : [],
    [win, sun, twilight, primary, moon, minAltDeg, recommended],
  );
  const blockRowsH =
    blocks.length === 0
      ? 0
      : (filterBars.length > 0 ? FILTER_ROW + BAND_GAP : 0) + BLOCK_ROW + BAND_GAP * 2;
  const bandsH =
    (bands.length === 0 ? 0 : bands.length * (BAND_ROW + BAND_GAP) + BAND_GAP) + blockRowsH;

  // Die Zeichenfläche gibt es erst im Zustand „bereit“ – beim Wechsel aus Laden/Fehler/leer neu messen.
  const drawable =
    win !== null && props.state !== 'loading' && props.state !== 'error' && series.length > 0;
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => setWidth(Math.max(MIN_WIDTH, el.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [drawable]);

  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined;
    const mo = new MutationObserver(() => setAppearance((n) => n + 1));
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-density'],
    });
    return () => mo.disconnect();
  }, []);

  const ticks = useMemo(
    () => (win ? hourTicks(win.startUtc, win.endUtc, timeZone) : []),
    [win, timeZone],
  );
  const secondaryTicks = useMemo(
    () => (win && secondaryTimeZone ? hourTicks(win.startUtc, win.endUtc, secondaryTimeZone) : []),
    [win, secondaryTimeZone],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext?.('2d');
    if (!canvas || !ctx || !win || width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const height = canvas.clientHeight || (props.height ?? 180) + bandsH;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const axisH = secondaryTimeZone ? PAD.axis + 12 : PAD.axis - 4;
    const plotW = width - PAD.left - PAD.right;
    const plotH = Math.max(40, height - PAD.top - bandsH - axisH);
    const plotB = PAD.top + plotH;
    const span = win.endUtc - win.startUtc;
    const x = (u: number) => PAD.left + ((u - win.startUtc) / span) * plotW;
    const y = (alt: number) => PAD.top + (1 - Math.max(0, Math.min(90, alt)) / 90) * plotH;
    const c = (name: string) => token(canvas, name);
    const winI = { fromUtc: win.startUtc, toUtc: win.endUtc };
    const font = (px: number, weight = '') =>
      `${weight}${String(px)}px ${c('font') === '#888' ? 'system-ui, sans-serif' : c('font')}`;

    // Himmel nach Sonnenhöhe (components.md §2.3), themen-unabhängig.
    for (let a = win.startUtc; a < win.endUtc; a += STEP) {
      const mid = a + STEP / 2;
      const alt = sun
        ? (valueAt(sun, mid) ?? -90)
        : twilight
          ? sunAltFromTwilight(twilight, mid, winI)
          : -90;
      ctx.fillStyle = skyColor(alt, SKY_STOPS);
      const x0 = Math.floor(x(a));
      ctx.fillRect(x0, PAD.top, Math.ceil(x(Math.min(win.endUtc, a + STEP))) - x0, plotH);
    }
    // Raster: 0/30/60/90° und volle Stunden
    ctx.strokeStyle = c('chart-grid');
    ctx.lineWidth = 1;
    ctx.fillStyle = c('text-light');
    ctx.font = font(11);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const alt of [0, 30, 60, 90]) {
      const yy = Math.round(y(alt)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD.left, yy);
      ctx.lineTo(PAD.left + plotW, yy);
      ctx.stroke();
      ctx.fillText(`${String(alt)}°`, PAD.left - 4, yy);
    }
    for (const tick of ticks) {
      const xx = Math.round(x(tick.atUtc)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(xx, PAD.top);
      ctx.lineTo(xx, plotB);
      ctx.stroke();
    }
    // Dämmerungswechsel: Linie und Kürzel am Fuß
    if (twilight) {
      ctx.font = font(10);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      for (const cr of twilightCrossings(twilight, winI)) {
        const xx = Math.round(x(cr.atUtc)) + 0.5;
        ctx.strokeStyle = c('chart-grid');
        ctx.beginPath();
        ctx.moveTo(xx, PAD.top);
        ctx.lineTo(xx, plotB);
        ctx.stroke();
        ctx.fillStyle = c('chart-label');
        ctx.fillText(t(`nightChart.twilightShort.${cr.kind}`), xx + 3, plotB - 2);
      }
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.left, PAD.top, plotW, plotH);
    ctx.clip();
    // Mond: Fläche und Linie
    if (moon && !off.has('moon') && moon.points.length > 1) {
      const pts = moon.points;
      ctx.beginPath();
      ctx.moveTo(x((pts[0] as AltPoint).atUtc), plotB);
      for (const p of pts) ctx.lineTo(x(p.atUtc), y(p.altDeg));
      ctx.lineTo(x((pts[pts.length - 1] as AltPoint).atUtc), plotB);
      ctx.closePath();
      ctx.fillStyle = c('chart-moon-fill');
      ctx.fill();
    }
    const line = (points: readonly AltPoint[], color: string, widthPx: number, dash?: number[]) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = widthPx;
      ctx.setLineDash(dash ?? []);
      ctx.beginPath();
      let started = false;
      for (const p of points) {
        if (p.altDeg < 0) {
          started = false;
          continue;
        }
        if (started) ctx.lineTo(x(p.atUtc), y(p.altDeg));
        else ctx.moveTo(x(p.atUtc), y(p.altDeg));
        started = true;
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    };
    if (moon && !off.has('moon')) line(moon.points, c('chart-moon'), 1.5);
    // Mindesthöhe gestrichelt
    if (minAltDeg !== undefined && !off.has('minAlt')) {
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = c('chart-min-alt');
      ctx.beginPath();
      ctx.moveTo(PAD.left, Math.round(y(minAltDeg)) + 0.5);
      ctx.lineTo(PAD.left + plotW, Math.round(y(minAltDeg)) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const s of shown)
      if (!off.has(`series:${s.id}`)) line(s.points, resolveColor(canvas, s.color), 2);
    ctx.restore();
    // Mond-Beleuchtung oben rechts im Diagramm (Text, kein Symbolzeichen – rules/ui.md)
    if (moon && !off.has('moon')) {
      ctx.font = font(11, '600 ');
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillStyle = c('chart-label');
      ctx.fillText(
        t('nightChart.moonBadge', { pct: moon.illuminationPct.toFixed(0) }),
        PAD.left + plotW - 6,
        PAD.top + 5,
      );
    }
    // Marken: Linie im Diagramm, Beschriftung darüber
    ctx.font = font(11);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const m of markers) {
      if (m.atUtc < win.startUtc || m.atUtc > win.endUtc) continue;
      const xx = Math.round(x(m.atUtc)) + 0.5;
      ctx.strokeStyle = m.kind === 'now' ? c('chart-min-alt') : c('chart-marker');
      ctx.beginPath();
      ctx.moveTo(xx, PAD.top);
      ctx.lineTo(xx, plotB);
      ctx.stroke();
      ctx.fillStyle = c('text');
      ctx.fillText(m.label, xx, PAD.top - 3);
    }
    if (cursor !== null) {
      ctx.strokeStyle = c('chart-label');
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x(cursor), PAD.top);
      ctx.lineTo(x(cursor), plotB);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Stundenstreifen unter dem Diagramm
    bands.forEach((band, row) => {
      const top = plotB + BAND_GAP + row * (BAND_ROW + BAND_GAP);
      ctx.fillStyle = c('border');
      ctx.fillRect(PAD.left, top, plotW, BAND_ROW);
      if (off.has(band.key)) return;
      ctx.fillStyle = c(BAND_TOKEN[band.key]);
      for (const iv of band.intervals)
        ctx.fillRect(x(iv.fromUtc), top, Math.max(1, x(iv.toUtc) - x(iv.fromUtc)), BAND_ROW);
    });
    // Filterbalken und Blöcke (FA-SIM-07) unter den Stundenstreifen
    if (blocks.length > 0) {
      let top = plotB + (bands.length === 0 ? 0 : bands.length * (BAND_ROW + BAND_GAP)) + BAND_GAP;
      if (filterBars.length > 0) {
        for (const f of filterBars) {
          ctx.fillStyle = resolveColor(canvas, f.color);
          ctx.fillRect(x(f.fromUtc), top, Math.max(1, x(f.toUtc) - x(f.fromUtc)), FILTER_ROW);
        }
        top += FILTER_ROW + BAND_GAP;
      }
      ctx.font = font(10);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (const b of blocks) {
        const x0 = x(b.fromUtc);
        const w = Math.max(1, x(b.toUtc) - x0);
        const h = b.actual ? BLOCK_ROW / 2 : BLOCK_ROW;
        ctx.fillStyle = b.color ? resolveColor(canvas, b.color) : c('chart-marker');
        ctx.fillRect(x0, top, w, h);
        if (b.kind === 'transit') {
          ctx.strokeStyle = c('violet');
          ctx.lineWidth = 2;
          ctx.strokeRect(x0 + 1, top + 1, Math.max(1, w - 2), h - 2);
          ctx.lineWidth = 1;
        }
        if (w > 60) {
          ctx.fillStyle = c('text');
          ctx.save();
          ctx.beginPath();
          ctx.rect(x0, top, w, h);
          ctx.clip();
          ctx.fillText(b.label, x0 + 3, top + h / 2);
          ctx.restore();
        }
      }
    }
    // Zeitachse in Standortzeit; Beschriftung nur alle n Stunden, damit sie nicht kollidiert
    const pxPerHour = (plotW * 3600) / span;
    const every = width < 480 ? 3 : ([1, 2, 3, 4, 6].find((n) => n * pxPerHour >= 56) ?? 6);
    const axisY = plotB + bandsH + 4;
    ctx.font = font(11);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const drawTicks = (list: typeof ticks, color: string, yy: number) => {
      ctx.fillStyle = color;
      list.forEach((tick) => {
        if (Number(tick.label) % every !== 0) return;
        const xx = x(tick.atUtc);
        if (xx < PAD.left + 14 || xx > PAD.left + plotW - 14) return;
        ctx.fillText(`${tick.label}:00`, xx, yy);
      });
    };
    drawTicks(ticks, c('text'), axisY);
    drawTicks(secondaryTicks, c('text-light'), axisY + 15);
    // Zonenkürzel am Achsenende je Zeile (NT-03)
    ctx.textAlign = 'left';
    ctx.font = font(11, '600 ');
    ctx.fillStyle = c('text');
    ctx.fillText(formatTzAbbr(iso(win.endUtc), timeZone), PAD.left + plotW + 6, axisY);
    if (secondaryTimeZone) {
      ctx.fillStyle = c('text-light');
      ctx.fillText(
        formatTzAbbr(iso(win.endUtc), secondaryTimeZone),
        PAD.left + plotW + 6,
        axisY + 15,
      );
    }
  }, [
    win,
    width,
    twilight,
    sun,
    shown,
    moon,
    markers,
    minAltDeg,
    ticks,
    secondaryTicks,
    cursor,
    props.height,
    bands,
    bandsH,
    blocks,
    filterBars,
    off,
    secondaryTimeZone,
    t,
    appearance,
  ]);

  if (props.state === 'loading')
    return <div className={styles.skeleton} role="status" aria-label={t('common.loading')} />;
  if (props.state === 'error' || !win)
    return (
      <div className={styles.message} role="alert">
        <p>{t(props.errorKey ?? 'nightChart.error')}</p>
        {props.onRetry ? (
          <button type="button" className={styles.retry} onClick={props.onRetry}>
            {t('common.retry')}
          </button>
        ) : null}
      </div>
    );
  if (series.length === 0)
    return (
      <div className={styles.message} role="status">
        <p>{t('nightChart.empty')}</p>
      </div>
    );

  const describe = (at: number) => {
    const parts = shown
      .map((s) => {
        const v = valueAt(s.points, at);
        return v === null ? null : `${s.label} ${v.toFixed(0)}°`;
      })
      .filter(Boolean);
    const m = moon ? valueAt(moon.points, at) : null;
    if (m !== null) parts.push(`${t('nightChart.moon')} ${m.toFixed(0)}°`);
    return `${clock(at, timeZone)} – ${parts.join(', ')}`;
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Enter') return;
    e.preventDefault();
    const base = cursor ?? win.startUtc;
    if (e.key === 'Enter') {
      props.onSelect?.(base);
      return;
    }
    const next = base + (e.key === 'ArrowRight' ? STEP : -STEP);
    setCursor(Math.max(win.startUtc, Math.min(win.endUtc, next)));
  };
  const tz = (at: number) => clock(at, timeZone).split(' ').slice(1).join(' ');

  const toggle = (key: string) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const hours = (sec: number) =>
    t('nightChart.hours', {
      h: new Intl.NumberFormat(i18n.language, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format(sec / 3600),
    });
  const bandLabel = (key: BandKey) => t(`nightChart.band.${key}`, { deg: minAltDeg ?? 0 });
  const canvasH = props.height ?? null;
  const legendOnTop = props.legend === 'top';
  const legendBox = (
    <fieldset className={legendOnTop ? styles.legendTop : styles.legend}>
      <legend className={legendOnTop ? 'visually-hidden' : styles.legendTitle}>
        {t('nightChart.legend')}
      </legend>
      {shown.map((s) => (
        <label key={s.id} className={styles.legendItem}>
          <input
            type="checkbox"
            checked={!off.has(`series:${s.id}`)}
            onChange={() => toggle(`series:${s.id}`)}
          />
          <span className={styles.swatchLine} style={{ color: s.color }} />
          <span>{s.label}</span>
        </label>
      ))}
      {moon ? (
        <label className={styles.legendItem}>
          <input type="checkbox" checked={!off.has('moon')} onChange={() => toggle('moon')} />
          <span className={styles.swatchMoon} />
          <span>{t('nightChart.moonLegend', { pct: moon.illuminationPct.toFixed(0) })}</span>
        </label>
      ) : null}
      {minAltDeg !== undefined ? (
        <label className={styles.legendItem}>
          <input type="checkbox" checked={!off.has('minAlt')} onChange={() => toggle('minAlt')} />
          <span className={styles.swatchDashed} />
          <span>{t('nightChart.minAlt', { deg: minAltDeg })}</span>
        </label>
      ) : null}
      {bands.map((b) => (
        <label key={b.key} className={styles.legendItem}>
          <input type="checkbox" checked={!off.has(b.key)} onChange={() => toggle(b.key)} />
          <span className={`${styles.swatchBox} ${styles[`band_${b.key}`] ?? ''}`} />
          <span>{bandLabel(b.key)}</span>
          <span className={styles.legendHours}>{hours(b.totalSec)}</span>
        </label>
      ))}
      {hidden > 0 ? (
        <span className={styles.legendMore}>{t('nightChart.more', { count: hidden })}</span>
      ) : null}
    </fieldset>
  );

  return (
    <figure className={styles.figure}>
      <div className={legendOnTop ? styles.bodyTop : styles.body}>
        {legendOnTop ? legendBox : null}
        <div className={styles.chartCol}>
          <div
            ref={wrapRef}
            className={styles.canvasWrap}
            tabIndex={0}
            role="img"
            aria-label={t('nightChart.label', { zone: tz(win.startUtc) })}
            aria-describedby={liveId}
            onKeyDown={onKey}
            style={{
              height:
                canvasH === null
                  ? `calc(max(120px, var(--npm-chart-h)) + ${String(bandsH)}px)`
                  : canvasH + bandsH,
            }}
          >
            <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
            <span className="visually-hidden">{tz(win.endUtc)}</span>
          </div>
          <p id={liveId} className={styles.live} aria-live="polite">
            {cursor === null ? t('nightChart.keyboardHint') : describe(cursor)}
          </p>
        </div>
        {legendOnTop ? null : legendBox}
      </div>
      <details className={styles.details}>
        <summary>{t('nightChart.table')}</summary>
        <table className={styles.table}>
          <tbody>
            <tr>
              <th scope="row">{t('nightChart.window')}</th>
              <td>
                {clock(win.startUtc, timeZone)} – {clock(win.endUtc, timeZone)}
              </td>
            </tr>
            {twilight
              ? (['civil', 'nautical', 'astronomical'] as const).map((k) => (
                  <tr key={k}>
                    <th scope="row">{t(`nightChart.twilight.${k}`)}</th>
                    <td>
                      {twilight[k].startUtc === null
                        ? t('nightChart.none')
                        : clock(twilight[k].startUtc, timeZone)}{' '}
                      –{' '}
                      {twilight[k].endUtc === null
                        ? t('nightChart.none')
                        : clock(twilight[k].endUtc, timeZone)}
                    </td>
                  </tr>
                ))
              : null}
            {shown.map((s) => {
              const top = peak(s.points);
              const span = minAltDeg === undefined ? null : aboveSpan(s.points, minAltDeg);
              return (
                <tr key={s.id}>
                  <th scope="row">{s.label}</th>
                  <td>
                    {top
                      ? t('nightChart.culmination', {
                          at: clock(top.atUtc, timeZone),
                          deg: top.altDeg.toFixed(1),
                        })
                      : ''}
                    {span
                      ? ` · ${t('nightChart.above', {
                          deg: minAltDeg,
                          from: clock(span.fromUtc, timeZone),
                          to: clock(span.toUtc, timeZone),
                        })}`
                      : minAltDeg !== undefined
                        ? ` · ${t('nightChart.neverAbove', { deg: minAltDeg })}`
                        : ''}
                  </td>
                </tr>
              );
            })}
            {bands.map((b) => (
              <tr key={`band:${b.key}`}>
                <th scope="row">{bandLabel(b.key)}</th>
                <td>
                  {hours(b.totalSec)}
                  {b.intervals.length > 0
                    ? ` · ${b.intervals
                        .map(
                          (iv) => `${clock(iv.fromUtc, timeZone)} – ${clock(iv.toUtc, timeZone)}`,
                        )
                        .join(', ')}`
                    : ''}
                </td>
              </tr>
            ))}
            {blocks.map((b) => (
              <tr key={`block:${b.id}`}>
                <th scope="row">{b.label}</th>
                <td>
                  {clock(b.fromUtc, timeZone)} – {clock(b.toUtc, timeZone)}
                </td>
              </tr>
            ))}
            {markers.map((m) => (
              <tr key={`${m.kind}:${String(m.atUtc)}`}>
                <th scope="row">{m.label}</th>
                <td>{clock(m.atUtc, timeZone)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
