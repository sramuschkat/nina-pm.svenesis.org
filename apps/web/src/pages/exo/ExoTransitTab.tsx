/**
 * Reiter *Exoplanet-Transit* im Projekt-Editor S-31 (AP-42 Teil 2; FA-EXO-15…17):
 * - gespeicherte Ephemeride (T₀ ± σ, P ± σ, Dauer, Quelle, Stand) mit früheren Ständen als Historie;
 * - neuerer Katalogstand als Angebot mit Änderung von P und Wirkung auf die nächste Transitmitte, *Übernehmen*;
 * - Exoplaneten-Projekte anderer Mitglieder zum selben Planeten als Hinweis mit Link;
 * - kommende beobachtbare Transits (60 Nächte) aus der gespeicherten Ephemeride mit Höhe, Mond, Meridian und
 *   Wetterbewertung, soweit eine Prognose vorliegt; aufgeklappt dieselbe Zeitleiste wie in der Suche.
 * AP-43 (transit.md §8): *Festlegen* je Transit (Wunsch vor der Freigabe, Bestätigung bzw. sofort danach),
 * Belegung auf dem Rig, Vorschlag des nächsten Transits (FA-EXO-30), Beobachtungen mit Status, Frist und
 * *Aufheben*, Transit-Einstellungen (FA-EXO-19/20). Rechnen und Regeln prüfen tut der Server.
 */
import { formatNightKey } from '@nina-pm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  exoApi,
  type ExoEphemerisView,
  type ExoObservationView,
  type ExoProjectDetail,
  type ExoProjectPatch,
} from '../../api/client';
import { ApiError } from '../../auth';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { ICON_SIZE, uiIcons } from '../../components/icons';
import { ProblemMessage, problemI18nKey } from '../../components/ProblemMessage';
import { StatusBadge } from '../../components/StatusBadge';
import { formatDateTime } from '../../lib/time';
import { problemCode, useNumber } from '../equipment/shared';
import { useSiteWeather } from '../weather/WeatherPage';
import { EXO_CATALOG_LABELS, siteClock } from './model';
import { TransitTimeline } from './TransitTimeline';
import styles from './exo.module.css';
import { MemberAvatarFor } from '../../lib/member';

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
  const done = (next: ExoProjectDetail) => {
    client.setQueryData(exoProjectKey(projectId), next);
    void client.invalidateQueries({ queryKey: ['project', projectId] });
  };
  const refresh = useMutation({
    mutationFn: () => exoApi.refreshEphemeris(projectId),
    onSuccess: done,
  });
  const lock = useMutation({
    mutationFn: (epoch: number) => exoApi.lock(projectId, epoch),
    onSuccess: done,
  });
  const [cancelId, setCancelId] = useState<string | null>(null);
  const unlock = useMutation({
    mutationFn: (id: string) => exoApi.unlock(projectId, id),
    onSuccess: (next) => {
      done(next);
      setCancelId(null);
    },
  });
  const weather = useSiteWeather(query.data?.site?.id ?? null);

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
  const nowMs = Date.now();
  const admin = d.maxOpen === null;
  const full = d.maxOpen !== null && d.lockMode !== 'wish' && d.openCount >= d.maxOpen;
  const rating = (night: string) => {
    const n = weather.data?.nights.find((w) => w.night === night);
    return n && n.ratingIndex !== null ? t(`weather.rating.${String(n.ratingIndex)}`) : null;
  };
  const actionLabel = d.lockMode ? t(`exo.project.lock.${d.lockMode}`) : '';
  const lockDisabled = (r: Upcoming) =>
    !d.lockMode ||
    r.observationId !== null ||
    (r.conflict !== null && r.conflict.kind !== 'share') ||
    full ||
    (!admin && Date.parse(r.deadlineUtc) < nowMs) ||
    lock.isPending;
  const statusOf = (id: string) => d.observations.find((o) => o.id === id)?.status ?? null;
  const openObs = d.observations.filter(
    (o) =>
      (o.status === 'requested' || o.status === 'locked') && Date.parse(o.windowEndUtc) > nowMs,
  );
  const approvedMode = d.lockMode === 'lock' || d.lockMode === 'request';
  const lockProblem = lock.error instanceof ApiError ? lock.error.problem : null;

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
      cell: (r) => (
        <>
          <span className={styles.nowrap}>{clock(r.item.transit.tcUtc)}</span>
          {r.item.transit.n === d.suggestedEpoch ? (
            <span className={styles.suggest}>{t('exo.project.suggested')}</span>
          ) : null}
          {r.conflict ? (
            <span
              className={`${r.conflict.kind === 'share' ? styles.shareText : styles.conflictText} ${styles.byLine}`}
            >
              <MemberAvatarFor id={r.conflict.createdBy} />
              {t(`exo.project.conflict.${r.conflict.kind}`, {
                name: r.conflict.projectName,
                by: r.conflict.createdByName,
              })}
            </span>
          ) : null}
        </>
      ),
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
    {
      id: 'weather',
      header: t('exo.project.col.weather'),
      cell: (r) => rating(r.night) ?? '–',
      nowrap: true,
      priority: 3,
    },
    {
      id: 'action',
      header: t('exo.project.col.action'),
      headerHidden: true,
      nowrap: true,
      cell: (r) =>
        r.observationId ? (
          <StatusBadge kind="transit" value={statusOf(r.observationId)} size="sm" />
        ) : d.lockMode ? (
          <button
            type="button"
            className={styles.smallButton}
            disabled={lockDisabled(r)}
            aria-label={t('exo.project.lockAria', {
              label: actionLabel,
              night: formatNightKey(r.night),
            })}
            onClick={() => lock.mutate(r.item.transit.n)}
          >
            {actionLabel}
          </button>
        ) : null,
    },
  ];

  const obsColumns: DataColumn<ExoObservationView>[] = [
    {
      id: 'night',
      header: t('exo.project.col.night'),
      cell: (o) => formatNightKey(o.night),
      nowrap: true,
    },
    {
      id: 'status',
      header: t('exo.project.col.status'),
      cell: (o) => (
        <>
          <StatusBadge kind="transit" value={o.status} size="sm" />
          {o.primaryObservationId ? (
            <span className={styles.shareText}>{t('exo.project.shared')}</span>
          ) : null}
        </>
      ),
    },
    {
      id: 'window',
      header: t('exo.project.col.window'),
      cell: (o) => `${clock(o.windowStartUtc)} – ${clock(o.windowEndUtc)}`,
      priority: 2,
    },
    {
      id: 'deadline',
      header: t('exo.project.col.deadline'),
      cell: (o) =>
        o.status === 'requested' && o.confirmDeadlineUtc ? (
          <>
            <span className={styles.nowrap}>{clock(o.confirmDeadlineUtc)}</span>
            {!admin && Date.parse(o.confirmDeadlineUtc) < nowMs ? (
              <span className={styles.conflictText}>{t('exo.project.deadlinePassed')}</span>
            ) : null}
          </>
        ) : (
          '–'
        ),
      priority: 2,
    },
    {
      id: 'frames',
      header: t('exo.project.col.frames'),
      cell: (o) => `${String(o.acquiredCount)} / ${String(o.plannedCount)}`,
      align: 'end',
      nowrap: true,
      priority: 3,
    },
    {
      id: 'action',
      header: t('exo.project.col.action'),
      headerHidden: true,
      nowrap: true,
      cell: (o) =>
        d.lockMode &&
        (o.status === 'requested' || o.status === 'locked') &&
        Date.parse(o.windowEndUtc) > nowMs ? (
          <button
            type="button"
            className={styles.smallButton}
            aria-label={t('exo.project.cancelAria', { night: formatNightKey(o.night) })}
            onClick={() => setCancelId(o.id)}
          >
            {t('exo.project.cancel')}
          </button>
        ) : null,
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
                <MemberAvatarFor id={o.createdBy} size={16} />{' '}
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

      <section className={styles.card} aria-label={t('exo.project.observationsTitle')}>
        <h3 className={styles.cardTitle}>
          {t('exo.project.observationsTitle')}
          {d.maxOpen !== null ? (
            <span className={styles.muted}>
              {' '}
              · {t('exo.project.openOf', { open: d.openCount, max: d.maxOpen })}
            </span>
          ) : null}
        </h3>
        <p className={styles.muted}>
          {d.lockMode
            ? t(`exo.project.mode.${d.lockMode}`)
            : t(`exo.project.blocked.${d.lockBlockedReason ?? 'no_right'}`)}
        </p>
        {approvedMode && !openObs.some((o) => o.status === 'locked') ? (
          <p className={styles.warn}>{t('exo.project.notPlannable')}</p>
        ) : null}
        {full ? <p className={styles.warn}>{t('exo.project.full')}</p> : null}
        {lock.error ? (
          <div role="alert">
            <ProblemMessage code={problemCode(lock.error)} />
            {lockProblem?.errors?.length ? (
              <ul className={styles.history}>
                {lockProblem.errors.map((e, i) => (
                  <li key={`${e.path}-${String(i)}`}>{e.message}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {d.observations.length === 0 ? (
          <p className={styles.muted}>{t('exo.project.observationsNone')}</p>
        ) : (
          <DataTable
            columns={obsColumns}
            rows={d.observations}
            rowKey={(o) => o.id}
            rowLabel={(o) => formatNightKey(o.night)}
            label={t('exo.project.observationsTitle')}
          />
        )}
      </section>

      <ExoSettings
        key={`${String(d.baselineBeforeMin)}-${String(d.baselineAfterMin)}-${String(d.bufferSigma)}-${String(d.allowAutofocus)}-${String(d.allowRecenter)}-${d.defocusHint ?? ''}`}
        d={d}
        canUpdate={canUpdate}
        onSaved={done}
      />

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
      <ConfirmDialog
        open={cancelId !== null}
        title={t('exo.project.cancelTitle')}
        consequence={t('exo.project.cancelConsequence')}
        confirmLabel={t('exo.project.cancel')}
        variant="danger"
        state={unlock.isPending ? 'loading' : unlock.isError ? 'error' : 'ready'}
        {...(unlock.error ? { errorKey: problemI18nKey(problemCode(unlock.error)) } : {})}
        onConfirm={() => {
          if (cancelId) unlock.mutate(cancelId);
        }}
        onCancel={() => setCancelId(null)}
      />
    </div>
  );
}

/** Transit-Einstellungen (FA-EXO-19/20): Baseline, Puffer k, Autofokus/Zentrieren, Defokus-Hinweis. */
function ExoSettings({
  d,
  canUpdate,
  onSaved,
}: {
  d: ExoProjectDetail;
  canUpdate: boolean;
  onSaved: (next: ExoProjectDetail) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [form, setForm] = useState<Required<ExoProjectPatch>>({
    baselineBeforeMin: d.baselineBeforeMin,
    baselineAfterMin: d.baselineAfterMin,
    bufferSigma: Math.min(3, Math.max(1, Math.round(d.bufferSigma))),
    allowAutofocus: d.allowAutofocus,
    allowRecenter: d.allowRecenter,
    defocusHint: d.defocusHint,
  });
  const save = useMutation({
    mutationFn: () =>
      exoApi.patch(d.projectId, { ...form, defocusHint: form.defocusHint?.trim() || null }),
    onSuccess: onSaved,
  });
  const num = (key: 'baselineBeforeMin' | 'baselineAfterMin', label: string) => (
    <div className={styles.settingsField}>
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <input
        id={`${id}-${key}`}
        className={styles.settingsInput}
        type="number"
        min={0}
        max={240}
        step={5}
        value={form[key]}
        disabled={!canUpdate}
        onChange={(e) =>
          setForm({ ...form, [key]: Math.max(0, Math.min(240, Number(e.target.value) || 0)) })
        }
      />
    </div>
  );
  return (
    <details className={styles.card}>
      <summary className={styles.cardTitle}>{t('exo.project.settings.title')}</summary>
      <div className={styles.settings}>
        {num('baselineBeforeMin', t('exo.project.settings.baselineBefore'))}
        {num('baselineAfterMin', t('exo.project.settings.baselineAfter'))}
        <div className={styles.settingsField}>
          <label htmlFor={`${id}-k`}>{t('exo.project.settings.buffer')}</label>
          <select
            id={`${id}-k`}
            className={styles.settingsInput}
            value={form.bufferSigma}
            disabled={!canUpdate}
            onChange={(e) => setForm({ ...form, bufferSigma: Number(e.target.value) })}
          >
            {[1, 2, 3].map((k) => (
              <option key={k} value={k}>
                {`${String(k)} σ`}
              </option>
            ))}
          </select>
        </div>
        <label className={styles.settingsCheck}>
          <input
            type="checkbox"
            checked={form.allowAutofocus}
            disabled={!canUpdate}
            onChange={(e) => setForm({ ...form, allowAutofocus: e.target.checked })}
          />
          {t('exo.project.settings.autofocus')}
        </label>
        <label className={styles.settingsCheck}>
          <input
            type="checkbox"
            checked={form.allowRecenter}
            disabled={!canUpdate}
            onChange={(e) => setForm({ ...form, allowRecenter: e.target.checked })}
          />
          {t('exo.project.settings.recenter')}
        </label>
        <div className={`${styles.settingsField} ${styles.settingsWide}`}>
          <label htmlFor={`${id}-defocus`}>{t('exo.project.settings.defocus')}</label>
          <input
            id={`${id}-defocus`}
            className={styles.settingsInput}
            type="text"
            maxLength={200}
            value={form.defocusHint ?? ''}
            disabled={!canUpdate}
            onChange={(e) => setForm({ ...form, defocusHint: e.target.value })}
          />
        </div>
      </div>
      <p className={styles.muted}>{t('exo.project.settings.hint')}</p>
      {save.error ? <ProblemMessage code={problemCode(save.error)} /> : null}
      {canUpdate ? (
        <button
          type="button"
          className={styles.smallButton}
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          {t('exo.project.settings.save')}
        </button>
      ) : null}
    </details>
  );
}
