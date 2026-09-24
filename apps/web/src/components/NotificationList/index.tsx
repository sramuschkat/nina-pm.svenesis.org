/**
 * `NotificationList` (FA-FRG-11, FK 14.3): Liste der Benachrichtigungen ohne Datenzugriff und ohne
 * Rechteentscheidung – die Glocke lädt und entscheidet. Ein Text je Art (`notifications.kind.*`), Zeit in
 * Mandantenzeit mit Kürzel (FK 8.1), ungelesene Einträge hervorgehoben und einzeln als gelesen markierbar.
 */
import { formatTzAbbr, formatZonedTime } from '@nina-pm/shared';
import { useTranslation } from 'react-i18next';
import { uiIcons, ICON_SIZE } from '../icons';
import { ProblemMessage } from '../ProblemMessage';
import styles from './NotificationList.module.css';

export interface NotificationItem {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListProps {
  state: 'loading' | 'error' | 'ready';
  items: readonly NotificationItem[];
  /** IANA-Zone des Mandanten (`tenantTimezone`). */
  tenantTimeZone: string;
  errorCode?: string | undefined;
  onRetry?: (() => void) | undefined;
  onMarkRead?: ((id: string) => void) | undefined;
}

const ROLES = new Set(['owner', 'admin', 'user']);

/** Werte für die Textbausteine: Rollen übersetzt, nur Zeichenketten/Zahlen, IDs nie im Text. */
function values(payload: Record<string, unknown>, t: (k: string) => string) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'number') out[key] = String(value);
    else if (typeof value === 'string')
      out[key] = ROLES.has(value) ? t(`appBar.role.${value}`) : value;
  }
  return out;
}

function formatDate(atUtc: string, timeZone: string, lang: string): string {
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'de-DE', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(Date.parse(atUtc)));
}

export function NotificationList({
  state,
  items,
  tenantTimeZone,
  errorCode,
  onRetry,
  onMarkRead,
}: NotificationListProps) {
  const { t, i18n } = useTranslation();
  if (state === 'loading')
    return (
      <p className={styles.status} role="status">
        {t('common.loading')}
      </p>
    );
  if (state === 'error')
    return <ProblemMessage code={errorCode ?? 'internal.error'} onRetry={onRetry} />;
  if (items.length === 0) return <p className={styles.status}>{t('notifications.empty')}</p>;
  const Check = uiIcons.ok;
  return (
    <ul className={styles.list}>
      {items.map((n) => {
        const unread = n.readAt === null;
        const v = values(n.payload, t);
        const known = i18n.exists(`notifications.kind.${n.kind}`);
        return (
          <li key={n.id} className={unread ? styles.unread : styles.read}>
            <span className={styles.dot} aria-hidden />
            <div className={styles.body}>
              <p className={styles.text}>
                {unread ? (
                  <span className={styles.srOnly}>{t('notifications.unread')}: </span>
                ) : null}
                {known ? t(`notifications.kind.${n.kind}`, v) : t('notifications.unknownKind')}
              </p>
              {v.subject ? <p className={styles.subject}>{v.subject}</p> : null}
              <time
                className={styles.time}
                dateTime={n.createdAt}
                title={t('notifications.timeHint', { zone: tenantTimeZone })}
              >
                {`${formatDate(n.createdAt, tenantTimeZone, i18n.language)} ${formatZonedTime(n.createdAt, tenantTimeZone)} ${formatTzAbbr(n.createdAt, tenantTimeZone)}`}
              </time>
            </div>
            {unread && onMarkRead ? (
              <button
                type="button"
                className={styles.markRead}
                onClick={() => onMarkRead(n.id)}
                aria-label={t('notifications.markRead')}
                title={t('notifications.markRead')}
              >
                <Check size={ICON_SIZE.table} aria-hidden />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
