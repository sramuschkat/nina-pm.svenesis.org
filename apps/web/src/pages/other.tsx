/** Datenschutz, Quellen, 404 (die Startseite liegt in `home/HomePage.tsx`). */
import { privacyMarkdown, sourcesMarkdown, type Language } from '@nina-pm/i18n';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Markdown } from '../components/Markdown';
import { TextLayout } from '../layout/Frame';
import styles from './pages.module.css';

const lang = (l: string): Language => (l === 'en' ? 'en' : 'de');

export function PrivacyPage() {
  const { t, i18n } = useTranslation();
  return (
    <TextLayout crumbs={[{ label: t('legal.privacyTitle') }]}>
      <h1>{t('legal.privacyTitle')}</h1>
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
