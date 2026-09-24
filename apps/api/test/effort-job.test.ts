/**
 * Job `effort` (AP-13e, TK 7.4/13, effort.md, NT-08): veraltet → neu berechnet, unveränderter
 * `inputHash` → keine Schreibung, Änderung während der Rechnung → neu gerechnet, > 5 s → Abbruch;
 * Standortlauf Starfront genau einmal je Nacht nach dem lokalen Mittag.
 */
import type { EffortSaveOutcome, EnqueueInput } from '@nina-pm/db';
import { describe, expect, it } from 'vitest';
import { siteNights } from '../src/lib/night-table';
import {
  effortJobHandler,
  effortSiteTick,
  runProjectEffort,
  type EffortDeps,
  type EffortTickDeps,
} from '../src/worker/effort';
import type { JobRunnerDeps } from '../src/worker/jobs';
import { moonProfiles, NGC281, projects, rig } from '../../../packages/shared/test/fixtures/plan';
import { MemoryJobs } from './support/memory-jobs';

const TENANT = '0190c3f4-0000-7000-8000-00000000000a';
const SITE_ID = '0190c3f4-0000-7000-8000-0000000051e0';
const STARFRONT = {
  latitudeDeg: 31.5471,
  longitudeDeg: -99.3823,
  elevationM: 400,
  timeZone: 'America/Chicago',
};
const found = projects.find((p) => p.id === NGC281);
if (!found) throw new Error('Fixture NGC281 fehlt');
const project = found;

function store() {
  const state = { version: 1, hash: null as string | null, writes: 0 };
  const deps: EffortDeps = {
    load: () =>
      Promise.resolve({ project, version: state.version, rig, site: STARFRONT, moonProfiles }),
    nights: (site, now, count) => siteNights(site, now, undefined, count),
    save: (_t, _p, version, row): Promise<EffortSaveOutcome> => {
      if (version !== state.version) return Promise.resolve('changed');
      if (row.inputHash === state.hash) return Promise.resolve('unchanged');
      state.hash = row.inputHash;
      state.writes += 1;
      return Promise.resolve('saved');
    },
    candidates: () => Promise.resolve([NGC281]),
    enqueue: () => Promise.reject(new Error('nicht erwartet')),
  };
  return { state, deps };
}

describe('Projekt-Job effort', () => {
  const now = new Date('2026-09-18T18:00:00Z');

  it('veraltet → neu berechnet und gespeichert; unveränderter inputHash → keine Schreibung', async () => {
    const { state, deps } = store();
    const first = await runProjectEffort(deps, TENANT, NGC281, now);
    expect(first.outcome).toBe('saved');
    expect(first.view?.tag).toBe('single_night');
    expect(first.view?.stride).toBe(3);
    expect(first.view?.fromNight).toBe('2026-09-18');
    const again = await runProjectEffort(deps, TENANT, NGC281, now);
    expect(again.outcome).toBe('unchanged');
    expect(state.writes).toBe(1);
  });

  it('Projekt ändert sich während der Rechnung → neu laden und rechnen', async () => {
    const { state, deps } = store();
    let loads = 0;
    const racing: EffortDeps = {
      ...deps,
      load: async (t, p) => {
        loads += 1;
        const d = await deps.load(t, p);
        if (loads === 1) state.version = 2; // gleichzeitige Änderung nach dem Laden
        return d;
      },
    };
    const r = await runProjectEffort(racing, TENANT, NGC281, now);
    expect(r.outcome).toBe('saved');
    expect(loads).toBe(2);
  });

  it('Laufzeit > 5 s → Abbruch ohne Schreibung (effort_stale bleibt)', async () => {
    const { state, deps } = store();
    let t = 0;
    const r = await runProjectEffort({ ...deps, clock: () => (t += 1000) }, TENANT, NGC281, now);
    expect(r.outcome).toBe('aborted');
    expect(state.writes).toBe(0);
  });
});

describe('Standortlauf aus tick-hourly (NT-08, Starfront)', () => {
  function setup() {
    let now = new Date('2026-09-18T14:00:00Z');
    const jobs = new MemoryJobs(() => now);
    const { deps } = store();
    const enqueue = (tenantId: string, input: EnqueueInput) => jobs.enqueue(tenantId, input);
    const effort: EffortDeps = { ...deps, enqueue };
    const runner: JobRunnerDeps = {
      queue: () => Promise.resolve(jobs),
      now: () => now,
      handlers: { effort: effortJobHandler(effort) },
    };
    const tick: EffortTickDeps = {
      sites: () => Promise.resolve([{ tenantId: TENANT, siteId: SITE_ID, ...STARFRONT }]),
      runDone: (tenantId, key) =>
        Promise.resolve(
          [...jobs.rows.values()].some((j) => j.tenantId === tenantId && j.dedupeKey === key),
        ),
      enqueue,
      nights: deps.nights,
    };
    return {
      jobs,
      run: async (at: string) => {
        now = new Date(at);
        return effortSiteTick(tick, runner, now);
      },
    };
  }

  it('14:00Z vor noonStartUtc der Nacht 2026-09-18 → kein Lauf; 18:00Z → genau einer; 19:00Z → kein zweiter', async () => {
    const { jobs, run } = setup();
    expect(await run('2026-09-18T14:00:00Z')).toBe(0);
    expect(jobs.rows.size).toBe(0);
    expect(await run('2026-09-18T18:00:00Z')).toBe(1);
    expect(await run('2026-09-18T19:00:00Z')).toBe(0);
    const rows = [...jobs.rows.values()];
    const site = rows.filter((j) => j.dedupeKey === `effort:${SITE_ID}:2026-09-18`);
    expect(site.map((j) => j.status)).toEqual(['done']);
    // Der Standortlauf legt die Projekt-Jobs an; tick-5min übernimmt sie.
    expect(rows.filter((j) => j.dedupeKey === `effort:${NGC281}`).map((j) => j.status)).toEqual([
      'pending',
    ]);
  });
});
