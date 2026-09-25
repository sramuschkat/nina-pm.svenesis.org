/**
 * S-60 Sessions (FK 14.3; FA-AUS-01, FA-AUS-07; AP-15): Liste je Rig und Nacht mit Status, Beginn–Ende
 * in Standortzeit mit Kürzel, Frames, Integration, Aufnahmen ohne Zuordnung und geprüft ja/nein; Filter
 * Rig und „nur ungeprüfte“. Effizienz und Wetterbewertung folgen mit den KPIs (R3) bzw. dem Wetter (R2).
 */
import { formatNightKey } from '@nina-pm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { sessionsApi, type NightSession } from '../../api/client';
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
      <nav aria-label={t('sessions.crumbs')} className={styles.muted}>
        {t('sessions.crumbs')}
      </nav>
      <div className={styles.head}>
        <h1>{t('sessions.title')}</h1>
      </div>
      <div className={styles.toolbar}>
        <div className={styles.field}>
          <label htmlFor="sessions-rig">{t('sessions.rig')}</label>
          <select
            id="sessions-rig"
            className={styles.input}
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
      <section className={styles.panel} aria-labelledby="sessions-list">
        <h2 id="sessions-list" className={styles.muted}>
          {t('sessions.title')}
        </h2>
        {list.isPending ? (
          <p role="status">{t('common.loading')}</p>
        ) : list.isError ? (
          <ProblemMessage code={problemCode(list.error)} onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <p className={styles.muted}>{t('sessions.empty')}</p>
        ) : (
          <div
            className={styles.tableWrap}
            tabIndex={0}
            role="region"
            aria-labelledby="sessions-list"
          >
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('sessions.col.night')}</th>
                  <th scope="col">{t('sessions.col.rig')}</th>
                  <th scope="col">{t('sessions.col.status')}</th>
                  <th scope="col">{t('sessions.col.time')}</th>
                  <th scope="col" className={styles.num}>
                    {t('sessions.col.frames')}
                  </th>
                  <th scope="col" className={styles.num}>
                    {t('sessions.col.integration')}
                  </th>
                  <th scope="col" className={styles.num}>
                    {t('sessions.col.unassigned')}
                  </th>
                  <th scope="col">{t('sessions.col.reviewed')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.id}>
                    <td className={styles.nowrap}>
                      <Link to={`${SESSIONS_PATH}/${s.id}`}>{formatNightKey(s.night)}</Link>
                      {s.createdOffline ? (
                        <>
                          {' '}
                          <span className={styles.pill}>{t('sessions.offline')}</span>
                        </>
                      ) : null}
                    </td>
                    <td>{s.rigName}</td>
                    <td>
                      <StatusBadge kind="session" value={s.status} />
                    </td>
                    <td>
                      <SessionTime session={s} />
                    </td>
                    <td className={styles.num}>{s.frames}</td>
                    <td className={styles.num}>
                      {t('sessions.hours', { h: hours(s.integrationS) })}
                    </td>
                    <td className={styles.num}>
                      {s.unassigned > 0 ? (
                        <span className={styles.pillWarn}>{s.unassigned}</span>
                      ) : (
                        0
                      )}
                    </td>
                    <td>
                      <span className={s.reviewed ? styles.pillOk : styles.pillWarn}>
                        {s.reviewed ? t('sessions.reviewedYes') : t('sessions.reviewedNo')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
