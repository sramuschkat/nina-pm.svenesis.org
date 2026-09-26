/**
 * S-02 „Heute Nacht“ (FK 14.3; FA-FOL-06, FA-FOL-05; AP-35): je Rig eine Karte für die **aktuelle Nacht** des
 * Standorts (`GET /web/v1/tonight`, vom Server nach NT-01 bestimmt – nie aus dem Browserdatum) mit Nachtfenster,
 * Dunkelheit, Mond (Beleuchtung, Auf-/Untergang), Wetterbewertung als Farbband aus Astro-Wetter, geplanten
 * Projekten mit erwarteten Frames (Prognose, AP-33), Zeilen „nur heute aus“ (Admin), NINA-Instanzen und Link zur
 * Safety-/Wetterseite der Sternwarte. Alle Zeiten in Standortzeit mit Kürzel (NT-03). Darunter ungeprüfte
 * Sessions und – für Admins – die offene Warteschlange.
 */
import { formatNightKey } from '@nina-pm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  approvalApi,
  forecastApi,
  sessionsApi,
  tonightApi,
  type TonightRig,
} from '../../api/client';
import { useCan } from '../../auth';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { ProblemMessage } from '../../components/ProblemMessage';
import { SiteTime } from '../../components/SiteTime';
import { ratingColour } from '../../components/WeatherChart';
import { daylightFade } from '../../components/WeatherChart/model';
import { useJob } from '../../lib/use-job';
import { problemCode } from '../admin/shared';
import { useEquipmentList } from '../equipment/shared';
import { PROJECT_AREA } from '../projects/ProjectsLayout';
import { SESSIONS_PATH } from '../sessions/SessionsPage';
import styles from './tonight.module.css';
import { TonightLines } from './TonightLines';

export const TONIGHT_PATH = '/heute-nacht';
export const TONIGHT_KEY = ['tonight'] as const;
/** Einträge je Liste unter den Karten. */
const LIST_ITEMS = 5;

export function TonightPage() {
  const { t } = useTranslation();
  const canSessions = useCan('session.read');
  const canQueue = useCan('queue.decide');
  const tonight = useQuery({
    queryKey: TONIGHT_KEY,
    queryFn: () => tonightApi.get(),
    // Die aktuelle Nacht wechselt am Ende des Nachtfensters; NINA meldet sich laufend.
    refetchInterval: 5 * 60_000,
  });
  const filters = useEquipmentList('filters');
  const colorOf = (short: string) =>
    (filters.data ?? []).find((f) => f.shortName === short)?.colorHex ?? '#888888';
  const rigs = tonight.data?.rigs ?? [];
  return (
    <div className={styles.page}>
      <PageHeader title={t('tonight.title')} meta={t('tonight.intro')} />
      {tonight.isError ? (
        <ProblemMessage code={problemCode(tonight.error)} onRetry={() => void tonight.refetch()} />
      ) : tonight.isPending ? (
        <p className={styles.muted} role="status">
          {t('common.loading')}
        </p>
      ) : rigs.length === 0 ? (
        <p className={styles.muted}>{t('tonight.empty')}</p>
      ) : (
        <div className={styles.rigs}>
          {rigs.map((r) => (
            <RigCard key={r.rigId} rig={r} colorOf={colorOf} />
          ))}
        </div>
      )}
      {canSessions || canQueue ? (
        <div className={styles.columns}>
          {canSessions ? <UnreviewedCard /> : null}
          {canQueue ? <QueueCard /> : null}
        </div>
      ) : null}
    </div>
  );
}

function RigCard({ rig, colorOf }: { rig: TonightRig; colorOf: (filter: string) => string }) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const canRun = useCan('simulation.run');
  const client = useQueryClient();
  const n = (x: number, d = 1) => x.toLocaleString(i18n.language, { maximumFractionDigits: d });
  const [jobId, setJobId] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => forecastApi.run(rig.rigId),
    onSuccess: (r) => setJobId(r.jobId),
  });
  const job = useJob<unknown>(jobId);
  const done = job.job.data?.status === 'done';
  useEffect(() => {
    if (done) void client.invalidateQueries({ queryKey: TONIGHT_KEY });
  }, [done, client]);
  const zone = rig.siteTimeZone;
  const w = rig.weather;
  const rating =
    w && w.ratingIndex !== null && w.nightMean !== null
      ? t('tonight.weatherRating', {
          rating: t(`weather.rating.${String(w.ratingIndex)}`),
          pct: n(w.nightMean * 100, 0),
        })
      : null;
  const rise = rig.moon.events.find((e) => e.type === 'rise');
  const set = rig.moon.events.find((e) => e.type === 'set');
  const columns: DataColumn<TonightRig['projects'][number]>[] = [
    {
      id: 'name',
      header: t('tonight.col.project'),
      sortValue: (p) => p.name,
      cell: (p) => <Link to={`/projekte/${p.projectId}`}>{p.name}</Link>,
    },
    {
      id: 'frames',
      header: t('tonight.col.frames'),
      align: 'end',
      sortValue: (p) => p.frames,
      cell: (p) => p.frames,
    },
    {
      id: 'hours',
      header: t('tonight.col.hours'),
      align: 'end',
      priority: 2,
      sortValue: (p) => p.hours,
      cell: (p) => `${n(p.hours)} h`,
    },
    {
      id: 'lines',
      header: t('tonight.col.lines'),
      cell: (p) => (
        <TonightLines
          projectId={p.projectId}
          lines={p.lines}
          colorOf={colorOf}
          onChanged={() => run.mutate()}
        />
      ),
    },
  ];
  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <div className={styles.cardHead}>
        <h2 id={headingId} className={styles.cardTitle}>
          {rig.rigName}
        </h2>
        <span className={styles.muted}>
          {rig.siteName} · {t('tonight.night', { night: formatNightKey(rig.night) })}
        </span>
      </div>
      <div className={styles.cardBody}>
        <dl className={styles.facts}>
          <div>
            <dt>{t('tonight.dark')}</dt>
            <dd>
              {rig.dark ? (
                <>
                  <SiteTime atUtc={rig.dark.fromUtc} siteTimeZone={zone} />–
                  <SiteTime atUtc={rig.dark.toUtc} siteTimeZone={zone} /> ·{' '}
                  {t('tonight.darkValue', { h: n(rig.darkHours) })}
                </>
              ) : (
                t('tonight.noDark')
              )}
            </dd>
          </div>
          <div>
            <dt>{t('tonight.moon')}</dt>
            <dd>
              {t('tonight.moonIllum', { pct: n(rig.moon.illumPct, 0) })}
              {rise ? (
                <>
                  {' · '}
                  {t('tonight.moonRise')} <SiteTime atUtc={rise.atUtc} siteTimeZone={zone} />
                </>
              ) : null}
              {set ? (
                <>
                  {' · '}
                  {t('tonight.moonSet')} <SiteTime atUtc={set.atUtc} siteTimeZone={zone} />
                </>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>{t('tonight.weather')}</dt>
            <dd>
              {rating ?? t('tonight.weatherNone')}
              {w?.bestWindow ? (
                <>
                  {' · '}
                  {t('tonight.bestWindow')}{' '}
                  <SiteTime atUtc={w.bestWindow.fromUtc} siteTimeZone={zone} />–
                  <SiteTime atUtc={w.bestWindow.toUtc} siteTimeZone={zone} />
                </>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>{t('tonight.nina')}</dt>
            <dd>
              {rig.instances.length === 0
                ? t('tonight.ninaNone')
                : rig.instances.map((i, k) => (
                    <span key={i.id}>
                      {k > 0 ? ' · ' : ''}
                      {i.name}:{' '}
                      {i.lastSeenAt ? (
                        <>
                          {t('tonight.ninaSeen')}{' '}
                          <SiteTime atUtc={i.lastSeenAt} siteTimeZone={zone} withDate />
                        </>
                      ) : (
                        t('tonight.ninaNever')
                      )}
                    </span>
                  ))}
            </dd>
          </div>
        </dl>
        {w && w.hours.length > 0 && rig.nightWindow ? (
          <div>
            <div
              className={styles.band}
              role="img"
              aria-label={t('tonight.band', {
                night: formatNightKey(rig.night),
                rig: rig.rigName,
              })}
            >
              {w.hours.map((h) => (
                <span
                  key={h.tUtc}
                  className={styles.bandCell}
                  style={{
                    background: ratingColour(h.overallScore, daylightFade(h.sunAltDeg ?? 0)),
                  }}
                />
              ))}
            </div>
            <div className={styles.bandScale} aria-hidden>
              <SiteTime atUtc={rig.nightWindow.startUtc} siteTimeZone={zone} />
              <SiteTime atUtc={rig.nightWindow.endUtc} siteTimeZone={zone} />
            </div>
          </div>
        ) : null}
        {rig.weatherSafetyUrl ? (
          <p>
            <a href={rig.weatherSafetyUrl} target="_blank" rel="noopener noreferrer">
              {t('tonight.safety')}
            </a>
          </p>
        ) : null}
        <h3 className={styles.subTitle}>{t('tonight.planned')}</h3>
        {run.error ? <ProblemMessage code={problemCode(run.error)} /> : null}
        {job.failed ? <ProblemMessage code={job.errorCode ?? 'internal.error'} /> : null}
        {job.running ? (
          <p className={styles.muted} role="status">
            {t('tonight.computing')}
          </p>
        ) : null}
        {!rig.forecast.covered ? (
          <p className={styles.note}>
            {t('tonight.notCovered')}{' '}
            {canRun ? (
              <button
                type="button"
                className={styles.button}
                disabled={run.isPending || job.running}
                onClick={() => run.mutate()}
              >
                {t('tonight.compute')}
              </button>
            ) : null}
          </p>
        ) : (
          <DataTable
            columns={columns}
            rows={rig.projects}
            rowKey={(p) => p.projectId}
            rowLabel={(p) => p.name}
            label={t('tonight.plannedLabel', { rig: rig.rigName })}
            empty={t('tonight.noProjects')}
          />
        )}
        {rig.forecast.covered && rig.idleProjects > 0 ? (
          <p className={styles.muted}>{t('tonight.idle', { n: rig.idleProjects })}</p>
        ) : null}
      </div>
    </section>
  );
}

function UnreviewedCard() {
  const { t } = useTranslation();
  const headingId = useId();
  const sessions = useQuery({
    queryKey: ['sessions', '', true],
    queryFn: async () => (await sessionsApi.list({ unreviewed: true })).items,
  });
  const items = (sessions.data ?? []).slice(0, LIST_ITEMS);
  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <div className={styles.cardHead}>
        <h2 id={headingId} className={styles.cardTitle}>
          {t('tonight.unreviewed')}
        </h2>
        <Link to={SESSIONS_PATH} className={styles.more}>
          {t('tonight.unreviewedMore')}
        </Link>
      </div>
      <div className={styles.cardBody}>
        {sessions.isError ? (
          <ProblemMessage
            code={problemCode(sessions.error)}
            onRetry={() => void sessions.refetch()}
          />
        ) : sessions.isPending ? (
          <p className={styles.muted} role="status">
            {t('common.loading')}
          </p>
        ) : items.length === 0 ? (
          <p className={styles.muted}>{t('tonight.unreviewedEmpty')}</p>
        ) : (
          <ul className={styles.list}>
            {items.map((s) => (
              <li key={s.id}>
                <Link to={`${SESSIONS_PATH}/${s.id}`}>{formatNightKey(s.night)}</Link>{' '}
                <span className={styles.muted}>
                  {s.rigName} · {t('tonight.lineFrames', { frames: s.frames })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function QueueCard() {
  const { t } = useTranslation();
  const headingId = useId();
  const queue = useQuery({
    queryKey: ['projects', 'queue'],
    queryFn: async () => (await approvalApi.queue()).items,
  });
  const items = (queue.data ?? []).slice(0, LIST_ITEMS);
  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <div className={styles.cardHead}>
        <h2 id={headingId} className={styles.cardTitle}>
          {t('tonight.queue')}
          {queue.data ? <span className={styles.muted}> · {queue.data.length}</span> : null}
        </h2>
        <Link to={PROJECT_AREA.queue} className={styles.more}>
          {t('tonight.queueMore')}
        </Link>
      </div>
      <div className={styles.cardBody}>
        {queue.isError ? (
          <ProblemMessage code={problemCode(queue.error)} onRetry={() => void queue.refetch()} />
        ) : queue.isPending ? (
          <p className={styles.muted} role="status">
            {t('common.loading')}
          </p>
        ) : items.length === 0 ? (
          <p className={styles.muted}>{t('tonight.queueEmpty')}</p>
        ) : (
          <ul className={styles.list}>
            {items.map((q) => (
              <li key={`${q.kind}-${q.id}`}>
                <Link to={`/projekte/${q.projectId}`}>{q.name}</Link>{' '}
                <span className={styles.muted}>{q.createdByName}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
