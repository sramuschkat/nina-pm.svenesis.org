/**
 * S-42 NINA-Instanzen & Tokens (Admin; FK 14.3; FA-ADM-02/06, FA-RIG-06, TK 5.6, SV-08): Tabelle mit Name,
 * Rig, Token-Präfix, Status, Plugin-/Engine-Version, Profil-Standort mit Abweichungswarnung, zuletzt
 * gesehen und letztem Zustand; *Neue Instanz* zeigt das Token genau einmal (kein Ablaufdatum);
 * *Widerrufen* und *Session übernehmen* nur über den `ConfirmDialog` (E4); Diagnose mit letzten
 * Aufrufen, Fehlern und dem letzten Heartbeat. Die API prüft die Rechte erneut.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ninaApi,
  type NinaCallEntry,
  type NinaInstance,
  type NinaInstanceCreated,
} from '../../api/client';
import { useCan } from '../../auth';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ICON_SIZE, actionIcons } from '../../components/icons';
import { ProblemMessage } from '../../components/ProblemMessage';
import { formatDateTime } from '../../lib/time';
import { DateTime, newId, problemCode, useConfirm } from '../admin/shared';
import { useEquipmentList } from '../equipment/shared';
import styles from './nina.module.css';
import { ninaInstancesKey, uptakeText } from './UptakeStatus';

const coord = (v: number) => v.toFixed(4);

export function InstancesPage() {
  const { t } = useTranslation();
  const list = useQuery({
    queryKey: ninaInstancesKey(),
    queryFn: async () => (await ninaApi.instances()).items,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);
  const all = list.data ?? [];
  const hidden = showRevoked ? 0 : all.filter((i) => i.status === 'revoked').length;
  const items = showRevoked ? all : all.filter((i) => i.status !== 'revoked');
  const current = items.find((i) => i.id === selected);
  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1>{t('nina.instances.title')}</h1>
      </div>
      <p className={styles.info}>{t('nina.instances.intro')}</p>
      <CreatePanel />
      <section className={styles.panel} aria-labelledby="nina-instance-list">
        <div className={styles.head}>
          <h2 id="nina-instance-list">{t('nina.instances.list')}</h2>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={showRevoked}
              onChange={(e) => setShowRevoked(e.target.checked)}
            />
            {t('nina.instances.showRevoked')}
            {hidden > 0 ? (
              <span className={styles.muted}>{t('nina.instances.hidden', { count: hidden })}</span>
            ) : null}
          </label>
        </div>
        {list.isPending ? (
          <p role="status">{t('common.loading')}</p>
        ) : list.isError ? (
          <ProblemMessage code={problemCode(list.error)} onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <p className={styles.muted}>{t('nina.instances.empty')}</p>
        ) : (
          <InstanceTable items={items} selected={selected} onSelect={setSelected} />
        )}
      </section>
      {current ? (
        <InstanceDetail key={current.id} instance={current} onRemoved={() => setSelected(null)} />
      ) : items.length > 0 ? (
        <p className={styles.muted}>{t('nina.instances.selectHint')}</p>
      ) : null}
    </div>
  );
}

function StatePill({ i }: { i: NinaInstance }) {
  const { t } = useTranslation();
  const s = i.lastState;
  if (!s) return <span className={styles.muted}>–</span>;
  const label =
    s.state === 'blocked' && s.blockedReason
      ? `${t(`nina.state.${s.state}`)}: ${t(`nina.blocked.${s.blockedReason}`)}`
      : t(`nina.state.${s.state}`);
  return (
    <>
      <span className={s.state === 'blocked' ? styles.pillDanger : styles.pill}>{label}</span>
      {s.mismatchCodes.length > 0 ? (
        <>
          {' '}
          <span
            className={styles.pillWarn}
            title={s.mismatchCodes.map((c) => t(`nina.mismatch.${c}`)).join(', ')}
          >
            {t('nina.instances.mismatchCount', { count: s.mismatchCodes.length })}
          </span>
        </>
      ) : null}
    </>
  );
}

function Profile({ i }: { i: NinaInstance }) {
  const { t } = useTranslation();
  if (!i.profileLocation)
    return <span className={styles.muted}>{t('nina.instances.profileNone')}</span>;
  return (
    <span className={styles.profile}>
      <span className={styles.nowrap}>
        {coord(i.profileLocation.latDeg)}, {coord(i.profileLocation.lonDeg)}
      </span>
      {i.profileSiteMismatch ? (
        <span className={styles.pillWarn}>{t('nina.instances.profileMismatch')}</span>
      ) : null}
    </span>
  );
}

function InstanceTable({
  items,
  selected,
  onSelect,
}: {
  items: readonly NinaInstance[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={styles.tableWrap}
      tabIndex={0}
      role="region"
      aria-labelledby="nina-instance-list"
    >
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{t('nina.instances.col.name')}</th>
            <th scope="col">{t('nina.instances.col.rig')}</th>
            <th scope="col">{t('nina.instances.col.prefix')}</th>
            <th scope="col">{t('nina.instances.col.status')}</th>
            <th scope="col">{t('nina.instances.col.versions')}</th>
            <th scope="col">{t('nina.instances.col.profile')}</th>
            <th scope="col">{t('nina.instances.col.lastSeen')}</th>
            <th scope="col">{t('nina.instances.col.lastState')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} aria-selected={i.id === selected}>
              <td>
                <button type="button" className={styles.rowButton} onClick={() => onSelect(i.id)}>
                  {i.name}
                </button>
              </td>
              <td className={styles.rigCell}>{i.rigName}</td>
              <td>
                <code>{i.tokenPrefix}…</code>
              </td>
              <td>
                <span className={i.status === 'active' ? styles.pillOk : styles.pill}>
                  {t(`nina.instances.status.${i.status}`)}
                </span>
              </td>
              <td className={styles.nowrap}>
                {i.pluginVersion ?? '–'} / {i.engineVersion ?? '–'}
              </td>
              <td>
                <Profile i={i} />
              </td>
              <td className={styles.nowrap}>
                <DateTime at={i.lastSeenAt} zone={i.siteTimeZone} />
              </td>
              <td>
                <StatePill i={i} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** *Neue Instanz*: Token genau einmal anzeigen (SV-08), danach nur das Präfix. */
function CreatePanel() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const rigs = useEquipmentList('rigs');
  const [name, setName] = useState('');
  const [rigId, setRigId] = useState('');
  const [created, setCreated] = useState<NinaInstanceCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const rigList = rigs.data ?? [];
  const chosenRig = rigId || rigList[0]?.id || '';
  const create = useMutation({
    mutationFn: () => ninaApi.create({ id: newId(), rigId: chosenRig, name: name.trim() }),
    onSuccess: (r) => {
      setCreated(r);
      setCopied(false);
      setName('');
    },
    onSettled: () => client.invalidateQueries({ queryKey: ['nina-instances'] }),
  });
  const Add = actionIcons.add;
  const Copy = actionIcons.duplicate;
  return (
    <section className={styles.panel} aria-labelledby="nina-create">
      <h2 id="nina-create">{t('nina.instances.create')}</h2>
      {created ? (
        <div className={styles.linkBox} role="status">
          <p className={styles.label}>{t('nina.instances.token')}</p>
          <p className={styles.code} data-testid="nina-token">
            {created.token}
          </p>
          <p className={styles.muted}>{t('nina.instances.tokenHint')}</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                void navigator.clipboard?.writeText(created.token).then(
                  () => setCopied(true),
                  () => setCopied(false),
                );
              }}
            >
              <Copy size={ICON_SIZE.button} aria-hidden />
              {copied ? t('nina.instances.copied') : t('nina.instances.copy')}
            </button>
            <button type="button" className={styles.buttonPrimary} onClick={() => setCreated(null)}>
              {t('nina.instances.done')}
            </button>
          </div>
        </div>
      ) : (
        <form
          className={styles.form}
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (name.trim() && chosenRig) create.mutate();
          }}
        >
          <p className={styles.muted}>{t('nina.instances.createHint')}</p>
          <div className={styles.row}>
            <div className={styles.field}>
              <label htmlFor="nina-name">{t('nina.instances.name')}</label>
              <input
                id="nina-name"
                className={styles.input}
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="nina-rig">{t('nina.instances.rig')}</label>
              <select
                id="nina-rig"
                className={styles.input}
                value={chosenRig}
                onChange={(e) => setRigId(e.target.value)}
              >
                {rigList.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className={styles.buttonPrimary}
              disabled={create.isPending || !name.trim() || !chosenRig}
            >
              <Add size={ICON_SIZE.button} aria-hidden />
              {t('nina.instances.submit')}
            </button>
          </div>
          {create.error ? <ProblemMessage code={problemCode(create.error)} /> : null}
        </form>
      )}
    </section>
  );
}

function InstanceDetail({
  instance,
  onRemoved,
}: {
  instance: NinaInstance;
  onRemoved: () => void;
}) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const canManage = useCan('nina.instance.manage');
  const diag = useQuery({
    queryKey: ['nina-instances', 'diagnostics', instance.id],
    queryFn: () => ninaApi.diagnostics(instance.id),
  });
  const refresh = () => client.invalidateQueries({ queryKey: ['nina-instances'] });
  const revoke = useConfirm(async () => {
    await ninaApi.revoke(instance.id);
    await refresh();
  });
  const remove = useConfirm(async () => {
    await ninaApi.remove(instance.id);
    onRemoved();
    await refresh();
  });
  const release = useConfirm(async () => {
    await ninaApi.releaseLease(instance.rigId);
    await refresh();
  });
  const zone = instance.siteTimeZone;
  const lease = instance.lease;
  const held = lease !== null && (lease.activeSessionId !== null || lease.offlineUntilUtc !== null);
  const uptake = uptakeText(instance, t, i18n.language);
  const Delete = actionIcons.delete;
  return (
    <section className={styles.panel} aria-labelledby="nina-detail">
      <div className={styles.head}>
        <h2 id="nina-detail">{instance.name}</h2>
        <span className={instance.status === 'active' ? styles.pillOk : styles.pill}>
          {t(`nina.instances.status.${instance.status}`)}
        </span>
      </div>
      <p className={styles.muted}>
        {instance.rigName} · <code>{instance.tokenPrefix}…</code>
      </p>
      <p>
        {t('nina.instances.settingsFetched')}:{' '}
        <span className={uptake.current ? styles.pillOk : styles.pillWarn}>{uptake.text}</span>
      </p>
      {instance.lastState && instance.lastState.mismatchCodes.length > 0 ? (
        <ul>
          {instance.lastState.mismatchCodes.map((c) => (
            <li key={c}>{t(`nina.mismatch.${c}`)}</li>
          ))}
        </ul>
      ) : null}

      <div className={styles.detailGrid}>
        <div className={styles.section}>
          <h3>{t('nina.instances.lease')}</h3>
          <p className={styles.muted}>
            {lease?.offlineUntilUtc
              ? t('nina.instances.leaseOffline', {
                  until: formatDateTime(lease.offlineUntilUtc, zone, i18n.language),
                })
              : lease?.activeSessionId
                ? t('nina.instances.leaseInfo', {
                    session: lease.activeSessionId.slice(0, 8),
                    until: lease.untilUtc
                      ? formatDateTime(lease.untilUtc, zone, i18n.language)
                      : '–',
                  })
                : t('nina.instances.leaseFree')}
          </p>
          {canManage ? (
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.button}
                disabled={!held}
                onClick={release.open}
              >
                {t('nina.instances.lease')}
              </button>
              {instance.status === 'active' ? (
                <button type="button" className={styles.buttonDanger} onClick={revoke.open}>
                  <Delete size={ICON_SIZE.button} aria-hidden />
                  {t('nina.instances.revoke')}
                </button>
              ) : null}
              <button type="button" className={styles.buttonDanger} onClick={remove.open}>
                <Delete size={ICON_SIZE.button} aria-hidden />
                {t('nina.instances.remove')}
              </button>
            </div>
          ) : null}
          {canManage ? <p className={styles.muted}>{t('nina.instances.removeHint')}</p> : null}
        </div>

        <div className={styles.section}>
          <h3>{t('nina.instances.diagnostics')}</h3>
          {diag.isPending ? (
            <p role="status">{t('common.loading')}</p>
          ) : diag.isError ? (
            <ProblemMessage code={problemCode(diag.error)} onRetry={() => void diag.refetch()} />
          ) : (
            <>
              <CallTable
                id="nina-calls"
                title={t('nina.instances.calls')}
                rows={diag.data.calls}
                zone={zone}
              />
              <CallTable
                id="nina-errors"
                title={t('nina.instances.errors')}
                rows={diag.data.errors}
                zone={zone}
              />
              <h4>{t('nina.instances.heartbeat')}</h4>
              {diag.data.heartbeat ? (
                <pre className={styles.pre} tabIndex={0}>
                  {JSON.stringify(diag.data.heartbeat, null, 2)}
                </pre>
              ) : (
                <p className={styles.muted}>{t('nina.instances.noCalls')}</p>
              )}
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        {...revoke.dialog}
        variant="danger"
        title={t('nina.instances.revokeTitle', { name: instance.name })}
        consequence={t('nina.instances.revokeConsequence')}
        confirmLabel={t('nina.instances.revoke')}
      />
      <ConfirmDialog
        {...remove.dialog}
        variant="danger"
        title={t('nina.instances.removeTitle', { name: instance.name })}
        consequence={t('nina.instances.removeConsequence')}
        confirmLabel={t('nina.instances.remove')}
      />
      <ConfirmDialog
        {...release.dialog}
        variant="danger"
        title={t('nina.instances.leaseTitle', { rig: instance.rigName })}
        consequence={t('nina.instances.leaseConsequence')}
        confirmLabel={t('nina.instances.lease')}
      />
    </section>
  );
}

function CallTable({
  id,
  title,
  rows,
  zone,
}: {
  id: string;
  title: string;
  rows: readonly NinaCallEntry[];
  zone: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      <h4 id={id}>{title}</h4>
      {rows.length === 0 ? (
        <p className={styles.muted}>{t('nina.instances.noCalls')}</p>
      ) : (
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-labelledby={id}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t('nina.instances.callCol.at')}</th>
                <th scope="col">{t('nina.instances.callCol.call')}</th>
                <th scope="col" className={styles.num}>
                  {t('nina.instances.callCol.status')}
                </th>
                <th scope="col">{t('nina.instances.callCol.code')}</th>
                <th scope="col" className={styles.num}>
                  {t('nina.instances.callCol.duration')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, n) => (
                <tr key={`${r.atUtc}-${String(n)}`}>
                  <td className={styles.nowrap}>
                    <DateTime at={r.atUtc} zone={zone} />
                  </td>
                  <td>
                    <code>
                      {r.method} {r.route}
                    </code>
                  </td>
                  <td className={styles.num}>{r.status}</td>
                  <td>{r.code ?? '–'}</td>
                  <td className={styles.num}>
                    {t('nina.instances.durationMs', { ms: r.durationMs })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
