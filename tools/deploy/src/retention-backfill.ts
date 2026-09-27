/**
 * `pnpm s3:retention-backfill [--apply]` (nur Sven, Admin-Profil, H-06): kennzeichnet im Daten-Bucket alle
 * befristeten Objekte ohne Tag `npm-retention` nach (einmalig, Nachtrag zu #101). Ohne `--apply` nur ein
 * Probelauf mit Liste und Zahlen. Danach löschen die Lebenszyklusregeln abgelaufene Objekte beim nächsten
 * Lauf (S3 wertet einmal täglich aus); alte Versionen folgen nach 30 Tagen. Unbefristete Objekte
 * (`results/`, Transit-Ergebnisse) bleiben unberührt, ein vorhandenes Tag wird nie überschrieben.
 */
import { spawnSync } from 'node:child_process';
import { argv } from 'node:process';
import { config } from '@nina-pm/infra/config';
import { checkAccount, fail } from './ops-invoke';
import {
  backfillTags,
  expiredAfterTagging,
  retentionDaysFor,
  type TagSet,
} from './retention-backfill-model';

const SCRIPT = 's3:retention-backfill';
const apply = argv.includes('--apply');
const bucket = config.buckets.data;

function aws<T>(args: string[]): T {
  const res = spawnSync('aws', [...args, '--region', config.region, '--output', 'json'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (res.status !== 0)
    fail(SCRIPT, `aws ${args.slice(0, 2).join(' ')}: ${`${res.stderr ?? ''}`.trim()}`);
  return (res.stdout.trim() ? JSON.parse(res.stdout) : {}) as T;
}

checkAccount(SCRIPT);
console.log(
  `${apply ? 'Ausführen' : 'Probelauf (ohne Änderungen, mit --apply ausführen)'}: s3://${bucket}/tenant/`,
);

// Aktuelle Versionen aller Objekte unter tenant/ (die CLI blättert selbst).
const listed = aws<{ Contents?: { Key: string; LastModified: string; Size: number }[] }>([
  's3api',
  'list-objects-v2',
  '--bucket',
  bucket,
  '--prefix',
  'tenant/',
]);
const objects = (listed.Contents ?? []).filter((o) => retentionDaysFor(o.Key) !== null);
const now = Date.now();
let tagged = 0;
let already = 0;
let expired = 0;
let bytes = 0;
for (const o of objects) {
  const current =
    aws<{ TagSet?: TagSet[] }>(['s3api', 'get-object-tagging', '--bucket', bucket, '--key', o.Key])
      .TagSet ?? [];
  const next = backfillTags(o.Key, current);
  if (!next) {
    already += 1;
    continue;
  }
  const isExpired = expiredAfterTagging(o.Key, Date.parse(o.LastModified), now);
  if (isExpired) {
    expired += 1;
    bytes += o.Size;
  }
  console.log(
    `${apply ? 'kennzeichnen' : 'würde kennzeichnen'} ${o.Key} → ${next[next.length - 1]?.Value ?? ''}${isExpired ? ' (abgelaufen)' : ''}`,
  );
  if (apply)
    aws([
      's3api',
      'put-object-tagging',
      '--bucket',
      bucket,
      '--key',
      o.Key,
      '--tagging',
      JSON.stringify({ TagSet: next }),
    ]);
  tagged += 1;
}
console.log(
  `\n${String(objects.length)} befristete Objekte: ${String(already)} schon gekennzeichnet, ${String(tagged)} ${apply ? 'gekennzeichnet' : 'zu kennzeichnen'}, davon ${String(expired)} schon abgelaufen (${(bytes / 1_048_576).toFixed(1)} MiB) – die löscht S3 beim nächsten Lebenszyklus-Lauf.`,
);
if (!apply && tagged > 0) console.log('Zum Ausführen: pnpm s3:retention-backfill --apply');
