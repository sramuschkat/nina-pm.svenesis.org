/** Tabelle des System-Audits (S-82 und – für Admins, nur ihr Mandant – S-72, FA-SU-09). */
import { useTranslation } from 'react-i18next';
import type { SystemAuditEntry } from '../../api/client';
import { ProblemMessage } from '../../components/ProblemMessage';
import styles from './admin.module.css';
import { DateTime } from './shared';

/** Details kompakt als „Schlüssel: Wert“ ohne Rohdaten-JSON. */
function detailText(details: Record<string, unknown>): string {
  return Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(' · ');
}

export function AuditTable({
  state,
  items,
  zone,
  errorCode,
  onRetry,
  showTenant = false,
  hasMore,
  loadingMore,
  onMore,
}: {
  state: 'loading' | 'error' | 'ready';
  items: readonly SystemAuditEntry[];
  zone: string;
  errorCode?: string | undefined;
  onRetry?: () => void;
  showTenant?: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
}) {
  const { t, i18n } = useTranslation();
  if (state === 'loading') return <p role="status">{t('common.loading')}</p>;
  if (state === 'error')
    return <ProblemMessage code={errorCode ?? 'internal.error'} onRetry={onRetry} />;
  if (items.length === 0) return <p className={styles.muted}>{t('system.audit.empty')}</p>;
  const label = (action: string) => {
    if (action.startsWith('ops.'))
      return t('system.audit.opsCommand', { command: action.slice(4) });
    const key = `system.audit.action.${action}`;
    return i18n.exists(key) ? t(key) : action;
  };
  return (
    <>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{t('system.audit.col.time')}</th>
              <th scope="col">{t('system.audit.col.actor')}</th>
              <th scope="col">{t('system.audit.col.action')}</th>
              {showTenant ? <th scope="col">{t('system.audit.col.tenant')}</th> : null}
              <th scope="col">{t('system.audit.col.details')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <DateTime at={e.createdAt} zone={zone} />
                </td>
                <td>
                  {e.actor === 'ops_cli' ? 'ops-cli' : (e.actorName ?? t('appBar.role.system'))}
                </td>
                <td>{label(e.action)}</td>
                {showTenant ? <td>{e.tenantKey ?? '–'}</td> : null}
                <td className={styles.details}>{detailText(e.details)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore ? (
        <div className={styles.actions}>
          <button type="button" className={styles.button} disabled={loadingMore} onClick={onMore}>
            {t('system.audit.more')}
          </button>
        </div>
      ) : null}
    </>
  );
}
