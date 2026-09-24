/** Administration im Mandanten (S-70…S-72): Reiter, sichtbar für Admins und den Owner. */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './admin.module.css';
import { SectionTabs } from './shared';

export const ADMIN_PATHS = {
  members: '/verwaltung/mitglieder',
  settings: '/verwaltung/einstellungen',
  log: '/verwaltung/protokoll',
} as const;

export function AdminLayout({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className={styles.page}>
      <SectionTabs
        label={t('admin.tabsLabel')}
        tabs={[
          { to: ADMIN_PATHS.members, label: t('admin.members.tab') },
          { to: ADMIN_PATHS.settings, label: t('admin.settings.tab') },
          { to: ADMIN_PATHS.log, label: t('admin.log.tab') },
        ]}
      />
      <div className={styles.head}>
        <h1>{title}</h1>
      </div>
      {children}
    </div>
  );
}
