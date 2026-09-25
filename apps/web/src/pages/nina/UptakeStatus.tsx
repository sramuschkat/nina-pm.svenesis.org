/**
 * Übernahmestatus in NINA (FA-SIM-09; S-40 rechts über Schritt 1, S-10 beim Rig): je aktiver Instanz
 * „v12 übernommen 17.09.2026 13:02 CDT“ bzw. „Änderung noch nicht abgerufen“, wenn die Einstellungsversion
 * des Rigs neuer ist. Zeiten in Standortzeit mit Kürzel (NT-03).
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ninaApi, type NinaInstance } from '../../api/client';
import { ProblemMessage } from '../../components/ProblemMessage';
import { formatDateTime } from '../../lib/time';
import { problemCode } from '../admin/shared';
import styles from './nina.module.css';

export const ninaInstancesKey = (rigId?: string) => ['nina-instances', rigId ?? 'all'] as const;

export function uptakeText(
  i: NinaInstance,
  t: (k: string, o?: Record<string, unknown>) => string,
  lang: string,
): { text: string; current: boolean } {
  if (i.settingsVersionFetched === null || i.settingsFetchedAt === null)
    return { text: t('nina.uptake.never'), current: false };
  const at = formatDateTime(i.settingsFetchedAt, i.siteTimeZone, lang);
  if (i.settingsVersionFetched < i.rigSettingsVersion)
    return {
      text: t('nina.uptake.pending', {
        current: i.rigSettingsVersion,
        version: i.settingsVersionFetched,
        at,
      }),
      current: false,
    };
  return { text: t('nina.uptake.taken', { version: i.settingsVersionFetched, at }), current: true };
}

export function UptakeStatus({
  rigId,
  settingsVersion,
}: {
  rigId: string;
  settingsVersion: number;
}) {
  const { t, i18n } = useTranslation();
  const list = useQuery({
    queryKey: ninaInstancesKey(rigId),
    queryFn: async () => (await ninaApi.instances(rigId)).items,
  });
  const active = (list.data ?? []).filter((i) => i.status === 'active');
  return (
    <div>
      <p>{t('nina.uptake.version', { version: settingsVersion })}</p>
      {list.isPending ? (
        <p role="status" className={styles.muted}>
          {t('common.loading')}
        </p>
      ) : list.isError ? (
        <ProblemMessage code={problemCode(list.error)} onRetry={() => void list.refetch()} />
      ) : active.length === 0 ? (
        <p className={styles.muted}>{t('nina.uptake.none')}</p>
      ) : (
        <ul className={styles.uptake} aria-label={t('nina.uptake.title')}>
          {active.map((i) => {
            const u = uptakeText(i, t, i18n.language);
            return (
              <li key={i.id}>
                <strong>{i.name}</strong>
                <span className={u.current ? styles.pillOk : styles.pillWarn}>{u.text}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
