/**
 * Simulationen (AP-13f, TK 7.2 „Simulation“): ein im Browser gerechneter Nachtplan wird als
 * `night_plan(origin = 'web_simulation', reason = 'simulation')` gespeichert – ohne Session, mit dem
 * auslösenden Mitglied. Das Rig muss zum Mandanten gehören (sonst 404).
 */
import { ProblemError } from '@nina-pm/shared';
import { TenantRepo } from './base';

export interface SimulationSave {
  readonly rigId: string;
  readonly night: string;
  readonly engineVersion: string;
  readonly inputHash: string;
  /** Plan ohne Blöcke (Hashes, Zeitmarken, Zusammenfassung, Diagnose, Warnungen). */
  readonly summary: Record<string, unknown>;
  readonly blocks: readonly unknown[];
}

export class SimulationRepository extends TenantRepo {
  async save(input: SimulationSave, now: Date): Promise<{ id: string; createdAt: Date }> {
    const rig = await this.db
      .selectFrom('rig')
      .select('id')
      .where('tenantId', '=', this.ctx.tenantId)
      .where('id', '=', input.rigId)
      .executeTakeFirst();
    if (!rig) throw new ProblemError('resource.not_found');
    const row = await this.db
      .insertInto('nightPlan')
      .values({
        tenantId: this.ctx.tenantId,
        rigId: input.rigId,
        night: input.night,
        origin: 'web_simulation',
        reason: 'simulation',
        engineVersion: input.engineVersion,
        inputHash: input.inputHash,
        summary: JSON.stringify(input.summary),
        blocks: JSON.stringify(input.blocks),
        createdBy: this.ctx.memberId ?? null,
        createdAt: now,
      })
      .returning(['id', 'createdAt'])
      .executeTakeFirstOrThrow();
    return { id: row.id, createdAt: new Date(row.createdAt) };
  }
}
