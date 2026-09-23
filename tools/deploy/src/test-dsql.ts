/**
 * `pnpm test:dsql --spike` – DSQL-Spike AP-S1 gegen einen kurzlebigen Cluster (TK 17, 18, H-22, E1).
 *
 * NUR Sven führt das aus, lokal mit seinem Admin-Profil; Claude Code nie, GitHub nie.
 * Ablauf: Konto prüfen → Cluster mit Tag purpose=ci anlegen → Prüfungen aus spikes/dsql →
 * Cluster im finally löschen → Protokoll nach docs/test-runs/<datum>/ap-s1/.
 * Ohne `--spike` folgt hier mit AP-03 der Lauf „Migrationen inkl. 0000 + Repository-/OCC-Tests“.
 *
 * Optionen: --spike (Pflicht bis AP-03) · --skip-long (ohne den 5-Minuten-Laufzeittest)
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DSQLClient } from '@aws-sdk/client-dsql';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
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
  if (!args.has('--spike')) {
    fail('Bis AP-03 gibt es nur den Spike: pnpm test:dsql --spike [--skip-long]');
  }
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

await main();
