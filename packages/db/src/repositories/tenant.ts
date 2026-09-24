import {
  effectiveTenantSettings,
  ProblemError,
  type TenantSettings,
  type TenantSettingsPatch,
} from '@nina-pm/shared';
import type { Selectable } from 'kysely';
import { withTx, type WithTxOptions } from '../tx';
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

  /** Mandanteneinstellungen mit Standardwerten (S-71, FA-MAN-05). */
  async settings(): Promise<{ displayName: string; settings: TenantSettings; updatedAt: Date }> {
    const tenant = await this.current();
    if (!tenant) throw new ProblemError('tenant.not_found');
    return {
      displayName: tenant.displayName,
      settings: effectiveTenantSettings(tenant.settings),
      updatedAt: tenant.updatedAt,
    };
  }

  /**
   * Einstellungen ändern (nur geprüfte Schlüssel aus `tenantSettingsKeys`, TK 7.2); jede Änderung mit
   * altem und neuem Wert im Änderungsprotokoll (`entity = 'tenant'`).
   */
  updateSettings(patch: TenantSettingsPatch, now: Date, options: WithTxOptions = {}) {
    return withTx(
      this.db,
      async (trx) => {
        const tenant = await trx
          .selectFrom('tenant')
          .selectAll()
          .where('id', '=', this.ctx.tenantId)
          .forUpdate()
          .executeTakeFirst();
        if (!tenant) throw new ProblemError('tenant.not_found');
        const before = effectiveTenantSettings(tenant.settings);
        const stored = { ...(tenant.settings ?? {}), ...(patch.settings ?? {}) };
        const diff: Record<string, { from: unknown; to: unknown }> = {};
        for (const [key, value] of Object.entries(patch.settings ?? {})) {
          const from = before[key as keyof TenantSettings];
          if (from !== value) diff[key] = { from, to: value };
        }
        if (patch.displayName !== undefined && patch.displayName !== tenant.displayName)
          diff.displayName = { from: tenant.displayName, to: patch.displayName };
        if (Object.keys(diff).length > 0) {
          await trx
            .updateTable('tenant')
            .set({
              settings: JSON.stringify(stored) as never,
              displayName: patch.displayName ?? tenant.displayName,
              updatedAt: now,
            })
            .where('id', '=', this.ctx.tenantId)
            .execute();
          await trx
            .insertInto('changeLog')
            .values({
              tenantId: this.ctx.tenantId,
              entity: 'tenant',
              entityId: this.ctx.tenantId,
              userId: this.ctx.memberId ?? null,
              action: 'update',
              diff: JSON.stringify(diff),
              createdAt: now,
            })
            .execute();
        }
      },
      options,
    ).then(() => this.settings());
  }
}
