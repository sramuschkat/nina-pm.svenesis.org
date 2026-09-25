/**
 * S-82: Kataloge (AP-20, `CatalogPanel`), Wartungshinweis für alle Mandanten (FA-SU-08) und System-Audit
 * (FA-SU-09, SV-11) – neueste zuerst, Filter je Mandant, „Weitere laden“ über den Cursor.
 * Exoplaneten-Kataloge folgen mit R4.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { systemApi } from '../../api/client';
import { ICON_SIZE, actionIcons } from '../../components/icons';
import { ProblemMessage } from '../../components/ProblemMessage';
import { SYSTEM_TIMEZONE } from '../../lib/time';
import styles from '../admin/admin.module.css';
import { AuditTable } from '../admin/AuditTable';
import { problemCode } from '../admin/shared';
import { CatalogPanel } from './CatalogPanel';
import { SystemLayout } from './SystemLayout';

export function SystemAuditPage() {
  const { t } = useTranslation();
  return (
    <SystemLayout title={t('system.audit.title')}>
      <CatalogPanel />
      <MaintenanceBannerForm />
      <SystemAudit />
    </SystemLayout>
  );
}

function MaintenanceBannerForm() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const current = useQuery({ queryKey: ['system', 'banner'], queryFn: () => systemApi.banner() });
  const [active, setActive] = useState(false);
  const [textDe, setTextDe] = useState('');
  const [textEn, setTextEn] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const v = current.data?.value;
    if (v) {
      setActive(v.active);
      setTextDe(v.textDe);
      setTextEn(v.textEn);
    }
  }, [current.data]);
  const save = useMutation({
    mutationFn: () => systemApi.setBanner({ active, textDe: textDe.trim(), textEn: textEn.trim() }),
    onSuccess: () => setSaved(true),
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: ['system', 'banner'] });
      await client.invalidateQueries({ queryKey: ['banner'] });
    },
  });
  const missingText = active && (!textDe.trim() || !textEn.trim());
  const Save = actionIcons.save;
  return (
    <section className={styles.panel} aria-labelledby="banner-form">
      <h2 id="banner-form">{t('system.banner.title')}</h2>
      <p className={styles.muted}>{t('system.banner.hint')}</p>
      {current.isError ? (
        <ProblemMessage code={problemCode(current.error)} onRetry={() => void current.refetch()} />
      ) : (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            setSaved(false);
            if (!missingText) save.mutate();
          }}
        >
          <label className={styles.check}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            {t('system.banner.active')}
          </label>
          <div className={styles.row}>
            <div className={styles.field}>
              <label htmlFor="banner-de">{t('system.banner.textDe')}</label>
              <textarea
                id="banner-de"
                className={styles.input}
                value={textDe}
                maxLength={500}
                onChange={(e) => setTextDe(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="banner-en">{t('system.banner.textEn')}</label>
              <textarea
                id="banner-en"
                className={styles.input}
                value={textEn}
                maxLength={500}
                onChange={(e) => setTextEn(e.target.value)}
              />
            </div>
          </div>
          {missingText ? <p className={styles.muted}>{t('system.banner.missingText')}</p> : null}
          <div className={styles.actions}>
            <button
              type="submit"
              className={styles.buttonPrimary}
              disabled={save.isPending || current.isPending || missingText}
            >
              <Save size={ICON_SIZE.button} aria-hidden />
              {t('system.banner.save')}
            </button>
            {saved ? (
              <span className={styles.success} role="status">
                {t('system.banner.saved')}
              </span>
            ) : null}
          </div>
          {save.isError ? <ProblemMessage code={problemCode(save.error)} /> : null}
        </form>
      )}
    </section>
  );
}

function SystemAudit() {
  const { t } = useTranslation();
  const [tenantId, setTenantId] = useState('');
  const tenants = useQuery({ queryKey: ['system', 'tenants'], queryFn: () => systemApi.tenants() });
  const audit = useInfiniteQuery({
    queryKey: ['system', 'audit', tenantId],
    queryFn: ({ pageParam }) =>
      systemApi.audit({ cursor: pageParam, tenantId: tenantId || undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  return (
    <section className={styles.panel} aria-labelledby="system-audit">
      <div className={styles.head}>
        <h2 id="system-audit">{t('system.audit.list')}</h2>
        <div className={styles.field}>
          <label htmlFor="audit-tenant">{t('system.audit.filterTenant')}</label>
          <select
            id="audit-tenant"
            className={styles.input}
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
          >
            <option value="">{t('system.audit.allTenants')}</option>
            {(tenants.data?.tenants ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                {x.tenantKey}
              </option>
            ))}
          </select>
        </div>
      </div>
      <AuditTable
        state={audit.isPending ? 'loading' : audit.isError ? 'error' : 'ready'}
        errorCode={audit.isError ? problemCode(audit.error) : undefined}
        onRetry={() => void audit.refetch()}
        items={audit.data?.pages.flatMap((p) => p.items) ?? []}
        zone={SYSTEM_TIMEZONE}
        showTenant
        hasMore={audit.hasNextPage}
        loadingMore={audit.isFetchingNextPage}
        onMore={() => void audit.fetchNextPage()}
      />
    </section>
  );
}
