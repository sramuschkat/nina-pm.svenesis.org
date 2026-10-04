/**
 * Discord ausgehend (AP-60; FA-DIS-01…05, FA-AUS-21, TK 7.7, SV-10).
 * - `DiscordRepository` (api, `app_rw`): Server und Kanäle des Mandanten (S-71); die Webhook-URL ist nur
 *   schreibbar und verlässt das Repository nur über `webhookForTest` (Testnachricht).
 * - `enqueueDiscordEvent` (beide Rollen): je passendem aktiven Kanal eine Zeile `discord_delivery` und ein
 *   Job `discord_post` – in der Transaktion des Auslösers, wenn es eine gibt.
 * - Zustellung (worker, `app_job`): Kanal und Mandant zum Senden, Zustellzustand, Kanal deaktivieren.
 */
import { createHash } from 'node:crypto';
import {
  dedupeKeys,
  discordCategoryOf,
  effectiveEventFilter,
  effectiveTenantSettings,
  isDiscordWebhookUrl,
  ProblemError,
  webhookHint,
  type DiscordChannelCreate,
  type DiscordChannelPatch,
  type DiscordEventFilter,
  type DiscordEventKey,
  type DiscordGuild,
  type NotificationKind,
} from '@nina-pm/shared';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import { withTx, type WithTxOptions } from '../tx';
import type { Database, DiscordChannelTable } from '../types';
import { TenantRepo } from './base';

type Db = Kysely<Database> | Transaction<Database>;
type ChannelRow = Selectable<DiscordChannelTable>;

/** Kanal ohne Webhook-URL – das Einzige, was das Repository nach außen gibt (SV-10). */
export interface DiscordChannelRecord {
  readonly id: string;
  readonly name: string;
  readonly webhookSet: boolean;
  readonly webhookHint: string | null;
  readonly categories: string[];
  readonly eventFilter: DiscordEventFilter;
  readonly enabled: boolean;
  readonly lastDeliveryAt: Date | null;
  readonly lastError: string | null;
  readonly lastErrorAt: Date | null;
  readonly updatedAt: Date;
}

const CHANNEL_COLUMNS = [
  'id',
  'name',
  'webhookHint',
  'categories',
  'eventFilter',
  'enabled',
  'lastDeliveryAt',
  'lastError',
  'lastErrorAt',
  'updatedAt',
] as const;

function parseJson(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return null;
  }
}

function categoriesOf(v: unknown): string[] {
  const parsed = parseJson(v);
  return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
}

function record(r: Pick<ChannelRow, (typeof CHANNEL_COLUMNS)[number]>): DiscordChannelRecord {
  return {
    id: r.id,
    name: r.name,
    webhookSet: r.webhookHint !== null,
    webhookHint: r.webhookHint,
    categories: categoriesOf(r.categories),
    eventFilter: effectiveEventFilter(parseJson(r.eventFilter)),
    enabled: r.enabled,
    lastDeliveryAt: r.lastDeliveryAt,
    lastError: r.lastError,
    lastErrorAt: r.lastErrorAt,
    updatedAt: r.updatedAt,
  };
}

const wholeSeconds = (d: Date | string) => Math.floor(new Date(d).getTime() / 1000);

const invalidWebhook = () =>
  new ProblemError('discord.webhook_invalid', [
    { path: 'webhookUrl', message: 'Nur https://discord.com/api/webhooks/… bzw. discordapp.com' },
  ]);

/** Fester Text für `last_error` (nie die URL oder Discords Antworttext). */
export type DiscordErrorText =
  `http_${number}` | 'network' | 'redirect' | 'webhook_invalid' | 'webhook_missing';

export class DiscordRepository extends TenantRepo {
  constructor(
    db: Kysely<Database>,
    ctx: ConstructorParameters<typeof TenantRepo>[1],
    private readonly txOptions: WithTxOptions = {},
  ) {
    super(db, ctx);
  }

  async guild(): Promise<DiscordGuild> {
    const t = await this.db
      .selectFrom('tenant')
      .select(['discordGuildName', 'discordGuildId', 'discordInviteUrl'])
      .where('id', '=', this.ctx.tenantId)
      .executeTakeFirst();
    if (!t) throw new ProblemError('tenant.not_found');
    return {
      guildName: t.discordGuildName,
      guildId: t.discordGuildId,
      inviteUrl: t.discordInviteUrl,
    };
  }

  async channels(): Promise<DiscordChannelRecord[]> {
    const rows = await this.db
      .selectFrom('discordChannel')
      .select(CHANNEL_COLUMNS)
      .where('tenantId', '=', this.ctx.tenantId)
      .orderBy('name')
      .orderBy('id')
      .execute();
    return rows.map(record);
  }

  /** Server des Mandanten (FA-DIS-01, nur Anzeige); Änderung im Änderungsprotokoll. */
  updateGuild(guild: DiscordGuild, now: Date): Promise<DiscordGuild> {
    return withTx(
      this.db,
      async (trx) => {
        const before = await trx
          .selectFrom('tenant')
          .select(['discordGuildName', 'discordGuildId', 'discordInviteUrl'])
          .where('id', '=', this.ctx.tenantId)
          .forUpdate()
          .executeTakeFirst();
        if (!before) throw new ProblemError('tenant.not_found');
        const diff: Record<string, { from: unknown; to: unknown }> = {};
        const pairs = [
          ['guildName', before.discordGuildName, guild.guildName],
          ['guildId', before.discordGuildId, guild.guildId],
          ['inviteUrl', before.discordInviteUrl, guild.inviteUrl],
        ] as const;
        for (const [key, from, to] of pairs) if (from !== to) diff[key] = { from, to };
        if (Object.keys(diff).length === 0) return;
        await trx
          .updateTable('tenant')
          .set({
            discordGuildName: guild.guildName,
            discordGuildId: guild.guildId,
            discordInviteUrl: guild.inviteUrl,
            updatedAt: now,
          })
          .where('id', '=', this.ctx.tenantId)
          .execute();
        await this.log(trx, 'tenant', this.ctx.tenantId, 'discord_guild', diff, now);
      },
      this.txOptions,
    ).then(() => this.guild());
  }

  async channel(id: string): Promise<DiscordChannelRecord> {
    const row = await this.db
      .selectFrom('discordChannel')
      .select(CHANNEL_COLUMNS)
      .where('id', '=', id)
      .where('tenantId', '=', this.ctx.tenantId)
      .executeTakeFirst();
    if (!row) throw new ProblemError('resource.not_found');
    return record(row);
  }

  /** Kanal anlegen (FA-DIS-02): URL geprüft, nur der Hinweis bleibt sichtbar; Name je Mandant eindeutig. */
  createChannel(input: DiscordChannelCreate, now: Date): Promise<DiscordChannelRecord> {
    if (!isDiscordWebhookUrl(input.webhookUrl)) throw invalidWebhook();
    const filter = input.eventFilter ?? { disabledEvents: [], showNames: true };
    return withTx(
      this.db,
      async (trx) => {
        await this.uniqueName(trx, input.name, null);
        const row = await trx
          .insertInto('discordChannel')
          .values({
            tenantId: this.ctx.tenantId,
            name: input.name,
            webhookUrl: input.webhookUrl,
            webhookHint: webhookHint(input.webhookUrl),
            categories: JSON.stringify([...new Set(input.categories)]),
            eventFilter: JSON.stringify(filter),
            enabled: input.enabled,
            createdBy: this.ctx.memberId ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await this.log(
          trx,
          'discord_channel',
          row.id,
          'create',
          {
            name: { from: null, to: input.name },
            categories: { from: null, to: input.categories },
            enabled: { from: null, to: input.enabled },
            webhook: { from: null, to: 'set' },
          },
          now,
        );
        return row.id;
      },
      this.txOptions,
    ).then((id) => this.channel(id));
  }

  /**
   * Kanal ändern: `expectedUpdatedAt` muss stimmen (`412`); eine neue URL wird geprüft und setzt den letzten
   * Fehler zurück. Aktivieren ohne URL ist unmöglich (CHECK in der Tabelle) → `422 discord.webhook_invalid`.
   */
  patchChannel(id: string, patch: DiscordChannelPatch, now: Date): Promise<DiscordChannelRecord> {
    if (patch.webhookUrl !== undefined && !isDiscordWebhookUrl(patch.webhookUrl))
      throw invalidWebhook();
    return withTx(
      this.db,
      async (trx) => {
        const row = await trx
          .selectFrom('discordChannel')
          .selectAll()
          .where('id', '=', id)
          .where('tenantId', '=', this.ctx.tenantId)
          .forUpdate()
          .executeTakeFirst();
        if (!row) throw new ProblemError('resource.not_found');
        // Stand in ganzen Sekunden wie in der Antwort (rules/api.md).
        if (wholeSeconds(row.updatedAt) !== wholeSeconds(patch.expectedUpdatedAt))
          throw new ProblemError('resource.version_conflict');
        if (patch.name !== undefined && patch.name !== row.name)
          await this.uniqueName(trx, patch.name, id);
        const before = record(row);
        const enabled = patch.enabled ?? before.enabled;
        const hasUrl = patch.webhookUrl !== undefined || row.webhookUrl !== null;
        if (enabled && !hasUrl) throw invalidWebhook();
        const diff: Record<string, { from: unknown; to: unknown }> = {};
        if (patch.name !== undefined && patch.name !== before.name)
          diff.name = { from: before.name, to: patch.name };
        if (
          patch.categories &&
          JSON.stringify(patch.categories) !== JSON.stringify(before.categories)
        )
          diff.categories = { from: before.categories, to: patch.categories };
        if (
          patch.eventFilter &&
          JSON.stringify(patch.eventFilter) !== JSON.stringify(before.eventFilter)
        )
          diff.eventFilter = { from: before.eventFilter, to: patch.eventFilter };
        if (enabled !== before.enabled) diff.enabled = { from: before.enabled, to: enabled };
        // Nie die URL ins Protokoll – nur, dass sie ersetzt wurde (SV-10).
        if (patch.webhookUrl !== undefined)
          diff.webhook = { from: before.webhookSet ? 'set' : null, to: 'replaced' };
        await trx
          .updateTable('discordChannel')
          .set({
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.categories
              ? { categories: JSON.stringify([...new Set(patch.categories)]) }
              : {}),
            ...(patch.eventFilter ? { eventFilter: JSON.stringify(patch.eventFilter) } : {}),
            ...(patch.webhookUrl !== undefined
              ? {
                  webhookUrl: patch.webhookUrl,
                  webhookHint: webhookHint(patch.webhookUrl),
                  lastError: null,
                  lastErrorAt: null,
                }
              : {}),
            enabled,
            // Stand für `expectedUpdatedAt`: jede Änderung rückt ihn um mindestens eine Sekunde vor.
            updatedAt: new Date(Math.max(now.getTime(), (wholeSeconds(row.updatedAt) + 1) * 1000)),
          })
          .where('id', '=', id)
          .where('tenantId', '=', this.ctx.tenantId)
          .execute();
        if (Object.keys(diff).length > 0)
          await this.log(trx, 'discord_channel', id, 'update', diff, now);
      },
      { ...this.txOptions, guard: [{ table: 'discord_channel', id, tenantId: this.ctx.tenantId }] },
    ).then(() => this.channel(id));
  }

  /** Kanal löschen: erst seine Zustellzeilen (keine ON-DELETE-Aktionen, rules/dsql.md). */
  deleteChannel(id: string, now: Date): Promise<void> {
    return withTx(
      this.db,
      async (trx) => {
        const row = await trx
          .selectFrom('discordChannel')
          .select(['id', 'name'])
          .where('id', '=', id)
          .where('tenantId', '=', this.ctx.tenantId)
          .executeTakeFirst();
        if (!row) throw new ProblemError('resource.not_found');
        await trx
          .deleteFrom('discordDelivery')
          .where('channelId', '=', id)
          .where('tenantId', '=', this.ctx.tenantId)
          .execute();
        await trx
          .deleteFrom('discordChannel')
          .where('id', '=', id)
          .where('tenantId', '=', this.ctx.tenantId)
          .execute();
        await this.log(
          trx,
          'discord_channel',
          id,
          'delete',
          { name: { from: row.name, to: null } },
          now,
        );
      },
      { ...this.txOptions, guard: [{ table: 'discord_channel', id, tenantId: this.ctx.tenantId }] },
    );
  }

  /** Webhook-URL für die Testnachricht (FA-DIS-05); nur die Route `…/test` ruft das auf. */
  async webhookForTest(id: string): Promise<{ url: string | null; name: string }> {
    const row = await this.db
      .selectFrom('discordChannel')
      .select(['webhookUrl', 'name'])
      .where('id', '=', id)
      .where('tenantId', '=', this.ctx.tenantId)
      .executeTakeFirst();
    if (!row) throw new ProblemError('resource.not_found');
    return { url: row.webhookUrl, name: row.name };
  }

  /** Ergebnis der Testnachricht als letzte Zustellung bzw. letzter Fehler. */
  async recordTest(id: string, error: DiscordErrorText | null, now: Date): Promise<void> {
    await this.db
      .updateTable('discordChannel')
      .set(error ? { lastError: error, lastErrorAt: now } : { lastDeliveryAt: now })
      .where('id', '=', id)
      .where('tenantId', '=', this.ctx.tenantId)
      .execute();
  }

  /**
   * „Bericht erneut senden“ (FA-AUS-21, TK 7.7): bestehende Zustellzeilen `session.report` der Session
   * zurücksetzen und neue Jobs anlegen; Kanäle ohne Zeile (neu oder damals abgewählt) bekommen eine neue.
   * Jeder Reset steht im Änderungsprotokoll. Liefert die Anzahl Kanäle.
   */
  resendSessionReport(sessionId: string, now: Date): Promise<number> {
    const tenantId = this.ctx.tenantId;
    return withTx(
      this.db,
      async (trx) => {
        const session = await trx
          .selectFrom('session')
          .select(['id', 'rigId'])
          .where('id', '=', sessionId)
          .where('tenantId', '=', tenantId)
          .executeTakeFirst();
        if (!session) throw new ProblemError('resource.not_found');
        await trx
          .deleteFrom('discordDelivery')
          .where('tenantId', '=', tenantId)
          .where('eventKey', '=', 'session.report')
          .where('objectId', '=', sessionId)
          .where('status', '!=', 'pending')
          .execute();
        await trx
          .updateTable('session')
          .set({ reportStatus: 'pending' })
          .where('id', '=', sessionId)
          .where('tenantId', '=', tenantId)
          .execute();
        const channels = await enqueueDiscordEvent(trx, {
          tenantId,
          eventKey: 'session.report',
          objectId: sessionId,
          data: { sessionId, resend: true },
          now,
        });
        await this.log(
          trx,
          'session',
          sessionId,
          'report_resend',
          { channels: { from: null, to: channels } },
          now,
        );
        return channels;
      },
      this.txOptions,
    );
  }

  private async uniqueName(trx: Transaction<Database>, name: string, exceptId: string | null) {
    let q = trx
      .selectFrom('discordChannel')
      .select('id')
      .where('tenantId', '=', this.ctx.tenantId)
      .where('name', '=', name);
    if (exceptId) q = q.where('id', '!=', exceptId);
    if (await q.executeTakeFirst())
      throw new ProblemError('validation.failed', [
        { path: 'name', message: 'Name schon vergeben' },
      ]);
  }

  private async log(
    trx: Transaction<Database>,
    entity: string,
    entityId: string,
    action: string,
    diff: Record<string, unknown>,
    now: Date,
  ) {
    await trx
      .insertInto('changeLog')
      .values({
        tenantId: this.ctx.tenantId,
        entity,
        entityId,
        userId: this.ctx.memberId ?? null,
        action,
        diff: JSON.stringify(diff),
        createdAt: now,
      })
      .execute();
  }
}

// ---------------------------------------------------------------------------------------------------
// Auslösen
// ---------------------------------------------------------------------------------------------------

/**
 * Benachrichtigungsarten, die auch nach Discord gehen (FA-DIS-03), mit ihrem Ereignisschlüssel. Session-
 * und Transit-Ereignisse sowie der Nachtbericht haben keine In-App-Art und werden direkt ausgelöst.
 */
export const NOTIFICATION_DISCORD_EVENTS: Partial<Record<NotificationKind, DiscordEventKey>> = {
  'submission.new': 'submission.new',
  'submission.withdrawn': 'submission.withdrawn',
  'approval.approved': 'approval.approved',
  'approval.returned': 'approval.returned',
  'approval.rejected': 'approval.rejected',
  'approval.expired': 'approval.expired',
  'deadline.near': 'deadline.near',
  'change_request.new': 'change_request.new',
  'change_request.decided': 'change_request.decided',
  'alert.session_no_heartbeat': 'session.no_heartbeat',
  'alert.plugin_dead_letters': 'plugin.dead_letters',
  'alert.rig_busy': 'rig.busy',
  'alert.nina_settings_mismatch': 'nina.settings_mismatch',
  'alert.discord_channel_failed': 'discord.channel_failed',
};

/** Deterministische UUID aus einem Text (gleiches Ereignis → gleiche Zustellzeile, auch bei OCC-Wiederholung). */
export function stableUuid(text: string): string {
  const h = createHash('sha256').update(text).digest('hex');
  const variant = ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export interface DiscordEvent {
  readonly tenantId: string;
  readonly eventKey: DiscordEventKey;
  /** Projekt, Session, Transit-Beobachtung … bzw. eine aus dem Ereignis abgeleitete UUID. */
  readonly objectId: string;
  /** Kleine Werte für die Meldung (Namen, IDs, Zeitpunkte); große Inhalte lädt der worker. */
  readonly data: Record<string, unknown>;
  readonly now: Date;
  /** `discord.channel_failed` nie in den ausgefallenen Kanal selbst. */
  readonly excludeChannelId?: string;
}

/**
 * Je aktivem Kanal mit Webhook, passender Kategorie und nicht abgewähltem Ereignis: Zustellzeile (PK
 * `channel_id, event_key, object_id` – ein Ereignis geht je Kanal nur einmal) und Job `discord_post`
 * (TK 7.7). Liefert die Anzahl neu angelegter Zustellungen.
 */
export async function enqueueDiscordEvent(db: Db, e: DiscordEvent): Promise<number> {
  if (!db.isTransaction)
    return withTx(db as Kysely<Database>, (trx) => enqueueDiscordEvent(trx, e));
  const category = discordCategoryOf(e.eventKey);
  const channels = await db
    .selectFrom('discordChannel')
    .select(['id', 'categories', 'eventFilter'])
    .where('tenantId', '=', e.tenantId)
    .where('enabled', '=', true)
    .where('webhookUrl', 'is not', null)
    .execute();
  let created = 0;
  for (const c of channels) {
    if (c.id === e.excludeChannelId) continue;
    if (!categoriesOf(c.categories).includes(category)) continue;
    if (effectiveEventFilter(parseJson(c.eventFilter)).disabledEvents.includes(e.eventKey))
      continue;
    const inserted = await db
      .insertInto('discordDelivery')
      .values({
        tenantId: e.tenantId,
        channelId: c.id,
        eventKey: e.eventKey,
        objectId: e.objectId,
        createdAt: e.now,
      })
      .onConflict((oc) => oc.columns(['channelId', 'eventKey', 'objectId']).doNothing())
      .returning('channelId')
      .executeTakeFirst();
    if (!inserted) continue;
    const key = dedupeKeys.discordPost(c.id, e.eventKey, e.objectId);
    const job = await db
      .insertInto('job')
      .values({
        tenantId: e.tenantId,
        kind: 'discord_post',
        dedupeKey: key,
        dedupeActive: key,
        input: JSON.stringify({
          channelId: c.id,
          eventKey: e.eventKey,
          objectId: e.objectId,
          data: e.data,
        }),
        runAfter: e.now,
        createdAt: e.now,
      })
      .onConflict((oc) => oc.column('dedupeActive').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (job)
      await db
        .updateTable('discordDelivery')
        .set({ jobId: job.id })
        .where('channelId', '=', c.id)
        .where('eventKey', '=', e.eventKey)
        .where('objectId', '=', e.objectId)
        .execute();
    created += 1;
  }
  return created;
}

// ---------------------------------------------------------------------------------------------------
// Zustellung (worker)
// ---------------------------------------------------------------------------------------------------

export interface DiscordSendContext {
  readonly channel: {
    readonly id: string;
    readonly name: string;
    /** Nur zum Senden; nie loggen (SV-10). */
    readonly webhookUrl: string | null;
    readonly enabled: boolean;
    readonly eventFilter: DiscordEventFilter;
  };
  readonly tenant: {
    readonly displayName: string;
    readonly language: 'de' | 'en';
    readonly timeZone: string;
  };
  readonly delivery: {
    readonly status: 'pending' | 'sent' | 'failed';
    readonly attempts: number;
  } | null;
}

export async function discordSendContext(
  db: Kysely<Database>,
  tenantId: string,
  channelId: string,
  eventKey: string,
  objectId: string,
): Promise<DiscordSendContext | undefined> {
  const c = await db
    .selectFrom('discordChannel')
    .select(['id', 'name', 'webhookUrl', 'enabled', 'eventFilter'])
    .where('id', '=', channelId)
    .where('tenantId', '=', tenantId)
    .executeTakeFirst();
  const t = await db
    .selectFrom('tenant')
    .select(['displayName', 'settings'])
    .where('id', '=', tenantId)
    .executeTakeFirst();
  if (!c || !t) return undefined;
  const d = await db
    .selectFrom('discordDelivery')
    .select(['status', 'attempts'])
    .where('channelId', '=', channelId)
    .where('eventKey', '=', eventKey)
    .where('objectId', '=', objectId)
    .executeTakeFirst();
  const settings = effectiveTenantSettings(t.settings);
  return {
    channel: {
      id: c.id,
      name: c.name,
      webhookUrl: c.webhookUrl,
      enabled: c.enabled,
      eventFilter: effectiveEventFilter(parseJson(c.eventFilter)),
    },
    tenant: {
      displayName: t.displayName,
      language: settings.defaultLanguage,
      timeZone: settings.tenantTimezone,
    },
    delivery: d ? { status: d.status, attempts: d.attempts } : null,
  };
}

interface DeliveryKey {
  readonly tenantId: string;
  readonly channelId: string;
  readonly eventKey: string;
  readonly objectId: string;
}

/** Versuch vermerken (Zähler, Job, letzter Fehler) – vor dem nächsten Versuch. */
export async function noteDeliveryAttempt(
  db: Kysely<Database>,
  k: DeliveryKey,
  jobId: string,
  error: DiscordErrorText | null,
): Promise<void> {
  await db
    .updateTable('discordDelivery')
    .set((eb) => ({ attempts: eb('attempts', '+', 1), jobId, lastError: error }))
    .where('tenantId', '=', k.tenantId)
    .where('channelId', '=', k.channelId)
    .where('eventKey', '=', k.eventKey)
    .where('objectId', '=', k.objectId)
    .execute();
}

/** Zugestellt: Zeile `sent`, Kanal `last_delivery_at`. */
export async function markDeliverySent(
  db: Kysely<Database>,
  k: DeliveryKey,
  now: Date,
): Promise<void> {
  await withTx(db, async (trx) => {
    await trx
      .updateTable('discordDelivery')
      .set({ status: 'sent', sentAt: now, lastError: null })
      .where('tenantId', '=', k.tenantId)
      .where('channelId', '=', k.channelId)
      .where('eventKey', '=', k.eventKey)
      .where('objectId', '=', k.objectId)
      .execute();
    await trx
      .updateTable('discordChannel')
      .set({ lastDeliveryAt: now })
      .where('id', '=', k.channelId)
      .where('tenantId', '=', k.tenantId)
      .execute();
  });
}

/**
 * Endgültig gescheitert: Zeile `failed`; Kanal `last_error` (außer `channelError: false`, z. B. Kanal schon
 * aus); mit `disable` zusätzlich Kanal aus (FA-DIS-05). `disabled` nur, wenn er gerade erst abgeschaltet wurde.
 */
export async function markDeliveryFailed(
  db: Kysely<Database>,
  k: DeliveryKey,
  error: DiscordErrorText,
  now: Date,
  opts: { disable?: boolean; channelError?: boolean } = {},
): Promise<{ disabled: boolean }> {
  const disable = opts.disable ?? false;
  return withTx(db, async (trx) => {
    await trx
      .updateTable('discordDelivery')
      .set({ status: 'failed', lastError: error })
      .where('tenantId', '=', k.tenantId)
      .where('channelId', '=', k.channelId)
      .where('eventKey', '=', k.eventKey)
      .where('objectId', '=', k.objectId)
      .execute();
    if (opts.channelError === false) return { disabled: false };
    const r = await trx
      .updateTable('discordChannel')
      .set({ lastError: error, lastErrorAt: now, ...(disable ? { enabled: false } : {}) })
      .where('id', '=', k.channelId)
      .where('tenantId', '=', k.tenantId)
      .where(disable ? sql<boolean>`enabled = true` : sql<boolean>`true`)
      .executeTakeFirst();
    return { disabled: disable && Number(r.numUpdatedRows) > 0 };
  });
}

/** Zustellungen eines Ereignisses (Nachtbericht: Status der Session aus allen Kanälen). */
export async function deliveryStatuses(
  db: Kysely<Database>,
  tenantId: string,
  eventKey: string,
  objectId: string,
): Promise<('pending' | 'sent' | 'failed')[]> {
  const rows = await db
    .selectFrom('discordDelivery')
    .select('status')
    .where('tenantId', '=', tenantId)
    .where('eventKey', '=', eventKey)
    .where('objectId', '=', objectId)
    .execute();
  return rows.map((r) => r.status);
}

/** Fällige `discord_post`-Jobs (TK 7.7: `tick-5min` holt offene Zustellungen ab). */
export async function dueDiscordJobs(
  db: Kysely<Database>,
  now: Date,
  limit = 50,
): Promise<string[]> {
  const rows = await db
    .selectFrom('job')
    .select('id')
    .where('kind', '=', 'discord_post')
    .where('status', '=', 'pending')
    .where('runAfter', '<=', now)
    .orderBy('runAfter')
    .limit(limit)
    .execute();
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------------------------------
// Inhalte (worker): nur Namen und Zeiten, nie Koordinaten, Dateinamen oder Tokens (FA-DIS-04)
// ---------------------------------------------------------------------------------------------------

export interface DiscordProjectBrief {
  readonly id: string;
  readonly name: string;
  readonly rigName: string | null;
  readonly priority: number;
  readonly effortTag: string | null;
  readonly effortNights: number | null;
  readonly createdByName: string | null;
}

export async function discordProjectBrief(
  db: Kysely<Database>,
  tenantId: string,
  projectId: string,
): Promise<DiscordProjectBrief | undefined> {
  const p = await db
    .selectFrom('project as p')
    .leftJoin('rig as r', (j) =>
      j.onRef('r.id', '=', 'p.rigId').onRef('r.tenantId', '=', 'p.tenantId'),
    )
    .leftJoin('appUser as u', (j) =>
      j.onRef('u.id', '=', 'p.createdBy').onRef('u.tenantId', '=', 'p.tenantId'),
    )
    .select([
      'p.id',
      'p.name',
      'r.name as rigName',
      'p.priority',
      'p.effortTag',
      'p.effortNights',
      'u.displayName as createdByName',
    ])
    .where('p.id', '=', projectId)
    .where('p.tenantId', '=', tenantId)
    .executeTakeFirst();
  if (!p) return undefined;
  return {
    id: p.id,
    name: p.name,
    rigName: p.rigName,
    priority: Number(p.priority),
    effortTag: p.effortTag,
    effortNights: p.effortNights === null ? null : Number(p.effortNights),
    createdByName: p.createdByName,
  };
}

export interface DiscordSessionBrief {
  readonly id: string;
  readonly rigId: string;
  readonly rigName: string;
  readonly siteTimeZone: string;
  readonly night: string;
  readonly status: string;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly lastHeartbeatAt: Date | null;
  readonly outboxPending: number;
  readonly sessionReportDiscord: boolean;
  /** Wetterbewertung der Nacht aus dem Schnappschuss zum Sessionbeginn (AP-30): Klasse 0…4, Mittel 0…1. */
  readonly weather: {
    readonly ratingIndex: number | null;
    readonly nightMean: number | null;
  } | null;
}

function snapshotWeather(raw: unknown): DiscordSessionBrief['weather'] {
  const o = parseJson(raw);
  if (!o || typeof o !== 'object') return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const r = o as Record<string, unknown>;
  return { ratingIndex: n(r.ratingIndex), nightMean: n(r.nightMean) };
}

export async function discordSessionBrief(
  db: Kysely<Database>,
  tenantId: string,
  sessionId: string,
): Promise<DiscordSessionBrief | undefined> {
  const s = await db
    .selectFrom('session as s')
    .innerJoin('rig as r', (j) =>
      j.onRef('r.id', '=', 's.rigId').onRef('r.tenantId', '=', 's.tenantId'),
    )
    .innerJoin('site as t', (j) =>
      j.onRef('t.id', '=', 'r.siteId').onRef('t.tenantId', '=', 'r.tenantId'),
    )
    .select([
      's.id',
      's.rigId',
      'r.name as rigName',
      't.timeZone',
      's.night',
      's.status',
      's.startedAt',
      's.endedAt',
      's.lastHeartbeatAt',
      's.outboxPending',
      's.forecastSnapshot',
      'r.sessionReportDiscord',
    ])
    .where('s.id', '=', sessionId)
    .where('s.tenantId', '=', tenantId)
    .executeTakeFirst();
  if (!s) return undefined;
  return {
    id: s.id,
    rigId: s.rigId,
    rigName: s.rigName,
    siteTimeZone: s.timeZone,
    night: String(s.night),
    status: s.status,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    lastHeartbeatAt: s.lastHeartbeatAt,
    outboxPending: Number(s.outboxPending ?? 0),
    sessionReportDiscord: Boolean(s.sessionReportDiscord),
    weather: snapshotWeather(s.forecastSnapshot),
  };
}

export interface DiscordReportExtras {
  /** Transit-Beobachtungen der Session (FA-AUS-21, Abdeckung aus Ist/Soll der Aufnahmen). */
  readonly transits: {
    readonly name: string;
    readonly status: string;
    readonly coveragePct: number | null;
  }[];
  /** Projekte der Session, die inzwischen fertig sind (*Abgeschlossen* bzw. *Bereit zur Bearbeitung*). */
  readonly projectsDone: string[];
}

export async function discordReportExtras(
  db: Kysely<Database>,
  tenantId: string,
  sessionId: string,
  projectIds: readonly string[],
): Promise<DiscordReportExtras> {
  const transits = await db
    .selectFrom('transitObservation as o')
    .innerJoin('project as p', (j) =>
      j.onRef('p.id', '=', 'o.projectId').onRef('p.tenantId', '=', 'o.tenantId'),
    )
    .select(['p.name', 'o.status', 'o.plannedCount', 'o.acquiredCount'])
    .where('o.tenantId', '=', tenantId)
    .where('o.sessionId', '=', sessionId)
    .orderBy('o.ingressUtc')
    .execute();
  const done =
    projectIds.length === 0
      ? []
      : await db
          .selectFrom('project')
          .select('name')
          .where('tenantId', '=', tenantId)
          .where('id', 'in', [...projectIds])
          .where('status', 'in', ['completed', 'ready_to_process'])
          .orderBy('name')
          .execute();
  return {
    transits: transits.map((t) => ({
      name: t.name,
      status: t.status,
      coveragePct:
        Number(t.plannedCount) > 0
          ? Math.min(100, (100 * Number(t.acquiredCount)) / Number(t.plannedCount))
          : null,
    })),
    projectsDone: done.map((d) => d.name),
  };
}
