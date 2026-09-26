/**
 * Startseite (FK 14.3 S-02; AP-26c, Bestandsaufnahme 2026-09-26 §3.2): im Mandanten eine Übersicht mit
 * Kopf (*Übersicht*, Mandant und Datum in Mandantenzeit, Hauptaktion *Neues Projekt*) und Karten
 * *Warteschlange* (offen, ohne meine Stimme, Stimme wie S-33), *Wetter heute* (Farbband der kommenden
 * bzw. laufenden Nacht je Standort mit bestem Fenster), *Aktive Projekte* je Rig mit Fortschritt und
 * *Letzte Sessions*. Jede Karte hat Lade-, Leer- und Fehlerzustand und erscheint nur mit dem Recht der
 * Zielseite. *Heute Nacht* folgt mit AP-35. Im System-Kontext bleibt der Hinweis zur Verwaltung.
 */
import { formatNightKey, formatTzAbbr, formatZonedTime } from '@nina-pm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, type ComponentType, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  approvalApi,
  projectsApi,
  sessionsApi,
  type NightSession,
  type ProjectListItem,
  type QueueItem,
  type SiteView,
  type WeatherView,
} from '../../api/client';
import { useAuth, useCan } from '../../auth';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { EffortChip } from '../../components/EffortChip';
import { ICON_SIZE, actionIcons, areaIcons, uiIcons } from '../../components/icons';
import { ProblemMessage } from '../../components/ProblemMessage';
import { ProgressBar } from '../../components/ProgressBar';
import { StatusBadge } from '../../components/StatusBadge';
import { ratingColour } from '../../components/WeatherChart';
import { daylightFade } from '../../components/WeatherChart/model';
import { problemCode, useEquipmentList, useNumber } from '../equipment/shared';
import { NO_RIG, groupByRig } from '../projects/list-model';
import { PROJECT_AREA } from '../projects/ProjectsLayout';
import { SESSIONS_PATH, hours as sessionHours } from '../sessions/SessionsPage';
import { WEATHER_PATH, weatherHref } from '../weather/model';
import { useNow, useSiteWeather } from '../weather/WeatherPage';
import pageStyles from '../pages.module.css';
import styles from './home.module.css';

/** Gleiche Abfrage-Schlüssel wie Warteschlange, Projektliste und Sessions: ein Cache, keine Doppelabrufe. */
const QUEUE_KEY = ['projects', 'queue'] as const;
const LIST_KEY = ['projects', 'list'] as const;
const SESSIONS_KEY = ['sessions', '', false] as const;
/** Einträge je Karte (Warteschlange, Sessions). */
const QUEUE_ITEMS = 5;
const SESSION_ITEMS = 5;

export function HomePage() {
  const { me } = useAuth();
  // Der Rahmen zeigt die Seite erst mit Sitzung; bis dahin nichts (wie `Root`).
  if (!me) return null;
  return me.context === 'system' ? <SystemHome /> : <TenantHome />;
}

/** System-Kontext (Super User ohne Mandant): Hinweis wie bisher. */
function SystemHome() {
  const { t } = useTranslation();
  return (
    <section className={pageStyles.panel}>
      <h1>{t('home.title')}</h1>
      <p className={pageStyles.lead}>{t('home.intro')}</p>
      <div className={pageStyles.note}>
        <h2>{t('home.systemTitle')}</h2>
        <p>{t('home.systemIntro')}</p>
      </div>
    </section>
  );
}

function TenantHome() {
  const { t, i18n } = useTranslation();
  const { me } = useAuth();
  const now = useNow();
  const canCreate = useCan('project.create');
  const canQueue = useCan('queue.read');
  const canWeather = useCan('project.read');
  const canProjects = useCan('project.read');
  const canSessions = useCan('session.read');
  const zone = me?.tenant?.timeZone ?? 'UTC';
  // Nur Anzeige (Intl): heutiges Datum in der Mandantenzeit.
  const date = new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-GB' : 'de-DE', {
    timeZone: zone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div className={styles.titleBlock}>
          <h1>{t('home.overview')}</h1>
          <p className={styles.muted}>
            {t('home.subtitle', { tenant: me?.tenant?.name ?? '', date })}
          </p>
        </div>
        {canCreate ? (
          <Link to={PROJECT_AREA.create} className={styles.buttonPrimary}>
            <actionIcons.add size={ICON_SIZE.button} aria-hidden />
            {t('projectEditor.new')}
          </Link>
        ) : null}
      </div>
      <div className={styles.grid}>
        {canQueue ? <QueueCard /> : null}
        {canWeather ? <WeatherCard /> : null}
        {canProjects ? <ProjectsCard /> : null}
        {canSessions ? <SessionsCard /> : null}
      </div>
    </div>
  );
}

// ---- Rahmen einer Karte -----------------------------------------------------------------------------

function Card({
  title,
  icon: Icon,
  to,
  more,
  className,
  children,
}: {
  title: string;
  icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
  to: string;
  more: string;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const Next = uiIcons.next;
  return (
    <section className={`${styles.card} ${className ?? ''}`} aria-labelledby={id}>
      <h2 id={id} className={styles.cardTitle}>
        <Icon size={ICON_SIZE.button} aria-hidden />
        {title}
      </h2>
      <div className={styles.cardBody}>{children}</div>
      <Link className={styles.more} to={to}>
        {more}
        <Next size={ICON_SIZE.table} aria-hidden />
      </Link>
    </section>
  );
}

function Skeleton() {
  const { t } = useTranslation();
  return <div className={styles.skeleton} role="status" aria-label={t('common.loading')} />;
}

// ---- Warteschlange ---------------------------------------------------------------------------------

function QueueCard() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const client = useQueryClient();
  const queue = useQuery({
    queryKey: QUEUE_KEY,
    queryFn: async () => (await approvalApi.queue()).items,
  });
  // Stimme wie in S-33 (FA-FRG-14): gleicher Aufruf, gleicher Cache; eigene Objekte gesperrt.
  const vote = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => approvalApi.vote(id, on),
    onSuccess: () => client.invalidateQueries({ queryKey: QUEUE_KEY }),
  });
  const meId = me?.member?.id ?? '';
  const items = queue.data ?? [];
  const missing = items.filter((q) => !q.votes.mine && q.createdBy !== meId).length;
  return (
    <Card
      title={t('home.queue.title')}
      icon={actionIcons.vote}
      to={PROJECT_AREA.queue}
      more={t('home.queue.more')}
    >
      {queue.isError ? (
        <ProblemMessage code={problemCode(queue.error)} onRetry={() => void queue.refetch()} />
      ) : queue.isPending ? (
        <Skeleton />
      ) : items.length === 0 ? (
        <p className={styles.muted}>{t('home.queue.empty')}</p>
      ) : (
        <>
          <p className={styles.summary}>
            {t('home.queue.summary', { open: items.length, missing })}
          </p>
          {vote.error ? <ProblemMessage code={problemCode(vote.error)} /> : null}
          <ul className={styles.list}>
            {items.slice(0, QUEUE_ITEMS).map((q) => (
              <QueueRow
                key={q.id}
                item={q}
                own={q.createdBy === meId}
                voting={vote.isPending}
                onVote={(on) => vote.mutate({ id: q.id, on })}
              />
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function QueueRow({
  item: q,
  own,
  voting,
  onVote,
}: {
  item: QueueItem;
  own: boolean;
  voting: boolean;
  onVote: (on: boolean) => void;
}) {
  const { t } = useTranslation();
  const Vote = actionIcons.vote;
  return (
    <li className={styles.queueRow}>
      <span className={styles.rowMain}>
        <Link to={`/projekte/${q.projectId}`}>{q.name}</Link>
        <span className={styles.muted}>{t('home.queue.by', { name: q.createdByName })}</span>
      </span>
      <EffortChip effort={q.effort} size="sm" />
      <span className={styles.voteCell}>
        <button
          type="button"
          className={styles.iconButton}
          aria-pressed={q.votes.mine}
          aria-label={
            own ? t('queue.voteOwn', { name: q.name }) : t('queue.voteFor', { name: q.name })
          }
          title={own ? t('queue.voteOwnHint') : undefined}
          disabled={own || voting}
          onClick={() => onVote(!q.votes.mine)}
        >
          <Vote size={ICON_SIZE.table} aria-hidden fill={q.votes.mine ? 'currentColor' : 'none'} />
        </button>
        <span>{q.votes.count}</span>
      </span>
    </li>
  );
}

// ---- Wetter heute ----------------------------------------------------------------------------------

function WeatherCard() {
  const { t } = useTranslation();
  const sites = useEquipmentList('sites');
  const list = sites.data ?? [];
  return (
    <Card
      title={t('home.weather.title')}
      icon={areaIcons.weather}
      to={WEATHER_PATH}
      more={t('home.weather.more')}
    >
      {sites.isError ? (
        <ProblemMessage code={problemCode(sites.error)} onRetry={() => void sites.refetch()} />
      ) : sites.isPending ? (
        <Skeleton />
      ) : list.length === 0 ? (
        <p className={styles.muted}>{t('home.weather.empty')}</p>
      ) : (
        <ul className={styles.sites}>
          {list.map((s) => (
            <SiteTonight key={s.id} site={s} />
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Farbband der laufenden bzw. kommenden Nacht (wie `WeatherChart`: erstes Nachtfenster, das noch nicht vorbei ist). */
export function tonight(view: WeatherView, nowMs: number) {
  const window =
    view.nightWindows.find((w) => Date.parse(w.endUtc) > nowMs) ?? view.nightWindows[0] ?? null;
  if (!window) return null;
  const from = Date.parse(window.startUtc);
  const to = Date.parse(window.endUtc);
  const cells = view.hours
    .filter((h) => {
      const at = Date.parse(h.tUtc);
      return at >= from && at < to;
    })
    .map((h) => ({
      tUtc: h.tUtc,
      score: h.overallScore,
      ratingIndex: h.ratingIndex,
      colour: ratingColour(h.overallScore, daylightFade(h.sunAltDeg)),
    }));
  return {
    window,
    night: view.nights.find((n) => n.night === window.night) ?? null,
    cells,
  };
}

function SiteTonight({ site }: { site: SiteView }) {
  const { t } = useTranslation();
  const num = useNumber();
  const weather = useSiteWeather(site.id);
  const now = useNow();
  const view = weather.data;
  const data = view && view.status === 'ready' ? tonight(view, now.getTime()) : null;
  const zone = view?.timeZone ?? site.timeZone;
  const clock = (iso: string) => `${formatZonedTime(iso, zone)} ${formatTzAbbr(iso, zone)}`;
  const rating = (index: number | null, score: number | null) =>
    score === null || index === null
      ? t('weather.rating.none')
      : `${t(`weather.rating.${String(index)}`)} ${num(score * 100, 0)} %`;
  const n = data?.night ?? null;
  const w = n?.bestWindow ?? null;
  return (
    <li className={styles.site}>
      <h3 className={styles.siteName}>
        <Link to={weatherHref(site.id)}>{site.name}</Link>
        {data ? (
          <span className={styles.muted}>
            {formatNightKey(data.window.night)}
            {n && n.darkFromUtc !== null ? ` · ${rating(n.ratingIndex, n.nightMean)}` : ''}
          </span>
        ) : null}
      </h3>
      {weather.isError && !view ? (
        <ProblemMessage code={problemCode(weather.error)} onRetry={() => void weather.refetch()} />
      ) : !view ? (
        <Skeleton />
      ) : view.status === 'pending' ? (
        <p className={styles.muted} role="status">
          {t('weatherPage.pending')}
        </p>
      ) : !data || data.cells.length === 0 ? (
        <p className={styles.muted}>{t('home.weather.noNight')}</p>
      ) : (
        <>
          <div
            className={styles.band}
            role="img"
            aria-label={t('home.weather.band', {
              night: formatNightKey(data.window.night),
              site: site.name,
            })}
          >
            {data.cells.map((c) => (
              <span
                key={c.tUtc}
                className={styles.bandCell}
                style={{ background: c.colour }}
                title={`${clock(c.tUtc)} · ${rating(c.ratingIndex, c.score)}`}
              />
            ))}
          </div>
          <div className={styles.bandScale} aria-hidden>
            <span>{clock(data.window.startUtc)}</span>
            <span>{clock(data.window.endUtc)}</span>
          </div>
          <p className={styles.muted}>
            {n && n.darkFromUtc === null
              ? t('weather.chart.noDark')
              : w
                ? t('home.weather.window', {
                    from: formatZonedTime(w.fromUtc, zone),
                    to: formatZonedTime(w.toUtc, zone),
                    zone: formatTzAbbr(w.toUtc, zone),
                    h: num(w.sec / 3600, 1),
                  })
                : t('home.weather.noWindow')}
          </p>
        </>
      )}
    </li>
  );
}

// ---- Aktive Projekte -------------------------------------------------------------------------------

function ProjectsCard() {
  const { t } = useTranslation();
  const list = useQuery({
    queryKey: LIST_KEY,
    queryFn: async () => (await projectsApi.list()).items,
  });
  const rigs = useEquipmentList('rigs');
  const active = useMemo(
    () => (list.data ?? []).filter((p) => p.status === 'active' && p.deletedAt === null),
    [list.data],
  );
  const groups = groupByRig(
    active,
    (rigs.data ?? []).map((r) => r.id),
  );
  const rigName = (rigId: string) =>
    rigId === NO_RIG
      ? t('projectList.noRig')
      : ((rigs.data ?? []).find((r) => r.id === rigId)?.name ?? t('projectList.unknownRig'));
  return (
    <Card
      title={t('home.projects.title')}
      icon={areaIcons.projects}
      to={PROJECT_AREA.list}
      more={t('home.projects.more')}
      className={styles.wide}
    >
      {list.isError ? (
        <ProblemMessage code={problemCode(list.error)} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <Skeleton />
      ) : active.length === 0 ? (
        <p className={styles.muted}>{t('home.projects.empty')}</p>
      ) : (
        <div className={styles.rigGroups}>
          {groups.map((g) => (
            <div key={g.rigId} className={styles.rigGroup}>
              <h3 className={styles.rigName}>{rigName(g.rigId)}</h3>
              <ul className={styles.list}>
                {g.items.map((p) => (
                  <ProjectRow key={p.id} project={p} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ProjectRow({ project: p }: { project: ProjectListItem }) {
  const { t } = useTranslation();
  const num = useNumber();
  return (
    <li className={styles.projectRow}>
      <Link className={styles.projectName} to={`/projekte/${p.id}`}>
        {p.name}
      </Link>
      <span className={styles.progress}>
        <ProgressBar
          acquired={Math.round((p.progress.percentDone / 100) * 1000)}
          planned={1000}
          size="sm"
          showLabel={false}
        />
      </span>
      <span className={styles.numbers}>
        {t('home.projects.hours', {
          done: num(p.progress.integrationS / 3600, 1),
          planned: num(p.progress.plannedS / 3600, 1),
        })}
      </span>
      <span className={styles.numbers}>{`${num(p.progress.percentDone, 0)} %`}</span>
      <EffortChip effort={p.effort} stale={p.effortStale} size="sm" />
    </li>
  );
}

// ---- Letzte Sessions -------------------------------------------------------------------------------

function SessionsCard() {
  const { t } = useTranslation();
  const list = useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: async () => (await sessionsApi.list({ unreviewed: false })).items,
  });
  const latest = useMemo(
    () =>
      [...(list.data ?? [])]
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, SESSION_ITEMS),
    [list.data],
  );
  const columns: DataColumn<NightSession>[] = [
    {
      id: 'night',
      header: t('sessions.col.night'),
      nowrap: true,
      cell: (s) => <Link to={`${SESSIONS_PATH}/${s.id}`}>{formatNightKey(s.night)}</Link>,
    },
    { id: 'rig', header: t('sessions.col.rig'), priority: 2, cell: (s) => s.rigName },
    {
      id: 'integration',
      header: t('sessions.col.integration'),
      priority: 2,
      align: 'end',
      nowrap: true,
      cell: (s) => t('sessions.hours', { h: sessionHours(s.integrationS) }),
    },
    {
      id: 'status',
      header: t('sessions.col.status'),
      cell: (s) => <StatusBadge kind="session" value={s.status} size="sm" />,
    },
  ];
  return (
    <Card
      title={t('home.sessions.title')}
      icon={areaIcons.evaluation}
      to={SESSIONS_PATH}
      more={t('home.sessions.more')}
      className={styles.side}
    >
      <DataTable
        columns={columns}
        rows={latest}
        rowKey={(s) => s.id}
        rowLabel={(s) => `${formatNightKey(s.night)} · ${s.rigName}`}
        label={t('home.sessions.title')}
        serverSorted
        state={list.isPending ? 'loading' : list.isError ? 'error' : 'ready'}
        empty={t('home.sessions.empty')}
        error={
          <ProblemMessage code={problemCode(list.error)} onRetry={() => void list.refetch()} />
        }
      />
    </Card>
  );
}
