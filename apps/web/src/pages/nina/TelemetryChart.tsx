/**
 * Ein Diagramm des Rig-Zustands (S-43, AP-67): eine Einheit, eine y-Achse, Linien je Messgröße in fester Farbfolge
 * (`plot-n` nach Stelle), Lücken unterbrechen die Linie. Fadenkreuz mit Werten beim Überfahren bzw. per
 * Pfeiltasten; Legende ab zwei Reihen; Zeiten in Standortzeit mit Kürzel. Gezeichnet als SVG (0…1000 × 0…100,
 * Linien mit `non-scaling-stroke`), Beschriftungen als HTML. Rein darstellend – Daten kommen von der Seite.
 */
import { formatTzAbbr, formatZonedTime } from '@nina-pm/shared';
import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TelemetrySeries } from '../../api/client';
import { formatDate } from '../../lib/time';
import {
  bandPath,
  column,
  maxPoint,
  smooth,
  smoothWindowMs,
  gapLimitMs,
  linePath,
  nearestIndex,
  yDomain,
  type ChartSpec,
} from './telemetry-model';
import styles from './telemetry.module.css';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const iso = (ms: number) => new Date(ms).toISOString();

/** Abstand der Standortzeit zu UTC in ms (nur zur Rasterung der Achse; Anzeige über `Intl`). */
function zoneOffsetMs(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return wall - Math.floor(ms / 60_000) * 60_000;
}

/** Beschriftete Zeitmarken: höchstens etwa 8, auf ganze Stunden bzw. Tage der Standortzeit. */
function ticks(fromMs: number, toMs: number, timeZone: string): number[] {
  const span = toMs - fromMs;
  const steps = [1, 2, 3, 6, 12]
    .map((h) => h * HOUR_MS)
    .concat([1, 2, 7, 14, 30, 60].map((d) => d * DAY_MS));
  const step = steps.find((s) => span / s <= 8) ?? 60 * DAY_MS;
  const off = zoneOffsetMs(toMs, timeZone);
  const out: number[] = [];
  for (let t = Math.ceil((fromMs + off) / step) * step - off; t <= toMs; t += step)
    if (t >= fromMs) out.push(t);
  return out;
}

export function TelemetryChart({
  spec,
  data,
  fromMs,
  toMs,
  timeZone,
}: {
  spec: ChartSpec;
  data: TelemetrySeries;
  fromMs: number;
  toMs: number;
  timeZone: string;
}) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const times = data.t.map((v) => Date.parse(v));
  const columns = spec.metrics.map((m) => ({ metric: m, values: column(data, m) }));
  const shown = columns.filter((c) => c.values.some((v) => v !== null));
  const title = t(`telemetry.chart.${spec.key}`);
  const n = (v: number) =>
    v.toLocaleString(i18n.language, { maximumFractionDigits: Math.abs(v) < 10 ? 2 : 1 });
  if (shown.length === 0)
    return (
      <figure className={styles.chart} aria-labelledby={titleId}>
        <figcaption id={titleId} className={styles.chartTitle}>
          {title} <span className={styles.unit}>({spec.unit})</span>
        </figcaption>
        <p className={styles.empty}>{t('telemetry.noData')}</p>
      </figure>
    );
  const [lo, hi] = yDomain(
    shown.flatMap((c) => c.values),
    spec,
  );
  const x = (ms: number) => ((ms - fromMs) / (toMs - fromMs)) * 1000;
  const y = (v: number) => 100 - ((v - lo) / (hi - lo)) * 100;
  const maxGap = gapLimitMs(times, data.stepS);
  // Stundenwerte: blasses Band Minimum–Maximum hinter der Mittelwertlinie (kurze Spitzen bleiben sichtbar).
  const banded = data.resolution === 'hourly';
  // Rohwerte rauschen (30-s-Takt): blass darunter, darüber das gleitende Mittel (Rückmeldung Sven 08.10.2026).
  const smoothed = data.resolution === 'raw' && times.length > 30;
  const smoothMs = smoothWindowMs(toMs - fromMs);
  const peak = spec.annotateMax ? maxPoint(column(data, spec.annotateMax)) : null;
  const color = (i: number) => `var(--npm-plot-${String(i + 1)})`;
  const summary = t('telemetry.chartSummary', {
    title,
    series: shown.map((c) => t(`telemetry.metric.${c.metric}`)).join(', '),
    min: n(lo),
    max: n(hi),
    unit: spec.unit,
  });

  const pick = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const ms = fromMs + ((e.clientX - box.left) / box.width) * (toMs - fromMs);
    setHover(times.length > 0 ? nearestIndex(times, ms) : null);
  };
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (times.length === 0) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const cur = hover ?? times.length - 1;
      setHover(Math.max(0, Math.min(times.length - 1, cur + (e.key === 'ArrowLeft' ? -1 : 1))));
    } else if (e.key === 'Escape') setHover(null);
  };
  const hovered = hover !== null ? times[hover] : undefined;
  // Rechts steht das Zonenkürzel – Marken in den letzten 8 % entfallen, damit nichts überlappt.
  const tickList = ticks(fromMs, toMs, timeZone).filter((ms) => x(ms) <= 920);
  const longRange = toMs - fromMs > 3 * DAY_MS;

  return (
    <figure className={styles.chart} aria-labelledby={titleId}>
      <figcaption id={titleId} className={styles.chartTitle}>
        {title} <span className={styles.unit}>({spec.unit})</span>
      </figcaption>
      {shown.length > 1 ? (
        <div className={styles.legend} aria-hidden="true">
          {shown.map((c) => (
            <span key={c.metric}>
              <span
                className={styles.legendLine}
                style={{ background: color(spec.metrics.indexOf(c.metric)) }}
              />
              {t(`telemetry.metric.${c.metric}`)}
            </span>
          ))}
        </div>
      ) : null}
      <div className={styles.plotRow}>
        <span className={styles.yAxis} aria-hidden="true">
          <span>{n(hi)}</span>
          <span>{n(lo)}</span>
        </span>
        <div
          className={styles.plot}
          role="img"
          aria-label={summary}
          tabIndex={0}
          onPointerMove={pick}
          onPointerLeave={() => setHover(null)}
          onKeyDown={keys}
          onBlur={() => setHover(null)}
        >
          <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
            {[0.25, 0.5, 0.75].map((f) => (
              <line key={f} x1="0" x2="1000" y1={f * 100} y2={f * 100} className={styles.grid} />
            ))}
            {spec.reference !== undefined && spec.reference > lo && spec.reference < hi ? (
              <line
                x1="0"
                x2="1000"
                y1={y(spec.reference)}
                y2={y(spec.reference)}
                className={styles.reference}
              />
            ) : null}
            {banded
              ? shown.map((c) =>
                  data.series[c.metric] ? (
                    <path
                      key={`band-${c.metric}`}
                      d={bandPath(
                        times,
                        data.series[c.metric]?.min ?? [],
                        data.series[c.metric]?.max ?? [],
                        x,
                        y,
                        maxGap,
                      )}
                      className={styles.band}
                      style={{ fill: color(spec.metrics.indexOf(c.metric)) }}
                    />
                  ) : null,
                )
              : null}
            {shown.map((c) =>
              smoothed ? (
                <path
                  key={`raw-${c.metric}`}
                  d={linePath(times, c.values, x, y, maxGap)}
                  className={styles.lineRaw}
                  style={{ stroke: color(spec.metrics.indexOf(c.metric)) }}
                />
              ) : null,
            )}
            {shown.map((c) => (
              <path
                key={c.metric}
                d={linePath(
                  times,
                  smoothed ? smooth(times, c.values, smoothMs, maxGap) : c.values,
                  x,
                  y,
                  maxGap,
                )}
                className={styles.line}
                style={{ stroke: color(spec.metrics.indexOf(c.metric)) }}
              />
            ))}
            {hovered !== undefined ? (
              <line x1={x(hovered)} x2={x(hovered)} y1="0" y2="100" className={styles.crosshair} />
            ) : null}
          </svg>
          {peak && times[peak.i] !== undefined ? (
            <>
              <span
                className={styles.peakDot}
                style={{
                  left: `${String(x(times[peak.i] as number) / 10)}%`,
                  top: `${String(y(peak.v))}%`,
                }}
                aria-hidden="true"
              />
              <span
                className={styles.peakLabel}
                style={{
                  ...(x(times[peak.i] as number) > 700
                    ? { right: `${String(100 - x(times[peak.i] as number) / 10 + 1)}%` }
                    : { left: `${String(x(times[peak.i] as number) / 10 + 1)}%` }),
                  top: `${String(y(peak.v))}%`,
                }}
              >
                {t('telemetry.peak', {
                  value: n(peak.v),
                  unit: spec.unit,
                  time: `${longRange ? `${formatDate(iso(times[peak.i] as number), timeZone, i18n.language).slice(0, 6)} ` : ''}${formatZonedTime(iso(times[peak.i] as number), timeZone)}`,
                })}
              </span>
            </>
          ) : null}
          {spec.reference !== undefined && spec.reference > lo && spec.reference < hi ? (
            <span
              className={styles.referenceLabel}
              style={{ top: `${String(y(spec.reference))}%` }}
              aria-hidden="true"
            >
              {t('telemetry.reference', { value: n(spec.reference), unit: spec.unit })}
            </span>
          ) : null}
          {hover !== null && hovered !== undefined ? (
            <div
              className={styles.tooltip}
              style={
                x(hovered) > 600
                  ? { right: `${String(100 - x(hovered) / 10)}%` }
                  : { left: `${String(x(hovered) / 10)}%` }
              }
              role="status"
            >
              <strong>
                {longRange ? `${formatDate(iso(hovered), timeZone, i18n.language)} ` : ''}
                {formatZonedTime(iso(hovered), timeZone)} {formatTzAbbr(iso(hovered), timeZone)}
              </strong>
              {shown.map((c) => {
                const v = c.values[hover];
                return (
                  <span key={c.metric}>
                    <span
                      className={styles.legendLine}
                      style={{ background: color(spec.metrics.indexOf(c.metric)) }}
                      aria-hidden="true"
                    />
                    {t(`telemetry.metric.${c.metric}`)}:{' '}
                    {v === null || v === undefined ? '–' : `${n(v)} ${spec.unit}`}
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
      <div className={styles.xAxis} aria-hidden="true">
        {tickList.map((ms) => (
          <span key={ms} style={{ left: `${String(x(ms) / 10)}%` }}>
            {longRange
              ? formatDate(iso(ms), timeZone, i18n.language).slice(0, 6)
              : formatZonedTime(iso(ms), timeZone)}
          </span>
        ))}
        <span className={styles.zone}>{formatTzAbbr(iso(toMs), timeZone)}</span>
      </div>
    </figure>
  );
}
