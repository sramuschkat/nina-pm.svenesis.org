/**
 * `pnpm deploy:prod` – lokaler prod-Deploy (TK 18, H-06, E1).
 *
 * NUR Sven führt dieses Skript aus, lokal mit seinem Admin-Profil. Claude Code führt es nie aus,
 * und GitHub hat keinen AWS-Zugang. Ablauf im Grundzug (AP-02a):
 *   Vorbedingungen → cdk diff → Bestätigung → cdk deploy --all → Hinweise → Smoke-Test.
 * Folgepakete ergänzen: On-Demand-Backup vor Migrationen (AP-03), Fake-Plugin-Nacht (AP-14c).
 * AP-02b: Vorprüfung /nina-pm/origin-verify, Smoke mit /api/health und Direktaufruf der execute-api-Adresse.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { config } from '@nina-pm/infra/config';
import { runSmoke } from '@nina-pm/smoke';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const outputsFile = `${repoRoot}infra/cdk-outputs.json`;

function capture(cmd: string, args: string[]): { ok: boolean; out: string } {
  const res = spawnSync(cmd, args, { cwd: repoRoot, encoding: 'utf8' });
  return { ok: res.status === 0, out: `${res.stdout ?? ''}`.trim() };
}

function run(cmd: string, args: string[]): void {
  const res = spawnSync(cmd, args, { cwd: repoRoot, stdio: 'inherit' });
  if (res.status !== 0)
    fail(`${cmd} ${args.join(' ')} ist fehlgeschlagen (Exit ${res.status ?? '–'}).`);
}

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function step(title: string): void {
  console.log(`\n▶ ${title}`);
}

async function main(): Promise<void> {
  step('Vorbedingungen');
  if (capture('git', ['status', '--porcelain']).out !== '') fail('Arbeitsbaum ist nicht sauber.');
  const sha = capture('git', ['rev-parse', 'HEAD']).out;
  const ci = capture('gh', [
    'run',
    'list',
    '--commit',
    sha,
    '--workflow',
    'ci.yml',
    '--limit',
    '1',
    '--json',
    'status,conclusion',
    '--jq',
    '.[0].status + " " + .[0].conclusion',
  ]);
  if (ci.out !== 'completed success')
    fail(`CI auf ${sha.slice(0, 7)} ist nicht grün (${ci.out || 'kein Lauf'}).`);
  const account = capture('aws', [
    'sts',
    'get-caller-identity',
    '--query',
    'Account',
    '--output',
    'text',
  ]);
  if (account.out !== config.account) {
    fail(
      `Falsches AWS-Konto (${account.out || 'keine Anmeldung'}), erwartet ${config.account}. Admin-Profil setzen (AWS_PROFILE).`,
    );
  }
  const vault = capture('aws', [
    'backup',
    'describe-backup-vault',
    '--backup-vault-name',
    config.backup.vaultName,
    '--region',
    config.region,
    '--query',
    'BackupVaultName',
    '--output',
    'text',
  ]);
  if (vault.out !== config.backup.vaultName) {
    fail(
      `AWS-Backup-Vault "${config.backup.vaultName}" fehlt in ${config.region}. Einmalig anlegen (H-04):\n` +
        `  aws backup create-backup-vault --backup-vault-name ${config.backup.vaultName} --region ${config.region}`,
    );
  }
  // CloudFront bekommt /nina-pm/origin-verify beim Deploy als Origin-Header (SV-16); fehlt er, bricht CloudFormation ab.
  const originVerify = capture('aws', [
    'ssm',
    'get-parameter',
    '--name',
    config.ssm.originVerify,
    '--region',
    config.region,
    '--query',
    'Parameter.Type',
    '--output',
    'text',
  ]);
  if (originVerify.out !== 'String') {
    fail(
      `SSM-Parameter ${config.ssm.originVerify} fehlt (H-05). Anlegen, der Wert kommt nie in den Chat:\n` +
        `  aws ssm put-parameter --name ${config.ssm.originVerify} --type String --region ${config.region} --value "$(openssl rand -base64 32)"`,
    );
  }
  console.log(
    `  Commit ${sha.slice(0, 7)}, CI grün, Konto ${account.out}, Backup-Vault und Origin-Verify vorhanden`,
  );

  const context = ['-c', `buildId=${sha}`];
  step('cdk diff – bitte vollständig lesen');
  run('pnpm', ['cdk', 'diff', ...context]);

  const rl = createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question('\nDeploy nach prod ausführen? (ja/nein) '))
    .trim()
    .toLowerCase();
  rl.close();
  if (answer !== 'ja') fail('Abgebrochen.');

  // AP-03: bei neuen Migrationen hier On-Demand-Backup des DSQL-Clusters starten und auf COMPLETED warten.

  step('cdk deploy --all');
  run('pnpm', ['cdk', 'deploy', '--all', ...context, '--outputs-file', outputsFile]);

  const outputs = existsSync(outputsFile)
    ? (JSON.parse(readFileSync(outputsFile, 'utf8')) as Record<string, Record<string, string>>)
    : {};
  {
    const endpoint = outputs['NinaPm-Data']?.DsqlEndpoint;
    const param = capture('aws', [
      'ssm',
      'get-parameter',
      '--name',
      config.ssm.dsqlEndpoint,
      '--query',
      'Parameter.Value',
      '--output',
      'text',
    ]);
    if (endpoint && param.out !== endpoint) {
      console.log(
        `\n! ${config.ssm.dsqlEndpoint} fehlt oder weicht ab (H-05). Anlegen bzw. aktualisieren mit:`,
      );
      console.log(
        `  aws ssm put-parameter --name ${config.ssm.dsqlEndpoint} --type String --overwrite --value ${endpoint}`,
      );
    }
  }

  step(`Smoke-Test https://${config.domainName}`);
  const executeApiUrl = outputs['NinaPm-Api']?.ApiEndpoint;
  const results = await runSmoke(
    `https://${config.domainName}`,
    fetch,
    executeApiUrl ? { executeApiUrl } : {},
  );
  for (const r of results)
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : ` – ${r.detail}`}`);
  if (results.some((r) => !r.ok)) {
    fail(
      'Smoke-Test rot. Rollback: vorherigen Tag auschecken und `pnpm deploy:prod` erneut ausführen (TK 18).',
    );
  }

  // AP-14c: Fake-Plugin-Nacht im Test-Mandanten mit TEST_RIG_TOKEN aus der lokalen Umgebung (H-24).

  console.log('\n✓ Deploy abgeschlossen.');
}

await main();
