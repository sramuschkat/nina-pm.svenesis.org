/** Persönliche Einstellungen je Mitgliedschaft (`user_preference`), mandanten- und mitgliedsgebunden. */
import type { Kysely } from 'kysely';
import type { Database } from '../types';
import { TenantRepo, type TenantContext } from './base';
import { retryOcc } from '../tx';

export class PreferenceRepository extends TenantRepo {
  constructor(db: Kysely<Database>, ctx: TenantContext) {
    super(db, ctx);
    if (!ctx.memberId) throw new Error('PreferenceRepository ohne Mitglied');
  }

  async all(keys: readonly string[]): Promise<Record<string, unknown>> {
    if (keys.length === 0) return {};
    const rows = await this.db
      .selectFrom('userPreference')
      .select(['prefKey', 'value'])
      .where('tenantId', '=', this.ctx.tenantId)
      .where('userId', '=', this.ctx.memberId ?? '')
      .where('prefKey', 'in', keys)
      .execute();
    return Object.fromEntries(rows.map((r) => [r.prefKey, r.value]));
  }

  async set(key: string, value: unknown, now: Date): Promise<void> {
    const json = JSON.stringify(value);
    await retryOcc(() =>
      this.db
        .insertInto('userPreference')
        .values({
          tenantId: this.ctx.tenantId,
          userId: this.ctx.memberId ?? '',
          prefKey: key,
          value: json,
          updatedAt: now,
        })
        .onConflict((oc) =>
          oc.columns(['userId', 'prefKey']).doUpdateSet({ value: json, updatedAt: now }),
        )
        .execute(),
    );
  }
}
