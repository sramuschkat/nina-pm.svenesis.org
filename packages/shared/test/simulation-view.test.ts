/**
 * Simulator-Auswertung (AP-53): eine Rechnung für Web-Simulator und Plugin-Simulator – Protokoll je Eintrag,
 * Filterleiste mit Anzahl, Blöcke mit Projektindex (Zielfarbe), Zielkarten und nicht zugeteilte Projekte.
 */
import { planNight, type PlanInput } from '@nina-pm/engine';
import { describe, expect, it } from 'vitest';
import { buildPlanInput, simulationView } from '../src';
import { moonProfiles, nights, projects, rig, STARFRONT } from './fixtures/plan';

function view() {
  const input = buildPlanInput(rig, projects, moonProfiles, nights, {
    night: '2026-09-17',
    site: STARFRONT,
  }) as PlanInput;
  const plan = planNight(input);
  const names = new Map(projects.map((p) => [p.id, p.name]));
  return {
    input,
    plan,
    view: simulationView(input, plan, { site: STARFRONT, names, moonProfileNames: {} }),
  };
}

describe('simulationView', () => {
  it('ein Protokolleintrag je Planeintrag; Belichtungen nummeriert je Zeile', () => {
    const { plan, view: v } = view();
    expect(v.protocol).toHaveLength(plan.blocks.reduce((n, b) => n + b.entries.length, 0));
    const first = v.protocol.find((r) => r.cmd === 'expose');
    expect(first?.no).toBe(1);
    expect(first?.blockId).toBe(first?.key.split(':')[0]);
  });

  it('Filterleiste zählt jede Belichtung genau einmal; Blöcke tragen den Projektindex', () => {
    const { input, plan, view: v } = view();
    const exposures = v.protocol.filter((r) => r.cmd === 'expose').length;
    expect(v.filterBars.reduce((n, f) => n + f.count, 0)).toBe(exposures);
    expect(v.blocks).toHaveLength(plan.blocks.length);
    for (const b of v.blocks) expect(input.projects[b.projectIndex]?.id).toBe(b.projectId);
  });

  it('jedes geplante Projekt hat entweder eine Zielkarte oder steht unter „nicht zugeteilt“', () => {
    const { input, view: v } = view();
    const ids = [...v.cards.map((c) => c.projectId), ...v.unallocated.map((u) => u.projectId)];
    expect(ids.sort()).toEqual(input.projects.map((p) => p.id).sort());
    expect(v.header.targets).toBe(v.cards.length);
  });
});
