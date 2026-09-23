/**
 * `pnpm test:dsql` – Prüfungen gegen einen kurzlebigen DSQL-Cluster (TK 17, 18, H-22, E1).
 *
 * NUR Sven führt das aus, lokal mit seinem Admin-Profil; Claude Code nie, GitHub nie.
 *   ohne Option: AP-03 – Migration 0000 und alle Migrationen, danach die Suites aus
 *                @nina-pm/db/testing (Idempotenz, Rechte-Matrix, SEC-4, OCC, 3.000 Zeilen, Isolation);
 *                Protokoll nach docs/test-runs/<datum>/ap-03/ (Vorbedingung für `pnpm deploy:prod`)
 *   --spike:     AP-S1 – Prüfpunkte aus spikes/dsql; Protokoll nach docs/test-runs/<datum>/ap-s1/
 *   --skip-long: nur mit --spike, ohne den 5-Minuten-Laufzeittest
 * Der Cluster trägt purpose=ci und wird im finally gelöscht, auch bei Fehler oder Ctrl-C.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DSQLClient } from '@aws-sdk/client-dsql';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { execFileSync } from 'node:child_process';
import { openDatabase } from '@nina-pm/db';
import {
  connectDsql,
  loadMigrations,
  migrationsHash,
  prodIamGrants,
  type IamGrant,
} from '@nina-pm/db/migrate';
import { suites, type SuiteEnv } from '@nina-pm/db/testing';
import { config } from '@nina-pm/infra/config';
import {
  connectWithConnector,
  connectWithSigner,
  iamPrincipalForGrant,
  renderMarkdown,
  runSpike,
  type Protocol,
} from '@nina-pm/spike-dsql';
import {
  findLeftoverCiClusters,
  manualDeleteCommand,
  withEphemeralCluster,
} from './dsql/ephemeral-cluster';
import { writeProtocol as writeDbProtocol, type DsqlTestProtocol } from './dsql/protocol';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function writeProtocol(protocol: Protocol): string {
  const dir = `${repoRoot}docs/test-runs/${localDate()}/ap-s1`;
  mkdirSync(dir, { recursive: true });
  protocol.finishedAt = new Date().toISOString();
  // Weitere Läufe am selben Tag überschreiben nichts: protocol-2, protocol-3, …
  let name = 'protocol';
  for (let n = 2; existsSync(`${dir}/${name}.json`); n += 1) name = `protocol-${n}`;
  writeFileSync(`${dir}/${name}.json`, `${JSON.stringify(protocol, null, 2)}\n`);
  writeFileSync(`${dir}/${name}.md`, renderMarkdown(protocol));
  return `${dir}/${name}`;
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const skipLong = args.has('--skip-long');
  const region = config.region;

  const identity = await new STSClient({ region }).send(new GetCallerIdentityCommand({}));
  if (identity.Account !== config.account) {
    fail(
      `Falsches AWS-Konto (${identity.Account ?? '–'}), erwartet ${config.account}. Admin-Profil setzen (AWS_PROFILE).`,
    );
  }
  const callerArn = identity.Arn ?? fail('Aufrufer-ARN fehlt');

  const dsql = new DSQLClient({ region });
  const leftovers = await findLeftoverCiClusters(dsql);
  if (leftovers.length > 0) {
    console.warn(
      '\n! Übrig gebliebene Test-Cluster (purpose=ci) gefunden – bitte prüfen und löschen:',
    );
    for (const id of leftovers) console.warn(`  ${manualDeleteCommand(id, region)}`);
  }

  if (!args.has('--spike')) {
    await runDbSuites(dsql, region, callerArn);
    return;
  }

  const protocol: Protocol = {
    tool: 'pnpm test:dsql --spike (tools/deploy/src/test-dsql.ts, spikes/dsql)',
    startedAt: new Date().toISOString(),
    caller: callerArn,
    environment: {
      node: process.version,
      region,
      optionen: skipLong ? '--skip-long' : 'vollständig',
      messort: 'lokal auf dem Rechner von Sven (nicht aus Lambda, CC-6)',
    },
    checks: [],
    notes: [],
  };

  console.log(`\n▶ Kurzlebigen DSQL-Cluster in ${region} anlegen (Tag purpose=ci) …`);
  let exitCode = 0;
  try {
    await withEphemeralCluster(
      { client: dsql, region, tags: { project: 'nina-pm', run: 'ap-s1' } },
      async (cluster) => {
        protocol.cluster = {
          identifier: cluster.identifier,
          region: cluster.region,
          endpoint: cluster.endpoint,
          createMs: cluster.createMs,
          activeMs: cluster.activeMs,
        };
        console.log(
          `▶ Cluster ACTIVE nach ${Math.round(cluster.activeMs / 1000)} s – Prüfungen laufen${skipLong ? '' : ' (inkl. 5-Minuten-Test)'} …\n`,
        );
        await runSpike({
          connect: (user) => connectWithConnector(cluster.endpoint, user),
          connectPlain: (user) => connectWithSigner(cluster.endpoint, region, user),
          iamPrincipalArn: iamPrincipalForGrant(callerArn),
          skipLong,
          protocol,
        });
      },
    );
  } catch (error) {
    exitCode = 1;
    protocol.notes.push(
      `Lauf abgebrochen: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(`\n✗ Lauf abgebrochen: ${String(error)}`);
  } finally {
    const dir = writeProtocol(protocol);
    console.log(`\n▶ Protokoll: ${dir.replace(repoRoot, '')}.md (und .json)`);
    console.log('  Bitte committen oder an Claude Code geben (H-22).');
  }
  const off = protocol.checks
    .filter((c) => c.verdict !== 'bestätigt')
    .map((c) => `${c.id} ${c.verdict}`);
  console.log(
    off.length === 0 ? '\n✓ Alle Prüfpunkte bestätigt.' : `\n! Abweichungen: ${off.join(', ')}`,
  );
  process.exit(exitCode);
}

/** AP-03: Migrationen und Datenbank-Suites gegen den kurzlebigen Cluster. */
async function runDbSuites(dsql: DSQLClient, region: string, callerArn: string): Promise<void> {
  const migrations = loadMigrations();
  const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  const principal = iamPrincipalForGrant(callerArn);
  // Prod-Zuordnungen prüfen, dass die echten Rollen-ARNs angenommen werden; der Aufrufer bekommt beide
  // Rollen, damit die Suites sich als app_rw und app_job anmelden können.
  const iamGrants: IamGrant[] = [
    ...prodIamGrants(config.account),
    { role: 'app_rw', arn: principal },
    { role: 'app_job', arn: principal },
  ];
  const protocol: DsqlTestProtocol = {
    tool: 'pnpm test:dsql (tools/deploy/src/test-dsql.ts, @nina-pm/db/testing)',
    startedAt: new Date().toISOString(),
    migrationsHash: migrationsHash(migrations),
    commit,
    caller: callerArn,
    suites: [],
    notes: [],
  };
  console.log(
    `\n▶ Kurzlebigen DSQL-Cluster in ${region} anlegen (Tag purpose=ci) – Migrationsstand ${protocol.migrationsHash} …`,
  );
  try {
    await withEphemeralCluster(
      { client: dsql, region, tags: { project: 'nina-pm', run: 'ap-03' } },
      async (cluster) => {
        protocol.cluster = {
          identifier: cluster.identifier,
          region,
          createMs: cluster.createMs,
          activeMs: cluster.activeMs,
        };
        const admin = await connectDsql(cluster.endpoint, 'admin');
        const env: SuiteEnv = {
          mode: 'dsql',
          admin,
          migrations,
          migration0000: { mode: 'dsql', iamGrants },
          connectAs: (role) => connectDsql(cluster.endpoint, role),
          openDatabase: (role) => openDatabase({ kind: 'dsql', endpoint: cluster.endpoint, role }),
        };
        try {
          for (const suite of suites) {
            console.log(`▶ ${suite.id} ${suite.title}`);
            const t0 = Date.now();
            try {
              const summary = await suite.run(env);
              protocol.suites.push({
                id: suite.id,
                title: suite.title,
                ok: true,
                summary,
                durationMs: Date.now() - t0,
              });
              console.log(`  ✓ ${summary}`);
            } catch (error) {
              const summary = error instanceof Error ? error.message : String(error);
              protocol.suites.push({
                id: suite.id,
                title: suite.title,
                ok: false,
                summary,
                durationMs: Date.now() - t0,
              });
              console.log(`  ✗ ${summary}`);
              if (suite.id === 'D-01') break; // ohne Migrationen sind die übrigen Prüfungen sinnlos
            }
          }
        } finally {
          await admin.end();
        }
      },
    );
  } catch (error) {
    protocol.notes.push(
      `Lauf abgebrochen: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(`\n✗ Lauf abgebrochen: ${String(error)}`);
  } finally {
    protocol.finishedAt = new Date().toISOString();
    protocol.passed =
      protocol.suites.length === suites.length &&
      protocol.suites.every((x) => x.ok) &&
      protocol.notes.length === 0;
    const file = writeDbProtocol(`${repoRoot}docs/test-runs/${localDate()}/ap-03`, protocol);
    console.log(
      `\n▶ Protokoll: ${file.replace(repoRoot, '')}.md (und .json) – bitte committen (H-22).`,
    );
    console.log(protocol.passed ? '\n✓ test:dsql grün.' : '\n✗ test:dsql rot.');
    process.exit(protocol.passed ? 0 : 1);
  }
}

await main();
