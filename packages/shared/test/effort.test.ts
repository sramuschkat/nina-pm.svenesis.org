/**
 * Aufwand-Kennzeichen eines Projekts (AP-13e, effort.md, FK 8.9): gleicher Weg für Server-Job und
 * Browser-Worker – Zeitraum ab `currentNight`, Entwürfe und Einreichungen mit Wunsch-Rig, „fertig“ mit
 * Hash, Exoplanet → `transit`, Schema; Einfügeposition nach Stimmen (FA-FRG-16).
 */
import { daysFromKey, keyFromDays } from '@nina-pm/engine';
import { describe, expect, it } from 'vitest';
import { EffortView, projectEffort, projectEffortInput, suggestPriorityPosition } from '../src';
import { moonProfiles, NGC281, nights, projects, rig, STARFRONT } from './fixtures/plan';

const table = (from: string, count: number) => ({
  ...nights,
  currentNight: from,
  timeZoneTransitions: [
    ...nights.timeZoneTransitions,
    { atUtc: '2027-03-14T08:00:00Z', utcOffsetMinutes: -300 },
  ],
  nights: Array.from({ length: count }, (_, i) => {
    const night = keyFromDays(daysFromKey(from) + i);
    return {
      night,
      noonStartUtc: `${night}T17:00:00Z`,
      noonEndUtc: `${keyFromDays(daysFromKey(night) + 1)}T17:00:00Z`,
      nightWindowEndUtc: `${keyFromDays(daysFromKey(night) + 1)}T13:00:00Z`,
    };
  }),
});

const ngc281 = projects.find((p) => p.id === NGC281);
if (!ngc281) throw new Error('Fixture NGC281 fehlt');
const opts = (over: Partial<Parameters<typeof projectEffort>[3]> = {}) => ({
  site: STARFRONT,
  nights: table('2026-09-17', 210),
  stride: 3,
  computedAt: '2026-09-17T18:00:00Z',
  ...over,
});

describe('projectEffort', () => {
  it('NGC 281 (17 Ha offen) → eine Nacht; Zeitraum ab currentNight; gültige EffortView', () => {
    const r = projectEffort(ngc281, rig, moonProfiles, opts());
    expect(EffortView.safeParse(r?.view).error?.issues ?? []).toEqual([]);
    expect(r?.view.tag).toBe('single_night');
    expect(r?.view.fromNight).toBe('2026-09-17');
    expect(r?.view.stride).toBe(3);
    expect(r?.inputHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('Entwurf mit Wunsch-Rig wird ebenfalls geschätzt (selection given)', () => {
    const draft = { ...ngc281, approvalStatus: 'draft' as const, status: null };
    expect(projectEffort(draft, rig, moonProfiles, opts())?.view.tag).toBe('single_night');
  });

  it('Planungsbedarf 0 → tag null („fertig“) mit Hash, keine Engine-Läufe', () => {
    const done = {
      ...ngc281,
      panels: ngc281.panels.map((p) => ({
        ...p,
        lines: p.lines.map((l) => ({
          ...l,
          counters: { ...l.counters, accepted: l.plannedCount },
        })),
      })),
    };
    const r = projectEffort(done, rig, moonProfiles, opts());
    expect(r?.view.tag).toBeNull();
    expect(r?.planRuns).toBe(0);
    expect(r?.inputHash).toMatch(/^sha256:/);
  });

  it('ohne Koordinaten → null', () => {
    expect(projectEffort({ ...ngc281, raDeg: null }, rig, moonProfiles, opts())).toBeNull();
  });

  it('Exoplanet → transit, ohne festgelegtes Fenster offen', () => {
    const r = projectEffort({ ...ngc281, projectType: 'exoplanet' }, rig, moonProfiles, opts());
    expect([r?.view.tag, r?.view.fullyObservable, r?.view.coveragePct]).toEqual([
      'transit',
      null,
      null,
    ]);
  });

  it('Wunschzeitraum wird auf currentNight gekürzt; stride geht in den Hash ein', () => {
    const wish = { ...ngc281, requestPeriodFrom: '2026-09-01', requestPeriodTo: '2026-10-15' };
    const input = projectEffortInput(wish, rig, moonProfiles, opts());
    expect([input?.fromNight, input?.toNight]).toEqual(['2026-09-17', '2026-10-15']);
    const a = projectEffort(wish, rig, moonProfiles, opts());
    const b = projectEffort(wish, rig, moonProfiles, opts({ stride: 5 }));
    expect(a?.inputHash).not.toBe(b?.inputHash);
  });

  it('Leistung je Projekt ≤ 5 s (Server, stride 3, inklusive Saisonsuche)', () => {
    const t = performance.now();
    projectEffort(
      {
        ...ngc281,
        panels: ngc281.panels.map((p) => ({
          ...p,
          lines: p.lines.map((l) => ({ ...l, plannedCount: 600 })),
        })),
      },
      rig,
      moonProfiles,
      opts(),
    );
    expect(performance.now() - t).toBeLessThan(5000);
  });
});

describe('suggestPriorityPosition (FA-FRG-16)', () => {
  const peers = [
    { projectId: 'a', votes: 5 },
    { projectId: 'b', votes: 3 },
    { projectId: 'c', votes: 3 },
    { projectId: 'd', votes: 0 },
  ];
  it.each([
    [6, 1],
    [5, 2],
    [4, 2],
    [3, 4],
    [1, 4],
    [0, 5],
  ])('%s Stimmen → Position %s', (votes, position) => {
    expect(suggestPriorityPosition(votes, peers)).toBe(position);
  });
  it('leeres Rig → Position 1', () => {
    expect(suggestPriorityPosition(0, [])).toBe(1);
  });
});
