import type { Selectable } from 'kysely';
import type { TenantTable } from '../types';
import { TenantRepo } from './base';

export type Tenant = Selectable<TenantTable>;

/**
 * Beispiel-Repository (AP-03): der eigene Mandant. Jede Methode bindet an `ctx.tenantId`;
 * eine fremde ID liefert nichts (Isolationstest).
 */
export class TenantRepository extends TenantRepo {
  current(): Promise<Tenant | undefined> {
    return this.db
      .selectFrom('tenant')
      .selectAll()
      .where('id', '=', this.ctx.tenantId)
      .executeTakeFirst();
  }

  /** Liefert den Mandanten nur, wenn `id` der eigene ist. */
  byId(id: string): Promise<Tenant | undefined> {
    return this.db
      .selectFrom('tenant')
      .selectAll()
      .where('id', '=', id)
      .where('id', '=', this.ctx.tenantId)
      .executeTakeFirst();
  }

  async rename(id: string, displayName: string): Promise<number> {
    const res = await this.db
      .updateTable('tenant')
      .set({ displayName, updatedAt: new Date() })
      .where('id', '=', id)
      .where('id', '=', this.ctx.tenantId)
      .executeTakeFirst();
    return Number(res.numUpdatedRows);
  }
}
