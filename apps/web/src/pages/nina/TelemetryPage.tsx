/**
 * Rig-Zustand S-43 (AP-67, FA-RIG-17/18; eigener Menüpunkt im Bereich Betrieb unter NINA): Telemetrie der Skripte am Rig – Mini-PC (Core Temp) und Powerbox (Pegasus
 * Unity). Rig und Zeitraum stehen in der Adresse (`?rig=`, `?zeitraum=`); oben je Quelle der jüngste Messpunkt mit
 * „zuletzt empfangen“, darunter je Messgröße ein Diagramm mit einer Einheit. Zeiten in Standortzeit mit Kürzel.
 * Kurze Zeiträume laden jede Minute neu.
 */
import { formatTzAbbr, formatZonedTime } from '@nina-pm/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { telemetryApi, type TelemetrySeries } from '../../api/client';
import { PageHeader } from '../../components/PageHeader';
import { ProblemMessage } from '../../components/ProblemMessage';
import { RigSelect, type RigOption } from '../../components/RigSelect';
import { formatDate } from '../../lib/time';
import { problemCode } from '../admin/shared';
import { useEquipmentList } from '../equipment/shared';
import { TelemetryChart } from './TelemetryChart';
import {
  CHARTS,
  DEW_GAP_WARN_K,
  DISK_FREE_WARN_PCT,
  isRange,
  latestValue,
  rangeWindow,
  STALE_MIN,
  TELEMETRY_RANGES,
  type TelemetryRange,
} from './telemetry-model';
import ninaStyles from './nina.module.css';
import styles from './telemetry.module.css';

/** Kennzahlen je Quelle oben auf der Seite. */
const TILES: Record<TelemetrySeries['source'], readonly { metric: string; unit: string }[]> = {
  pc: [
    { metric: 'cpuMaxC', unit: '°C' },
    { metric: 'loadPct', unit: '%' },
    { metric: 'diskC', unit: '°C' },
  ],
  power_box: [
    { metric: 'airC', unit: '°C' },
    { metric: 'dewPointC', unit: '°C' },
    { metric: 'dewGapK', unit: 'K' },
    { metric: 'humidityPct', unit: '%' },
    { metric: 'voltageV', unit: 'V' },
    { metric: 'currentA', unit: 'A' },
  ],
  storage: [
    { metric: 'freeGb', unit: 'GB' },
    { metric: 'freePct', unit: '%' },
    { metric: 'totalGb', unit: 'GB' },
  ],
};

type Source = TelemetrySeries['source'];
/**
 * Karten oben: der Speicherplatz gehört zum Mini-PC (Rückmeldung Sven 08.10.2026). Diagramme: erst die Powerbox, dann
 * der Mini-PC mit dem Speicherplatz.
 */
const CARD_GROUPS: readonly { key: Source; sources: readonly Source[] }[] = [
  { key: 'pc', sources: ['pc', 'storage'] },
  { key: 'power_box', sources: ['power_box'] },
];
const CHART_GROUPS: readonly { key: Source; sources: readonly Source[] }[] = [
  { key: 'power_box', sources: ['power_box'] },
  { key: 'pc', sources: ['pc', 'storage'] },
];

export function TelemetryPage() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const rigs = useEquipmentList('rigs');
  const sites = useEquipmentList('sites');
  const telescopes = useEquipmentList('telescopes');
  const cameras = useEquipmentList('cameras');
  const [nowMin, setNowMin] = useState(() => Math.floor(Date.now() / 60_000));
  useEffect(() => {
    const timer = setInterval(() => setNowMin(Math.floor(Date.now() / 60_000)), 60_000);
    return () => clearInterval(timer);
  }, []);

  const rigList = rigs.data ?? [];
  const wanted = params.get('rig');
  const rigId =
    (rigList.some((r) => r.id === wanted) ? wanted : null) ??
    rigList.find((r) => r.showInPlanning)?.id ??
    rigList[0]?.id ??
    null;
  const rig = rigList.find((r) => r.id === rigId) ?? null;
  const site = (sites.data ?? []).find((s) => s.id === rig?.siteId) ?? null;
  const timeZone = site?.timeZone ?? 'UTC';
  const rangeParam = params.get('zeitraum');
  const range: TelemetryRange = isRange(rangeParam) ? rangeParam : '24h';
  // Kurze Zeiträume jede Minute neu, längere alle 10 min (Stundenwerte ändern sich stündlich).
  const short = range === '12h' || range === '24h';
  const { from, to } = rangeWindow(range, (short ? nowMin : Math.floor(nowMin / 10) * 10) * 60_000);
  const data = useQuery({
    queryKey: ['telemetry', rigId, from, to],
    queryFn: () => telemetryApi.get(rigId ?? '', from, to),
    enabled: rigId !== null,
    placeholderData: (prev) => prev,
  });
  const setUrl = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };
  const rigOptions: RigOption[] = rigList.map((r) => ({
    id: r.id,
    name: r.name,
    siteName: (sites.data ?? []).find((s) => s.id === r.siteId)?.name ?? '',
    telescopeName: (telescopes.data ?? []).find((x) => x.id === r.telescopeId)?.name ?? '',
    cameraName: (cameras.data ?? []).find((x) => x.id === r.cameraId)?.name ?? '',
    scaleArcsecPx: r.derived.scaleArcsecPx,
    fovDeg: [r.derived.fovWidthDeg, r.derived.fovHeightDeg],
    showInPlanning: r.showInPlanning,
  }));

  const n = (v: number) =>
    v.toLocaleString(i18n.language, { maximumFractionDigits: Math.abs(v) < 10 ? 2 : 1 });
  const nowMs = nowMin * 60_000;
  const sources = data.data?.sources ?? [];
  const bySource = new Map(sources.map((x) => [x.source, x] as const));
  const noData = data.isSuccess && sources.every((s) => s.latest === null && s.t.length === 0);
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);

  const received = (s: TelemetrySeries) => {
    if (!s.latest) return <span className={styles.muted}>{t('telemetry.never')}</span>;
    const at = s.latest.atUtc;
    const ageMin = Math.max(0, Math.round((nowMs - Date.parse(at)) / 60_000));
    const when =
      nowMs - Date.parse(at) > 20 * 3_600_000
        ? `${formatDate(at, timeZone, i18n.language)} ${formatZonedTime(at, timeZone)} ${formatTzAbbr(at, timeZone)}`
        : `${formatZonedTime(at, timeZone)} ${formatTzAbbr(at, timeZone)}`;
    return (
      <span className={ageMin > STALE_MIN ? styles.stale : styles.muted}>
        {t(ageMin > STALE_MIN ? 'telemetry.receivedStale' : 'telemetry.received', {
          time: when,
          minutes: ageMin,
        })}
      </span>
    );
  };

  return (
    <div className={ninaStyles.page}>
      <PageHeader title={t('telemetry.title')} />
      <p className={ninaStyles.info}>{t('telemetry.info')}</p>
      <div className={styles.toolbar}>
        {rigs.isPending ? (
          <p className={styles.muted} role="status">
            {t('common.loading')}
          </p>
        ) : rigs.isSuccess && rigList.length === 0 ? (
          <p className={styles.muted}>{t('telemetry.noRig')}</p>
        ) : (
          <div className={styles.rig}>
            <RigSelect
              rigs={rigOptions}
              value={rigId}
              onChange={(v) => setUrl({ rig: v })}
              label={t('telemetry.rig')}
            />
          </div>
        )}
        <div className={styles.ranges} role="group" aria-label={t('telemetry.range')}>
          {TELEMETRY_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              className={styles.rangeChip}
              aria-pressed={r === range}
              onClick={() => setUrl({ zeitraum: r === '24h' ? null : r })}
            >
              {t(`telemetry.ranges.${r}`)}
            </button>
          ))}
        </div>
      </div>

      {rigs.isError ? (
        <ProblemMessage code={problemCode(rigs.error)} onRetry={() => void rigs.refetch()} />
      ) : data.isError ? (
        <ProblemMessage code={problemCode(data.error)} onRetry={() => void data.refetch()} />
      ) : data.isPending && rigId !== null ? (
        <p className={styles.muted} role="status">
          {t('common.loading')}
        </p>
      ) : noData ? (
        <div className={styles.emptyCard}>
          <h2>{t('telemetry.emptyTitle')}</h2>
          <p>{t('telemetry.emptyText')}</p>
        </div>
      ) : (
        <>
          <div className={styles.tiles}>
            {CARD_GROUPS.map((g) => {
              const main = bySource.get(g.key);
              if (!main) return null;
              return (
                <section
                  key={g.key}
                  className={styles.tileCard}
                  aria-label={t(`telemetry.source.${g.key}`)}
                >
                  <div className={styles.tileHead}>
                    <h2>{t(`telemetry.source.${g.key}`)}</h2>
                    {received(main)}
                  </div>
                  <dl className={styles.values}>
                    {g.sources.flatMap((src) => {
                      const s = bySource.get(src);
                      return s
                        ? TILES[src].map(({ metric, unit }) => {
                            const v = latestValue(s, metric);
                            const warn =
                              v !== null &&
                              ((metric === 'dewGapK' && v < DEW_GAP_WARN_K) ||
                                (metric === 'freePct' && v < DISK_FREE_WARN_PCT));
                            return (
                              <div key={metric} className={warn ? styles.valueWarn : undefined}>
                                <dt>{t(`telemetry.metric.${metric}`)}</dt>
                                <dd>{v === null ? '–' : `${n(v)} ${unit}`}</dd>
                              </div>
                            );
                          })
                        : [];
                    })}
                  </dl>
                </section>
              );
            })}
          </div>
          {CHART_GROUPS.map((g) => {
            const main = bySource.get(g.key);
            if (!main) return null;
            return (
              <section key={g.key} className={styles.section}>
                <h2 className={styles.sectionTitle}>
                  {t('telemetry.history', { source: t(`telemetry.source.${g.key}`) })}
                </h2>
                <div className={styles.charts}>
                  {CHARTS.filter((c) => (g.sources as readonly string[]).includes(c.source)).map(
                    (c) => {
                      const data = bySource.get(c.source);
                      return data ? (
                        <TelemetryChart
                          key={c.key}
                          spec={c}
                          data={data}
                          fromMs={fromMs}
                          toMs={toMs}
                          timeZone={timeZone}
                        />
                      ) : null;
                    },
                  )}
                </div>
                <p className={styles.resolution}>
                  {t(
                    main.resolution === 'raw'
                      ? 'telemetry.resolutionRaw'
                      : 'telemetry.resolutionHourly',
                    { points: main.t.length },
                  )}
                </p>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
