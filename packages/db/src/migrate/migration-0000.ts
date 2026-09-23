/**
 * Migration 0000 (TK 6.8, SV-13/SV-14, ADR-S1): DB-Rollen `app_rw` und `app_job` und die drei
 * `AWS IAM GRANT`s – idempotent, bei jedem Lauf wiederholbar. Kein `GRANT USAGE ON SCHEMA public`
 * (DSQL: 0A000, nicht nötig). Lokal werden die Rollen mit Passwort angelegt und IAM-Grants übersprungen.
 */
import type { MigrationLog, MigrationMode, SqlClient } from './types';

export const MIGRATION_0000_VERSION = '2026-09-23.1';
export const APP_ROLES = ['app_rw', 'app_job'] as const;
export type AppRole = (typeof APP_ROLES)[number];

export interface IamGrant {
  readonly role: AppRole;
  readonly arn: string;
}

export interface Migration0000Options {
  readonly mode: MigrationMode;
  /** Nur DSQL: Zuordnung DB-Rolle → IAM-Rolle (prod: NinaPmApi, NinaPmOpsCli → app_rw; NinaPmWorker → app_job). */
  readonly iamGrants?: readonly IamGrant[];
  /** Nur lokal: Passwörter der Rollen (TK 6.9). */
  readonly localPasswords?: Readonly<Record<AppRole, string>>;
  readonly log?: MigrationLog;
}

const ARN = /^arn:aws[\w-]*:iam::\d{12}:(role|user)\/[\w+=,.@/-]+$/;
const quoteLiteral = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Liefert die ausgeführten Änderungen; beim zweiten Lauf ist die Liste leer. */
export async function migration0000(
  client: SqlClient,
  options: Migration0000Options,
): Promise<string[]> {
  const log = options.log ?? (() => undefined);
  const changes: string[] = [];
  for (const role of APP_ROLES) {
    const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
    if (exists.rows.length > 0) continue;
    if (options.mode === 'dsql') {
      await client.query(`CREATE ROLE ${role} WITH LOGIN`);
    } else {
      const password = options.localPasswords?.[role];
      if (!password) throw new Error(`Lokales Passwort für ${role} fehlt`);
      await client.query(`CREATE ROLE ${role} WITH LOGIN PASSWORD ${quoteLiteral(password)}`);
    }
    changes.push(`CREATE ROLE ${role}`);
  }
  if (options.mode === 'dsql') {
    for (const { role, arn } of options.iamGrants ?? []) {
      if (!ARN.test(arn)) throw new Error(`Ungültige IAM-ARN für ${role}: ${arn}`);
      const mapped = await client.query(
        'SELECT 1 FROM sys.iam_pg_role_mappings WHERE pg_role_name = $1 AND arn = $2',
        [role, arn],
      );
      if (mapped.rows.length > 0) continue;
      await client.query(`AWS IAM GRANT ${role} TO ${quoteLiteral(arn)}`);
      changes.push(`AWS IAM GRANT ${role} TO ${arn}`);
    }
  }
  for (const c of changes) log(`0000: ${c}`);
  return changes;
}

/** IAM-Zuordnung in prod (iam.md §1, TK 4.2). */
export function prodIamGrants(account: string): IamGrant[] {
  const arn = (name: string) => `arn:aws:iam::${account}:role/${name}`;
  return [
    { role: 'app_rw', arn: arn('NinaPmApi') },
    { role: 'app_rw', arn: arn('NinaPmOpsCli') },
    { role: 'app_job', arn: arn('NinaPmWorker') },
  ];
}
