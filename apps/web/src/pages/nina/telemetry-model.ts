/**
 * Rig-Zustand S-43 (AP-67, FA-RIG-17/18): Zeiträume, Diagramm-Aufteilung und Rechnungen ohne React. Je Diagramm
 * **eine** Einheit (eine y-Achse); der Taupunktabstand ist abgeleitet (Luft − Taupunkt, je Punkt aus den Mitteln).
 */
import type { TelemetrySeries } from '../../api/client';

export const TELEMETRY_RANGES = ['12h', '24h', '3d', '7d', '30d', '90d', '365d'] as const;
export type TelemetryRange = (typeof TELEMETRY_RANGES)[number];

const HOUR_MS = 3_600_000;
const RANGE_MS: Record<TelemetryRange, number> = {
  '12h': 12 * HOUR_MS,
  '24h': 24 * HOUR_MS,
  '3d': 72 * HOUR_MS,
  '7d': 7 * 24 * HOUR_MS,
  '30d': 30 * 24 * HOUR_MS,
  '90d': 90 * 24 * HOUR_MS,
  '365d': 365 * 24 * HOUR_MS,
};

export const isRange = (v: string | null): v is TelemetryRange =>
  v !== null && (TELEMETRY_RANGES as readonly string[]).includes(v);

/** Zeitraum bis jetzt, auf volle Minuten (stabile Abfrageschlüssel innerhalb einer Minute). */
export function rangeWindow(range: TelemetryRange, nowMs: number): { from: string; to: string } {
  const to = Math.ceil(nowMs / 60_000) * 60_000;
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return { from: iso(to - RANGE_MS[range]), to: iso(to) };
}

/** Ab diesem Abstand zum Taupunkt beschlägt die Optik praktisch schon (Glas strahlt 3–6 K unter die Luft ab). */
export const DEW_GAP_WARN_K = 3;
/** Ohne Messpunkt seit so vielen Minuten gilt eine Quelle als still. */
export const STALE_MIN = 15;

export type ChartKey =
  'temps' | 'load' | 'air' | 'dewGap' | 'humidity' | 'voltage' | 'current' | 'heaters';

export interface ChartSpec {
  readonly key: ChartKey;
  readonly source: TelemetrySeries['source'];
  readonly unit: string;
  /** Reihen in fester Reihenfolge (Farbe `plot-n` nach Stelle, nie nach Rang); höchstens drei je Diagramm. */
  readonly metrics: readonly string[];
  /** Feste Untergrenze bzw. Grenzen der y-Achse (Prozent 0…100). */
  readonly yMin?: number;
  readonly yMax?: number;
  /** Bezugslinie (z. B. 3 K beim Taupunktabstand). */
  readonly reference?: number;
}

export const CHARTS: readonly ChartSpec[] = [
  { key: 'temps', source: 'pc', unit: '°C', metrics: ['cpuMaxC', 'cpuAvgC', 'diskC'] },
  { key: 'load', source: 'pc', unit: '%', metrics: ['loadPct'], yMin: 0, yMax: 100 },
  { key: 'air', source: 'power_box', unit: '°C', metrics: ['airC', 'dewPointC'] },
  {
    key: 'dewGap',
    source: 'power_box',
    unit: 'K',
    metrics: ['dewGapK'],
    yMin: 0,
    reference: DEW_GAP_WARN_K,
  },
  { key: 'humidity', source: 'power_box', unit: '%', metrics: ['humidityPct'], yMin: 0, yMax: 100 },
  { key: 'voltage', source: 'power_box', unit: 'V', metrics: ['voltageV'] },
  { key: 'current', source: 'power_box', unit: 'A', metrics: ['currentA'], yMin: 0 },
  {
    key: 'heaters',
    source: 'power_box',
    unit: '%',
    metrics: ['dewHeater1Pct', 'dewHeater2Pct'],
    yMin: 0,
    yMax: 100,
  },
];

/** Reihe `avg` einer Messgröße; `dewGapK` abgeleitet aus Luft und Taupunkt. */
export function column(s: TelemetrySeries, metric: string): (number | null)[] {
  if (metric === 'dewGapK') {
    const air = s.series.airC?.avg ?? [];
    const dew = s.series.dewPointC?.avg ?? [];
    return s.t.map((_, i) => {
      const a = air[i];
      const d = dew[i];
      return a == null || d == null ? null : Math.round((a - d) * 100) / 100;
    });
  }
  return s.series[metric]?.avg ?? s.t.map(() => null);
}

/** Jüngster Wert einer Messgröße (`dewGapK` aus dem jüngsten Messpunkt). */
export function latestValue(s: TelemetrySeries, metric: string): number | null {
  const v = s.latest?.values;
  if (!v) return null;
  if (metric === 'dewGapK')
    return v.airC === undefined || v.dewPointC === undefined
      ? null
      : Math.round((v.airC - v.dewPointC) * 100) / 100;
  return v[metric] ?? null;
}

/** Wertebereich der y-Achse mit etwas Luft; feste Grenzen der Spezifikation gewinnen. */
export function yDomain(
  values: readonly (number | null)[],
  spec: Pick<ChartSpec, 'yMin' | 'yMax' | 'reference'>,
): [number, number] {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (spec.reference !== undefined) finite.push(spec.reference);
  let lo = finite.length > 0 ? Math.min(...finite) : 0;
  let hi = finite.length > 0 ? Math.max(...finite) : 1;
  const pad = Math.max((hi - lo) * 0.1, 0.5);
  lo = spec.yMin ?? lo - pad;
  hi = spec.yMax ?? hi + pad;
  return hi > lo ? [lo, hi] : [lo, lo + 1];
}

/**
 * SVG-Pfad (Koordinaten 0…1000 × 0…100) einer Reihe; `null` und Lücken über `maxGapMs` unterbrechen die Linie
 * (fehlende Werte nie als 0 zeichnen).
 */
export function linePath(
  t: readonly number[],
  values: readonly (number | null)[],
  x: (ms: number) => number,
  y: (v: number) => number,
  maxGapMs: number,
): string {
  let d = '';
  let prev: number | null = null;
  values.forEach((v, i) => {
    const ms = t[i] as number;
    if (v === null || !Number.isFinite(v)) {
      prev = null;
      return;
    }
    const move = prev === null || ms - prev > maxGapMs;
    d += `${move ? 'M' : 'L'}${x(ms).toFixed(1)},${y(v).toFixed(2)}`;
    prev = ms;
  });
  return d;
}

/**
 * Fläche zwischen Minimum und Maximum (verdichtete Werte): je zusammenhängendem Abschnitt oben entlang `max`, unten
 * zurück entlang `min`; Lücken wie bei der Linie.
 */
export function bandPath(
  t: readonly number[],
  min: readonly (number | null)[],
  max: readonly (number | null)[],
  x: (ms: number) => number,
  y: (v: number) => number,
  maxGapMs: number,
): string {
  const parts: string[] = [];
  let seg: number[] = [];
  const flush = () => {
    if (seg.length > 1) {
      const top = seg.map(
        (i) => `${x(t[i] as number).toFixed(1)},${y(max[i] as number).toFixed(2)}`,
      );
      const bottom = [...seg]
        .reverse()
        .map((i) => `${x(t[i] as number).toFixed(1)},${y(min[i] as number).toFixed(2)}`);
      parts.push(`M${top.join('L')}L${bottom.join('L')}Z`);
    }
    seg = [];
  };
  t.forEach((ms, i) => {
    const ok = min[i] != null && max[i] != null;
    const last = seg.at(-1);
    if (!ok || (last !== undefined && ms - (t[last] as number) > maxGapMs)) flush();
    if (ok) seg.push(i);
  });
  flush();
  return parts.join('');
}

/** Größter Abstand zweier Punkte, der noch als Linie verbunden wird: das Dreifache des typischen Abstands. */
export function gapLimitMs(t: readonly number[], stepS: number): number {
  if (stepS > 0) return stepS * 3000;
  const diffs = t
    .slice(1)
    .map((v, i) => v - (t[i] as number))
    .sort((a, b) => a - b);
  const median = diffs[Math.floor(diffs.length / 2)] ?? 60_000;
  return Math.max(median * 3, 120_000);
}

/** Index des Punkts, der `ms` am nächsten liegt (für den Hover). */
export function nearestIndex(t: readonly number[], ms: number): number {
  let lo = 0;
  let hi = t.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((t[mid] as number) < ms) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs((t[lo - 1] as number) - ms) <= Math.abs((t[lo] as number) - ms))
    return lo - 1;
  return lo;
}
