/**
 * Astro-Wetter eines Standorts (FA-WET-05, AP-23): im Reiter *Wetter* des Projekt-Editors als volle
 * Grafik, in der Standort-Übersicht und in der Übersicht S-02 als kompaktes Farbband; der Link führt zur
 * Wettervorhersage S-50 (in der Übersicht einmal im Kartenkopf statt je Standort).
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ProblemMessage } from '../../components/ProblemMessage';
import { WeatherChart } from '../../components/WeatherChart';
import { problemCode } from '../admin/shared';
import { weatherHref } from './model';
import { chartProps, useNow, useSiteWeather } from './WeatherPage';
import styles from './weather.module.css';

export function SiteWeather({
  siteId,
  siteName,
  compact = false,
  link = true,
}: {
  siteId: string;
  siteName: string;
  compact?: boolean;
  link?: boolean;
}) {
  const { t } = useTranslation();
  const weather = useSiteWeather(siteId);
  const now = useNow();
  const view = weather.data;
  return (
    <div className={styles.compact}>
      <p className={styles.muted}>{t('weatherPage.forProject', { site: siteName })}</p>
      {weather.isError && !view ? (
        <ProblemMessage code={problemCode(weather.error)} onRetry={() => void weather.refetch()} />
      ) : view?.status === 'pending' ? (
        <p className={styles.muted} role="status">
          {t('weatherPage.pending')}
        </p>
      ) : view ? (
        <WeatherChart {...chartProps(view, now)} compact={compact} />
      ) : (
        <WeatherChart
          hours={[]}
          nights={[]}
          nightWindows={[]}
          darkWindows={[]}
          sunAltDeg={[]}
          nowUtc={now.toISOString()}
          days={7}
          timeZone="UTC"
          compact={compact}
          state="loading"
        />
      )}
      {link ? (
        <div>
          <Link className={styles.button} to={weatherHref(siteId)}>
            {t('weatherPage.openFull')}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
