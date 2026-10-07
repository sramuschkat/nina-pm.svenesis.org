/**
 * Planrevisionen (Analyse 07.10.2026, execution.md §3.2): Inhaltsschlüssel ohne die aus `startAtUtc` folgenden Werte,
 * Wiederverwendung nur ohne Block vor jetzt, Warnung bei Abrufstürmen, Tagesschleifen-Anteil des Targets-ETags.
 */
import { describe, expect, it } from 'vitest';
import { deliveryEtagPart } from '../src/nina/sync';
import {
  PLAN_STORM_LIMIT,
  PLAN_STORM_WINDOW_MS,
  planContentKey,
  PlanRequestRate,
  reusablePlan,
} from '../src/nina/plan-revisions';

const block = (id: string, startUtc: string, endUtc: string) => ({
  id,
  kind: 'regular',
  projectId: 'p1',
  startUtc,
  endUtc,
  entries: [{ seq: 1, cmd: 'end', atUtc: endUtc }],
});
const plan = (o: { id: string; start: string | null; blocks: ReturnType<typeof block>[] }) => ({
  nightPlanId: o.id,
  inputHash: `sha256:${o.id}`,
  outputHash: `sha256:out-${o.id}`,
  startAtUtc: o.start,
  night: '2026-10-06',
  sessionEndUtc: '2026-10-07T11:00:00Z',
  blocks: o.blocks,
  summary: { targets: 1, plannedFrames: { p1: { R: 3 } } },
  diagnostics: [],
  warnings: [],
});
const stamp = { targetsEtag: '"t-1"', settingsVersion: 4 };

describe('planContentKey', () => {
  const a = plan({
    id: 'a',
    start: '2026-10-07T02:00:00Z',
    blocks: [block('b-a', '2026-10-07T03:00:00Z', '2026-10-07T04:00:00Z')],
  });

  it('gleich bei anderer nightPlanId, anderem Hash, startAtUtc und anderen Block-IDs', () => {
    const b = plan({
      id: 'b',
      start: '2026-10-07T02:05:00Z',
      blocks: [block('b-b', '2026-10-07T03:00:00Z', '2026-10-07T04:00:00Z')],
    });
    expect(planContentKey(b, stamp)).toBe(planContentKey(a, stamp));
  });

  it('verschieden bei anderer Blockzeit, anderem Soll, anderem ETag oder Einstellungsstand', () => {
    const later = plan({
      id: 'b',
      start: null,
      blocks: [block('b-b', '2026-10-07T03:05:00Z', '2026-10-07T04:00:00Z')],
    });
    expect(planContentKey(later, stamp)).not.toBe(planContentKey(a, stamp));
    expect(
      planContentKey({ ...a, summary: { targets: 1, plannedFrames: { p1: { R: 2 } } } }, stamp),
    ).not.toBe(planContentKey(a, stamp));
    expect(planContentKey(a, { ...stamp, targetsEtag: '"t-2"' })).not.toBe(
      planContentKey(a, stamp),
    );
    expect(planContentKey(a, { ...stamp, settingsVersion: 5 })).not.toBe(planContentKey(a, stamp));
  });

  it('leere Pläne derselben Nacht sind gleich', () => {
    const e1 = plan({ id: 'x', start: '2026-10-07T05:00:00Z', blocks: [] });
    const e2 = plan({ id: 'y', start: '2026-10-07T05:05:00Z', blocks: [] });
    expect(planContentKey(e1, stamp)).toBe(planContentKey(e2, stamp));
  });
});

describe('reusablePlan', () => {
  it('nur ohne Block, der vor jetzt beginnt', () => {
    const blocks = [block('b', '2026-10-07T03:00:00Z', '2026-10-07T04:00:00Z')];
    const p = plan({ id: 'a', start: null, blocks });
    expect(reusablePlan(p, new Date('2026-10-07T03:00:00Z'))).toBe(true);
    expect(reusablePlan(p, new Date('2026-10-07T03:00:01Z'))).toBe(false);
    expect(reusablePlan(plan({ id: 'a', start: null, blocks: [] }), new Date())).toBe(true);
  });
});

describe('PlanRequestRate', () => {
  it('meldet erst über der Grenze im gleitenden Fenster, je Session', () => {
    const rate = new PlanRequestRate();
    const t0 = Date.parse('2026-10-07T03:00:00Z');
    for (let i = 0; i < PLAN_STORM_LIMIT; i++)
      expect(rate.record('s1', new Date(t0 + i * 100))).toBeNull();
    expect(rate.record('s2', new Date(t0 + 2_100))).toBeNull();
    expect(rate.record('s1', new Date(t0 + 2_100))).toBe(PLAN_STORM_LIMIT + 1);
    // Nach dem Fenster wieder ruhig.
    expect(rate.record('s1', new Date(t0 + 2_100 + PLAN_STORM_WINDOW_MS + 1))).toBeNull();
  });
});

describe('deliveryEtagPart (Targets-ETag, AP-52)', () => {
  it('nur aktuelle Nacht und ob eine folgende Nacht ausliefert – nicht die Zahl je Nacht', () => {
    const one = deliveryEtagPart([
      { night: '2026-10-06', projects: 2 },
      { night: '2026-10-07', projects: 1 },
      { night: '2026-10-08', projects: 0 },
    ]);
    const more = deliveryEtagPart([
      { night: '2026-10-06', projects: 2 },
      { night: '2026-10-07', projects: 3 },
      { night: '2026-10-08', projects: 3 },
    ]);
    expect(more).toEqual(one);
    expect(
      deliveryEtagPart([
        { night: '2026-10-06', projects: 2 },
        { night: '2026-10-07', projects: 0 },
        { night: '2026-10-08', projects: 0 },
      ]),
    ).not.toEqual(one);
    expect(deliveryEtagPart([{ night: '2026-10-07', projects: 2 }])).not.toEqual(one);
  });
});
