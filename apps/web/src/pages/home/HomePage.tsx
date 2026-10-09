/**
 * Startseite (FK 14.3 S-02; AP-73): im Mandanten die Seite „Heute“ (`TodayPage`, Übersicht und Heute Nacht in einem),
 * im System-Kontext (Super User ohne Mandant) der Hinweis zur Verwaltung wie bisher.
 */
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth';
import { PageHeader } from '../../components/PageHeader';
import styles from './home.module.css';
import { TodayPage } from './TodayPage';

export function HomePage() {
  const { me } = useAuth();
  // Der Rahmen zeigt die Seite erst mit Sitzung; bis dahin nichts (wie `Root`).
  if (!me) return null;
  return me.context === 'system' ? <SystemHome /> : <TodayPage />;
}

/** System-Kontext (Super User ohne Mandant): Hinweis wie bisher. */
function SystemHome() {
  const { t } = useTranslation();
  return (
    <div className={styles.page}>
      <PageHeader title={t('home.title')} meta={t('home.intro')} />
      <section className={styles.card} aria-labelledby="home-system">
        <div className={styles.cardHead}>
          <h2 id="home-system" className={styles.cardTitle}>
            {t('home.systemTitle')}
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p className={styles.muted}>{t('home.systemIntro')}</p>
        </div>
      </section>
    </div>
  );
}
