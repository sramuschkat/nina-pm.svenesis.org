/**
 * Planung (FK 14.2): Reiter Objektbrowser (S-21), Sternkarte (S-20) und Exoplaneten (S-22, AP-42) – Objektbrowser
 * zuerst (Wunsch Sven 27.09.2026).
 */
import { useTranslation } from 'react-i18next';
import { SectionTabs } from '../admin/shared';
import { CATALOG_PATH } from '../catalog/model';
import { EXO_PATH } from '../exo/model';
import { SKYMAP_PATH } from './skymap/model';

export function PlanningTabs() {
  const { t } = useTranslation();
  return (
    <SectionTabs
      label={t('skymap.tabsLabel')}
      tabs={[
        { to: CATALOG_PATH, label: t('skymap.tab.objects') },
        { to: SKYMAP_PATH, label: t('skymap.tab.skymap') },
        { to: EXO_PATH, label: t('skymap.tab.exoplanets') },
      ]}
    />
  );
}
