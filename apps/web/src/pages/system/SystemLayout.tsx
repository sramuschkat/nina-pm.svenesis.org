/**
 * System-Kontext (S-80…S-82): Seitengerüst `PageHeader` (Stilsystem AP-26d) mit Titel und den Reitern
 * Mandanten, Super User, Kataloge/Audit/Wartung darunter.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../components/PageHeader';
import styles from '../admin/admin.module.css';
import { SectionTabs } from '../admin/shared';

export const SYSTEM_PATHS = {
  tenants: '/system/mandanten',
  superUsers: '/system/super-user',
  audit: '/system/audit',
} as const;

export function SystemLayout({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className={styles.page}>
      <PageHeader
        title={title}
        nav={
          <SectionTabs
            label={t('system.tabsLabel')}
            tabs={[
              { to: SYSTEM_PATHS.tenants, label: t('system.tenants.tab') },
              { to: SYSTEM_PATHS.superUsers, label: t('system.superUsers.tab') },
              { to: SYSTEM_PATHS.audit, label: t('system.audit.tab') },
            ]}
          />
        }
      />
      {children}
    </div>
  );
}
