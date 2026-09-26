/**
 * S-33 Auswirkungsvorschau (FK 14.3; FA-FRG-05; AP-32a): im Entscheidungsbereich eines eingereichten
 * Objekts (Admin) – Job `impact` mit 14 Nächten am Wunsch-Rig mit und ohne das Objekt; bei einem
 * Änderungsantrag (AP-32b) die aktuelle Fassung gegen die Fassung mit Antrag. Zeigt den Anteil des
 * Objekts und je anderem Projekt Stunden, Frames und Fertigstellung ohne → mit.
 */
import { formatNightKey } from '@nina-pm/shared';
import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { approvalApi, type ImpactResult } from '../../api/client';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { ProblemMessage } from '../../components/ProblemMessage';
import { useJob } from '../../lib/use-job';
import { problemCode } from '../admin/shared';
import styles from './projects.module.css';

type Shift = ImpactResult['shifts'][number];

export function ImpactPanel({
  id,
  kind = 'project',
}: {
  id: string;
  kind?: 'project' | 'change-request';
}) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const [jobId, setJobId] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: () => approvalApi.impact(kind, id),
    onSuccess: (r) => setJobId(r.jobId),
  });
  const { result, running, failed, errorCode } = useJob<ImpactResult>(jobId);
  const data = result.data?.kind === 'impact' ? result.data : null;
  const n = (v: number) => v.toLocaleString(i18n.language, { maximumFractionDigits: 1 });
  const night = (k: string | null) => (k ? formatNightKey(k) : '–');
  const columns: DataColumn<Shift>[] = [
    {
      id: 'project',
      header: t('impact.col.project'),
      sortValue: (s) => s.name,
      cell: (s) => s.name,
    },
    {
      id: 'hours',
      header: t('impact.col.hours'),
      sortValue: (s) => s.hoursWith - s.hoursWithout,
      align: 'end',
      nowrap: true,
      cell: (s) => `${n(s.hoursWithout)} → ${n(s.hoursWith)}`,
    },
    {
      id: 'frames',
      header: t('impact.col.frames'),
      sortValue: (s) => s.framesWith - s.framesWithout,
      align: 'end',
      nowrap: true,
      priority: 2,
      cell: (s) => `${n(s.framesWithout)} → ${n(s.framesWith)}`,
    },
    {
      id: 'completes',
      header: t('impact.col.completes'),
      sortValue: (s) => s.completesWith,
      nowrap: true,
      cell: (s) => `${night(s.completesWithout)} → ${night(s.completesWith)}`,
    },
  ];
  return (
    <section className={styles.impact} aria-labelledby={titleId}>
      <h3 id={titleId}>{t('impact.title')}</h3>
      <p className={styles.muted}>
        {kind === 'change-request' ? t('impact.hintRequest') : t('impact.hint')}
      </p>
      <div>
        <button
          type="button"
          className={styles.button}
          disabled={start.isPending || running}
          onClick={() => start.mutate()}
        >
          {data ? t('impact.rerun') : t('impact.run')}
        </button>
      </div>
      {start.error ? <ProblemMessage code={problemCode(start.error)} /> : null}
      {running ? <p role="status">{t('impact.running')}</p> : null}
      {failed ? <ProblemMessage code={errorCode ?? 'internal.error'} /> : null}
      {result.error ? <ProblemMessage code={problemCode(result.error)} /> : null}
      {data ? (
        <>
          <p>
            {data.target && data.target.hours > 0
              ? t('impact.target', {
                  share: n(data.target.sharePct),
                  hours: n(data.target.hours),
                  nights: data.target.nightsUsed,
                  completes: data.target.completesNight
                    ? t('impact.completes', { night: formatNightKey(data.target.completesNight) })
                    : t('impact.notInRange'),
                })
              : t('impact.noTime')}
          </p>
          <p className={styles.muted}>
            {t('impact.rigHours', { without: n(data.hoursWithout), with: n(data.hoursWith) })}
          </p>
          <DataTable
            columns={columns}
            rows={data.shifts}
            rowKey={(s) => s.projectId}
            rowLabel={(s) => s.name}
            label={t('impact.others')}
            empty={t('impact.noOthers')}
          />
        </>
      ) : null}
    </section>
  );
}
