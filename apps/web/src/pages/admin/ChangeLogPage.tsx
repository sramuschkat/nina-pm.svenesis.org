/**
 * S-72 Änderungsprotokoll (FA-BEN-08, SV-11): Rollen- und Statusänderungen, Einladungen und
 * Mandanteneinstellungen aus `change_log` (ohne Anmeldeprotokoll); darunter die Super-User-Aktionen, die
 * den Mandanten betreffen (FA-SU-09). Zeiten in Mandantenzeit mit Kürzel.
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { memberApi, tenantApi, type ChangeLogEntry } from '../../api/client';
import { useAuth } from '../../auth';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { ProblemMessage } from '../../components/ProblemMessage';
import styles from './admin.module.css';
import { AdminLayout } from './AdminLayout';
import { AuditTable } from './AuditTable';
import { DateTime, problemCode } from './shared';

const ENTITIES = ['app_user', 'invitation', 'tenant'] as const;

export function ChangeLogPage() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const zone = me?.tenant?.timeZone ?? 'Europe/Berlin';
  const [entity, setEntity] = useState('');
  const changes = useInfiniteQuery({
    queryKey: ['audit', 'changes', entity],
    queryFn: ({ pageParam }) =>
      tenantApi.changes({ cursor: pageParam, entity: entity || undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const system = useInfiniteQuery({
    queryKey: ['audit', 'system'],
    queryFn: ({ pageParam }) => tenantApi.systemAudit(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = changes.data?.pages.flatMap((p) => p.items) ?? [];
  // Mitglieder-IDs in Änderungen (z. B. Owner-Übertragung) als Anzeigenamen zeigen.
  const members = useQuery({ queryKey: ['members'], queryFn: () => memberApi.list() });
  const names = new Map((members.data?.members ?? []).map((m) => [m.id, m.displayName]));
  return (
    <AdminLayout title={t('admin.log.title')}>
      <section className={styles.panel} aria-labelledby="change-log">
        <div className={styles.head}>
          <h2 id="change-log">{t('admin.log.changes')}</h2>
          <div className={styles.field}>
            <label htmlFor="log-entity">{t('admin.log.filter')}</label>
            <select
              id="log-entity"
              className={styles.input}
              value={entity}
              onChange={(e) => setEntity(e.target.value)}
            >
              <option value="">{t('admin.log.all')}</option>
              {ENTITIES.map((e) => (
                <option key={e} value={e}>
                  {t(`admin.log.entity.${e}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {changes.isPending ? (
          <p role="status">{t('common.loading')}</p>
        ) : changes.isError ? (
          <ProblemMessage
            code={problemCode(changes.error)}
            onRetry={() => void changes.refetch()}
          />
        ) : items.length === 0 ? (
          <p className={styles.muted}>{t('system.audit.empty')}</p>
        ) : (
          <>
            <ChangeTable items={items} zone={zone} names={names} />
            {changes.hasNextPage ? (
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.button}
                  disabled={changes.isFetchingNextPage}
                  onClick={() => void changes.fetchNextPage()}
                >
                  {t('system.audit.more')}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>
      <section className={styles.panel} aria-labelledby="system-actions">
        <h2 id="system-actions">{t('admin.log.systemActions')}</h2>
        <p className={styles.muted}>{t('admin.log.systemHint')}</p>
        <AuditTable
          state={system.isPending ? 'loading' : system.isError ? 'error' : 'ready'}
          errorCode={system.isError ? problemCode(system.error) : undefined}
          onRetry={() => void system.refetch()}
          items={system.data?.pages.flatMap((p) => p.items) ?? []}
          zone={zone}
          label={t('admin.log.systemActions')}
          hasMore={system.hasNextPage}
          loadingMore={system.isFetchingNextPage}
          onMore={() => void system.fetchNextPage()}
        />
      </section>
    </AdminLayout>
  );
}

/** Tabelle der Änderungen (Zeit, Akteur, Objekt, Aktion, Änderungen). */
function ChangeTable({
  items,
  zone,
  names,
}: {
  items: readonly ChangeLogEntry[];
  zone: string;
  names: ReadonlyMap<string, string>;
}) {
  const { t, i18n } = useTranslation();
  const field = (key: string) => {
    const k = `admin.log.field.${key}`;
    const setting = `admin.settings.field.${key}`;
    return i18n.exists(k) ? t(k) : i18n.exists(setting) ? t(setting) : key;
  };
  const value = (key: string, v: unknown): string => {
    if (v === null || v === undefined) return '–';
    if (typeof v === 'boolean') return v ? t('admin.log.yes') : t('admin.log.no');
    if (key === 'ownerMemberId' && typeof v === 'string') return names.get(v) ?? '–';
    if ((key === 'role' || key === 'to' || key === 'from') && typeof v === 'string') {
      const k = `appBar.role.${v}`;
      if (i18n.exists(k)) return t(k);
    }
    if (key === 'status' && typeof v === 'string') {
      const k = `admin.members.status.${v}`;
      if (i18n.exists(k)) return t(k);
    }
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  };
  const changesText = (entry: ChangeLogEntry) =>
    Object.entries(entry.diff)
      .map(([key, v]) => {
        if (v && typeof v === 'object' && ('from' in v || 'to' in v)) {
          const d = v as { from?: unknown; to?: unknown };
          return `${field(key)}: ${value(key, d.from)} → ${value(key, d.to)}`;
        }
        return `${field(key)}: ${value(key, v)}`;
      })
      .join(' · ');
  const objectText = (entry: ChangeLogEntry) => {
    const entityKey = `admin.log.entity.${entry.entity}`;
    const entity = i18n.exists(entityKey) ? t(entityKey) : entry.entity;
    return `${entity}${entry.subjectName ? `: ${entry.subjectName}` : ''}`;
  };
  const actorText = (entry: ChangeLogEntry) => entry.actorName ?? t('admin.log.unknownActor');
  const actionText = (entry: ChangeLogEntry) => t(`admin.log.action.${entry.action}`);
  const columns: DataColumn<ChangeLogEntry>[] = [
    {
      id: 'time',
      header: t('system.audit.col.time'),
      sortValue: (e) => e.createdAt,
      nowrap: true,
      cell: (e) => <DateTime at={e.createdAt} zone={zone} />,
    },
    {
      id: 'actor',
      header: t('admin.log.col.actor'),
      sortValue: actorText,
      priority: 2,
      cell: actorText,
    },
    { id: 'object', header: t('admin.log.col.object'), sortValue: objectText, cell: objectText },
    {
      id: 'action',
      header: t('system.audit.col.action'),
      sortValue: actionText,
      priority: 3,
      cell: actionText,
    },
    {
      id: 'changes',
      header: t('admin.log.col.changes'),
      priority: 4,
      className: styles.details,
      cell: changesText,
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={items}
      rowKey={(e) => e.id}
      rowLabel={objectText}
      label={t('admin.log.changes')}
    />
  );
}
