/** Benachrichtigungen in der Anwendung (TK 7.2, FA-FRG-11): Liste mit Zähler, als gelesen markieren. */
import { OpenAPIHono } from '@hono/zod-openapi';
import {
  MarkNotificationsRead,
  NotificationList,
  NotificationListQuery,
  UnreadCount,
  type NotificationKind,
} from '@nina-pm/shared';
import type { ApiEnv } from '../lib/env';
import { isoUtc, isoUtcOrNull } from '../lib/format';
import { defineRoute, problemContent } from './define';
import type { ApiServices } from './services';
import { requireTenant } from './tenant';

export const listNotificationsRoute = defineRoute(
  { action: 'notification.read', requirements: ['FA-FRG-11', 'TK 7.2'] },
  {
    method: 'get',
    path: '/api/web/v1/notifications',
    summary: 'Eigene Benachrichtigungen (neueste zuerst) mit Anzahl ungelesener',
    tags: ['notifications'],
    request: { query: NotificationListQuery },
    responses: {
      200: {
        description: 'Benachrichtigungen',
        content: { 'application/json': { schema: NotificationList } },
      },
      401: problemContent('Nicht angemeldet'),
      403: problemContent('Kein Mandanten-Kontext'),
    },
  },
);

export const markReadRoute = defineRoute(
  { action: 'notification.read', requirements: ['FA-FRG-11', 'TK 7.2'] },
  {
    method: 'post',
    path: '/api/web/v1/notifications/read',
    summary: 'Eigene Benachrichtigungen als gelesen markieren (einzelne oder alle)',
    tags: ['notifications'],
    request: {
      body: { content: { 'application/json': { schema: MarkNotificationsRead } }, required: true },
    },
    responses: {
      200: {
        description: 'Verbleibende ungelesene',
        content: { 'application/json': { schema: UnreadCount } },
      },
      401: problemContent('Nicht angemeldet'),
      403: problemContent('Kein Mandanten-Kontext'),
    },
  },
);

export const NOTIFICATION_ROUTES = [listNotificationsRoute, markReadRoute] as const;

export function webNotificationRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();

  app.openapi(listNotificationsRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    const q = c.req.valid('query');
    const repo = svc.repositories(tenant).notification();
    const page = await repo.list({
      limit: q.limit,
      cursor: q.cursor,
      unreadOnly: q.unread === 'true',
    });
    c.header('cache-control', 'no-store');
    return c.json(
      {
        items: page.items.map((n) => ({
          id: n.id,
          kind: n.kind as NotificationKind,
          payload: (n.payload ?? {}) as Record<string, unknown>,
          projectId: n.projectId,
          readAt: isoUtcOrNull(n.readAt),
          createdAt: isoUtc(n.createdAt),
        })),
        unreadCount: await repo.unreadCount(),
        nextCursor: page.nextCursor,
      },
      200,
    );
  });

  app.openapi(markReadRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    const body = c.req.valid('json');
    const repo = svc.repositories(tenant).notification();
    await repo.markRead('all' in body ? 'all' : { ids: body.ids }, svc.now());
    return c.json({ unreadCount: await repo.unreadCount() }, 200);
  });

  return app;
}
