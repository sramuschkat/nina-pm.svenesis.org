/**
 * S-64 Klarnacht-Statistik (FK 14.3; FA-AUS-16, FA-AUS-17; AP-30): je Standort und Monat der Anteil
 * nutzbarer Nächte (nutzbar ab 1 h Belichtungszeit akzeptierter Lights, Entscheidung Sven 26.09.2026) und
 * die mittleren nutzbaren Stunden; Treffsicherheit der Vorhersage (Bewertung ≥ *Gut* ↔ nutzbar); Nächte
 * mit Vorhersage, Seeing, SQM, Transparenz (Protokoll bzw. Vorhersage) und Verworfen-Quote. Nächte ohne
 * Session erfassen Admins als „bewölkt/nicht genutzt“ (`sessionlog.write`). Seitengerüst `PageHeader`
 * mit den Bereichsreitern der Auswertung.
 */
import { formatNightKey } from '@nina-pm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { sessionLogApi, type ClearNightNight, type ClearNightView } from '../../api/client';
import { useCan } from '../../auth';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { ProblemMessage } from '../../components/ProblemMessage';
import { problemCode } from '../admin/shared';
import { useEquipmentList } from '../equipment/shared';
import styles from './sessions.module.css';
import { EvaluationTabs, SESSIONS_PATH } from './SessionsPage';

export const CLEAR_NIGHTS_PATH = '/auswertung/klarnacht';

const PERIODS = [3, 12, 24] as const;
type Show = 'all' | 'recorded' | 'open';

const DAY_MS = 86_400_000;
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Zeitraum: die letzten `months` Monate bis gestern (UTC-Tag), damit die laufende Nacht nicht zählt. */
export function periodRange(months: number, now: Date): { from: string; to: string } {
  const to = now.getTime() - DAY_MS;
  const from = new Date(to);
  from.setUTCMonth(from.getUTCMonth() - months);
  return { from: dayKey(from.getTime() + DAY_MS), to: dayKey(to) };
}

export function ClearNightsPage() {
  const { t } = useTranslation();
  const sites = useEquipmentList('sites');
  const [siteChoice, setSiteChoice] = useState('');
  const siteId = siteChoice || sites.data?.[0]?.id || '';
  const [months, setMonths] = useState<(typeof PERIODS)[number]>(12);
  const [show, setShow] = useState<Show>('all');
  const [range] = useState(() => new Map(PERIODS.map((m) => [m, periodRange(m, new Date())])));
  const { from, to } = range.get(months) ?? periodRange(months, new Date());
  const stats = useQuery({
    queryKey: ['clear-nights', siteId, from, to],
    queryFn: () => sessionLogApi.clearNights(siteId, from, to),
    enabled: siteId !== '',
  });
  return (
    <div className={styles.page}>
      <PageHeader title={t('clearNights.title')} nav={<EvaluationTabs />} />
      <section className={styles.listCard} aria-label={t('clearNights.title')}>
        <div className={`${styles.toolbar} ${styles.listBar}`}>
          <div className={styles.field}>
            <label htmlFor="clear-nights-site">{t('clearNights.site')}</label>
            <select
              id="clear-nights-site"
              className={`${styles.input} ${styles.rigSelect}`}
              value={siteId}
              onChange={(e) => setSiteChoice(e.target.value)}
            >
              {(sites.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="clear-nights-period">{t('clearNights.period')}</label>
            <select
              id="clear-nights-period"
              className={styles.input}
              value={months}
              onChange={(e) => setMonths(Number(e.target.value) as (typeof PERIODS)[number])}
            >
              {PERIODS.map((m) => (
                <option key={m} value={m}>
                  {t('clearNights.months', { count: m })}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="clear-nights-show">{t('clearNights.show')}</label>
            <select
              id="clear-nights-show"
              className={styles.input}
              value={show}
              onChange={(e) => setShow(e.target.value as Show)}
            >
              <option value="all">{t('clearNights.showAll')}</option>
              <option value="recorded">{t('clearNights.showRecorded')}</option>
              <option value="open">{t('clearNights.showOpen')}</option>
            </select>
          </div>
        </div>
        {sites.data && sites.data.length === 0 ? (
          <p className={styles.listNote}>{t('clearNights.noSites')}</p>
        ) : stats.isError ? (
          <ProblemMessage code={problemCode(stats.error)} onRetry={() => void stats.refetch()} />
        ) : stats.data ? (
          <ClearNightsBody view={stats.data} show={show} />
        ) : (
          <p className={styles.listNote} role="status">
            {t('common.loading')}
          </p>
        )}
      </section>
    </div>
  );
}

function ClearNightsBody({ view, show }: { view: ClearNightView; show: Show }) {
  const { t, i18n } = useTranslation();
  const fmt = (v: number, digits = 1) =>
    v.toLocaleString(i18n.language, { maximumFractionDigits: digits });
  const recorded = view.months.reduce((n, m) => n + m.recorded, 0);
  const usable = view.months.reduce((n, m) => n + m.usable, 0);
  const monthLabel = (month: string) =>
    new Date(
      Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 15),
    ).toLocaleDateString(i18n.language, {
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    });
  const rows = view.nights.filter((n) =>
    show === 'recorded' ? n.source !== null : show === 'open' ? n.source === null : true,
  );
  return (
    <>
      <div className={styles.statGrid}>
        <div className={styles.stat}>
          <span className={styles.muted}>{t('clearNights.usableNights')}</span>
          <span className={styles.statValue}>
            {recorded === 0
              ? '–'
              : t('clearNights.usableOf', {
                  usable,
                  recorded,
                  pct: fmt((usable / recorded) * 100, 0),
                })}
          </span>
        </div>
        <div className={styles.stat}>
          <span className={styles.muted}>{t('clearNights.accuracy')}</span>
          <span className={styles.statValue}>
            {view.accuracy.hitPct === null ? '–' : `${fmt(view.accuracy.hitPct, 0)} %`}
          </span>
          <span className={styles.muted}>
            {t('clearNights.accuracyHint', {
              hits: view.accuracy.hits,
              compared: view.accuracy.compared,
            })}
          </span>
        </div>
      </div>
      {view.months.length > 0 ? (
        <div className={styles.monthBars} role="list" aria-label={t('clearNights.byMonth')}>
          {view.months.map((m) => (
            <div
              key={m.month}
              className={styles.monthBar}
              role="listitem"
              aria-label={t('clearNights.monthAria', {
                month: monthLabel(m.month),
                usable: m.usable,
                recorded: m.recorded,
                hours: m.meanUsableHours === null ? '–' : fmt(m.meanUsableHours),
              })}
            >
              <span>{m.usablePct === null ? '–' : `${fmt(m.usablePct, 0)} %`}</span>
              <span className={styles.monthTrack} aria-hidden="true">
                <span
                  className={styles.monthFill}
                  style={{ height: `${String(m.usablePct ?? 0)}%` }}
                />
              </span>
              <span>{monthLabel(m.month)}</span>
              <span className={styles.muted}>
                {m.meanUsableHours === null
                  ? '–'
                  : t('sessions.hours', { h: fmt(m.meanUsableHours) })}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.listNote}>{t('clearNights.noData')}</p>
      )}
      <NightsTable view={view} rows={rows} />
    </>
  );
}

function NightsTable({ view, rows }: { view: ClearNightView; rows: readonly ClearNightNight[] }) {
  const { t, i18n } = useTranslation();
  const canMark = useCan('sessionlog.write');
  const client = useQueryClient();
  const mark = useMutation({
    mutationFn: (a: { night: string; on: boolean }) =>
      sessionLogApi.markUnused(view.siteId, a.night, a.on),
    onSettled: () => client.invalidateQueries({ queryKey: ['clear-nights', view.siteId] }),
  });
  const num = (v: number | null, digits = 1, unit = '') =>
    v === null
      ? '–'
      : `${v.toLocaleString(i18n.language, { maximumFractionDigits: digits })}${unit}`;
  const columns: DataColumn<ClearNightNight>[] = [
    {
      id: 'night',
      header: t('clearNights.col.night'),
      sortValue: (n) => n.night,
      nowrap: true,
      cell: (n) =>
        n.sessionIds[0] ? (
          <Link to={`${SESSIONS_PATH}/${n.sessionIds[0]}`}>{formatNightKey(n.night)}</Link>
        ) : (
          formatNightKey(n.night)
        ),
    },
    {
      id: 'status',
      header: t('clearNights.col.status'),
      sortValue: (n) => (n.usable === null ? null : n.usable ? 1 : 0),
      cell: (n) =>
        n.usable === null ? (
          <span className={styles.muted}>{t('clearNights.status.none')}</span>
        ) : (
          <span className={styles.flags}>
            <span className={n.usable ? styles.pillOk : styles.pillWarn}>
              {n.usable ? t('clearNights.status.usable') : t('clearNights.status.unusable')}
            </span>
            {n.source === 'manual' ? (
              <span className={styles.pill}>{t('clearNights.status.manual')}</span>
            ) : null}
          </span>
        ),
    },
    {
      id: 'hours',
      header: t('clearNights.col.hours'),
      sortValue: (n) => n.usableHours,
      align: 'end',
      nowrap: true,
      cell: (n) =>
        n.usableHours === null ? '–' : t('sessions.hours', { h: num(n.usableHours, 2) }),
    },
    {
      id: 'forecast',
      header: t('clearNights.col.forecast'),
      sortValue: (n) => n.forecastRatingIndex,
      priority: 2,
      cell: (n) =>
        n.forecastRatingIndex === null ? '–' : t(`weather.rating.${String(n.forecastRatingIndex)}`),
    },
    {
      id: 'seeing',
      header: t('clearNights.col.seeing'),
      sortValue: (n) => n.seeingArcsec,
      priority: 3,
      align: 'end',
      cell: (n) => num(n.seeingArcsec, 1, '″'),
    },
    {
      id: 'sqm',
      header: t('clearNights.col.sqm'),
      sortValue: (n) => n.sqm,
      priority: 3,
      align: 'end',
      cell: (n) => num(n.sqm, 2),
    },
    {
      id: 'transparency',
      header: t('clearNights.col.transparency'),
      sortValue: (n) => n.transparencyPct ?? n.forecastTransparencyPct,
      priority: 3,
      align: 'end',
      nowrap: true,
      cell: (n) =>
        n.transparencyPct !== null
          ? num(n.transparencyPct, 0, ' %')
          : n.forecastTransparencyPct !== null
            ? t('clearNights.forecastValue', { value: num(n.forecastTransparencyPct, 0, ' %') })
            : '–',
    },
    {
      id: 'rejected',
      header: t('clearNights.col.rejected'),
      sortValue: (n) => n.rejectedPct,
      priority: 2,
      align: 'end',
      cell: (n) => num(n.rejectedPct, 1, ' %'),
    },
    ...(canMark
      ? [
          {
            id: 'action',
            header: t('clearNights.col.action'),
            headerHidden: true,
            nowrap: true,
            cell: (n: ClearNightNight) =>
              n.source === 'session' || n.sessionIds.length > 0 ? null : (
                <button
                  type="button"
                  className={styles.linkButton}
                  disabled={mark.isPending}
                  onClick={() => mark.mutate({ night: n.night, on: n.source !== 'manual' })}
                >
                  {n.source === 'manual' ? t('clearNights.unmark') : t('clearNights.mark')}
                </button>
              ),
          },
        ]
      : []),
  ];
  return (
    <>
      {mark.error ? <ProblemMessage code={problemCode(mark.error)} /> : null}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(n) => n.night}
        rowLabel={(n) => formatNightKey(n.night)}
        label={t('clearNights.nights')}
        empty={t('clearNights.noNights')}
      />
    </>
  );
}
