/**
 * FA-MAN-03 (TK 12): Mandanten-Dateien löschen entfernt im versionierten Daten-Bucket jede Version und jeden
 * Löschmarker unter `tenant/<id>/`, seitenweise; andere Mandanten und fremde Präfixe bleiben; Teilfehler → Fehler.
 */
import type { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { s3TenantFileStore } from '../src/files/tenant-files';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

interface Entry {
  Key: string;
  VersionId: string;
  marker?: boolean;
}

/** S3-Nachbau: Versionen und Löschmarker, `ListObjectVersions` seitenweise (je `pageSize`), `DeleteObjects`. */
function fakeS3(entries: Entry[], pageSize = 3, failOn?: string) {
  let store = [...entries];
  const calls: string[] = [];
  const send = (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
    const name = cmd.constructor.name;
    calls.push(name);
    if (name === 'ListObjectVersionsCommand') {
      const prefix = cmd.input.Prefix as string;
      const all = store
        .filter((e) => e.Key.startsWith(prefix))
        .sort((a, b) => (a.Key + a.VersionId).localeCompare(b.Key + b.VersionId));
      const after = cmd.input.KeyMarker
        ? all.findIndex(
            (e) => e.Key === cmd.input.KeyMarker && e.VersionId === cmd.input.VersionIdMarker,
          ) + 1
        : 0;
      const page = all.slice(after, after + pageSize);
      const last = page.at(-1);
      const more = after + pageSize < all.length;
      return Promise.resolve({
        Versions: page.filter((e) => !e.marker).map(({ Key, VersionId }) => ({ Key, VersionId })),
        DeleteMarkers: page
          .filter((e) => e.marker)
          .map(({ Key, VersionId }) => ({ Key, VersionId })),
        IsTruncated: more,
        NextKeyMarker: more ? last?.Key : undefined,
        NextVersionIdMarker: more ? last?.VersionId : undefined,
      });
    }
    if (name === 'DeleteObjectsCommand') {
      const objects = (cmd.input.Delete as { Objects: { Key: string; VersionId: string }[] })
        .Objects;
      if (failOn && objects.some((o) => o.Key === failOn))
        return Promise.resolve({ Errors: [{ Key: failOn, Code: 'AccessDenied' }] });
      // Wie S3: Einträge der gerade gelesenen Seite verschwinden; Marker bleiben stabil.
      store = store.filter(
        (e) => !objects.some((o) => o.Key === e.Key && o.VersionId === e.VersionId),
      );
      return Promise.resolve({});
    }
    throw new Error(`unerwartet: ${name}`);
  };
  return { client: { send } as unknown as S3Client, store: () => store, calls };
}

describe('Mandanten-Dateien löschen (versionierter Bucket)', () => {
  it('jede Version und jeder Löschmarker des Mandanten, seitenweise; Rest bleibt', async () => {
    const s3 = fakeS3([
      { Key: `tenant/${A}/imports/x.json`, VersionId: 'v1' },
      { Key: `tenant/${A}/imports/x.json`, VersionId: 'v2' },
      { Key: `tenant/${A}/imports/x.json`, VersionId: 'm1', marker: true },
      { Key: `tenant/${A}/jobs/j.json`, VersionId: 'v1' },
      { Key: `tenant/${A}/plans/p.json.gz`, VersionId: 'v1' },
      { Key: `tenant/${A}/plans/p.json.gz`, VersionId: 'm1', marker: true },
      { Key: `tenant/${A}/results/r/a.csv`, VersionId: 'v1' },
      { Key: `tenant/${B}/jobs/k.json`, VersionId: 'v1' },
      { Key: 'catalog/thumbs/m31.jpg', VersionId: 'v1' },
    ]);
    const deleted = await s3TenantFileStore(s3.client, 'bucket').deleteTenantFiles(A);
    expect(deleted).toBe(7);
    expect(s3.store().map((e) => e.Key)).toEqual([
      `tenant/${B}/jobs/k.json`,
      'catalog/thumbs/m31.jpg',
    ]);
    expect(s3.calls.filter((c) => c === 'ListObjectVersionsCommand').length).toBeGreaterThan(1);
  });

  it('Teilfehler von S3 bricht ab; keine UUID → Fehler', async () => {
    const s3 = fakeS3(
      [{ Key: `tenant/${A}/jobs/j.json`, VersionId: 'v1' }],
      3,
      `tenant/${A}/jobs/j.json`,
    );
    await expect(s3TenantFileStore(s3.client, 'bucket').deleteTenantFiles(A)).rejects.toThrow(
      /unvollständig/,
    );
    await expect(s3TenantFileStore(s3.client, 'bucket').deleteTenantFiles('../x')).rejects.toThrow(
      /UUID/,
    );
  });
});
