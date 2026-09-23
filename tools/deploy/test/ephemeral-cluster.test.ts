import {
  CreateClusterCommand,
  DeleteClusterCommand,
  GetClusterCommand,
  ListClustersCommand,
  ListTagsForResourceCommand,
} from '@aws-sdk/client-dsql';
import { describe, expect, it, vi } from 'vitest';
import {
  findLeftoverCiClusters,
  manualDeleteCommand,
  withEphemeralCluster,
  type DsqlClientLike,
} from '../src/dsql/ephemeral-cluster';

// Gemocktes AWS SDK (AP-S1, automatisierte Abnahme): Tag purpose=ci und Löschen im finally.
function fakeClient(opts: { statuses?: string[]; deleteFails?: boolean } = {}) {
  const statuses = [...(opts.statuses ?? ['CREATING', 'ACTIVE'])];
  const sent: unknown[] = [];
  const client: DsqlClientLike = {
    send(command: unknown) {
      sent.push(command);
      if (command instanceof CreateClusterCommand) {
        return Promise.resolve({
          identifier: 'abc123',
          arn: 'arn:aws:dsql:eu-central-1:1:cluster/abc123',
          status: 'CREATING',
        });
      }
      if (command instanceof GetClusterCommand) {
        return Promise.resolve({ status: statuses.length > 1 ? statuses.shift() : statuses[0] });
      }
      if (command instanceof DeleteClusterCommand) {
        return opts.deleteFails
          ? Promise.reject(new Error('AccessDenied'))
          : Promise.resolve({ identifier: 'abc123', status: 'DELETING' });
      }
      return Promise.reject(new Error(`unerwarteter Aufruf ${String(command)}`));
    },
  };
  const of = <T>(type: new (...args: never[]) => T) =>
    sent.filter((c): c is T => c instanceof type);
  return { client, sent, of };
}

const base = {
  region: 'eu-central-1',
  sleep: () => Promise.resolve(),
  log: () => undefined,
  onInterrupt: () => () => undefined,
};

describe('withEphemeralCluster', () => {
  it('legt den Cluster mit Tag purpose=ci und ohne Löschschutz an und löscht ihn danach', async () => {
    const fake = fakeClient();
    const result = await withEphemeralCluster(
      { ...base, client: fake.client, tags: { project: 'nina-pm' } },
      (c) => Promise.resolve(c.endpoint),
    );
    expect(result).toBe('abc123.dsql.eu-central-1.on.aws');
    const [create] = fake.of(CreateClusterCommand);
    expect(create?.input).toEqual({
      deletionProtectionEnabled: false,
      tags: { project: 'nina-pm', purpose: 'ci' },
    });
    expect(fake.of(DeleteClusterCommand).map((c) => c.input)).toEqual([{ identifier: 'abc123' }]);
  });

  it('purpose=ci lässt sich nicht überschreiben', async () => {
    const fake = fakeClient();
    await withEphemeralCluster({ ...base, client: fake.client, tags: { purpose: 'prod' } }, () =>
      Promise.resolve(),
    );
    expect(fake.of(CreateClusterCommand)[0]?.input.tags).toEqual({ purpose: 'ci' });
  });

  it('löscht den Cluster im finally, wenn die Prüfungen scheitern, und gibt den Fehler weiter', async () => {
    const fake = fakeClient();
    await expect(
      withEphemeralCluster({ ...base, client: fake.client }, () =>
        Promise.reject(new Error('Prüfung kaputt')),
      ),
    ).rejects.toThrow('Prüfung kaputt');
    expect(fake.of(DeleteClusterCommand)).toHaveLength(1);
  });

  it('löscht den Cluster, wenn er nie ACTIVE wird', async () => {
    const fake = fakeClient({ statuses: ['CREATING', 'FAILED'] });
    const fn = vi.fn();
    await expect(withEphemeralCluster({ ...base, client: fake.client }, fn)).rejects.toThrow(
      'FAILED',
    );
    expect(fn).not.toHaveBeenCalled();
    expect(fake.of(DeleteClusterCommand)).toHaveLength(1);
  });

  it('löscht den Cluster nach Zeitüberschreitung beim Warten', async () => {
    const fake = fakeClient({ statuses: ['CREATING'] });
    let t = 0;
    await expect(
      withEphemeralCluster(
        { ...base, client: fake.client, now: () => (t += 60_000), activeTimeoutMs: 120_000 },
        () => Promise.resolve(),
      ),
    ).rejects.toThrow('nicht ACTIVE');
    expect(fake.of(DeleteClusterCommand)).toHaveLength(1);
  });

  it('löscht bei Abbruch (Ctrl-C) und nicht ein zweites Mal im finally', async () => {
    const fake = fakeClient();
    let interrupt: (() => Promise<void>) | undefined;
    const unregister = vi.fn();
    await withEphemeralCluster(
      {
        ...base,
        client: fake.client,
        onInterrupt: (cleanup) => ((interrupt = cleanup), unregister),
      },
      async () => {
        await interrupt?.();
      },
    );
    expect(fake.of(DeleteClusterCommand)).toHaveLength(1);
    expect(unregister).toHaveBeenCalledOnce();
  });

  it('meldet einen Löschfehler laut mit Befehl zum Löschen von Hand', async () => {
    const fake = fakeClient({ deleteFails: true });
    const lines: string[] = [];
    await expect(
      withEphemeralCluster({ ...base, client: fake.client, log: (l) => lines.push(l) }, () =>
        Promise.resolve(),
      ),
    ).rejects.toThrow('AccessDenied');
    expect(lines.join('\n')).toContain(manualDeleteCommand('abc123', 'eu-central-1'));
  });

  it('behält bei gescheiterten Prüfungen und Löschfehler den ursprünglichen Fehler', async () => {
    const fake = fakeClient({ deleteFails: true });
    await expect(
      withEphemeralCluster({ ...base, client: fake.client }, () =>
        Promise.reject(new Error('Prüfung kaputt')),
      ),
    ).rejects.toThrow('Prüfung kaputt');
  });

  it('legt nichts zum Löschen an, wenn schon CreateCluster scheitert', async () => {
    const client: DsqlClientLike = { send: vi.fn(() => Promise.reject(new Error('Quota'))) };
    await expect(
      withEphemeralCluster({ ...base, client }, () => Promise.resolve()),
    ).rejects.toThrow('Quota');
    expect(client.send).toHaveBeenCalledOnce();
  });
});

describe('findLeftoverCiClusters', () => {
  it('findet nur Cluster mit purpose=ci', async () => {
    const client: DsqlClientLike = {
      send(command: unknown) {
        if (command instanceof ListClustersCommand) {
          return Promise.resolve({
            clusters: [
              { identifier: 'prod1', arn: 'arn:prod1' },
              { identifier: 'ci1', arn: 'arn:ci1' },
            ],
          });
        }
        if (command instanceof ListTagsForResourceCommand) {
          const arn = command.input.resourceArn;
          return Promise.resolve({
            tags: arn === 'arn:ci1' ? { purpose: 'ci' } : { purpose: 'prod' },
          });
        }
        return Promise.reject(new Error('unerwartet'));
      },
    };
    expect(await findLeftoverCiClusters(client)).toEqual(['ci1']);
  });
});
