/**
 * Nachtdiagramm (FA-SIC-01, FK 6.5; Vertrag der Nacht-Zeitleiste components.md §2.3, AP-10, Stil AP-26e):
 * Canvas im Stil des Höhendiagramms aus dem Beobachtungsplaner – dunkler Rahmen, Himmel nach Sonnenhöhe,
 * astronomisch dunkel grün, Mond als rote Fläche nach Beleuchtung, Meridian violett, Uhrzeit rot, beste
 * Zeit als Punkt; Zeitachse in Standortzeit mit Kürzel und darunter die Zeit des Geräts, wenn sie abweicht.
 * `variant="plan"` ist die Plangrafik des Simulators (FA-SIM-07): Blöcke als Flächen im Diagramm,
 * Filterleiste darüber, ziehbare Uhrzeit. Rendert ohne eigene Datenabfrage, kennt keine Rechte.
 * Tastatur: fokussierbar, ←/→ tastet in 5-min-Schritten ab (Wert per `aria-live`); Textalternative als
 * `<details>`-Tabelle mit denselben Werten.
 */
import { formatTzAbbr, formatZonedTime } from '@nina-pm/shared';
import { SKY_STOPS } from '@nina-pm/ui-tokens';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  aboveSpan,
  bestTime,
  clock,
  cropWindow,
  filterBarLabel,
  hourBands,
  hourTicks,
  iso,
  luminance,
  moonAlpha,
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
  /** Sonnenhöhe im Fenster (Himmelsfarbe, Ausschnitt); ohne sie wird der Himmel aus `twilight` gestuft. */
  sun?: readonly AltPoint[];
  /**
   * Höhenkurven je Ziel; die erste ist das Hauptziel der Stundenstreifen und der besten Zeit. `color` ist
   * eine CSS-Farbe oder ein Token `var(--npm-…)`.
   */
  series?: readonly AltitudeSeries[];
  moon?: { points: readonly AltPoint[]; illuminationPct: number };
  /** Nutzbare Zeit des Hauptziels aus der Engine (Streifen „Empfohlene Belichtungszeit“). */
  recommended?: readonly Interval[];
  markers?: readonly NightMarker[];
  /** Belegte Blöcke: in der Plangrafik als Flächen im Diagramm, sonst als Balken darunter. */
  blocks?: readonly TimelineBlock[];
  /** Filterbalken in Filterfarben (FA-SIM-07); in der Plangrafik als beschriftete Leiste über dem Diagramm. */
  filterBars?: readonly FilterBar[];
  /** Gestrichelte Linie der Mindesthöhe (ohne sie 30°). */
  minAltDeg?: number;
  /** IANA-Zone des Standorts (Beschriftung, NT-03). */
  timeZone: string;
  /**
   * Zweite, gedämpfte Beschriftungszeile. Standard: die Zeitzone des Geräts, nur wenn sie von der
   * Standortzeit abweicht; `null` schaltet sie ab.
   */
  secondaryTimeZone?: string | null;
  /** Höhe in px ohne Streifen und Zusatzzeilen; Standard aus der Dichtestufe (`--npm-chart-h` + 60 px). */
  height?: number;
  state?: 'loading' | 'error' | 'ready';
  /** `errors.*`-Schlüssel im Fehlerzustand. */
  errorKey?: string;
  onRetry?: () => void;
  /** Zeitpunkt gewählt (Enter, Klick ins Diagramm). */
  onSelect?: (atUtc: number) => void;
  /** Gesteuerte Uhrzeit (rote Linie mit Kasten); Klick und Ziehen melden sie über `onCursorChange`. */
  cursorUtc?: number | null;
  onCursorChange?: (atUtc: number) => void;
  /** `night` (Standard) oder `plan` – Plangrafik des Simulators. */
  variant?: 'night' | 'plan';
  /** Stundenstreifen unter dem Diagramm (FA-SIC-01); Standard an. */
  bands?: boolean;
  /** Ausschnitt eine Stunde vor Sonnenuntergang bis eine Stunde nach Sonnenaufgang; Standard an. */
  crop?: boolean;
  /** Kennwerte neben dem Diagramm (Höhe zur Uhrzeit, höchste Höhe, Mond, Zeit über Mindesthöhe). */
  facts?: boolean;
  /**
   * Lage der Legende: `top` (Standard) als kompakte, umbrechende Zeile über dem Diagramm, `side` rechts
   * daneben (bei schmalem Container darunter), `none` ohne Legende.
   */
  legend?: 'top' | 'side' | 'none';
}

const MAX_SERIES = 12;
const MIN_WIDTH = 320;
const STEP = 300;
/** Stundenstreifen: Höhe je Zeile und Abstand (px). */
const BAND_ROW = 6;
const BAND_GAP = 3;
/** Filter- und Blockzeile unter dem Diagramm (Nachtdiagramm, px). */
const FILTER_ROW = 5;
const BLOCK_ROW = 12;
/** Filterleiste über dem Diagramm (Plangrafik, px). */
const PLAN_FILTER = 18;
/** Ränder wie im Beobachtungsplaner; rechts Platz für das Zonenkürzel. */
const PAD = { left: 34, right: 40, top: 10 };
const AXIS_ROW = 14;

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

/** Zeitzone des Geräts (zweite Achsenzeile); in Umgebungen ohne `Intl`-Zonen keine. */
function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

const hm = (at: number, zone: string) => formatZonedTime(iso(at), zone);

export function NightChart(props: NightChartProps) {
  const { t, i18n } = useTranslation();
  const {
    window: rawWin,
    series = [],
    moon,
    sun,
    recommended,
    markers = [],
    blocks = [],
    filterBars = [],
    minAltDeg,
    timeZone,
    twilight,
  } = props;
  const plan = props.variant === 'plan';
  const showBands = props.bands !== false && !plan;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [ownCursor, setOwnCursor] = useState<number | null>(null);
  const controlled = props.cursorUtc !== undefined;
  const cursor = controlled ? (props.cursorUtc ?? null) : ownCursor;
  const dragging = useRef(false);
  /** Ausgeblendete Ebenen der Legende: `series:<id>`, `moon`, `minAlt`, Streifen-Schlüssel. */
  const [off, setOff] = useState<ReadonlySet<string>>(() => new Set());
  /** Neu zeichnen, wenn Theme oder Dichte wechseln (Tokens am `<html>`, das Canvas liest sie beim Zeichnen). */
  const [appearance, setAppearance] = useState(0);
  const liveId = useId();
  const shown = series.slice(0, MAX_SERIES);
  const hidden = series.length - shown.length;
  const primary = shown[0];

  // Ausschnitt: eine Stunde vor Sonnenuntergang bis eine Stunde nach Sonnenaufgang (volle Standortstunden).
  const win = useMemo(() => {
    if (!rawWin) return null;
    if (props.crop === false) return rawWin;
    const c = cropWindow({ fromUtc: rawWin.startUtc, toUtc: rawWin.endUtc }, sun, timeZone);
    return { startUtc: c.fromUtc, endUtc: c.toUtc };
  }, [rawWin, sun, timeZone, props.crop]);

  const secondaryTimeZone = useMemo(() => {
    const zone =
      props.secondaryTimeZone === null ? undefined : (props.secondaryTimeZone ?? deviceTimeZone());
    if (!zone || !win) return undefined;
    // Nur zeigen, wenn die Zone im Fenster eine andere Uhrzeit hat (sonst wäre die Zeile doppelt).
    const differs = [win.startUtc, win.endUtc].some((at) => hm(at, zone) !== hm(at, timeZone));
    return differs ? zone : undefined;
  }, [props.secondaryTimeZone, win, timeZone]);

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
  const drawnBands = showBands ? bands : [];
  const best = useMemo(
    () =>
      win && primary
        ? bestTime(primary.points, twilight, { fromUtc: win.startUtc, toUtc: win.endUtc })
        : null,
    [win, primary, twilight],
  );
  const blockRowsH =
    plan || blocks.length === 0
      ? 0
      : (filterBars.length > 0 ? FILTER_ROW + BAND_GAP : 0) + BLOCK_ROW + BAND_GAP * 2;
  const bandsH =
    (drawnBands.length === 0 ? 0 : drawnBands.length * (BAND_ROW + BAND_GAP) + BAND_GAP) +
    blockRowsH;
  const topH = plan && filterBars.length > 0 ? PAD.top + PLAN_FILTER : PAD.top;
  const extraH = bandsH + (secondaryTimeZone ? AXIS_ROW : 0) + (topH - PAD.top);

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
  /** Uhrzeit als Kastenbeschriftung: „03:40 (10:40)“ mit der zweiten Zone in Klammern. */
  const both = (at: number) =>
    secondaryTimeZone
      ? `${hm(at, timeZone)} (${hm(at, secondaryTimeZone)})`
      : `${hm(at, timeZone)}`;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext?.('2d');
    if (!canvas || !ctx || !win || width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const height = canvas.clientHeight || (props.height ?? 240) + extraH;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const c = (name: string) => token(canvas, name);
    const axisH = AXIS_ROW + 8 + (secondaryTimeZone ? AXIS_ROW : 0);
    const plotW = width - PAD.left - PAD.right;
    const plotT = topH;
    const plotH = Math.max(40, height - plotT - bandsH - axisH);
    const plotB = plotT + plotH;
    const span = win.endUtc - win.startUtc;
    const x = (u: number) => PAD.left + ((u - win.startUtc) / span) * plotW;
    const y = (alt: number) => plotT + (1 - Math.max(0, Math.min(90, alt)) / 90) * plotH;
    const winI = { fromUtc: win.startUtc, toUtc: win.endUtc };
    const fontFamily = c('font') === '#888' ? 'system-ui, sans-serif' : c('font');
    const font = (px: number, weight = '') => `${weight}${String(px)}px ${fontFamily}`;
    const vline = (at: number, color: string, dash: number[] = [], lw = 1) => {
      const xx = Math.round(x(at)) + 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(xx, plotT);
      ctx.lineTo(xx, plotB);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    };
    /** Beschriftungskasten an einer senkrechten Linie; rechts daneben, am rechten Rand links davon. */
    const labelBox = (at: number, row: number, text: string, bg: string, fg: string) => {
      ctx.font = font(11, '600 ');
      const w = ctx.measureText(text).width + 8;
      const xx = x(at);
      const left = xx + 2 + w <= PAD.left + plotW ? xx + 2 : xx - 1 - w;
      const top = plotT + 4 + row * 20;
      ctx.fillStyle = bg;
      ctx.fillRect(left, top, w, 16);
      ctx.fillStyle = fg;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, left + 4, top + 8.5);
    };

    // Rahmen (themen-unabhängig dunkel, Entscheidung Sven 26.09.2026)
    ctx.fillStyle = c('chart-frame');
    ctx.fillRect(0, 0, width, height);
    // Himmel nach Sonnenhöhe; astronomisch dunkel grün (Nachtdiagramm) bzw. dunkel (Plangrafik).
    for (let a = win.startUtc; a < win.endUtc; a += STEP) {
      const mid = a + STEP / 2;
      const alt = sun
        ? (valueAt(sun, mid) ?? -90)
        : twilight
          ? sunAltFromTwilight(twilight, mid, winI)
          : -90;
      ctx.fillStyle = !plan && alt <= -18 ? c('chart-sky-dark') : skyColor(alt, SKY_STOPS);
      const x0 = Math.floor(x(a));
      ctx.fillRect(x0, plotT, Math.ceil(x(Math.min(win.endUtc, a + STEP))) - x0, plotH);
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.left, plotT, plotW, plotH);
    ctx.clip();
    // Mond als rote Fläche, Deckkraft nach Beleuchtung
    if (moon && !off.has('moon') && moon.points.length > 1) {
      const pts = moon.points;
      ctx.beginPath();
      ctx.moveTo(x((pts[0] as AltPoint).atUtc), plotB);
      for (const p of pts) ctx.lineTo(x(p.atUtc), y(p.altDeg));
      ctx.lineTo(x((pts[pts.length - 1] as AltPoint).atUtc), plotB);
      ctx.closePath();
      ctx.fillStyle = `rgba(229, 72, 77, ${moonAlpha(moon.illuminationPct).toFixed(3)})`;
      ctx.fill();
    }
    // Plangrafik: Blöcke als Flächen in Zielfarbe, der Block unter der Uhrzeit hervorgehoben
    if (plan) {
      for (const b of blocks) {
        const x0 = x(b.fromUtc);
        const w = Math.max(1, x(b.toUtc) - x0);
        const on = cursor !== null && cursor >= b.fromUtc && cursor < b.toUtc;
        ctx.fillStyle = b.color ? resolveColor(canvas, b.color) : c('chart-marker');
        ctx.strokeStyle = ctx.fillStyle;
        ctx.globalAlpha = on ? 0.42 : 0.2;
        ctx.fillRect(x0, plotT, w, plotH);
        ctx.globalAlpha = on ? 1 : 0.6;
        ctx.lineWidth = on ? 2 : 1;
        ctx.strokeRect(x0 + 0.5, plotT + 0.5, w - 1, plotH - 1);
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
        if (w > 40) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x0, plotT, w, plotH);
          ctx.clip();
          ctx.font = font(12, '600 ');
          ctx.fillStyle = c('chart-curve');
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(b.label, x0 + 5, plotT + 5);
          ctx.restore();
        }
      }
    }
    ctx.restore();
    // Raster: 60° und alle n Stunden fein, Mindesthöhe (sonst 30°) gestrichelt
    const pxPerHour = (plotW * 3600) / span;
    const every = [1, 2, 3, 4, 6].find((n) => n * pxPerHour >= 90) ?? 6;
    ctx.strokeStyle = c('chart-grid');
    ctx.beginPath();
    ctx.moveTo(PAD.left, Math.round(y(60)) + 0.5);
    ctx.lineTo(PAD.left + plotW, Math.round(y(60)) + 0.5);
    ctx.stroke();
    for (const tick of ticks)
      if (Number(tick.label) % every === 0) vline(tick.atUtc, c('chart-grid'));
    if (!off.has('minAlt')) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.setLineDash([3, 3]);
      const yy = Math.round(y(minAltDeg ?? 30)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD.left, yy);
      ctx.lineTo(PAD.left + plotW, yy);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Dämmerung: Grenzen der astronomischen Dunkelheit gepunktet grün, Kürzel bzw. Wort am Fuß
    if (twilight) {
      const midNight = (win.startUtc + win.endUtc) / 2;
      for (const cr of twilightCrossings(twilight, winI)) {
        if (cr.kind === 'astronomical' && !plan) vline(cr.atUtc, c('chart-dark-edge'), [2, 3]);
        else if (plan) vline(cr.atUtc, c('chart-grid'));
        ctx.font = plan ? font(11) : font(11, '600 ');
        ctx.fillStyle = c('chart-label');
        ctx.textBaseline = 'bottom';
        // Plangrafik: abends rechts der Linie, morgens links davon – die Wörter überlappen nicht.
        const evening = cr.atUtc < midNight;
        ctx.textAlign = plan ? (evening ? 'left' : 'right') : 'center';
        ctx.fillText(
          t(plan ? `nightChart.twilightWord.${cr.kind}` : `nightChart.twilightShort.${cr.kind}`),
          x(cr.atUtc) + (plan ? (evening ? 4 : -4) : 0),
          plotB - 4,
        );
      }
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.left, plotT, plotW, plotH);
    ctx.clip();
    const line = (points: readonly AltPoint[], color: string, widthPx: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = widthPx;
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
      ctx.lineWidth = 1;
    };
    for (const s of shown)
      if (!off.has(`series:${s.id}`))
        line(
          s.points,
          shown.length === 1 && !plan ? c('chart-curve') : resolveColor(canvas, s.color),
          2,
        );
    // Beste Zeit des Hauptziels als Punkt
    if (best && !plan && primary && !off.has(`series:${primary.id}`)) {
      ctx.fillStyle = c('chart-best');
      ctx.beginPath();
      ctx.arc(x(best.atUtc), y(best.altDeg), 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // Mond: Beleuchtung oben rechts (Nachtdiagramm) bzw. „Mond“ am höchsten Punkt (Plangrafik); Text, kein
    // Symbolzeichen (rules/ui.md)
    if (moon && !off.has('moon')) {
      ctx.font = font(11, '600 ');
      if (plan) {
        const top = peak(
          moon.points.filter((p) => p.atUtc >= win.startUtc && p.atUtc <= win.endUtc),
        );
        if (top && top.altDeg > 5) {
          ctx.fillStyle = c('chart-now');
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(t('nightChart.moon'), x(top.atUtc), y(top.altDeg) - 3);
        }
      } else {
        ctx.fillStyle = c('chart-moon-label');
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(
          t('nightChart.moonBadge', { pct: moon.illuminationPct.toFixed(0) }),
          PAD.left + plotW - 6,
          plotT + 5,
        );
      }
    }
    // Marken: Meridian violett gestrichelt mit Kasten, Uhrzeit rot mit Kasten, sonstige blau
    let row = 1;
    for (const m of markers) {
      if (m.atUtc < win.startUtc || m.atUtc > win.endUtc) continue;
      if (m.kind === 'now') {
        vline(m.atUtc, c('chart-now'), [], 1.5);
        labelBox(
          m.atUtc,
          0,
          t('nightChart.nowAt', { time: both(m.atUtc) }),
          c('chart-now'),
          '#ffffff',
        );
      } else if (m.kind === 'transit' || m.kind === 'flip') {
        vline(m.atUtc, c('chart-meridian'), [5, 3], 1.5);
        labelBox(
          m.atUtc,
          row,
          t(m.kind === 'flip' ? 'nightChart.flipAt' : 'nightChart.transitAt', {
            time: hm(m.atUtc, timeZone),
          }),
          c('chart-meridian'),
          c('chart-frame'),
        );
        row = row === 1 ? 2 : 1;
      } else {
        vline(m.atUtc, c('chart-marker'));
        if (m.label) labelBox(m.atUtc, row, m.label, c('chart-marker'), c('chart-frame'));
      }
    }
    // Uhrzeit: gesteuert (Simulator, Sternkarte) als rote Linie mit Kasten, per Tastatur gestrichelt
    if (cursor !== null && cursor >= win.startUtc && cursor <= win.endUtc) {
      if (controlled) {
        vline(cursor, c('chart-now'), [], 2);
        labelBox(
          cursor,
          0,
          t('nightChart.nowAt', { time: both(cursor) }),
          c('chart-now'),
          '#ffffff',
        );
      } else vline(cursor, c('chart-label'), [2, 3]);
    }
    // Plangrafik: Filterleiste über dem Diagramm („R ×10“), Textfarbe nach Helligkeit des Filters
    if (plan && filterBars.length > 0) {
      const top = PAD.top - 4;
      for (const f of filterBars) {
        const x0 = x(f.fromUtc);
        const w = Math.max(1, x(f.toUtc) - x0);
        const color = resolveColor(canvas, f.color);
        ctx.fillStyle = color;
        ctx.fillRect(x0, top, w, PLAN_FILTER);
        ctx.fillStyle = c('chart-frame');
        ctx.fillRect(x0 + w - 1, top, 1, PLAN_FILTER);
        const text = filterBarLabel(f);
        ctx.font = font(11, '600 ');
        if (ctx.measureText(text).width + 6 <= w) {
          const lum = luminance(color);
          ctx.fillStyle = lum !== null && lum > 0.45 ? c('chart-frame') : '#ffffff';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, x0 + 3, top + PLAN_FILTER / 2 + 0.5);
        }
      }
    }
    // Stundenstreifen unter dem Diagramm
    drawnBands.forEach((band, i) => {
      const top = plotB + BAND_GAP + i * (BAND_ROW + BAND_GAP);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fillRect(PAD.left, top, plotW, BAND_ROW);
      if (off.has(band.key)) return;
      ctx.fillStyle = c(BAND_TOKEN[band.key]);
      for (const iv of band.intervals)
        ctx.fillRect(x(iv.fromUtc), top, Math.max(1, x(iv.toUtc) - x(iv.fromUtc)), BAND_ROW);
    });
    // Nachtdiagramm: Filterbalken und Blöcke (Session-Soll/Ist) unter den Stundenstreifen
    if (!plan && blocks.length > 0) {
      let top =
        plotB +
        (drawnBands.length === 0 ? 0 : drawnBands.length * (BAND_ROW + BAND_GAP)) +
        BAND_GAP;
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
          ctx.strokeStyle = c('chart-meridian');
          ctx.lineWidth = 2;
          ctx.strokeRect(x0 + 1, top + 1, Math.max(1, w - 2), h - 2);
          ctx.lineWidth = 1;
        }
        if (w > 60) {
          ctx.fillStyle = c('chart-frame');
          ctx.save();
          ctx.beginPath();
          ctx.rect(x0, top, w, h);
          ctx.clip();
          ctx.fillText(b.label, x0 + 3, top + h / 2);
          ctx.restore();
        }
      }
    }
    // Höhenachse 0/30/60/90°
    ctx.font = font(11);
    ctx.fillStyle = c('chart-axis');
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const alt of [0, 30, 60, 90])
      ctx.fillText(
        `${String(alt)}°`,
        PAD.left - 5,
        Math.min(Math.max(y(alt), plotT + 6), plotB - 6),
      );
    // Zeitachse: Standortzeit, darunter gedämpft die zweite Zone; Kürzel am Ende jeder Zeile (NT-03)
    const axisY = plotB + bandsH + 5;
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
    drawTicks(ticks, c('chart-axis-strong'), axisY);
    drawTicks(secondaryTicks, c('chart-axis'), axisY + AXIS_ROW);
    ctx.textAlign = 'left';
    ctx.font = font(11, '600 ');
    ctx.fillStyle = c('chart-axis-strong');
    ctx.fillText(formatTzAbbr(iso(win.endUtc), timeZone), PAD.left + plotW + 6, axisY);
    if (secondaryTimeZone) {
      ctx.fillStyle = c('chart-axis');
      ctx.fillText(
        formatTzAbbr(iso(win.endUtc), secondaryTimeZone),
        PAD.left + plotW + 6,
        axisY + AXIS_ROW,
      );
    }
  }, [
    win,
    width,
    twilight,
    sun,
    shown,
    primary,
    moon,
    markers,
    minAltDeg,
    ticks,
    secondaryTicks,
    cursor,
    controlled,
    props.height,
    drawnBands,
    bandsH,
    extraH,
    topH,
    blocks,
    filterBars,
    off,
    secondaryTimeZone,
    best,
    plan,
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
  if (series.length === 0 && blocks.length === 0)
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
  const moveCursor = (at: number) => {
    const next = Math.max(win.startUtc, Math.min(win.endUtc, Math.round(at / STEP) * STEP));
    if (props.onCursorChange) props.onCursorChange(next);
    if (!controlled) setOwnCursor(next);
    return next;
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Enter') return;
    e.preventDefault();
    const base = cursor ?? win.startUtc;
    if (e.key === 'Enter') {
      props.onSelect?.(base);
      return;
    }
    moveCursor(base + (e.key === 'ArrowRight' ? STEP : -STEP));
  };
  const interactive = Boolean(props.onCursorChange ?? props.onSelect);
  /** Zeitpunkt unter dem Zeiger (Breite aus der Messung, damit es auch ohne Layout-Engine rechnet). */
  const atPointer = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const plotW = Math.max(1, width - PAD.left - PAD.right);
    const f = (e.clientX - rect.left - PAD.left) / plotW;
    return win.startUtc + Math.max(0, Math.min(1, f)) * (win.endUtc - win.startUtc);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!interactive) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    moveCursor(atPointer(e));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current && props.onCursorChange) moveCursor(atPointer(e));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    const at = moveCursor(atPointer(e));
    props.onSelect?.(at);
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
  const legendAt = props.legend ?? 'top';
  const legendOnTop = legendAt === 'top';
  const hasMeridian = markers.some((m) => m.kind === 'transit' || m.kind === 'flip');
  const hasNow = controlled || markers.some((m) => m.kind === 'now');
  const legendBox =
    legendAt === 'none' ? null : (
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
            <span
              className={styles.swatchMoon}
              style={{
                background: `rgba(229, 72, 77, ${moonAlpha(moon.illuminationPct).toFixed(3)})`,
              }}
            />
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
        {!plan && drawnBands.length === 0 && (sun ?? twilight) ? (
          <span className={styles.legendKey}>
            <span className={`${styles.swatchBox} ${styles.keyDark}`} />
            {t('nightChart.key.dark')}
          </span>
        ) : null}
        {hasMeridian ? (
          <span className={styles.legendKey}>
            <span className={styles.keyMeridian} />
            {t('nightChart.key.meridian')}
          </span>
        ) : null}
        {hasNow ? (
          <span className={styles.legendKey}>
            <span className={styles.keyNow} />
            {t('nightChart.key.now')}
          </span>
        ) : null}
        {best && !plan ? (
          <span className={styles.legendKey}>
            <span className={styles.keyBest} />
            {t('nightChart.key.best')}
          </span>
        ) : null}
        {drawnBands.map((b) => (
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

  // Kennwerte neben dem Diagramm (Objektbrowser): Höhe zur Uhrzeit, höchster Stand, Mond, Zeit über Mindesthöhe
  const nowAt = cursor ?? markers.find((m) => m.kind === 'now')?.atUtc ?? null;
  const nowAlt = nowAt !== null && primary ? valueAt(primary.points, nowAt) : null;
  const aboveBand = bands.find((b) => b.key === 'above');
  const factsBox =
    props.facts && primary ? (
      <dl className={styles.facts}>
        {nowAlt !== null && nowAt !== null ? (
          <div>
            <dt>{t('nightChart.facts.altAt', { time: hm(nowAt, timeZone) })}</dt>
            <dd>{nowAlt.toFixed(0)}°</dd>
          </div>
        ) : null}
        <div>
          <dt>{t('nightChart.facts.best')}</dt>
          <dd>
            {best
              ? t('nightChart.facts.bestValue', {
                  deg: best.altDeg.toFixed(0),
                  time: hm(best.atUtc, timeZone),
                })
              : '–'}
          </dd>
        </div>
        {moon ? (
          <div>
            <dt>{t('nightChart.moon')}</dt>
            <dd className={styles.factMoon}>
              {t('nightChart.facts.moonValue', { pct: moon.illuminationPct.toFixed(0) })}
            </dd>
          </div>
        ) : null}
        {aboveBand ? (
          <div>
            <dt>{t('nightChart.facts.above', { deg: minAltDeg ?? 0 })}</dt>
            <dd>{hours(aboveBand.totalSec)}</dd>
          </div>
        ) : null}
      </dl>
    ) : null;

  return (
    <figure className={styles.figure}>
      <div className={legendAt === 'side' ? styles.body : styles.bodyTop}>
        {legendOnTop ? legendBox : null}
        <div className={styles.chartCol}>
          <div className={styles.frame}>
            <div
              ref={wrapRef}
              className={`${styles.canvasWrap} ${interactive ? styles.interactive : ''}`}
              tabIndex={0}
              role="img"
              aria-label={t('nightChart.label', { zone: tz(win.startUtc) })}
              aria-describedby={liveId}
              onKeyDown={onKey}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              style={{
                height:
                  props.height === undefined
                    ? `calc(max(200px, var(--npm-chart-h) + 60px) + ${String(extraH)}px)`
                    : props.height + extraH,
              }}
            >
              <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
              <span className="visually-hidden">{tz(win.endUtc)}</span>
            </div>
            {factsBox}
          </div>
          <p id={liveId} className={styles.live} aria-live="polite">
            {cursor === null ? t('nightChart.keyboardHint') : describe(cursor)}
          </p>
        </div>
        {legendAt === 'side' ? legendBox : null}
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
                <th scope="row">
                  {m.label ||
                    t(m.kind === 'flip' ? 'nightChart.key.flip' : 'nightChart.key.meridian')}
                </th>
                <td>{clock(m.atUtc, timeZone)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
