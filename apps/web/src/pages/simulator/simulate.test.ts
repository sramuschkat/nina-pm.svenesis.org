/**
 * Simulator-Rechnung (AP-13f): Worker-Ergebnis = Node-Ergebnis (Hash, FA-SIM-05), Protokoll je Eintrag,
 * Zielkarten, nicht zugeteilte Projekte, Entwürfe nur mit `selection: 'given'`.
 */
import { planNight, type PlanInput } from '@nina-pm/engine';
import { buildPlanInput } from '@nina-pm/shared';
import { describe, expect, it } from 'vitest';
import {
  DRAFT,
  moonProfiles,
  NGC281,
  NGC7000,
  nights,
  projects,
  rig,
  STARFRONT,
} from '../../../../../packages/shared/test/fixtures/plan';
import { simulate, type SimulationRequest } from './simulate';

const request = (over: Partial<SimulationRequest> = {}): SimulationRequest => ({
  rig,
  projects,
  moonProfiles,
  nights,
  night: '2026-09-17',
  site: { ...STARFRONT, timeZone: 'America/Chicago' },
  selection: 'plannable',
  filterColors: { Ha: '#d32f2f', OIII: '#00e5ff', L: '#ffffff' },
  moonProfileNames: {},
  ...over,
});

describe('simulate', () => {
  it('liefert denselben Plan wie planNight(buildPlanInput(…)) in Node (Hash)', () => {
    const r = simulate(request());
    const node = planNight(
      buildPlanInput(rig, projects, moonProfiles, nights, {
        night: '2026-09-17',
        site: STARFRONT,
      }) as PlanInput,
    );
    expect(r.plan.outputHash).toBe(node.outputHash);
    expect(r.plan.inputHash).toBe(node.inputHash);
  });

  it('Protokoll je Eintrag mit Höhe, Mondabstand, Dunkelheit; Blöcke und Filterbalken im Diagramm', () => {
    const r = simulate(request());
    const entries = r.plan.blocks.reduce((n, b) => n + b.entries.length, 0);
    expect(r.protocol).toHaveLength(entries);
    const expose = r.protocol.find((x) => x.cmd === 'expose');
    expect(expose?.no).toBe(1);
    expect(expose?.altDeg).toBeGreaterThan(20);
    expect(expose?.dark).toBe(true);
    expect(r.chart.blocks).toHaveLength(r.plan.blocks.length);
    expect(r.chart.filterBars?.length).toBeGreaterThan(0);
    expect(r.header.targets).toBe(r.plan.summary.targets);
  });

  it('Zielkarten für zugeteilte Projekte, sonst „nicht zugeteilt“ mit Gründen; Entwürfe nur mit given', () => {
    const r = simulate(request());
    const ids = [...r.cards.map((c) => c.projectId), ...r.unallocated.map((u) => u.projectId)];
    expect(ids.sort()).toEqual([NGC281, NGC7000].sort());
    const card = r.cards[0];
    expect(card?.checks.darkness).toBe('ok');
    expect(card?.allocatedS).toBeGreaterThan(0);
    expect(ids).not.toContain(DRAFT);
    // Entwurf ohne Panel kann nicht geplant werden und fehlt auch mit `given`.
    const given = simulate(request({ selection: 'given' }));
    expect(given.cards.map((c) => c.projectId)).not.toContain(DRAFT);
  });
});
