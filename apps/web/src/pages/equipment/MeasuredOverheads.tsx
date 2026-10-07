/**
 * Gemessene Overheads am Rig (AP-65, FA-RIG-04b, S-10): je Wert getippt, gemessen (Median, n, p25–p75), was in der
 * Planung wirkt und der Schalter „fest“ (immer getippt). Gemessen wirkt ab `minSamples` Messungen; Hinweis, wenn der
 * gemessene Wert mehr als doppelt bzw. weniger als halb so groß ist wie der getippte. Der Schalter speichert sofort über
 * `PUT /rigs/{id}/scheduler-settings` (`rig.settings.write`) – die übrigen Einstellungen bleiben, wie sie sind.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { equipmentApi, type RigView } from '../../api/client';
import { useAuth } from '../../auth';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { ProblemMessage } from '../../components/ProblemMessage';
import { formatDateTime } from '../../lib/time';
import styles from './equipment.module.css';
import sched from './scheduler.module.css';
import { equipmentKey, problemCode } from './shared';

type Overheads = NonNullable<RigView['overheads']>;
type Value = Overheads['values'][number];

export function MeasuredOverheads({ rig, canWrite }: { rig: RigView; canWrite: boolean }) {
  const { t, i18n } = useTranslation();
  const { me } = useAuth();
  const zone = me?.tenant?.timeZone ?? 'UTC';
  const client = useQueryClient();
  const overheads = rig.overheads;
  const save = useMutation({
    mutationFn: (fixed: Value['key'][]) =>
      equipmentApi.schedulerSettings(
        rig.id,
        { ...rig.scheduler, overheadFixed: fixed },
        rig.settingsVersion,
      ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: equipmentKey('rigs') });
    },
  });
  if (!overheads) return null;
  const num = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 });
  const sec = (s: number) =>
    s >= 120
      ? t('rigs.measured.secondsMin', { s: num.format(s), min: num.format(s / 60) })
      : t('rigs.measured.seconds', { s: num.format(s) });
  const fixed = new Set(rig.scheduler.overheadFixed ?? []);
  const keys = overheads.values.map((v) => v.key);
  const toggle = (key: Value['key'], on: boolean) => {
    const next = new Set(fixed);
    if (on) next.add(key);
    else next.delete(key);
    save.mutate(keys.filter((k) => next.has(k)));
  };
  const columns: DataColumn<Value>[] = [
    {
      id: 'value',
      header: t('rigs.measured.col.value'),
      cell: (v) => t(`rigs.measured.key.${v.key}`),
      sortable: false,
    },
    {
      id: 'typed',
      header: t('rigs.measured.col.typed'),
      cell: (v) => sec(v.typedS),
      align: 'end',
      nowrap: true,
      sortable: false,
    },
    {
      id: 'measured',
      header: t('rigs.measured.col.measured'),
      cell: (v) =>
        v.measured ? (
          <>
            {sec(v.measured.medianS)}{' '}
            <span className={styles.muted}>
              {t('rigs.measured.spread', {
                n: v.measured.n,
                p25: num.format(v.measured.p25S),
                p75: num.format(v.measured.p75S),
              })}
            </span>
            {v.deviates ? (
              <>
                {' '}
                <span className={styles.statusWarn}>{t('rigs.measured.deviates')}</span>
              </>
            ) : null}
          </>
        ) : (
          <span className={styles.muted}>{t('rigs.measured.none')}</span>
        ),
      sortable: false,
    },
    {
      id: 'effective',
      header: t('rigs.measured.col.effective'),
      cell: (v) => (
        <>
          {sec(v.effectiveS)}{' '}
          <span className={v.source === 'measured' ? styles.statusOk : styles.statusNone}>
            {t(`rigs.measured.source.${v.source}`)}
          </span>
        </>
      ),
      nowrap: true,
      sortable: false,
    },
    {
      id: 'fixed',
      header: t('rigs.measured.col.fixed'),
      cell: (v) => (
        <input
          type="checkbox"
          checked={v.fixed}
          disabled={!canWrite || save.isPending}
          aria-label={t('rigs.measured.fixedAt', { value: t(`rigs.measured.key.${v.key}`) })}
          onChange={(e) => toggle(v.key, e.target.checked)}
        />
      ),
      sortable: false,
    },
  ];
  const code = save.error ? problemCode(save.error) : null;
  return (
    <section className={sched.summary} aria-labelledby="measured-overheads">
      <div className={sched.head}>
        <h3 id="measured-overheads">{t('rigs.measured.title')}</h3>
      </div>
      <p className={styles.muted}>
        {overheads.computedAtUtc
          ? t('rigs.measured.basis', {
              nights: overheads.nights,
              at: formatDateTime(overheads.computedAtUtc, zone, i18n.language),
              min: overheads.minSamples,
            })
          : t('rigs.measured.noData', { min: overheads.minSamples })}
      </p>
      {code ? <ProblemMessage code={code} /> : null}
      <DataTable
        columns={columns}
        rows={overheads.values}
        rowKey={(v) => v.key}
        rowLabel={(v) => t(`rigs.measured.key.${v.key}`)}
        label={t('rigs.measured.title')}
      />
      <p className={styles.muted}>{t('rigs.measured.hint')}</p>
    </section>
  );
}
