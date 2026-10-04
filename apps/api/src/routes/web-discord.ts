/**
 * Discord ausgehend (S-71 Reiter Discord; FA-DIS-01…05, TK 7.2/7.7, SV-10) – Aktion `tenant.settings`:
 * - `GET/PUT /web/v1/tenant/discord`: Server des Mandanten (Name, Server-ID, Einladungslink) und Kanäle
 * - `GET/POST /web/v1/tenant/discord/channels`, `PATCH/DELETE …/channels/{id}`: Kanäle; die Webhook-URL ist
 *   nur schreibbar (`422 discord.webhook_invalid` bei fremdem Host), Antworten tragen nur `webhookHint`
 * - `POST …/channels/{id}/test`: Testnachricht (FA-DIS-05) – sofort aus der api, Fehler `502 discord.test_failed`
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import {
  DiscordChannelCreate,
  DiscordChannelList,
  DiscordChannelPatch,
  DiscordChannelView,
  DiscordGuild,
  DiscordSettingsView,
  DiscordTestResult,
  effectiveTenantSettings,
  ProblemError,
  Uuid,
} from '@nina-pm/shared';
import type { DiscordChannelRecord } from '@nina-pm/db';
import { z } from 'zod';
import { testMessage } from '../discord/embeds';
import { postWebhook } from '../discord/webhook';
import type { ApiEnv } from '../lib/env';
import { isoUtc } from '../lib/format';
import { logger } from '../lib/logger';
import { defineRoute, problemContent } from './define';
import type { ApiServices } from './services';
import { requireTenant } from './tenant';

const BASE = '/api/web/v1/tenant/discord';
const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });
const idParam = z.object({ id: Uuid });
const common = {
  401: problemContent('Nicht angemeldet'),
  403: problemContent('Nur Admins'),
};
const REQ = ['FA-DIS-01', 'FA-DIS-02', 'FA-DIS-03', 'FA-DIS-04', 'TK 7.2', 'SV-10'];

export const getDiscordRoute = defineRoute(
  { action: 'tenant.settings', requirements: ['FA-DIS-01', 'FA-DIS-05', 'TK 7.2'] },
  {
    method: 'get',
    path: BASE,
    summary: 'Discord: Server und Kanäle (ohne Webhook-URLs)',
    tags: ['discord'],
    responses: { 200: { description: 'Einstellungen', ...json(DiscordSettingsView) }, ...common },
  },
);

export const putDiscordGuildRoute = defineRoute(
  { action: 'tenant.settings', requirements: ['FA-DIS-01', 'TK 7.2'] },
  {
    method: 'put',
    path: BASE,
    summary: 'Discord-Server des Mandanten (nur Anzeige)',
    tags: ['discord'],
    request: { body: { ...json(DiscordGuild), required: true } },
    responses: {
      200: { description: 'Gespeichert', ...json(DiscordGuild) },
      ...common,
      422: problemContent('validation.failed'),
    },
  },
);

export const listDiscordChannelsRoute = defineRoute(
  { action: 'tenant.settings', requirements: REQ },
  {
    method: 'get',
    path: `${BASE}/channels`,
    summary: 'Discord-Kanäle (ohne Webhook-URLs)',
    tags: ['discord'],
    responses: { 200: { description: 'Kanäle', ...json(DiscordChannelList) }, ...common },
  },
);

export const createDiscordChannelRoute = defineRoute(
  { action: 'tenant.settings', requirements: REQ },
  {
    method: 'post',
    path: `${BASE}/channels`,
    summary: 'Discord-Kanal anlegen (Webhook-URL nur schreibbar)',
    tags: ['discord'],
    request: { body: { ...json(DiscordChannelCreate), required: true } },
    responses: {
      201: { description: 'Angelegt', ...json(DiscordChannelView) },
      ...common,
      422: problemContent('discord.webhook_invalid bzw. validation.failed'),
    },
  },
);

export const patchDiscordChannelRoute = defineRoute(
  { action: 'tenant.settings', requirements: REQ },
  {
    method: 'patch',
    path: `${BASE}/channels/{id}`,
    summary: 'Discord-Kanal ändern (neue Webhook-URL ersetzt die alte)',
    tags: ['discord'],
    request: { params: idParam, body: { ...json(DiscordChannelPatch), required: true } },
    responses: {
      200: { description: 'Geändert', ...json(DiscordChannelView) },
      ...common,
      404: problemContent('resource.not_found'),
      412: problemContent('resource.version_conflict'),
      422: problemContent('discord.webhook_invalid bzw. validation.failed'),
    },
  },
);

export const deleteDiscordChannelRoute = defineRoute(
  { action: 'tenant.settings', requirements: REQ },
  {
    method: 'delete',
    path: `${BASE}/channels/{id}`,
    summary: 'Discord-Kanal löschen (mit seinen Zustellungen)',
    tags: ['discord'],
    request: { params: idParam },
    responses: {
      204: { description: 'Gelöscht' },
      ...common,
      404: problemContent('resource.not_found'),
    },
  },
);

export const testDiscordChannelRoute = defineRoute(
  { action: 'tenant.settings', requirements: ['FA-DIS-05', 'TK 7.7', 'SV-10'] },
  {
    method: 'post',
    path: `${BASE}/channels/{id}/test`,
    summary: 'Testnachricht in den Kanal senden',
    tags: ['discord'],
    request: { params: idParam },
    responses: {
      200: { description: 'Gesendet', ...json(DiscordTestResult) },
      ...common,
      404: problemContent('resource.not_found'),
      422: problemContent('discord.webhook_invalid (keine oder ungültige URL)'),
      502: problemContent('discord.test_failed'),
    },
  },
);

export const DISCORD_ROUTES = [
  getDiscordRoute,
  putDiscordGuildRoute,
  listDiscordChannelsRoute,
  createDiscordChannelRoute,
  patchDiscordChannelRoute,
  deleteDiscordChannelRoute,
  testDiscordChannelRoute,
] as const;

/** Kanal für die Antwort – nie die Webhook-URL (SV-10). */
export function channelView(c: DiscordChannelRecord): z.output<typeof DiscordChannelView> {
  return {
    id: c.id,
    name: c.name,
    webhookSet: c.webhookSet,
    webhookHint: c.webhookHint,
    categories: c.categories as z.output<typeof DiscordChannelView>['categories'],
    eventFilter: c.eventFilter,
    enabled: c.enabled,
    lastDeliveryAt: c.lastDeliveryAt ? isoUtc(c.lastDeliveryAt) : null,
    lastError: c.lastError,
    lastErrorAt: c.lastErrorAt ? isoUtc(c.lastErrorAt) : null,
    updatedAt: isoUtc(c.updatedAt),
  };
}

export function webDiscordRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();

  app.openapi(getDiscordRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    const repo = svc.repositories(tenant).discord();
    c.header('cache-control', 'no-store');
    return c.json(
      { guild: await repo.guild(), channels: (await repo.channels()).map(channelView) },
      200,
    );
  });

  app.openapi(putDiscordGuildRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    const guild = await svc
      .repositories(tenant)
      .discord()
      .updateGuild(c.req.valid('json'), svc.now());
    return c.json(guild, 200);
  });

  app.openapi(listDiscordChannelsRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    c.header('cache-control', 'no-store');
    return c.json(
      { items: (await svc.repositories(tenant).discord().channels()).map(channelView) },
      200,
    );
  });

  app.openapi(createDiscordChannelRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    const created = await svc
      .repositories(tenant)
      .discord()
      .createChannel(c.req.valid('json'), svc.now());
    return c.json(channelView(created), 201);
  });

  app.openapi(patchDiscordChannelRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    const updated = await svc
      .repositories(tenant)
      .discord()
      .patchChannel(c.req.valid('param').id, c.req.valid('json'), svc.now());
    return c.json(channelView(updated), 200);
  });

  app.openapi(deleteDiscordChannelRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    await svc.repositories(tenant).discord().deleteChannel(c.req.valid('param').id, svc.now());
    return c.body(null, 204);
  });

  app.openapi(testDiscordChannelRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    const id = c.req.valid('param').id;
    const repos = svc.repositories(tenant);
    const repo = repos.discord();
    const { url, name } = await repo.webhookForTest(id);
    const t = await repos.tenant().current();
    const settings = effectiveTenantSettings(t?.settings);
    const now = svc.now();
    const [message] = testMessage(
      {
        lang: settings.defaultLanguage,
        tenantName: t?.displayName ?? '',
        tenantTimeZone: settings.tenantTimezone,
        showNames: false,
        now,
      },
      name,
    );
    if (!message) throw new ProblemError('internal.error');
    const result = await postWebhook(url, message, svc.discordFetch);
    if (result.kind === 'invalid') throw new ProblemError('discord.webhook_invalid');
    if (result.kind !== 'ok') {
      const error =
        result.kind === 'rate_limited'
          ? ('http_429' as const)
          : 'status' in result && result.status !== null
            ? (`http_${result.status}` as const)
            : ('network' as const);
      await repo.recordTest(id, result.kind === 'redirect' ? 'redirect' : error, now);
      logger.warn('discord_test_failed', { channelId: id, kind: result.kind });
      throw new ProblemError('discord.test_failed');
    }
    await repo.recordTest(id, null, now);
    return c.json({ ok: true as const, sentAt: isoUtc(now) }, 200);
  });

  return app;
}
