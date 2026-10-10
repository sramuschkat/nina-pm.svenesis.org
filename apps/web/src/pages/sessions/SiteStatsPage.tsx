/**
 * Auswertung – Reiter „Standort-Statistik“ (AP-64, AP-77; S-64; FA-AUS-16, FA-AUS-17): „Wie oft ist es nutzbar, stimmt
 * die Vorhersage?“ Standort des gewählten Rigs (Auswahl „Standort“, vorbelegt). Kalender der letzten drei Monate im
 * Zeitraum, ein Kästchen je Nacht – klar und belichtet, klar ungenutzt, teilweise, bewölkt, keine Angabe (gestrichelt) –
 * mit Tooltip; ein Klick öffnet die Nacht. Kacheln „Nutzbare Nächte“ und „Vorhersage stimmte“. Darunter **immer** die
 * Tabelle aller Nächte (Status, Belichtet, Vorhersage, laut Bildern, Qualität, Wolken Ø, SQM Ø, Mond, Seeing). Seit AP-77
 * ohne SQM-/Seeing-Balken, Transparenz, Verworfen und „bewölkt erfassen“; Nächte ohne Session stuft die gemessene
 * Bewölkung des Wettergeräts ein, sonst die Vorhersage. Nutzbar = ab 1 h Belichtung akzeptierter Lights (26.09.2026).
 */
import { daysFromKey, keyFromDays } from '@nina-pm/engine';
import { formatNightKey, shareLabelPct } from '@nina-pm/shared';
import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { sessionLogApi, type ClearNightNight, type ClearNightView } from '../../api/client';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { QualityBar } from '../../components/quality';
import { ProblemMessage } from '../../components/ProblemMessage';
import { problemCode } from '../admin/shared';
import { useEquipmentList } from '../equipment/shared';
import { EvaluationHeader, useEvaluationFilter, useEvaluationSite } from './EvaluationHeader';
import { sessionPath } from './evaluation';
import styles from './evaluation.module.css';

export type DayKind = 'clear' | 'clearUnused' | 'partial' | 'cloudy' | 'none';

/** Wetterklasse „gut“ oder besser (FA-WET-03) gilt als klar. */
const CLEAR_RATING = 3;

/** Gemessene Bewölkung (Wettergerät, Mittel über die Dunkelheit) unter … % = klar, ab … % = bewölkt (wie FA-AUS-24). */
export const MEASURED_CLEAR_PCT = 25;
export const MEASURED_CLOUDY_PCT = 60;

/**
 * Klasse eines Kalendertags (Entscheidung Sven 07.10.2026): *klar, belichtet* = nutzbar (≥ 1 h belichtete Lights);
 * *klar, aber nicht genutzt* = Vorhersage gut oder besser, aber unter 1 h belichtet; *teilweise* = Session ohne
 * nutzbare Belichtung; *bewölkt* = als bewölkt/nicht genutzt erfasst oder – ohne Session – Vorhersage unter „gut“
 * (nur Anzeige, keine erfasste Nacht; Entscheidung Sven 07.10.2026); sonst *keine Angabe*. Die Vorhersage kommt aus
 * dem Schnappschuss zum Sessionbeginn, sonst aus der gespeicherten Vorhersage je Standort und Nacht (AP-64b) – so wird
 * auch eine vergangene Nacht **ohne Session** „klar, aber nicht genutzt“, wenn die Vorhersage gut oder besser war.
 * Seit AP-77 hat bei Nächten ohne Session die **gemessene** Bewölkung des Wettergeräts Vorrang vor der Vorhersage: unter
 * 25 % klar, ungenutzt; ab 60 % bewölkt; dazwischen teilweise.
 */
export function dayKind(n: ClearNightNight | undefined): DayKind {
  if (!n) return 'none';
  if (n.source === 'manual') return 'cloudy';
  if (n.usable === true) return 'clear';
  const noSession = n.source !== 'session' && n.sessionIds.length === 0;
  if (noSession && n.cloudSource === 'device' && n.cloudPct != null) {
    if (n.cloudPct < MEASURED_CLEAR_PCT) return 'clearUnused';
    if (n.cloudPct >= MEASURED_CLOUDY_PCT) return 'cloudy';
    return 'partial';
  }
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
        </div>
      </div>
      <NightsTable view={view} />
    </>
  );
}

function Calendar({ view }: { view: ClearNightView }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
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
      x?.qualityPct != null
        ? t('evaluation.site.quality', { pct: shareLabelPct(x.qualityPct) })
        : null,
      x?.cloudPct != null ? t('evaluation.site.clouds', { v: n(x.cloudPct, 0) }) : null,
      x?.sqmMeasured != null ? t('evaluation.site.sqm', { v: n(x.sqmMeasured, 2) }) : null,
    ]
      .filter((s): s is string => s !== null)
      .join(' · ');
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
                        const clickable = inside && session !== undefined;
                        return (
                          <td key={dow}>
                            {clickable ? (
                              <button
                                type="button"
                                className={styles.day}
                                data-kind={kind}
                                title={label}
                                aria-label={label}
                                onClick={() => navigate(sessionPath(session, true))}
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
    </section>
  );
}

/**
 * Tabelle aller Nächte (S-64, seit AP-77 immer sichtbar): Nacht (Link), Status, Belichtet, Vorhersage, laut Bildern,
 * Qualität (Anteil guter Lights), Wolken Ø und SQM Ø (Lights bzw. Wettergerät), Mond, Seeing (Vorhersage).
 */
function NightsTable({ view }: { view: ClearNightView }) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const num = (v: number | null | undefined, digits = 1, unit = '') =>
    v === null || v === undefined
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
      sortValue: (n) => dayKind(n),
      nowrap: true,
      cell: (n) => (
        <span className={styles.statusCell}>
          <span className={styles.legendBox} data-kind={dayKind(n)} aria-hidden="true" />
          {t(`evaluation.site.kind.${dayKind(n)}`)}
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
        n.usableHours === null ? '–' : t('sessions.hours', { h: num(n.usableHours, 1) }),
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
    {
      id: 'quality',
      header: t('clearNights.col.quality'),
      sortValue: (n) => n.qualityPct ?? null,
      cell: (n) =>
        n.qualityPct == null ? (
          '–'
        ) : (
          <span className={styles.qualityCell}>
            <QualityBar
              counts={{
                good: Math.round(n.qualityPct * 10),
                flagged: Math.round((100 - n.qualityPct) * 10),
                rejected: 0,
                none: 0,
                sharePct: n.qualityPct,
                reasons: { hfr: 0, stars: 0, rms: 0, cloud: 0 },
              }}
            />
            <span>{t('sessionQuality.good', { pct: shareLabelPct(n.qualityPct) })}</span>
          </span>
        ),
    },
    {
      id: 'clouds',
      header: t('clearNights.col.clouds'),
      sortValue: (n) => n.cloudPct ?? null,
      priority: 2,
      align: 'end',
      nowrap: true,
      cell: (n) => num(n.cloudPct, 0, ' %'),
    },
    {
      id: 'sqm',
      header: t('clearNights.col.sqm'),
      sortValue: (n) => n.sqmMeasured ?? null,
      priority: 3,
      align: 'end',
      cell: (n) => num(n.sqmMeasured, 2),
    },
    {
      id: 'moon',
      header: t('clearNights.col.moon'),
      sortValue: (n) => n.moonIllumPct ?? null,
      priority: 3,
      align: 'end',
      cell: (n) => num(n.moonIllumPct, 0, ' %'),
    },
    {
      id: 'seeing',
      header: t('clearNights.col.seeing'),
      sortValue: (n) => n.forecastSeeingScore ?? null,
      priority: 3,
      align: 'end',
      cell: (n) =>
        n.forecastSeeingScore == null ? '–' : num(n.forecastSeeingScore * 100, 0, ' %'),
    },
  ];
  return (
    <section className={styles.subCard} aria-labelledby={headingId}>
      <div className={styles.cardHead}>
        <h2 id={headingId} className={styles.sectionTitle}>
          {t('clearNights.nights')}
        </h2>
        <span className={styles.muted}>{t('evaluation.site.tableHint')}</span>
      </div>
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
