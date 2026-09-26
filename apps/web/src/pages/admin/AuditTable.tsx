/** Tabelle des System-Audits (S-82 und – für Admins, nur ihr Mandant – S-72, FA-SU-09). */
import { useTranslation } from 'react-i18next';
import type { SystemAuditEntry } from '../../api/client';
import { DataTable, type DataColumn } from '../../components/DataTable';
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
  label,
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
  /** Zugänglicher Name der Tabelle (Standard: Titel des System-Audits). */
  label?: string;
}) {
  const { t, i18n } = useTranslation();
  if (state === 'loading') return <p role="status">{t('common.loading')}</p>;
  if (state === 'error')
    return <ProblemMessage code={errorCode ?? 'internal.error'} onRetry={onRetry} />;
  if (items.length === 0) return <p className={styles.muted}>{t('system.audit.empty')}</p>;
  const actionLabel = (action: string) => {
    if (action.startsWith('ops.'))
      return t('system.audit.opsCommand', { command: action.slice(4) });
    const key = `system.audit.action.${action}`;
    return i18n.exists(key) ? t(key) : action;
  };
  const actorName = (e: SystemAuditEntry) =>
    e.actor === 'ops_cli' ? 'ops-cli' : (e.actorName ?? t('appBar.role.system'));
  const columns: DataColumn<SystemAuditEntry>[] = [
    {
      id: 'time',
      header: t('system.audit.col.time'),
      sortValue: (e) => e.createdAt,
      nowrap: true,
      cell: (e) => <DateTime at={e.createdAt} zone={zone} />,
    },
    {
      id: 'actor',
      header: t('system.audit.col.actor'),
      sortValue: actorName,
      priority: 2,
      cell: actorName,
    },
    {
      id: 'action',
      header: t('system.audit.col.action'),
      sortValue: (e) => actionLabel(e.action),
      cell: (e) => actionLabel(e.action),
    },
    ...(showTenant
      ? [
          {
            id: 'tenant',
            header: t('system.audit.col.tenant'),
            sortValue: (e: SystemAuditEntry) => e.tenantKey,
            priority: 3,
            cell: (e: SystemAuditEntry) => e.tenantKey ?? '–',
          },
        ]
      : []),
    {
      id: 'details',
      header: t('system.audit.col.details'),
      priority: 4,
      className: styles.details,
      cell: (e) => detailText(e.details),
    },
  ];
  return (
    <>
      <DataTable
        columns={columns}
        rows={items}
        rowKey={(e) => e.id}
        rowLabel={(e) => actionLabel(e.action)}
        label={label ?? t('system.audit.title')}
      />
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
