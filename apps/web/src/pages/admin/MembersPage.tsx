/**
 * S-70 Mitglieder & Einladungen (FA-BEN-01…11, FK 14.3, AP-26b): Die Mitgliederliste steht im Mittelpunkt –
 * Reiter *Mitglieder* (Liste mit Owner-Kennzeichen und Hinweis „Rechte ruhen – 2FA fehlt“, daneben bzw.
 * darunter das gewählte Mitglied) und *Offene Einladungen* (mit Anzahl). *Einladen* (User: Admin/Owner,
 * Admin: nur Owner) und *Owner übertragen* (nur Owner) öffnen Dialoge aus dem Seitenkopf. *Zu Admin
 * machen* mit Grund und *Admin-Rechte entziehen* nur für den Owner; Sitzungen beenden, deaktivieren,
 * entfernen – folgenreiche Aktionen über den `ConfirmDialog` (E4). Die Rechte entscheidet `can()`; die API
 * prüft erneut.
 */
import { can } from '@nina-pm/shared';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  memberApi,
  tenantApi,
  type Invitation,
  type InvitationCreated,
  type Member,
} from '../../api/client';
import { useAuth } from '../../auth';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { ICON_SIZE, actionIcons } from '../../components/icons';
import { ProblemMessage } from '../../components/ProblemMessage';
import { Tabs } from '../../components/Tabs';
import styles from './admin.module.css';
import { AdminLayout } from './AdminLayout';
import local from './members.module.css';
import { DateTime, InvitationLinkBox, newId, problemCode, useConfirm } from './shared';

const MEMBERS_KEY = ['members'] as const;
const INVITATIONS_KEY = ['invitations'] as const;
const DISCORD_ID_PATTERN = /^\d{5,25}$/;

type MembersTab = 'members' | 'invitations';

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

/** Offene Einladungen: nicht widerrufen, nicht abgelaufen, nicht aufgebraucht (`null` = noch nicht geladen). */
function useOpenInvitations() {
  const query = useQuery({ queryKey: INVITATIONS_KEY, queryFn: () => memberApi.invitations() });
  const nowMs = Date.now();
  const open = query.data
    ? query.data.invitations.filter(
        (i) => i.revokedAt === null && Date.parse(i.expiresAt) > nowMs && i.usedCount < i.maxUses,
      )
    : null;
  return { query, open };
}

export function MembersPage() {
  const { t } = useTranslation();
  const members = useQuery({ queryKey: MEMBERS_KEY, queryFn: () => memberApi.list() });
  const invitations = useOpenInvitations();
  const [tab, setTab] = useState<MembersTab>('members');
  const [selected, setSelected] = useState<string | null>(null);
  const list = members.data?.members ?? [];
  const current = list.find((m) => m.id === selected);
  return (
    <AdminLayout
      title={t('admin.members.title')}
      actions={
        <>
          <InviteDialog />
          <OwnerTransferDialog members={list} />
        </>
      }
    >
      <Tabs<MembersTab>
        label={t('admin.members.title')}
        tabs={[
          { key: 'members', label: t('admin.members.list') },
          {
            key: 'invitations',
            label: invitations.open
              ? t('admin.invite.openCount', { n: invitations.open.length })
              : t('admin.invite.open'),
          },
        ]}
        value={tab}
        onChange={setTab}
        panelClassName={local.tabPanel}
        panels={{
          members: (
            <div className={styles.split}>
              <div className={styles.panel}>
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
              </div>
              {current ? (
                <MemberDetail
                  key={current.id}
                  member={current}
                  onRemoved={() => setSelected(null)}
                />
              ) : (
                <section className={styles.panel}>
                  <p className={styles.muted}>{t('admin.members.selectHint')}</p>
                </section>
              )}
            </div>
          ),
          invitations: <InvitationList invitations={invitations} />,
        }}
      />
    </AdminLayout>
  );
}

/**
 * Formular-Dialog (Radix `AlertDialog` wie der `ConfirmDialog`, hier mit Rolle `dialog`): Fokus beim Öffnen
 * auf das erste Feld, `Esc` schließt, Klick außerhalb schließt nicht (keine Eingaben verlieren), danach
 * kehrt der Fokus zum auslösenden Knopf zurück.
 */
function FormDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={local.overlay} />
        <AlertDialog.Content
          ref={contentRef}
          role="dialog"
          className={local.dialog}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            contentRef.current
              ?.querySelector<HTMLElement>('input, select, textarea, button')
              ?.focus();
          }}
        >
          <AlertDialog.Title className={local.dialogTitle}>{title}</AlertDialog.Title>
          <AlertDialog.Description className={styles.muted}>{description}</AlertDialog.Description>
          {children}
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/** Knopf *Einladen* im Seitenkopf mit Dialog (FA-BEN-01, SEC-50). */
function InviteDialog() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const Invite = actionIcons.invite;
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      title={t('admin.invite.title')}
      description={t('admin.invite.hint')}
      trigger={
        <button type="button" className={styles.buttonPrimary}>
          <Invite size={ICON_SIZE.button} aria-hidden />
          {t('admin.invite.title')}
        </button>
      }
    >
      <InviteForm />
    </FormDialog>
  );
}

/**
 * User einladen (Admin/Owner) bzw. Admin einladen (nur Owner, eine Nutzung) – FA-BEN-01, SEC-50. Lebt nur,
 * solange der Dialog offen ist; der Einladungslink bleibt bis zum Schließen sichtbar.
 */
function InviteForm() {
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
      {invite.isError ? <ProblemMessage code={problemCode(invite.error)} /> : null}
      {link ? <InvitationLinkBox link={link.link} expiresAt={link.expiresAt} zone={zone} /> : null}
      <div className={local.dialogActions}>
        <AlertDialog.Cancel asChild>
          <button type="button" className={styles.button}>
            {link ? t('admin.invite.close') : t('common.cancel')}
          </button>
        </AlertDialog.Cancel>
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
  );
}

function InvitationList({ invitations }: { invitations: ReturnType<typeof useOpenInvitations> }) {
  const { t } = useTranslation();
  const { query, open } = invitations;
  return (
    <div className={styles.panel}>
      {query.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : query.isError ? (
        <ProblemMessage code={problemCode(query.error)} onRetry={() => void query.refetch()} />
      ) : !open || open.length === 0 ? (
        <p className={styles.muted}>{t('admin.invite.none')}</p>
      ) : (
        <InvitationTable invitations={open} />
      )}
    </div>
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
  const columns: DataColumn<Member>[] = [
    {
      id: 'name',
      header: t('admin.members.col.name'),
      sortValue: (m) => m.displayName,
      cell: (m) => (
        <button type="button" className={styles.rowButton} onClick={() => onSelect(m.id)}>
          {m.displayName}
        </button>
      ),
    },
    {
      id: 'discord',
      header: t('admin.members.col.discord'),
      sortValue: (m) => m.discordUsername,
      priority: 3,
      cell: (m) => `@${m.discordUsername}`,
    },
    {
      id: 'role',
      header: t('admin.members.col.role'),
      sortValue: (m) => t(`appBar.role.${m.role}`),
      cell: (m) => (
        <>
          <RolePill role={m.role} />
          {m.rightsDormant ? (
            <>
              {' '}
              <span className={styles.pillWarn}>{t('admin.members.rightsDormant')}</span>
            </>
          ) : null}
        </>
      ),
    },
    {
      id: 'status',
      header: t('admin.members.col.status'),
      sortValue: (m) => t(`admin.members.status.${m.status}`),
      priority: 2,
      cell: (m) => (
        <span className={m.status === 'active' ? styles.pillOk : styles.pill}>
          {t(`admin.members.status.${m.status}`)}
        </span>
      ),
    },
    {
      id: 'mfa',
      header: t('admin.members.col.mfa'),
      sortValue: (m) => m.mfa,
      priority: 3,
      cell: (m) => (m.mfa ? t('admin.mfaOn') : t('admin.mfaOff')),
    },
    {
      id: 'lastLogin',
      header: t('admin.members.col.lastLogin'),
      sortValue: (m) => m.lastLoginAt,
      priority: 2,
      nowrap: true,
      cell: (m) => <DateTime at={m.lastLoginAt} zone={zone} />,
    },
    {
      id: 'objects',
      header: t('admin.members.col.objects'),
      // Summe aller Objekte des Mitglieds; der Hinweis zur Aufteilung steht am Wert.
      sortValue: (m) => m.objects.draft + m.objects.submitted + m.objects.approved,
      priority: 4,
      nowrap: true,
      cell: (m) => (
        <span title={t('admin.members.objectsHint')}>
          {t('admin.members.objectsValue', {
            draft: m.objects.draft,
            submitted: m.objects.submitted,
            approved: m.objects.approved,
          })}
        </span>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={members}
      rowKey={(m) => m.id}
      rowLabel={(m) => m.displayName}
      label={t('admin.members.list')}
      rowProps={(m) => ({ 'aria-selected': m.id === selected })}
    />
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

function InvitationTable({ invitations }: { invitations: readonly Invitation[] }) {
  const { t } = useTranslation();
  const { zone } = useMemberRights();
  const columns: DataColumn<Invitation>[] = [
    {
      id: 'role',
      header: t('admin.invite.role'),
      sortValue: (i) => t(`appBar.role.${i.role}`),
      cell: (i) => t(`appBar.role.${i.role}`),
    },
    {
      id: 'boundTo',
      header: t('admin.invite.boundTo'),
      sortValue: (i) => i.discordUserId,
      priority: 3,
      className: styles.code,
      cell: (i) => i.discordUserId ?? '–',
    },
    {
      id: 'uses',
      header: t('admin.invite.uses'),
      sortValue: (i) => i.usedCount,
      priority: 2,
      nowrap: true,
      cell: (i) => `${String(i.usedCount)}/${String(i.maxUses)}`,
    },
    {
      id: 'expires',
      header: t('admin.invite.expires'),
      sortValue: (i) => i.expiresAt,
      nowrap: true,
      cell: (i) => <DateTime at={i.expiresAt} zone={zone} />,
    },
    {
      id: 'note',
      header: t('admin.invite.note'),
      sortValue: (i) => i.note,
      priority: 4,
      className: styles.details,
      cell: (i) => i.note ?? '',
    },
    {
      id: 'actions',
      header: t('system.superUsers.col.actions'),
      headerHidden: true,
      nowrap: true,
      cell: (i) => <RevokeInvitation invitation={i} />,
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={invitations}
      rowKey={(i) => i.id}
      rowLabel={(i) => i.discordUserId ?? t(`appBar.role.${i.role}`)}
      label={t('admin.invite.open')}
    />
  );
}

/** Einladung widerrufen (nur Owner bei Admin-Einladungen) mit `ConfirmDialog`. */
function RevokeInvitation({ invitation }: { invitation: Invitation }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const { isOwner } = useMemberRights();
  const revoke = useConfirm(async () => {
    await memberApi.revokeInvitation(invitation.id);
    await client.invalidateQueries({ queryKey: INVITATIONS_KEY });
  });
  return (
    <>
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
    </>
  );
}

/**
 * *Owner übertragen* (FA-BEN-09, E2) – Knopf und Dialog nur für den Owner: an einen aktiven Admin, sofort,
 * mit `ConfirmDialog` („Du bleibst Admin“) über dem Dialog. Danach gelten die neuen Rechte ab der nächsten
 * Anfrage.
 */
function OwnerTransferDialog({ members }: { members: readonly Member[] }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const { context, refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState('');
  const allowed = can(context, 'tenant.owner.transfer');
  const admins = members.filter((m) => m.role === 'admin' && m.status === 'active');
  const name = admins.find((m) => m.id === target)?.displayName ?? '';
  const transfer = useConfirm(async () => {
    await tenantApi.transferOwner(target);
    setTarget('');
    setOpen(false);
    await refresh();
    await client.invalidateQueries({ queryKey: MEMBERS_KEY });
  });
  if (!allowed) return null;
  const Crown = actionIcons.transferOwner;
  const cancel = (
    <AlertDialog.Cancel asChild>
      <button type="button" className={styles.button}>
        {t('common.cancel')}
      </button>
    </AlertDialog.Cancel>
  );
  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setTarget('');
        }}
        title={t('admin.owner.title')}
        description={t('admin.owner.hint')}
        trigger={
          <button type="button" className={styles.button}>
            <Crown size={ICON_SIZE.button} aria-hidden />
            {t('admin.owner.title')}
          </button>
        }
      >
        {admins.length === 0 ? (
          <>
            <p className={styles.muted}>{t('admin.owner.noAdmins')}</p>
            <div className={local.dialogActions}>{cancel}</div>
          </>
        ) : (
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              if (target) transfer.open();
            }}
          >
            <div className={styles.field}>
              <label htmlFor="owner-target">{t('admin.owner.target')}</label>
              <select
                id="owner-target"
                className={styles.input}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">{t('system.tenants.reassignChoose')}</option>
                {admins.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                    {m.rightsDormant ? ` (${t('admin.members.rightsDormant')})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className={local.dialogActions}>
              {cancel}
              <button type="submit" className={styles.buttonPrimary} disabled={!target}>
                <Crown size={ICON_SIZE.button} aria-hidden />
                {t('admin.owner.submit')}
              </button>
            </div>
          </form>
        )}
      </FormDialog>
      <ConfirmDialog
        {...transfer.dialog}
        title={t('admin.owner.confirmTitle', { name })}
        consequence={t('admin.owner.confirmConsequence')}
        confirmLabel={t('admin.owner.submit')}
      />
    </>
  );
}
