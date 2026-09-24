/**
 * Bereich „Projekte“ (FK 14.2): Reiter Projektliste (S-30) · Meine Objekte (S-32) · Warteschlange
 * (S-33, alle Mitglieder) · Entwürfe (S-34, nur Admin), dazu Überschrift und *Neues Projekt*.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCan } from '../../auth';
import { ICON_SIZE, actionIcons } from '../../components/icons';
import { SectionTabs } from '../admin/shared';
import styles from './projects.module.css';

export const PROJECT_AREA = {
  list: '/projekte',
  mine: '/projekte/meine-objekte',
  queue: '/projekte/warteschlange',
  drafts: '/projekte/entwuerfe',
  create: '/projekte/neu',
} as const;

export function ProjectsLayout({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation();
  const canAdmin = useCan('queue.decide');
  const canCreate = useCan('project.create');
  return (
    <div className={styles.page}>
      <SectionTabs
        label={t('projectArea.tabs')}
        tabs={[
          { to: PROJECT_AREA.list, label: t('projectArea.list') },
          { to: PROJECT_AREA.mine, label: t('projectArea.mine') },
          { to: PROJECT_AREA.queue, label: t('projectArea.queue') },
          ...(canAdmin ? [{ to: PROJECT_AREA.drafts, label: t('projectArea.drafts') }] : []),
        ]}
      />
      <div className={styles.head}>
        <h1>{title}</h1>
        {canCreate ? (
          <div className={styles.headActions}>
            <Link to={PROJECT_AREA.create} className={styles.buttonPrimary}>
              <actionIcons.add size={ICON_SIZE.button} aria-hidden />
              {t('projectEditor.new')}
            </Link>
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}
