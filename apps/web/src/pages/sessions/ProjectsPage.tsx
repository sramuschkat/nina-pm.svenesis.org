/**
 * Auswertung – Reiter „Projekte“ (AP-64; ersetzt S-63 Projektbericht und nimmt die Prognose aus S-62 auf; FA-AUS-10,
 * FA-AUS-11, FA-AUS-13, FA-AUS-18, FA-FOL-01, FA-FOL-02, FA-FOL-04): „Wie weit bin ich, wann bin ich fertig?“ Eine Zeile je
 * Projekt mit Ersteller, Art und belichteter Integration, Fortschritt je Filter („10/10“) und „Voraussichtlich fertig“
 * aus der gespeicherten Prognose des Rigs (realistisch, darunter optimistisch) bzw. der Saisonwarnung in Hinweisfarbe;
 * „Verlauf“ klappt gestapelte Balken je Nacht und Filter mit kumulierter Linie, die Nächte mit Link auf die Nacht,
 * Kanalbalance und Bedingungen auf. Filter Status und Objekttyp zusätzlich zu Rig und Zeitraum; CSV und Drucken bleiben.
 */
import { formatNightKey, projectStatuses } from '@nina-pm/shared';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { forecastApi, reportsApi, type ForecastView, type ReportProject } from '../../api/client';
import { ProjectCommentCount } from '../../lib/project-comments';
import { FilterChip } from '../../components/FilterChip';
import { ProblemMessage } from '../../components/ProblemMessage';
import { Person, useMemberNames } from '../../lib/member';
import { problemCode } from '../admin/shared';
import { useEquipmentList } from '../equipment/shared';
import { EvaluationHeader, useEvaluationFilter } from './EvaluationHeader';
import { sessionPath } from './evaluation';
import { downloadReportCsv, ProgressChart } from './ProjectReportPage';
import { etaOf, etaText, type Eta } from './eta';
import styles from './evaluation.module.css';

const TYPES = ['deep_sky', 'exoplanet'] as const;

export function ProjectsPage() {
  const { t } = useTranslation();
  const nameOf = useMemberNames();
  const { filter, range, ready } = useEvaluationFilter();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const type = params.get('typ') ?? '';
  const ids = { status: useId(), type: useId() };
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const query = { from: range.from, to: range.to, status, rigId: filter.rigId, type };
  const report = useQuery({
    queryKey: ['project-report', query],
    queryFn: () => reportsApi.projects(query),
    enabled: ready,
  });
  const rigIds = [
    ...new Set((report.data?.projects ?? []).flatMap((p) => (p.rigId ? [p.rigId] : []))),
  ].sort();
  const forecasts = useQueries({
    queries: rigIds.map((rigId) => ({
      queryKey: ['forecast', rigId],
      queryFn: () => forecastApi.get(rigId),
      retry: false,
    })),
  });
  const forecastOf = new Map<string, ForecastView>();
  for (const f of forecasts) if (f.data) forecastOf.set(f.data.rigId, f.data);
  const print = () => window.print();
  return (
    <div className={styles.page}>
      <EvaluationHeader
        actions={
          <span className={`${styles.headActions} ${styles.noPrint}`}>
            <button
              type="button"
              className={styles.button}
              disabled={!report.data}
              onClick={() => report.data && downloadReportCsv(report.data, nameOf)}
            >
              {t('report.csv')}
            </button>
            <button type="button" className={styles.button} onClick={print}>
              {t('report.print')}
            </button>
          </span>
        }
        extra={
          <>
            <div className={styles.field}>
              <label htmlFor={ids.status}>{t('report.status')}</label>
              <select
                id={ids.status}
                className={styles.select}
                value={status}
                onChange={(e) => setParam('status', e.target.value)}
              >
                <option value="">{t('report.all')}</option>
                {projectStatuses.map((s) => (
                  <option key={s} value={s}>
                    {t(`status.project.${s}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor={ids.type}>{t('report.type')}</label>
              <select
                id={ids.type}
                className={styles.select}
                value={type}
                onChange={(e) => setParam('typ', e.target.value)}
              >
                <option value="">{t('report.all')}</option>
                {TYPES.map((x) => (
                  <option key={x} value={x}>
                    {t(`report.types.${x}`)}
                  </option>
                ))}
              </select>
            </div>
          </>
        }
      />
      {report.isError ? (
        <ProblemMessage code={problemCode(report.error)} onRetry={() => void report.refetch()} />
      ) : !report.data ? (
        <p className={styles.muted} role="status">
          {t('common.loading')}
        </p>
      ) : report.data.projects.length === 0 ? (
        <p className={styles.empty}>{t('report.empty')}</p>
      ) : (
        <>
          <p className={styles.muted}>
            {t('evaluation.projects.totals', {
              range: t('report.range', {
                from: formatNightKey(range.from),
                to: formatNightKey(range.to),
              }),
              projects: report.data.totals.projects,
              frames: report.data.totals.periodAccepted,
              h: (report.data.totals.periodIntegrationS / 3600).toLocaleString(undefined, {
                maximumFractionDigits: 1,
              }),
            })}
          </p>
          <ul className={styles.cards} aria-label={t('evaluation.tab.projects')}>
            {report.data.projects.map((p) => {
              const view = p.rigId ? forecastOf.get(p.rigId) : undefined;
              return (
                <li key={p.projectId}>
                  <ProjectRow
                    project={p}
                    eta={etaOf(
                      view?.projects.find((x) => x.projectId === p.projectId),
                      view?.currentNight ?? null,
                    )}
                    forecastPending={
                      p.rigId !== null && !view && forecasts.some((f) => f.isPending)
                    }
                  />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function ProjectRow({
  project: p,
  eta,
  forecastPending,
}: {
  project: ReportProject;
  eta: Eta;
  forecastPending: boolean;
}) {
  const { t, i18n } = useTranslation();
  const filters = useEquipmentList('filters');
  const colorOf = (short: string) =>
    (filters.data ?? []).find((f) => f.shortName === short)?.colorHex ?? '#888888';
  const n = (x: number, d = 1) => x.toLocaleString(i18n.language, { maximumFractionDigits: d });
  const total = p.filters.reduce((s, f) => s + f.integrationS, 0);
  const detailsId = useId();
  const [open, setOpen] = useState(false);
  const etaView = etaText(eta, t, forecastPending);
  return (
    <article className={styles.projectCard} aria-label={p.name}>
      <div className={styles.projectRow}>
        <div className={styles.projectName}>
          <span className={styles.projectTitle}>
            <Link to={`/projekte/${p.projectId}`}>{p.name}</Link>
            <ProjectCommentCount projectId={p.projectId} count={p.commentCount} />
          </span>
          <Person id={p.createdBy} compact />
          <span className={styles.muted}>
            {t(`report.types.${p.projectType}`)} ·{' '}
            {t('evaluation.projects.exposed', { h: n(total / 3600), pct: n(p.percentDone, 0) })}
            {p.rigName ? ` · ${p.rigName}` : ''}
          </span>
        </div>
        <ul className={styles.progress} aria-label={t('report.filtersOf', { name: p.name })}>
          {p.filters.map((f) => (
            <li key={f.filter} className={styles.progressRow}>
              <FilterChip shortName={f.filter} color={colorOf(f.filter)} size="sm" />
              <span
                className={styles.progressTrack}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(f.percentDone)}
                aria-label={t('evaluation.projects.filterProgress', {
                  filter: f.filter,
                  accepted: f.accepted,
                  planned: f.planned,
                })}
              >
                <span
                  className={styles.progressFill}
                  style={{
                    width: `${String(Math.min(100, f.percentDone))}%`,
                    background: colorOf(f.filter),
                  }}
                />
              </span>
              <span className={styles.progressText}>
                {f.accepted}/{f.planned}
              </span>
            </li>
          ))}
        </ul>
        <div className={styles.eta} data-tone={eta.tone}>
          <span className={styles.etaLabel}>{t('evaluation.projects.eta')}</span>
          <span className={styles.etaValue}>{etaView.value}</span>
          <span className={styles.etaNote}>{etaView.note}</span>
        </div>
        <button
          type="button"
          className={`${styles.button} ${styles.noPrint}`}
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen(!open)}
        >
          {open ? t('evaluation.projects.collapse') : t('evaluation.projects.history')}
        </button>
      </div>
      {/* Zugeklappt verborgen; die Druckansicht zeigt alle Verläufe (CSS `print`). */}
      <div id={detailsId} className={styles.projectBody} hidden={!open} data-print-open="">
        <div className={styles.projectChart}>
          <h3 className={styles.formTitle}>{t('evaluation.projects.perNight')}</h3>
          {p.nights.length === 0 ? (
            <p className={styles.muted}>{t('report.noNights')}</p>
          ) : (
            <ProgressChart project={p} colorOf={colorOf} />
          )}
        </div>
        <div className={styles.projectNights}>
          <h3 className={styles.formTitle}>{t('evaluation.projects.nights')}</h3>
          {p.sessions.length === 0 ? (
            <p className={styles.muted}>{t('report.noSessions')}</p>
          ) : (
            <ul className={styles.nightLinks}>
              {p.sessions.map((s) => (
                <li key={s.sessionId}>
                  <Link to={sessionPath(s.sessionId)} className={styles.nightLink}>
                    <span>{formatNightKey(s.night)}</span>
                    <span className={styles.muted}>
                      {s.filters.map((f) => `${f.filter} ${String(f.frames)}`).join(' · ')}
                      {s.rejectedPct
                        ? ` · ${t('evaluation.projects.rejected', { pct: n(s.rejectedPct) })}`
                        : ''}
                      {s.weatherRatingIndex === null
                        ? ''
                        : ` · ${t(`weather.rating.${String(s.weatherRatingIndex)}`)}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        {p.channelBalance ? (
          <p className={styles.note} role="note">
            {t('report.balance', {
              ahead: p.channelBalance.ahead
                .map((f) => `${f.filter} ${n(f.percentDone, 0)} %`)
                .join(', '),
              behind: p.channelBalance.behind
                .map((f) => `${f.filter} ${n(f.percentDone, 0)} %`)
                .join(', '),
              filters: p.channelBalance.behind.map((f) => f.filter).join(', '),
            })}
          </p>
        ) : null}
        <dl className={styles.conditions}>
          <dt>{t('projectEditor.cond.minAltitude')}</dt>
          <dd>{n(p.conditions.minAltitudeDeg)}°</dd>
          <dt>{t('projectEditor.cond.minTime')}</dt>
          <dd>{t('report.hours', { h: n(p.conditions.minTimeOnTargetH) })}</dd>
          <dt>{t('projectEditor.cond.twilight')}</dt>
          <dd>{t(`nightChart.twilight.${p.conditions.twilight}`)}</dd>
          <dt>{t('projectEditor.cond.moonEnabled')}</dt>
          <dd>
            {p.conditions.moonAvoidanceEnabled
              ? t('report.moonOn', { deg: n(p.conditions.moonSeparationDeg, 0) })
              : t('report.moonOff')}
          </dd>
        </dl>
      </div>
    </article>
  );
}
