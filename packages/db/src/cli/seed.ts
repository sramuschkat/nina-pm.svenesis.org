/** `pnpm db:seed` – Demo-Seed lokal (docs/seed/seed-demo.json). */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seedCore, type SeedDemo } from '../seed';
import { connectLocal } from './local';

const file = fileURLToPath(new URL('../../../../docs/seed/seed-demo.json', import.meta.url));
const seed = JSON.parse(readFileSync(file, 'utf8')) as SeedDemo;
const client = await connectLocal();
try {
  const res = await seedCore(client, seed);
  console.log(
    `Seed: ${res.tenants} Mandanten, ${res.identities} Identitäten, ${res.members} Mitgliedschaften, ${res.superUsers} Super User.`,
  );
  for (const n of res.notes) console.log(`  Hinweis: ${n}`);
  console.log(
    '  Ausrüstung, Projekte, NINA-Instanzen und Discord-Kanäle folgen mit AP-09a, AP-11a, AP-14c, AP-60.',
  );
} finally {
  await client.end();
}
