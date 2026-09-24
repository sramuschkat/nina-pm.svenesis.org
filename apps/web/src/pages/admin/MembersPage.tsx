/**
 * S-70 Mitglieder & Einladungen (FA-BEN-01…11, FK 14.3): Liste mit Owner-Kennzeichen und Hinweis
 * „Rechte ruhen – 2FA fehlt“; User einladen (Admin/Owner), Admin einladen (nur Owner); *Zu Admin machen*
 * mit Grund und *Admin-Rechte entziehen* nur für den Owner; Sitzungen beenden, deaktivieren, entfernen –
 * folgenreiche Aktionen über den `ConfirmDialog` (E4). Die Rechte entscheidet `can()`; die API prüft erneut.
 */
import { can } from '@nina-pm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { memberApi, type Invitation, type InvitationCreated, type Member } from '../../api/client';
import { useAuth } from '../../auth';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ICON_SIZE, actionIcons } from '../../components/icons';
import { ProblemMessage } from '../../components/ProblemMessage';
import styles from './admin.module.css';
import { AdminLayout } from './AdminLayout';
import { DateTime, InvitationLinkBox, newId, problemCode, useConfirm } from './shared';

const MEMBERS_KEY = ['members'] as const;
const INVITATIONS_KEY = ['invitations'] as const;
const DISCORD_ID_PATTERN = /^\d{5,25}$/;

/** Rechte des angemeldeten Mitglieds gegenüber einem Ziel (dieselbe Funktion wie die API, TK 5.5). */
function useMemberRights() {
  const { context, me } = useAuth();
  const self = me?.member?.id;
  const isOwner = can(context, 'member.admin.manage');
  const canAct = (m: Member) => {
    if (m.role === 'owner' || m.id === self) return false;
    return m.role === 'admin'
      ? can(context, 'member.admin.manage', { targetMemberId: m.id, targetRole: 'admin' })
      : can(context, 'member.manage', { targetMemberId: m.id, targetRole: 'user' });
  };
  return { isOwner, canAct, zone: me?.tenant?.timeZone ?? 'Europe/Berlin' };
}

export function MembersPage() {
  const { t } = useTranslation();
  const members = useQuery({ queryKey: MEMBERS_KEY, queryFn: () => memberApi.list() });
  const [selected, setSelected] = useState<string | null>(null);
  const list = members.data?.members ?? [];
  const current = list.find((m) => m.id === selected);
  return (
    <AdminLayout title={t('admin.members.title')}>
      <InvitePanel />
      <div className={styles.split}>
        <section className={styles.panel} aria-labelledby="member-list">
          <h2 id="member-list">{t('admin.members.list')}</h2>
          {members.isPending ? (
            <p role="status">{t('common.loading')}</p>
          ) : members.isError ? (
            <ProblemMessage
              code={problemCode(members.error)}
              onRetry={() => void members.refetch()}
            />
          ) : list.length === 0 ? (
            <p className={styles.muted}>{t('admin.members.empty')}</p>
          ) : (
            <MemberTable members={list} selected={selected} onSelect={setSelected} />
          )}
        </section>
        {current ? (
          <MemberDetail key={current.id} member={current} onRemoved={() => setSelected(null)} />
        ) : (
          <section className={styles.panel}>
            <p className={styles.muted}>{t('admin.members.selectHint')}</p>
          </section>
        )}
      </div>
      <InvitationList />
    </AdminLayout>
  );
}

function RolePill({ role }: { role: Member['role'] }) {
  const { t } = useTranslation();
  return (
    <span className={role === 'owner' ? styles.pillOk : styles.pill}>
      {t(`appBar.role.${role}`)}
    </span>
  );
}

function MemberTable({
  members,
  selected,
  onSelect,
}: {
  members: readonly Member[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { zone } = useMemberRights();
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{t('admin.members.col.name')}</th>
            <th scope="col">{t('admin.members.col.discord')}</th>
            <th scope="col">{t('admin.members.col.role')}</th>
            <th scope="col">{t('admin.members.col.status')}</th>
            <th scope="col">{t('admin.members.col.mfa')}</th>
            <th scope="col">{t('admin.members.col.lastLogin')}</th>
            <th scope="col" title={t('admin.members.objectsHint')}>
              {t('admin.members.col.objects')}
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id} aria-selected={m.id === selected}>
              <td>
                <button type="button" className={styles.rowButton} onClick={() => onSelect(m.id)}>
                  {m.displayName}
                </button>
              </td>
              <td>@{m.discordUsername}</td>
              <td>
                <RolePill role={m.role} />
                {m.rightsDormant ? (
                  <>
                    {' '}
                    <span className={styles.pillWarn}>{t('admin.members.rightsDormant')}</span>
                  </>
                ) : null}
              </td>
              <td>
                <span className={m.status === 'active' ? styles.pillOk : styles.pill}>
                  {t(`admin.members.status.${m.status}`)}
                </span>
              </td>
              <td>{m.mfa ? t('admin.mfaOn') : t('admin.mfaOff')}</td>
              <td>
                <DateTime at={m.lastLoginAt} zone={zone} />
              </td>
              <td>
                {t('admin.members.objectsValue', {
                  draft: m.objects.draft,
                  submitted: m.objects.submitted,
                  approved: m.objects.approved,
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MemberDetail({ member, onRemoved }: { member: Member; onRemoved: () => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const { isOwner, canAct } = useMemberRights();
  const refresh = () => client.invalidateQueries({ queryKey: MEMBERS_KEY });
  const [displayName, setDisplayName] = useState(member.displayName);
  const [reason, setReason] = useState('');
  const rename = useMutation({
    mutationFn: () => memberApi.patch(member.id, { displayName: displayName.trim() }),
    onSettled: refresh,
  });
  const promote = useMutation({
    mutationFn: () => memberApi.setRole(member.id, 'admin', reason.trim() || undefined),
    onSuccess: () => setReason(''),
    onSettled: refresh,
  });
  const reactivate = useMutation({
    mutationFn: () => memberApi.patch(member.id, { status: 'active' }),
    onSettled: refresh,
  });
  const demote = useConfirm(async () => {
    await memberApi.setRole(member.id, 'user');
    await refresh();
  });
  const endSessions = useConfirm(() => memberApi.endSessions(member.id));
  const disable = useConfirm(async () => {
    await memberApi.patch(member.id, { status: 'disabled' });
    await refresh();
  });
  const remove = useConfirm(async () => {
    await memberApi.remove(member.id);
    onRemoved();
    await refresh();
  });
  const allowed = canAct(member);
  const error = rename.error ?? promote.error ?? reactivate.error;
  const Crown = actionIcons.transferOwner;
  const Delete = actionIcons.delete;
  return (
    <section className={styles.panel} aria-labelledby="member-detail">
      <div className={styles.head}>
        <h2 id="member-detail">{member.displayName}</h2>
        <RolePill role={member.role} />
      </div>
      <p className={styles.muted}>@{member.discordUsername}</p>
      {member.rightsDormant ? (
        <p className={styles.pillWarn}>{t('admin.members.rightsDormantLong')}</p>
      ) : null}
      {!allowed ? (
        <p className={styles.muted}>
          {member.role === 'owner'
            ? t('admin.members.ownerProtected')
            : t('admin.members.noActions')}
        </p>
      ) : (
        <>
          <form
            className={`${styles.section} ${styles.form}`}
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (displayName.trim() && displayName.trim() !== member.displayName) rename.mutate();
            }}
          >
            <div className={styles.row}>
              <div className={styles.field}>
                <label htmlFor="member-name">{t('admin.members.displayName')}</label>
                <input
                  id="member-name"
                  className={styles.input}
                  value={displayName}
                  maxLength={80}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
              <button
                type="submit"
                className={styles.button}
                disabled={rename.isPending || !displayName.trim()}
              >
                {t('admin.members.rename')}
              </button>
            </div>
          </form>

          {isOwner && member.role === 'user' && member.status === 'active' ? (
            <form
              className={`${styles.section} ${styles.form}`}
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                promote.mutate();
              }}
            >
              <h3>{t('admin.members.promote')}</h3>
              <div className={styles.field}>
                <label htmlFor="promote-reason">{t('admin.members.reason')}</label>
                <textarea
                  id="promote-reason"
                  className={styles.input}
                  value={reason}
                  maxLength={500}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              <div className={styles.actions}>
                <button type="submit" className={styles.button} disabled={promote.isPending}>
                  <Crown size={ICON_SIZE.button} aria-hidden />
                  {t('admin.members.promote')}
                </button>
              </div>
            </form>
          ) : null}

          <div className={styles.section}>
            <h3>{t('admin.members.access')}</h3>
            <div className={styles.actions}>
              {isOwner && member.role === 'admin' ? (
                <button type="button" className={styles.buttonDanger} onClick={demote.open}>
                  {t('admin.members.demote')}
                </button>
              ) : null}
              <button type="button" className={styles.button} onClick={endSessions.open}>
                {t('admin.members.endSessions')}
              </button>
              {member.status === 'active' ? (
                <button type="button" className={styles.buttonDanger} onClick={disable.open}>
                  {t('admin.members.disable')}
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.button}
                  disabled={reactivate.isPending}
                  onClick={() => reactivate.mutate()}
                >
                  {t('admin.members.reactivate')}
                </button>
              )}
              <button type="button" className={styles.buttonDanger} onClick={remove.open}>
                <Delete size={ICON_SIZE.button} aria-hidden />
                {t('admin.members.remove')}
              </button>
            </div>
          </div>
        </>
      )}
      {error ? <ProblemMessage code={problemCode(error)} /> : null}
      <ConfirmDialog
        {...demote.dialog}
        variant="danger"
        title={t('admin.members.demoteTitle', { name: member.displayName })}
        consequence={t('admin.members.demoteConsequence')}
        confirmLabel={t('admin.members.demote')}
      />
      <ConfirmDialog
        {...endSessions.dialog}
        title={t('admin.members.endSessionsTitle', { name: member.displayName })}
        consequence={t('admin.members.endSessionsConsequence')}
        confirmLabel={t('admin.members.endSessions')}
      />
      <ConfirmDialog
        {...disable.dialog}
        variant="danger"
        title={t('admin.members.disableTitle', { name: member.displayName })}
        consequence={t('admin.members.disableConsequence')}
        confirmLabel={t('admin.members.disable')}
      />
      <ConfirmDialog
        {...remove.dialog}
        variant="danger"
        title={t('admin.members.removeTitle', { name: member.displayName })}
        consequence={t('admin.members.removeConsequence')}
        confirmLabel={t('admin.members.remove')}
      />
    </section>
  );
}

/** User einladen (Admin/Owner) bzw. Admin einladen (nur Owner, eine Nutzung) – FA-BEN-01, SEC-50. */
function InvitePanel() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const { isOwner, zone } = useMemberRights();
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [discordUserId, setDiscordUserId] = useState('');
  const [validDays, setValidDays] = useState(7);
  const [maxUses, setMaxUses] = useState(1);
  const [note, setNote] = useState('');
  const [link, setLink] = useState<InvitationCreated | null>(null);
  const invite = useMutation({
    mutationFn: () =>
      memberApi.invite(role, {
        id: newId(),
        validDays,
        ...(role === 'user' ? { maxUses } : {}),
        ...(discordUserId ? { discordUserId } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: (inv) => {
      setLink(inv);
      setDiscordUserId('');
      setNote('');
    },
    onSettled: () => client.invalidateQueries({ queryKey: INVITATIONS_KEY }),
  });
  const idInvalid = discordUserId !== '' && !DISCORD_ID_PATTERN.test(discordUserId);
  const Invite = actionIcons.invite;
  return (
    <section className={styles.panel} aria-labelledby="invite">
      <h2 id="invite">{t('admin.invite.title')}</h2>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (!idInvalid) invite.mutate();
        }}
      >
        {isOwner ? (
          <fieldset className={`${styles.row} ${styles.fieldset}`}>
            <legend className={styles.label}>{t('admin.invite.role')}</legend>
            <label className={styles.check}>
              <input
                type="radio"
                name="invite-role"
                checked={role === 'user'}
                onChange={() => setRole('user')}
              />
              {t('appBar.role.user')}
            </label>
            <label className={styles.check}>
              <input
                type="radio"
                name="invite-role"
                checked={role === 'admin'}
                onChange={() => {
                  setRole('admin');
                  setMaxUses(1);
                }}
              />
              {t('appBar.role.admin')}
            </label>
          </fieldset>
        ) : null}
        <div className={styles.row}>
          <div className={styles.field}>
            <label htmlFor="invite-discord">{t('admin.bindDiscordId')}</label>
            <input
              id="invite-discord"
              className={styles.input}
              value={discordUserId}
              inputMode="numeric"
              aria-invalid={idInvalid}
              onChange={(e) => setDiscordUserId(e.target.value.trim())}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="invite-days">{t('admin.invite.validDays')}</label>
            <input
              id="invite-days"
              type="number"
              min={1}
              max={30}
              className={styles.input}
              value={validDays}
              onChange={(e) => setValidDays(Math.min(30, Math.max(1, Number(e.target.value) || 1)))}
            />
          </div>
          {role === 'user' ? (
            <div className={styles.field}>
              <label htmlFor="invite-uses">{t('admin.invite.maxUses')}</label>
              <input
                id="invite-uses"
                type="number"
                min={1}
                max={50}
                className={styles.input}
                value={maxUses}
                onChange={(e) => setMaxUses(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
              />
            </div>
          ) : null}
          <div className={styles.field}>
            <label htmlFor="invite-note">{t('admin.invite.note')}</label>
            <input
              id="invite-note"
              className={styles.input}
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <div className={styles.actions}>
          <button
            type="submit"
            className={styles.buttonPrimary}
            disabled={invite.isPending || idInvalid}
          >
            <Invite size={ICON_SIZE.button} aria-hidden />
            {role === 'admin' ? t('admin.invite.submitAdmin') : t('admin.invite.submitUser')}
          </button>
        </div>
      </form>
      {invite.isError ? <ProblemMessage code={problemCode(invite.error)} /> : null}
      {link ? <InvitationLinkBox link={link.link} expiresAt={link.expiresAt} zone={zone} /> : null}
    </section>
  );
}

function InvitationList() {
  const { t } = useTranslation();
  const invitations = useQuery({
    queryKey: INVITATIONS_KEY,
    queryFn: () => memberApi.invitations(),
  });
  const nowMs = Date.now();
  const open = (invitations.data?.invitations ?? []).filter(
    (i) => i.revokedAt === null && Date.parse(i.expiresAt) > nowMs && i.usedCount < i.maxUses,
  );
  return (
    <section className={styles.panel} aria-labelledby="invitations">
      <h2 id="invitations">{t('admin.invite.open')}</h2>
      {invitations.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : invitations.isError ? (
        <ProblemMessage
          code={problemCode(invitations.error)}
          onRetry={() => void invitations.refetch()}
        />
      ) : open.length === 0 ? (
        <p className={styles.muted}>{t('admin.invite.none')}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t('admin.invite.role')}</th>
                <th scope="col">{t('admin.invite.boundTo')}</th>
                <th scope="col">{t('admin.invite.uses')}</th>
                <th scope="col">{t('admin.invite.expires')}</th>
                <th scope="col">{t('admin.invite.note')}</th>
                <th scope="col">
                  <span className={styles.muted}>{t('system.superUsers.col.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {open.map((i) => (
                <InvitationRow key={i.id} invitation={i} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function InvitationRow({ invitation }: { invitation: Invitation }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const { isOwner, zone } = useMemberRights();
  const revoke = useConfirm(async () => {
    await memberApi.revokeInvitation(invitation.id);
    await client.invalidateQueries({ queryKey: INVITATIONS_KEY });
  });
  return (
    <tr>
      <td>{t(`appBar.role.${invitation.role}`)}</td>
      <td className={styles.code}>{invitation.discordUserId ?? '–'}</td>
      <td>
        {invitation.usedCount}/{invitation.maxUses}
      </td>
      <td>
        <DateTime at={invitation.expiresAt} zone={zone} />
      </td>
      <td className={styles.details}>{invitation.note ?? ''}</td>
      <td>
        {!invitation.ownerOnly || isOwner ? (
          <button type="button" className={styles.buttonDanger} onClick={revoke.open}>
            {t('admin.invite.revoke')}
          </button>
        ) : (
          <span className={styles.muted}>{t('admin.invite.ownerOnly')}</span>
        )}
        <ConfirmDialog
          {...revoke.dialog}
          variant="danger"
          title={t('admin.invite.revokeTitle')}
          consequence={t('admin.invite.revokeConsequence')}
          confirmLabel={t('admin.invite.revoke')}
        />
      </td>
    </tr>
  );
}
