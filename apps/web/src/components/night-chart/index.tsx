/**
 * Nachtdiagramm (FA-SIC-01, FK 6.5; Vertrag der Nacht-Zeitleiste components.md §2.3, AP-10):
 * Canvas mit Dämmerungsbändern, Mondhöhe, Höhenkurven je Ziel, Mindesthöhe und Marken; Zeitachse in
 * Standortzeit mit Kürzel (optional zweite Zone). Rendert ohne eigene Datenabfrage, kennt keine Rechte.
 * Tastatur: fokussierbar, ←/→ tastet in 5-min-Schritten ab (Wert per `aria-live`); Textalternative als
 * `<details>`-Tabelle mit denselben Werten.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  aboveSpan,
  clock,
  hourTicks,
  peak,
  valueAt,
  type AltPoint,
  type AltitudeSeries,
  type NightMarker,
  type TwilightSpan,
} from './model';
import styles from './NightChart.module.css';

export type { AltitudeSeries, AltPoint, NightMarker, TwilightSpan } from './model';

export interface NightChartProps {
  /** Nachtfenster in Unix-Sekunden; fehlt es, ist das Diagramm im Fehlerzustand. */
  window: { startUtc: number; endUtc: number } | null;
  twilight?: {
    civil: TwilightSpan;
    nautical: TwilightSpan;
    astronomical: TwilightSpan;
  };
  series?: readonly AltitudeSeries[];
  moon?: { points: readonly AltPoint[]; illuminationPct: number };
  markers?: readonly NightMarker[];
  /** Gestrichelte Linie der Mindesthöhe. */
  minAltDeg?: number;
  /** IANA-Zone des Standorts (Beschriftung, NT-03). */
  timeZone: string;
  /** Zweite, gedämpfte Beschriftungszeile (z. B. Mandantenzeit). */
  secondaryTimeZone?: string;
  /** Höhe in px; Standard ist die Diagrammhöhe der Dichtestufe (`--npm-chart-h`). */
  height?: number;
  state?: 'loading' | 'error' | 'ready';
  /** `errors.*`-Schlüssel im Fehlerzustand. */
  errorKey?: string;
  onRetry?: () => void;
  onSelect?: (atUtc: number) => void;
}

const MAX_SERIES = 12;
const MIN_WIDTH = 320;
const STEP = 300;
const PAD = { left: 36, right: 12, top: 18, bottom: 34 };

/** Farbe eines Tokens am Element (Themes light/dark, keine festen Farben). */
function token(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(`--npm-${name}`).trim() || '#888';
}

export function NightChart(props: NightChartProps) {
  const { t } = useTranslation();
  const {
    window: win,
    series = [],
    moon,
    markers = [],
    minAltDeg,
    timeZone,
    secondaryTimeZone,
    twilight,
  } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null);
  const liveId = useId();
  const shown = series.slice(0, MAX_SERIES);
  const hidden = series.length - shown.length;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => setWidth(Math.max(MIN_WIDTH, el.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
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
    const height = canvas.clientHeight || props.height || 180;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const plotW = width - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;
    const x = (u: number) => PAD.left + ((u - win.startUtc) / (win.endUtc - win.startUtc)) * plotW;
    const y = (alt: number) => PAD.top + (1 - Math.max(0, Math.min(90, alt)) / 90) * plotH;
    const c = (name: string) => token(canvas, name);

    // Dämmerungsbänder: je tiefer die Grenze, desto dunkler (Primärfarbe mit steigender Deckkraft).
    if (twilight) {
      const bands: [TwilightSpan, number][] = [
        [twilight.civil, 0.12],
        [twilight.nautical, 0.22],
        [twilight.astronomical, 0.35],
      ];
      for (const [span, alpha] of bands) {
        // Polarnacht: ganzes Fenster; fehlt nur ein Durchgang, reicht das Band bis zum Fensterrand.
        const from = span.allNight
          ? win.startUtc
          : (span.startUtc ?? (span.endUtc === null ? null : win.startUtc));
        const to = span.allNight
          ? win.endUtc
          : (span.endUtc ?? (span.startUtc === null ? null : win.endUtc));
        if (from === null || to === null) continue;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = c('primary-light');
        ctx.fillRect(x(from), PAD.top, x(to) - x(from), plotH);
      }
      ctx.globalAlpha = 1;
    }
    // Raster: 0/30/60/90°
    ctx.strokeStyle = c('border');
    ctx.lineWidth = 1;
    ctx.fillStyle = c('text-light');
    ctx.font = '11px system-ui, sans-serif';
    for (const alt of [0, 30, 60, 90]) {
      ctx.beginPath();
      ctx.moveTo(PAD.left, y(alt));
      ctx.lineTo(PAD.left + plotW, y(alt));
      ctx.stroke();
      ctx.fillText(`${String(alt)}°`, 4, y(alt) + 4);
    }
    // Mindesthöhe gestrichelt
    if (minAltDeg !== undefined) {
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = c('warning');
      ctx.beginPath();
      ctx.moveTo(PAD.left, y(minAltDeg));
      ctx.lineTo(PAD.left + plotW, y(minAltDeg));
      ctx.stroke();
      ctx.setLineDash([]);
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
    };
    if (moon) line(moon.points, c('text-light'), 1.5, [2, 3]);
    for (const s of shown) line(s.points, s.color, 2);
    // Marken
    for (const m of markers) {
      if (m.atUtc < win.startUtc || m.atUtc > win.endUtc) continue;
      ctx.strokeStyle = m.kind === 'now' ? c('danger') : c('accent');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x(m.atUtc), PAD.top);
      ctx.lineTo(x(m.atUtc), PAD.top + plotH);
      ctx.stroke();
      ctx.fillStyle = c('text');
      ctx.fillText(m.label, x(m.atUtc) + 3, PAD.top - 5);
    }
    // Zeitachse: Standortzeit; unter 480 px nur jede dritte Beschriftung
    const every = width < 480 ? 3 : 1;
    ctx.fillStyle = c('text');
    ticks.forEach((tick, i) => {
      if (i % every === 0) ctx.fillText(tick.label, x(tick.atUtc) - 6, PAD.top + plotH + 14);
    });
    ctx.fillStyle = c('text-light');
    secondaryTicks.forEach((tick, i) => {
      if (i % every === 0) ctx.fillText(tick.label, x(tick.atUtc) - 6, PAD.top + plotH + 28);
    });
    if (cursor !== null) {
      ctx.strokeStyle = c('text');
      ctx.setLineDash([1, 2]);
      ctx.beginPath();
      ctx.moveTo(x(cursor), PAD.top);
      ctx.lineTo(x(cursor), PAD.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [
    win,
    width,
    twilight,
    shown,
    moon,
    markers,
    minAltDeg,
    ticks,
    secondaryTicks,
    cursor,
    props.height,
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

  return (
    <figure className={styles.figure}>
      <div
        ref={wrapRef}
        className={styles.canvasWrap}
        tabIndex={0}
        role="img"
        aria-label={t('nightChart.label', { zone: tz(win.startUtc) })}
        aria-describedby={liveId}
        onKeyDown={onKey}
        style={props.height ? { height: props.height } : undefined}
      >
        <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
        <span className={styles.axisZone}>{tz(win.endUtc)}</span>
      </div>
      <p id={liveId} className={styles.live} aria-live="polite">
        {cursor === null ? t('nightChart.keyboardHint') : describe(cursor)}
      </p>
      <figcaption className={styles.legend}>
        {shown.map((s) => (
          <span key={s.id}>
            <span className={styles.swatch} style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        {moon ? (
          <span>
            <span className={styles.swatchDashed} />
            {t('nightChart.moonLegend', { pct: moon.illuminationPct.toFixed(0) })}
          </span>
        ) : null}
        {minAltDeg !== undefined ? <span>{t('nightChart.minAlt', { deg: minAltDeg })}</span> : null}
        {hidden > 0 ? <span>{t('nightChart.more', { count: hidden })}</span> : null}
      </figcaption>
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
