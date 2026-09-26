/**
 * S-81 Super User (FA-SU-06): Liste, hinzufügen über die Discord-User-ID, deaktivieren/reaktivieren,
 * entfernen (der letzte aktive ist geschützt, `super_user.last_protected`). Dazu: Identität systemweit
 * sperren (FA-LOG-05) – Sperren beendet alle Sitzungen und läuft über den `ConfirmDialog`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { systemApi, type IdentityAdmin, type SuperUser } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { ICON_SIZE, actionIcons } from '../../components/icons';
import { ProblemMessage } from '../../components/ProblemMessage';
import { SYSTEM_TIMEZONE } from '../../lib/time';
import styles from '../admin/admin.module.css';
import { DateTime, problemCode, useConfirm } from '../admin/shared';
import { SystemLayout } from './SystemLayout';

const SUPER_USERS_KEY = ['system', 'super-users'] as const;
const DISCORD_ID_PATTERN = /^\d{5,25}$/;

export function SuperUsersPage() {
  const { t } = useTranslation();
  return (
    <SystemLayout title={t('system.superUsers.title')}>
      <SuperUserList />
      <IdentityBlock />
    </SystemLayout>
  );
}

function SuperUserList() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const list = useQuery({ queryKey: SUPER_USERS_KEY, queryFn: () => systemApi.superUsers() });
  const [discordUserId, setDiscordUserId] = useState('');
  const add = useMutation({
    mutationFn: () => systemApi.addSuperUser(discordUserId),
    onSuccess: () => setDiscordUserId(''),
    onSettled: () => client.invalidateQueries({ queryKey: SUPER_USERS_KEY }),
  });
  const invalid = discordUserId !== '' && !DISCORD_ID_PATTERN.test(discordUserId);
  const Add = actionIcons.add;
  const columns: DataColumn<SuperUser>[] = [
    {
      id: 'name',
      header: t('system.superUsers.col.name'),
      sortValue: (u) => u.discordUsername,
      cell: (u) => u.discordUsername,
    },
    {
      id: 'discordId',
      header: t('system.superUsers.col.discordId'),
      sortValue: (u) => u.discordUserId,
      priority: 3,
      className: styles.code,
      cell: (u) => u.discordUserId,
    },
    {
      id: 'mfa',
      header: t('system.superUsers.col.mfa'),
      sortValue: (u) => u.mfa,
      priority: 2,
      cell: (u) => (
        <span className={u.mfa ? styles.pillOk : styles.pillWarn}>
          {u.mfa ? t('admin.mfaOn') : t('admin.mfaOff')}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('system.superUsers.col.status'),
      sortValue: (u) => t(`system.superUsers.status.${u.status}`),
      cell: (u) => (
        <span className={u.status === 'active' ? styles.pillOk : styles.pill}>
          {t(`system.superUsers.status.${u.status}`)}
        </span>
      ),
    },
    {
      id: 'since',
      header: t('system.superUsers.col.since'),
      sortValue: (u) => u.createdAt,
      priority: 2,
      nowrap: true,
      cell: (u) => <DateTime at={u.createdAt} zone={SYSTEM_TIMEZONE} />,
    },
    {
      id: 'actions',
      header: t('system.superUsers.col.actions'),
      headerHidden: true,
      cell: (u) => <SuperUserActions user={u} />,
    },
  ];
  return (
    <section className={styles.panel} aria-labelledby="super-users">
      <h2 id="super-users">{t('system.superUsers.list')}</h2>
      {list.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : list.isError ? (
        <ProblemMessage code={problemCode(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={list.data.superUsers}
          rowKey={(u) => u.identityId}
          rowLabel={(u) => u.discordUsername}
          label={t('system.superUsers.list')}
        />
      )}
      <form
        className={styles.row}
        onSubmit={(e) => {
          e.preventDefault();
          if (discordUserId && !invalid) add.mutate();
        }}
      >
        <div className={styles.field}>
          <label htmlFor="super-user-add">{t('system.superUsers.addLabel')}</label>
          <input
            id="super-user-add"
            className={styles.input}
            value={discordUserId}
            onChange={(e) => setDiscordUserId(e.target.value.trim())}
            inputMode="numeric"
            aria-invalid={invalid}
            aria-describedby="super-user-add-hint"
          />
          <span id="super-user-add-hint" className={styles.muted}>
            {t('system.superUsers.addHint')}
          </span>
        </div>
        <button
          type="submit"
          className={styles.buttonPrimary}
          disabled={!discordUserId || invalid || add.isPending}
        >
          <Add size={ICON_SIZE.button} aria-hidden />
          {t('system.superUsers.add')}
        </button>
      </form>
      {add.isError ? <ProblemMessage code={problemCode(add.error)} /> : null}
    </section>
  );
}

/** Aktionen einer Zeile: deaktivieren/reaktivieren, entfernen (mit `ConfirmDialog`). */
function SuperUserActions({ user }: { user: SuperUser }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: SUPER_USERS_KEY });
  const disable = useConfirm(async () => {
    await systemApi.setSuperUserStatus(user.identityId, 'disabled');
    await refresh();
  });
  const remove = useConfirm(async () => {
    await systemApi.removeSuperUser(user.identityId);
    await refresh();
  });
  const enable = useMutation({
    mutationFn: () => systemApi.setSuperUserStatus(user.identityId, 'active'),
    onSettled: refresh,
  });
  return (
    <>
      <div className={styles.actions}>
        {user.status === 'active' ? (
          <button type="button" className={styles.button} onClick={disable.open}>
            {t('system.superUsers.disable')}
          </button>
        ) : (
          <button
            type="button"
            className={styles.button}
            disabled={enable.isPending}
            onClick={() => enable.mutate()}
          >
            {t('system.superUsers.enable')}
          </button>
        )}
        <button type="button" className={styles.buttonDanger} onClick={remove.open}>
          {t('system.superUsers.remove')}
        </button>
      </div>
      <ConfirmDialog
        {...disable.dialog}
        title={t('system.superUsers.disableTitle', { name: user.discordUsername })}
        consequence={t('system.superUsers.disableConsequence')}
        confirmLabel={t('system.superUsers.disable')}
      />
      <ConfirmDialog
        {...remove.dialog}
        variant="danger"
        title={t('system.superUsers.removeTitle', { name: user.discordUsername })}
        consequence={t('system.superUsers.removeConsequence')}
        confirmLabel={t('system.superUsers.remove')}
      />
    </>
  );
}

/** Identität systemweit sperren/entsperren (FA-LOG-05). */
function IdentityBlock() {
  const { t } = useTranslation();
  const [discordUserId, setDiscordUserId] = useState('');
  const [found, setFound] = useState<IdentityAdmin | null>(null);
  const lookup = useMutation({
    mutationFn: () => systemApi.identity(discordUserId),
    onSuccess: setFound,
    onError: () => setFound(null),
  });
  const block = useConfirm(async () => {
    if (!found) return;
    await systemApi.setIdentityStatus(found.id, 'blocked');
    setFound({ ...found, status: 'blocked' });
  });
  const unblock = useMutation({
    mutationFn: (id: string) => systemApi.setIdentityStatus(id, 'active'),
    onSuccess: () => found && setFound({ ...found, status: 'active' }),
  });
  const invalid = discordUserId !== '' && !DISCORD_ID_PATTERN.test(discordUserId);
  const Lock = actionIcons.lock;
  const Unlock = actionIcons.unlock;
  return (
    <section className={styles.panel} aria-labelledby="identity-block">
      <h2 id="identity-block">{t('system.identity.title')}</h2>
      <p className={styles.muted}>{t('system.identity.hint')}</p>
      <form
        className={styles.row}
        onSubmit={(e) => {
          e.preventDefault();
          if (discordUserId && !invalid) lookup.mutate();
        }}
      >
        <div className={styles.field}>
          <label htmlFor="identity-discord">{t('system.superUsers.col.discordId')}</label>
          <input
            id="identity-discord"
            className={styles.input}
            value={discordUserId}
            onChange={(e) => setDiscordUserId(e.target.value.trim())}
            inputMode="numeric"
            aria-invalid={invalid}
          />
        </div>
        <button type="submit" className={styles.button} disabled={!discordUserId || invalid}>
          {t('system.identity.find')}
        </button>
      </form>
      {lookup.isError ? <ProblemMessage code={problemCode(lookup.error)} /> : null}
      {found ? (
        <div className={styles.linkBox}>
          <p>
            <strong>{found.globalName ?? found.discordUsername}</strong>{' '}
            <span className={styles.muted}>
              @{found.discordUsername} · {found.discordUserId}
            </span>
          </p>
          <p className={styles.muted}>
            {t('system.identity.lastLogin')}{' '}
            <DateTime at={found.lastLoginAt} zone={SYSTEM_TIMEZONE} />
            {found.isSuperUser ? ` · ${t('appBar.role.system')}` : ''}
          </p>
          <p>
            <span className={found.status === 'active' ? styles.pillOk : styles.pillDanger}>
              {t(`system.identity.status.${found.status}`)}
            </span>
          </p>
          <div className={styles.actions}>
            {found.status === 'active' ? (
              <button type="button" className={styles.buttonDanger} onClick={block.open}>
                <Lock size={ICON_SIZE.button} aria-hidden />
                {t('system.identity.block')}
              </button>
            ) : (
              <button
                type="button"
                className={styles.button}
                disabled={unblock.isPending}
                onClick={() => unblock.mutate(found.id)}
              >
                <Unlock size={ICON_SIZE.button} aria-hidden />
                {t('system.identity.unblock')}
              </button>
            )}
          </div>
          <ConfirmDialog
            {...block.dialog}
            variant="danger"
            title={t('system.identity.blockTitle', { name: found.discordUsername })}
            consequence={t('system.identity.blockConsequence')}
            confirmLabel={t('system.identity.block')}
          />
        </div>
      ) : null}
    </section>
  );
}
