/**
 * Kopf-Prüfung von `pnpm pr:land`: gemergt wird genau der Commit, dessen CI abgewartet wurde.
 * Kommt während des Wartens ein Push dazu, bricht `pr:land` ab, statt ungeprüften Code zu mergen.
 * `gh` kommt als Funktion herein (testbar ohne GitHub).
 */
import type { CmdResult } from './ci-gate';

export type Gh = (args: string[], inherit?: boolean) => CmdResult;

const SHA = /^[0-9a-f]{40}$/;

/** Aktueller Kopf-Commit des PR-Branches (`headRefOid`); wirft, wenn er sich nicht lesen lässt. */
export function readPrHead(gh: Gh, pr: string): string {
  const res = gh(['pr', 'view', pr, '--json', 'headRefOid', '--jq', '.headRefOid']);
  if (!res.ok || !SHA.test(res.out))
    throw new Error(`#${pr}: Kopf-Commit (headRefOid) lässt sich nicht lesen.`);
  return res.out;
}

/**
 * Mergt `pr` nur, wenn sein Kopf noch `expectedHead` ist: erst selbst prüfen (klare Meldung), dann
 * `--match-head-commit`, damit GitHub einen Push zwischen Prüfung und Merge ebenfalls abweist.
 */
export function mergeAtHead(gh: Gh, pr: string, expectedHead: string): void {
  const now = readPrHead(gh, pr);
  if (now !== expectedHead)
    throw new Error(
      `#${pr}: Kopf hat sich während des Wartens bewegt (${expectedHead.slice(0, 7)} → ${now.slice(0, 7)}) – ` +
        `nicht gemergt. Erneut pnpm pr:land ${pr}, dann wartet es auf die CI des neuen Stands.`,
    );
  const merged = gh(
    ['pr', 'merge', pr, '--merge', '--delete-branch', '--match-head-commit', expectedHead],
    true,
  );
  if (!merged.ok)
    throw new Error(
      `#${pr} ließ sich nicht mergen (bei „head branch was modified“: erneut pnpm pr:land ${pr}).`,
    );
}
