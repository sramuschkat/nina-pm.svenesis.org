/**
 * `git pull --ff-only` für `pr:land`, robust gegen „cannot lock ref 'refs/remotes/origin/main'“: Holt ein anderer
 * Prozess gleichzeitig (z. B. die Desktop-App, ein zweites Terminal), scheitert das Aktualisieren der Remote-Referenz,
 * obwohl nichts kaputt ist (04.10.2026, #245/#250/#251 – jeweils kein Deploy). Dann kurz warten und erneut; andere
 * Fehler (nicht verfolgte Datei, nicht vorspulbar) brechen sofort ab.
 */
export interface PullResult {
  readonly status: number | null;
  readonly output: string;
}

export const LOCK_RACE = /cannot lock ref|unable to update local ref/i;

export async function pullFastForward(
  run: () => PullResult,
  wait: (ms: number) => Promise<void>,
  attempts = 3,
): Promise<boolean> {
  for (let i = 1; i <= attempts; i += 1) {
    const r = run();
    if (r.status === 0) return true;
    if (!LOCK_RACE.test(r.output) || i === attempts) return false;
    console.log(
      `git pull: Referenz gerade gesperrt (paralleler Fetch) – neuer Versuch ${String(i + 1)}/${String(attempts)}`,
    );
    await wait(2000 * i);
  }
  return false;
}
