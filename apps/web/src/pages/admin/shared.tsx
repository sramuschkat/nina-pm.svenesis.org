/** Gemeinsame Teile der Verwaltungsseiten: Reiter als Links, Einladungslink (einmalig angezeigt), Zeit. */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { ApiError } from '../../auth';
import { problemI18nKey } from '../../components/ProblemMessage';
import { ICON_SIZE, actionIcons } from '../../components/icons';
import { formatDateTime } from '../../lib/time';
import styles from './admin.module.css';

export function SectionTabs({
  label,
  tabs,
}: {
  label: string;
  tabs: readonly { to: string; label: string }[];
}) {
  return (
    <nav className={styles.tabs} aria-label={label}>
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end className={styles.tab}>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** Einladungslink: nur jetzt sichtbar (Token im Fragment, DAT-20); Kopieren in die Zwischenablage. */
export function InvitationLinkBox({
  link,
  expiresAt,
  zone,
}: {
  link: string;
  expiresAt: string;
  zone: string;
}) {
  const { t, i18n } = useTranslation();
  const [copied, setCopied] = useState(false);
  const Copy = actionIcons.duplicate;
  return (
    <div className={styles.linkBox} role="status">
      <p className={styles.label}>{t('admin.invitationLink')}</p>
      <p className={styles.code} data-testid="invitation-link">
        {link}
      </p>
      <p className={styles.muted}>
        {t('admin.invitationLinkHint', { at: formatDateTime(expiresAt, zone, i18n.language) })}
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.button}
          onClick={() => {
            void navigator.clipboard?.writeText(link).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
        >
          <Copy size={ICON_SIZE.table} aria-hidden />
          {copied ? t('admin.copied') : t('admin.copyLink')}
        </button>
      </div>
    </div>
  );
}

export function DateTime({ at, zone }: { at: string | null; zone: string }) {
  const { i18n } = useTranslation();
  if (!at) return <span className={styles.muted}>–</span>;
  return <time dateTime={at}>{formatDateTime(at, zone, i18n.language)}</time>;
}

/** Client-UUID für idempotente Anlage (TK 7.1). */
export const newId = () => crypto.randomUUID();

/**
 * Zustand eines `ConfirmDialog` für eine folgenreiche Aktion (E4): öffnen, ausführen (genau einmal),
 * Fehler als `errors.*`-Schlüssel anzeigen, bei Erfolg schließen.
 */
export function useConfirm(run: () => Promise<unknown>) {
  const [state, setState] = useState<'closed' | 'open' | 'loading' | 'error'>('closed');
  const [errorKey, setErrorKey] = useState<string | undefined>();
  return {
    open: () => setState('open'),
    dialog: {
      open: state !== 'closed',
      state: (state === 'loading' ? 'loading' : state === 'error' ? 'error' : 'ready') as
        'loading' | 'error' | 'ready',
      ...(errorKey ? { errorKey } : {}),
      onCancel: () => setState('closed'),
      onConfirm: async () => {
        setState('loading');
        try {
          await run();
          setState('closed');
        } catch (e) {
          setErrorKey(problemI18nKey(e instanceof ApiError ? e.problem.code : 'internal.error'));
          setState('error');
        }
      },
    },
  };
}

/** Fehlercode einer fehlgeschlagenen Abfrage/Aktion (Problem Details → `errors.*`). */
export const problemCode = (e: unknown) =>
  e instanceof ApiError ? e.problem.code : 'internal.error';
