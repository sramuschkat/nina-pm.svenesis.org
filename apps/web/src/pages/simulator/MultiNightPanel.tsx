/**
 * S-40 Bereich *Mehrnacht* (FK 14.3; FA-SIM-04; AP-32a): Mehrnacht-Simulation über 7 oder 14 Nächte ab der
 * gewählten Nacht als Job `multi_sim` – fortgeschriebener Restbedarf, optional mit Wettergewichtung aus
 * der Nachtbewertung, optional mit eigenen Entwürfen. Ergebnis: Streifen je Nacht (belichtete Stunden,
 * Gewicht) und Tabelle je Projekt (Bedarf, simuliert, Stunden, Nächte, Fertigstellung, Anteil).
 */
import { formatNightKey } from '@nina-pm/shared';
import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { simulationApi, type MultiSimResult } from '../../api/client';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { ProblemMessage } from '../../components/ProblemMessage';
import { useJob } from '../../lib/use-job';
import { problemCode } from '../admin/shared';
import styles from './simulator.module.css';

type SimProject = MultiSimResult['projects'][number];

export function MultiNightPanel({
  rigId,
  nightFrom,
  withDrafts,
}: {
  rigId: string;
  nightFrom: string;
  withDrafts: boolean;
}) {
  const { t, i18n } = useTranslation();
  const ids = { nights: useId(), weather: useId(), title: useId() };
  const [nights, setNights] = useState<7 | 14>(7);
  const [weather, setWeather] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: () =>
      simulationApi.multi({ rigId, nightFrom, nights, weather, includeOwnDrafts: withDrafts }),
    onSuccess: (r) => setJobId(r.jobId),
  });
  const { result, running, failed, errorCode } = useJob<MultiSimResult>(jobId);
  const data = result.data;
  const n = (v: number, digits = 1) =>
    v.toLocaleString(i18n.language, { maximumFractionDigits: digits });
  const columns: DataColumn<SimProject>[] = [
    {
      id: 'name',
      header: t('multiSim.col.project'),
      sortValue: (p) => p.name,
      cell: (p) => (
        <>
          {p.name}
          {p.approvalStatus !== 'approved' ? (
            <span className={styles.muted}> ({t(`status.approval.${p.approvalStatus}`)})</span>
          ) : null}
        </>
      ),
    },
    {
      id: 'need',
      header: t('multiSim.col.need'),
      sortValue: (p) => p.needFrames,
      align: 'end',
      priority: 3,
      cell: (p) => p.needFrames,
    },
    {
      id: 'simulated',
      header: t('multiSim.col.simulated'),
      sortValue: (p) => p.simulatedFrames,
      align: 'end',
      cell: (p) => n(p.simulatedFrames),
    },
    {
      id: 'hours',
      header: t('multiSim.col.hours'),
      sortValue: (p) => p.hours,
      align: 'end',
      nowrap: true,
      cell: (p) => t('multiSim.hours', { h: n(p.hours) }),
    },
    {
      id: 'nights',
      header: t('multiSim.col.nights'),
      sortValue: (p) => p.nightsUsed,
      align: 'end',
      priority: 3,
      cell: (p) => p.nightsUsed,
    },
    {
      id: 'completes',
      header: t('multiSim.col.completes'),
      sortValue: (p) => p.completesNight,
      nowrap: true,
      cell: (p) =>
        p.needFrames === 0
          ? t('multiSim.done')
          : p.completesNight
            ? formatNightKey(p.completesNight)
            : t('multiSim.notInRange'),
    },
    {
      id: 'share',
      header: t('multiSim.col.share'),
      sortValue: (p) => p.sharePct,
      align: 'end',
      priority: 2,
      cell: (p) => `${n(p.sharePct)} %`,
    },
  ];
  const maxDark = data ? Math.max(1, ...data.nights.map((x) => x.darkHours ?? 0)) : 1;
  return (
    <section className={styles.block} aria-labelledby={ids.title}>
      <div className={styles.blockHead}>
        <h2 id={ids.title} className={styles.blockTitle}>
          {t('multiSim.title')}
        </h2>
        <span className={styles.stats}>
          {t('multiSim.from', { night: formatNightKey(nightFrom) })}
        </span>
      </div>
      <div className={styles.multiControls}>
        <label htmlFor={ids.nights}>{t('multiSim.nights')}</label>
        <select
          id={ids.nights}
          value={nights}
          onChange={(e) => setNights(Number(e.target.value) === 14 ? 14 : 7)}
        >
          <option value={7}>{t('multiSim.nightCount', { count: 7 })}</option>
          <option value={14}>{t('multiSim.nightCount', { count: 14 })}</option>
        </select>
        <label className={styles.check} htmlFor={ids.weather}>
          <input
            id={ids.weather}
            type="checkbox"
            checked={weather}
            onChange={(e) => setWeather(e.target.checked)}
          />
          {t('multiSim.weather')}
        </label>
        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={start.isPending || running}
          onClick={() => start.mutate()}
        >
          {t('multiSim.run')}
        </button>
      </div>
      <p className={styles.muted}>{t('multiSim.hint')}</p>
      {start.error ? <ProblemMessage code={problemCode(start.error)} /> : null}
      {running ? (
        <p role="status" className={styles.note}>
          {t('multiSim.running')}
        </p>
      ) : null}
      {failed ? <ProblemMessage code={errorCode ?? 'internal.error'} /> : null}
      {result.error ? <ProblemMessage code={problemCode(result.error)} /> : null}
      {data && data.kind === 'multi_sim' ? (
        <>
          <ol className={styles.nightStrip} aria-label={t('multiSim.perNight')}>
            {data.nights.map((x) => (
              <li
                key={x.night}
                className={styles.nightCell}
                aria-label={t('multiSim.nightAria', {
                  night: formatNightKey(x.night),
                  hours: n(x.exposureHours),
                  dark: x.darkHours === null ? '–' : n(x.darkHours),
                })}
              >
                <span className={styles.nightTrack} aria-hidden="true">
                  <span
                    className={styles.nightFill}
                    style={{
                      height: `${String(Math.min(100, (x.exposureHours / maxDark) * 100))}%`,
                    }}
                  />
                </span>
                <span>{formatNightKey(x.night)}</span>
                <span className={styles.muted}>
                  {t('multiSim.hours', { h: n(x.exposureHours) })}
                </span>
                {data.weather ? (
                  <span className={x.hasForecast ? styles.tag : styles.muted}>
                    {x.hasForecast
                      ? t('multiSim.weight', { w: n(x.weight, 2) })
                      : t('multiSim.noForecast')}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          <DataTable
            columns={columns}
            rows={data.projects}
            rowKey={(p) => p.projectId}
            rowLabel={(p) => p.name}
            label={t('multiSim.perProject')}
            empty={t('multiSim.empty')}
          />
        </>
      ) : null}
    </section>
  );
}
