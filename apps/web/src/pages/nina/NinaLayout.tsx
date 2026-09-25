/**
 * NINA-Bereich (FK 14.2/14.3): Reiter Nacht-Simulator (S-40), „An NINA ausgeliefert“ (S-41) und
 * NINA-Instanzen & Tokens (S-42, nur Admin/Owner). Die API prüft die Rechte erneut.
 */
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { useCan } from '../../auth';
import { SectionTabs } from '../admin/shared';

export const NINA_PATHS = {
  simulator: '/nina/simulator',
  delivery: '/nina/ausgeliefert',
  instances: '/nina/instanzen',
} as const;

export function NinaLayout() {
  const { t } = useTranslation();
  const canManage = useCan('nina.instance.manage');
  return (
    <>
      <SectionTabs
        label={t('nina.tabsLabel')}
        tabs={[
          { to: NINA_PATHS.simulator, label: t('nina.tab.simulator') },
          { to: NINA_PATHS.delivery, label: t('nina.tab.delivery') },
          ...(canManage ? [{ to: NINA_PATHS.instances, label: t('nina.tab.instances') }] : []),
        ]}
      />
      <Outlet />
    </>
  );
}
