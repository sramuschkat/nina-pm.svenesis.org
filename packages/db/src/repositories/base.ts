/**
 * Mandanten-Guard (TK 6.7): Repositories erhalten den Mandantenkontext aus der Sitzung, nie aus der
 * Anfrage, und filtern jede Abfrage selbst nach `tenant_id` (NFA-16). Handler bekommen nur
 * Repositories, nie `db`.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../types';

export interface TenantContext {
  readonly tenantId: string;
  readonly memberId?: string;
  readonly role?: 'owner' | 'admin' | 'user';
}

export abstract class TenantRepo {
  constructor(
    protected readonly db: Kysely<Database>,
    protected readonly ctx: TenantContext,
  ) {
    if (!ctx.tenantId) throw new Error('Repository ohne Mandantenkontext');
  }
}
