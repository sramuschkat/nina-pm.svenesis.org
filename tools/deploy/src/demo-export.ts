/**
 * `pnpm demo:export` (nur Sven, Admin-Profil, H-06): Aufbau des **Test-Mandanten** aus prod lesen –
 * `ops-cli export-setup` per `aws lambda invoke` – und als JSON unter
 * `docs/test-runs/<YYYY-MM-DD>/demo-evaluation/test-tenant-export.json` ablegen. Grundlage für passende
 * Auswertungs-Demodaten. Ändert nichts in prod (die Lambda schreibt nur ihre Zeile `system_audit`).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { repoRoot } from './golive/run';
import { checkAccount, demoRunDir, invokeOps } from './ops-invoke';

const SCRIPT = 'demo:export';
checkAccount(SCRIPT);
const output = invokeOps<{
  rigs?: unknown[];
  filters?: unknown[];
  projects?: unknown[];
  evaluation?: { rows?: Record<string, number> };
}>(SCRIPT, { command: 'export-setup', tenant: 'test' });
const dir = demoRunDir(repoRoot);
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
const file = `${dir}/test-tenant-export.json`;
writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Export geschrieben: ${file.replace(repoRoot, '')}`);
console.log(
  `Rigs ${String(output.rigs?.length ?? 0)}, Filter ${String(output.filters?.length ?? 0)}, Projekte ${String(output.projects?.length ?? 0)}, Sessions ${String(output.evaluation?.rows?.session ?? 0)}, Aufnahmen ${String(output.evaluation?.rows?.capture ?? 0)}`,
);
