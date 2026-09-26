/**
 * Startseite (FK 14.3 S-02; AP-26c, Stilsystem AP-26d): im Mandanten eine Übersicht mit Seitenkopf
 * (*Übersicht*, Mandant und Datum in Mandantenzeit, Hauptaktion *Neues Projekt*), einer Zeile Kennzahlen
 * (aktive Projekte, Warteschlange, Integration im Monat, nächste gute Nacht) und zwei Spalten: links
 * *Aktive Projekte* je Rig als Tabelle und *Letzte Sessions*, rechts *Warteschlange* (Stimme wie S-33)
 * und *Wetter heute Nacht* (Farbband der kommenden bzw. laufenden Nacht je Standort mit bestem Fenster).
 * Kennzahlen und Karten nutzen dieselben Abfragen (ein Cache), haben Lade-, Leer- und Fehlerzustand und
 * erscheinen nur mit dem Recht der Zielseite. Im System-Kontext bleibt der Hinweis zur Verwaltung.
 */
import { formatNightKey, formatTzAbbr, formatZonedTime } from '@nina-pm/shared';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, type ComponentType, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  approvalApi,
  equipmentApi,
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
import { PageHeader } from '../../components/PageHeader';
import { ProblemMessage } from '../../components/ProblemMessage';
import { ProgressBar } from '../../components/ProgressBar';
import { StatusBadge } from '../../components/StatusBadge';
import { ratingColour } from '../../components/WeatherChart';
import { daylightFade } from '../../components/WeatherChart/model';
import { problemCode, useEquipmentList, useNumber } from '../equipment/shared';
import { NO_RIG, groupByRig } from '../projects/list-model';
import { PROJECT_AREA } from '../projects/ProjectsLayout';
import { nightKeyIn } from '../projects/queue-model';
import { SESSIONS_PATH, hours as sessionHours } from '../sessions/SessionsPage';
import { WEATHER_PATH, weatherHref } from '../weather/model';
import { useNow, useSiteWeather, weatherKey } from '../weather/WeatherPage';
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
    <div className={styles.page}>
      <PageHeader title={t('home.title')} meta={t('home.intro')} />
      <section className={styles.card} aria-labelledby="home-system">
        <div className={styles.cardHead}>
          <h2 id="home-system" className={styles.cardTitle}>
            {t('home.systemTitle')}
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p className={styles.muted}>{t('home.systemIntro')}</p>
        </div>
      </section>
    </div>
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
      <PageHeader
        title={t('home.overview')}
        meta={t('home.subtitle', { tenant: me?.tenant?.name ?? '', date })}
        actions={
          canCreate ? (
            <Link to={PROJECT_AREA.create} className={styles.buttonPrimary}>
              <actionIcons.add size={ICON_SIZE.button} aria-hidden />
              {t('projectEditor.new')}
            </Link>
          ) : undefined
        }
      />
      {canProjects || canQueue || canSessions || canWeather ? (
        <ul className={styles.kpis} aria-label={t('home.kpi.label')}>
          {canProjects ? <ProjectsTile /> : null}
          {canQueue ? <QueueTile /> : null}
          {canSessions ? <IntegrationTile zone={zone} now={now} /> : null}
          {canWeather ? <GoodNightTile now={now} /> : null}
        </ul>
      ) : null}
      <div className={styles.columns}>
        <div className={styles.column}>
          {canProjects ? <ProjectsCard /> : null}
          {canSessions ? <SessionsCard /> : null}
        </div>
        <div className={styles.column}>
          {canQueue ? <QueueCard /> : null}
          {canWeather ? <WeatherCard /> : null}
        </div>
      </div>
    </div>
  );
}

// ---- Kennzahlen ------------------------------------------------------------------------------------

function Tile({
  icon: Icon,
  label,
  value,
  sub,
  quiet = false,
}: {
  icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
  label: string;
  value: string;
  sub?: string | undefined;
  /** Kein Wert vorhanden („keine in Sicht“): gedämpft statt groß. */
  quiet?: boolean;
}) {
  return (
    <li className={styles.tile}>
      <span className={styles.tileIcon}>
        <Icon size={ICON_SIZE.button} aria-hidden />
      </span>
      <span className={styles.tileText}>
        <span className={styles.tileLabel}>{label}</span>
        <span className={quiet ? styles.tileQuiet : styles.tileValue}>{value}</span>
        {sub ? <span className={styles.tileSub}>{sub}</span> : null}
      </span>
    </li>
  );
}

function useActiveProjects() {
  const list = useQuery({
    queryKey: LIST_KEY,
    queryFn: async () => (await projectsApi.list()).items,
  });
  const active = useMemo(
    () => (list.data ?? []).filter((p) => p.status === 'active' && p.deletedAt === null),
    [list.data],
  );
  return { list, active };
}

function ProjectsTile() {
  const { t } = useTranslation();
  const { list, active } = useActiveProjects();
  const rigs = new Set(active.flatMap((p) => (p.rigId ? [p.rigId] : []))).size;
  const sub = !list.data
    ? undefined
    : active.length === 0
      ? t('home.kpi.projectsNone')
      : rigs === 0
        ? t('projectList.noRig')
        : rigs === 1
          ? t('home.kpi.rigsOne')
          : t('home.kpi.rigs', { n: rigs });
  return (
    <Tile
      icon={areaIcons.projects}
      label={t('home.projects.title')}
      value={list.data ? String(active.length) : '–'}
      sub={sub}
    />
  );
}

function QueueTile() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const queue = useQuery({
    queryKey: QUEUE_KEY,
    queryFn: async () => (await approvalApi.queue()).items,
  });
  const meId = me?.member?.id ?? '';
  const items = queue.data ?? [];
  const missing = items.filter((q) => !q.votes.mine && q.createdBy !== meId).length;
  return (
    <Tile
      icon={actionIcons.vote}
      label={t('home.queue.title')}
      value={queue.data ? t('home.kpi.queueOpen', { n: items.length }) : '–'}
      sub={queue.data ? t('home.kpi.queueMissing', { n: missing }) : undefined}
    />
  );
}

/** Integration des laufenden Monats (Mandantenzeit) aus den Sessions: nicht verworfene Lights (NT-E3). */
export function monthIntegration(sessions: readonly NightSession[], month: string) {
  const inMonth = sessions.filter((s) => s.night.startsWith(month));
  return {
    seconds: inMonth.reduce((sum, s) => sum + s.integrationS, 0),
    nights: new Set(inMonth.filter((s) => s.integrationS > 0).map((s) => s.night)).size,
  };
}

function IntegrationTile({ zone, now }: { zone: string; now: Date }) {
  const { t, i18n } = useTranslation();
  const num = useNumber();
  const list = useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: async () => (await sessionsApi.list({ unreviewed: false })).items,
  });
  const month = nightKeyIn(now.getTime(), zone).slice(0, 7);
  // Nur Anzeige (Intl): Monatsname in der Mandantenzeit.
  const monthName = new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-GB' : 'de-DE', {
    timeZone: zone,
    month: 'long',
  }).format(now);
  const sum = list.data ? monthIntegration(list.data, month) : null;
  return (
    <Tile
      icon={areaIcons.evaluation}
      label={t('home.kpi.integration', { month: monthName })}
      value={sum ? t('home.kpi.hours', { h: num(sum.seconds / 3600, 1) }) : '–'}
      sub={
        sum
          ? sum.nights === 1
            ? t('home.kpi.nightsOne')
            : t('home.kpi.nights', { n: sum.nights })
          : undefined
      }
    />
  );
}

/**
 * Nächste gute Nacht über alle Standorte: je Standort die erste Nacht ab der laufenden bzw. kommenden
 * mit Dunkelheit und Bewertung mindestens „Gut“; davon die früheste (bei Gleichstand der erste Standort).
 */
export function nextGoodNight(
  entries: readonly { site: SiteView; view: WeatherView | undefined }[],
  nowMs: number,
): { site: SiteView; night: WeatherView['nights'][number] } | null {
  let best: { site: SiteView; night: WeatherView['nights'][number] } | null = null;
  for (const { site, view } of entries) {
    if (!view || view.status !== 'ready') continue;
    const from = tonight(view, nowMs)?.window.night ?? '';
    const night = view.nights.find(
      (n) =>
        n.night >= from && n.darkFromUtc !== null && n.ratingIndex !== null && n.ratingIndex >= 3,
    );
    if (night && (!best || night.night < best.night.night)) best = { site, night };
  }
  return best;
}

function GoodNightTile({ now }: { now: Date }) {
  const { t } = useTranslation();
  const num = useNumber();
  const sites = useEquipmentList('sites');
  const list = sites.data ?? [];
  // Gleiche Abfragen wie `useSiteWeather` (Karte *Wetter heute Nacht*): ein Cache, keine Doppelabrufe.
  const weather = useQueries({
    queries: list.map((s) => ({
      queryKey: weatherKey(s.id),
      queryFn: () => equipmentApi.weather(s.id),
      refetchInterval: 10 * 60_000,
    })),
  });
  const best = nextGoodNight(
    list.map((site, i) => ({ site, view: weather[i]?.data })),
    now.getTime(),
  );
  const loading = sites.isPending || weather.some((w) => w.isPending);
  const label = t('home.kpi.goodNight');
  if (!best)
    return loading ? (
      <Tile icon={areaIcons.weather} label={label} value="–" />
    ) : (
      <Tile icon={areaIcons.weather} label={label} value={t('home.kpi.noGoodNight')} quiet />
    );
  const { site, night } = best;
  return (
    <Tile
      icon={areaIcons.weather}
      label={label}
      value={formatNightKey(night.night)}
      sub={t('home.kpi.goodNightAt', {
        site: site.name,
        rating: `${t(`weather.rating.${String(night.ratingIndex)}`)} ${num((night.nightMean ?? 0) * 100, 0)} %`,
      })}
    />
  );
}

// ---- Rahmen einer Karte -----------------------------------------------------------------------------

/** Karte mit Kopf (Titel links, Link zur Zielseite rechts); Inhalt bündig (Tabelle) oder in `cardBody`. */
function Card({
  title,
  to,
  more,
  children,
}: {
  title: string;
  to: string;
  more: string;
  children: ReactNode;
}) {
  const id = useId();
  const Next = uiIcons.next;
  return (
    <section className={styles.card} aria-labelledby={id}>
      <div className={styles.cardHead}>
        <h2 id={id} className={styles.cardTitle}>
          {title}
        </h2>
        <Link className={styles.more} to={to}>
          {more}
          <Next size={ICON_SIZE.table} aria-hidden />
        </Link>
      </div>
      {children}
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
    mutationFn: ({ id, on, kind }: { id: string; on: boolean; kind: QueueItem['kind'] }) =>
      approvalApi.vote(id, on, kind),
    onSuccess: () => client.invalidateQueries({ queryKey: QUEUE_KEY }),
  });
  const meId = me?.member?.id ?? '';
  const items = queue.data ?? [];
  return (
    <Card title={t('home.queue.title')} to={PROJECT_AREA.queue} more={t('home.queue.more')}>
      <div className={styles.cardBody}>
        {queue.isError ? (
          <ProblemMessage code={problemCode(queue.error)} onRetry={() => void queue.refetch()} />
        ) : queue.isPending ? (
          <Skeleton />
        ) : items.length === 0 ? (
          <p className={styles.muted}>{t('home.queue.empty')}</p>
        ) : (
          <>
            {vote.error ? <ProblemMessage code={problemCode(vote.error)} /> : null}
            <ul className={styles.list}>
              {items.slice(0, QUEUE_ITEMS).map((q) => (
                <QueueRow
                  key={q.id}
                  item={q}
                  own={q.createdBy === meId}
                  voting={vote.isPending}
                  onVote={(on) => vote.mutate({ id: q.id, on, kind: q.kind })}
                />
              ))}
            </ul>
          </>
        )}
      </div>
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

// ---- Wetter heute Nacht-------------------------------------------------------------------------------

function WeatherCard() {
  const { t } = useTranslation();
  const sites = useEquipmentList('sites');
  const list = sites.data ?? [];
  return (
    <Card title={t('home.weather.title')} to={WEATHER_PATH} more={t('home.weather.more')}>
      <div className={styles.cardBody}>
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
      </div>
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
  const num = useNumber();
  const { list, active } = useActiveProjects();
  const rigs = useEquipmentList('rigs');
  const groups = groupByRig(
    active,
    (rigs.data ?? []).map((r) => r.id),
  );
  const rigName = (rigId: string) =>
    rigId === NO_RIG
      ? t('projectList.noRig')
      : ((rigs.data ?? []).find((r) => r.id === rigId)?.name ?? t('projectList.unknownRig'));
  const columns: DataColumn<ProjectListItem>[] = [
    {
      id: 'name',
      header: t('projectList.col.name'),
      cell: (p) => (
        <Link className={styles.projectName} to={`/projekte/${p.id}`}>
          {p.name}
        </Link>
      ),
    },
    {
      id: 'progress',
      header: t('projectList.col.progress'),
      priority: 2,
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
      priority: 3,
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
      id: 'effort',
      header: t('projectList.col.effort'),
      align: 'end',
      nowrap: true,
      cell: (p) => <EffortChip effort={p.effort} stale={p.effortStale} size="sm" />,
    },
  ];
  return (
    <Card title={t('home.projects.title')} to={PROJECT_AREA.list} more={t('home.projects.more')}>
      {list.isError || list.isPending || active.length === 0 ? (
        <div className={styles.cardBody}>
          {list.isError ? (
            <ProblemMessage code={problemCode(list.error)} onRetry={() => void list.refetch()} />
          ) : list.isPending ? (
            <Skeleton />
          ) : (
            <p className={styles.muted}>{t('home.projects.empty')}</p>
          )}
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={groups.flatMap((g) => g.items)}
          rowKey={(p) => p.id}
          rowLabel={(p) => p.name}
          label={t('home.projects.title')}
          serverSorted
          groups={{
            key: (p) => p.rigId ?? NO_RIG,
            header: (key) => <strong>{rigName(key)}</strong>,
          }}
        />
      )}
    </Card>
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
    <Card title={t('home.sessions.title')} to={SESSIONS_PATH} more={t('home.sessions.more')}>
      {list.isError || list.isPending || latest.length === 0 ? (
        <div className={styles.cardBody}>
          {list.isError ? (
            <ProblemMessage code={problemCode(list.error)} onRetry={() => void list.refetch()} />
          ) : list.isPending ? (
            <Skeleton />
          ) : (
            <p className={styles.muted}>{t('home.sessions.empty')}</p>
          )}
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={latest}
          rowKey={(s) => s.id}
          rowLabel={(s) => `${formatNightKey(s.night)} · ${s.rigName}`}
          label={t('home.sessions.title')}
          serverSorted
        />
      )}
    </Card>
  );
}
