/**
 * S-71 Mandanteneinstellungen, Reiter *Discord* (FA-DIS-01…05, FK 14.3, TK 7.2/7.7; AP-60): Server des
 * Mandanten, Kanal-Liste mit Kategorien, Ereignisfiltern, *Testnachricht*, letzter Zustellung und letztem
 * Fehler. Die Webhook-URL ist nur schreibbar (SV-10): angezeigt wird nur „gesetzt – endet auf …“. Löschen
 * über den `ConfirmDialog` (E4). Rechte: `tenant.settings` (Admin/Owner mit 2FA); die API prüft erneut.
 */
import {
  DISCORD_WEBHOOK_PATTERN,
  discordCategories,
  discordEventKeys,
  type DiscordCategory,
} from '@nina-pm/shared';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  discordApi,
  type DiscordChannelView,
  type DiscordGuild,
  type DiscordSettingsView,
} from '../../api/client';
import { useAuth, useCan } from '../../auth';
import { ActionMenu } from '../../components/ActionMenu';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { ICON_SIZE, actionIcons } from '../../components/icons';
import { ProblemMessage } from '../../components/ProblemMessage';
import styles from './admin.module.css';
import { AdminLayout } from './AdminLayout';
import { FormDialog } from './FormDialog';
import local from './members.module.css';
import own from './discord.module.css';
import { DateTime, problemCode, useConfirm } from './shared';

const DISCORD_KEY = ['tenant', 'discord'] as const;
type EventKey = (typeof discordEventKeys)[DiscordCategory][number];
const eventLabel = (key: string) => `admin.discord.event.${key.replace('.', '_')}`;

export function DiscordSettingsPage() {
  const { t } = useTranslation();
  const query = useQuery({ queryKey: DISCORD_KEY, queryFn: () => discordApi.settings() });
  const canManage = useCan('tenant.settings');
  return (
    <AdminLayout
      title={t('admin.discord.title')}
      actions={canManage && query.data ? <ChannelDialog /> : null}
    >
      <p className={styles.muted}>{t('admin.discord.intro')}</p>
      {query.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : query.isError ? (
        <ProblemMessage code={problemCode(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <GuildPanel guild={query.data.guild} canManage={canManage} />
          <ChannelsPanel data={query.data} canManage={canManage} />
        </>
      )}
    </AdminLayout>
  );
}

/** Server des Mandanten (FA-DIS-01, nur Anzeige). */
function GuildPanel({ guild, canManage }: { guild: DiscordGuild; canManage: boolean }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [draft, setDraft] = useState(guild);
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraft(guild), [guild]);
  const save = useMutation({
    mutationFn: () =>
      discordApi.saveGuild({
        guildName: draft.guildName?.trim() || null,
        guildId: draft.guildId?.trim() || null,
        inviteUrl: draft.inviteUrl?.trim() || null,
      }),
    onSuccess: async () => {
      setSaved(true);
      await client.invalidateQueries({ queryKey: DISCORD_KEY });
    },
  });
  const set = (key: keyof DiscordGuild, value: string) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const Save = actionIcons.save;
  return (
    <section className={styles.panel} aria-labelledby="discord-server">
      <h2 id="discord-server">{t('admin.discord.server')}</h2>
      <form
        className={styles.form}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (canManage) save.mutate();
        }}
      >
        <div className={styles.row}>
          <div className={styles.field}>
            <label htmlFor="discord-guild-name">{t('admin.discord.guildName')}</label>
            <input
              id="discord-guild-name"
              className={styles.input}
              maxLength={100}
              value={draft.guildName ?? ''}
              disabled={!canManage}
              onChange={(e) => set('guildName', e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="discord-guild-id">{t('admin.discord.guildId')}</label>
            <input
              id="discord-guild-id"
              className={styles.input}
              inputMode="numeric"
              maxLength={25}
              value={draft.guildId ?? ''}
              disabled={!canManage}
              onChange={(e) => set('guildId', e.target.value.trim())}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="discord-invite">{t('admin.discord.inviteUrl')}</label>
            <input
              id="discord-invite"
              className={styles.input}
              type="url"
              maxLength={200}
              value={draft.inviteUrl ?? ''}
              disabled={!canManage}
              aria-describedby="discord-invite-hint"
              onChange={(e) => set('inviteUrl', e.target.value.trim())}
            />
            <span id="discord-invite-hint" className={styles.muted}>
              {t('admin.discord.inviteHint')}
            </span>
          </div>
        </div>
        {canManage ? (
          <div className={styles.actions}>
            <button type="submit" className={styles.buttonPrimary} disabled={save.isPending}>
              <Save size={ICON_SIZE.button} aria-hidden />
              {t('admin.discord.saveServer')}
            </button>
            {saved ? (
              <span className={styles.success} role="status">
                {t('admin.discord.saved')}
              </span>
            ) : null}
          </div>
        ) : null}
        {save.isError ? <ProblemMessage code={problemCode(save.error)} /> : null}
      </form>
    </section>
  );
}

/** Text zu `last_error` (feste Codes aus dem worker, nie Discords Antworttext). */
function useErrorText() {
  const { t, i18n } = useTranslation();
  return (code: string) => {
    const key = `admin.discord.error.${code}`;
    return i18n.exists(key) ? t(key) : t('admin.discord.error.other', { code });
  };
}

function ChannelsPanel({ data, canManage }: { data: DiscordSettingsView; canManage: boolean }) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const zone = me?.tenant?.timeZone ?? 'Europe/Berlin';
  const client = useQueryClient();
  const errorText = useErrorText();
  const [tested, setTested] = useState<string | null>(null);
  const [editing, setEditing] = useState<DiscordChannelView | null>(null);
  const [deleting, setDeleting] = useState<DiscordChannelView | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: DISCORD_KEY });
  const test = useMutation({
    mutationFn: (c: DiscordChannelView) => discordApi.testChannel(c.id),
    onMutate: () => setTested(null),
    onSuccess: (_r, c) => setTested(c.name),
    onSettled: refresh,
  });
  const remove = useConfirm(async () => {
    if (deleting) await discordApi.deleteChannel(deleting.id);
    await refresh();
  });
  const Test = actionIcons.submit;
  const Edit = actionIcons.edit;
  const Delete = actionIcons.delete;
  const columns: DataColumn<DiscordChannelView>[] = [
    {
      id: 'name',
      header: t('admin.discord.col.name'),
      cell: (c) => c.name,
      sortValue: (c) => c.name,
    },
    {
      id: 'categories',
      header: t('admin.discord.col.categories'),
      priority: 3,
      cell: (c) => c.categories.map((k) => t(`admin.discord.category.${k}`)).join(', '),
    },
    {
      id: 'webhook',
      header: t('admin.discord.col.webhook'),
      priority: 4,
      nowrap: true,
      cell: (c) =>
        c.webhookHint ? (
          <span>{t('admin.discord.webhookKeep', { hint: c.webhookHint })}</span>
        ) : (
          <span className={styles.pillWarn}>{t('admin.discord.webhookMissing')}</span>
        ),
    },
    {
      id: 'status',
      header: t('admin.discord.col.status'),
      cell: (c) => (
        <span className={c.enabled ? styles.pillOk : styles.pill}>
          {c.enabled ? t('admin.discord.active') : t('admin.discord.inactive')}
        </span>
      ),
    },
    {
      id: 'lastDelivery',
      header: t('admin.discord.col.lastDelivery'),
      priority: 2,
      cell: (c) => <DateTime at={c.lastDeliveryAt} zone={zone} />,
    },
    {
      id: 'lastError',
      header: t('admin.discord.col.lastError'),
      priority: 2,
      cell: (c) =>
        c.lastError ? (
          <span>
            <span className={styles.pillDanger}>{errorText(c.lastError)}</span>{' '}
            <DateTime at={c.lastErrorAt} zone={zone} />
          </span>
        ) : (
          <span className={styles.muted}>–</span>
        ),
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: t('admin.discord.col.actions'),
            headerHidden: true,
            nowrap: true,
            cell: (c: DiscordChannelView) => (
              <span className={styles.actions}>
                <button
                  type="button"
                  className={styles.button}
                  disabled={!c.enabled || !c.webhookSet || test.isPending}
                  onClick={() => test.mutate(c)}
                >
                  <Test size={ICON_SIZE.table} aria-hidden />
                  {t('admin.discord.test')}
                </button>
                <ActionMenu
                  size="sm"
                  label={t('admin.discord.more', { name: c.name })}
                  items={[
                    {
                      key: 'edit',
                      label: t('admin.discord.edit'),
                      icon: <Edit size={ICON_SIZE.table} aria-hidden />,
                      onSelect: () => setEditing(c),
                    },
                    {
                      key: 'delete',
                      label: t('admin.discord.delete'),
                      icon: <Delete size={ICON_SIZE.table} aria-hidden />,
                      danger: true,
                      onSelect: () => {
                        setDeleting(c);
                        remove.open();
                      },
                    },
                  ]}
                />
              </span>
            ),
          },
        ]
      : []),
  ];
  return (
    <section className={styles.panel} aria-labelledby="discord-channels">
      <h2 id="discord-channels">{t('admin.discord.channels')}</h2>
      {tested ? (
        <p className={styles.success} role="status">
          {t('admin.discord.testSent', { name: tested })}
        </p>
      ) : null}
      {test.isError ? <ProblemMessage code={problemCode(test.error)} /> : null}
      <DataTable
        label={t('admin.discord.channels')}
        columns={columns}
        rows={data.channels}
        rowKey={(c) => c.id}
        rowLabel={(c) => c.name}
        empty={t('admin.discord.empty')}
      />
      <ChannelEditDialog channel={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        {...remove.dialog}
        variant="danger"
        title={t('admin.discord.deleteTitle', { name: deleting?.name ?? '' })}
        consequence={t('admin.discord.deleteConsequence')}
        confirmLabel={t('admin.discord.delete')}
      />
    </section>
  );
}

/** *Kanal anlegen* – Knopf im Seitenkopf mit Dialog. */
function ChannelDialog() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const Add = actionIcons.add;
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      title={t('admin.discord.add')}
      description={t('admin.discord.addHint')}
      trigger={
        <button type="button" className={styles.buttonPrimary}>
          <Add size={ICON_SIZE.button} aria-hidden />
          {t('admin.discord.add')}
        </button>
      }
    >
      {open ? <ChannelForm channel={null} onDone={() => setOpen(false)} /> : null}
    </FormDialog>
  );
}

/**
 * *Bearbeiten* aus dem ⋯-Menü der Zeile: immer eingehängt und über `channel` gesteuert (wie der
 * `ConfirmDialog`) – ein erst beim Auswählen eingehängter Dialog schlösse sich beim Mausklick sofort wieder.
 */
function ChannelEditDialog({
  channel,
  onClose,
}: {
  channel: DiscordChannelView | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <FormDialog
      open={channel !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={t('admin.discord.editTitle', { name: channel?.name ?? '' })}
      description={t('admin.discord.editHint')}
    >
      {channel ? <ChannelForm key={channel.id} channel={channel} onDone={onClose} /> : null}
    </FormDialog>
  );
}

function ChannelForm({
  channel,
  onDone,
}: {
  channel: DiscordChannelView | null;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [name, setName] = useState(channel?.name ?? '');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [categories, setCategories] = useState<DiscordCategory[]>(
    (channel?.categories as DiscordCategory[] | undefined) ?? ['approvals'],
  );
  const [disabled, setDisabled] = useState<string[]>(channel?.eventFilter.disabledEvents ?? []);
  const [showNames, setShowNames] = useState(channel?.eventFilter.showNames ?? true);
  const [enabled, setEnabled] = useState(channel?.enabled ?? true);
  const urlInvalid = webhookUrl !== '' && !DISCORD_WEBHOOK_PATTERN.test(webhookUrl);
  const urlMissing = !channel && webhookUrl === '';
  const hasUrl = webhookUrl !== '' || !!channel?.webhookSet;
  const save = useMutation({
    mutationFn: () => {
      const eventFilter = {
        // Nur Ereignisse der gewählten Kategorien bleiben abgewählt.
        disabledEvents: disabled.filter((k) =>
          categories.some((c) => (discordEventKeys[c] as readonly string[]).includes(k)),
        ) as EventKey[],
        showNames,
      };
      return channel
        ? discordApi.updateChannel(channel.id, {
            expectedUpdatedAt: channel.updatedAt,
            name: name.trim(),
            categories,
            eventFilter,
            enabled: enabled && hasUrl,
            ...(webhookUrl ? { webhookUrl } : {}),
          })
        : discordApi.createChannel({
            name: name.trim(),
            webhookUrl,
            categories,
            eventFilter,
            enabled,
          });
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: DISCORD_KEY });
      onDone();
    },
  });
  const toggle = <T,>(list: T[], value: T, on: boolean) =>
    on ? [...new Set([...list, value])] : list.filter((x) => x !== value);
  const invalid = !name.trim() || categories.length === 0 || urlInvalid || urlMissing;
  const Save = actionIcons.save;
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) save.mutate();
      }}
    >
      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="discord-channel-name">{t('admin.discord.name')}</label>
          <input
            id="discord-channel-name"
            className={styles.input}
            value={name}
            maxLength={80}
            placeholder="#np-alarme"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="discord-channel-url">
            {channel ? t('admin.discord.webhookNew') : t('admin.discord.webhookUrl')}
          </label>
          <input
            id="discord-channel-url"
            className={styles.input}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={webhookUrl}
            aria-invalid={urlInvalid}
            aria-describedby="discord-channel-url-hint"
            onChange={(e) => setWebhookUrl(e.target.value.trim())}
          />
          <span id="discord-channel-url-hint" className={styles.muted}>
            {urlInvalid
              ? t('admin.discord.webhookInvalid')
              : channel?.webhookHint
                ? t('admin.discord.webhookKeep', { hint: channel.webhookHint })
                : t('admin.discord.webhookInvalid')}
          </span>
        </div>
      </div>
      <fieldset className={own.group}>
        <legend className={styles.label}>{t('admin.discord.categories')}</legend>
        <div className={own.checkGrid}>
          {discordCategories.map((c) => (
            <label key={c} className={styles.check}>
              <input
                type="checkbox"
                checked={categories.includes(c)}
                onChange={(e) => setCategories((l) => toggle(l, c, e.target.checked))}
              />
              {t(`admin.discord.category.${c}`)}
            </label>
          ))}
        </div>
      </fieldset>
      {categories.map((c) => (
        <fieldset key={c} className={own.group}>
          <legend className={styles.label}>
            {t('admin.discord.events', { category: t(`admin.discord.category.${c}`) })}
          </legend>
          <div className={own.checkGrid}>
            {discordEventKeys[c].map((k) => (
              <label key={k} className={styles.check}>
                <input
                  type="checkbox"
                  checked={!disabled.includes(k)}
                  onChange={(e) => setDisabled((l) => toggle(l, k, !e.target.checked))}
                />
                {t(eventLabel(k))}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={showNames}
          onChange={(e) => setShowNames(e.target.checked)}
        />
        {t('admin.discord.showNames')}
      </label>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={enabled && hasUrl}
          disabled={!hasUrl}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        {t('admin.discord.enabled')}
      </label>
      {save.isError ? <ProblemMessage code={problemCode(save.error)} /> : null}
      <div className={local.dialogActions}>
        <AlertDialog.Cancel asChild>
          <button type="button" className={styles.button}>
            {t('common.cancel')}
          </button>
        </AlertDialog.Cancel>
        <button type="submit" className={styles.buttonPrimary} disabled={invalid || save.isPending}>
          <Save size={ICON_SIZE.button} aria-hidden />
          {channel ? t('admin.discord.save') : t('admin.discord.create')}
        </button>
      </div>
    </form>
  );
}
