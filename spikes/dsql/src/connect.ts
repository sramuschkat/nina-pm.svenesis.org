/** Verbindungen zum Spike-Cluster: offizieller Connector (TK 6.5) und Rückfall node-postgres + DsqlSigner. */
import { DsqlSigner } from '@aws-sdk/dsql-signer';
import { AuroraDSQLClient } from '@aws/aurora-dsql-node-postgres-connector';
import pg from 'pg';
import type { SqlClient } from './protocol';

export async function connectWithConnector(endpoint: string, user: string): Promise<SqlClient> {
  const client = new AuroraDSQLClient({
    host: endpoint,
    user,
    database: 'postgres',
    ssl: { rejectUnauthorized: true },
  });
  client.on('error', () => undefined);
  await client.connect();
  return client as unknown as SqlClient;
}

export async function connectWithSigner(
  endpoint: string,
  region: string,
  user: string,
): Promise<SqlClient> {
  const signer = new DsqlSigner({ hostname: endpoint, region });
  const password =
    user === 'admin'
      ? await signer.getDbConnectAdminAuthToken()
      : await signer.getDbConnectAuthToken();
  const client = new pg.Client({
    host: endpoint,
    port: 5432,
    database: 'postgres',
    user,
    password,
    ssl: { rejectUnauthorized: true },
  });
  client.on('error', () => undefined);
  await client.connect();
  return client as unknown as SqlClient;
}

/**
 * AWS IAM GRANT erwartet eine IAM-Rolle oder einen IAM-Benutzer. Eine STS-Sitzung
 * (`arn:aws:sts::<konto>:assumed-role/<rolle>/<sitzung>`) wird auf die Rolle zurückgeführt.
 */
export function iamPrincipalForGrant(callerArn: string): string {
  const assumed = /^arn:(aws[\w-]*):sts::(\d{12}):assumed-role\/([^/]+)\/.+$/.exec(callerArn);
  if (assumed) return `arn:${assumed[1]}:iam::${assumed[2]}:role/${assumed[3]}`;
  return callerArn;
}
