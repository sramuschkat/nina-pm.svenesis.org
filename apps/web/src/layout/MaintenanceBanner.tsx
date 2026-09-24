/** Wartungshinweis für alle (FA-SU-08): öffentlich über `GET /api/banner`, in der Sprache der Oberfläche. */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { ICON_SIZE, actionIcons } from '../components/icons';
import styles from './layout.module.css';

export function MaintenanceBanner() {
  const { t, i18n } = useTranslation();
  const query = useQuery({
    queryKey: ['banner'],
    queryFn: () => api.banner(),
    staleTime: 60_000,
    retry: false,
  });
  const banner = query.data?.banner;
  if (!banner) return null;
  return (
    <div className={styles.mfaBanner} role="status" aria-label={t('banner.label')}>
      <actionIcons.warning size={ICON_SIZE.button} aria-hidden />
      <span>{i18n.language === 'en' ? banner.en : banner.de}</span>
    </div>
  );
}
