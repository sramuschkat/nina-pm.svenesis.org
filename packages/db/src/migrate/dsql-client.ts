/** Admin-Verbindung zu DSQL für `migrate` und `pnpm test:dsql` (offizieller Connector, IAM-Token). */
import { AuroraDSQLClient } from '@aws/aurora-dsql-node-postgres-connector';
import type { SqlClient } from './types';

export interface DsqlClient extends SqlClient {
  end(): Promise<void>;
}

export async function connectDsql(endpoint: string, user: string): Promise<DsqlClient> {
  const client = new AuroraDSQLClient({ host: endpoint, user, database: 'postgres' });
  client.on('error', () => undefined);
  await client.connect();
  return client as unknown as DsqlClient;
}
