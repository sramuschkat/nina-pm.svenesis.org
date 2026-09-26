/**
 * Aufruf der Lambda `ops-cli` von Svens Rechner (Admin-Profil, H-06): Konto prüfen, `aws lambda invoke`,
 * Antwort `{ok, command, output}` lesen. Für `pnpm demo:export` und `pnpm demo:evaluation`.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exit } from 'node:process';
import { config } from '@nina-pm/infra/config';

export function fail(script: string, message: string): never {
  console.error(`${script}: ${message}`);
  exit(1);
}

/** Bricht ab, wenn das AWS-Profil nicht auf das prod-Konto zeigt. */
export function checkAccount(script: string): void {
  const res = spawnSync(
    'aws',
    ['sts', 'get-caller-identity', '--query', 'Account', '--output', 'text'],
    { encoding: 'utf8' },
  );
  const account = `${res.stdout ?? ''}`.trim();
  if (account !== config.account)
    fail(
      script,
      `Falsches AWS-Konto (${account || 'keine Anmeldung'}), erwartet ${config.account}. Admin-Profil setzen (AWS_PROFILE).`,
    );
}

/** `ops-cli` aufrufen; bei Lambda-Fehler oder `ok: false` Abbruch mit der Meldung. */
export function invokeOps<T>(script: string, payload: Record<string, unknown>): T {
  const dir = mkdtempSync(join(tmpdir(), 'npm-ops-'));
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
        '--cli-read-timeout',
        '90',
        '--payload',
        JSON.stringify(payload),
        out,
      ],
      { encoding: 'utf8' },
    );
    if (res.status !== 0) fail(script, `aws lambda invoke: ${`${res.stderr ?? ''}`.trim()}`);
    const meta = JSON.parse(res.stdout || '{}') as { FunctionError?: string };
    const body = JSON.parse(readFileSync(out, 'utf8')) as {
      ok?: boolean;
      output?: unknown;
      errorMessage?: string;
    };
    if (meta.FunctionError)
      fail(script, `Lambda-Fehler: ${body.errorMessage ?? meta.FunctionError}`);
    if (!body.ok) fail(script, `ops-cli meldet: ${JSON.stringify(body.output ?? body)}`);
    return body.output as T;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Ablage `docs/test-runs/<YYYY-MM-DD>/demo-evaluation/` (lokales Datum). */
export function demoRunDir(repoRoot: string, now = new Date()): string {
  const day = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `${repoRoot}docs/test-runs/${day}/demo-evaluation`;
}
