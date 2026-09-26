/**
 * Saisondiagramm eines Ziels am Standort (AP-24, FA-SIC-02/04): Zeitraum 1/3/6 Monate oder Jahr, Rechnung
 * im Saison-Worker mit der Nacht-Tabelle des Servers (400 Nächte, NT-02). Einsatz im Projekt-Editor
 * (Reiter *Diagramme*) und im Objektbrowser.
 */
import { SEASON_RANGES, type SeasonRange, type SeasonTargetInput } from '@nina-pm/shared';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { equipmentApi, type SiteView } from '../../api/client';
import { SeasonChart } from '../../components/SeasonChart';
import { useSeasonChart } from '../../lib/use-season';
import { useNumber } from '../equipment/shared';
import styles from './projects.module.css';

export const SEASON_TABLE_NIGHTS = 400;

export function useSeasonNights(siteId: string | null) {
  return useQuery({
    queryKey: ['site-nights', siteId, 'season'],
    queryFn: () => equipmentApi.nights(siteId ?? '', SEASON_TABLE_NIGHTS),
    enabled: siteId !== null,
    staleTime: 60 * 60 * 1000,
  });
}

export function SeasonPanel({
  site,
  target,
  conditions,
  startDate = null,
  title,
}: {
  site: Pick<SiteView, 'id' | 'latitudeDeg' | 'longitudeDeg'>;
  target: SeasonTargetInput['target'];
  conditions: SeasonTargetInput['conditions'];
  startDate?: string | null;
  /** Überschrift; Standard „Saisondiagramm“. */
  title?: string;
}) {
  const { t } = useTranslation();
  const num = useNumber();
  const [range, setRange] = useState<SeasonRange>('3m');
  const nights = useSeasonNights(site.id);
  const input: SeasonTargetInput | null = nights.data
    ? {
        site: { latitudeDeg: site.latitudeDeg, longitudeDeg: site.longitudeDeg },
        nights: nights.data,
        target,
        conditions,
        startDate,
      }
    : null;
  const season = useSeasonChart(input, range);
  const titleId = useId();
  const data = season.data;
  return (
    <section className={styles.stack} aria-labelledby={titleId}>
      <div className={styles.seasonHead}>
        <h3 id={titleId}>{title ?? t('seasonChart.title')}</h3>
        <div className={styles.segmented} role="radiogroup" aria-label={t('seasonChart.range')}>
          {SEASON_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={range === r}
              className={range === r ? styles.segmentActive : styles.segment}
              onClick={() => setRange(r)}
            >
              {t(`seasonChart.ranges.${r}`)}
            </button>
          ))}
        </div>
        {data && data.status !== 'never' ? (
          <span className={styles.muted}>
            {t('seasonChart.hoursToEnd', { h: num(data.usableHoursToSeasonEnd, 0) })}
          </span>
        ) : null}
      </div>
      <SeasonChart
        months={data?.months ?? []}
        range={range}
        seasonStart={data?.seasonStart ?? null}
        seasonEnd={data?.seasonEnd ?? null}
        minTimeH={conditions.minTimeOnTargetH}
        today={data?.today}
        status={data?.status}
        state={
          nights.isError || season.state === 'error'
            ? 'error'
            : !data || season.state === 'loading'
              ? 'loading'
              : 'ready'
        }
        onRetry={() => void nights.refetch()}
      />
    </section>
  );
}
