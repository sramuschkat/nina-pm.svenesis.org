/**
 * Auswertung – Reiter „Standort-Statistik“ (AP-64; ersetzt S-64 Klarnacht-Statistik; FA-AUS-16, FA-AUS-17): „Wie oft ist
 * es nutzbar, stimmt die Vorhersage?“ Standort des gewählten Rigs (Auswahl „Standort“, vorbelegt). Kalender der letzten
 * drei Monate im Zeitraum, ein Kästchen je Nacht – klar und belichtet, teilweise, bewölkt, keine Angabe (gestrichelt) –
 * mit Tooltip (Stunden, Vorhersage, Seeing, SQM); ein Klick öffnet die Nacht bzw. ohne Session „bewölkt erfassen“
 * (`sessionlog.write`). Kacheln „Nutzbare Nächte“ und „Vorhersage stimmte“, SQM- und Seeing-Verlauf als Balken; die
 * bisherige Tabelle unter „Alle Nächte als Tabelle“. Nutzbar = ab 1 h Belichtung akzeptierter Lights (26.09.2026).
 */
import { daysFromKey, keyFromDays } from '@nina-pm/engine';
import { formatNightKey } from '@nina-pm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { sessionLogApi, type ClearNightNight, type ClearNightView } from '../../api/client';
import { useCan } from '../../auth';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { ProblemMessage } from '../../components/ProblemMessage';
import { problemCode } from '../admin/shared';
import { useEquipmentList } from '../equipment/shared';
import { EvaluationHeader, useEvaluationFilter, useEvaluationSite } from './EvaluationHeader';
import { sessionPath } from './evaluation';
import styles from './evaluation.module.css';

export type DayKind = 'clear' | 'clearUnused' | 'partial' | 'cloudy' | 'none';

/** Wetterklasse „gut“ oder besser (FA-WET-03) gilt als klar. */
const CLEAR_RATING = 3;

/**
 * Klasse eines Kalendertags (Entscheidung Sven 07.10.2026): *klar, belichtet* = nutzbar (≥ 1 h belichtete Lights);
 * *klar, aber nicht genutzt* = Vorhersage gut oder besser, aber unter 1 h belichtet; *teilweise* = Session ohne
 * nutzbare Belichtung; *bewölkt* = als bewölkt/nicht genutzt erfasst oder – ohne Session – Vorhersage unter „gut“
 * (nur Anzeige, keine erfasste Nacht; Entscheidung Sven 07.10.2026); sonst *keine Angabe*. Die Vorhersage kommt aus
 * dem Schnappschuss zum Sessionbeginn, sonst aus der gespeicherten Vorhersage je Standort und Nacht (AP-64b) – so wird
 * auch eine vergangene Nacht **ohne Session** „klar, aber nicht genutzt“, wenn die Vorhersage gut oder besser war.
 */
export function dayKind(n: ClearNightNight | undefined): DayKind {
  if (!n) return 'none';
  if (n.source === 'manual') return 'cloudy';
  if (n.usable === true) return 'clear';
  if (n.forecastRatingIndex !== null && n.forecastRatingIndex >= CLEAR_RATING) return 'clearUnused';
  if (n.source === 'session' || n.sessionIds.length > 0) return 'partial';
  // Ohne Session und ohne Erfassung, Vorhersage unter „gut“: bewölkt laut Vorhersage (Entscheidung Sven 07.10.2026).
  if (n.forecastRatingIndex !== null) return 'cloudy';
  return 'none';
}

/** Monate (`YYYY-MM`) des Kalenders: die letzten drei Monate bis `to`, nicht vor `from`. */
export function calendarMonths(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(to.slice(0, 4));
  let m = Number(to.slice(5, 7));
  const first = from.slice(0, 7);
  for (let i = 0; i < 3; i++) {
    const key = `${String(y)}-${String(m).padStart(2, '0')}`;
    if (key < first) break;
    out.unshift(key);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

export function SiteStatsPage() {
  const { t } = useTranslation();
  const { range, ready } = useEvaluationFilter();
  const sites = useEquipmentList('sites');
  const siteId = useEvaluationSite();
  const stats = useQuery({
    queryKey: ['clear-nights', siteId, range.from, range.to],
    queryFn: () => sessionLogApi.clearNights(siteId, range.from, range.to),
    enabled: ready && siteId !== '',
  });
  return (
    <div className={styles.page}>
      <EvaluationHeader mode="site" />
      {sites.data && sites.data.length === 0 ? (
        <p className={styles.empty}>{t('clearNights.noSites')}</p>
      ) : stats.isError ? (
        <ProblemMessage code={problemCode(stats.error)} onRetry={() => void stats.refetch()} />
      ) : stats.data ? (
        <SiteStatsBody view={stats.data} />
      ) : (
        <p className={styles.muted} role="status">
          {t('common.loading')}
        </p>
      )}
    </div>
  );
}

function SiteStatsBody({ view }: { view: ClearNightView }) {
  const { t, i18n } = useTranslation();
  const fmt = (v: number, digits = 1) =>
    v.toLocaleString(i18n.language, { maximumFractionDigits: digits });
  const recorded = view.months.reduce((n, m) => n + m.recorded, 0);
  const usable = view.months.reduce((n, m) => n + m.usable, 0);
  const clearUnused = view.nights.filter((n) => dayKind(n) === 'clearUnused').length;
  const [table, setTable] = useState(false);
  const tableId = useId();
  return (
    <>
      <div className={styles.siteGrid}>
        <Calendar view={view} />
        <div className={styles.siteSide}>
          <section className={styles.tilesTwo} aria-label={t('evaluation.site.kpis')}>
            <div className={styles.tile}>
              <span className={styles.tileLabel}>{t('clearNights.usableNights')}</span>
              <span className={styles.tileValue}>
                {recorded === 0 ? '–' : `${fmt((usable / recorded) * 100, 0)} %`}
              </span>
              <span className={styles.tileSub}>
                {t('evaluation.site.usableHint', { usable, recorded })}
                {clearUnused > 0 ? (
                  <>
                    <br />
                    {t('evaluation.site.clearUnused', { count: clearUnused })}
                  </>
                ) : null}
              </span>
            </div>
            <div className={styles.tile}>
              <span className={styles.tileLabel}>{t('evaluation.site.forecastRight')}</span>
              <span className={styles.tileValue}>
                {view.accuracy.hitPct === null ? '–' : `${fmt(view.accuracy.hitPct, 0)} %`}
              </span>
              <span className={styles.tileSub}>
                {t('clearNights.accuracyHint', {
                  hits: view.accuracy.hits,
                  compared: view.accuracy.compared,
                })}
                {view.imagesAccuracy && view.imagesAccuracy.compared > 0 ? (
                  <>
                    <br />
                    {t('clearNights.imagesAccuracy', {
                      pct:
                        view.imagesAccuracy.hitPct === null
                          ? '–'
                          : `${fmt(view.imagesAccuracy.hitPct, 0)} %`,
                      hits: view.imagesAccuracy.hits,
                      compared: view.imagesAccuracy.compared,
                    })}
                  </>
                ) : null}
              </span>
            </div>
          </section>
          <section className={styles.subCard} aria-label={t('evaluation.site.conditions')}>
            <Bars view={view} field="sqm" />
            <Bars view={view} field="seeingArcsec" />
            <button
              type="button"
              className={styles.linkButton}
              aria-expanded={table}
              aria-controls={tableId}
              onClick={() => setTable(!table)}
            >
              {table ? t('evaluation.site.hideTable') : t('evaluation.site.showTable')}
            </button>
          </section>
        </div>
      </div>
      <div id={tableId} hidden={!table}>
        {table ? <NightsTable view={view} /> : null}
      </div>
    </>
  );
}

function Calendar({ view }: { view: ClearNightView }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const canMark = useCan('sessionlog.write');
  const client = useQueryClient();
  const [picked, setPicked] = useState<string | null>(null);
  const mark = useMutation({
    mutationFn: (a: { night: string; on: boolean }) =>
      sessionLogApi.markUnused(view.siteId, a.night, a.on),
    onSuccess: () => setPicked(null),
    onSettled: () => client.invalidateQueries({ queryKey: ['clear-nights', view.siteId] }),
  });
  const byNight = new Map(view.nights.map((n) => [n.night, n]));
  const headingId = useId();
  const lang = i18n.language === 'en' ? 'en-GB' : 'de-DE';
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' })
      .format(Date.UTC(2026, 9, 5 + i))
      .replace(/\.$/, ''),
  );
  const n = (v: number | null, d = 1, unit = '') =>
    v === null ? '–' : `${v.toLocaleString(i18n.language, { maximumFractionDigits: d })}${unit}`;
  const tip = (night: string, x: ClearNightNight | undefined) =>
    [
      formatNightKey(night),
      dayKind(x) === 'cloudy' && x?.source !== 'manual'
        ? t('evaluation.site.cloudyForecast')
        : t(`evaluation.site.kind.${dayKind(x)}`),
      x?.usableHours !== null && x?.usableHours !== undefined
        ? t('evaluation.site.hours', { h: n(x.usableHours) })
        : null,
      x?.forecastRatingIndex !== null && x?.forecastRatingIndex !== undefined
        ? t('evaluation.site.forecast', {
            rating: t(`weather.rating.${String(x.forecastRatingIndex)}`),
          })
        : null,
      x?.seeingArcsec !== null && x?.seeingArcsec !== undefined
        ? t('evaluation.site.seeing', { v: n(x.seeingArcsec, 1, '″') })
        : null,
      x?.sqm !== null && x?.sqm !== undefined ? t('evaluation.site.sqm', { v: n(x.sqm, 2) }) : null,
    ]
      .filter((s): s is string => s !== null)
      .join(' · ');
  const pickedNight = picked ? byNight.get(picked) : undefined;
  return (
    <section className={styles.subCard} aria-labelledby={headingId}>
      <div className={styles.cardHead}>
        <h2 id={headingId} className={styles.sectionTitle}>
          {t('evaluation.site.calendar')}
        </h2>
        <ul className={styles.legend} aria-label={t('evaluation.site.legend')}>
          {(['clear', 'clearUnused', 'partial', 'cloudy', 'none'] as const).map((k) => (
            <li key={k}>
              <span className={styles.legendBox} data-kind={k} aria-hidden="true" />
              {k === 'cloudy' ? t('evaluation.site.legendCloudy') : t(`evaluation.site.kind.${k}`)}
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.months}>
        {calendarMonths(view.from, view.to).map((month) => {
          const y = Number(month.slice(0, 4));
          const m = Number(month.slice(5, 7));
          const firstDay = daysFromKey(`${month}-01`);
          const days =
            daysFromKey(
              m === 12
                ? `${String(y + 1)}-01-01`
                : `${String(y)}-${String(m + 1).padStart(2, '0')}-01`,
            ) - firstDay;
          // Montag zuerst: 1970-01-01 war ein Donnerstag.
          const offset = (((firstDay + 3) % 7) + 7) % 7;
          const name = new Intl.DateTimeFormat(lang, {
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC',
          }).format(Date.UTC(y, m - 1, 15));
          return (
            <div key={month} className={styles.month}>
              <h3 className={styles.monthName}>{name}</h3>
              <table className={styles.monthGrid}>
                <caption className={styles.srOnly}>{name}</caption>
                <thead>
                  <tr>
                    {weekdays.map((w) => (
                      <th key={w} scope="col" className={styles.weekday}>
                        {w}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: Math.ceil((offset + days) / 7) }, (_, week) => (
                    <tr key={week}>
                      {Array.from({ length: 7 }, (_, dow) => {
                        const i = week * 7 + dow - offset;
                        if (i < 0 || i >= days) return <td key={dow} />;
                        const night = keyFromDays(firstDay + i);
                        const x = byNight.get(night);
                        const inside = night >= view.from && night <= view.to;
                        const kind = inside ? dayKind(x) : 'none';
                        const label = tip(night, x);
                        const session = x?.sessionIds[0];
                        const clickable = inside && (session !== undefined || canMark);
                        return (
                          <td key={dow}>
                            {clickable ? (
                              <button
                                type="button"
                                className={styles.day}
                                data-kind={kind}
                                data-picked={picked === night || undefined}
                                title={label}
                                aria-label={label}
                                onClick={() =>
                                  session ? navigate(sessionPath(session, true)) : setPicked(night)
                                }
                              >
                                {i + 1}
                              </button>
                            ) : (
                              <span
                                className={styles.day}
                                data-kind={kind}
                                data-outside={!inside || undefined}
                                title={inside ? label : undefined}
                              >
                                {i + 1}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
      {picked ? (
        <div className={styles.markPanel} role="group" aria-label={formatNightKey(picked)}>
          <span>
            {pickedNight?.source === 'manual'
              ? t('evaluation.site.markedCloudy', { night: formatNightKey(picked) })
              : t('evaluation.site.markQuestion', { night: formatNightKey(picked) })}
          </span>
          <button
            type="button"
            className={styles.buttonPrimary}
            disabled={mark.isPending}
            onClick={() => mark.mutate({ night: picked, on: pickedNight?.source !== 'manual' })}
          >
            {pickedNight?.source === 'manual' ? t('clearNights.unmark') : t('evaluation.site.mark')}
          </button>
          <button type="button" className={styles.button} onClick={() => setPicked(null)}>
            {t('sessions.correction.cancel')}
          </button>
        </div>
      ) : null}
      {mark.error ? <ProblemMessage code={problemCode(mark.error)} /> : null}
    </section>
  );
}

/** SQM- bzw. Seeing-Verlauf als Balken je Nacht mit Wert (FA-AUS-16). */
function Bars({ view, field }: { view: ClearNightView; field: 'sqm' | 'seeingArcsec' }) {
  const { t, i18n } = useTranslation();
  const values = view.nights.flatMap((n) =>
    n[field] === null ? [] : [{ night: n.night, v: n[field] as number }],
  );
  const fmt = (v: number, d: number) =>
    v.toLocaleString(i18n.language, { maximumFractionDigits: d });
  const digits = field === 'sqm' ? 2 : 1;
  const unit = field === 'sqm' ? ' mag/″²' : '″';
  const label = t(`evaluation.site.${field === 'sqm' ? 'sqmTitle' : 'seeingTitle'}`);
  if (values.length === 0)
    return (
      <div className={styles.bars}>
        <div className={styles.barsHead}>
          <strong>{label}</strong>
          <span className={styles.muted}>{t('evaluation.site.noValues')}</span>
        </div>
      </div>
    );
  const max = Math.max(...values.map((x) => x.v));
  const min = Math.min(...values.map((x) => x.v));
  const lo = Math.max(0, min - (max - min) * 0.5 - (field === 'sqm' ? 0.5 : 0.2));
  const mean = values.reduce((s, x) => s + x.v, 0) / values.length;
  return (
    <div className={styles.bars}>
      <div className={styles.barsHead}>
        <strong>{label}</strong>
        <span className={styles.muted}>
          {t('evaluation.site.mean', { v: `${fmt(mean, digits)}${unit}` })}
        </span>
      </div>
      <div
        className={styles.barRow}
        data-kind={field}
        role="img"
        aria-label={t('evaluation.site.barsSummary', {
          what: label,
          count: values.length,
          min: `${fmt(min, digits)}${unit}`,
          max: `${fmt(max, digits)}${unit}`,
        })}
      >
        {values.map((x) => (
          <span
            key={x.night}
            className={styles.bar}
            title={`${formatNightKey(x.night)} · ${fmt(x.v, digits)}${unit}`}
            style={{ height: `${String(Math.max(6, ((x.v - lo) / (max - lo || 1)) * 100))}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function NightsTable({ view }: { view: ClearNightView }) {
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
          <Link to={sessionPath(n.sessionIds[0], true)}>{formatNightKey(n.night)}</Link>
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
          <span className={styles.badges}>
            <span className={n.usable ? styles.badgeOk : styles.badgeWarn}>
              {n.usable ? t('clearNights.status.usable') : t('clearNights.status.unusable')}
            </span>
            {n.source === 'manual' ? (
              <span className={styles.badge}>{t('clearNights.status.manual')}</span>
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
    {
      id: 'images',
      header: t('clearNights.col.images'),
      sortValue: (n) => n.imagesClearPct ?? null,
      priority: 2,
      nowrap: true,
      cell: (n) =>
        n.imagesClarity
          ? t('clearNights.imagesValue', {
              verdict: t(`clearNights.images.${n.imagesClarity}`),
              pct: n.imagesClearPct ?? 0,
            })
          : '–',
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
    <section className={styles.subCard} aria-label={t('clearNights.nights')}>
      {mark.error ? <ProblemMessage code={problemCode(mark.error)} /> : null}
      <DataTable
        columns={columns}
        rows={view.nights}
        rowKey={(n) => n.night}
        rowLabel={(n) => formatNightKey(n.night)}
        label={t('clearNights.nights')}
        empty={t('clearNights.noNights')}
      />
    </section>
  );
}
