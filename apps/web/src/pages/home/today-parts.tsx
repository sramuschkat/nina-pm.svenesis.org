/**
 * Bausteine der Startseite „Heute“ (AP-73): letzte Aufnahme in „Rig jetzt“ (FA-FOL-09), „Zu tun“ (FA-FOL-08) und
 * „Aktive Projekte“ mit Restzeit (FA-FOL-10). Gleiche Abfrage-Schlüssel wie Warteschlange, Projektliste, Sessions und
 * Prognose: ein Cache, keine Doppelabrufe.
 */
import {
  formatNightKey,
  formatTzAbbr,
  formatZonedTime,
  qualityCounts,
  sessionGrade,
  shareLabelPct,
} from '@nina-pm/shared';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  approvalApi,
  forecastApi,
  projectsApi,
  sessionsApi,
  type ForecastView,
  type NightSession,
  type ProjectListItem,
  type TonightRig,
} from '../../api/client';
import { useAuth, useCan } from '../../auth';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { ProblemMessage } from '../../components/ProblemMessage';
import { ProgressBar } from '../../components/ProgressBar';
import { ProjectCommentCount } from '../../lib/project-comments';
import { problemCode, useEquipmentList, useNumber } from '../equipment/shared';
import { NINA_PATHS } from '../nina/NinaLayout';
import { PROJECT_AREA } from '../projects/ProjectsLayout';
import { nightKeyIn } from '../projects/queue-model';
import { etaOf, etaText } from '../sessions/eta';
import { nightPath, nightWeekday } from '../sessions/evaluation';
import { efficiencyBar, groupNights } from '../sessions/night-model';
import { useNow } from '../weather/WeatherPage';
import styles from './today.module.css';

const QUEUE_KEY = ['projects', 'queue'] as const;
const LIST_KEY = ['projects', 'list'] as const;
const SESSIONS_KEY = ['sessions', '', false] as const;
const PROJECTS_OPEN_KEY = 'npm.today.projects';

/** Integration des laufenden Monats (Mandantenzeit) aus den Sessions: nicht verworfene Lights (NT-E3). */
export function monthIntegration(sessions: readonly NightSession[], month: string) {
  const inMonth = sessions.filter((s) => s.night.startsWith(month));
  return {
    seconds: inMonth.reduce((sum, s) => sum + s.integrationS, 0),
    nights: new Set(inMonth.filter((s) => s.integrationS > 0).map((s) => s.night)).size,
  };
}

// ---- Rig jetzt: letzte Aufnahme -------------------------------------------------------------------

export function LastCapture({
  capture: c,
  timeZone,
}: {
  capture: TonightRig['lastCapture'];
  timeZone: string;
}) {
  const { t } = useTranslation();
  const num = useNumber();
  if (!c) return <p className={styles.muted}>{t('today.lastCapture.none')}</p>;
  const at = `${formatZonedTime(c.capturedAtUtc, timeZone)} ${formatTzAbbr(c.capturedAtUtc, timeZone)}`;
  const facts = [
    `${c.projectName} · ${c.filter} ${num(c.exposureS, 0)} s`,
    c.hfr !== null ? t('today.lastCapture.hfr', { v: num(c.hfr, 2) }) : null,
    c.stars !== null ? t('today.lastCapture.stars', { n: num(c.stars, 0) }) : null,
  ].filter(Boolean);
  return (
    <p className={styles.lastCapture}>
      <span className={styles.lastLabel}>{t('today.lastCapture.title')}</span>{' '}
      <span>
        {at} · {facts.join(' · ')}
      </span>
      {c.grade === 'flagged' ? (
        // Nur Hinweis (AP-77): einzelne Bilder werden nicht mehr markiert oder bearbeitet.
        <>
          {' · '}
          <span className={styles.flagged}>
            {t('today.lastCapture.flagged', {
              reasons: c.flags.map((f) => t(`sessionQuality.metric.${f.metric}`)).join(', '),
            })}
          </span>
        </>
      ) : null}
    </p>
  );
}

// ---- Zu tun ----------------------------------------------------------------------------------------

interface Todo {
  readonly key: string;
  readonly count: string;
  readonly tone: 'info' | 'warn' | 'danger';
  readonly text: string;
  readonly details?: readonly string[];
  readonly to: string;
  readonly action: string;
}

/** „Zu tun“: letzte Nacht des Rigs, darunter nur Einträge mit Daten (FA-FOL-08). */
export function TodoCard({ rig }: { rig: TonightRig }) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const canSessions = useCan('session.read');
  const canQueue = useCan('queue.read');
  const canInstances = useCan('nina.instance.manage');
  const headingId = useId();
  const sessions = useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: async () => (await sessionsApi.list()).items,
    enabled: canSessions,
  });
  // Nicht zugeordnete Aufnahmen (AP-77): sie zählen erst nach dem Zuordnen – die einzige Aufgabe aus den Nächten.
  const unassigned = useQuery({
    queryKey: ['sessions', 'unassigned'],
    queryFn: () => sessionsApi.unassigned(),
    enabled: canSessions,
  });
  const queue = useQuery({
    queryKey: QUEUE_KEY,
    queryFn: async () => (await approvalApi.queue()).items,
    enabled: canQueue,
  });
  const meId = me?.member?.id ?? '';
  const todos: Todo[] = [];
  const u = unassigned.data;
  const firstUnassigned = u?.nights[0];
  if (u && u.count > 0 && firstUnassigned)
    todos.push({
      key: 'unassigned',
      count: String(u.count),
      tone: 'warn',
      text: t('today.todo.unassigned', { count: u.count, nights: u.nights.length }),
      to: nightPath(firstUnassigned.rigId, firstUnassigned.night),
      action: t('today.todo.assign'),
    });
  const items = queue.data ?? [];
  const votable = items.filter((q) => q.kind !== 'transit');
  if (votable.length > 0) {
    const missing = votable.filter((q) => !q.votes.mine && q.createdBy !== meId).length;
    todos.push({
      key: 'queue',
      count: String(votable.length),
      tone: 'info',
      text: t('today.todo.queue', { count: votable.length, missing }),
      to: PROJECT_AREA.queue,
      action: t('today.todo.vote'),
    });
  }
  const transits = items
    .flatMap((q) => (q.kind === 'transit' && q.transit ? [q.transit] : []))
    .sort((a, b) => (a.deadlineUtc ?? a.midUtc).localeCompare(b.deadlineUtc ?? b.midUtc));
  const firstTransit = transits[0];
  if (firstTransit)
    todos.push({
      key: 'exo',
      count: String(transits.length),
      tone: 'warn',
      text: t('today.todo.exo', {
        count: transits.length,
        planet: firstTransit.planet,
        night: formatNightKey(firstTransit.night),
      }),
      to: PROJECT_AREA.queue,
      action: t('today.todo.confirm'),
    });
  const mismatches = rig.instances.flatMap((i) => [
    ...i.mismatchCodes.map((c) => t(`nina.mismatch.${c}`)),
    ...(i.profileSiteMismatch ? [t('today.todo.profileSite')] : []),
  ]);
  if (mismatches.length > 0)
    todos.push({
      key: 'nina',
      count: String(mismatches.length),
      tone: 'danger',
      text: t('today.todo.nina', { count: mismatches.length }),
      details: mismatches,
      to: canInstances ? NINA_PATHS.instances : `/rig-zustand?rig=${rig.rigId}`,
      action: t('today.todo.show'),
    });
  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <div className={styles.cardHead}>
        <h2 id={headingId} className={styles.cardTitle}>
          {t('today.todo.title')}
        </h2>
      </div>
      <div className={styles.cardBody}>
        {canSessions ? <LastNight rig={rig} sessions={sessions} /> : null}
        {todos.length === 0 ? (
          <p className={styles.muted}>{t('today.todo.none')}</p>
        ) : (
          <ul className={styles.todos}>
            {todos.map((x) => (
              <li key={x.key}>
                <Link className={styles.todo} to={x.to}>
                  <span className={styles.todoCount} data-tone={x.tone}>
                    {x.count}
                  </span>
                  <span>{x.text}</span>
                  <span className={styles.todoAction}>{x.action}</span>
                </Link>
                {x.details ? (
                  <ul className={styles.todoDetail}>
                    {x.details.map((line, i) => (
                      <li key={`${String(i)}-${line}`}>{line}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Letzte Nacht des Rigs: Prüfstatus, Nutzung, markierte Bilder (Session-Detail, erst beim Anzeigen geladen). */
function LastNight({
  rig,
  sessions,
}: {
  rig: TonightRig;
  sessions: ReturnType<typeof useQuery<NightSession[]>>;
}) {
  const { t, i18n } = useTranslation();
  const num = useNumber();
  const last = useMemo(
    () =>
      groupNights((sessions.data ?? []).filter((x) => x.rigId === rig.rigId))
        .filter((g) => g.status !== 'running' && g.night < rig.currentNight)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null,
    [sessions.data, rig.rigId, rig.currentNight],
  );
  const details = useQueries({
    queries: (last?.sessions ?? []).map((x) => ({
      queryKey: ['sessions', 'detail', x.id],
      queryFn: () => sessionsApi.get(x.id),
    })),
  });
  if (sessions.isError)
    return (
      <ProblemMessage code={problemCode(sessions.error)} onRetry={() => void sessions.refetch()} />
    );
  if (!last) return null;
  // Qualität der Nacht (AP-77): Anteil guter Lights über alle Sessions der Nacht.
  const quality = details.every((d) => d.data)
    ? qualityCounts(
        details.flatMap((d) =>
          (d.data?.captures ?? []).flatMap((c) =>
            c.grade
              ? [
                  {
                    grade: c.grade,
                    flags: c.flags ?? [],
                    hfr: c.hfr,
                    stars: c.stars,
                    rmsArcsec: null,
                  },
                ]
              : [],
          ),
        ),
      )
    : null;
  const grade = sessionGrade(quality?.sharePct ?? null);
  const bar = efficiencyBar(last.efficiency);
  return (
    <div className={styles.lastNight}>
      <div className={styles.lastNightHead}>
        <Link to={nightPath(last.rigId, last.night)}>
          {t('today.lastNight.title', {
            night: `${nightWeekday(last.night, i18n.language)} ${formatNightKey(last.night)}`,
          })}
        </Link>
        {grade && quality?.sharePct != null ? (
          <span
            className={
              grade === 'very_good' || grade === 'good' ? styles.badgeOk : styles.badgeWarn
            }
          >
            {t('today.lastNight.quality', {
              grade: t(`evaluation.quality.grade.${grade}`),
              pct: shareLabelPct(quality.sharePct),
            })}
          </span>
        ) : null}
      </div>
      <div className={styles.nightEff}>
        <span className={styles.nightTrack} aria-hidden="true">
          <span className={styles.nightFill} style={{ width: `${String(bar?.widthPct ?? 0)}%` }} />
        </span>
        <span className={styles.nightEffText}>
          {bar && bar.pct !== null
            ? t('home.sessions.eff', { h: num(bar.exposureH, 1), pct: bar.pct })
            : t('sessions.hours', { h: num(last.integrationS / 3600, 1) })}
          {' · '}
          {t('today.lastNight.projects', { count: last.projects.length })}
        </span>
      </div>
      {quality && quality.flagged > 0 ? (
        <Link className={styles.flagged} to={nightPath(last.rigId, last.night)}>
          {t('today.lastNight.flagged', { count: quality.flagged })}
        </Link>
      ) : null}
    </div>
  );
}

// ---- Aktive Projekte -------------------------------------------------------------------------------

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(PROJECTS_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** „Aktive Projekte“: eingeklappt mit Anzahl und Monatsintegration, aufgeklappt mit Fortschritt und Restzeit. */
export function ActiveProjects() {
  const { t, i18n } = useTranslation();
  const { me } = useAuth();
  const num = useNumber();
  const canProjects = useCan('project.read');
  const canSessions = useCan('session.read');
  const now = useNow();
  const [open, setOpen] = useState(readOpen);
  const headingId = useId();
  const bodyId = useId();
  const list = useQuery({
    queryKey: LIST_KEY,
    queryFn: async () => (await projectsApi.list()).items,
    enabled: canProjects,
  });
  const sessions = useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: async () => (await sessionsApi.list()).items,
    enabled: canSessions,
  });
  const rigs = useEquipmentList('rigs');
  const active = useMemo(
    () => (list.data ?? []).filter((p) => p.status === 'active' && p.deletedAt === null),
    [list.data],
  );
  const rigIds = [...new Set(active.flatMap((p) => (p.rigId ? [p.rigId] : [])))].sort();
  const forecasts = useQueries({
    queries: open
      ? rigIds.map((rigId) => ({
          queryKey: ['forecast', rigId],
          queryFn: () => forecastApi.get(rigId),
          retry: false,
        }))
      : [],
  });
  const forecastOf = new Map<string, ForecastView>();
  for (const f of forecasts) if (f.data) forecastOf.set(f.data.rigId, f.data);
  const forecastPending = forecasts.some((f) => f.isPending);
  if (!canProjects) return null;
  const zone = me?.tenant?.timeZone ?? 'UTC';
  const month = nightKeyIn(now.getTime(), zone).slice(0, 7);
  // Nur Anzeige (Intl): Monatsname in der Mandantenzeit.
  const monthName = new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-GB' : 'de-DE', {
    timeZone: zone,
    month: 'long',
  }).format(now);
  const sum = sessions.data ? monthIntegration(sessions.data, month) : null;
  const rigName = (id: string | null) =>
    (rigs.data ?? []).find((r) => r.id === id)?.name ?? t('projectList.noRig');
  const manyRigs = rigIds.length > 1;
  const toggle = () => {
    setOpen(!open);
    try {
      window.localStorage.setItem(PROJECTS_OPEN_KEY, open ? '0' : '1');
    } catch {
      // Speicher gesperrt: nur für diese Sitzung.
    }
  };
  const columns: DataColumn<ProjectListItem>[] = [
    {
      id: 'name',
      header: t('projectList.col.name'),
      cell: (p) => (
        <>
          <Link to={`/projekte/${p.id}`}>{p.name}</Link>{' '}
          <ProjectCommentCount projectId={p.id} count={p.commentCount} />
          {manyRigs ? <span className={styles.muted}> · {rigName(p.rigId)}</span> : null}
        </>
      ),
    },
    {
      id: 'progress',
      header: t('projectList.col.progress'),
      nowrap: true,
      cell: (p) => (
        <span className={styles.progressCell}>
          <ProgressBar
            acquired={Math.round((p.progress.percentDone / 100) * 1000)}
            planned={1000}
            size="sm"
            showLabel={false}
          />
          <span className={styles.muted}>{`${num(p.progress.percentDone, 0)} %`}</span>
        </span>
      ),
    },
    {
      id: 'hours',
      header: t('home.projects.hoursCol'),
      priority: 2,
      align: 'end',
      nowrap: true,
      cell: (p) => (
        <span className={styles.muted}>
          {t('home.projects.hours', {
            done: num(p.progress.integrationS / 3600, 1),
            planned: num(p.progress.plannedS / 3600, 1),
          })}
        </span>
      ),
    },
    {
      id: 'eta',
      header: t('today.projects.eta'),
      cell: (p) => {
        const view = p.rigId ? forecastOf.get(p.rigId) : undefined;
        const eta = etaOf(
          view?.projects.find((x) => x.projectId === p.id),
          view?.currentNight ?? null,
        );
        const text = etaText(eta, t, p.rigId !== null && !view && forecastPending);
        return (
          <span className={styles.eta} data-tone={eta.tone}>
            <span>{text.value}</span>
            {text.note.trim() ? <span className={styles.muted}>{text.note}</span> : null}
          </span>
        );
      },
    },
  ];
  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <div className={styles.cardHead}>
        <h2 id={headingId} className={styles.cardTitle}>
          <button
            type="button"
            className={styles.collapse}
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={toggle}
          >
            <span aria-hidden="true">{open ? '▾' : '▸'}</span> {t('home.projects.title')}
          </button>
        </h2>
        <span className={styles.muted}>
          {[
            list.data ? t('today.projects.count', { count: active.length }) : null,
            sum
              ? t('today.projects.month', { month: monthName, h: num(sum.seconds / 3600, 1) })
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <Link className={styles.more} to={PROJECT_AREA.list}>
          {t('home.projects.more')}
        </Link>
      </div>
      {open ? (
        <div id={bodyId}>
          {list.isError ? (
            <div className={styles.cardBody}>
              <ProblemMessage code={problemCode(list.error)} onRetry={() => void list.refetch()} />
            </div>
          ) : active.length === 0 ? (
            <div className={styles.cardBody}>
              <p className={styles.muted}>
                {list.isPending ? t('common.loading') : t('home.projects.empty')}
              </p>
            </div>
          ) : (
            <DataTable
              columns={columns}
              rows={active}
              rowKey={(p) => p.id}
              rowLabel={(p) => p.name}
              label={t('home.projects.title')}
              serverSorted
            />
          )}
        </div>
      ) : null}
    </section>
  );
}
