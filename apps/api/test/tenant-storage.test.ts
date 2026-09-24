/** AP-07d (FA-SU-03): Speicherbedarf je Mandant – S3-Summe, täglicher Lauf, Anzeige in der Mandantenliste. */
import { recordTenantStorage, tenantIdsForStorage } from '@nina-pm/db';
import { COOKIE_NAMES } from '@nina-pm/shared';
import type { S3Client } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { s3TenantUsageReader } from '../src/files/tenant-files';
import { measureTenantStorage, tickTasks } from '../src/worker/tasks';
import { createStack, type Stack } from './support/stack';

const A = '00000000-0000-4000-8000-00000000000a';

/** S3-Fälschung: Objekte je Schlüssel, Seiten zu je `pageSize`, filtert nach `Prefix` wie S3. */
function fakeS3(objects: Record<string, number>, pageSize = 2) {
  const prefixes: string[] = [];
  const send = (cmd: { input: { Prefix: string; ContinuationToken?: string } }) => {
    prefixes.push(cmd.input.Prefix);
    const keys = Object.keys(objects)
      .filter((k) => k.startsWith(cmd.input.Prefix))
      .sort();
    const start = Number(cmd.input.ContinuationToken ?? 0);
    const page = keys.slice(start, start + pageSize);
    const more = start + pageSize < keys.length;
    return Promise.resolve({
      Contents: page.map((Key) => ({ Key, Size: objects[Key] })),
      IsTruncated: more,
      NextContinuationToken: more ? String(start + pageSize) : undefined,
    });
  };
  return { client: { send } as unknown as S3Client, prefixes };
}

describe('Summe der Dateien je Mandant (S3)', () => {
  it('über mehrere Seiten; fremde Präfixe zählen nicht; ohne Dateien → 0', async () => {
    const { client, prefixes } = fakeS3({
      [`tenant/${A}/results/1/a.csv`]: 1000,
      [`tenant/${A}/results/1/b.csv`]: 2500,
      [`tenant/${A}/imports/x.json`]: 500,
      [`tenant/${A}/plans/p.json.gz`]: 10,
      'tenant/00000000-0000-4000-8000-00000000000b/results/z.csv': 99_999,
      'catalog/thumbs/m31.jpg': 77_777,
    });
    const reader = s3TenantUsageReader(client, 'bucket');
    expect(await reader.usage(A)).toEqual({ bytes: 4010, count: 4 });
    expect(new Set(prefixes)).toEqual(new Set([`tenant/${A}/`]));
    expect(await reader.usage('00000000-0000-4000-8000-00000000000c')).toEqual({
      bytes: 0,
      count: 0,
    });
    await expect(reader.usage('../x')).rejects.toThrow(/UUID/);
  });
});

describe('täglicher Lauf und Anzeige', () => {
  let s: Stack;
  beforeAll(async () => {
    s = await createStack();
  });
  beforeEach(() => s.reset());
  afterAll(() => s.close());

  it('misst alle Mandanten, ein Fehler bricht die übrigen nicht ab; Liste zeigt Wert und Stand', async () => {
    const a = await s.seed.tenant('alpha');
    const b = await s.seed.tenant('beta', 'locked');
    const failed: string[] = [];
    const measured = await measureTenantStorage({
      tenantIds: () => tenantIdsForStorage(s.pg.db),
      usage: (id) =>
        id === b
          ? Promise.reject(new Error('S3 nicht erreichbar'))
          : Promise.resolve({ bytes: 12_400_000, count: 7 }),
      record: (id, usage) =>
        recordTenantStorage(s.pg.db, id, usage, new Date('2026-09-25T03:00:00Z')),
      onError: (id) => failed.push(id),
    });
    expect(measured).toBe(1);
    expect(failed).toEqual([b]);
    // Zweiter Lauf überschreibt (eine Zeile je Mandant).
    await recordTenantStorage(
      s.pg.db,
      a,
      { bytes: 13_000_000, count: 8 },
      new Date('2026-09-26T03:00:00Z'),
    );

    const identity = await s.seed.identity({ mfaEnabled: true });
    await s.seed.superUser(identity.id);
    const cookies = { [COOKIE_NAMES.session]: await s.seed.session(identity.id, null, 'system') };
    const { tenants } = (await (await s.request('/api/system/v1/tenants', { cookies })).json()) as {
      tenants: Record<string, unknown>[];
    };
    expect(tenants.find((t) => t.id === a)).toMatchObject({
      storageBytes: 13_000_000,
      storageFileCount: 8,
      storageMeasuredAt: '2026-09-26T03:00:00Z',
    });
    expect(tenants.find((t) => t.id === b)).toMatchObject({
      storageBytes: null,
      storageMeasuredAt: null,
    });
  });

  it('der Zeitplan daily enthält die Messung', () => {
    const tasks = tickTasks(
      { queue: () => Promise.reject(new Error('unbenutzt')) },
      { cleanupInvitations: () => Promise.resolve(0), measureStorage: () => Promise.resolve(0) },
    );
    expect(tasks.daily.map((t) => t.name)).toEqual(['invitation_cleanup', 'tenant_storage']);
  });
});
