/** Minimale Verbindung für Runner und Migration 0000 (node-postgres `Client` bzw. `AuroraDSQLClient`). */
export interface SqlClient {
  query(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

/** `dsql`: echtes Aurora DSQL; `postgres`: lokal/CI mit PostgreSQL 16 (TK 6.9). */
export type MigrationMode = 'dsql' | 'postgres';

export interface Migration {
  /** z. B. `0001_system` */
  readonly id: string;
  readonly sql: string;
}

export type MigrationLog = (line: string) => void;
