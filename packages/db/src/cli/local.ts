/** Gemeinsame Einstellungen der lokalen Kommandos (TK 6.9). */
import pg from 'pg';

export const LOCAL_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/ninapm';
export const LOCAL_PASSWORDS = {
  app_rw: process.env.APP_RW_PASSWORD ?? 'app_rw_local',
  app_job: process.env.APP_JOB_PASSWORD ?? 'app_job_local',
};

export async function connectLocal(): Promise<pg.Client> {
  const client = new pg.Client({
    connectionString: LOCAL_URL,
    options: '-c default_transaction_isolation=repeatable\\ read',
  });
  await client.connect();
  return client;
}
