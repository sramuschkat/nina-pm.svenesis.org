/**
 * Vorgeschlagene Filter-Offsets am Rig (AP-72, FA-RIG-20, S-10 beim Filterrad): aus den Autofokus-Läufen der letzten
 * 60 Nächte je NINA-Filter, Regression Position gegen Temperatur mit gemeinsamer Steigung. Je Filter Läufe, Streuung,
 * Vorschlag und der Offset, den NINA meldet; dazu die Temperaturdrift und ein Text zum Übertragen in NINAs
 * Filterrad-Einstellungen. Nur Anzeige – NINA übernimmt nichts automatisch.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { equipmentApi, type FocusOffsetsView, type RigView } from '../../api/client';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { useAuth } from '../../auth';
import { formatDateTime } from '../../lib/time';
import styles from './equipment.module.css';
import sched from './scheduler.module.css';

type Row = FocusOffsetsView['filters'][number];

export function FocusOffsets({ rig }: { rig: RigView }) {
  const { t, i18n } = useTranslation();
  const { me } = useAuth();
  const zone = me?.tenant?.timeZone ?? 'UTC';
  const query = useQuery({
    queryKey: ['focus-offsets', rig.id],
    queryFn: () => equipmentApi.focusOffsets(rig.id),
  });
  const view = query.data;
  if (!view) return null;
  const num = (v: number, d = 1) => v.toLocaleString(i18n.language, { maximumFractionDigits: d });
  const signed = (v: number) => (v > 0 ? `+${num(v, 0)}` : num(v, 0));
  const columns: DataColumn<Row>[] = [
    {
      id: 'filter',
      header: t('rigs.focus.col.filter'),
      cell: (r) => (
        <>
          {r.position !== null ? `${String(r.position)} · ` : ''}
          {r.filter}
          {r.shortName ? <span className={styles.muted}> ({r.shortName})</span> : null}
          {r.filter === view.reference ? (
            <span className={styles.muted}> · {t('rigs.focus.reference')}</span>
          ) : null}
        </>
      ),
      sortable: false,
    },
    {
      id: 'runs',
      header: t('rigs.focus.col.runs'),
      cell: (r) => num(r.runs, 0),
      align: 'end',
      sortable: false,
    },
    {
      id: 'scatter',
      header: t('rigs.focus.col.scatter'),
      cell: (r) => (r.scatter === null ? '–' : t('rigs.focus.steps', { v: num(r.scatter) })),
      align: 'end',
      nowrap: true,
      sortable: false,
    },
    {
      id: 'offset',
      header: t('rigs.focus.col.offset'),
      cell: (r) =>
        r.offset === null ? (
          <span className={styles.muted}>{t('rigs.focus.tooFew', { min: view.minRuns })}</span>
        ) : (
          <strong>{signed(r.offset)}</strong>
        ),
      align: 'end',
      nowrap: true,
      sortable: false,
    },
    {
      id: 'nina',
      header: t('rigs.focus.col.nina'),
      cell: (r) =>
        r.ninaOffset === null ? (
          '–'
        ) : (
          <>
            {signed(r.ninaOffset)}
            {r.offset !== null &&
            Math.abs(r.ninaOffset - r.offset) > Math.max(5, r.scatter ?? 0) ? (
              <>
                {' '}
                <span className={styles.statusWarn}>{t('rigs.focus.differs')}</span>
              </>
            ) : null}
          </>
        ),
      align: 'end',
      nowrap: true,
      sortable: false,
    },
    {
      id: 'last',
      header: t('rigs.focus.col.last'),
      cell: (r) => (r.lastRunAt ? formatDateTime(r.lastRunAt, zone, i18n.language) : '–'),
      nowrap: true,
      sortable: false,
    },
  ];
  const suggested = view.filters.filter((f) => f.offset !== null);
  const transfer = suggested.map((f) => `${f.filter} ${signed(f.offset as number)}`).join(' · ');
  return (
    <section className={sched.summary} aria-labelledby="focus-offsets-title">
      <div className={sched.head}>
        <h3 id="focus-offsets-title">{t('rigs.focus.title')}</h3>
      </div>
      <p className={styles.muted}>
        {view.totalRuns === 0
          ? t('rigs.focus.none')
          : t('rigs.focus.basis', {
              runs: view.totalRuns,
              from: view.fromNight,
              to: view.toNight,
              min: view.minRuns,
            })}
        {view.slopePerC !== null
          ? ` ${t('rigs.focus.drift', {
              v: num(view.slopePerC),
              t: num(view.referenceTemperatureC ?? 0),
            })}`
          : ''}
      </p>
      {view.ninaWithoutOffsets && suggested.length > 1 ? (
        <p className={styles.note} role="note">
          {t('rigs.focus.ninaWithout')}
        </p>
      ) : null}
      {view.filters.length > 0 ? (
        <DataTable
          columns={columns}
          rows={view.filters}
          rowKey={(r) => r.filter}
          rowLabel={(r) => r.filter}
          label={t('rigs.focus.title')}
        />
      ) : null}
      {suggested.length > 1 ? (
        <p>
          {t('rigs.focus.transfer')} <code data-testid="focus-transfer">{transfer}</code>
        </p>
      ) : null}
    </section>
  );
}
