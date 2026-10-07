/**
 * HFR- und Sterne-Verlauf über die Nacht (AP-64, FA-AUS-08): Punkte je gespeichertem Light, farbig nach Filter, dazu
 * Meridian-Flip als Marke und Lücken im Ist schraffiert. Gezeichnet als HTML mit Prozent-Lagen (Punkte bleiben rund,
 * die Breite folgt dem Container); Stunden in Standortzeit mit Kürzel. Rein darstellend – Daten kommen von der Seite.
 */
import { formatTzAbbr, formatZonedTime } from '@nina-pm/shared';
import { useTranslation } from 'react-i18next';
import type { NightSessionCapture, NightSessionDetail } from '../../api/client';
import { useEquipmentList } from '../equipment/shared';
import { metricPoints, type MetricPoint, type NightGap } from './night-model';
import styles from './evaluation.module.css';

const iso = (sec: number) => new Date(sec * 1000).toISOString();

export function MetricsChart({
  captures,
  events,
  gaps,
  timeZone,
  fromUtc,
  toUtc,
}: {
  captures: readonly NightSessionCapture[];
  events: NightSessionDetail['events'];
  gaps: readonly NightGap[];
  timeZone: string;
  fromUtc: string;
  toUtc: string | null;
}) {
  const { t, i18n } = useTranslation();
  const filters = useEquipmentList('filters');
  const colorOf = (short: string) =>
    (filters.data ?? []).find((f) => f.shortName === short)?.colorHex ?? '#888888';
  const points = metricPoints(captures);
  if (points.length === 0) return null;
  const first = points[0] as MetricPoint;
  const last = points.at(-1) as MetricPoint;
  const start = Math.min(Date.parse(fromUtc) / 1000, first.atS);
  const end = Math.max(toUtc ? Date.parse(toUtc) / 1000 : last.atS, last.atS, start + 3600);
  const x = (sec: number) => ((sec - start) / (end - start)) * 100;
  const flips = events
    .filter((e) => e.kind === 'flip')
    .map((e) => Date.parse(e.occurredAt) / 1000)
    .filter((s) => s >= start && s <= end);
  const shownGaps = gaps.filter((g) => g.toUtc > start && g.fromUtc < end && g.kind !== 'flip');
  // Volle Standortstunden als Achse (höchstens etwa 8 Beschriftungen).
  const ticks: number[] = [];
  const step = Math.max(1, Math.ceil((end - start) / 3600 / 8)) * 3600;
  for (let s = Math.ceil(start / 3600) * 3600; s <= end; s += step) ticks.push(s);
  const n = (v: number, d = 2) => v.toLocaleString(i18n.language, { maximumFractionDigits: d });
  const panel = (key: 'hfr' | 'stars') => {
    const values = points.flatMap((p) => (p[key] === null ? [] : [p[key] as number]));
    if (values.length === 0) return null;
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = Math.max((hi - lo) * 0.15, key === 'hfr' ? 0.1 : 10);
    const min = Math.max(0, lo - pad);
    const max = hi + pad;
    const y = (v: number) => ((v - min) / (max - min)) * 100;
    const label = t(`evaluation.captures.${key}Axis`);
    return (
      <div className={styles.metricPanel} data-kind={key}>
        <span className={styles.metricAxis} aria-hidden="true">
          <span>{n(max, key === 'hfr' ? 1 : 0)}</span>
          <span>{label}</span>
          <span>{n(min, key === 'hfr' ? 1 : 0)}</span>
        </span>
        <div className={styles.metricPlot} aria-hidden="true">
          {shownGaps.map((g) => (
            <span
              key={`gap-${String(g.fromUtc)}`}
              className={styles.metricGap}
              style={{
                left: `${String(Math.max(0, x(g.fromUtc)))}%`,
                width: `${String(Math.max(0.3, x(Math.min(end, g.toUtc)) - x(Math.max(start, g.fromUtc))))}%`,
              }}
            />
          ))}
          {flips.map((f) => (
            <span
              key={`flip-${String(f)}`}
              className={styles.metricFlip}
              style={{ left: `${String(x(f))}%` }}
            >
              {key === 'hfr' ? (
                <span className={styles.metricFlipLabel}>{t('evaluation.captures.flip')}</span>
              ) : null}
            </span>
          ))}
          {points.map((p) =>
            p[key] === null ? null : (
              <span
                key={`${key}-${String(p.atS)}-${p.filter}`}
                className={styles.metricDot}
                title={`${formatZonedTime(iso(p.atS), timeZone)} · ${p.filter} · ${n(p[key] as number)}`}
                style={{
                  left: `${String(x(p.atS))}%`,
                  bottom: `${String(y(p[key] as number))}%`,
                  background: colorOf(p.filter),
                }}
              />
            ),
          )}
        </div>
      </div>
    );
  };
  const legend = [...new Set(points.map((p) => p.filter))];
  const hfrValues = points.flatMap((p) => (p.hfr === null ? [] : [p.hfr]));
  const summary = t('evaluation.captures.chartSummary', {
    count: points.length,
    min: hfrValues.length ? n(Math.min(...hfrValues)) : '–',
    max: hfrValues.length ? n(Math.max(...hfrValues)) : '–',
    flips: flips.length,
  });
  return (
    <figure className={styles.metrics} role="img" aria-label={summary}>
      {panel('hfr')}
      {panel('stars')}
      <div className={styles.metricTicks} aria-hidden="true">
        {ticks.map((s) => (
          <span key={s} style={{ left: `${String(x(s))}%` }}>
            {formatZonedTime(iso(s), timeZone).slice(0, 2)}
          </span>
        ))}
        <span className={styles.metricZone}>{formatTzAbbr(iso(end), timeZone)}</span>
      </div>
      <figcaption className={styles.metricLegend} aria-hidden="true">
        {legend.map((f) => (
          <span key={f}>
            <span className={styles.legendDot} style={{ background: colorOf(f) }} />
            {f}
          </span>
        ))}
        {flips.length > 0 ? (
          <span>
            <span className={styles.legendFlip} />
            {t('evaluation.captures.flip')}
          </span>
        ) : null}
        {shownGaps.length > 0 ? (
          <span>
            <span className={styles.legendGap} />
            {t('evaluation.captures.gap')}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
