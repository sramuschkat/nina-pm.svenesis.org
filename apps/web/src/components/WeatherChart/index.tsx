/**
 * `WeatherChart` – Astro-Wetter-Grafik (components.md §2.5, AP-23; Vorlage legacy/…/astro-weather.js
 * `render()`/`renderDay()`): 7-Tage-Übersicht mit Sonne/Mond, Modellzeile, Gesamtnote, Wolken (Modell,
 * ECMWF, dritte Meinung), Seeing und Transparenz (*geschätzt*), Wind, Temperatur/Taupunkt, Tagesbalken und
 * Nachtbewertung; darunter das Nachtdetail der gewählten Nacht mit allen Zeilen, Hilfsbewertungen und
 * Taugefahr. Der Baustein **bewertet nichts** – alle Scores kommen aus der Engine. Zeichnet mit
 * `devicePixelRatio`, folgt dem Container (ResizeObserver, nie horizontal scrollen), ist mit Tab
 * fokussierbar und mit ←/→ stundenweise abtastbar (Wert per `aria-live`), Textalternative als Tabelle.
 */
import { ratingIndex } from '@nina-pm/engine';
import { formatTzAbbr } from '@nina-pm/shared';
import { WEATHER } from '@nina-pm/ui-tokens';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ICON_SIZE, uiIcons, weatherIcons } from '../icons';
import { clock } from '../night-chart/model';
import {
  SCALE_STEPS,
  daylightFade,
  dewRisk,
  helperScore,
  inkColour,
  localDay,
  localHour,
  modelName,
  ratingColour,
  scoreColour,
  toUnit,
  unix,
  weatherIconKey,
  weatherTextKey,
  windColour,
} from './model';
import styles from './WeatherChart.module.css';

export { MODEL_NAMES, SCALE_STEPS, modelName, ratingColour, scoreColour } from './model';

type Num = number | null;

/** Stunde wie `payload.hours[]` (engine/weather.md §3.4), Zeitpunkt als ISO-UTC. */
export interface WeatherChartHour {
  tUtc: string;
  cloudTotalPct: Num;
  cloudLowPct: Num;
  cloudMidPct: Num;
  cloudHighPct: Num;
  cloudEcmwfPct: Num;
  cloudCmp3Pct: Num;
  tempC: Num;
  dewPointC: Num;
  humidityPct: Num;
  wind10Kmh: Num;
  gust10Kmh: Num;
  windDir10Deg: Num;
  jetKmh: Num;
  shearKmh: Num;
  visibilityM: Num;
  precipMm: Num;
  precipProbPct: Num;
  weatherCode: Num;
  aod: Num;
  dustUgM3: Num;
  pwvMm: Num;
  moonAltDeg: Num;
  modelId: string;
  cloudSrc: string | null;
  nest: boolean;
  aerosolMissing: boolean;
  seeingIncomplete: boolean;
  cloudScore: Num;
  seeingScore: Num;
  transparencyScore: Num;
  overallScore: Num;
  ratingIndex: Num;
}

/** Zeile je Nacht (`WeatherNight`, TK 8.2) mit den Anzeigeangaben der API. */
export interface WeatherChartNight {
  night: string;
  nightMean: Num;
  ratingIndex: Num;
  coveredSec: number;
  darknessSec: number;
  coverage: Num;
  bestWindow: {
    fromUtc: string;
    toUtc: string;
    sec: number;
    moonFreeSec: number;
    meanScore: number;
    fair: boolean;
  } | null;
  aerosolMissing: boolean;
  seeingIncomplete: boolean;
  darkFromUtc?: string | null;
  darkToUtc?: string | null;
  moonlessSec?: number;
  moonIllumPct?: number;
}

export interface WeatherWindow {
  night: string;
  startUtc: string;
  endUtc: string;
}

export interface WeatherChartProps {
  hours: readonly WeatherChartHour[];
  nights: readonly WeatherChartNight[];
  /** Nachtfenster (night.md §3): Spaltenbereich des Nachtdetails. */
  nightWindows: readonly WeatherWindow[];
  /** Astronomische Dunkelheit (night.md §2): Bezug von Nacht-Ø und bestem Fenster. */
  darkWindows: readonly WeatherWindow[];
  /** Sonnenhöhe je Stunde (Tageslicht-Abstufung), gleiche Reihenfolge wie `hours`. */
  sunAltDeg: readonly number[];
  nowUtc: string;
  /** Vorhersagehorizont (`forecast_days=7`). */
  days: number;
  timeZone: string;
  /** Quelle der dritten Wolkenzeile. */
  cmp3?: 'gem' | 'nbm' | 'base';
  region?: 'europe' | 'other';
  compact?: boolean;
  /**
   * Zeitzone des Geräts: weicht sie von der Standortzeit ab, steht unter den Stunden eine zweite, hellere
   * Stundenzeile in der Zeit des Users (Wunsch Sven 28.09.2026). Ohne Angabe die des Browsers.
   */
  deviceTimeZone?: string;
  /** Nur das Nachtdetail ohne Wochenübersicht und Skala (Heute Nacht, Wunsch Sven 27.09.2026). */
  detailOnly?: boolean;
  unit?: 'c' | 'f';
  /** Gewählte Nacht (Nachtdetail); ohne Angabe bzw. `null` die laufende oder kommende Nacht. */
  selectedNight?: string | null;
  onSelectNight?: (night: string) => void;
  state?: 'loading' | 'error' | 'ready';
  /** Zeitstempel des letzten Abrufs (leer- und Fehlerzustand). */
  fetchedAtUtc?: string | null;
  onRetry?: () => void;
}

const HOUR = 3600;
const MIN_WIDTH = 360;
const MIN_WIDTH_COMPACT = 160;
const LEFT = 132;
const RIGHT = 8;
const C = (name: string) => WEATHER[`wx-${name}`] ?? '#888';

export interface Row {
  key: string;
  h: number;
}
const WEEK_ROWS: Row[] = [
  { key: 'sky', h: 50 },
  { key: 'ticks', h: 20 },
  { key: 'model', h: 15 },
  { key: 'overall', h: 16 },
  { key: 'clouds', h: 16 },
  { key: 'clouds2', h: 11 },
  { key: 'cmp3', h: 11 },
  { key: 'seeing', h: 16 },
  { key: 'transp', h: 16 },
  { key: 'gap', h: 8 },
  { key: 'wind', h: 34 },
  { key: 'temp', h: 80 },
  { key: 'days', h: 22 },
  { key: 'rating', h: 32 },
];
const DETAIL_ROWS: Row[] = [
  { key: 'hours', h: 18 },
  { key: 'wx', h: 22 },
  { key: 'dark', h: 20 },
  { key: 'rating', h: 30 },
  ...[
    'overall',
    'clouds',
    'low',
    'mid',
    'high',
    'clouds2',
    'cmp3',
    'seeing',
    'transp',
    'pwv',
    'dust',
    'vis',
    'precip',
  ].map((key) => ({ key, h: 19 })),
  { key: 'gap', h: 6 },
  { key: 'wind', h: 26 },
  { key: 'windtxt', h: 17 },
  { key: 'temp', h: 17 },
  { key: 'dew', h: 17 },
  { key: 'spread', h: 17 },
  { key: 'hum', h: 17 },
];

/** Zeile `after` um eine Stundenzeile in Gerätezeit ergänzen (nur bei abweichender Zone). */
export function withDeviceRow(
  rows: Row[],
  after: string,
  key: string,
  h: number,
  dual: boolean,
): Row[] {
  if (!dual) return rows;
  const i = rows.findIndex((r) => r.key === after);
  return [...rows.slice(0, i + 1), { key, h }, ...rows.slice(i + 1)];
}

function browserZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function layout(rows: Row[], scale: number) {
  const r: Record<string, [number, number]> = {};
  let y = 0;
  for (const row of rows) {
    const h = Math.round(row.h * scale);
    r[row.key] = [y, y + h];
    y += h;
  }
  return { r, height: y + 4 };
}
const mid = (b: [number, number] | undefined) => (b ? (b[0] + b[1]) / 2 : 0);

/** Dichte aus den Tokens (`--npm-font-scale`), ohne eigene Logik je Stufe. */
function densityScale(): number {
  const v = Number(
    getComputedStyle(document.documentElement).getPropertyValue('--npm-font-scale').trim(),
  );
  return Number.isFinite(v) && v > 0 ? v : 1;
}

export function WeatherChart(props: WeatherChartProps) {
  const { t, i18n } = useTranslation();
  const { hours, nights, timeZone, compact = false, detailOnly = false, unit = 'c' } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const weekRef = useRef<HTMLCanvasElement>(null);
  const detailWrapRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [detailWidth, setDetailWidth] = useState(0);
  const [scale, setScale] = useState(1);
  const [cursor, setCursor] = useState<number | null>(null);
  const [tip, setTip] = useState<{ i: number; x: number; y: number } | null>(null);
  const [ownNight, setOwnNight] = useState<string | null>(null);
  const liveId = useId();
  const minWidth = compact ? MIN_WIDTH_COMPACT : MIN_WIDTH;

  const t0 = hours.length > 0 ? unix((hours[0] as WeatherChartHour).tUtc) : 0;
  const lastEnd =
    hours.length > 0 ? unix((hours[hours.length - 1] as WeatherChartHour).tUtc) + HOUR : 0;
  const nowUnix = unix(props.nowUtc);
  // Spaltenbereich: die Stundenreihe, mindestens aber bis zum Ende des Vorhersagehorizonts
  // (`forecast_days` ab dem heutigen UTC-Tag, TK 14); endet die Reihe früher, ist der Rest „keine Daten“.
  const horizonEnd = Math.floor(nowUnix / 86_400) * 86_400 + props.days * 86_400;
  const tEnd = Math.max(lastEnd, horizonEnd);
  const n = Math.max(1, Math.round((tEnd - t0) / HOUR));
  const nightOf = useMemo(() => {
    const byStart = props.nightWindows.map((w) => ({ w, s: unix(w.startUtc), e: unix(w.endUtc) }));
    return (at: number) => byStart.find((x) => at >= x.s && at < x.e)?.w.night ?? null;
  }, [props.nightWindows]);
  const nightByKey = useMemo(() => new Map(nights.map((x) => [x.night, x])), [nights]);
  const darkByKey = useMemo(
    () =>
      new Map(props.darkWindows.map((w) => [w.night, { s: unix(w.startUtc), e: unix(w.endUtc) }])),
    [props.darkWindows],
  );
  const firstNight = useMemo(() => {
    const upcoming = props.nightWindows.find((w) => unix(w.endUtc) > nowUnix);
    return upcoming?.night ?? props.nightWindows[0]?.night ?? null;
  }, [props.nightWindows, nowUnix]);
  // `null`/fehlend = noch keine Wahl → die laufende bzw. kommende Nacht.
  const selected = props.selectedNight ?? ownNight ?? firstNight;
  const selectNight = (night: string | null) => {
    if (!night) return;
    setOwnNight(night);
    props.onSelectNight?.(night);
  };

  // Zweite Stundenzeile in Gerätezeit, wenn sie von der Standortzeit abweicht (rules/ui.md).
  const device = props.deviceTimeZone ?? browserZone();
  const refIso = hours[0]?.tUtc ?? props.nowUtc;
  const siteAbbr = formatTzAbbr(refIso, timeZone);
  const deviceAbbr = device ? formatTzAbbr(refIso, device) : siteAbbr;
  const dual = device !== undefined && deviceAbbr !== siteAbbr;

  const ready = props.state !== 'loading' && hours.length > 0;
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => {
      setWidth(Math.max(minWidth, el.clientWidth));
      setDetailWidth(Math.max(minWidth, detailWrapRef.current?.clientWidth ?? el.clientWidth));
      setScale(densityScale());
    };
    measure();
    const mo =
      typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => measure());
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
  }, [ready, minWidth]);

  const week = useMemo(
    () =>
      compact
        ? layout(
            [
              { key: 'days', h: 16 },
              { key: 'rating', h: 30 },
            ],
            scale,
          )
        : layout(withDeviceRow(WEEK_ROWS, 'ticks', 'ticks2', 13, dual), scale),
    [compact, scale, dual],
  );
  const left = compact ? 0 : LEFT;
  const colW = width > 0 ? (width - left - RIGHT) / n : 0;
  /** Abstand der Stundenmarken: 6, 12 oder 24 h, sodass Marke und Symbol je ≥ 15 px Platz haben. */
  const tickStep = [6, 12, 24].find((h) => colW * h >= 30 * scale) ?? 24;
  const xOf = (at: number) => left + ((at - t0) / HOUR) * colW;
  const idxOf = (at: number) => Math.floor((at - t0) / HOUR);

  const temp = (c: Num) => toUnit(c, unit);
  const fmt = (v: Num, digits = 0) =>
    v === null
      ? '–'
      : new Intl.NumberFormat(i18n.language, {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        }).format(v);
  const pct = (s: Num) => (s === null ? '–' : `${fmt(s * 100)} %`);
  const ratingName = (r: Num) =>
    r === null ? t('weather.rating.none') : t(`weather.rating.${String(r)}`);
  const cmp3Label = t(
    `weather.thirdModel.${props.cmp3 ?? 'base'}${props.cmp3 === 'base' ? `.${props.region ?? 'other'}` : ''}`,
  );

  // ---- Wochengrafik ----------------------------------------------------------------------------
  useEffect(() => {
    const canvas = weekRef.current;
    const ctx = canvas?.getContext?.('2d');
    if (!canvas || !ctx || width === 0 || hours.length === 0) return;
    const { r, height } = week;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.height = `${String(height)}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C('bg');
    ctx.fillRect(0, 0, width, height);
    ctx.textBaseline = 'middle';
    const font = (px: number, weight = '') =>
      `${weight}${String(px * scale)}px system-ui, sans-serif`;
    ctx.font = font(10);
    const colX = (i: number) => left + i * colW;
    const plotEnd = left + n * colW;

    // Rest ohne Vorhersage: schraffiert und beschriftet, nicht als 0 (Grenzfall 1).
    if (lastEnd < tEnd) {
      const x0 = xOf(lastEnd);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, 0, plotEnd - x0, height);
      ctx.clip();
      ctx.strokeStyle = C('grid-day');
      for (let x = x0 - height; x < plotEnd; x += 8) {
        ctx.beginPath();
        ctx.moveTo(x, height);
        ctx.lineTo(x + height, 0);
        ctx.stroke();
      }
      ctx.restore();
      const label = t('weather.chart.noData');
      if (ctx.measureText(label).width + 8 <= plotEnd - x0) {
        ctx.fillStyle = C('text-bright');
        ctx.textAlign = 'center';
        ctx.fillText(label, (x0 + plotEnd) / 2, compact ? height / 2 : mid(r.overall));
      }
    }

    // Tageslicht-Tönung hinter den Zeilen
    if (!compact)
      hours.forEach((h, i) => {
        const sun = props.sunAltDeg[i] ?? -90;
        const k = Math.max(0, Math.min(1, (sun + 18) / 18));
        if (k <= 0) return;
        ctx.fillStyle = `rgba(120, 150, 190, ${String(0.1 * k)})`;
        const x = xOf(unix(h.tUtc));
        ctx.fillRect(x, 0, colW + 0.5, (r.temp ?? [0, 0])[1]);
      });

    const byDay = new Map<string, number[]>();
    hours.forEach((h, i) => {
      const day = localDay(unix(h.tUtc), timeZone);
      byDay.set(day, [...(byDay.get(day) ?? []), i]);
    });

    if (!compact) {
      // Raster alle 6 h (Ortszeit), Stundenmarken im Abstand `tickStep` (Symbole dazwischen)
      hours.forEach((h) => {
        const at = unix(h.tUtc);
        const hr = localHour(at, timeZone);
        if (hr % 6 !== 0) return;
        const x = Math.round(xOf(at));
        ctx.fillStyle = hr === 0 ? C('grid-day') : C('grid');
        ctx.fillRect(x, (r.sky ?? [0, 0])[0], 1, (r.temp ?? [0, 0])[1] - (r.sky ?? [0, 0])[0]);
        if (hr % tickStep === 0) {
          ctx.fillStyle = C('text');
          ctx.textAlign = 'center';
          ctx.fillText(String(hr).padStart(2, '0'), x, (r.ticks?.[0] ?? 0) + 6 * scale);
        }
      });
      // Gerätezeit darunter, heller – dieselben Zeitpunkte, die dort volle Stunden im Abstand sind.
      if (dual && device)
        hours.forEach((h) => {
          const at = unix(h.tUtc);
          const hd = localHour(at, device);
          if (hd % tickStep !== 0) return;
          ctx.fillStyle = C('text');
          ctx.globalAlpha = 0.6;
          ctx.textAlign = 'center';
          ctx.fillText(String(hd).padStart(2, '0'), Math.round(xOf(at)), mid(r.ticks2));
          ctx.globalAlpha = 1;
        });

      // Sonne und Mond als Höhenkurven (Stundenmitte)
      const sky = r.sky ?? [0, 0];
      const top = sky[0] + 6;
      const bottom = sky[1] - 4;
      const yAlt = (a: number) => bottom - (Math.max(0, Math.min(90, a)) / 90) * (bottom - top);
      ctx.beginPath();
      ctx.moveTo(xOf(t0), bottom);
      hours.forEach((h, i) =>
        ctx.lineTo(xOf(unix(h.tUtc) + 1800), yAlt(props.sunAltDeg[i] ?? -90)),
      );
      ctx.lineTo(xOf(lastEnd), bottom);
      ctx.closePath();
      ctx.fillStyle = C('sun-fill');
      ctx.fill();
      ctx.strokeStyle = C('sun');
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      hours.forEach((h, i) => {
        const x = xOf(unix(h.tUtc) + 1800);
        const y = yAlt(props.sunAltDeg[i] ?? -90);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.stroke();
      ctx.strokeStyle = C('moon');
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      let pen = false;
      hours.forEach((h) => {
        if (h.moonAltDeg === null) {
          pen = false;
          return;
        }
        const x = xOf(unix(h.tUtc) + 1800);
        const y = yAlt(h.moonAltDeg);
        if (pen) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        pen = true;
      });
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.fillRect(left, bottom, plotEnd - left, 1);

      // Wertzeilen in der Teilbewertungs-Rampe; Vergleichszeilen schmaler und blasser
      const scoreRows: [string, (h: WeatherChartHour) => Num][] = [
        ['overall', (h) => h.overallScore],
        ['clouds', (h) => h.cloudScore],
        ['clouds2', (h) => (h.cloudEcmwfPct === null ? null : helperScore.cloud(h.cloudEcmwfPct))],
        ['cmp3', (h) => (h.cloudCmp3Pct === null ? null : helperScore.cloud(h.cloudCmp3Pct))],
        ['seeing', (h) => h.seeingScore],
        ['transp', (h) => h.transparencyScore],
      ];
      for (const [key, value] of scoreRows) {
        const b = r[key] ?? [0, 0];
        ctx.globalAlpha = key === 'clouds2' || key === 'cmp3' ? 0.72 : 1;
        hours.forEach((h) => {
          ctx.fillStyle = scoreColour(value(h));
          ctx.fillRect(xOf(unix(h.tUtc)), b[0] + 1, colW + 0.5, b[1] - b[0] - 2);
        });
        ctx.globalAlpha = 1;
      }
      // Modellwechsel: gestrichelte Naht über die Wertzeilen
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = C('seam');
      hours.forEach((h, i) => {
        if (i === 0 || h.modelId === hours[i - 1]?.modelId) return;
        const x = Math.round(xOf(unix(h.tUtc))) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, (r.overall ?? [0, 0])[0]);
        ctx.lineTo(x, (r.transp ?? [0, 0])[1]);
        ctx.stroke();
      });
      ctx.restore();
      // Modellzeile: je Abschnitt Name (lang, sonst kurz), Nest hervorgehoben
      const mb = r.model ?? [0, 0];
      ctx.font = font(9);
      ctx.textAlign = 'center';
      let seg = 0;
      hours.forEach((h, i) => {
        const next = hours[i + 1];
        if (next && next.modelId === h.modelId && next.nest === h.nest) return;
        const x0 = colX(seg);
        const x1 = colX(i + 1);
        ctx.fillStyle = h.nest ? 'rgba(143, 179, 255, 0.28)' : 'rgba(255, 255, 255, 0.04)';
        ctx.fillRect(x0 + 1, mb[0] + 1, x1 - x0 - 2, mb[1] - mb[0] - 2);
        const long = modelName(h.modelId);
        const short = modelName(h.modelId, true);
        const w = x1 - x0 - 4;
        const label =
          w >= ctx.measureText(long).width + 6
            ? long
            : w >= ctx.measureText(short).width + 4
              ? short
              : '';
        if (label) {
          ctx.fillStyle = C('text-bright');
          ctx.fillText(label, (x0 + x1) / 2, mid(mb));
        }
        seg = i + 1;
      });
      ctx.font = font(10);

      // Wind: Punkte mit Pfeil (weht nach windDir + 180°) und Zahlenwert
      const step = Math.max(1, Math.ceil((22 * scale) / Math.max(colW, 0.1)));
      const wy = (r.wind?.[0] ?? 0) + 11 * scale;
      hours.forEach((h, i) => {
        if (i % step) return;
        const x = xOf(unix(h.tUtc)) + (step * colW) / 2;
        if (x + 8 * scale > plotEnd) return; // nicht über den Rand hinaus
        ctx.beginPath();
        ctx.arc(x, wy, 8 * scale, 0, 2 * Math.PI);
        ctx.fillStyle = windColour(h.wind10Kmh);
        ctx.fill();
        if (h.windDir10Deg !== null) {
          ctx.save();
          ctx.translate(x, wy);
          ctx.rotate(((h.windDir10Deg + 180) * Math.PI) / 180);
          ctx.beginPath();
          ctx.moveTo(0, 5.5 * scale);
          ctx.lineTo(0, -5.5 * scale);
          ctx.moveTo(-2.8 * scale, -2.5 * scale);
          ctx.lineTo(0, -5.5 * scale);
          ctx.lineTo(2.8 * scale, -2.5 * scale);
          ctx.strokeStyle = C('ink-light');
          ctx.lineWidth = 1.4;
          ctx.stroke();
          ctx.restore();
        }
        ctx.fillStyle = C('text');
        ctx.textAlign = 'center';
        ctx.fillText(fmt(h.wind10Kmh), x, (r.wind?.[1] ?? 0) - 6 * scale);
      });

      // Temperatur und Taupunkt
      const tb = r.temp ?? [0, 0];
      const values = hours
        .flatMap((h) => [temp(h.tempC), temp(h.dewPointC)])
        .filter((v): v is number => v !== null);
      if (values.length > 0) {
        const tMin = Math.min(...values) - 2;
        const tMax = Math.max(...values) + 2;
        const y0 = tb[0] + 10;
        const y1 = tb[1] - 8;
        const yT = (v: number) => y1 - ((v - tMin) / (tMax - tMin)) * (y1 - y0);
        for (const [key, color] of [
          ['tempC', C('temp')],
          ['dewPointC', C('dew')],
        ] as const) {
          ctx.beginPath();
          let started = false;
          hours.forEach((h) => {
            const v = temp(h[key]);
            if (v === null) return;
            const x = xOf(unix(h.tUtc)) + colW / 2;
            if (started) ctx.lineTo(x, yT(v));
            else ctx.moveTo(x, yT(v));
            started = true;
          });
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
        ctx.lineWidth = 1;
        // Tagesextreme als Beschriftung
        const placed: { x: number; y: number; w: number }[] = [];
        for (const idx of byDay.values()) {
          const pick = (key: 'tempC' | 'dewPointC', better: (a: number, b: number) => boolean) => {
            let best: number | null = null;
            for (const i of idx) {
              const v = hours[i]?.[key] ?? null;
              if (v !== null && (best === null || better(v, hours[best]?.[key] ?? v))) best = i;
            }
            return best;
          };
          const marks: [number | null, 'tempC' | 'dewPointC', string, number][] = [
            [pick('tempC', (a, b) => a > b), 'tempC', C('temp'), -8],
            [pick('tempC', (a, b) => a < b), 'tempC', C('temp'), -8],
            [pick('dewPointC', (a, b) => a < b), 'dewPointC', C('dew'), 9],
          ];
          if (idx.length * colW < 40) continue;
          for (const [i, key, color, dy] of marks) {
            if (i === null) continue;
            const v = temp(hours[i]?.[key] ?? null);
            if (v === null) continue;
            const x = Math.max(left + 12, Math.min(plotEnd - 12, colX(i) + colW / 2));
            const y = Math.max(tb[0] + 5, Math.min(tb[1] - 4, yT(v) + dy));
            const label = `${fmt(v)}°`;
            const w = ctx.measureText(label).width / 2 + 2;
            // Überlappende Beschriftungen (Temperatur und Taupunkt dicht beieinander) auslassen.
            if (placed.some((p) => Math.abs(p.x - x) < p.w + w && Math.abs(p.y - y) < 10 * scale))
              continue;
            placed.push({ x, y, w });
            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            ctx.fillText(label, x, y);
          }
        }
      }

      // Jetzt-Linie
      if (nowUnix >= t0 && nowUnix <= tEnd) {
        const x = xOf(nowUnix);
        ctx.fillStyle = C('now');
        ctx.fillRect(Math.round(x), (r.sky ?? [0, 0])[0], 1.5, tb[1] - (r.sky ?? [0, 0])[0]);
        const label = `${t('weather.chart.now')} ${clock(nowUnix, timeZone)}`;
        const lw = ctx.measureText(label).width + 8;
        const xl = Math.max(left + lw / 2 + 2, Math.min(plotEnd - lw / 2, x));
        ctx.fillRect(xl - lw / 2, (r.sky ?? [0, 0])[0] + 1, lw, 13);
        ctx.fillStyle = C('ink-light');
        ctx.textAlign = 'center';
        ctx.fillText(label, xl, (r.sky ?? [0, 0])[0] + 7.5);
      }
    }

    // Tagesbalken
    const db = r.days ?? [0, 0];
    ctx.fillStyle = C('day-bar');
    ctx.fillRect(left, db[0], plotEnd - left, db[1] - db[0]);
    for (const [day, idx] of byDay) {
      const x0 = colX(idx[0] ?? 0);
      const x1 = colX((idx[idx.length - 1] ?? 0) + 1);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.fillRect(Math.round(x0), db[0], 1, db[1] - db[0]);
      // Langer Wochentag, sonst kurzer, sonst nur das Datum – was in den Tag passt.
      const date = new Date(Date.parse(`${day}T12:00:00Z`));
      const variants = (['long', 'short', undefined] as const).map((weekday) =>
        new Intl.DateTimeFormat(i18n.language, {
          ...(weekday ? { weekday } : {}),
          day: '2-digit',
          month: '2-digit',
          timeZone: 'UTC',
        }).format(date),
      );
      ctx.font = font(11);
      const label = variants.find((v) => x1 - x0 > ctx.measureText(v).width + 8);
      if (label) {
        ctx.fillStyle = C('ink-light');
        ctx.textAlign = 'center';
        ctx.fillText(label, (x0 + x1) / 2, mid(db));
      }
      ctx.font = font(10);
    }

    // Nachtbewertung: Ampel der Gesamtnote nach Sonnenhöhe eingeblendet, Nacht-Ø darüber
    const rb = r.rating ?? [0, 0];
    const grad = ctx.createLinearGradient(left, 0, left + hours.length * colW, 0);
    hours.forEach((h, i) =>
      grad.addColorStop(
        (i + 0.5) / hours.length,
        ratingColour(h.overallScore, daylightFade(props.sunAltDeg[i] ?? 0)),
      ),
    );
    ctx.fillStyle = grad;
    ctx.fillRect(left, rb[0] + 16 * scale, hours.length * colW, rb[1] - rb[0] - 19 * scale);
    ctx.font = font(10, '600 ');
    ctx.textAlign = 'center';
    let lastRight = -Infinity;
    for (const w of props.nightWindows) {
      const night = nightByKey.get(w.night);
      const dark = darkByKey.get(w.night);
      const xc = dark
        ? (xOf(dark.s) + xOf(dark.e)) / 2
        : (xOf(unix(w.startUtc)) + xOf(unix(w.endUtc))) / 2;
      if (xc < left || xc > plotEnd) continue;
      let text: string;
      let color = C('text');
      if (!dark) text = t('weather.chart.noDarkShort');
      else if (!night || night.nightMean === null) continue;
      else {
        const p = pct(night.nightMean);
        const full = `${ratingName(night.ratingIndex)} ${p}`;
        text = ctx.measureText(full).width + 10 <= 22 * colW ? full : p;
        color = ratingColour(night.nightMean, 1);
      }
      const tw = ctx.measureText(text).width + 8;
      const x = Math.max(left + tw / 2, Math.min(plotEnd - tw / 2, xc));
      if (x - tw / 2 < lastRight + 4) continue;
      lastRight = x + tw / 2;
      ctx.fillStyle = color;
      ctx.fillText(text, x, rb[0] + 8 * scale);
    }
    ctx.font = font(10);

    // Beschriftungsspalte zuletzt
    if (!compact) {
      ctx.fillStyle = C('label-bg');
      ctx.fillRect(0, 0, LEFT - 2, height);
      ctx.textAlign = 'right';
      const labels: [string, string, string?, number?][] = [
        ...(dual
          ? ([
              ['ticks', t('weather.row.siteTime', { zone: siteAbbr })],
              ['ticks2', t('weather.row.deviceTime', { zone: deviceAbbr })],
            ] as [string, string][])
          : []),
        ['sky', t('weather.row.sunMoon')],
        ['model', t('weather.row.model')],
        ['overall', t('weather.row.overall')],
        ['clouds', t('weather.row.clouds')],
        ['clouds2', t('weather.row.ecmwf')],
        ['cmp3', cmp3Label],
        ['seeing', t('weather.row.seeing')],
        ['transp', t('weather.row.transparency')],
        ['wind', t('weather.row.wind')],
        ['temp', t('weather.row.temp'), C('temp'), -9],
        ['temp', t('weather.row.dew'), C('dew'), 9],
        ['rating', t('weather.row.night')],
      ];
      for (const [key, label, color, dy] of labels) {
        ctx.fillStyle = color ?? C('text');
        ctx.font = font(key === 'clouds2' || key === 'cmp3' ? 9 : 10);
        ctx.fillText(label, LEFT - 8, mid(r[key]) + (dy ?? 0) * scale);
      }
      ctx.font = font(10);
    }

    // Cursor der Tastatur
    if (cursor !== null) {
      ctx.strokeStyle = C('text-bright');
      ctx.setLineDash([2, 3]);
      const x = xOf(unix(hours[cursor]?.tUtc ?? '1970-01-01T00:00:00Z')) + colW / 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });

  // ---- Nachtdetail -----------------------------------------------------------------------------
  const detailWindow = props.nightWindows.find((w) => w.night === selected) ?? null;
  const detailCols = useMemo(() => {
    if (!detailWindow) return [];
    const s = unix(detailWindow.startUtc);
    const e = unix(detailWindow.endUtc);
    const cols: { at: number; h: WeatherChartHour | null; sun: number }[] = [];
    for (let at = Math.floor(s / HOUR) * HOUR; at < e; at += HOUR) {
      const i = idxOf(at);
      cols.push({
        at,
        h: hours[i] && unix(hours[i].tUtc) === at ? hours[i] : null,
        sun: props.sunAltDeg[i] ?? 0,
      });
    }
    return cols;
  }, [detailWindow, hours, props.sunAltDeg, t0]);
  const detail = useMemo(
    () => layout(withDeviceRow(DETAIL_ROWS, 'hours', 'hours2', 15, dual), scale),
    [scale, dual],
  );
  const detailColW = detailCols.length > 0 ? (detailWidth - LEFT - RIGHT) / detailCols.length : 0;

  useEffect(() => {
    const canvas = detailRef.current;
    const ctx = canvas?.getContext?.('2d');
    if (!canvas || !ctx || compact || detailWidth === 0 || detailCols.length === 0 || !detailWindow)
      return;
    const { r, height } = detail;
    const W = detailWidth;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.height = `${String(height)}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C('bg');
    ctx.fillRect(0, 0, W, height);
    ctx.textBaseline = 'middle';
    const font = (px: number, weight = '') =>
      `${weight}${String(px * scale)}px system-ui, sans-serif`;
    ctx.font = font(10);
    const cw = detailColW;
    const x0 = (i: number) => LEFT + i * cw;
    const showText = cw >= 24 * scale;
    const start = detailCols[0]?.at ?? 0;
    const xAt = (at: number) => LEFT + ((at - start) / HOUR) * cw;

    // Stunden und Raster
    detailCols.forEach((c, i) => {
      const hr = localHour(c.at, timeZone);
      ctx.fillStyle = hr === 0 ? C('grid-day') : C('grid');
      ctx.fillRect(
        Math.round(x0(i)),
        (r.dark ?? [0, 0])[0],
        1,
        (r.hum ?? [0, 0])[1] - (r.dark ?? [0, 0])[0],
      );
      if (cw >= 16 * scale || hr % 3 === 0) {
        ctx.fillStyle = C('text');
        ctx.textAlign = 'center';
        ctx.fillText(String(hr).padStart(2, '0'), x0(i) + cw / 2, mid(r.hours));
        if (dual && device) {
          ctx.globalAlpha = 0.6;
          ctx.fillText(
            String(localHour(c.at, device)).padStart(2, '0'),
            x0(i) + cw / 2,
            mid(r.hours2),
          );
          ctx.globalAlpha = 1;
        }
      }
    });

    // Dunkelheit mit mondfreien Stunden (Konvention der Vorlage: Mond unter −0,833°)
    const darkB = r.dark ?? [0, 0];
    const dark = darkByKey.get(detailWindow.night);
    if (dark) {
      ctx.fillStyle = 'rgba(143, 179, 255, 0.18)';
      ctx.fillRect(xAt(dark.s), darkB[0] + 2, xAt(dark.e) - xAt(dark.s), darkB[1] - darkB[0] - 4);
      detailCols.forEach((c) => {
        if (!c.h || c.h.moonAltDeg === null || c.h.moonAltDeg >= -0.833) return;
        const a = Math.max(c.at, dark.s);
        const b = Math.min(c.at + HOUR, dark.e);
        if (b <= a) return;
        ctx.fillStyle = C('dark');
        ctx.fillRect(xAt(a), darkB[1] - 6, xAt(b) - xAt(a), 3);
      });
      const txt = `${clock(dark.s, timeZone)} – ${clock(dark.e, timeZone)}`;
      ctx.fillStyle = C('text-bright');
      ctx.textAlign = 'center';
      if (ctx.measureText(txt).width + 8 < xAt(dark.e) - xAt(dark.s))
        ctx.fillText(txt, (xAt(dark.s) + xAt(dark.e)) / 2, darkB[0] + 8 * scale);
    } else {
      ctx.fillStyle = C('text-bright');
      ctx.textAlign = 'center';
      ctx.fillText(t('weather.chart.noDark'), (LEFT + W - RIGHT) / 2, mid(darkB));
    }

    // Nachtbewertung als Verlauf, darüber das Nacht-Ø
    const rb = r.rating ?? [0, 0];
    const grad = ctx.createLinearGradient(LEFT, 0, LEFT + detailCols.length * cw, 0);
    detailCols.forEach((c, i) =>
      grad.addColorStop(
        (i + 0.5) / detailCols.length,
        ratingColour(c.h?.overallScore ?? null, daylightFade(c.sun)),
      ),
    );
    ctx.fillStyle = grad;
    ctx.fillRect(LEFT, rb[0] + 15 * scale, detailCols.length * cw, rb[1] - rb[0] - 18 * scale);
    const night = nightByKey.get(detailWindow.night);
    if (night && night.nightMean !== null && dark) {
      ctx.font = font(11, '600 ');
      ctx.fillStyle = ratingColour(night.nightMean, 1);
      ctx.textAlign = 'center';
      ctx.fillText(
        `${ratingName(night.ratingIndex)} ${pct(night.nightMean)}`,
        Math.max(LEFT + 60, Math.min(W - RIGHT - 60, (xAt(dark.s) + xAt(dark.e)) / 2)),
        rb[0] + 8 * scale,
      );
      ctx.font = font(10);
    }

    // Wertzellen: Farbe aus Score bzw. Hilfsbewertung, Text = übergebener Messwert
    const cell = (
      key: string,
      value: (h: WeatherChartHour) => Num,
      colour: (v: number, h: WeatherChartHour) => Num,
      text: (v: number) => string,
    ) => {
      const b = r[key] ?? [0, 0];
      detailCols.forEach((c, i) => {
        const v = c.h ? value(c.h) : null;
        const s = v === null || !c.h ? null : colour(v, c.h);
        ctx.fillStyle = scoreColour(s);
        ctx.fillRect(x0(i) + 1, b[0] + 1, cw - 2, b[1] - b[0] - 2);
        if (v !== null && showText) {
          ctx.fillStyle = inkColour(s);
          ctx.textAlign = 'center';
          ctx.fillText(text(v), x0(i) + cw / 2, mid(b) + 0.5);
        }
      });
    };
    const same = (v: number) => v;
    const pct100 = (v: number) => fmt(v * 100);
    cell('overall', (h) => h.overallScore, same, pct100);
    cell(
      'clouds',
      (h) => h.cloudTotalPct,
      (_, h) => h.cloudScore,
      (v) => fmt(v),
    );
    cell(
      'low',
      (h) => h.cloudLowPct,
      helperScore.cloud,
      (v) => fmt(v),
    );
    cell(
      'mid',
      (h) => h.cloudMidPct,
      helperScore.cloud,
      (v) => fmt(v),
    );
    cell(
      'high',
      (h) => h.cloudHighPct,
      helperScore.cloud,
      (v) => fmt(v),
    );
    cell(
      'clouds2',
      (h) => h.cloudEcmwfPct,
      helperScore.cloud,
      (v) => fmt(v),
    );
    cell(
      'cmp3',
      (h) => h.cloudCmp3Pct,
      helperScore.cloud,
      (v) => fmt(v),
    );
    cell('seeing', (h) => h.seeingScore, same, pct100);
    cell(
      'transp',
      (h) => h.aod,
      (_, h) => h.transparencyScore,
      (v) => fmt(v, 2),
    );
    cell(
      'pwv',
      (h) => h.pwvMm,
      helperScore.pwv,
      (v) => fmt(v),
    );
    cell(
      'dust',
      (h) => h.dustUgM3,
      helperScore.dust,
      (v) => fmt(v),
    );
    cell(
      'vis',
      (h) => h.visibilityM,
      helperScore.visibility,
      (v) => fmt(v / 1000, v < 10_000 ? 1 : 0),
    );
    cell(
      'precip',
      (h) => h.precipProbPct,
      helperScore.precipProb,
      (v) => fmt(v),
    );

    // Wind, Temperatur, Taupunkt, Abstand (Taugefahr), Feuchte
    detailCols.forEach((c, i) => {
      const h = c.h;
      if (!h) return;
      const x = x0(i) + cw / 2;
      const wy = mid(r.wind);
      ctx.beginPath();
      ctx.arc(x, wy, Math.min(9 * scale, cw / 2 - 1), 0, 2 * Math.PI);
      ctx.fillStyle = windColour(h.wind10Kmh);
      ctx.fill();
      if (h.windDir10Deg !== null && cw >= 14) {
        ctx.save();
        ctx.translate(x, wy);
        ctx.rotate(((h.windDir10Deg + 180) * Math.PI) / 180);
        ctx.beginPath();
        ctx.moveTo(0, 6);
        ctx.lineTo(0, -6);
        ctx.moveTo(-3, -2.8);
        ctx.lineTo(0, -6);
        ctx.lineTo(3, -2.8);
        ctx.strokeStyle = C('ink-light');
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.restore();
        ctx.lineWidth = 1;
      }
      ctx.textAlign = 'center';
      const risk = dewRisk(h.tempC, h.dewPointC);
      if (risk) {
        const b = r.spread ?? [0, 0];
        ctx.fillStyle = risk === 'danger' ? C('dew-danger') : C('dew-warn');
        ctx.fillRect(x0(i) + 1, b[0] + 1, cw - 2, b[1] - b[0] - 2);
      }
      if (!showText) return;
      ctx.fillStyle = C('text');
      ctx.fillText(`${fmt(h.wind10Kmh)}/${fmt(h.gust10Kmh)}`, x, mid(r.windtxt));
      ctx.fillStyle = C('temp');
      ctx.fillText(`${fmt(temp(h.tempC))}°`, x, mid(r.temp));
      ctx.fillStyle = C('dew');
      ctx.fillText(`${fmt(temp(h.dewPointC))}°`, x, mid(r.dew));
      if (h.tempC !== null && h.dewPointC !== null) {
        const spread = h.tempC - h.dewPointC;
        ctx.fillStyle = C('text-bright');
        ctx.fillText(`${fmt(unit === 'f' ? (spread * 9) / 5 : spread, 1)}°`, x, mid(r.spread));
      }
      ctx.fillStyle = C('text');
      ctx.fillText(`${fmt(h.humidityPct)}%`, x, mid(r.hum));
    });

    // Modellnaht
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = C('seam');
    detailCols.forEach((c, i) => {
      const prev = detailCols[i - 1]?.h;
      if (!c.h || !prev || prev.modelId === c.h.modelId) return;
      const x = Math.round(x0(i)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, (r.overall ?? [0, 0])[0]);
      ctx.lineTo(x, (r.precip ?? [0, 0])[1]);
      ctx.stroke();
    });
    ctx.restore();

    // Jetzt-Linie
    const end = detailCols[detailCols.length - 1]?.at ?? 0;
    if (nowUnix >= start && nowUnix <= end + HOUR) {
      ctx.fillStyle = C('now');
      ctx.fillRect(
        Math.round(xAt(nowUnix)),
        (r.dark ?? [0, 0])[0],
        1.5,
        (r.hum ?? [0, 0])[1] - (r.dark ?? [0, 0])[0],
      );
    }

    // Beschriftung
    ctx.fillStyle = C('label-bg');
    ctx.fillRect(0, 0, LEFT - 2, height);
    ctx.textAlign = 'right';
    const labels: [string, string, string?][] = [
      ...(dual
        ? ([
            ['hours', t('weather.row.siteTime', { zone: siteAbbr })],
            ['hours2', t('weather.row.deviceTime', { zone: deviceAbbr })],
          ] as [string, string][])
        : []),
      ['wx', t('weather.row.symbol')],
      ['dark', t('weather.row.darkness')],
      ['rating', t('weather.row.night')],
      ['overall', t('weather.row.overall')],
      ['clouds', t('weather.row.cloudsPct')],
      ['low', t('weather.row.low')],
      ['mid', t('weather.row.mid')],
      ['high', t('weather.row.high')],
      ['clouds2', t('weather.row.ecmwf')],
      ['cmp3', cmp3Label],
      ['seeing', t('weather.row.seeing')],
      ['transp', t('weather.row.aod')],
      ['pwv', t('weather.row.pwv')],
      ['dust', t('weather.row.dust')],
      ['vis', t('weather.row.visibility')],
      ['precip', t('weather.row.precipProb')],
      ['wind', t('weather.row.wind')],
      ['windtxt', t('weather.row.windGust')],
      ['temp', `${t('weather.row.temp')} ${unit === 'f' ? '°F' : '°C'}`, C('temp')],
      ['dew', t('weather.row.dew'), C('dew')],
      ['spread', t('weather.row.spread')],
      ['hum', t('weather.row.humidity')],
    ];
    for (const [key, label, color] of labels) {
      ctx.fillStyle = color ?? C('text');
      ctx.fillText(label, LEFT - 8, mid(r[key]));
    }
  });

  // ---- Zustände ---------------------------------------------------------------------------------
  if (props.state === 'loading')
    return <div className={styles.skeleton} role="status" aria-label={t('common.loading')} />;
  const lastFetch = props.fetchedAtUtc
    ? t('weather.chart.fetchedAt', { at: clock(unix(props.fetchedAtUtc), timeZone) })
    : null;
  if (hours.length === 0)
    return (
      <div className={styles.message} role={props.state === 'error' ? 'alert' : 'status'}>
        <p>{props.state === 'error' ? t('weather.chart.error') : t('weather.chart.empty')}</p>
        {lastFetch ? <p className={styles.muted}>{lastFetch}</p> : null}
        {props.state === 'error' && props.onRetry ? (
          <button type="button" className={styles.retry} onClick={props.onRetry}>
            {t('common.retry')}
          </button>
        ) : null}
      </div>
    );

  // ---- Texte ------------------------------------------------------------------------------------
  const zone = formatTzAbbr(hours[0]?.tUtc ?? props.nowUtc, timeZone);
  const hoursText = (sec: number) => fmt(sec / HOUR, 1);
  const flags = (h: { aerosolMissing: boolean; seeingIncomplete: boolean }) =>
    [
      h.aerosolMissing ? t('weather.flag.aerosolMissing') : null,
      h.seeingIncomplete ? t('weather.flag.seeingIncomplete') : null,
    ].filter((x): x is string => x !== null);
  const nightFlags = (x: WeatherChartNight) => [
    ...flags(x),
    ...(x.coverage !== null && x.coverage < 1
      ? [t('weather.flag.incomplete', { pct: fmt(x.coverage * 100) })]
      : []),
  ];
  const nightLabel = (night: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      timeZone: 'UTC',
    }).format(new Date(Date.parse(`${night}T12:00:00Z`)));
  const verdict = (night: string | null) => {
    if (!night) return null;
    const x = nightByKey.get(night);
    const label = nightLabel(night);
    if (!darkByKey.has(night)) return t('weather.verdict.noDark', { night: label });
    if (!x || x.nightMean === null) return t('weather.verdict.noData', { night: label });
    const mean = `${ratingName(x.ratingIndex)} ${pct(x.nightMean)}`;
    const w = x.bestWindow;
    if (!w) return t('weather.verdict.noWindow', { night: label, mean });
    return t(w.fair ? 'weather.verdict.fair' : 'weather.verdict.good', {
      night: label,
      mean,
      h: hoursText(w.sec),
      from: clock(unix(w.fromUtc), timeZone),
      to: clock(unix(w.toUtc), timeZone),
      free: hoursText(w.moonFreeSec),
    });
  };
  const describe = (i: number) => {
    const h = hours[i];
    if (!h) return '';
    return [
      clock(unix(h.tUtc), timeZone),
      modelName(h.modelId),
      `${t('weather.row.overall')} ${pct(h.overallScore)} ${ratingName(h.ratingIndex)}`,
      `${t('weather.row.cloudsPct')} ${fmt(h.cloudTotalPct)} %`,
      ...flags(h),
    ].join(' · ');
  };
  const tipLines = (i: number) => {
    const h = hours[i];
    if (!h) return [];
    const wx = weatherTextKey(h.weatherCode);
    const u = unit === 'f' ? '°F' : '°C';
    return [
      clock(unix(h.tUtc), timeZone),
      wx ? `${t('weather.tip.symbol')}: ${t(`weather.wx.${wx}`)}` : null,
      `${t('weather.row.overall')}: ${ratingName(h.ratingIndex)} (${pct(h.overallScore)})`,
      `${t('weather.row.cloudsPct')} (${modelName(h.modelId)}${h.nest ? `, ${t('weather.tip.nest')}` : ''}): ${fmt(h.cloudTotalPct)} % · ${t('weather.tip.layers', { l: fmt(h.cloudLowPct), m: fmt(h.cloudMidPct), h: fmt(h.cloudHighPct) })}`,
      h.cloudEcmwfPct === null ? null : `${t('weather.row.ecmwf')}: ${fmt(h.cloudEcmwfPct)} %`,
      h.cloudCmp3Pct === null ? null : `${cmp3Label}: ${fmt(h.cloudCmp3Pct)} %`,
      `${t('weather.row.seeing')}: ${pct(h.seeingScore)} · ${t('weather.tip.jet', { jet: fmt(h.jetKmh), shear: fmt(h.shearKmh), wind: fmt(h.wind10Kmh) })}`,
      `${t('weather.row.transparency')}: ${h.aod === null ? t('weather.flag.aerosolMissing') : `${pct(h.transparencyScore)} (AOD ${fmt(h.aod, 2)}${h.dustUgM3 === null ? '' : ` · ${t('weather.row.dust')} ${fmt(h.dustUgM3)} µg/m³`})`}`,
      h.pwvMm === null ? null : `${t('weather.row.pwv')}: ${fmt(h.pwvMm)} mm`,
      `${t('weather.row.wind')}: ${fmt(h.wind10Kmh)} km/h · ${t('weather.tip.gusts')} ${fmt(h.gust10Kmh)} km/h`,
      h.visibilityM === null
        ? null
        : `${t('weather.row.visibility')}: ${fmt(h.visibilityM / 1000, h.visibilityM < 10_000 ? 1 : 0)} km`,
      `${t('weather.tip.precip')}: ${fmt(h.precipProbPct)} % · ${fmt(h.precipMm, 1)} mm`,
      `${t('weather.row.temp')} ${fmt(temp(h.tempC))}${u} · ${t('weather.row.dew')} ${fmt(temp(h.dewPointC))}${u} · ${t('weather.row.humidity')} ${fmt(h.humidityPct)} %`,
      ...flags(h),
    ].filter((x): x is string => x !== null);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Enter') return;
    e.preventDefault();
    const base = cursor ?? Math.max(0, Math.min(hours.length - 1, idxOf(nowUnix)));
    if (e.key === 'Enter') {
      selectNight(nightOf(unix(hours[base]?.tUtc ?? props.nowUtc)));
      return;
    }
    setCursor(Math.max(0, Math.min(hours.length - 1, base + (e.key === 'ArrowRight' ? 1 : -1))));
  };
  const hitWeek = (e: MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const i = Math.floor((x - left) / colW);
    return x >= left && i >= 0 && i < hours.length ? { i, x, y: e.clientY - rect.top } : null;
  };

  // Wettersymbole je 6 h (03/09/15/21 Ortszeit, der schwerste Code der sechs Stunden) als Lucide-Symbole.
  const symbols =
    compact || colW <= 0
      ? []
      : hours.flatMap((h, i) => {
          const at = unix(h.tUtc);
          if (localHour(at, timeZone) % tickStep !== tickStep / 2) return [];
          let worst: number | null = null;
          const half = Math.min(3, tickStep / 2);
          for (let k = Math.max(0, i - half); k < Math.min(hours.length, i + half); k += 1) {
            const c = hours[k]?.weatherCode ?? null;
            if (c !== null && (worst === null || c > worst)) worst = c;
          }
          const key = weatherIconKey(worst, (props.sunAltDeg[i] ?? 0) < -0.833);
          return key ? [{ key, at, x: xOf(at) }] : [];
        });
  const ticksTop = week.r.ticks?.[0] ?? 0;
  const Prev = uiIcons.previous;
  const Next = uiIcons.next;
  const nightKeys = props.nightWindows.map((w) => w.night);
  const selIndex = selected ? nightKeys.indexOf(selected) : -1;
  const selectedNightRow = selected ? nightByKey.get(selected) : undefined;

  return (
    <figure className={`${styles.figure} ${props.state === 'error' ? styles.stale : ''}`}>
      {props.state === 'error' ? (
        <div className={styles.message} role="alert">
          <p>{t('weather.chart.errorStale')}</p>
          {lastFetch ? <p className={styles.muted}>{lastFetch}</p> : null}
          {props.onRetry ? (
            <button type="button" className={styles.retry} onClick={props.onRetry}>
              {t('common.retry')}
            </button>
          ) : null}
        </div>
      ) : null}
      {detailOnly ? (
        // Nur zum Messen der Breite (ResizeObserver); die Wochenübersicht entfällt.
        <div ref={wrapRef} aria-hidden="true" />
      ) : (
        <>
          {!compact ? <p className={styles.verdict}>{verdict(selected)}</p> : null}
          <div
            ref={wrapRef}
            className={compact ? styles.wrapCompact : styles.wrap}
            tabIndex={0}
            role="img"
            aria-label={t('weather.chart.label', { zone })}
            aria-describedby={liveId}
            onKeyDown={onKey}
          >
            <canvas
              ref={weekRef}
              className={styles.canvas}
              aria-hidden="true"
              onMouseMove={(e) => setTip(hitWeek(e))}
              onMouseLeave={() => setTip(null)}
              onClick={(e) => {
                const hit = hitWeek(e);
                setTip(hit);
                if (hit) selectNight(nightOf(unix(hours[hit.i]?.tUtc ?? props.nowUtc)));
              }}
            />
            {symbols.map((s) => {
              const Icon = weatherIcons[s.key];
              return (
                <span
                  key={s.at}
                  className={styles.symbol}
                  style={{ left: s.x, top: ticksTop + 10 * scale }}
                  aria-hidden="true"
                >
                  <Icon size={12} />
                </span>
              );
            })}
            {tip && !compact ? (
              <div
                className={styles.tip}
                style={{
                  left: Math.min(tip.x + 14, Math.max(0, width - 300)),
                  top: Math.min(tip.y + 14, Math.max(0, week.height - 200)),
                }}
                role="tooltip"
              >
                {tipLines(tip.i).map((line, k) => (
                  <div key={line} className={k === 0 ? styles.tipHead : undefined}>
                    {line}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <p id={liveId} className={styles.live} aria-live="polite">
            {cursor === null ? t('weather.chart.keyboardHint') : describe(cursor)}
          </p>
          {!compact ? (
            <div className={styles.scale} aria-label={t('weather.scale.title')}>
              <span>{t('weather.scale.title')}</span>
              {SCALE_STEPS.map(([s, r]) => (
                <span key={r} className={styles.scaleItem}>
                  <span className={styles.swatch} style={{ background: scoreColour(s) }} />
                  {t(`weather.rating.${String(r)}`)}
                </span>
              ))}
              <span className={styles.muted}>{t('weather.scale.estimated')}</span>
              <span className={styles.muted}>{t('weather.scale.precip')}</span>
            </div>
          ) : null}
        </>
      )}
      {!compact && detailWindow ? (
        <section
          className={styles.detail}
          aria-label={t('weather.detail.title', { night: nightLabel(detailWindow.night) })}
        >
          <div className={styles.detailHead}>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => selectNight(nightKeys[selIndex - 1] ?? null)}
              disabled={selIndex <= 0}
              aria-label={t('weather.detail.previous')}
              title={t('weather.detail.previous')}
            >
              <Prev size={ICON_SIZE.button} aria-hidden />
            </button>
            <h3>{t('weather.detail.title', { night: nightLabel(detailWindow.night) })}</h3>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => selectNight(nightKeys[selIndex + 1] ?? null)}
              disabled={selIndex < 0 || selIndex >= nightKeys.length - 1}
              aria-label={t('weather.detail.next')}
              title={t('weather.detail.next')}
            >
              <Next size={ICON_SIZE.button} aria-hidden />
            </button>
            {selectedNightRow ? (
              <span className={styles.flags}>{nightFlags(selectedNightRow).join(' · ')}</span>
            ) : null}
          </div>
          <div ref={detailWrapRef} className={styles.wrap}>
            <canvas ref={detailRef} className={styles.canvas} aria-hidden="true" />
            {detailCols.map((c, i) => {
              const key = c.h ? weatherIconKey(c.h.weatherCode, c.sun < -0.833) : null;
              if (!key || detailColW < 14) return null;
              const Icon = weatherIcons[key];
              return (
                <span
                  key={c.at}
                  className={styles.symbol}
                  style={{
                    left: LEFT + (i + 0.5) * detailColW,
                    top: (detail.r.wx?.[0] ?? 0) + 11 * scale,
                  }}
                  aria-hidden="true"
                >
                  <Icon size={14} />
                </span>
              );
            })}
          </div>
        </section>
      ) : null}
      <details className={styles.details}>
        <summary>{t('weather.chart.table')}</summary>
        <table className={styles.table}>
          <caption className="visually-hidden">{t('weather.chart.tableCaption', { zone })}</caption>
          <thead>
            <tr>
              <th scope="col">{t('weather.col.time')}</th>
              <th scope="col">{t('weather.col.model')}</th>
              <th scope="col">{t('weather.row.cloudsPct')}</th>
              <th scope="col">{t('weather.row.overall')}</th>
              <th scope="col">{t('weather.col.cloudScore')}</th>
              <th scope="col">{t('weather.row.seeing')}</th>
              <th scope="col">{t('weather.row.transparency')}</th>
              <th scope="col">{t('weather.row.windGust')}</th>
              <th scope="col">{t('weather.col.tempDew')}</th>
              <th scope="col">{t('weather.row.visibility')}</th>
              <th scope="col">{t('weather.col.rain')}</th>
              <th scope="col">{t('weather.col.flags')}</th>
            </tr>
          </thead>
          <tbody>
            {hours.map((h) => {
              const cls = (s: Num) =>
                s === null ? '–' : `${pct(s)} ${ratingName(ratingIndex(s))}`;
              return (
                <tr key={h.tUtc}>
                  <th scope="row">{clock(unix(h.tUtc), timeZone)}</th>
                  <td>{modelName(h.modelId)}</td>
                  <td>{fmt(h.cloudTotalPct)} %</td>
                  <td>
                    {h.overallScore === null
                      ? '–'
                      : `${pct(h.overallScore)} ${ratingName(h.ratingIndex)}`}
                  </td>
                  <td>{cls(h.cloudScore)}</td>
                  <td>{cls(h.seeingScore)}</td>
                  <td>{cls(h.transparencyScore)}</td>
                  <td>
                    {fmt(h.wind10Kmh)}/{fmt(h.gust10Kmh)} km/h
                  </td>
                  <td>
                    {fmt(temp(h.tempC))}/{fmt(temp(h.dewPointC))} {unit === 'f' ? '°F' : '°C'}
                  </td>
                  <td>{h.visibilityM === null ? '–' : `${fmt(h.visibilityM / 1000, 1)} km`}</td>
                  <td>
                    {fmt(h.precipMm, 1)} mm · {fmt(h.precipProbPct)} %
                  </td>
                  <td>{flags(h).join(' · ')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{t('weather.col.night')}</th>
              <th scope="col">{t('weather.col.nightMean')}</th>
              <th scope="col">{t('weather.col.coverage')}</th>
              <th scope="col">{t('weather.col.bestWindow')}</th>
              <th scope="col">{t('weather.col.flags')}</th>
            </tr>
          </thead>
          <tbody>
            {props.nightWindows.map((w) => {
              const x = nightByKey.get(w.night);
              const noDark = !darkByKey.has(w.night);
              return (
                <tr key={w.night}>
                  <th scope="row">{nightLabel(w.night)}</th>
                  <td>
                    {noDark
                      ? t('weather.chart.noDark')
                      : x?.nightMean === null || !x
                        ? '–'
                        : `${pct(x.nightMean)} ${ratingName(x.ratingIndex)}`}
                  </td>
                  <td>{x?.coverage === null || !x ? '–' : pct(x.coverage)}</td>
                  <td>
                    {x?.bestWindow
                      ? `${clock(unix(x.bestWindow.fromUtc), timeZone)} – ${clock(unix(x.bestWindow.toUtc), timeZone)} (${hoursText(x.bestWindow.sec)} h, ${t('weather.col.moonFree', { h: hoursText(x.bestWindow.moonFreeSec) })}${x.bestWindow.fair ? `, ${t('weather.verdict.fairShort')}` : ''})`
                      : '–'}
                  </td>
                  <td>{x ? nightFlags(x).join(' · ') : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
