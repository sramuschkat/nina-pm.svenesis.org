/**
 * Lambda `migrate` (TK 6.8, iam.md §4): CDK-Trigger bei jedem Deploy mit neuen Migrationen, **vor**
 * NinaPm-Api und NinaPm-Jobs. Verbindet als DSQL-`admin`, führt Migration 0000 (Rollen, AWS IAM GRANT)
 * idempotent aus und danach alle offenen Migrationen. Ein Fehler lässt den Deploy scheitern.
 */
import { connectDsql, migration0000, runMigrations, type IamGrant } from '@nina-pm/db/migrate';
import { bundledMigrations } from '@nina-pm/db/migrate/bundled';
import { logger } from '../lib/logger';
import { requiredEnv, ssmString } from '../lib/params';

export async function handler() {
  const endpoint = await ssmString(requiredEnv('DSQL_ENDPOINT_PARAM'))();
  const iamGrants = JSON.parse(requiredEnv('MIGRATE_IAM_GRANTS')) as IamGrant[];
  const client = await connectDsql(endpoint, 'admin');
  try {
    const log = (line: string) => logger.info(line);
    const changes = await migration0000(client, { mode: 'dsql', iamGrants, log });
    const result = await runMigrations(client, bundledMigrations, { mode: 'dsql', log });
    const summary = {
      migration0000: changes,
      applied: result.applied.length,
      skipped: result.skipped,
    };
    logger.info('migrate_done', summary);
    return summary;
  } finally {
    await client.end();
  }
}
