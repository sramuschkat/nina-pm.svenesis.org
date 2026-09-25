/** Argumente von `pnpm deploy:prod` (TK 18). */

/**
 * Import-Modus nach einem Restore (TK 6.10, DAT5-16, Runbook `restore.md`): `-c dsqlClusterId=<id>`
 * übernimmt den wiederhergestellten Cluster. Andere `-c`-Werte sind nicht erlaubt.
 */
export function parseDeployArgs(argv: readonly string[]): { dsqlClusterId?: string } {
  const out: { dsqlClusterId?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a !== '-c') throw new Error(`Unbekanntes Argument ${String(a)}`);
    const m = /^dsqlClusterId=([a-z0-9]{10,64})$/.exec(argv[i + 1] ?? '');
    if (!m?.[1]) throw new Error('Erlaubt ist nur -c dsqlClusterId=<Cluster-ID>');
    out.dsqlClusterId = m[1];
    i += 1;
  }
  return out;
}
