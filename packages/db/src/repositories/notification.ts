/**
 * Benachrichtigungen in der Anwendung (FA-FRG-11, TK 7.2). Schreiben über `insertNotifications` (in der
 * Transaktion des Auslösers); Lesen nur für das angemeldete Mitglied im eigenen Mandanten.
 */
import { notificationKinds, type NotificationKind } from '@nina-pm/shared';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from '../types';
import { TenantRepo, type TenantContext } from './base';

export interface NewNotifications {
  readonly tenantId: string;
  /** Empfänger (`app_user.id`); doppelte werden entfernt. */
  readonly recipients: readonly string[];
  readonly kind: NotificationKind;
  readonly payload?: Record<string, unknown>;
  readonly projectId?: string | null;
  readonly now: Date;
}

/** Legt je Empfänger eine Benachrichtigung an; Art nur aus `enums.json notificationKinds`. */
export async function insertNotifications(
  db: Kysely<Database> | Transaction<Database>,
  n: NewNotifications,
): Promise<number> {
  if (!(notificationKinds as readonly string[]).includes(n.kind))
    throw new Error(`Unbekannte Benachrichtigungsart ${n.kind}`);
  const recipients = [...new Set(n.recipients)];
  if (recipients.length === 0) return 0;
  await db
    .insertInto('notification')
    .values(
      recipients.map((recipientId) => ({
        tenantId: n.tenantId,
        recipientId,
        kind: n.kind,
        projectId: n.projectId ?? null,
        payload: JSON.stringify(n.payload ?? {}),
        createdAt: n.now,
      })),
    )
    .execute();
  return recipients.length;
}

export interface NotificationRow {
  id: string;
  kind: string;
  payload: unknown;
  projectId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

/** Cursor = `<createdAt ISO>|<id>` (absteigend nach Zeit, dann ID). */
export function encodeCursor(row: Pick<NotificationRow, 'createdAt' | 'id'>): string {
  return Buffer.from(`${new Date(row.createdAt).toISOString()}|${row.id}`).toString('base64url');
}

export function decodeCursor(cursor: string): { at: Date; id: string } | undefined {
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const date = at ? new Date(Date.parse(at)) : undefined;
  if (!date || Number.isNaN(date.getTime()) || !id || !/^[0-9a-f-]{36}$/i.test(id))
    return undefined;
  return { at: date, id };
}

export class NotificationRepository extends TenantRepo {
  constructor(db: Kysely<Database>, ctx: TenantContext) {
    super(db, ctx);
    if (!ctx.memberId) throw new Error('NotificationRepository ohne Mitglied');
  }

  private get member(): string {
    return this.ctx.memberId ?? '';
  }

  async list(opts: {
    limit: number;
    cursor?: string | undefined;
    unreadOnly?: boolean;
  }): Promise<{ items: NotificationRow[]; nextCursor: string | null }> {
    let q = this.db
      .selectFrom('notification')
      .select(['id', 'kind', 'payload', 'projectId', 'readAt', 'createdAt'])
      .where('tenantId', '=', this.ctx.tenantId)
      .where('recipientId', '=', this.member);
    if (opts.unreadOnly) q = q.where('readAt', 'is', null);
    const cursor = opts.cursor ? decodeCursor(opts.cursor) : undefined;
    if (cursor) q = q.where(sql<boolean>`(created_at, id) < (${cursor.at}, ${cursor.id}::uuid)`);
    const rows = await q
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
      .limit(opts.limit + 1)
      .execute();
    const items = rows.slice(0, opts.limit) as NotificationRow[];
    const last = items.at(-1);
    return { items, nextCursor: rows.length > opts.limit && last ? encodeCursor(last) : null };
  }

  async unreadCount(): Promise<number> {
    const row = await this.db
      .selectFrom('notification')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('tenantId', '=', this.ctx.tenantId)
      .where('recipientId', '=', this.member)
      .where('readAt', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  /** Nur eigene Benachrichtigungen; fremde IDs werden ignoriert. */
  async markRead(target: { ids: readonly string[] } | 'all', now: Date): Promise<void> {
    let q = this.db
      .updateTable('notification')
      .set({ readAt: now })
      .where('tenantId', '=', this.ctx.tenantId)
      .where('recipientId', '=', this.member)
      .where('readAt', 'is', null);
    if (target !== 'all') q = q.where('id', 'in', target.ids);
    await q.execute();
  }
}
