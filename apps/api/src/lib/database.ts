import { openDatabase, type AppDbRole, type OpenDatabase } from '@nina-pm/db';
import { lazy } from './lazy';
import { logger } from './logger';
import { requiredEnv, ssmString } from './params';

/** DSQL-Verbindung der Lambda (Rolle aus `DSQL_DB_ROLE`: api → app_rw, worker → app_job, TK 6.2). */
export const lambdaDatabase: () => Promise<OpenDatabase> = lazy(async () => {
  const endpoint = await ssmString(requiredEnv('DSQL_ENDPOINT_PARAM'))();
  const role = requiredEnv('DSQL_DB_ROLE') as AppDbRole;
  return openDatabase({ kind: 'dsql', endpoint, role }, (error) =>
    logger.error('db_pool_error', { error }),
  );
});
