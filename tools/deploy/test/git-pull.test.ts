import { describe, expect, it } from 'vitest';
import { pullFastForward, type PullResult } from '../src/git-pull';

const LOCK =
  "error: cannot lock ref 'refs/remotes/origin/main': is at bdaea6e but expected 0be2373\n ! 0be2373..bdaea6e  main -> origin/main  (unable to update local ref)";

function runner(results: PullResult[]) {
  let calls = 0;
  return {
    run: () => results[Math.min(calls++, results.length - 1)] as PullResult,
    calls: () => calls,
  };
}

describe('pr:land – git pull --ff-only', () => {
  it('paralleler Fetch („cannot lock ref“): erneut versuchen, dann erfolgreich', async () => {
    const r = runner([
      { status: 1, output: LOCK },
      { status: 0, output: 'Already up to date.' },
    ]);
    const waits: number[] = [];
    expect(await pullFastForward(r.run, async (ms) => void waits.push(ms))).toBe(true);
    expect(r.calls()).toBe(2);
    expect(waits).toEqual([2000]);
  });

  it('andere Fehler brechen sofort ab (nicht verfolgte Datei)', async () => {
    const r = runner([
      {
        status: 1,
        output: 'error: The following untracked working tree files would be overwritten',
      },
    ]);
    expect(await pullFastForward(r.run, async () => undefined)).toBe(false);
    expect(r.calls()).toBe(1);
  });

  it('höchstens drei Versuche', async () => {
    const r = runner([{ status: 1, output: LOCK }]);
    expect(await pullFastForward(r.run, async () => undefined)).toBe(false);
    expect(r.calls()).toBe(3);
  });
});
