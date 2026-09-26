/**
 * Bereich „Projekte“ (FK 14.2): Seitengerüst `PageHeader` (Stilsystem AP-26d) mit Titel, Metazeile und
 * Hauptaktion *Neues Projekt* rechts, darunter die Reiter Projektliste (S-30) · Meine Objekte (S-32) ·
 * Warteschlange (S-33, alle Mitglieder) · Entwürfe (S-34, nur Admin).
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCan } from '../../auth';
import { ICON_SIZE, actionIcons } from '../../components/icons';
import { PageHeader } from '../../components/PageHeader';
import { SectionTabs } from '../admin/shared';
import { useUniformWidth } from '../../lib/use-uniform-width';
import styles from './projects.module.css';

export const PROJECT_AREA = {
  list: '/projekte',
  mine: '/projekte/meine-objekte',
  queue: '/projekte/warteschlange',
  drafts: '/projekte/entwuerfe',
  create: '/projekte/neu',
} as const;

export function ProjectsLayout({
  title,
  meta,
  children,
}: {
  title: string;
  /** Metazeile unter dem Titel (kurzer Hinweis zur Seite). */
  meta?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const canAdmin = useCan('queue.decide');
  const canCreate = useCan('project.create');
  return (
    <div className={styles.page}>
      <PageHeader
        title={title}
        meta={meta}
        actions={
          canCreate ? (
            <Link to={PROJECT_AREA.create} className={styles.buttonPrimary}>
              <actionIcons.add size={ICON_SIZE.button} aria-hidden />
              {t('projectEditor.new')}
            </Link>
          ) : undefined
        }
        nav={
          <SectionTabs
            label={t('projectArea.tabs')}
            tabs={[
              { to: PROJECT_AREA.list, label: t('projectArea.list') },
              { to: PROJECT_AREA.mine, label: t('projectArea.mine') },
              { to: PROJECT_AREA.queue, label: t('projectArea.queue') },
              ...(canAdmin ? [{ to: PROJECT_AREA.drafts, label: t('projectArea.drafts') }] : []),
            ]}
          />
        }
      />
      <UniformChips>{children}</UniformChips>
    </div>
  );
}

/** Filtermarken in *Plan je Filter* und den Plan-Chips der Warteschlange. */
const CHIP_SELECTOR = `.${styles.filterPlan} > li > :first-child, .${styles.planChips} > li > :first-child`;

/**
 * Alle Filtermarken der Seite so breit wie die breiteste (Wunsch Sven 26.09.2026), als CSS-Variable
 * `--plan-chip-w` (`useUniformWidth`). `display: contents` – die Hülle ändert das Layout nicht.
 */
function UniformChips({ children }: { children: ReactNode }) {
  const ref = useUniformWidth(CHIP_SELECTOR, '--plan-chip-w');
  return (
    <div ref={ref} className={styles.chipScope}>
      {children}
    </div>
  );
}
