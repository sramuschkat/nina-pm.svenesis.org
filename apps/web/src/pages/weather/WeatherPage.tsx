/**
 * S-50 Wettervorhersage (FK 14.3; FA-WET-01…09, AP-23): Kopf mit Standort-/Rig-Auswahl, Koordinaten,
 * Zeitzone, Standortzeit und eigener Ortszeit; 7-Tage-Astro-Wetter (`WeatherChart`) mit Nachtdetail;
 * Nachttabelle mit Bewertung, Abdeckung, dunklen und mondlosen Stunden, bestem Fenster und Mond; die
 * meteoblue-Karte nur als externer Link (Datenschutz, FA-WET-08). Auswahl in der URL (`?standort=`).
 */
import { formatNightKey, formatTzAbbr, formatZonedTime } from '@nina-pm/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { equipmentApi, type WeatherView } from '../../api/client';
import { ICON_SIZE, actionIcons } from '../../components/icons';
import { ProblemMessage } from '../../components/ProblemMessage';
import { SiteTime } from '../../components/SiteTime';
import { WeatherChart } from '../../components/WeatherChart';
import { problemCode } from '../admin/shared';
import { useEquipmentList, useNumber } from '../equipment/shared';
import { meteoblueHref } from './model';
import styles from './weather.module.css';

export const weatherKey = (siteId: string) => ['weather', siteId] as const;

/** Wetter eines Standorts; der Server holt stündlich – im Browser alle 10 min nachsehen. */
export function useSiteWeather(siteId: string | null) {
  return useQuery({
    queryKey: weatherKey(siteId ?? ''),
    queryFn: () => equipmentApi.weather(siteId ?? ''),
    enabled: siteId !== null,
    refetchInterval: 10 * 60_000,
  });
}

/** Aktuelle Zeit, jede Minute neu (Jetzt-Linie, Uhrzeiten im Kopf). */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Eigenschaften für `WeatherChart` aus der API-Sicht. */
export function chartProps(view: WeatherView, now: Date) {
  return {
    hours: view.hours,
    nights: view.nights,
    nightWindows: view.nightWindows,
    darkWindows: view.darkWindows,
    sunAltDeg: view.hours.map((h) => h.sunAltDeg),
    nowUtc: now.toISOString(),
    days: view.days,
    timeZone: view.timeZone,
    cmp3: view.cmp3,
    region: view.region,
    fetchedAtUtc: view.fetchedAtUtc,
  };
}

export function WeatherPage() {
  const { t, i18n } = useTranslation();
  const num = useNumber();
  const [params, setParams] = useSearchParams();
  const sites = useEquipmentList('sites');
  const rigs = useEquipmentList('rigs');
  const siteList = sites.data ?? [];
  const siteId = params.get('standort') ?? siteList[0]?.id ?? null;
  const site = siteList.find((s) => s.id === siteId) ?? null;
  const weather = useSiteWeather(site ? site.id : null);
  const now = useNow();
  const [unit, setUnit] = useState<'c' | 'f'>('c');
  const [night, setNight] = useState<string | null>(null);
  useEffect(() => setNight(null), [siteId]);

  const select = (value: string) => {
    const [kind, id] = value.split(':');
    const target = kind === 'rig' ? (rigs.data ?? []).find((r) => r.id === id)?.siteId : id;
    if (target) setParams({ standort: target }, { replace: true });
  };
  const ownZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const hours = (sec: number) => t('weatherPage.hours', { h: num(sec / 3600, 1) });
  const clock = (iso: string, zone: string) =>
    `${formatZonedTime(iso, zone)} ${formatTzAbbr(iso, zone)}`;
  const view = weather.data;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1>{t('weatherPage.title')}</h1>
      </div>
      <p className={styles.muted}>{t('weatherPage.intro')}</p>
      {sites.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : sites.isError ? (
        <ProblemMessage code={problemCode(sites.error)} onRetry={() => void sites.refetch()} />
      ) : siteList.length === 0 ? (
        <p className={styles.muted}>{t('weatherPage.noSites')}</p>
      ) : (
        <>
          <div className={styles.toolbar}>
            <div className={styles.field}>
              <label htmlFor="weather-site">{t('weatherPage.site')}</label>
              <select
                id="weather-site"
                className={styles.input}
                value={site ? `site:${site.id}` : ''}
                onChange={(e) => select(e.target.value)}
              >
                <optgroup label={t('weatherPage.sites')}>
                  {siteList.map((s) => (
                    <option key={s.id} value={`site:${s.id}`}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
                {(rigs.data ?? []).length > 0 ? (
                  <optgroup label={t('weatherPage.rigs')}>
                    {(rigs.data ?? []).map((r) => (
                      <option key={r.id} value={`rig:${r.id}`}>
                        {t('weatherPage.rigAt', {
                          rig: r.name,
                          site: siteList.find((s) => s.id === r.siteId)?.name ?? '',
                        })}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </div>
            <div className={styles.field}>
              <span id="weather-unit">{t('weatherPage.unit')}</span>
              <div className={styles.unit} role="radiogroup" aria-labelledby="weather-unit">
                {(['c', 'f'] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    role="radio"
                    aria-checked={unit === u}
                    onClick={() => setUnit(u)}
                  >
                    {t(u === 'c' ? 'weatherPage.celsius' : 'weatherPage.fahrenheit')}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {site ? (
            <dl className={styles.facts}>
              <div>
                <dt>{t('weatherPage.coordinates')}</dt>
                <dd>
                  {num(site.latitudeDeg, 4)}°, {num(site.longitudeDeg, 4)}°
                </dd>
              </div>
              <div>
                <dt>{t('weatherPage.zone')}</dt>
                <dd>{site.timeZone}</dd>
              </div>
              <div>
                <dt>{t('weatherPage.siteTime')}</dt>
                <dd>
                  <SiteTime atUtc={now.toISOString()} siteTimeZone={site.timeZone} withDate />
                </dd>
              </div>
              <div>
                <dt>{t('weatherPage.ownTime')}</dt>
                <dd>{clock(now.toISOString(), ownZone)}</dd>
              </div>
            </dl>
          ) : null}
          <section className={styles.panel} aria-labelledby="weather-chart">
            <h2 id="weather-chart" className="visually-hidden">
              {t('weatherPage.title')}
            </h2>
            {weather.isError && !view ? (
              <ProblemMessage
                code={problemCode(weather.error)}
                onRetry={() => void weather.refetch()}
              />
            ) : view?.status === 'pending' ? (
              <p className={styles.muted} role="status">
                {t('weatherPage.pending')}
              </p>
            ) : (
              <>
                {view?.fetchedAtUtc ? (
                  <p className={styles.muted}>
                    {t('weatherPage.status', {
                      at: clock(view.fetchedAtUtc, view.timeZone),
                      models: view.modelSet ?? '–',
                    })}
                  </p>
                ) : null}
                {view ? (
                  <WeatherChart
                    {...chartProps(view, now)}
                    unit={unit}
                    selectedNight={night}
                    onSelectNight={setNight}
                    state={weather.isError ? 'error' : 'ready'}
                    onRetry={() => void weather.refetch()}
                  />
                ) : (
                  <WeatherChart
                    hours={[]}
                    nights={[]}
                    nightWindows={[]}
                    darkWindows={[]}
                    sunAltDeg={[]}
                    nowUtc={now.toISOString()}
                    days={7}
                    timeZone={site?.timeZone ?? 'UTC'}
                    state="loading"
                  />
                )}
              </>
            )}
          </section>
          {view && view.status === 'ready' ? (
            <section className={styles.panel} aria-labelledby="weather-nights">
              <h2 id="weather-nights">{t('weatherPage.nights')}</h2>
              <div
                className={styles.tableWrap}
                tabIndex={0}
                role="region"
                aria-labelledby="weather-nights"
              >
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">{t('weatherPage.col.night')}</th>
                      <th scope="col">{t('weatherPage.col.rating')}</th>
                      <th scope="col" className={styles.num}>
                        {t('weatherPage.col.coverage')}
                      </th>
                      <th scope="col" className={styles.num}>
                        {t('weatherPage.col.dark')}
                      </th>
                      <th scope="col" className={styles.num}>
                        {t('weatherPage.col.moonless')}
                      </th>
                      <th scope="col">{t('weatherPage.col.bestWindow')}</th>
                      <th scope="col">{t('weatherPage.col.moon')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.nights.map((n) => {
                      const flags = [
                        n.aerosolMissing ? t('weather.flag.aerosolMissing') : null,
                        n.seeingIncomplete ? t('weather.flag.seeingIncomplete') : null,
                        n.coverage !== null && n.coverage < 1
                          ? t('weather.flag.incomplete', { pct: num(n.coverage * 100, 0) })
                          : null,
                      ].filter(Boolean);
                      const w = n.bestWindow;
                      return (
                        <tr
                          key={n.night}
                          className={n.night === night ? styles.selected : undefined}
                        >
                          <th scope="row">
                            <button
                              type="button"
                              className={styles.linkButton}
                              onClick={() => setNight(n.night)}
                              aria-label={t('weatherPage.show', { night: formatNightKey(n.night) })}
                            >
                              {formatNightKey(n.night)}
                            </button>
                          </th>
                          <td>
                            <span className={styles.nowrap}>
                              {n.darkFromUtc === null
                                ? t('weather.chart.noDark')
                                : n.nightMean === null
                                  ? t('weather.rating.none')
                                  : `${t(`weather.rating.${String(n.ratingIndex)}`)} ${num(n.nightMean * 100, 0)} %`}
                            </span>
                            {flags.length > 0 ? (
                              <>
                                <br />
                                <span className={styles.flagText}>{flags.join(' · ')}</span>
                              </>
                            ) : null}
                          </td>
                          <td className={styles.num}>
                            {n.coverage === null ? '–' : `${num(n.coverage * 100, 0)} %`}
                          </td>
                          <td className={styles.num}>{hours(n.darknessSec)}</td>
                          <td className={styles.num}>{hours(n.moonlessSec)}</td>
                          <td>
                            {w ? (
                              <>
                                <span className={styles.nowrap}>
                                  {t('weatherPage.windowTimes', {
                                    from: formatZonedTime(w.fromUtc, view.timeZone),
                                    to: formatZonedTime(w.toUtc, view.timeZone),
                                    zone: formatTzAbbr(w.toUtc, view.timeZone),
                                  })}
                                </span>
                                <br />
                                {t('weatherPage.windowHours', {
                                  h: num(w.sec / 3600, 1),
                                  free: num(w.moonFreeSec / 3600, 1),
                                })}
                                {w.fair ? ` · ${t('weather.verdict.fairShort')}` : ''}
                              </>
                            ) : (
                              '–'
                            )}
                          </td>
                          <td>
                            <span className={styles.nowrap}>
                              {t('weatherPage.moonText', { pct: num(n.moonIllumPct, 0) })}
                            </span>
                            {n.moonEvents.length > 0 ? (
                              <>
                                <br />
                                <span className={styles.nowrap}>
                                  {n.moonEvents
                                    .map((e) =>
                                      t(
                                        e.type === 'rise'
                                          ? 'weatherPage.moonRise'
                                          : 'weatherPage.moonSet',
                                        { at: formatZonedTime(e.atUtc, view.timeZone) },
                                      ),
                                    )
                                    .join(' · ')}{' '}
                                  {formatTzAbbr(
                                    n.moonEvents[0]?.atUtc ?? now.toISOString(),
                                    view.timeZone,
                                  )}
                                </span>
                              </>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
          {site ? (
            <div>
              <a
                className={`${styles.button} ${styles.external}`}
                href={meteoblueHref(site.latitudeDeg, site.longitudeDeg, i18n.language)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <actionIcons.external size={ICON_SIZE.table} aria-hidden />
                {t('weatherPage.meteoblue')}
              </a>
              <p className={styles.muted}>{t('weatherPage.meteoblueHint')}</p>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
