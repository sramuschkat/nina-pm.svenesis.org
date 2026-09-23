/**
 * Kurzlebiger Aurora-DSQL-Cluster für `pnpm test:dsql` (TK 17, 18, H-22, E1).
 *
 * Legt einen Cluster mit Tag `purpose=ci` und ohne Löschschutz an, wartet auf ACTIVE, führt `fn` aus
 * und löscht den Cluster im `finally` – auch wenn `fn`, das Warten oder das Programm (Ctrl-C) abbricht.
 * Nur Sven führt das aus, lokal mit seinem Admin-Profil; Claude Code nie.
 */
import {
  CreateClusterCommand,
  DeleteClusterCommand,
  GetClusterCommand,
  ListClustersCommand,
  ListTagsForResourceCommand,
} from '@aws-sdk/client-dsql';

export interface DsqlClientLike {
  send(command: unknown): Promise<unknown>;
}

export interface EphemeralCluster {
  readonly identifier: string;
  readonly arn: string;
  readonly endpoint: string;
  readonly region: string;
  readonly createMs: number;
  readonly activeMs: number;
}

export interface EphemeralClusterOptions {
  readonly client: DsqlClientLike;
  readonly region: string;
  /** Zusätzliche Tags; `purpose=ci` wird immer gesetzt und lässt sich nicht überschreiben. */
  readonly tags?: Readonly<Record<string, string>>;
  readonly log?: (line: string) => void;
  /** Wartezeit bis ACTIVE, Standard 10 min. */
  readonly activeTimeoutMs?: number;
  readonly pollMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  /**
   * Registriert eine Aufräumfunktion für Abbruchsignale (SIGINT/SIGTERM) und liefert eine Funktion
   * zum Abmelden. Standard: `process.once` auf beide Signale.
   */
  readonly onInterrupt?: (cleanup: () => Promise<void>) => () => void;
}

export const CI_TAG = { purpose: 'ci' } as const;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function defaultOnInterrupt(cleanup: () => Promise<void>): () => void {
  const handler = (signal: NodeJS.Signals) => {
    console.error(`\n${signal}: lösche den kurzlebigen Cluster, bevor das Skript endet …`);
    void cleanup().finally(() => process.exit(130));
  };
  process.once('SIGINT', handler);
  process.once('SIGTERM', handler);
  return () => {
    process.off('SIGINT', handler);
    process.off('SIGTERM', handler);
  };
}

export function manualDeleteCommand(identifier: string, region: string): string {
  return `aws dsql delete-cluster --identifier ${identifier} --region ${region}`;
}

export async function withEphemeralCluster<T>(
  options: EphemeralClusterOptions,
  fn: (cluster: EphemeralCluster) => Promise<T>,
): Promise<T> {
  const {
    client,
    region,
    log = console.log,
    activeTimeoutMs = 10 * 60_000,
    pollMs = 5_000,
    sleep = defaultSleep,
    now = Date.now,
    onInterrupt = defaultOnInterrupt,
  } = options;
  const tags = { ...options.tags, ...CI_TAG };

  const t0 = now();
  const created = (await client.send(
    new CreateClusterCommand({ deletionProtectionEnabled: false, tags }),
  )) as { identifier?: string; arn?: string };
  if (!created.identifier || !created.arn) throw new Error('CreateCluster lieferte keine Kennung');
  const identifier = created.identifier;
  const createMs = now() - t0;
  log(`Cluster ${identifier} angelegt (Tags ${JSON.stringify(tags)}), warte auf ACTIVE …`);

  let deleted = false;
  const cleanup = async () => {
    if (deleted) return;
    deleted = true;
    try {
      await client.send(new DeleteClusterCommand({ identifier }));
      log(`Cluster ${identifier} wird gelöscht.`);
    } catch (error) {
      log(
        `!!! Cluster ${identifier} konnte NICHT gelöscht werden: ${String(error)}\n` +
          `!!! Bitte von Hand löschen: ${manualDeleteCommand(identifier, region)}`,
      );
      throw error;
    }
  };
  const unregister = onInterrupt(cleanup);

  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    const tActive = now();
    for (;;) {
      const state = (await client.send(new GetClusterCommand({ identifier }))) as {
        status?: string;
      };
      if (state.status === 'ACTIVE') break;
      if (state.status === 'FAILED' || state.status === 'DELETING' || state.status === 'DELETED') {
        throw new Error(`Cluster ${identifier} ist im Zustand ${state.status}`);
      }
      if (now() - tActive > activeTimeoutMs) {
        throw new Error(
          `Cluster ${identifier} nach ${activeTimeoutMs / 1000} s nicht ACTIVE (${state.status ?? '?'})`,
        );
      }
      await sleep(pollMs);
    }
    const cluster: EphemeralCluster = {
      identifier,
      arn: created.arn,
      endpoint: `${identifier}.dsql.${region}.on.aws`,
      region,
      createMs,
      activeMs: now() - tActive,
    };
    outcome = { ok: true, value: await fn(cluster) };
  } catch (error) {
    outcome = { ok: false, error };
  }

  // Aufräumen immer; ein Löschfehler ist in cleanup() bereits laut protokolliert.
  unregister();
  let cleanupFailed: { error: unknown } | undefined;
  try {
    await cleanup();
  } catch (error) {
    cleanupFailed = { error };
  }
  if (!outcome.ok) throw outcome.error; // der ursprüngliche Fehler hat Vorrang
  if (cleanupFailed) throw cleanupFailed.error;
  return outcome.value;
}

/** Findet übrig gebliebene Cluster mit `purpose=ci` (z. B. nach einem Stromausfall mitten im Lauf). */
export async function findLeftoverCiClusters(client: DsqlClientLike): Promise<string[]> {
  const leftovers: string[] = [];
  let nextToken: string | undefined;
  do {
    const page = (await client.send(new ListClustersCommand({ nextToken }))) as {
      clusters?: { identifier?: string; arn?: string }[];
      nextToken?: string;
    };
    for (const c of page.clusters ?? []) {
      if (!c.arn || !c.identifier) continue;
      const res = (await client.send(new ListTagsForResourceCommand({ resourceArn: c.arn }))) as {
        tags?: Record<string, string>;
      };
      if (res.tags?.purpose === CI_TAG.purpose) leftovers.push(c.identifier);
    }
    nextToken = page.nextToken;
  } while (nextToken);
  return leftovers;
}
