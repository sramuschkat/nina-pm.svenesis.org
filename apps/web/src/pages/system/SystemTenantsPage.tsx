/**
 * S-80 Mandanten (FA-SU-03…05, FA-MAN-01…03): Liste mit Owner bzw. „Owner ausstehend“ und Kennzahlen,
 * anlegen mit Owner-Einladung, sperren/entsperren, Owner-Einladung, Owner neu zuweisen (Begründung,
 * Bestätigung), löschen nur mit Eingabe der Mandanten-ID. Keine fachlichen Inhalte (FA-SU-07).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { systemApi, type InvitationCreated, type TenantAdmin } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { ICON_SIZE, actionIcons } from '../../components/icons';
import { ProblemMessage } from '../../components/ProblemMessage';
import { formatBytes } from '../../lib/bytes';
import { formatDateTime, SYSTEM_TIMEZONE } from '../../lib/time';
import styles from '../admin/admin.module.css';
import { DateTime, InvitationLinkBox, newId, problemCode, useConfirm } from '../admin/shared';
import { SystemLayout } from './SystemLayout';

const TENANTS_KEY = ['system', 'tenants'] as const;
const TENANT_KEY_PATTERN = /^[a-z0-9-]{3,32}$/;
const DISCORD_ID_PATTERN = /^\d{5,25}$/;

export function SystemTenantsPage() {
  const { t } = useTranslation();
  const tenants = useQuery({ queryKey: TENANTS_KEY, queryFn: () => systemApi.tenants() });
  const [selected, setSelected] = useState<string | null>(null);
  const list = tenants.data?.tenants ?? [];
  const current = list.find((x) => x.id === selected);
  return (
    <SystemLayout title={t('system.tenants.title')}>
      <CreateTenant onCreated={setSelected} />
      <div className={styles.split}>
        <section className={styles.panel} aria-labelledby="tenant-list">
          <h2 id="tenant-list">{t('system.tenants.list')}</h2>
          {tenants.isPending ? (
            <p role="status">{t('common.loading')}</p>
          ) : tenants.isError ? (
            <ProblemMessage
              code={problemCode(tenants.error)}
              onRetry={() => void tenants.refetch()}
            />
          ) : list.length === 0 ? (
            <p className={styles.muted}>{t('system.tenants.empty')}</p>
          ) : (
            <TenantTable tenants={list} selected={selected} onSelect={setSelected} />
          )}
        </section>
        {current ? (
          <TenantDetail key={current.id} tenant={current} onDeleted={() => setSelected(null)} />
        ) : (
          <section className={styles.panel}>
            <p className={styles.muted}>{t('system.tenants.selectHint')}</p>
          </section>
        )}
      </div>
    </SystemLayout>
  );
}

function StatusPill({ status }: { status: TenantAdmin['status'] }) {
  const { t } = useTranslation();
  return (
    <span className={status === 'active' ? styles.pillOk : styles.pillDanger}>
      {t(`system.tenants.status.${status}`)}
    </span>
  );
}

function TenantTable({
  tenants,
  selected,
  onSelect,
}: {
  tenants: readonly TenantAdmin[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const columns: DataColumn<TenantAdmin>[] = [
    {
      id: 'key',
      header: t('system.tenants.col.key'),
      sortValue: (x) => x.tenantKey,
      nowrap: true,
      cell: (x) => (
        <button type="button" className={styles.rowButton} onClick={() => onSelect(x.id)}>
          {x.tenantKey}
        </button>
      ),
    },
    {
      id: 'name',
      header: t('system.tenants.col.name'),
      sortValue: (x) => x.displayName,
      cell: (x) => x.displayName,
    },
    {
      id: 'status',
      header: t('system.tenants.col.status'),
      sortValue: (x) => t(`system.tenants.status.${x.status}`),
      cell: (x) => <StatusPill status={x.status} />,
    },
    {
      id: 'owner',
      header: t('system.tenants.col.owner'),
      // Ohne Owner (Einladung offen) zuletzt.
      sortValue: (x) => x.ownerDisplayName,
      priority: 2,
      cell: (x) =>
        x.ownerDisplayName ?? (
          <span className={styles.pillWarn}>{t('system.tenants.ownerPending')}</span>
        ),
    },
    {
      id: 'admins',
      header: t('system.tenants.col.admins'),
      sortValue: (x) => x.admins,
      priority: 3,
      align: 'end',
      cell: (x) => x.admins,
    },
    {
      id: 'users',
      header: t('system.tenants.col.users'),
      sortValue: (x) => x.users,
      priority: 3,
      align: 'end',
      cell: (x) => x.users,
    },
    {
      id: 'rigs',
      header: t('system.tenants.col.rigs'),
      sortValue: (x) => x.rigs,
      priority: 4,
      align: 'end',
      cell: (x) => x.rigs,
    },
    {
      id: 'nina',
      header: t('system.tenants.col.nina'),
      sortValue: (x) => x.ninaInstances,
      priority: 4,
      cell: (x) => (
        <>
          {x.ninaInstances}
          {x.ninaLastSeenAt ? (
            <>
              {' · '}
              <DateTime at={x.ninaLastSeenAt} zone={SYSTEM_TIMEZONE} />
            </>
          ) : null}
        </>
      ),
    },
    {
      id: 'lastLogin',
      header: t('system.tenants.col.lastLogin'),
      sortValue: (x) => x.lastLoginAt,
      priority: 2,
      nowrap: true,
      cell: (x) => <DateTime at={x.lastLoginAt} zone={SYSTEM_TIMEZONE} />,
    },
    {
      id: 'storage',
      header: t('system.tenants.col.storage'),
      sortValue: (x) => x.storageBytes,
      priority: 3,
      align: 'end',
      nowrap: true,
      cell: (x) => <StorageValue tenant={x} />,
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={tenants}
      rowKey={(x) => x.id}
      rowLabel={(x) => x.tenantKey}
      label={t('system.tenants.list')}
      rowProps={(x) => ({ 'aria-selected': x.id === selected })}
    />
  );
}

/** Dateien des Mandanten mit Messzeitpunkt (AP-07d, FA-SU-03). */
function StorageValue({ tenant }: { tenant: TenantAdmin }) {
  const { t, i18n } = useTranslation();
  if (tenant.storageBytes === null || tenant.storageMeasuredAt === null)
    return <span className={styles.muted}>{t('system.tenants.storageNone')}</span>;
  return (
    <span
      title={t('system.tenants.storageHint', {
        count: tenant.storageFileCount ?? 0,
        at: formatDateTime(tenant.storageMeasuredAt, SYSTEM_TIMEZONE, i18n.language),
      })}
    >
      {formatBytes(tenant.storageBytes, i18n.language)}
    </span>
  );
}

/** Mandant anlegen (FA-MAN-01) und gleich die Owner-Einladung erzeugen (FA-SU-05). */
function CreateTenant({ onCreated }: { onCreated: (id: string) => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [tenantKey, setTenantKey] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [contact, setContact] = useState('');
  const [discordUserId, setDiscordUserId] = useState('');
  const [link, setLink] = useState<InvitationCreated | null>(null);
  const create = useMutation({
    mutationFn: async () => {
      const tenant = await systemApi.createTenant({
        tenantKey,
        displayName,
        ...(contact.trim() ? { contact: contact.trim() } : {}),
      });
      const invitation = await systemApi.ownerInvitation(tenant.id, {
        id: newId(),
        ...(discordUserId ? { discordUserId } : {}),
      });
      return { tenant, invitation };
    },
    onSuccess: ({ tenant, invitation }) => {
      setLink(invitation);
      setTenantKey('');
      setDisplayName('');
      setContact('');
      setDiscordUserId('');
      onCreated(tenant.id);
    },
    onSettled: () => client.invalidateQueries({ queryKey: TENANTS_KEY }),
  });
  const keyInvalid =
    tenantKey !== '' && (!TENANT_KEY_PATTERN.test(tenantKey) || tenantKey === 'system');
  const idInvalid = discordUserId !== '' && !DISCORD_ID_PATTERN.test(discordUserId);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!keyInvalid && !idInvalid && tenantKey && displayName.trim()) create.mutate();
  };
  const Add = actionIcons.add;
  return (
    <section className={styles.panel} aria-labelledby="tenant-create">
      <h2 id="tenant-create">{t('system.tenants.create')}</h2>
      <form className={styles.form} onSubmit={submit} noValidate>
        <div className={styles.row}>
          <div className={styles.field}>
            <label htmlFor="tenant-key">{t('system.tenants.col.key')}</label>
            <input
              id="tenant-key"
              className={styles.input}
              value={tenantKey}
              onChange={(e) => setTenantKey(e.target.value.trim().toLowerCase())}
              aria-invalid={keyInvalid}
              aria-describedby="tenant-key-hint"
              autoComplete="off"
              required
            />
            <span id="tenant-key-hint" className={styles.muted}>
              {t('system.tenants.keyHint')}
            </span>
          </div>
          <div className={styles.field}>
            <label htmlFor="tenant-name">{t('system.tenants.col.name')}</label>
            <input
              id="tenant-name"
              className={styles.input}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={120}
              required
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="tenant-contact">{t('system.tenants.contact')}</label>
            <input
              id="tenant-contact"
              className={styles.input}
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              maxLength={200}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="tenant-owner-discord">{t('admin.bindDiscordId')}</label>
            <input
              id="tenant-owner-discord"
              className={styles.input}
              value={discordUserId}
              onChange={(e) => setDiscordUserId(e.target.value.trim())}
              inputMode="numeric"
              aria-invalid={idInvalid}
              aria-describedby="tenant-owner-discord-hint"
            />
            <span id="tenant-owner-discord-hint" className={styles.muted}>
              {t('admin.bindDiscordIdHint')}
            </span>
          </div>
        </div>
        <div className={styles.actions}>
          <button
            type="submit"
            className={styles.buttonPrimary}
            disabled={
              create.isPending || !tenantKey || !displayName.trim() || keyInvalid || idInvalid
            }
          >
            <Add size={ICON_SIZE.button} aria-hidden />
            {t('system.tenants.createSubmit')}
          </button>
        </div>
      </form>
      {create.isError ? <ProblemMessage code={problemCode(create.error)} /> : null}
      {link ? (
        <InvitationLinkBox link={link.link} expiresAt={link.expiresAt} zone={SYSTEM_TIMEZONE} />
      ) : null}
    </section>
  );
}

function TenantDetail({ tenant, onDeleted }: { tenant: TenantAdmin; onDeleted: () => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: TENANTS_KEY });
  const lock = useConfirm(async () => {
    await systemApi.setTenantStatus(tenant.id, 'locked');
    await refresh();
  });
  const unlock = useMutation({
    mutationFn: () => systemApi.setTenantStatus(tenant.id, 'active'),
    onSettled: refresh,
  });
  const remove = useConfirm(async () => {
    await systemApi.deleteTenant(tenant.id, tenant.tenantKey);
    onDeleted();
    await refresh();
  });
  const Lock = actionIcons.lock;
  const Unlock = actionIcons.unlock;
  const Delete = actionIcons.delete;
  return (
    <section className={styles.panel} aria-labelledby="tenant-detail">
      <div className={styles.head}>
        <h2 id="tenant-detail">
          {tenant.displayName} <span className={styles.muted}>({tenant.tenantKey})</span>
        </h2>
        <StatusPill status={tenant.status} />
      </div>
      <p className={styles.muted}>
        {t('system.tenants.createdAt')} <DateTime at={tenant.createdAt} zone={SYSTEM_TIMEZONE} />
        {tenant.contact ? ` · ${tenant.contact}` : ''}
      </p>
      <p className={styles.muted}>
        {t('system.tenants.col.storage')}: <StorageValue tenant={tenant} />
        {tenant.storageMeasuredAt ? (
          <>
            {' '}
            ({t('system.tenants.storageAt')}{' '}
            <DateTime at={tenant.storageMeasuredAt} zone={SYSTEM_TIMEZONE} />)
          </>
        ) : null}
      </p>

      <div className={styles.section}>
        <h3>{t('system.tenants.statusSection')}</h3>
        <div className={styles.actions}>
          {tenant.status === 'active' ? (
            <button type="button" className={styles.button} onClick={lock.open}>
              <Lock size={ICON_SIZE.button} aria-hidden />
              {t('system.tenants.lock')}
            </button>
          ) : (
            <button
              type="button"
              className={styles.button}
              disabled={unlock.isPending}
              onClick={() => unlock.mutate()}
            >
              <Unlock size={ICON_SIZE.button} aria-hidden />
              {t('system.tenants.unlock')}
            </button>
          )}
        </div>
        {unlock.isError ? <ProblemMessage code={problemCode(unlock.error)} /> : null}
      </div>

      <OwnerSection tenant={tenant} />

      <div className={styles.section}>
        <h3>{t('system.tenants.deleteSection')}</h3>
        <p className={styles.muted}>{t('system.tenants.deleteHint')}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.buttonDanger} onClick={remove.open}>
            <Delete size={ICON_SIZE.button} aria-hidden />
            {t('system.tenants.delete')}
          </button>
        </div>
      </div>

      <ConfirmDialog
        {...lock.dialog}
        title={t('system.tenants.lockTitle', { name: tenant.displayName })}
        consequence={t('system.tenants.lockConsequence')}
        confirmLabel={t('system.tenants.lock')}
      />
      <ConfirmDialog
        {...remove.dialog}
        variant="danger"
        confirmName={tenant.tenantKey}
        title={t('system.tenants.deleteTitle', { name: tenant.displayName })}
        consequence={t('system.tenants.deleteConsequence')}
        confirmLabel={t('system.tenants.delete')}
      />
    </section>
  );
}

/** Owner-Einladung (Owner ausstehend oder zusätzlich) und Notfall-Neuzuweisung (FA-SU-05). */
function OwnerSection({ tenant }: { tenant: TenantAdmin }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [discordUserId, setDiscordUserId] = useState('');
  const [link, setLink] = useState<InvitationCreated | null>(null);
  const [target, setTarget] = useState<string>('');
  const [reason, setReason] = useState('');
  const [keepPrevious, setKeepPrevious] = useState(true);
  const members = useQuery({
    queryKey: ['system', 'tenants', tenant.id, 'members'],
    queryFn: () => systemApi.tenantMembers(tenant.id),
    enabled: tenant.ownerMemberId !== null,
  });
  const invite = useMutation({
    mutationFn: () =>
      systemApi.ownerInvitation(tenant.id, {
        id: newId(),
        ...(discordUserId ? { discordUserId } : {}),
      }),
    onSuccess: (inv) => {
      setLink(inv);
      setDiscordUserId('');
    },
  });
  const reassign = useConfirm(async () => {
    const res = await systemApi.reassignOwner(
      tenant.id,
      target === 'invite'
        ? {
            invite: { id: newId(), ...(discordUserId ? { discordUserId } : {}) },
            reason: reason.trim(),
            keepPreviousAsAdmin: keepPrevious,
          }
        : { memberId: target, reason: reason.trim(), keepPreviousAsAdmin: keepPrevious },
    );
    if (res.invitation) setLink(res.invitation);
    setReason('');
    setTarget('');
    await client.invalidateQueries({ queryKey: TENANTS_KEY });
  });
  const idInvalid = discordUserId !== '' && !DISCORD_ID_PATTERN.test(discordUserId);
  const candidates = (members.data?.members ?? []).filter(
    (m) => m.status === 'active' && m.id !== tenant.ownerMemberId,
  );
  const targetName =
    target === 'invite'
      ? t('system.tenants.reassignInvite')
      : (candidates.find((m) => m.id === target)?.displayName ?? '');
  const Invite = actionIcons.invite;
  const Crown = actionIcons.transferOwner;
  return (
    <div className={styles.section}>
      <h3>{t('system.tenants.ownerSection')}</h3>
      <p>
        {tenant.ownerDisplayName ?? (
          <span className={styles.pillWarn}>{t('system.tenants.ownerPending')}</span>
        )}
      </p>
      {tenant.ownerMemberId === null ? (
        <div className={styles.row}>
          <div className={styles.field}>
            <label htmlFor="owner-discord">{t('admin.bindDiscordId')}</label>
            <input
              id="owner-discord"
              className={styles.input}
              value={discordUserId}
              onChange={(e) => setDiscordUserId(e.target.value.trim())}
              inputMode="numeric"
              aria-invalid={idInvalid}
            />
          </div>
          <button
            type="button"
            className={styles.button}
            disabled={invite.isPending || idInvalid}
            onClick={() => invite.mutate()}
          >
            <Invite size={ICON_SIZE.button} aria-hidden />
            {t('system.tenants.ownerInvite')}
          </button>
        </div>
      ) : null}
      {invite.isError ? <ProblemMessage code={problemCode(invite.error)} /> : null}
      {link ? (
        <InvitationLinkBox link={link.link} expiresAt={link.expiresAt} zone={SYSTEM_TIMEZONE} />
      ) : null}

      {tenant.ownerMemberId !== null ? (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            if (target && reason.trim() && !idInvalid) reassign.open();
          }}
        >
          <p className={styles.muted}>{t('system.tenants.reassignHint')}</p>
          <div className={styles.field}>
            <label htmlFor="owner-target">{t('system.tenants.reassignTarget')}</label>
            <select
              id="owner-target"
              className={styles.input}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">{t('system.tenants.reassignChoose')}</option>
              {candidates.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} ({t(`appBar.role.${m.role}`)})
                </option>
              ))}
              <option value="invite">{t('system.tenants.reassignInvite')}</option>
            </select>
          </div>
          {target === 'invite' ? (
            <div className={styles.field}>
              <label htmlFor="owner-discord">{t('admin.bindDiscordId')}</label>
              <input
                id="owner-discord"
                className={styles.input}
                value={discordUserId}
                onChange={(e) => setDiscordUserId(e.target.value.trim())}
                inputMode="numeric"
                aria-invalid={idInvalid}
              />
            </div>
          ) : null}
          <div className={styles.field}>
            <label htmlFor="owner-reason">{t('system.tenants.reason')}</label>
            <textarea
              id="owner-reason"
              className={styles.input}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              required
            />
          </div>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={keepPrevious}
              onChange={(e) => setKeepPrevious(e.target.checked)}
            />
            {t('system.tenants.keepPrevious')}
          </label>
          <div className={styles.actions}>
            <button
              type="submit"
              className={styles.button}
              disabled={!target || !reason.trim() || idInvalid}
            >
              <Crown size={ICON_SIZE.button} aria-hidden />
              {t('system.tenants.reassign')}
            </button>
          </div>
        </form>
      ) : null}
      <ConfirmDialog
        {...reassign.dialog}
        title={t('system.tenants.reassignTitle', { name: tenant.displayName })}
        consequence={t('system.tenants.reassignConsequence', { target: targetName })}
        confirmLabel={t('system.tenants.reassign')}
      />
    </div>
  );
}
