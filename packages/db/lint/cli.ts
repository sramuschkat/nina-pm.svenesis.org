/** `pnpm db:lint` – prüft alle Migrationen (TK 6.8). */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lintMigration } from './index';

const dir = fileURLToPath(new URL('../migrations/', import.meta.url));
const files = readdirSync(dir)
  .filter((f) => /^\d{4}_.+\.sql$/.test(f))
  .sort();
const read = (f: string) => readFileSync(`${dir}${f}`, 'utf8');
// Spätere Migrationen dürfen Rechte nachreichen (lintMigration, `later`).
const findings = files.flatMap((f, i) =>
  lintMigration(
    f,
    read(f),
    files
      .slice(i + 1)
      .map(read)
      .join('\n'),
  ),
);
for (const f of findings) console.error(`${f.file} #${f.statement} [${f.rule}] ${f.message}`);
if (findings.length > 0) process.exit(1);
console.log('DSQL-Lint: keine Befunde.');
