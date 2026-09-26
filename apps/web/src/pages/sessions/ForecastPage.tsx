/**
 * S-62 Folgeplanung (FK 14.3; FA-FOL-01…05, FA-FOL-07; FK 8.5; AP-33): je Rig aus der gespeicherten
 * Mehrnacht-Prognose (Job `forecast`, 14 Nächte) – Restbedarf je Filter (Frames, Stunden inkl. Overhead),
 * Prognose als Spanne (optimistisch ohne Wetter, realistisch mit Wetter bzw. Klarnacht-Quote) mit
 * Fertigstellung, Kandidatennächte-Matrix der nächsten 7 Nächte (Nächte × Projekte, Ampel, Wetter mit
 * `coverage`, bestem Fenster, Kennzeichen und Regen), Saisonwarnungen mit Handlungsvorschlägen (Admin:
 * Priorität anheben, pausieren – danach neue Prognose) und Wiederaufnahme unfertiger/pausierter Projekte.
 */
import { formatNightKey } from '@nina-pm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  forecastApi,
  projectsApi,
  type ForecastProject,
  type ForecastView,
  type QueueItem,
} from '../../api/client';
import { useAuth, useCan } from '../../auth';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { ProblemMessage } from '../../components/ProblemMessage';
import { SiteTime } from '../../components/SiteTime';
import { useJob } from '../../lib/use-job';
import { formatDateTime } from '../../lib/time';
import { problemCode } from '../admin/shared';
import { useEquipmentList } from '../equipment/shared';
import { useQueueVisibility, VisibilityBars } from '../projects/VisibilityWeeks';
import styles from './sessions.module.css';
import { EvaluationTabs } from './SessionsPage';

export const FORECAST_PATH = '/auswertung/folgeplanung';

export function ForecastPage() {
  const { t } = useTranslation();
  const rigs = useEquipmentList('rigs');
  const [choice, setChoice] = useState('');
  const rigId =
    choice || (rigs.data ?? []).find((r) => r.showInPlanning)?.id || (rigs.data ?? [])[0]?.id || '';
  const ids = { rig: useId() };
  const client = useQueryClient();
  const forecast = useQuery({
    queryKey: ['forecast', rigId],
    queryFn: () => forecastApi.get(rigId),
    enabled: rigId !== '',
  });
  const [jobId, setJobId] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => forecastApi.run(rigId),
    onSuccess: (r) => setJobId(r.jobId),
  });
  const job = useJob<unknown>(jobId);
  const done = job.job.data?.status === 'done';
  useEffect(() => {
    if (done) void client.invalidateQueries({ queryKey: ['forecast', rigId] });
  }, [done, client, rigId]);
  const v = forecast.data;
  return (
    <div className={styles.page}>
      <PageHeader
        title={t('forecast.title')}
        nav={<EvaluationTabs />}
        actions={
          rigId ? (
            <button
              type="button"
              className={styles.button}
              disabled={run.isPending || job.running}
              onClick={() => run.mutate()}
            >
              {job.running ? t('forecast.running') : t('forecast.rerun')}
            </button>
          ) : null
        }
      />
      <section className={styles.listCard} aria-label={t('forecast.title')}>
        <div className={`${styles.toolbar} ${styles.listBar}`}>
          <div className={styles.field}>
            <label htmlFor={ids.rig}>{t('forecast.rig')}</label>
            <select
              id={ids.rig}
              className={`${styles.input} ${styles.rigSelect}`}
              value={rigId}
              onChange={(e) => setChoice(e.target.value)}
            >
              {(rigs.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          {v ? <ForecastMeta view={v} /> : null}
        </div>
        {run.error ? <ProblemMessage code={problemCode(run.error)} /> : null}
        {job.failed ? <ProblemMessage code={job.errorCode ?? 'internal.error'} /> : null}
        {forecast.isError ? (
          <ProblemMessage
            code={problemCode(forecast.error)}
            onRetry={() => void forecast.refetch()}
          />
        ) : !v ? (
          <p className={styles.listNote} role="status">
            {rigId ? t('common.loading') : t('forecast.noRig')}
          </p>
        ) : v.computedAt === null ? (
          <p className={styles.listNote}>{t('forecast.notComputed')}</p>
        ) : (
          <ForecastBody view={v} rigId={rigId} onChanged={() => run.mutate()} />
        )}
      </section>
    </div>
  );
}

function ForecastMeta({ view }: { view: ForecastView }) {
  const { t, i18n } = useTranslation();
  const { me } = useAuth();
  const zone = me?.tenant?.timeZone ?? 'UTC';
  const q = view.clearQuota;
  return (
    <p className={styles.muted}>
      {view.computedAt
        ? t('forecast.computedAt', { at: formatDateTime(view.computedAt, zone, i18n.language) })
        : null}{' '}
      {q.source === 'stats'
        ? t('forecast.quotaStats', { pct: Math.round(q.rate * 100), n: q.recordedNights })
        : t('forecast.quotaDefault', { pct: Math.round(q.rate * 100), n: q.recordedNights })}
    </p>
  );
}

function ForecastBody({
  view,
  rigId,
  onChanged,
}: {
  view: ForecastView;
  rigId: string;
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const n = (x: number, d = 1) => x.toLocaleString(i18n.language, { maximumFractionDigits: d });
  const estimate = (e: ForecastProject['optimistic']) =>
    e.nights === null
      ? t('forecast.estimateNone')
      : e.completesNight === null
        ? t('forecast.estimateDone')
        : t(e.extrapolated ? 'forecast.estimateExtrapolated' : 'forecast.estimate', {
            nights: e.nights,
            night: formatNightKey(e.completesNight),
          });
  const columns: DataColumn<ForecastProject>[] = [
    {
      id: 'name',
      header: t('forecast.col.project'),
      sortValue: (p) => p.name,
      cell: (p) => <Link to={`/projekte/${p.projectId}`}>{p.name}</Link>,
    },
    {
      id: 'need',
      header: t('forecast.col.need'),
      sortValue: (p) => p.needHours,
      cell: (p) =>
        p.needFrames === 0 ? (
          t('forecast.estimateDone')
        ) : (
          <span className={styles.flags}>
            {p.need.map((f) => (
              <span key={f.filter} className={styles.pill}>
                {t('forecast.needChip', { filter: f.filter, frames: f.frames, hours: n(f.hours) })}
              </span>
            ))}
          </span>
        ),
    },
    {
      id: 'optimistic',
      header: t('forecast.col.optimistic'),
      sortValue: (p) => p.optimistic.completesNight,
      priority: 2,
      cell: (p) => estimate(p.optimistic),
    },
    {
      id: 'realistic',
      header: t('forecast.col.realistic'),
      sortValue: (p) => p.realistic.completesNight,
      cell: (p) => estimate(p.realistic),
    },
    {
      id: 'season',
      header: t('forecast.col.season'),
      sortValue: (p) => (p.seasonWarning ? 1 : 0),
      priority: 2,
      cell: (p) =>
        p.seasonWarning ? (
          <span className={styles.pillWarn}>
            {p.seasonWarning.achievablePct !== null
              ? t('forecast.seasonPct', { pct: p.seasonWarning.achievablePct })
              : t('forecast.seasonShort')}
          </span>
        ) : (
          '–'
        ),
    },
  ];
  const warned = view.projects.filter((p) => p.suggestions.length > 0);
  return (
    <div className={styles.forecastBody}>
      <h2 className={styles.forecastTitle}>{t('forecast.projects')}</h2>
      <DataTable
        columns={columns}
        rows={view.projects}
        rowKey={(p) => p.projectId}
        rowLabel={(p) => p.name}
        label={t('forecast.projects')}
        empty={t('forecast.noProjects')}
      />
      <CandidateMatrix view={view} />
      {warned.length > 0 ? <Suggestions projects={warned} onChanged={onChanged} /> : null}
      {view.resume.length > 0 ? <Resume view={view} rigId={rigId} onChanged={onChanged} /> : null}
    </div>
  );
}

/** Kandidatennächte (FA-FOL-03): Nächte × Projekte mit Ampel, Nutzen und Wetter der Nacht. */
function CandidateMatrix({ view }: { view: ForecastView }) {
  const { t, i18n } = useTranslation();
  const n = (x: number, d = 1) => x.toLocaleString(i18n.language, { maximumFractionDigits: d });
  const nights = view.nights.slice(0, 7);
  return (
    <>
      <h2 className={styles.forecastTitle}>{t('forecast.candidates')}</h2>
      <p className={styles.muted}>{t('forecast.candidatesHint')}</p>
      <div className={styles.matrixWrap}>
        <table className={styles.matrix}>
          <caption className={styles.srOnly}>{t('forecast.candidates')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('forecast.col.project')}</th>
              {nights.map((x) => (
                <th key={x.night} scope="col">
                  <span className={styles.matrixNight}>{formatNightKey(x.night)}</span>
                  <NightWeatherCell night={x} tz={view.siteTimeZone} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.projects.map((p) => (
              <tr key={p.projectId}>
                <th scope="row">{p.name}</th>
                {nights.map((x) => {
                  const c = p.candidates.find((k) => k.night === x.night);
                  if (!c) return <td key={x.night}>–</td>;
                  return (
                    <td
                      key={x.night}
                      className={styles.matrixCell}
                      data-light={c.light}
                      title={c.filters.map((f) => `${f.filter} ${String(f.frames)}`).join(' · ')}
                    >
                      <span className={styles.lightDot} data-light={c.light} aria-hidden="true" />
                      <span className={styles.srOnly}>{t(`forecast.light.${c.light}`)} </span>
                      {c.frames > 0
                        ? t('forecast.cell', { frames: n(c.benefit), hours: n(c.hours) })
                        : '–'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function NightWeatherCell({ night, tz }: { night: ForecastView['nights'][number]; tz: string }) {
  const { t, i18n } = useTranslation();
  const w = night.weather;
  if (!w)
    return (
      <span className={styles.matrixWeather}>
        {t('forecast.quotaWeight', { pct: Math.round(night.weight * 100) })}
      </span>
    );
  return (
    <span className={styles.matrixWeather}>
      <span>
        {w.ratingIndex === null
          ? t('weather.rating.none')
          : t(`weather.rating.${String(w.ratingIndex)}`)}
        {w.coverage !== null ? ` · ${String(Math.round(w.coverage * 100))} %` : ''}
      </span>
      {w.bestWindow ? (
        <span>
          <SiteTime atUtc={w.bestWindow.fromUtc} siteTimeZone={tz} />–
          <SiteTime atUtc={w.bestWindow.toUtc} siteTimeZone={tz} />
        </span>
      ) : null}
      {w.precipProbPct !== null && w.precipProbPct > 0 ? (
        <span>
          {t('forecast.rain', {
            pct: w.precipProbPct,
            mm: (w.precipMm ?? 0).toLocaleString(i18n.language, { maximumFractionDigits: 1 }),
          })}
        </span>
      ) : null}
      {w.aerosolMissing ? (
        <span className={styles.flagText}>{t('forecast.flag.aerosol')}</span>
      ) : null}
      {w.seeingIncomplete ? (
        <span className={styles.flagText}>{t('forecast.flag.seeing')}</span>
      ) : null}
      {w.incomplete ? (
        <span className={styles.flagText}>{t('forecast.flag.incomplete')}</span>
      ) : null}
    </span>
  );
}

/** Saisonwarnungen und Handlungsvorschläge (FA-FOL-04/05); Ein-Klick nur für Admins. */
function Suggestions({
  projects,
  onChanged,
}: {
  projects: readonly ForecastProject[];
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const canAct = useCan('project.status');
  const client = useQueryClient();
  const act = useMutation({
    mutationFn: async (a: { kind: string; p: ForecastProject }) => {
      if (a.kind === 'raise_priority')
        await projectsApi.priority(a.p.projectId, Math.max(1, a.p.priority - 1));
      else if (a.kind === 'pause') await projectsApi.setStatus(a.p.projectId, 'on_hold');
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['projects'] });
      // Jede Umsetzung erzeugt einen neuen Prognoselauf zur Kontrolle (FA-FOL-05).
      onChanged();
    },
  });
  return (
    <>
      <h2 className={styles.forecastTitle}>{t('forecast.suggestions')}</h2>
      <ul className={styles.plainList}>
        {projects.map((p) => (
          <li key={p.projectId} className={styles.suggestion}>
            <strong>{p.name}</strong>{' '}
            <span className={styles.muted}>
              {p.seasonWarning
                ? t('forecast.seasonWarning', {
                    pct: p.seasonWarning.achievablePct ?? '–',
                    end: p.seasonWarning.seasonEnd
                      ? formatNightKey(p.seasonWarning.seasonEnd)
                      : '–',
                  })
                : t('forecast.noTime')}
            </span>
            <span className={styles.flags}>
              {p.suggestions.map((s) =>
                s.oneClick && canAct ? (
                  <button
                    key={s.kind}
                    type="button"
                    className={styles.button}
                    disabled={act.isPending}
                    onClick={() => act.mutate({ kind: s.kind, p })}
                  >
                    {t(`forecast.action.${s.kind}`)}
                  </button>
                ) : (
                  <span key={s.kind} className={styles.pill}>
                    {t(`forecast.action.${s.kind}`)}
                  </span>
                ),
              )}
            </span>
          </li>
        ))}
      </ul>
      {act.error ? <ProblemMessage code={problemCode(act.error)} /> : null}
    </>
  );
}

/** Wiederaufnahme (FA-FOL-07): unfertige/pausierte Projekte mit Restbedarf und Sichtbarkeit der nächsten Wochen. */
function Resume({
  view,
  rigId,
  onChanged,
}: {
  view: ForecastView;
  rigId: string;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const canAct = useCan('project.status');
  const client = useQueryClient();
  const rigs = useEquipmentList('rigs');
  const sites = useEquipmentList('sites');
  const items = useMemo(
    () =>
      view.resume.map(
        (r) =>
          ({
            id: r.projectId,
            requestedRigId: rigId,
            target: r.target,
            conditions: r.conditions,
            startDate: null,
          }) as unknown as QueueItem,
      ),
    [view.resume, rigId],
  );
  const visibility = useQueueVisibility(items, rigs.data ?? [], sites.data ?? []);
  const activate = useMutation({
    mutationFn: (id: string) => projectsApi.setStatus(id, 'active'),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['projects'] });
      onChanged();
    },
  });
  return (
    <>
      <h2 className={styles.forecastTitle}>{t('forecast.resume')}</h2>
      <p className={styles.muted}>{t('forecast.resumeHint')}</p>
      <ul className={styles.plainList}>
        {view.resume.map((r, i) => {
          const weeks = visibility.weeks[i] ?? null;
          return (
            <li key={r.projectId} className={styles.suggestion}>
              <Link to={`/projekte/${r.projectId}`}>{r.name}</Link>{' '}
              <span className={styles.muted}>
                {t('forecast.resumeLine', {
                  status: t(`status.project.${r.status}`),
                  frames: r.needFrames,
                })}
              </span>
              {weeks ? <VisibilityBars weeks={weeks} name={r.name} /> : null}
              {canAct ? (
                <button
                  type="button"
                  className={styles.button}
                  disabled={activate.isPending}
                  onClick={() => activate.mutate(r.projectId)}
                >
                  {t('forecast.activate')}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {activate.error ? <ProblemMessage code={problemCode(activate.error)} /> : null}
    </>
  );
}
