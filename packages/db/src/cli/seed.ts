/** `pnpm db:seed` – Demo-Seed lokal (docs/seed/seed-demo.json). */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../repositories/database';
import { seedCore, seedEquipment, type SeedDemo } from '../seed';
import { connectLocal, LOCAL_URL } from './local';

const file = fileURLToPath(new URL('../../../../docs/seed/seed-demo.json', import.meta.url));
const seed = JSON.parse(readFileSync(file, 'utf8')) as SeedDemo;
const client = await connectLocal();
try {
  const res = await seedCore(client, seed);
  console.log(
    `Seed: ${res.tenants} Mandanten, ${res.identities} Identitäten, ${res.members} Mitgliedschaften, ${res.superUsers} Super User.`,
  );
  for (const n of res.notes) console.log(`  Hinweis: ${n}`);
  const db = openDatabase({ kind: 'postgres', connectionString: LOCAL_URL });
  try {
    const eq = await seedEquipment(
      db.repositories({ tenantId: seed.tenant.id }).equipment(),
      seed.tenant.id,
      seed,
      new Date(),
    );
    console.log(
      `Ausrüstung: ${eq.sites} Standorte, ${eq.telescopes} Teleskope, ${eq.cameras} Kameras, ${eq.filters} Filter, ${eq.rigs} Rigs.`,
    );
    for (const n of eq.notes) console.log(`  Hinweis: ${n}`);
  } finally {
    await db.close();
  }
  console.log(
    '  Projekte, NINA-Instanzen und Discord-Kanäle folgen mit AP-12a (Freigabe), AP-14c, AP-60.',
  );
} finally {
  await client.end();
}
