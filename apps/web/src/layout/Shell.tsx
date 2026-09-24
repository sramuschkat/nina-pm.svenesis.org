/**
 * Rahmen der Arbeitsseiten (FK 14.1, TK 11.3): Svenesis-Kopf, App-Leiste, einklappbare linke Navigation,
 * Arbeitsbereich **ohne Breitenobergrenze**, App-Fußleiste mit Dichte-Schalter, Svenesis-Fuß.
 */
import { ENGINE_VERSION } from '@nina-pm/engine';
import { DENSITIES, type Density } from '@nina-pm/ui-tokens';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import { ADMIN_PATHS } from '../pages/admin/AdminLayout';
import { EQUIPMENT_PATHS } from '../pages/equipment/shared';
import { SYSTEM_PATHS } from '../pages/system/SystemLayout';
import { api, memberApi } from '../api/client';
import { useAppearance } from '../app/theme';
import { useAuth, useCan } from '../auth';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { actionIcons, areaIcons, ICON_SIZE, uiIcons } from '../components/icons';
import { SvenesisFooter, SvenesisHeader } from './Frame';
import { MaintenanceBanner } from './MaintenanceBanner';
import { NotificationBell } from './NotificationBell';
import styles from './layout.module.css';

export function Shell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <>
      <SvenesisHeader />
      <AppBar />
      <MaintenanceBanner />
      <MfaBanner />
      <div className={styles.work}>
        <SideNav collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
        <main className={styles.workMain} id="main">
          {children}
        </main>
      </div>
      <AppFooter />
      <SvenesisFooter />
    </>
  );
}

/** Hinweis „Rechte ruhen – 2FA fehlt“ (SV-03, FA-LOG-07) statt stiller Ausblendung. */
function MfaBanner() {
  const { t } = useTranslation();
  const { me } = useAuth();
  if (!me?.mfaRequired) return null;
  return (
    <div className={styles.mfaBanner} role="status">
      <actionIcons.warning size={ICON_SIZE.button} aria-hidden />
      <span>{t('appBar.mfaBanner')}</span>
    </div>
  );
}

function AppBar() {
  const { t } = useTranslation();
  const { me, refresh } = useAuth();
  const { theme, setTheme } = useAppearance();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [confirmAll, setConfirmAll] = useState<'closed' | 'open' | 'loading' | 'error'>('closed');
  const [confirmLeave, setConfirmLeave] = useState<'closed' | 'open' | 'loading' | 'error'>(
    'closed',
  );
  if (!me) return null;
  const roleLabel =
    me.context === 'system'
      ? t('appBar.role.system')
      : me.member
        ? t(`appBar.role.${me.member.role}`)
        : '';
  const canSwitch = me.memberships.length > 1 || me.isSuperUser;
  const ThemeIcon = theme === 'dark' ? uiIcons.themeLight : uiIcons.themeDark;
  const UserIcon = uiIcons.user;
  const Chevron = uiIcons.menu;
  // Nach dem Abmelden: fachliche Daten verwerfen, `/auth/me` neu laden (→ anonym) und zur Einstiegsseite.
  const signedOut = async () => {
    client.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
    await refresh();
    await navigate('/');
  };
  return (
    <div className={styles.appBar}>
      <span className={styles.appBarName}>{t('common.appName')}</span>
      <span className={styles.tenant}>
        {me.context === 'system' ? t('appBar.system') : (me.tenant?.name ?? '')}
        {canSwitch ? (
          <Link
            to="/mandant-waehlen"
            className={styles.switch}
            aria-label={t('appBar.switchTenant')}
            title={t('appBar.switchTenant')}
          >
            <actionIcons.switchTenant size={ICON_SIZE.table} aria-hidden />
          </Link>
        ) : null}
      </span>
      <span className={styles.spacer} />
      {/* Benachrichtigungen gibt es nur im Mandanten (Empfänger ist ein Mitglied). */}
      {me.context === 'tenant' && me.tenant ? (
        <NotificationBell tenantTimeZone={me.tenant.timeZone} />
      ) : null}
      <button
        type="button"
        className={styles.iconButton}
        aria-label={theme === 'dark' ? t('appBar.themeLight') : t('appBar.themeDark')}
        title={theme === 'dark' ? t('appBar.themeLight') : t('appBar.themeDark')}
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      >
        <ThemeIcon size={ICON_SIZE.button} aria-hidden />
      </button>
      {/* modal={false}: Radix setzt sonst aria-hidden auf #root, obwohl der Auslöser fokussierbar bleibt (axe aria-hidden-focus). */}
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger className={styles.userButton} aria-label={t('appBar.userMenu')}>
          {me.identity.avatarHash ? (
            <img
              className={styles.avatar}
              src={`https://cdn.discordapp.com/avatars/${me.identity.discordUserId}/${me.identity.avatarHash}.png?size=64`}
              alt=""
              width={24}
              height={24}
            />
          ) : (
            <UserIcon size={ICON_SIZE.button} aria-hidden />
          )}
          <span className={styles.userName}>
            {me.member?.displayName ?? me.identity.globalName ?? me.identity.username}
          </span>
          {roleLabel ? <span className={styles.userRole}>({roleLabel})</span> : null}
          <Chevron size={ICON_SIZE.table} aria-hidden />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className={styles.menu} align="end" sideOffset={6}>
            {canSwitch ? (
              <DropdownMenu.Item
                className={styles.menuItem}
                onSelect={() => void navigate('/mandant-waehlen')}
              >
                {t('appBar.switchTenant')}
              </DropdownMenu.Item>
            ) : null}
            <DropdownMenu.Item
              className={styles.menuItem}
              onSelect={() => void navigate('/einstellungen')}
            >
              {t('appBar.sessions')}
            </DropdownMenu.Item>
            {me.context === 'tenant' && me.member && me.member.role !== 'owner' ? (
              <DropdownMenu.Item
                className={styles.menuItem}
                onSelect={() => setConfirmLeave('open')}
              >
                {t('appBar.leave')}
              </DropdownMenu.Item>
            ) : null}
            <DropdownMenu.Separator className={styles.menuSeparator} />
            <DropdownMenu.Item
              className={styles.menuItem}
              onSelect={() => {
                void api.logout().then(signedOut);
              }}
            >
              {t('appBar.logout')}
            </DropdownMenu.Item>
            <DropdownMenu.Item className={styles.menuItem} onSelect={() => setConfirmAll('open')}>
              {t('appBar.logoutEverywhere')}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <ConfirmDialog
        open={confirmLeave !== 'closed'}
        variant="danger"
        title={t('appBar.leaveTitle', { name: me.tenant?.name ?? '' })}
        consequence={t('appBar.leaveConsequence')}
        confirmLabel={t('appBar.leave')}
        state={
          confirmLeave === 'loading' ? 'loading' : confirmLeave === 'error' ? 'error' : 'ready'
        }
        errorKey="errors.internal.error"
        onCancel={() => setConfirmLeave('closed')}
        onConfirm={async () => {
          setConfirmLeave('loading');
          try {
            await memberApi.leave();
            setConfirmLeave('closed');
            await signedOut();
          } catch {
            setConfirmLeave('error');
          }
        }}
      />
      <ConfirmDialog
        open={confirmAll !== 'closed'}
        title={t('appBar.logoutEverywhereTitle')}
        consequence={t('appBar.logoutEverywhereConsequence')}
        confirmLabel={t('appBar.logoutEverywhereConfirm')}
        state={confirmAll === 'loading' ? 'loading' : confirmAll === 'error' ? 'error' : 'ready'}
        errorKey="errors.internal.error"
        onCancel={() => setConfirmAll('closed')}
        onConfirm={async () => {
          setConfirmAll('loading');
          try {
            await api.logoutEverywhere();
            setConfirmAll('closed');
            await signedOut();
          } catch {
            setConfirmAll('error');
          }
        }}
      />
    </div>
  );
}

interface NavArea {
  key: keyof typeof areaIcons;
  visible: boolean;
  /** Ziel, sobald der Bereich gebaut ist; sonst deaktiviert mit Hinweis. */
  to?: string;
}

/** Navigation nach FK 14.2; Fachbereiche folgen mit ihren Paketen (bis dahin deaktiviert mit Hinweis). */
function SideNav({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const location = useLocation();
  const canAdmin = useCan('member.manage');
  const system = me?.context === 'system';
  const areas: NavArea[] = [
    { key: 'tonight', visible: !system },
    { key: 'equipment', visible: !system, to: EQUIPMENT_PATHS.rigs },
    { key: 'planning', visible: !system },
    // Projektliste folgt mit AP-11c; bis dahin Platzhalter mit *Neues Projekt* und der Editor S-31.
    { key: 'projects', visible: !system, to: '/projekte' },
    { key: 'nina', visible: !system },
    { key: 'weather', visible: !system },
    { key: 'evaluation', visible: !system },
    { key: 'administration', visible: !system && canAdmin, to: ADMIN_PATHS.members },
    { key: 'system', visible: system, to: SYSTEM_PATHS.tenants },
  ];
  const Toggle = collapsed ? uiIcons.expand : uiIcons.collapse;
  const section = (to: string) => `/${to.split('/')[1] ?? ''}`;
  return (
    <nav
      className={`${styles.sideNav} ${collapsed ? styles.sideNavCollapsed : ''}`}
      aria-label={t('nav.label')}
    >
      <button
        type="button"
        className={styles.navToggle}
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
      >
        <Toggle size={ICON_SIZE.button} aria-hidden />
      </button>
      <ul>
        {areas
          .filter((a) => a.visible)
          .map((a) => {
            const Icon = areaIcons[a.key];
            return (
              <li key={a.key}>
                {a.to ? (
                  <Link
                    to={a.to}
                    className={styles.navItem}
                    title={t(`nav.${a.key}`)}
                    aria-current={location.pathname.startsWith(section(a.to)) ? 'page' : undefined}
                  >
                    <Icon size={ICON_SIZE.nav} aria-hidden />
                    <span className={styles.navLabel}>{t(`nav.${a.key}`)}</span>
                  </Link>
                ) : (
                  <span
                    className={styles.navItemDisabled}
                    aria-disabled="true"
                    title={`${t(`nav.${a.key}`)} – ${t('common.comingSoon')}`}
                  >
                    <Icon size={ICON_SIZE.nav} aria-hidden />
                    <span className={styles.navLabel}>{t(`nav.${a.key}`)}</span>
                  </span>
                )}
              </li>
            );
          })}
      </ul>
    </nav>
  );
}

function AppFooter() {
  const { t } = useTranslation();
  const { density, setDensity } = useAppearance();
  const labels: Record<Density, string> = {
    compact: t('footer.densityCompact'),
    normal: t('footer.densityNormal'),
    wide: t('footer.densityWide'),
  };
  const Help = uiIcons.help;
  return (
    <div className={styles.appFooter}>
      <div className={styles.density} role="radiogroup" aria-label={t('footer.density')}>
        <span className={styles.densityLabel}>{t('footer.density')}</span>
        {DENSITIES.map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={density === d}
            className={density === d ? styles.densityActive : undefined}
            onClick={() => setDensity(d)}
          >
            {labels[d]}
          </button>
        ))}
      </div>
      <span className={styles.spacer} />
      <span className={styles.version}>
        {t('footer.version', { app: __BUILD_ID__.slice(0, 7), engine: ENGINE_VERSION })}
      </span>
      <span className={styles.help} title={t('common.comingSoon')}>
        <Help size={ICON_SIZE.table} aria-hidden />
        {t('footer.help')}
      </span>
    </div>
  );
}
