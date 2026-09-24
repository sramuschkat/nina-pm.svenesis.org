/**
 * Menü der Website als externe Links (TK 11.3), einmalig aus der Website-Vorlage übernommen
 * (legacy/astro-tools-2026-09-21/astro-weather_de.html, Stand 21.09.2026). Keine Laufzeit-Einbindung.
 */
export const WEBSITE = 'https://www.svenesis.org';

export interface SiteLink {
  /** i18n-Schlüssel unter `header.*`. */
  labelKey: string;
  /** Pfad ohne Sprachendung; `_de.html`/`_en.html` wird angehängt. */
  path: string;
}

export const SITE_NAV: readonly SiteLink[] = [
  { labelKey: 'header.siteHome', path: '/index' },
  { labelKey: 'header.siteAbout', path: '/about/about' },
  { labelKey: 'header.siteTech', path: '/technologien/software-archiv' },
  { labelKey: 'header.siteFinance', path: '/finance/portfolio-wizard' },
  { labelKey: 'header.siteAstronomy', path: '/astronomy/equipment' },
  { labelKey: 'header.siteBlog', path: '/blog/blog' },
];

export function siteHref(path: string, lang: string): string {
  return `${WEBSITE}${path}_${lang === 'en' ? 'en' : 'de'}.html`;
}

export const CONTACT_PATH = '/contact/contact';
