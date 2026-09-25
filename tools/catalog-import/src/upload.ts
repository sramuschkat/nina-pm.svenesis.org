/**
 * `pnpm catalog:upload [--source <img-Ordner>] [--dry-run]` (AP-20, H-11): kopiert die Katalogbilder
 * der Website (`img/dso/`, `img/ngc/`, `img/ngc-l/`) **unverändert** nach S3 `catalog/img/…` im
 * Web-Bucket, benannt nach der normalisierten `primary_id` (`images.ts`, dso-import.md §2).
 * Der Website-Ordner wird nur gelesen; kopiert wird über ein temporäres Verzeichnis, `aws s3 sync`
 * ohne `--delete`. **Nur Sven**, Admin-Profil; Protokoll unter `docs/test-runs/<Datum>/ap-20/`.
 */
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '@nina-pm/infra/config';
import { OUTPUT_JSON } from './files';
import { planImages, type ImageRow } from './images';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dryRun = args.includes('--dry-run');
const source = flag('--source') ?? join(repoRoot, '..', 'www.svenesis.org', 'astro-tools', 'img');

for (const dir of ['dso', 'ngc', 'ngc-l'])
  if (!existsSync(join(source, dir))) {
    console.error(`Bildordner fehlt: ${join(source, dir)} (--source <Website>/astro-tools/img)`);
    process.exit(2);
  }

const catalog = JSON.parse(readFileSync(OUTPUT_JSON, 'utf8')) as {
  version: string;
  rows: ImageRow[];
};
const plan = planImages(catalog.rows, {
  dso: readdirSync(join(source, 'dso')),
  ngc: readdirSync(join(source, 'ngc')),
  ngcL: readdirSync(join(source, 'ngc-l')),
});
console.log(
  `Katalog ${catalog.version}: ${String(catalog.rows.length)} Zeilen – 128 px: ${String(plan.small)}, 320 px: ${String(plan.large)}, ohne Bild: ${String(plan.missingSmall.length)}`,
);
if (dryRun) process.exit(0);

const run = (cmd: string, cmdArgs: string[]) =>
  spawnSync(cmd, cmdArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });

const who = run('aws', ['sts', 'get-caller-identity', '--output', 'json']);
const account = who.status === 0 ? (JSON.parse(who.stdout) as { Account: string }).Account : null;
if (account !== config.account) {
  console.error(
    `AWS-Profil gehört nicht zum Konto ${config.account} (gefunden: ${account ?? '–'}).`,
  );
  process.exit(2);
}

const staging = mkdtempSync(join(tmpdir(), 'nina-pm-catalog-img-'));
try {
  for (const [target, from] of plan.copies) {
    const to = join(staging, target);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(source, from), to);
  }
  const target = `s3://${config.buckets.web}/catalog/img/`;
  console.log(`aws s3 sync → ${target} (${String(plan.copies.size)} Dateien, ohne --delete)`);
  const sync = spawnSync(
    'aws',
    [
      's3',
      'sync',
      staging,
      target,
      '--size-only',
      '--content-type',
      'image/jpeg',
      '--cache-control',
      'public, max-age=2592000',
      '--region',
      config.region,
      '--only-show-errors',
    ],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  const commit = run('git', ['rev-parse', '--short', 'HEAD']).stdout.trim();
  const now = new Date();
  const day = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const dir = join(repoRoot, 'docs', 'test-runs', day, 'ap-20');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'catalog-upload.md'),
    [
      '# Katalogbilder hochgeladen (AP-20, H-11)',
      '',
      `Lauf ${now.toISOString()}, Commit ${commit}, Katalog ${catalog.version}.`,
      '',
      `- Quelle (nur gelesen): \`${source.replace(repoRoot, '')}\``,
      `- Ziel: \`${target}\` (\`ngc/\` 128 px, \`ngc-l/\` 320 px, Name aus der normalisierten \`primary_id\`)`,
      `- Zeilen: ${String(catalog.rows.length)} · 128 px: ${String(plan.small)} · 320 px: ${String(plan.large)} · Dateien: ${String(plan.copies.size)}`,
      `- Ohne Bild (erzeugt AP-25): ${plan.missingSmall.length === 0 ? 'keine' : plan.missingSmall.join(', ')}`,
      `- \`aws s3 sync\`: ${sync.status === 0 ? 'erfolgreich' : `Fehler (Exit ${String(sync.status)})`}`,
      '',
    ].join('\n'),
  );
  console.log(`Protokoll: docs/test-runs/${day}/ap-20/catalog-upload.md`);
  if (sync.status !== 0) process.exit(1);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
