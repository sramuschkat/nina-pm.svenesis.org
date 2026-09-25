/**
 * `pnpm deploy:prod` – lokaler prod-Deploy (TK 18, H-06, E1).
 *
 * NUR Sven führt dieses Skript aus, lokal mit seinem Admin-Profil. Claude Code führt es nie aus,
 * und GitHub hat keinen AWS-Zugang. Ablauf im Grundzug (AP-02a):
 *   Vorbedingungen → cdk diff → Bestätigung → cdk deploy --all → Hinweise → Smoke-Test.
 * AP-14c: mit `TEST_RIG_TOKEN` (H-24) Smoke-Schritt DB-Erreichbarkeit und Fake-Plugin-Nacht im Test-Mandanten.
 * AP-02b: Vorprüfung /nina-pm/origin-verify, Smoke mit /api/health und Direktaufruf der execute-api-Adresse.
 * AP-03: bei neuen Migrationen test:dsql grün für den Stand (H-22) und On-Demand-Backup vor dem Deploy.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { config } from '@nina-pm/infra/config';
import { printReport, runFakeNight } from '@nina-pm/fake-plugin';
import { runSmoke } from '@nina-pm/smoke';
import { loadMigrations, migrationsHash } from '@nina-pm/db/migrate';
import { findGreenProtocol } from './dsql/protocol';

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

function runEnv(cmd: string, args: string[], env: Record<string, string>): void {
  const res = spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
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

/** Neue Migrationen seit dem zuletzt deployten Commit (`/nina-pm/web/build-id`)? Unbekannt zählt als neu. */
function detectNewMigrations(): boolean {
  const last = capture('aws', [
    'ssm',
    'get-parameter',
    '--name',
    config.ssm.webBuildId,
    '--region',
    config.region,
    '--query',
    'Parameter.Value',
    '--output',
    'text',
  ]).out;
  if (!/^[0-9a-f]{40}$/.test(last) || !capture('git', ['cat-file', '-e', `${last}^{commit}`]).ok)
    return true;
  const paths = ['packages/db/migrations', 'packages/db/src/migrate/migration-0000.ts'];
  return capture('git', ['diff', '--name-only', last, 'HEAD', '--', ...paths]).out !== '';
}

/** On-Demand-Backup des DSQL-Clusters in den Standard-Vault und warten bis COMPLETED (TK 18, iam.md §11). */
async function backupBeforeMigrations(): Promise<void> {
  step('On-Demand-Backup vor Migrationen');
  const aws = (args: string[]) =>
    capture('aws', [...args, '--region', config.region, '--output', 'text']);
  const clusterArn = aws([
    'cloudformation',
    'describe-stacks',
    '--stack-name',
    'NinaPm-Data',
    '--query',
    "Stacks[0].Outputs[?OutputKey=='DsqlClusterArn'].OutputValue",
  ]).out;
  const planId = aws([
    'backup',
    'list-backup-plans',
    '--query',
    "BackupPlansList[?BackupPlanName=='nina-pm-dsql'].BackupPlanId",
  ]).out;
  const selectionId = aws([
    'backup',
    'list-backup-selections',
    '--backup-plan-id',
    planId,
    '--query',
    'BackupSelectionsList[0].SelectionId',
  ]).out;
  const roleArn = aws([
    'backup',
    'get-backup-selection',
    '--backup-plan-id',
    planId,
    '--selection-id',
    selectionId,
    '--query',
    'BackupSelection.IamRoleArn',
  ]).out;
  if (!clusterArn.startsWith('arn:') || !roleArn.startsWith('arn:'))
    fail('Cluster-ARN oder Backup-Rolle nicht gefunden.');
  const job = aws([
    'backup',
    'start-backup-job',
    '--backup-vault-name',
    config.backup.vaultName,
    '--resource-arn',
    clusterArn,
    '--iam-role-arn',
    roleArn,
    '--query',
    'BackupJobId',
  ]);
  if (!job.ok || !job.out) fail('Backup-Job ließ sich nicht starten.');
  console.log(`  Backup-Job ${job.out} gestartet, warte auf COMPLETED …`);
  for (let i = 0; i < 180; i += 1) {
    const state = aws([
      'backup',
      'describe-backup-job',
      '--backup-job-id',
      job.out,
      '--query',
      'State',
    ]).out;
    if (state === 'COMPLETED') {
      console.log('  Backup abgeschlossen.');
      return;
    }
    if (['FAILED', 'ABORTED', 'EXPIRED', 'PARTIAL'].includes(state))
      fail(`Backup-Job ${job.out} endete mit ${state}.`);
    await new Promise((resolve) => setTimeout(resolve, 20_000));
  }
  fail(`Backup-Job ${job.out} nach 60 min nicht abgeschlossen.`);
}

/** Letzter CI-Lauf (ci.yml) eines Commits: `<status> <conclusion>` oder leer. */
function ciState(sha: string): string {
  return capture('gh', [
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
  ]).out;
}

/**
 * CI-Vorbedingung (TK 18) ohne unnötiges Warten:
 * 1. grüner Lauf auf HEAD, oder
 * 2. grüner Lauf auf einem Commit mit **identischem Dateistand** (gleicher Git-Tree) – nach einem
 *    Merge-Commit eines aktuellen PR-Branches ist das der PR-Lauf; gleiche Dateien, gleiche Prüfungen, oder
 * 3. der Lauf auf HEAD läuft noch → warten (`gh run watch`), statt abzubrechen.
 */
async function ensureGreenCi(sha: string): Promise<string> {
  if (ciState(sha) === 'completed success') return 'Lauf auf diesem Commit';
  const tree = capture('git', ['rev-parse', `${sha}^{tree}`]).out;
  const recent = capture('gh', [
    'run',
    'list',
    '--workflow',
    'ci.yml',
    '--status',
    'success',
    '--limit',
    '40',
    '--json',
    'headSha',
    '--jq',
    '.[].headSha',
  ]).out.split('\n');
  for (const candidate of recent) {
    if (!candidate || candidate === sha) continue;
    const t = capture('git', ['rev-parse', `${candidate}^{tree}`]);
    if (t.ok && t.out === tree) return `gleicher Stand wie ${candidate.slice(0, 7)}`;
  }
  const state = ciState(sha);
  if (
    state.startsWith('in_progress') ||
    state.startsWith('queued') ||
    state.startsWith('waiting')
  ) {
    console.log(`  CI auf ${sha.slice(0, 7)} läuft noch – warte …`);
    const id = capture('gh', [
      'run',
      'list',
      '--commit',
      sha,
      '--workflow',
      'ci.yml',
      '--limit',
      '1',
      '--json',
      'databaseId',
      '--jq',
      '.[0].databaseId',
    ]).out;
    spawnSync('gh', ['run', 'watch', id, '--interval', '15', '--exit-status'], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    if (ciState(sha) === 'completed success') return 'Lauf auf diesem Commit, abgewartet';
  }
  return fail(`CI auf ${sha.slice(0, 7)} ist nicht grün (${ciState(sha) || 'kein Lauf'}).`);
}

async function main(): Promise<void> {
  step('Vorbedingungen');
  if (capture('git', ['status', '--porcelain']).out !== '') fail('Arbeitsbaum ist nicht sauber.');
  const sha = capture('git', ['rev-parse', 'HEAD']).out;
  const ciSource = await ensureGreenCi(sha);
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
    `  Commit ${sha.slice(0, 7)}, CI grün (${ciSource}), Konto ${account.out}, Backup-Vault und Origin-Verify vorhanden`,
  );

  // Neue Migrationen seit dem letzten Deploy? Dann gilt: test:dsql grün für genau diesen Stand (H-22),
  // und vor dem Deploy läuft ein On-Demand-Backup (TK 18, AP-03).
  const migrationsChanged = detectNewMigrations();
  if (migrationsChanged) {
    const hash = migrationsHash(loadMigrations());
    const green = findGreenProtocol(`${repoRoot}docs/test-runs`, hash);
    if (!green) {
      fail(
        `Neue Migrationen (Stand ${hash}), aber kein grünes Protokoll von \`pnpm test:dsql\` für diesen Stand (H-22).\n` +
          '  Erst `pnpm test:dsql` ausführen und das Protokoll committen.',
      );
    }
    console.log(`  Neue Migrationen; test:dsql grün laut ${green.replace(repoRoot, '')}`);
  }

  // SPA mit derselben Build-ID bauen (Chunks unter assets/<buildId>/, TK 4.1); ohne Bausteinübersicht.
  step('Web-App bauen');
  runEnv('pnpm', ['--filter', '@nina-pm/web', 'build'], { BUILD_ID: sha, VITE_GALLERY: '' });
  const context = ['-c', `buildId=${sha}`, '-c', 'requireWebDist=true'];
  step('cdk diff – bitte vollständig lesen');
  // Vorlagen-Diff statt Changesets: gleiche Änderungsliste, ohne je Stack ein Changeset anzulegen.
  run('pnpm', ['cdk', 'diff', '--method=template', ...context]);

  const rl = createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question('\nDeploy nach prod ausführen? (ja/nein) '))
    .trim()
    .toLowerCase();
  rl.close();
  if (answer !== 'ja') fail('Abgebrochen.');

  if (migrationsChanged) await backupBeforeMigrations();

  step('cdk deploy --all');
  // Unabhängige Stacks parallel; Abhängigkeiten (Data → Api → Edge …) hält CDK selbst ein.
  run('pnpm', [
    'cdk',
    'deploy',
    '--all',
    '--concurrency',
    '4',
    ...context,
    '--outputs-file',
    outputsFile,
  ]);

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
  // Sync-Token der Test-Instanz nur aus der lokalen Umgebung (H-24); nie ausgeben, nie in Dateien.
  const testRigToken = process.env.TEST_RIG_TOKEN?.trim() || undefined;
  const results = await runSmoke(`https://${config.domainName}`, fetch, {
    ...(executeApiUrl ? { executeApiUrl } : {}),
    ...(testRigToken ? { testRigToken } : {}),
  });
  for (const r of results)
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : ` – ${r.detail}`}`);
  if (results.some((r) => !r.ok)) {
    fail(
      'Smoke-Test rot. Rollback: vorherigen Tag auschecken und `pnpm deploy:prod` erneut ausführen (TK 18).',
    );
  }

  // AP-14c: Fake-Plugin-Nacht im Test-Mandanten mit TEST_RIG_TOKEN aus der lokalen Umgebung (H-24).
  if (testRigToken) {
    step('Fake-Plugin-Nacht im Test-Mandanten (TK 17)');
    const night = await runFakeNight({
      baseUrl: `https://${config.domainName}`,
      token: testRigToken,
    });
    printReport(night);
    if (!night.ok) {
      fail(
        'Fake-Plugin-Nacht rot. Rollback: vorherigen Tag auschecken und `pnpm deploy:prod` erneut ausführen (TK 18).',
      );
    }
  } else {
    console.log(
      '\n! TEST_RIG_TOKEN fehlt (H-24): DB-Erreichbarkeit und Fake-Plugin-Nacht übersprungen.',
    );
  }

  console.log('\n✓ Deploy abgeschlossen.');
}

await main();
