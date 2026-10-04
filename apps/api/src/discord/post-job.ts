/**
 * Job `discord_post` (TK 7.7, FA-DIS-05): eine Zustellung je Kanal, Ereignis und Objekt.
 * - Vor jedem Senden: Kanal aktiv, URL vorhanden und gültig (Host `discord.com`/`discordapp.com`), sonst kein
 *   Aufruf; ungültige URL deaktiviert den Kanal.
 * - `429` → nach `retry_after` erneut (kurz: im selben Lauf, sonst als neuer Versuch); `5xx`/Netz → bis
 *   5 Versuche mit Backoff 30 s, 2 min, 10 min, 30 min; `401`/`403`/`404` → Kanal deaktivieren, `last_error`,
 *   Benachrichtigung `alert.discord_channel_failed` an die Admins (und damit `discord.channel_failed` an die
 *   **anderen** Alarm-Kanäle); `3xx` → nicht gefolgt, Fehler; übrige `4xx` → Fehler ohne Wiederholung.
 * - Nachtbericht: Status der Session aus allen Zustellungen (`sent`, sobald ein Kanal ihn hat).
 */
import {
  activeAdminIds,
  deliveryStatuses,
  discordProjectBrief,
  discordReportExtras,
  discordSendContext,
  discordSessionBrief,
  insertNotifications,
  markDeliveryFailed,
  markDeliverySent,
  noteDeliveryAttempt,
  SessionReviewRepository,
  setReportStatus,
  type DiscordErrorText,
  type OpenDatabase,
} from '@nina-pm/db';
import { DISCORD_EVENT_KEYS, maxJobAttempts, type DiscordEventKey } from '@nina-pm/shared';
import { z } from 'zod';
import { logger } from '../lib/logger';
import { RetryLater, type JobHandler } from '../worker/jobs';
import { eventMessages, type EmbedLoaders } from './embeds';
import { postWebhook, type FetchLike, type WebhookResult } from './webhook';

const Input = z.object({
  channelId: z.uuid(),
  eventKey: z.enum(DISCORD_EVENT_KEYS as [DiscordEventKey, ...DiscordEventKey[]]),
  objectId: z.uuid(),
  data: z.record(z.string(), z.unknown()).default({}),
});

/** Wartezeit nach dem n-ten gescheiterten Versuch (TK 7.7). */
export const DISCORD_BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000, 7_200_000] as const;
/** `retry_after` bis zu dieser Länge wartet der Job selbst, statt einen neuen Versuch einzuplanen. */
export const INLINE_RETRY_AFTER_S = 5;

export interface DiscordPostDeps {
  readonly db: () => Promise<OpenDatabase['db']>;
  readonly fetch?: FetchLike;
  readonly sleep?: (ms: number) => Promise<void>;
}

export function sessionLoaders(db: OpenDatabase['db'], tenantId: string): EmbedLoaders {
  return {
    project: (id) => discordProjectBrief(db, tenantId, id),
    session: (id) => discordSessionBrief(db, tenantId, id),
    reportExtras: (id, projectIds) => discordReportExtras(db, tenantId, id, projectIds),
    sessionDetail: async (id) => {
      try {
        return await new SessionReviewRepository(db, { tenantId }).detail(id, 0);
      } catch {
        return undefined;
      }
    },
  };
}

const errorOf = (r: WebhookResult): DiscordErrorText => {
  switch (r.kind) {
    case 'invalid':
      return 'webhook_invalid';
    case 'redirect':
      return 'redirect';
    case 'rate_limited':
      return 'http_429';
    case 'retry':
      return r.status === null ? 'network' : `http_${r.status}`;
    case 'gone':
    case 'rejected':
      return `http_${r.status}`;
    default:
      return 'network';
  }
};

export function discordPostHandler(deps: DiscordPostDeps): JobHandler {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return async ({ job, now }) => {
    if (!job.tenantId) throw new Error('discord_post ohne Mandant');
    const tenantId = job.tenantId;
    const input = Input.parse(job.input);
    const key = {
      tenantId,
      channelId: input.channelId,
      eventKey: input.eventKey,
      objectId: input.objectId,
    };
    const db = await deps.db();
    const ctx = await discordSendContext(
      db,
      tenantId,
      input.channelId,
      input.eventKey,
      input.objectId,
    );
    const log = {
      jobId: job.id,
      channelId: input.channelId,
      eventKey: input.eventKey,
      attempt: job.attempts,
    };
    const updateReport = async () => {
      if (input.eventKey !== 'session.report') return;
      const statuses = await deliveryStatuses(db, tenantId, 'session.report', input.objectId);
      const status = statuses.includes('sent')
        ? 'sent'
        : statuses.includes('pending')
          ? 'pending'
          : 'failed';
      await setReportStatus(db, tenantId, input.objectId, status, now());
    };
    if (!ctx || !ctx.delivery) {
      logger.info('discord_post_skipped', { ...log, reason: 'channel_or_delivery_gone' });
      return undefined;
    }
    if (ctx.delivery.status === 'sent') return undefined;
    if (!ctx.channel.enabled) {
      await markDeliveryFailed(db, key, 'webhook_missing', now(), { channelError: false });
      await updateReport();
      logger.info('discord_post_skipped', { ...log, reason: 'channel_disabled' });
      return undefined;
    }

    const messages = await eventMessages(
      input.eventKey,
      input.data,
      {
        lang: ctx.tenant.language,
        tenantName: ctx.tenant.displayName,
        tenantTimeZone: ctx.tenant.timeZone,
        showNames: ctx.channel.eventFilter.showNames,
        now: now(),
      },
      sessionLoaders(db, tenantId),
    );
    if (messages.length === 0) {
      await markDeliveryFailed(db, key, 'webhook_missing', now(), { channelError: false });
      await updateReport();
      logger.info('discord_post_skipped', { ...log, reason: 'object_gone' });
      return undefined;
    }

    let result: WebhookResult = { kind: 'ok' };
    for (const message of messages) {
      result = await postWebhook(ctx.channel.webhookUrl, message, deps.fetch);
      if (result.kind === 'rate_limited' && result.retryAfterS <= INLINE_RETRY_AFTER_S) {
        await sleep(Math.ceil(result.retryAfterS * 1000));
        result = await postWebhook(ctx.channel.webhookUrl, message, deps.fetch);
      }
      if (result.kind !== 'ok') break;
    }

    if (result.kind === 'ok') {
      await markDeliverySent(db, key, now());
      await updateReport();
      logger.info('discord_post_sent', { ...log, parts: messages.length });
      return undefined;
    }

    const error = errorOf(result);
    const lastAttempt = job.attempts >= maxJobAttempts('discord_post');
    if ((result.kind === 'retry' || result.kind === 'rate_limited') && !lastAttempt) {
      await noteDeliveryAttempt(db, key, job.id, error);
      const waitMs =
        result.kind === 'rate_limited'
          ? Math.ceil(result.retryAfterS * 1000)
          : (DISCORD_BACKOFF_MS[job.attempts - 1] ?? 7_200_000);
      logger.warn('discord_post_retry', { ...log, error, waitMs });
      throw new RetryLater(new Date(now().getTime() + waitMs), 'discord.delivery_failed');
    }

    // Endgültig: Webhook weg/nicht berechtigt oder ungültig → Kanal aus und Admins benachrichtigen.
    const disable = result.kind === 'gone' || result.kind === 'invalid';
    await noteDeliveryAttempt(db, key, job.id, error);
    const { disabled } = await markDeliveryFailed(db, key, error, now(), { disable });
    await updateReport();
    logger.warn('discord_post_failed', { ...log, error, disabled });
    if (disabled) {
      const at = now();
      await insertNotifications(db, {
        tenantId,
        recipients: await activeAdminIds(db, tenantId),
        kind: 'alert.discord_channel_failed',
        payload: {
          subject: ctx.channel.name,
          key: input.channelId,
          channelId: input.channelId,
          name: ctx.channel.name,
          status: 'status' in result ? result.status : null,
          attempts: job.attempts,
        },
        now: at,
      });
    }
    return undefined;
  };
}
