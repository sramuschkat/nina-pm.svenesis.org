/**
 * `pnpm demo:export` (nur Sven, Admin-Profil, H-06): Aufbau des **Test-Mandanten** aus prod lesen –
 * `ops-cli export-setup` per `aws lambda invoke` – und als JSON unter
 * `docs/test-runs/<YYYY-MM-DD>/demo-evaluation/test-tenant-export.json` ablegen. Grundlage für passende
 * Auswertungs-Demodaten. Ändert nichts in prod (die Lambda schreibt nur ihre Zeile `system_audit`).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exit } from 'node:process';
import { config } from '@nina-pm/infra/config';
import { repoRoot } from './golive/run';

function fail(message: string): never {
  console.error(`demo:export: ${message}`);
  exit(1);
}

const account = spawnSync(
  'aws',
  ['sts', 'get-caller-identity', '--query', 'Account', '--output', 'text'],
  { encoding: 'utf8' },
);
if (account.stdout.trim() !== config.account)
  fail(
    `Falsches AWS-Konto (${account.stdout.trim() || 'keine Anmeldung'}), erwartet ${config.account}. Admin-Profil setzen (AWS_PROFILE).`,
  );

const dir = mkdtempSync(join(tmpdir(), 'npm-demo-export-'));
const out = join(dir, 'out.json');
try {
  const res = spawnSync(
    'aws',
    [
      'lambda',
      'invoke',
      '--function-name',
      config.lambdas.opsCli.functionName,
      '--region',
      config.region,
      '--cli-binary-format',
      'raw-in-base64-out',
      '--payload',
      JSON.stringify({ command: 'export-setup', tenant: 'test' }),
      out,
    ],
    { encoding: 'utf8' },
  );
  if (res.status !== 0) fail(`aws lambda invoke: ${res.stderr.trim()}`);
  const meta = JSON.parse(res.stdout || '{}') as { FunctionError?: string };
  const body = JSON.parse(readFileSync(out, 'utf8')) as {
    ok?: boolean;
    output?: Record<string, unknown>;
    errorMessage?: string;
  };
  if (meta.FunctionError) fail(`Lambda-Fehler: ${body.errorMessage ?? meta.FunctionError}`);
  if (!body.ok || !body.output) fail(`ops-cli meldet: ${JSON.stringify(body.output ?? body)}`);

  const now = new Date();
  const day = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const target = `${repoRoot}docs/test-runs/${day}/demo-evaluation`;
  if (!existsSync(target)) mkdirSync(target, { recursive: true });
  const file = `${target}/test-tenant-export.json`;
  writeFileSync(file, `${JSON.stringify(body.output, null, 2)}\n`);

  const o = body.output as {
    rigs?: unknown[];
    filters?: unknown[];
    projects?: unknown[];
    evaluation?: { rows?: Record<string, number> };
  };
  console.log(`Export geschrieben: ${file.replace(repoRoot, '')}`);
  console.log(
    `Rigs ${String(o.rigs?.length ?? 0)}, Filter ${String(o.filters?.length ?? 0)}, Projekte ${String(o.projects?.length ?? 0)}, Sessions ${String(o.evaluation?.rows?.session ?? 0)}, Aufnahmen ${String(o.evaluation?.rows?.capture ?? 0)}`,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
