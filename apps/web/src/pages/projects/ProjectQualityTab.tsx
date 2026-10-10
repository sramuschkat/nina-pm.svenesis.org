/**
 * Reiter „Qualität“ des Projekts (AP-77, S-31, FA-AUS-25; ersetzt „Bilder“ aus AP-72b): Anteil guter Lights je Nacht und
 * Filter als Matrix (Grund in der Zelle, Summe je Nacht und je Filter, Klick auf die Nacht öffnet sie), Verlauf über die
 * Nächte (umschaltbar HFR, Sterne, Guiding, % gut) und die Dateiliste zum Stacken (alle bzw. nur gute Lights, relativer
 * Pfad zum NINA-Bildordner). Keine Bildtabelle, keine Markierung einzelner Bilder.
 */
import { formatNightKey, shareLabelPct } from '@nina-pm/shared';
import { useQuery } from '@tanstack/react-query';
import { Fragment, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { sessionsApi, type ProjectQualityView, type QualityStats } from '../../api/client';
import { FilterChip } from '../../components/FilterChip';
import { ProblemMessage } from '../../components/ProblemMessage';
import { reasonText } from '../../components/quality';
import { problemCode } from '../admin/shared';
import { useEquipmentList } from '../equipment/shared';
import { nightWeekday, sessionPath } from '../sessions/evaluation';
import styles from './quality.module.css';

/** Stufe einer Zelle für die Hinterlegung (≥ 99 %, 95–98 %, 85–94 %, darunter); Text steht immer dabei. */
export function shareTier(pct: number | null): 'top' | 'good' | 'fair' | 'poor' | 'none' {
  if (pct === null) return 'none';
  const p = shareLabelPct(pct);
  if (p >= 99) return 'top';
  if (p >= 95) return 'good';
  if (p >= 85) return 'fair';
  return 'poor';
}

export const TREND_METRICS = ['hfr', 'stars', 'rms', 'share'] as const;
export type TrendMetric = (typeof TREND_METRICS)[number];

/** Wert einer Kennzahl für den Verlauf (Median bzw. Anteil). */
export function trendValue(s: QualityStats, metric: TrendMetric): number | null {
  switch (metric) {
    case 'hfr':
      return s.hfr?.median ?? null;
    case 'stars':
      return s.stars?.median ?? null;
    case 'rms':
      return s.rmsArcsec?.median ?? null;
    default:
      return s.sharePct;
  }
}

export function ProjectQualityTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const view = useQuery({
    queryKey: ['project-quality', projectId],
    queryFn: () => sessionsApi.projectQuality(projectId),
  });
  if (view.isPending) return <p role="status">{t('common.loading')}</p>;
  if (view.isError)
    return <ProblemMessage code={problemCode(view.error)} onRetry={() => void view.refetch()} />;
  if (view.data.nights.length === 0)
    return <p className={styles.muted}>{t('projectQuality.empty')}</p>;
  return (
    <div className={styles.quality}>
      <div className={styles.columns}>
        <Matrix view={view.data} />
        <Trend view={view.data} />
      </div>
      <Files projectId={projectId} view={view.data} />
    </div>
  );
}

function useFilterColor() {
  const filters = useEquipmentList('filters');
  return (short: string) =>
    (filters.data ?? []).find((f) => f.shortName === short)?.colorHex ?? '#888888';
}

function Matrix({ view }: { view: ProjectQualityView }) {
  const { t, i18n } = useTranslation();
  const colorOf = useFilterColor();
  const headingId = useId();
  const filters = view.filters.map((f) => f.filter);
  const pct = (s: QualityStats) =>
    s.sharePct === null ? '–' : `${String(shareLabelPct(s.sharePct))} %`;
  const nightLabel = (night: string) =>
    `${nightWeekday(night, i18n.language)} ${formatNightKey(night)}`;
  const cell = (s: QualityStats | undefined, label: string) => {
    if (!s) return <td className={styles.cell} data-tier="none" aria-label={`${label}: –`} />;
    const total = s.good + s.flagged + s.rejected + s.none;
    const reasons = reasonText(s.reasons, t);
    return (
      <td className={styles.cell} data-tier={shareTier(s.sharePct)}>
        <strong>{pct(s)}</strong>
        <span className={styles.cellSub}>
          {total}
          {reasons ? ` · ${reasons}` : ''}
          {s.rejected > 0 ? ` · ${t('projectQuality.rejected', { count: s.rejected })}` : ''}
        </span>
      </td>
    );
  };
  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.title}>
        {t('projectQuality.matrixTitle')}
      </h2>
      <div className={styles.tableWrap}>
        <table className={styles.matrix}>
          <caption className={styles.srOnly}>{t('projectQuality.matrixTitle')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('projectQuality.night')}</th>
              {filters.map((f) => (
                <th key={f} scope="col">
                  <FilterChip shortName={f} color={colorOf(f)} size="sm" />
                </th>
              ))}
              <th scope="col">{t('projectQuality.nightTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {view.nights.map((n) => {
              const first = n.sessionIds[0];
              return (
                <tr key={n.night}>
                  <th scope="row">
                    {first ? (
                      <Link to={sessionPath(first, true)}>{nightLabel(n.night)}</Link>
                    ) : (
                      nightLabel(n.night)
                    )}
                  </th>
                  {filters.map((f) => (
                    <Fragment key={f}>
                      {cell(
                        n.filters.find((x) => x.filter === f),
                        `${nightLabel(n.night)} · ${f}`,
                      )}
                    </Fragment>
                  ))}
                  {cell(n.total, nightLabel(n.night))}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{t('projectQuality.total')}</th>
              {view.filters.map((f) => (
                <Fragment key={f.filter}>{cell(f, f.filter)}</Fragment>
              ))}
              {cell(view.total, t('projectQuality.total'))}
            </tr>
          </tfoot>
        </table>
      </div>
      <ul className={styles.legend} aria-label={t('projectQuality.legend')}>
        {(['top', 'good', 'fair', 'poor'] as const).map((k) => (
          <li key={k}>
            <span className={styles.legendBox} data-tier={k} aria-hidden="true" />
            {t(`projectQuality.tier.${k}`)}
          </li>
        ))}
      </ul>
      <p className={styles.muted}>{t('projectQuality.matrixHint')}</p>
    </section>
  );
}

const W = 640;
const H = 240;
const PAD = { left: 48, right: 16, top: 16, bottom: 34 };

function Trend({ view }: { view: ProjectQualityView }) {
  const { t, i18n } = useTranslation();
  const colorOf = useFilterColor();
  const headingId = useId();
  const [metric, setMetric] = useState<TrendMetric>('hfr');
  const nights = [...view.nights].reverse();
  const series = view.filters.map((f) => ({
    filter: f.filter,
    points: nights.flatMap((n, i) => {
      const s = n.filters.find((x) => x.filter === f.filter);
      const v = s ? trendValue(s, metric) : null;
      return v === null ? [] : [{ i, v, night: n.night }];
    }),
  }));
  const values = series.flatMap((s) => s.points.map((p) => p.v));
  const digits = metric === 'stars' || metric === 'share' ? 0 : 2;
  const fmt = (v: number) =>
    v.toLocaleString(i18n.language, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  const lo0 = values.length ? Math.min(...values) : 0;
  const hi0 = values.length ? Math.max(...values) : 1;
  const span0 = hi0 - lo0 || Math.abs(hi0) * 0.1 || 1;
  const lo = metric === 'share' ? Math.min(lo0, 80) : lo0 - span0 * 0.15;
  const hi = metric === 'share' ? 100 : hi0 + span0 * 0.15;
  const x = (i: number) =>
    nights.length <= 1
      ? (PAD.left + W - PAD.right) / 2
      : PAD.left + (i / (nights.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo || 1)) * (H - PAD.top - PAD.bottom);
  const ticks = Array.from({ length: 4 }, (_, k) => lo + ((hi - lo) * (k + 0.5)) / 4);
  const labelEvery = Math.max(1, Math.ceil(nights.length / 8));
  const label = t('projectQuality.trendLabel', {
    metric: t(`projectQuality.metric.${metric}`),
    filters: series
      .map((s) => {
        const last = s.points.at(-1);
        return last ? `${s.filter} ${fmt(last.v)}` : null;
      })
      .filter(Boolean)
      .join(', '),
  });
  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <div className={styles.cardHead}>
        <h2 id={headingId} className={styles.title}>
          {t('projectQuality.trendTitle')}
        </h2>
        <div className={styles.toggle} role="group" aria-label={t('projectQuality.metricLabel')}>
          {TREND_METRICS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={metric === m}
              className={styles.toggleButton}
              onClick={() => setMetric(m)}
            >
              {t(`projectQuality.metric.${m}`)}
            </button>
          ))}
        </div>
      </div>
      {values.length === 0 ? (
        <p className={styles.muted}>{t('projectQuality.noValues')}</p>
      ) : (
        <svg
          className={styles.trend}
          viewBox={`0 0 ${String(W)} ${String(H)}`}
          role="img"
          aria-label={label}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line className={styles.grid} x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
              <text className={styles.axis} x={PAD.left - 6} y={y(v) + 4} textAnchor="end">
                {fmt(v)}
              </text>
            </g>
          ))}
          {nights.map((n, i) =>
            i % labelEvery === 0 || i === nights.length - 1 ? (
              <text key={n.night} className={styles.axis} x={x(i)} y={H - 12} textAnchor="middle">
                {formatNightKey(n.night)}
              </text>
            ) : null,
          )}
          {series.map((s) => (
            <g key={s.filter} style={{ color: colorOf(s.filter) }}>
              {s.points.length > 1 ? (
                <polyline
                  className={styles.line}
                  points={s.points
                    .map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`)
                    .join(' ')}
                />
              ) : null}
              {s.points.map((p) => (
                <circle key={p.night} className={styles.dot} cx={x(p.i)} cy={y(p.v)} r={3.5}>
                  <title>{`${s.filter} · ${formatNightKey(p.night)} · ${fmt(p.v)}`}</title>
                </circle>
              ))}
            </g>
          ))}
        </svg>
      )}
      <ul className={styles.legend} aria-label={t('projectQuality.filters')}>
        {series.map((s) => (
          <li key={s.filter}>
            <span
              className={styles.legendLine}
              style={{ background: colorOf(s.filter) }}
              aria-hidden="true"
            />
            {s.filter}
          </li>
        ))}
      </ul>
      <p className={styles.muted}>{t(`projectQuality.metricHint.${metric}`)}</p>
    </section>
  );
}

function Files({ projectId, view }: { projectId: string; view: ProjectQualityView }) {
  const { t } = useTranslation();
  return (
    <section className={styles.files} aria-label={t('projectQuality.filesTitle')}>
      <span>{t('projectQuality.filesHint')}</span>
      <span className={styles.fileLinks}>
        <a
          className={styles.button}
          href={sessionsApi.projectQualityFilesUrl(projectId, false)}
          download
        >
          {t('projectQuality.filesAll', {
            count: view.total.good + view.total.flagged + view.total.rejected + view.total.none,
          })}
        </a>
        <a
          className={styles.button}
          href={sessionsApi.projectQualityFilesUrl(projectId, true)}
          download
        >
          {t('projectQuality.filesGood', { count: view.total.good })}
        </a>
      </span>
      {view.truncated ? (
        <span className={styles.muted}>{t('projectQuality.truncated')}</span>
      ) : null}
    </section>
  );
}
