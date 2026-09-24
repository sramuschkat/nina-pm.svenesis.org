/** Benachrichtigungen in der Anwendung (FA-FRG-11, TK 7.2; R1 ohne Discord). */
import { z } from 'zod';
import { notificationKinds } from '../generated/enums';
import { Uuid, UtcInstant } from './common';

export const NotificationKindSchema = z.enum(notificationKinds);

export const NotificationView = z
  .object({
    id: Uuid,
    kind: NotificationKindSchema,
    /** Werte für den i18n-Text `notifications.kind.<kind>` (z. B. `from`, `to`). */
    payload: z.record(z.string(), z.unknown()),
    projectId: Uuid.nullable(),
    readAt: UtcInstant.nullable(),
    createdAt: UtcInstant,
  })
  .meta({ id: 'NotificationView' });
export type NotificationView = z.infer<typeof NotificationView>;

export const NotificationList = z
  .object({
    items: z.array(NotificationView),
    unreadCount: z.number().int(),
    nextCursor: z.string().nullable(),
  })
  .meta({ id: 'NotificationList' });
export type NotificationList = z.infer<typeof NotificationList>;

export const NotificationListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
  unread: z.enum(['true', 'false']).optional(),
});

export const MarkNotificationsRead = z
  .union([
    z.object({ ids: z.array(Uuid).min(1).max(200) }).strict(),
    z.object({ all: z.literal(true) }).strict(),
  ])
  .meta({ id: 'MarkNotificationsRead' });

export const UnreadCount = z.object({ unreadCount: z.number().int() }).meta({ id: 'UnreadCount' });
