/**
 * `SeasonChart` – Saisondiagramm (components.md §2.4, AP-24; FA-SIC-02): Balken je Nacht bzw. Woche mit
 * nutzbaren Stunden, getrennt in mondfrei und mit Mond, Mindestzeit als waagerechte Linie, höchste
 * Zielhöhe als dünne Linie (rechte Achse), „heute“, Saisonende und – außerhalb der Saison – Saisonbeginn
 * als senkrechte Marken, der Bereich davor gedämpft. Zirkumpolar: keine Marke, Fußnote „ganzjährig“.
 * Rendert ohne eigene Datenabfrage; Canvas mit `devicePixelRatio`, fokussierbar, ←/→ tastet Balken ab
 * (`aria-live`), Textalternative als Tabelle.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './SeasonChart.module.css';

export interface SeasonChartBar {
  /** Erste Nacht des Balkens (`YYYY-MM-DD`). */
  month: string;
  nights?: number;
  /** Nutzbare Stunden je Nacht. */
  usableHours: number;
  /** Anteil mit Mond über dem Horizont, 0–100. */
  moonPct: number;
  /** Mindestzeit am Stück in mindestens einer Nacht erreicht. */
  usable: boolean;
  peakAltDeg?: number | null;
}

export interface SeasonChartProps {
  months: readonly SeasonChartBar[];
  range: '1m' | '3m' | '6m' | '1y';
  seasonStart?: string | null;
  seasonEnd?: string | null;
  minTimeH?: number;
  /** Heutige Nacht (erste Nacht der Reihe); ohne Angabe die erste Balkennacht. */
  today?: string;
  /** `never`: in keiner Nacht nutzbar. */
  status?: 'in_season' | 'out_of_season' | 'never';
  state?: 'loading' | 'error' | 'ready';
  onRetry?: () => void;
}

const MIN_WIDTH = 280;
const HEIGHT = 120;
const PAD = { left: 30, right: 30, top: 16, bottom: 20 };

function token(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(`--npm-${name}`).trim() || '#888';
}

const dayOf = (key: string) => Date.parse(`${key}T12:00:00Z`) / 86_400_000;

export function SeasonChart(props: SeasonChartProps) {
  const { t, i18n } = useTranslation();
  const { months, minTimeH, seasonStart = null, seasonEnd = null } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null);
  // Theme-/Dichtewechsel: neu rendern, damit das Canvas die Tokens neu liest.
  const [, setAppearance] = useState(0);
  const liveId = useId();
  const ready = props.state !== 'loading' && props.state !== 'error' && months.length > 0;
  const perNight = props.range === '1m';

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => setWidth(Math.max(MIN_WIDTH, el.clientWidth));
    measure();
    const mo =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => setAppearance((n) => n + 1));
    mo?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-density'],
    });
    if (typeof ResizeObserver === 'undefined') return () => mo?.disconnect();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      mo?.disconnect();
    };
  }, [ready]);

  const first = months[0]?.month ?? '';
  const last = months[months.length - 1];
  const spanDays = last ? dayOf(last.month) - dayOf(first) + (last.nights ?? 1) : 1;
  const inRange = (key: string | null) =>
    key !== null && dayOf(key) >= dayOf(first) && dayOf(key) < dayOf(first) + spanDays;
  const fmtDate = (key: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      day: '2-digit',
      month: '2-digit',
      timeZone: 'UTC',
    }).format(new Date(Date.parse(`${key}T12:00:00Z`)));
  const num = (v: number, d = 1) =>
    new Intl.NumberFormat(i18n.language, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    }).format(v);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext?.('2d');
    if (!canvas || !ctx || width === 0 || months.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const H = HEIGHT + PAD.top + PAD.bottom;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, H);
    const c = (name: string) => token(canvas, name);
    const plotW = width - PAD.left - PAD.right;
    const bottom = PAD.top + HEIGHT;
    const maxH = Math.max(
      1,
      Math.ceil(Math.max(minTimeH ?? 0, ...months.map((m) => m.usableHours)) + 0.5),
    );
    const y = (h: number) => bottom - (h / maxH) * HEIGHT;
    const xDay = (key: string) => PAD.left + ((dayOf(key) - dayOf(first)) / spanDays) * plotW;
    const barW = plotW / months.length;
    ctx.font = `11px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';

    // Raster und linke Achse (Stunden)
    ctx.strokeStyle = c('border');
    ctx.fillStyle = c('text-light');
    ctx.textAlign = 'right';
    const step = maxH > 8 ? 4 : maxH > 4 ? 2 : 1;
    for (let h = 0; h <= maxH; h += step) {
      const yy = Math.round(y(h)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD.left, yy);
      ctx.lineTo(PAD.left + plotW, yy);
      ctx.stroke();
      ctx.fillText(`${String(h)} h`, PAD.left - 4, yy);
    }
    // Außerhalb der Saison: Bereich vor dem Saisonbeginn gedämpft
    if (seasonStart && inRange(seasonStart)) {
      ctx.fillStyle = c('skeleton');
      ctx.fillRect(PAD.left, PAD.top, xDay(seasonStart) - PAD.left, HEIGHT);
    }
    // Balken: mondfrei unten, mit Mond oben; nicht ausreichend gedämpft
    months.forEach((m, i) => {
      const x = PAD.left + i * barW + Math.min(1, barW * 0.1);
      const w = Math.max(1, barW - Math.min(2, barW * 0.2));
      const moon = (m.usableHours * m.moonPct) / 100;
      const free = m.usableHours - moon;
      ctx.globalAlpha = m.usable ? 1 : 0.35;
      ctx.fillStyle = c('chart-moonless');
      ctx.fillRect(x, y(free), w, bottom - y(free));
      ctx.fillStyle = c('chart-moonlit');
      ctx.fillRect(x, y(free + moon), w, y(free) - y(free + moon));
      ctx.globalAlpha = 1;
    });
    // Mindestzeit
    if (minTimeH !== undefined && minTimeH > 0) {
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = c('chart-min-alt');
      ctx.beginPath();
      ctx.moveTo(PAD.left, Math.round(y(minTimeH)) + 0.5);
      ctx.lineTo(PAD.left + plotW, Math.round(y(minTimeH)) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Höchste Zielhöhe (rechte Achse 0–90°)
    const peaks = months.map((m) => m.peakAltDeg ?? null);
    if (peaks.some((p) => p !== null)) {
      const ya = (a: number) => bottom - (Math.max(0, Math.min(90, a)) / 90) * HEIGHT;
      ctx.strokeStyle = c('chart-marker');
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let pen = false;
      peaks.forEach((p, i) => {
        if (p === null) {
          pen = false;
          return;
        }
        const x = PAD.left + (i + 0.5) * barW;
        if (pen) ctx.lineTo(x, ya(p));
        else ctx.moveTo(x, ya(p));
        pen = true;
      });
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = c('text-light');
      ctx.textAlign = 'left';
      for (const a of [0, 45, 90]) ctx.fillText(`${String(a)}°`, PAD.left + plotW + 4, ya(a));
    }
    // Monatsbeschriftung an Monatsanfängen
    ctx.fillStyle = c('text-light');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let lastLabel = -Infinity;
    for (let d = 0; d < spanDays; d += 1) {
      const date = new Date((dayOf(first) + d) * 86_400_000);
      if (date.getUTCDate() !== 1 && !(d === 0 && perNight)) continue;
      const x = PAD.left + (d / spanDays) * plotW;
      const label = new Intl.DateTimeFormat(i18n.language, {
        month: 'short',
        ...(perNight ? { day: 'numeric' } : {}),
        timeZone: 'UTC',
      }).format(date);
      if (x < lastLabel + 4) continue;
      ctx.fillRect(Math.round(x), bottom, 1, 4);
      ctx.fillText(label, x + 2, bottom + 5);
      lastLabel = x + ctx.measureText(label).width + 2;
    }
    // Marken: heute, Saisonbeginn, Saisonende
    ctx.textBaseline = 'bottom';
    const mark = (key: string, label: string, color: string) => {
      const x = Math.round(xDay(key)) + 0.5;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.fillStyle = color;
      const w = ctx.measureText(label).width;
      ctx.textAlign = x + w + 4 > PAD.left + plotW ? 'right' : 'left';
      ctx.fillText(label, ctx.textAlign === 'right' ? x - 3 : x + 3, PAD.top - 2);
    };
    mark(props.today ?? first, t('seasonChart.today'), c('chart-min-alt'));
    if (seasonStart && inRange(seasonStart))
      mark(seasonStart, t('seasonChart.startMark', { date: fmtDate(seasonStart) }), c('text'));
    if (seasonEnd && inRange(seasonEnd))
      mark(seasonEnd, t('seasonChart.endMark', { date: fmtDate(seasonEnd) }), c('text'));
    // Tastatur-Cursor
    if (cursor !== null) {
      ctx.strokeStyle = c('text');
      ctx.setLineDash([2, 3]);
      const x = PAD.left + (cursor + 0.5) * barW;
      ctx.beginPath();
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });

  if (props.state === 'loading')
    return <div className={styles.skeleton} role="status" aria-label={t('common.loading')} />;
  if (props.state === 'error')
    return (
      <div className={styles.message} role="alert">
        <p>{t('seasonChart.error')}</p>
        {props.onRetry ? (
          <button type="button" className={styles.retry} onClick={props.onRetry}>
            {t('common.retry')}
          </button>
        ) : null}
      </div>
    );
  if (months.length === 0)
    return (
      <div className={styles.message} role="status">
        <p>{t('seasonChart.empty')}</p>
      </div>
    );

  const barLabel = (m: SeasonChartBar) =>
    perNight || (m.nights ?? 1) === 1
      ? fmtDate(m.month)
      : t('seasonChart.week', { date: fmtDate(m.month) });
  const describe = (m: SeasonChartBar) =>
    t('seasonChart.describe', {
      label: barLabel(m),
      h: num(m.usableHours),
      moon: num(m.moonPct, 0),
      usable: m.usable ? t('seasonChart.enough') : t('seasonChart.notEnough'),
    });
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const base = cursor ?? -1;
    setCursor(Math.max(0, Math.min(months.length - 1, base + (e.key === 'ArrowRight' ? 1 : -1))));
  };
  const circumpolar = props.status === 'in_season' && seasonEnd === null;
  const cursorBar = cursor === null ? null : months[cursor];

  return (
    <figure className={styles.figure}>
      <div
        ref={wrapRef}
        className={styles.canvasWrap}
        tabIndex={0}
        role="img"
        aria-label={t('seasonChart.label')}
        aria-describedby={liveId}
        onKeyDown={onKey}
      >
        <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
      </div>
      <p id={liveId} className={styles.live} aria-live="polite">
        {cursorBar ? describe(cursorBar) : t('seasonChart.keyboardHint')}
      </p>
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.moonless}`} />
          {t('seasonChart.moonless')}
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.moonlit}`} />
          {t('seasonChart.moonlit')}
        </span>
        {minTimeH !== undefined ? (
          <span className={styles.legendItem}>
            <span className={styles.dashed} />
            {t('seasonChart.minTime', { h: num(minTimeH) })}
          </span>
        ) : null}
        {months.some((m) => m.peakAltDeg !== undefined && m.peakAltDeg !== null) ? (
          <span className={styles.legendItem}>
            <span className={styles.line} />
            {t('seasonChart.peak')}
          </span>
        ) : null}
      </div>
      <p className={styles.note}>
        {props.status === 'never'
          ? t('seasonChart.never')
          : circumpolar
            ? t('seasonChart.allYear')
            : [
                seasonStart ? t('seasonChart.start', { date: fmtDate(seasonStart) }) : null,
                seasonEnd ? t('seasonChart.end', { date: fmtDate(seasonEnd) }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
      </p>
      <details className={styles.details}>
        <summary>{t('seasonChart.table')}</summary>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">
                {perNight ? t('seasonChart.col.night') : t('seasonChart.col.week')}
              </th>
              <th scope="col">{t('seasonChart.col.hours')}</th>
              <th scope="col">{t('seasonChart.col.moon')}</th>
              <th scope="col">{t('seasonChart.col.peak')}</th>
              <th scope="col">{t('seasonChart.col.enough')}</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month}>
                <th scope="row">{barLabel(m)}</th>
                <td>{num(m.usableHours)} h</td>
                <td>{num(m.moonPct, 0)} %</td>
                <td>
                  {m.peakAltDeg === null || m.peakAltDeg === undefined
                    ? '–'
                    : `${num(m.peakAltDeg, 0)}°`}
                </td>
                <td>{m.usable ? t('seasonChart.enough') : t('seasonChart.notEnough')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
