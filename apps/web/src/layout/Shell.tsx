/**
 * Rahmen der Arbeitsseiten (FK 14.1, TK 11.3, AP-26c): **eine** Kopfleiste (Logo, NINA-PM, Mandant,
 * Menü *Svenesis.org* mit den Website-Links, Glocke, Theme, Benutzer, DE/EN), einklappbare linke
 * Navigation – unter 1024 px nur Symbole, per Knopf als Überlagerung aufklappbar –, Arbeitsbereich
 * **ohne Breitenobergrenze**, App-Fußleiste mit Dichte-Schalter, Svenesis-Fuß. Textseiten behalten den
 * Website-Kopf (`TextLayout`).
 */
import { ENGINE_VERSION } from '@nina-pm/engine';
import { DENSITIES, type Density } from '@nina-pm/ui-tokens';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import { ADMIN_PATHS } from '../pages/admin/AdminLayout';
import { SKYMAP_PATH } from '../pages/planning/skymap/model';
import { WEATHER_PATH } from '../pages/weather/model';
import { EQUIPMENT_PATHS } from '../pages/equipment/shared';
import { SYSTEM_PATHS } from '../pages/system/SystemLayout';
import { api, memberApi } from '../api/client';
import { useAppearance } from '../app/theme';
import { useAuth, useCan } from '../auth';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { actionIcons, areaIcons, ICON_SIZE, uiIcons } from '../components/icons';
import { LogoMark } from './Frame';
import { MaintenanceBanner } from './MaintenanceBanner';
import { NotificationBell } from './NotificationBell';
import { CONTACT_PATH, siteHref, SITE_NAV, WEBSITE } from './site-nav';
import styles from './layout.module.css';

const DENSITY_LABEL: Record<Density, string> = {
  compact: 'footer.densityCompact',
  normal: 'footer.densityNormal',
  wide: 'footer.densityWide',
};

/** Unter dieser Breite ist die Navigation eingeklappt und öffnet als Überlagerung (AP-26c). */
const NARROW = '(max-width: 1023px)';

function useNarrow(): boolean {
  const query =
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(NARROW) : null;
  const [narrow, setNarrow] = useState(query?.matches ?? false);
  useEffect(() => {
    if (!query) return undefined;
    const onChange = () => setNarrow(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [query]);
  return narrow;
}

export function Shell({ children }: { children: ReactNode }) {
  const narrow = useNarrow();
  const [collapsed, setCollapsed] = useState(false);
  const [overlay, setOverlay] = useState(false);
  const location = useLocation();
  // Seitenwechsel oder breites Fenster schließen die Überlagerung, ebenso `Esc`.
  useEffect(() => setOverlay(false), [location.pathname, narrow]);
  useEffect(() => {
    if (!overlay) return undefined;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOverlay(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlay]);
  return (
    <>
      <AppBar />
      <MaintenanceBanner />
      <MfaBanner />
      <div className={styles.work}>
        <SideNav
          collapsed={narrow ? !overlay : collapsed}
          overlay={narrow && overlay}
          onToggle={() => (narrow ? setOverlay((o) => !o) : setCollapsed((c) => !c))}
        />
        {narrow && overlay ? (
          <div className={styles.scrim} aria-hidden="true" onClick={() => setOverlay(false)} />
        ) : null}
        <main className={styles.workMain} id="main">
          {children}
        </main>
      </div>
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
  const { t, i18n } = useTranslation();
  const { me, refresh } = useAuth();
  const { theme, setTheme, density, setDensity } = useAppearance();
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
    <header className={styles.appBar}>
      <a
        href={`${WEBSITE}/index_${i18n.language === 'en' ? 'en' : 'de'}.html`}
        className={styles.appBarLogo}
        aria-label={t('header.websiteLink')}
        title={t('header.websiteLink')}
      >
        <LogoMark size={24} />
      </a>
      <Link to="/" className={styles.appBarName}>
        {t('common.appName')}
      </Link>
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
      <SiteMenu />
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
            {/* Dichte (TK 11.3) im Benutzermenü statt eigener Fußleiste (AP-26d). */}
            <DropdownMenu.Label className={styles.menuLabel}>
              {t('footer.density')}
            </DropdownMenu.Label>
            <DropdownMenu.RadioGroup
              value={density}
              onValueChange={(v) => setDensity(v as Density)}
            >
              {DENSITIES.map((d) => (
                <DropdownMenu.RadioItem key={d} value={d} className={styles.menuItem}>
                  <DropdownMenu.ItemIndicator className={styles.menuIndicator}>
                    <uiIcons.ok size={ICON_SIZE.table} aria-hidden />
                  </DropdownMenu.ItemIndicator>
                  {t(DENSITY_LABEL[d])}
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
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
      <LangSwitch />
    </header>
  );
}

/** Website-Links (TK 11.3) als Menü *Svenesis.org* – eine Kopfleiste statt zwei (AP-26c). */
function SiteMenu() {
  const { t, i18n } = useTranslation();
  const Chevron = uiIcons.menu;
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger className={styles.siteMenuButton}>
        Svenesis.org
        <Chevron size={ICON_SIZE.table} aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={styles.menu} align="end" sideOffset={6}>
          {SITE_NAV.map((l) => (
            <DropdownMenu.Item key={l.path} className={styles.menuItem} asChild>
              <a href={siteHref(l.path, i18n.language)}>{t(l.labelKey)}</a>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function LangSwitch() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  return (
    <div className={styles.langSwitch} role="group" aria-label={t('header.language')}>
      {(['de', 'en'] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          className={lang === l ? styles.langActive : undefined}
          onClick={() => void i18n.changeLanguage(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
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
function SideNav({
  collapsed,
  overlay,
  onToggle,
}: {
  collapsed: boolean;
  /** Schmales Fenster, aufgeklappt: liegt über dem Inhalt; `Esc`, Klick daneben oder Seitenwechsel schließen. */
  overlay: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const location = useLocation();
  const canAdmin = useCan('member.manage');
  const system = me?.context === 'system';
  // Gruppen der Navigation (Stilsystem AP-26d): Planen · Betrieb · Einrichten; System allein.
  const groups: { key: string; areas: NavArea[] }[] = [
    {
      key: 'plan',
      areas: [
        { key: 'tonight', visible: !system },
        { key: 'planning', visible: !system, to: SKYMAP_PATH },
        { key: 'projects', visible: !system, to: '/projekte' },
      ],
    },
    {
      key: 'operate',
      areas: [
        { key: 'nina', visible: !system, to: '/nina/simulator' },
        { key: 'weather', visible: !system, to: WEATHER_PATH },
        { key: 'evaluation', visible: !system, to: '/auswertung/sessions' },
      ],
    },
    {
      key: 'setup',
      areas: [
        { key: 'equipment', visible: !system, to: EQUIPMENT_PATHS.rigs },
        { key: 'administration', visible: !system && canAdmin, to: ADMIN_PATHS.members },
      ],
    },
    { key: 'system', areas: [{ key: 'system', visible: system, to: SYSTEM_PATHS.tenants }] },
  ];
  const Toggle = collapsed ? uiIcons.expand : uiIcons.collapse;
  const section = (to: string) => `/${to.split('/')[1] ?? ''}`;
  return (
    <nav
      className={[
        styles.sideNav,
        collapsed ? styles.sideNavCollapsed : '',
        overlay ? styles.sideNavOverlay : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={t('nav.label')}
    >
      {groups.map((g) => {
        const visible = g.areas.filter((a) => a.visible);
        if (visible.length === 0) return null;
        const headingId = `nav-group-${g.key}`;
        return (
          <div key={g.key} className={styles.navGroup}>
            {g.key !== 'system' ? (
              <span id={headingId} className={styles.navGroupLabel}>
                {t(`nav.group.${g.key}`)}
              </span>
            ) : null}
            <ul aria-labelledby={g.key !== 'system' ? headingId : undefined}>
              {visible.map((a) => {
                const Icon = areaIcons[a.key];
                return (
                  <li key={a.key}>
                    {a.to ? (
                      <Link
                        to={a.to}
                        className={styles.navItem}
                        title={t(`nav.${a.key}`)}
                        aria-current={
                          location.pathname.startsWith(section(a.to)) ? 'page' : undefined
                        }
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
          </div>
        );
      })}
      <div className={styles.navFoot}>
        <button
          type="button"
          className={styles.navToggle}
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
          title={collapsed ? t('nav.expand') : t('nav.collapse')}
        >
          <Toggle size={ICON_SIZE.button} aria-hidden />
          <span className={styles.navLabel}>{t('nav.collapseShort')}</span>
        </button>
        <NavFootLinks />
      </div>
    </nav>
  );
}

/** Rechtliches und Version unten in der Seitenleiste statt zweier Fußleisten (AP-26d). */
function NavFootLinks() {
  const { t, i18n } = useTranslation();
  return (
    <div className={styles.navLegal}>
      <span>
        <a href={siteHref(CONTACT_PATH, i18n.language)}>{t('nav.imprint')}</a>
        {' · '}
        <Link to="/datenschutz">{t('nav.privacy')}</Link>
        {' · '}
        <Link to="/quellen">{t('nav.sources')}</Link>
      </span>
      <span>{t('footer.version', { app: __BUILD_ID__.slice(0, 7), engine: ENGINE_VERSION })}</span>
    </div>
  );
}
