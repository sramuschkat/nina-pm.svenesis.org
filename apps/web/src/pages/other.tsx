/** Startseite im Mandanten bzw. System, Datenschutz, Quellen, 404. */
import { privacyMarkdown, sourcesMarkdown, type Language } from '@nina-pm/i18n';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth } from '../auth';
import { Markdown } from '../components/Markdown';
import { TextLayout } from '../layout/Frame';
import styles from './pages.module.css';

/** Startseite nach der Anmeldung; „Heute Nacht“ (S-02) und „Meine Objekte“ folgen mit ihren Paketen. */
export function HomePage() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const system = me?.context === 'system';
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
    </section>
  );
}

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
