/**
 * Wikipedia-Link je Katalogobjekt wie im Beobachtungsplaner der Vorlage (FA-FRM-14, dso-import.md §2): die
 * Titel aus dem Website-Auszug liegen in `openngc/wikipedia.json` (nicht in `dso_object`) und werden als
 * eigener Teil einmal nachgeladen; bis dahin und ohne Artikel führt der Link zur Wikipedia-Suche.
 */
import { wikipediaLink, type WikipediaEntry } from '@nina-pm/shared';
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { actionIcons, ICON_SIZE } from '../../components/icons';

type Titles = Readonly<Record<string, WikipediaEntry>>;

const loadTitles = () =>
  import('@nina-pm/catalog-data/openngc/wikipedia.json').then(
    (m) => m.default as unknown as Titles,
  );

export interface WikiTarget {
  /** `null`, wenn das Ziel keine Katalogzeile ist (freies Ziel im Projekt) – dann die Suche. */
  readonly primaryId: string | null;
  readonly displayName: string;
}

/** Link, Beschriftung und Zugänglichkeitsname in der Sprache der Oberfläche. */
export function useWikipedia() {
  const { t, i18n } = useTranslation();
  const titles = useQuery({
    queryKey: ['catalog', 'wikipedia'],
    queryFn: loadTitles,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const lang = i18n.language === 'en' ? 'en' : 'de';
  return useCallback(
    (o: WikiTarget) => {
      const link = wikipediaLink(
        o.primaryId === null ? undefined : titles.data?.[o.primaryId],
        o.primaryId ?? o.displayName,
        o.displayName,
        lang,
      );
      const other = link.lang !== lang ? link.lang.toUpperCase() : null;
      return {
        href: link.href,
        label: other ? t('catalog.wikipediaIn', { lang: other }) : t('catalog.wikipedia'),
        title: link.search
          ? t('catalog.wikipediaSearch', { name: o.displayName })
          : other
            ? t('catalog.wikipediaForIn', { name: o.displayName, lang: other })
            : t('catalog.wikipediaFor', { name: o.displayName }),
      };
    },
    [titles.data, lang, t],
  );
}

/** Ausgeschriebener Link mit Symbol für ein externes Ziel; `className` für Knopf- oder Textform. */
export function WikipediaLink({ target, className }: { target: WikiTarget; className?: string }) {
  const wiki = useWikipedia()(target);
  return (
    <a
      className={className}
      href={wiki.href}
      target="_blank"
      rel="noopener noreferrer"
      title={wiki.title}
      aria-label={wiki.title}
    >
      {wiki.label}
      <actionIcons.external size={ICON_SIZE.table} aria-hidden />
    </a>
  );
}
