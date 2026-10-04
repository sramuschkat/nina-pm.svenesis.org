/**
 * S-71 Mandanteneinstellungen, Reiter *Allgemein* (FA-MAN-05; TK 7.2): Schlüssel ausschließlich aus
 * `tenantSettingsKeys`. **Kein** Reiter *Sicherheit* – Sitzungsdauer und 2FA-Regel sind fest (SV-01,
 * SV-03). Der Reiter *Discord* ist eine eigene Seite (`DiscordSettingsPage`, AP-60).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { tenantApi, type TenantSettings } from '../../api/client';
import { useAuth } from '../../auth';
import { ICON_SIZE, actionIcons } from '../../components/icons';
import { ProblemMessage } from '../../components/ProblemMessage';
import { isTimeZone, timeZoneSuggestions } from '../../lib/time-zones';
import styles from './admin.module.css';
import { AdminLayout } from './AdminLayout';
import { DateTime, problemCode } from './shared';

const SETTINGS_KEY = ['tenant', 'settings'] as const;

type BoolKey =
  | 'adminSelfApproval'
  | 'autoReadyToProcess'
  | 'autoReactivateOnRemaining'
  | 'userCorrections'
  | 'exoUserLockNeedsAdmin';

export function TenantSettingsPage() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const { refresh, me } = useAuth();
  const query = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => tenantApi.settings() });
  const [displayName, setDisplayName] = useState('');
  const [draft, setDraft] = useState<TenantSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const zones = useMemo(timeZoneSuggestions, []);
  useEffect(() => {
    if (query.data) {
      setDisplayName(query.data.displayName);
      setDraft(query.data.settings);
    }
  }, [query.data]);
  const save = useMutation({
    mutationFn: () => {
      const base = query.data?.settings;
      const changed = Object.fromEntries(
        Object.entries(draft ?? {}).filter(([k, v]) => base?.[k as keyof TenantSettings] !== v),
      ) as Partial<TenantSettings>;
      return tenantApi.updateSettings({
        ...(displayName.trim() !== query.data?.displayName
          ? { displayName: displayName.trim() }
          : {}),
        ...(Object.keys(changed).length > 0 ? { settings: changed } : {}),
      });
    },
    onSuccess: async (view) => {
      client.setQueryData(SETTINGS_KEY, view);
      setSaved(true);
      await refresh();
    },
  });
  const set = <K extends keyof TenantSettings>(key: K, value: TenantSettings[K]) => {
    setSaved(false);
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  };
  const dirty =
    !!query.data &&
    !!draft &&
    (displayName.trim() !== query.data.displayName ||
      Object.entries(draft).some(([k, v]) => query.data.settings[k as keyof TenantSettings] !== v));
  const zoneInvalid = !!draft && !isTimeZone(draft.tenantTimezone);
  const check = (key: BoolKey) =>
    draft ? (
      <label className={styles.check}>
        <input type="checkbox" checked={draft[key]} onChange={(e) => set(key, e.target.checked)} />
        {t(`admin.settings.field.${key}`)}
      </label>
    ) : null;
  const Save = actionIcons.save;
  return (
    <AdminLayout title={t('admin.settings.title')}>
      <section className={styles.panel} aria-labelledby="settings-general">
        <h2 id="settings-general">{t('admin.settings.general')}</h2>
        {query.isPending || !draft ? (
          query.isError ? (
            <ProblemMessage code={problemCode(query.error)} onRetry={() => void query.refetch()} />
          ) : (
            <p role="status">{t('common.loading')}</p>
          )
        ) : (
          <form
            className={styles.form}
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (dirty && !zoneInvalid && displayName.trim()) save.mutate();
            }}
          >
            <div className={styles.section}>
              <h3>{t('admin.settings.tenant')}</h3>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label htmlFor="tenant-display-name">
                    {t('admin.settings.field.displayName')}
                  </label>
                  <input
                    id="tenant-display-name"
                    className={styles.input}
                    value={displayName}
                    maxLength={120}
                    onChange={(e) => {
                      setSaved(false);
                      setDisplayName(e.target.value);
                    }}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="tenant-language">
                    {t('admin.settings.field.defaultLanguage')}
                  </label>
                  <select
                    id="tenant-language"
                    className={styles.input}
                    value={draft.defaultLanguage}
                    onChange={(e) => set('defaultLanguage', e.target.value as 'de' | 'en')}
                  >
                    <option value="de">Deutsch</option>
                    <option value="en">English</option>
                  </select>
                </div>
                <div className={styles.field}>
                  <label htmlFor="tenant-tz">{t('admin.settings.field.tenantTimezone')}</label>
                  <input
                    id="tenant-tz"
                    className={styles.input}
                    list="tenant-tz-list"
                    value={draft.tenantTimezone}
                    aria-invalid={zoneInvalid}
                    aria-describedby="tenant-tz-hint"
                    onChange={(e) => set('tenantTimezone', e.target.value.trim())}
                  />
                  <datalist id="tenant-tz-list">
                    {zones.map((z) => (
                      <option key={z} value={z} />
                    ))}
                  </datalist>
                  <span id="tenant-tz-hint" className={styles.muted}>
                    {t('admin.settings.tzHint')}
                  </span>
                </div>
              </div>
            </div>
            <div className={styles.section}>
              <h3>{t('admin.settings.approval')}</h3>
              {check('adminSelfApproval')}
              <div className={styles.row}>
                <div className={styles.field}>
                  <label htmlFor="tenant-deadline">
                    {t('admin.settings.field.approvalDeadlineDays')}
                  </label>
                  <input
                    id="tenant-deadline"
                    type="number"
                    min={1}
                    max={365}
                    className={styles.input}
                    value={draft.approvalDeadlineDays ?? ''}
                    aria-describedby="tenant-deadline-hint"
                    onChange={(e) =>
                      set(
                        'approvalDeadlineDays',
                        e.target.value === ''
                          ? null
                          : Math.min(365, Math.max(1, Math.round(Number(e.target.value)))),
                      )
                    }
                  />
                  <span id="tenant-deadline-hint" className={styles.muted}>
                    {t('admin.settings.deadlineHint')}
                  </span>
                </div>
              </div>
            </div>
            <div className={styles.section}>
              <h3>{t('admin.settings.projects')}</h3>
              {check('autoReadyToProcess')}
              {check('autoReactivateOnRemaining')}
              {check('userCorrections')}
            </div>
            <div className={styles.section}>
              <h3>{t('admin.settings.exoplanets')}</h3>
              {check('exoUserLockNeedsAdmin')}
              <div className={styles.row}>
                <div className={styles.field}>
                  <label htmlFor="tenant-locks">
                    {t('admin.settings.field.exoUserMaxOpenLocks')}
                  </label>
                  <input
                    id="tenant-locks"
                    type="number"
                    min={1}
                    max={20}
                    className={styles.input}
                    value={draft.exoUserMaxOpenLocks}
                    onChange={(e) =>
                      set(
                        'exoUserMaxOpenLocks',
                        Math.min(20, Math.max(1, Math.round(Number(e.target.value) || 1))),
                      )
                    }
                  />
                </div>
              </div>
            </div>
            <p className={styles.muted}>{t('admin.settings.securityFixed')}</p>
            <div className={styles.actions}>
              <button
                type="submit"
                className={styles.buttonPrimary}
                disabled={!dirty || zoneInvalid || !displayName.trim() || save.isPending}
              >
                <Save size={ICON_SIZE.button} aria-hidden />
                {t('admin.settings.save')}
              </button>
              {saved ? (
                <span className={styles.success} role="status">
                  {t('system.banner.saved')}
                </span>
              ) : null}
              <span className={styles.muted}>
                {t('admin.settings.updatedAt')}{' '}
                <DateTime
                  at={query.data?.updatedAt ?? null}
                  zone={me?.tenant?.timeZone ?? draft.tenantTimezone}
                />
              </span>
            </div>
            {save.isError ? <ProblemMessage code={problemCode(save.error)} /> : null}
          </form>
        )}
      </section>
    </AdminLayout>
  );
}
