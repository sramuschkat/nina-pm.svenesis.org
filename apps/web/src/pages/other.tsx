/** Startseite im Mandanten bzw. System, Datenschutz, Quellen, 404. */
import { privacyMarkdown, sourcesMarkdown, type Language } from '@nina-pm/i18n';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth, useCan } from '../auth';
import { Markdown } from '../components/Markdown';
import { TextLayout } from '../layout/Frame';
import styles from './pages.module.css';

/**
 * Startseite nach der Anmeldung (FK 14.3 S-02, FK 11 R1): bis „Heute Nacht“ (R3) verlinkt sie „Meine
 * Objekte“ (User) bzw. die Projektliste (Admin); beide Seiten sind bis zu ihren Paketen Platzhalter.
 */
export function HomePage() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const isAdmin = useCan('project.status');
  const system = me?.context === 'system';
  const start = isAdmin ? START_LINKS.projects : START_LINKS.myObjects;
  return (
    <section className={styles.panel}>
      <h1>{t('home.title')}</h1>
      <p className={styles.lead}>{t('home.intro')}</p>
      <div className={styles.note}>
        <h2>
          {system ? t('home.systemTitle') : t('home.tenantTitle', { name: me?.tenant?.name ?? '' })}
        </h2>
        <p>{system ? t('home.systemIntro') : t('home.tenantIntro')}</p>
      </div>
      {system ? null : (
        <ul className={styles.cards}>
          <li>
            <Link className={styles.cardLink} to={start.path}>
              <span className={styles.cardTitle}>{t(start.title)}</span>
              <span className={styles.cardMeta}>{t(start.hint)}</span>
            </Link>
          </li>
        </ul>
      )}
    </section>
  );
}

export const START_LINKS = {
  myObjects: {
    path: '/projekte/meine-objekte',
    title: 'startLinks.myObjects.title',
    hint: 'startLinks.myObjects.hint',
  },
  projects: {
    path: '/projekte',
    title: 'startLinks.projects.title',
    hint: 'startLinks.projects.hint',
  },
} as const;

const lang = (l: string): Language => (l === 'en' ? 'en' : 'de');

export function PrivacyPage() {
  const { t, i18n } = useTranslation();
  return (
    <TextLayout crumbs={[{ label: t('legal.privacyTitle') }]}>
      <h1>{t('legal.privacyTitle')}</h1>
      <p className={styles.draft}>{t('legal.draftNote')}</p>
      <div className={styles.contentBox}>
        <Markdown>{privacyMarkdown[lang(i18n.language)]}</Markdown>
      </div>
    </TextLayout>
  );
}

export function SourcesPage() {
  const { t, i18n } = useTranslation();
  return (
    <TextLayout crumbs={[{ label: t('legal.sourcesTitle') }]}>
      <h1>{t('legal.sourcesTitle')}</h1>
      <div className={styles.contentBox}>
        <Markdown>{sourcesMarkdown[lang(i18n.language)]}</Markdown>
      </div>
    </TextLayout>
  );
}

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <TextLayout>
      <h1>{t('errors.resource.notFound')}</h1>
      <p>
        <Link to="/">{t('common.back')}</Link>
      </p>
    </TextLayout>
  );
}
