/**
 * S-60 Sessions (FK 14.3; FA-AUS-01, FA-AUS-07; AP-15): Liste je Rig und Nacht mit Status, Beginn–Ende
 * in Standortzeit mit Kürzel, Frames, Integration, Aufnahmen ohne Zuordnung und geprüft ja/nein; Filter
 * Rig und „nur ungeprüfte“. Effizienz und Wetterbewertung folgen mit den KPIs (R3) bzw. dem Wetter (R2).
 * Seitengerüst `PageHeader`, Filterzeile und Tabelle in **einer** Karte (Stilsystem AP-26d).
 */
import { formatNightKey } from '@nina-pm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { sessionsApi, type NightSession } from '../../api/client';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { ProblemMessage } from '../../components/ProblemMessage';
import { SiteTime } from '../../components/SiteTime';
import { StatusBadge } from '../../components/StatusBadge';
import { problemCode } from '../admin/shared';
import { useEquipmentList } from '../equipment/shared';
import styles from './sessions.module.css';

export const SESSIONS_PATH = '/auswertung/sessions';
export const hours = (s: number) => (s / 3600).toFixed(1);

export function SessionTime({ session }: { session: NightSession }) {
  const { t } = useTranslation();
  return (
    <span className={styles.nowrap}>
      <SiteTime atUtc={session.startedAt} siteTimeZone={session.siteTimeZone} />
      {' – '}
      {session.endedAt ? (
        <SiteTime atUtc={session.endedAt} siteTimeZone={session.siteTimeZone} />
      ) : (
        t('sessions.running')
      )}
    </span>
  );
}

export function SessionsPage() {
  const { t } = useTranslation();
  const rigs = useEquipmentList('rigs');
  const [rigId, setRigId] = useState('');
  const [unreviewed, setUnreviewed] = useState(false);
  const list = useQuery({
    queryKey: ['sessions', rigId, unreviewed],
    queryFn: async () =>
      (await sessionsApi.list({ ...(rigId ? { rigId } : {}), unreviewed })).items,
  });
  const items = list.data ?? [];
  return (
    <div className={styles.page}>
      <PageHeader title={t('sessions.title')} />
      <section className={styles.listCard} aria-label={t('sessions.title')}>
        <div className={`${styles.toolbar} ${styles.listBar}`}>
          <div className={styles.field}>
            <label htmlFor="sessions-rig">{t('sessions.rig')}</label>
            <select
              id="sessions-rig"
              className={`${styles.input} ${styles.rigSelect}`}
              value={rigId}
              onChange={(e) => setRigId(e.target.value)}
            >
              <option value="">{t('sessions.allRigs')}</option>
              {(rigs.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={unreviewed}
              onChange={(e) => setUnreviewed(e.target.checked)}
            />
            {t('sessions.onlyUnreviewed')}
          </label>
        </div>
        {list.isPending ? (
          <p role="status" className={styles.listNote}>
            {t('common.loading')}
          </p>
        ) : list.isError ? (
          <div className={styles.listNote}>
            <ProblemMessage code={problemCode(list.error)} onRetry={() => void list.refetch()} />
          </div>
        ) : items.length === 0 ? (
          <p className={`${styles.muted} ${styles.listNote}`}>{t('sessions.empty')}</p>
        ) : (
          <SessionTable items={items} />
        )}
      </section>
    </div>
  );
}

/** Sessionliste (AP-26a): sortierbar per Spaltenkopf, Nebenspalten weichen bei wenig Platz. */
function SessionTable({ items }: { items: readonly NightSession[] }) {
  const { t } = useTranslation();
  const columns: DataColumn<NightSession>[] = [
    {
      id: 'night',
      header: t('sessions.col.night'),
      sortValue: (s) => s.night,
      nowrap: true,
      cell: (s) => (
        <>
          <Link to={`${SESSIONS_PATH}/${s.id}`}>{formatNightKey(s.night)}</Link>
          {s.createdOffline ? (
            <>
              {' '}
              <span className={styles.pill}>{t('sessions.offline')}</span>
            </>
          ) : null}
        </>
      ),
    },
    {
      id: 'rig',
      header: t('sessions.col.rig'),
      sortValue: (s) => s.rigName,
      priority: 2,
      cell: (s) => s.rigName,
    },
    {
      id: 'status',
      header: t('sessions.col.status'),
      sortValue: (s) => s.status,
      cell: (s) => <StatusBadge kind="session" value={s.status} />,
    },
    {
      id: 'time',
      header: t('sessions.col.time'),
      sortValue: (s) => s.startedAt,
      priority: 3,
      cell: (s) => <SessionTime session={s} />,
    },
    {
      id: 'frames',
      header: t('sessions.col.frames'),
      sortValue: (s) => s.frames,
      priority: 2,
      align: 'end',
      cell: (s) => s.frames,
    },
    {
      id: 'integration',
      header: t('sessions.col.integration'),
      sortValue: (s) => s.integrationS,
      priority: 2,
      align: 'end',
      nowrap: true,
      cell: (s) => t('sessions.hours', { h: hours(s.integrationS) }),
    },
    {
      id: 'unassigned',
      header: t('sessions.col.unassigned'),
      sortValue: (s) => s.unassigned,
      priority: 3,
      align: 'end',
      cell: (s) => (s.unassigned > 0 ? <span className={styles.pillWarn}>{s.unassigned}</span> : 0),
    },
    {
      id: 'reviewed',
      header: t('sessions.col.reviewed'),
      sortValue: (s) => s.reviewed,
      priority: 2,
      cell: (s) => (
        <span className={s.reviewed ? styles.pillOk : styles.pillWarn}>
          {s.reviewed ? t('sessions.reviewedYes') : t('sessions.reviewedNo')}
        </span>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={items}
      rowKey={(s) => s.id}
      rowLabel={(s) => `${formatNightKey(s.night)} · ${s.rigName}`}
      label={t('sessions.title')}
    />
  );
}
