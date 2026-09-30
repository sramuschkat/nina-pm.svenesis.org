/**
 * Reiter *Exoplanet-Transit* im Projekt-Editor S-31 (AP-42 Teil 2; FA-EXO-15…17):
 * - gespeicherte Ephemeride (T₀ ± σ, P ± σ, Dauer, Quelle, Stand) mit früheren Ständen als Historie;
 * - neuerer Katalogstand als Angebot mit Änderung von P und Wirkung auf die nächste Transitmitte, *Übernehmen*;
 * - Exoplaneten-Projekte anderer Mitglieder zum selben Planeten als Hinweis mit Link;
 * - kommende beobachtbare Transits (60 Nächte) aus der gespeicherten Ephemeride mit Höhe, Mond und Meridian;
 *   aufgeklappt dieselbe Zeitleiste wie in der Suche.
 * Rechnen tut der Server; der Reiter formatiert nur.
 */
import { formatNightKey } from '@nina-pm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { exoApi, type ExoEphemerisView, type ExoProjectDetail } from '../../api/client';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { ICON_SIZE, uiIcons } from '../../components/icons';
import { ProblemMessage } from '../../components/ProblemMessage';
import { formatDateTime } from '../../lib/time';
import { problemCode, useNumber } from '../equipment/shared';
import { EXO_CATALOG_LABELS, siteClock } from './model';
import { TransitTimeline } from './TransitTimeline';
import styles from './exo.module.css';

type Upcoming = ExoProjectDetail['upcoming'][number];

export const exoProjectKey = (projectId: string) => ['exo-project', projectId] as const;

export function ExoTransitTab({
  projectId,
  canUpdate,
}: {
  projectId: string;
  /** Recht `project.update` am Projekt (Ephemeride übernehmen, FA-EXO-16). */
  canUpdate: boolean;
}) {
  const { t, i18n } = useTranslation();
  const fmt = useNumber();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: exoProjectKey(projectId),
    queryFn: () => exoApi.project(projectId),
    staleTime: 5 * 60 * 1000,
  });
  const refresh = useMutation({
    mutationFn: () => exoApi.refreshEphemeris(projectId),
    onSuccess: (d) => {
      client.setQueryData(exoProjectKey(projectId), d);
      void client.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });

  if (query.isError)
    return <ProblemMessage code={problemCode(query.error)} onRetry={() => void query.refetch()} />;
  const d = query.data;
  if (!d) return <p className={styles.muted}>{t('exo.project.loading')}</p>;

  const clock = siteClock(d.site?.timeZone ?? null);
  const date = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(iso));
  // σ mit mindestens zwei geltenden Ziffern (P-Fehler liegen oft bei 1e-7 d).
  const sigma = (v: number | null, digits: number) =>
    v === null || !(v > 0)
      ? ''
      : ` ± ${fmt(v, Math.max(digits, Math.min(12, 1 - Math.floor(Math.log10(v)))))}`;
  const ephemerisLine = (e: ExoEphemerisView) =>
    t('exo.project.ephemerisValue', {
      t0: `${fmt(e.t0BjdTdb, 5)}${sigma(e.t0SigmaD, 5)}`,
      period: `${fmt(e.periodD, 7)}${sigma(e.periodSigmaD, 7)}`,
      duration: e.durationH === null ? '–' : fmt(e.durationH, 2),
      source: EXO_CATALOG_LABELS[e.source] ?? e.source,
      date: e.sourceDate ? date(`${e.sourceDate}T12:00:00Z`) : '–',
    });
  const u = d.catalogUpdate;

  // Seitenspalte des Editors: Mitte und Fenster; Ingress/Egress zeigt die aufgeklappte Zeitleiste.
  const columns: DataColumn<Upcoming>[] = [
    {
      id: 'night',
      header: t('exo.project.col.night'),
      cell: (r) => formatNightKey(r.night),
      sortValue: (r) => r.night,
      nowrap: true,
    },
    {
      id: 'mid',
      header: t('exo.project.col.mid'),
      cell: (r) => clock(r.item.transit.tcUtc),
      nowrap: true,
    },
    {
      id: 'window',
      header: t('exo.project.col.window'),
      cell: (r) =>
        `${clock(r.item.transit.windowStartUtc)} – ${clock(r.item.transit.windowEndUtc)}`,
      priority: 3,
    },
    {
      id: 'alt',
      header: t('exo.project.col.alt'),
      cell: (r) => `${fmt(r.item.transit.altAtCenterDeg, 0)}°`,
      sortValue: (r) => r.item.transit.altAtCenterDeg,
      align: 'end',
      nowrap: true,
    },
    {
      id: 'moon',
      header: t('exo.project.col.moon'),
      cell: (r) =>
        `${fmt(r.item.transit.moonSepDeg, 0)}° · ${fmt(r.item.transit.moonIllumPct, 0)} %`,
      sortValue: (r) => r.item.transit.moonSepDeg,
      nowrap: true,
      priority: 2,
    },
    {
      id: 'meridian',
      header: t('exo.project.col.meridian'),
      cell: (r) =>
        r.item.transit.meridianInWindow ? (
          <span className={styles.flipText}>
            <uiIcons.meridianFlip size={ICON_SIZE.table} aria-hidden />
            {t('exo.project.flipInWindow')}
          </span>
        ) : (
          '–'
        ),
      nowrap: true,
      priority: 2,
    },
  ];

  return (
    <div className={styles.projectTab}>
      <section className={styles.card} aria-label={t('exo.project.ephemerisTitle')}>
        <h3 className={styles.cardTitle}>
          {t('exo.project.ephemerisTitle')}
          <span className={styles.muted}> · {d.planet}</span>
        </h3>
        <p>{ephemerisLine(d.ephemeris)}</p>
        {u ? (
          <div className={styles.update} role="status">
            <p>
              {t('exo.project.updateOffer', {
                source: EXO_CATALOG_LABELS[u.catalog] ?? u.catalog,
                date: date(u.fetchedAt),
                period:
                  Math.abs(u.periodDeltaS) < 0.005
                    ? t('exo.project.periodSame')
                    : t('exo.project.periodDelta', {
                        delta: `${u.periodDeltaS >= 0 ? '+' : '−'}${fmt(Math.abs(u.periodDeltaS), 2)}`,
                      }),
                next: d.site
                  ? formatDateTime(u.nextMidUtc, d.site.timeZone, i18n.language)
                  : u.nextMidUtc,
                shift: `${u.nextMidShiftMin >= 0 ? '+' : '−'}${fmt(Math.abs(u.nextMidShiftMin), 1)}`,
              })}
            </p>
            {canUpdate ? (
              <button
                type="button"
                className={styles.smallButton}
                disabled={refresh.isPending}
                onClick={() => refresh.mutate()}
              >
                {t('exo.project.updateApply')}
              </button>
            ) : (
              <p className={styles.muted}>{t('exo.project.updateNoRight')}</p>
            )}
            {refresh.isError ? <ProblemMessage code={problemCode(refresh.error)} /> : null}
          </div>
        ) : null}
        {d.history.length > 0 ? (
          <details>
            <summary>{t('exo.project.history', { count: d.history.length })}</summary>
            <ul className={styles.history}>
              {d.history.map((e) => (
                <li key={e.id}>{ephemerisLine(e)}</li>
              ))}
            </ul>
          </details>
        ) : null}
        {d.others.length > 0 ? (
          <p className={styles.links}>
            <span className={styles.muted}>{t('exo.project.others', { planet: d.planet })} </span>
            {d.others.map((o, i) => (
              <span key={o.projectId}>
                {i > 0 ? ', ' : ''}
                <Link to={`/projekte/${o.projectId}`}>{o.name}</Link>{' '}
                <span className={styles.muted}>
                  (
                  {o.rigName
                    ? t('exo.project.otherByOn', { name: o.createdByName, rig: o.rigName })
                    : t('exo.project.otherBy', { name: o.createdByName })}
                  )
                </span>
              </span>
            ))}
          </p>
        ) : null}
      </section>

      {!d.rig || !d.site ? (
        <p className={styles.muted}>{t('exo.project.noRig')}</p>
      ) : (
        <section className={styles.card} aria-label={t('exo.project.upcomingTitle')}>
          <h3 className={styles.cardTitle}>
            {t('exo.project.upcomingTitle')}
            <span className={styles.muted}>
              {' '}
              ·{' '}
              {t('exo.project.upcomingScope', {
                nights: d.nights,
                rig: d.rig.name,
                minAlt: fmt(d.minAltDeg, 0),
                twilight: t(`nightChart.twilight.${d.twilight}`),
              })}
            </span>
          </h3>
          {d.upcoming.length === 0 ? (
            <p className={styles.muted}>{t('exo.project.upcomingNone', { nights: d.nights })}</p>
          ) : (
            <DataTable
              columns={columns}
              rows={d.upcoming}
              rowKey={(r) => String(r.item.transit.n)}
              rowLabel={(r) => formatNightKey(r.night)}
              label={t('exo.project.upcomingTitle')}
              defaultSort={{ id: 'night', dir: 'asc' }}
              renderDetail={(r) =>
                d.site ? (
                  <TransitTimeline
                    x={r.item}
                    site={d.site}
                    night={r.night}
                    minAltDeg={d.minAltDeg}
                    twilight={d.twilight}
                    showFlip
                  />
                ) : null
              }
            />
          )}
        </section>
      )}
    </div>
  );
}
