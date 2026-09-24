/**
 * Kopf und Fuß im Stil von www.svenesis.org (TK 11.3, FA-WEB-01/03/04): eigene Umsetzung, keine
 * Laufzeit-Einbindung der Website. `SvenesisHeader` mit Logo (Link zur Website), Anwendungsname,
 * Website-Menü als externe Links und DE/EN; `SvenesisFooter` mit Impressum-Link und eigenen Seiten.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { CONTACT_PATH, siteHref, SITE_NAV, WEBSITE } from './site-nav';
import styles from './layout.module.css';

/** Platzhalter-Logo bis zur Übernahme von `img/logo.svg` der Website (H-16). */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false">
      <circle cx="16" cy="16" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <ellipse
        cx="16"
        cy="16"
        rx="15"
        ry="5"
        fill="none"
        stroke="var(--npm-accent)"
        strokeWidth="2"
        transform="rotate(-20 16 16)"
      />
      <circle cx="16" cy="16" r="3" fill="currentColor" />
    </svg>
  );
}

export function SvenesisHeader() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  return (
    <header className={styles.siteHeader}>
      <div className={styles.siteHeaderInner}>
        <a
          href={`${WEBSITE}/index_${lang === 'en' ? 'en' : 'de'}.html`}
          className={styles.logo}
          aria-label={t('header.websiteLink')}
        >
          <LogoMark />
          <span>Svenesis.org</span>
        </a>
        <Link to="/" className={styles.appName}>
          {t('common.appName')}
        </Link>
        <nav className={styles.siteNav} aria-label="Svenesis.org">
          {SITE_NAV.map((l) => (
            <a key={l.path} href={siteHref(l.path, lang)}>
              {t(l.labelKey)}
            </a>
          ))}
        </nav>
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
      </div>
    </header>
  );
}

export function SvenesisFooter() {
  const { t, i18n } = useTranslation();
  return (
    <footer className={styles.siteFooter}>
      <p>{t('footer.copyright')}</p>
      <div className={styles.footerLinks}>
        <a href={siteHref(CONTACT_PATH, i18n.language)}>{t('footer.contact')}</a>
        <Link to="/datenschutz">{t('footer.privacy')}</Link>
        <Link to="/quellen">{t('footer.sources')}</Link>
      </div>
    </footer>
  );
}

export function Breadcrumbs({ items }: { items: readonly { label: string; to?: string }[] }) {
  const { t } = useTranslation();
  return (
    <nav className={styles.breadcrumb} aria-label="Breadcrumb">
      <a href={WEBSITE}>{t('header.breadcrumbHome')}</a>
      <span aria-hidden>›</span>
      <span>{t('header.breadcrumbAstronomy')}</span>
      <span aria-hidden>›</span>
      <Link to="/">{t('common.appName')}</Link>
      {items.map((item) => (
        <span key={item.label} className={styles.crumb}>
          <span aria-hidden>›</span>
          {item.to ? (
            <Link to={item.to}>{item.label}</Link>
          ) : (
            <span aria-current="page">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

/**
 * Textseiten (Login, Mandantenauswahl, Einladung, Kein Zugang, Datenschutz, Quellen): einzige Ausnahme
 * von der vollen Fensterbreite – Container `--npm-max-width` (TK 11.3, UI-1).
 */
export function TextLayout({
  children,
  crumbs = [],
}: {
  children: ReactNode;
  crumbs?: readonly { label: string; to?: string }[];
}) {
  return (
    <>
      <SvenesisHeader />
      <Breadcrumbs items={crumbs} />
      <main className={styles.textMain} id="main">
        {children}
      </main>
      <SvenesisFooter />
    </>
  );
}
