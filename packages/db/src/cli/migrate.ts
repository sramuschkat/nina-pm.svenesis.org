/** `pnpm db:migrate` – lokal gegen PostgreSQL 16: Migration 0000 (ohne IAM) und alle Migrationen. */
import { loadMigrations } from '../migrate/files';
import { migration0000 } from '../migrate/migration-0000';
import { runMigrations } from '../migrate/runner';
import { connectLocal, LOCAL_PASSWORDS, LOCAL_URL } from './local';

const client = await connectLocal();
try {
  console.log(`Migriere ${LOCAL_URL.replace(/:[^:@/]+@/, ':***@')}`);
  const changes = await migration0000(client, {
    mode: 'postgres',
    localPasswords: LOCAL_PASSWORDS,
    log: console.log,
  });
  const res = await runMigrations(client, loadMigrations(), { mode: 'postgres', log: console.log });
  console.log(
    `0000: ${changes.length} Änderungen; ${res.applied.length} Anweisungen angewandt, ${res.skipped} bereits vorhanden.`,
  );
} finally {
  await client.end();
}
