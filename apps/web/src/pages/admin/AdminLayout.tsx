/**
 * Administration im Mandanten (S-70…S-72): Seitengerüst `PageHeader` (Stilsystem AP-26d) mit Titel,
 * Aktionen rechts und den Bereichsreitern darunter; sichtbar für Admins und den Owner.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../components/PageHeader';
import styles from './admin.module.css';
import { SectionTabs } from './shared';

export const ADMIN_PATHS = {
  members: '/verwaltung/mitglieder',
  settings: '/verwaltung/einstellungen',
  discord: '/verwaltung/discord',
  log: '/verwaltung/protokoll',
} as const;

export function AdminLayout({
  title,
  actions,
  children,
}: {
  title: string;
  /** Knöpfe rechts neben der Überschrift (z. B. Dialoge öffnen, AP-26b). */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.page}>
      <PageHeader
        title={title}
        actions={actions}
        nav={
          <SectionTabs
            label={t('admin.tabsLabel')}
            tabs={[
              { to: ADMIN_PATHS.members, label: t('admin.members.tab') },
              { to: ADMIN_PATHS.settings, label: t('admin.settings.tab') },
              { to: ADMIN_PATHS.discord, label: t('admin.discord.tab') },
              { to: ADMIN_PATHS.log, label: t('admin.log.tab') },
            ]}
          />
        }
      />
      {children}
    </div>
  );
}
