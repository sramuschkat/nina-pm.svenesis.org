/**
 * S-82 Kataloge (FA-SU-08, AP-20): Stand des Objektkatalogs – OpenNGC-Version und Abrufdatum,
 * Quellzeilen (`NGC.csv` + `addendum.csv`), erwartete Zeilen laut Katalogdatei gegen die Zeilen in
 * `dso_object`, letzter Import und letzter Job; *Neu importieren* legt den Job `catalog_refresh` an.
 * Exoplaneten-Kataloge folgen mit R4.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { catalogApi } from '../../api/client';
import { ICON_SIZE, actionIcons } from '../../components/icons';
import { ProblemMessage } from '../../components/ProblemMessage';
import { formatDateTime, SYSTEM_TIMEZONE } from '../../lib/time';
import styles from '../admin/admin.module.css';
import catalogStyles from '../catalog/catalog.module.css';
import { problemCode } from '../admin/shared';

export const CATALOG_STATUS_KEY = ['system', 'catalogs'] as const;

export function CatalogPanel() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [started, setStarted] = useState(false);
  const status = useQuery({
    queryKey: CATALOG_STATUS_KEY,
    queryFn: () => catalogApi.status(),
    // Solange ein Import läuft, den Stand nachladen.
    refetchInterval: (q) =>
      q.state.data?.dso.lastJob && ['pending', 'running'].includes(q.state.data.dso.lastJob.status)
        ? 5000
        : false,
  });
  const refresh = useMutation({
    mutationFn: () => catalogApi.refresh(),
    onSuccess: () => setStarted(true),
    onSettled: () => client.invalidateQueries({ queryKey: CATALOG_STATUS_KEY }),
  });
  const when = (iso: string | null) =>
    iso ? formatDateTime(iso, SYSTEM_TIMEZONE, i18n.language) : t('catalog.status.none');
  const fmt = (n: number) => new Intl.NumberFormat(i18n.language).format(n);
  const Refresh = actionIcons.refresh;
  const d = status.data?.dso;
  return (
    <section className={styles.panel} aria-labelledby="catalog-status">
      <h2 id="catalog-status">{t('catalog.status.title')}</h2>
      {status.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : status.isError || !d ? (
        <ProblemMessage code={problemCode(status.error)} onRetry={() => void status.refetch()} />
      ) : (
        <>
          <h3>{t('catalog.status.dso')}</h3>
          <dl className={catalogStyles.statusList}>
            <dt>{t('catalog.status.version')}</dt>
            <dd>{d.version}</dd>
            <dt>{t('catalog.status.fetchedAt')}</dt>
            <dd>{d.fetchedAt}</dd>
            <dt>{t('catalog.status.sourceRows')}</dt>
            <dd>
              {t('catalog.status.sourceRowsValue', {
                ngc: fmt(d.ngcCsvRows),
                addendum: fmt(d.addendumCsvRows),
              })}
            </dd>
            <dt>{t('catalog.status.expected')}</dt>
            <dd>
              {t('catalog.status.expectedValue', {
                rows: fmt(d.expectedRows),
                sharpless: fmt(d.sharplessRows),
                warnings: fmt(d.warnings),
              })}
            </dd>
            <dt>{t('catalog.status.rows')}</dt>
            <dd>
              {d.rows === 0 ? (
                <span className={styles.pillWarn}>{t('catalog.status.notImported')}</span>
              ) : (
                <>
                  {fmt(d.rows)}{' '}
                  {d.rows !== d.expectedRows ? (
                    <span className={styles.pillWarn}>{t('catalog.status.mismatch')}</span>
                  ) : (
                    <span className={styles.pillOk}>{t('catalog.status.match')}</span>
                  )}
                </>
              )}
            </dd>
            <dt>{t('catalog.status.lastImport')}</dt>
            <dd>{when(d.lastImportAt)}</dd>
            <dt>{t('catalog.status.lastJob')}</dt>
            <dd>
              {d.lastJob ? (
                <>
                  <span
                    className={
                      d.lastJob.status === 'failed'
                        ? styles.pillDanger
                        : d.lastJob.status === 'done'
                          ? styles.pillOk
                          : styles.pill
                    }
                  >
                    {t(`catalog.status.jobStatus.${d.lastJob.status}`)}
                  </span>{' '}
                  {when(d.lastJob.finishedAt ?? d.lastJob.createdAt)}
                  {d.lastJob.error ? (
                    <span className={styles.muted}> · {d.lastJob.error}</span>
                  ) : null}
                </>
              ) : (
                t('catalog.status.none')
              )}
            </dd>
          </dl>
          <p className={styles.muted}>{t('catalog.status.refreshHint')}</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.buttonPrimary}
              disabled={refresh.isPending}
              onClick={() => {
                setStarted(false);
                refresh.mutate();
              }}
            >
              <Refresh size={ICON_SIZE.button} aria-hidden />
              {t('catalog.status.refresh')}
            </button>
            {started ? (
              <span className={styles.success} role="status">
                {t('catalog.status.refreshStarted')}
              </span>
            ) : null}
          </div>
          {refresh.isError ? <ProblemMessage code={problemCode(refresh.error)} /> : null}
        </>
      )}
    </section>
  );
}
