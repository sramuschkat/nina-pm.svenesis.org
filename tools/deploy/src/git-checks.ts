/**
 * Git-Vorbedingungen von `pnpm deploy:prod` (TK 18): nur den aktuellen `origin/main` deployen.
 * `git` kommt als Funktion herein (testbar ohne Repo).
 */
import type { Cmd } from './ci-gate';

const SHA = /^[0-9a-f]{40}$/;

/**
 * `git fetch origin main` muss gelingen – sonst wäre `origin/main` veraltet, HEAD könnte einem alten
 * `origin/main` gleichen, und der alte Stand würde ausgeliefert. Dann HEAD === `origin/main`.
 * Gibt den Commit zurück, wirft mit Begründung.
 */
export function checkHeadIsFreshOriginMain(git: Cmd): string {
  if (!git(['fetch', '--quiet', 'origin', 'main']).ok)
    throw new Error(
      '`git fetch origin main` ist gescheitert (Netz, Anmeldung?) – ohne aktuellen origin/main wird nicht deployt.',
    );
  const head = git(['rev-parse', 'HEAD']).out;
  const remote = git(['rev-parse', '--verify', '--quiet', 'origin/main']).out;
  if (!SHA.test(head) || !SHA.test(remote))
    throw new Error('HEAD oder origin/main lässt sich nicht auflösen.');
  if (head !== remote)
    throw new Error(
      `HEAD (${head.slice(0, 7)}) ist nicht origin/main (${remote.slice(0, 7)}) – erst \`git checkout main && git pull --ff-only\`.`,
    );
  return head;
}
