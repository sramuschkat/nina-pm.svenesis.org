/**
 * Bereich „Projekte“ (FK 14.2): Seitengerüst `PageHeader` (Stilsystem AP-26d) mit Titel, Metazeile und
 * Hauptaktion *Neues Projekt* rechts, darunter die Reiter Projektliste (S-30) · Meine Objekte (S-32) ·
 * Warteschlange (S-33, alle Mitglieder) · Entwürfe (S-34, nur Admin).
 */
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCan } from '../../auth';
import { ICON_SIZE, actionIcons } from '../../components/icons';
import { PageHeader } from '../../components/PageHeader';
import { SectionTabs } from '../admin/shared';
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
 * Alle Filtermarken der Seite so breit wie die breiteste (Wunsch Sven 26.09.2026): gemessen nach dem
 * Zeichnen und bei jeder Änderung der Liste (Laden, Filtern, Sortieren), als CSS-Variable `--plan-chip-w`.
 * `display: contents` – die Hülle ändert das Layout nicht.
 */
function UniformChips({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let frame = 0;
    const measure = () => {
      frame = 0;
      el.style.removeProperty('--plan-chip-w');
      let max = 0;
      el.querySelectorAll<HTMLElement>(CHIP_SELECTOR).forEach((c) => {
        max = Math.max(max, c.getBoundingClientRect().width);
      });
      if (max > 0) el.style.setProperty('--plan-chip-w', `${String(Math.ceil(max))}px`);
    };
    measure();
    if (typeof MutationObserver === 'undefined') return undefined;
    const mo = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(measure);
    });
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div ref={ref} className={styles.chipScope}>
      {children}
    </div>
  );
}
