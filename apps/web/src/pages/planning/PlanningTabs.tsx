/** Planung (FK 14.2): Reiter Sternkarte (S-20) und Objektbrowser (S-21). */
import { useTranslation } from 'react-i18next';
import { SectionTabs } from '../admin/shared';
import { CATALOG_PATH } from '../catalog/model';
import { SKYMAP_PATH } from './skymap/model';

export function PlanningTabs() {
  const { t } = useTranslation();
  return (
    <SectionTabs
      label={t('skymap.tabsLabel')}
      tabs={[
        { to: SKYMAP_PATH, label: t('skymap.tab.skymap') },
        { to: CATALOG_PATH, label: t('skymap.tab.objects') },
      ]}
    />
  );
}
