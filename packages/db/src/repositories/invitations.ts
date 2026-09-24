/** Gemeinsame Bausteine für Einladungen (TK 5.2, FA-BEN-01, FA-SU-05). */
import { createHash, randomBytes } from 'node:crypto';
import { ProblemError } from '@nina-pm/shared';
import type { Transaction } from 'kysely';
import type { Database } from '../types';

export interface NewInvitation {
  readonly id: string;
  readonly tenantId: string;
  readonly role: 'owner' | 'admin' | 'user';
  readonly discordUserId?: string | undefined;
  readonly maxUses?: number | undefined;
  readonly validDays: number;
  readonly note?: string | undefined;
  readonly createdByMember?: string | null;
  readonly createdBySuper?: string | null;
  readonly now: Date;
}

export interface CreatedInvitation {
  readonly id: string;
  readonly role: 'owner' | 'admin' | 'user';
  /** Klartext, nur einmal zurückgegeben; gespeichert wird nur SHA-256 (TK 5.2). */
  readonly token: string;
  readonly expiresAt: Date;
}

/**
 * Legt eine Einladung an (256 Bit Token, nur Hash gespeichert). Die Client-UUID macht die Anlage
 * idempotent: existiert sie schon, gibt es das Token nicht noch einmal → `409 resource.in_use`.
 */
export async function insertInvitation(
  trx: Transaction<Database>,
  inv: NewInvitation,
): Promise<CreatedInvitation> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(inv.now.getTime() + inv.validDays * 86_400_000);
  const row = await trx
    .insertInto('invitation')
    .values({
      id: inv.id,
      tenantId: inv.tenantId,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      role: inv.role,
      discordUserId: inv.discordUserId ?? null,
      note: inv.note ?? null,
      maxUses: inv.role === 'user' ? (inv.maxUses ?? 1) : 1,
      expiresAt,
      createdByMember: inv.createdByMember ?? null,
      createdBySuper: inv.createdBySuper ?? null,
      createdAt: inv.now,
    })
    .onConflict((oc) => oc.column('id').doNothing())
    .returning('id')
    .executeTakeFirst();
  if (!row) throw new ProblemError('resource.in_use');
  return { id: inv.id, role: inv.role, token, expiresAt };
}
