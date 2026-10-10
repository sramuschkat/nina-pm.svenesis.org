/**
 * Bausteine der Sessionqualität (AP-77, components.md §2.28/§2.29):
 * - `QualityBar`: Leiste gut | auffällig | verworfen (verworfen gestreift), Beschriftung über `aria-label`.
 * - `QualityText`: „x % gut · y % ⚠ auffällig (Grund)“ bzw. „· y % ✕ verworfen“; ohne bewertete Lights „keine Messwerte“.
 * - `Sparkline`: Verlauf einer Messgröße über die Nacht mit gestrichelter Grenzlinie, auffällige Punkte markiert.
 * Farben nur über Tokens (`quality-*`, `plot-1`, `violet`, `warning`), nie nur Farbe: Text steht immer daneben.
 */
import { shareLabelPct, type QualityCounts } from '@nina-pm/shared';
import { useTranslation } from 'react-i18next';
import styles from './quality.module.css';

type Counts = Pick<
  QualityCounts,
  'good' | 'flagged' | 'rejected' | 'none' | 'sharePct' | 'reasons'
>;

const pctOf = (n: number, total: number) =>
  total === 0 || n === 0 ? 0 : Math.max(1, Math.round((n / total) * 100));

/** Gründe der auffälligen Lights als „3 HFR, 1 Wolken“ (häufigster zuerst). */
export function reasonText(
  reasons: Counts['reasons'],
  t: (key: string) => string,
  withCounts = true,
): string {
  return (Object.entries(reasons) as [keyof Counts['reasons'], number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([m, n]) =>
      withCounts
        ? `${String(n)} ${t(`sessionQuality.metric.${m}`)}`
        : t(`sessionQuality.metric.${m}`),
    )
    .join(', ');
}

export function QualityBar({ counts, size = 'sm' }: { counts: Counts; size?: 'sm' | 'md' }) {
  const { t } = useTranslation();
  const total = counts.good + counts.flagged + counts.rejected;
  if (total === 0) return <div className={`${styles.bar} ${styles[size]} ${styles.empty}`} />;
  return (
    <div
      className={`${styles.bar} ${styles[size]}`}
      role="img"
      aria-label={t('sessionQuality.barLabel', {
        good: counts.good,
        flagged: counts.flagged,
        rejected: counts.rejected,
      })}
    >
      {counts.good > 0 ? <span className={styles.good} style={{ flexGrow: counts.good }} /> : null}
      {counts.flagged > 0 ? (
        <span className={styles.flagged} style={{ flexGrow: counts.flagged }} />
      ) : null}
      {counts.rejected > 0 ? (
        <span className={styles.rejected} style={{ flexGrow: counts.rejected }} />
      ) : null}
    </div>
  );
}

export function QualityText({ counts, showCount = true }: { counts: Counts; showCount?: boolean }) {
  const { t } = useTranslation();
  if (counts.sharePct === null)
    return <span className={styles.none}>{t('sessionQuality.noMetrics')}</span>;
  const total = counts.good + counts.flagged + counts.rejected;
  const reasons = reasonText(counts.reasons, t);
  return (
    <span className={styles.text}>
      <span className={styles.goodText}>
        {t('sessionQuality.good', { pct: shareLabelPct(counts.sharePct) })}
        {showCount && counts.flagged === 0 && counts.rejected === 0 ? (
          <span className={styles.count}> ({counts.good})</span>
        ) : null}
      </span>
      {counts.flagged > 0 ? (
        <span className={styles.flaggedText}>
          {' · '}
          {t('sessionQuality.flagged', { pct: pctOf(counts.flagged, total) })}
          {reasons ? ` (${reasons})` : ''}
        </span>
      ) : null}
      {counts.rejected > 0 ? (
        <span className={styles.rejectedText}>
          {' · '}
          {t('sessionQuality.rejected', { pct: pctOf(counts.rejected, total) })}
        </span>
      ) : null}
    </span>
  );
}

export interface SparkPoint {
  readonly x: number;
  readonly y: number | null;
  readonly flagged?: boolean;
}

/**
 * Kleiner Verlauf (§2.29): Punkte in Aufnahmereihenfolge, y-Achse von `min` bis `max` (Standard: aus den Werten und der
 * Grenze), Grenze gestrichelt. Nur Anzeige – die Beschriftung trägt `label`.
 */
export function Sparkline({
  points,
  limit,
  label,
  tone,
  width = 150,
  height = 28,
  min,
  max,
}: {
  points: readonly SparkPoint[];
  limit: number | null;
  label: string;
  tone: 'hfr' | 'rms';
  width?: number;
  height?: number;
  min?: number;
  max?: number;
}) {
  const values = points.flatMap((p) => (p.y === null ? [] : [p.y]));
  if (values.length < 2)
    return (
      <span className={styles.sparkEmpty} role="img" aria-label={label}>
        –
      </span>
    );
  const lo = min ?? Math.min(...values, ...(limit === null ? [] : [limit]));
  const hi = max ?? Math.max(...values, ...(limit === null ? [] : [limit]));
  const span = hi - lo || 1;
  const pad = 3;
  const xs = points.map((p) => p.x);
  const x0 = Math.min(...xs);
  const xSpan = Math.max(...xs) - x0 || 1;
  const px = (x: number) => ((x - x0) / xSpan) * width;
  const py = (y: number) => pad + (1 - (y - lo) / span) * (height - 2 * pad);
  const line = points
    .flatMap((p) => (p.y === null ? [] : [`${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`]))
    .join(' ');
  return (
    <svg
      className={styles.spark}
      width={width}
      height={height}
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      role="img"
      aria-label={label}
    >
      {limit !== null ? (
        <line
          className={styles.limit}
          x1={0}
          x2={width}
          y1={py(limit)}
          y2={py(limit)}
          strokeDasharray="3 3"
        />
      ) : null}
      <polyline className={tone === 'hfr' ? styles.hfrLine : styles.rmsLine} points={line} />
      {points.map((p, i) =>
        p.flagged && p.y !== null ? (
          <circle key={i} className={styles.flagDot} cx={px(p.x)} cy={py(p.y)} r={2.2} />
        ) : null,
      )}
    </svg>
  );
}
