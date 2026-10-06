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
  STRICT,
} from '../../../../../packages/shared/test/fixtures/plan';
import { cell } from './protocol';
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
        autofocusAfterTimeMin: rig.scheduler.overhead.afEveryMin,
      }) as PlanInput,
    );
    expect(r.plan.outputHash).toBe(node.outputHash);
    expect(r.plan.inputHash).toBe(node.inputHash);
  });

  it('Auslieferungsregel wie POST /plan: Projekt mit späterem Startdatum fehlt (FA-SIM-05)', () => {
    const later = projects.map((p) => (p.id === NGC281 ? { ...p, startDate: '2026-09-20' } : p));
    const seen = (r: ReturnType<typeof simulate>) =>
      [...r.cards, ...r.unallocated].some((x) => x.projectId === NGC281);
    expect(seen(simulate(request()))).toBe(true);
    expect(seen(simulate(request({ projects: later })))).toBe(false);
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
    // Filterleiste der Plangrafik mit Anzahl (AP-26e): Summe = Belichtungen im Protokoll
    const exposures = r.protocol.filter((x) => x.cmd === 'expose').length;
    const counted = (r.chart.filterBars ?? []).reduce((n, f) => n + (f.count ?? 0), 0);
    if (r.protocol.every((x) => x.cmd !== 'expose_series')) expect(counted).toBe(exposures);
    expect(r.header.targets).toBe(r.plan.summary.targets);
  });

  it('Exoplanet nur mit festgelegtem Transit: Transitblock wie POST /plan, sonst „nicht zugeteilt“ mit Grund', () => {
    // 06.10.2026: WASP-3b stand in „An NINA ausgeliefert“ und im Plugin-Simulator, fehlte aber im Web-Simulator.
    const exo = projects.map((p) =>
      p.id === NGC281 ? { ...p, projectType: 'exoplanet' as const } : p,
    );
    const line = exo.find((p) => p.id === NGC281)?.panels[0]?.lines[0];
    if (!line) throw new Error('Fixture ohne Zeile');
    const transit = {
      projectId: NGC281,
      observationId: '0190c3f4-0000-7000-8000-0000000000e1',
      lineId: line.id,
      windowStartUtc: '2026-09-18T04:00:00Z',
      windowEndUtc: '2026-09-18T06:00:00Z',
      lockedAtUtc: '2026-09-17T12:00:00Z',
    };

    const without = simulate(request({ projects: exo }));
    expect(without.plan.blocks.some((b) => b.projectId === NGC281)).toBe(false);
    expect(without.unallocated.find((u) => u.projectId === NGC281)?.reasons).toEqual([
      { reason: 'no_locked_transit' },
    ]);

    const withTransit = simulate(request({ projects: exo, transits: [transit] }));
    const block = withTransit.plan.blocks.find((b) => b.projectId === NGC281);
    expect(block?.kind).toBe('transit');
    expect(withTransit.unallocated.some((u) => u.projectId === NGC281)).toBe(false);
    // Gleiche Eingabe wie der Server (`buildPlanInput` mit `transits`).
    const node = planNight(
      buildPlanInput(rig, exo, moonProfiles, nights, {
        night: '2026-09-17',
        site: STARFRONT,
        autofocusAfterTimeMin: rig.scheduler.overhead.afEveryMin,
        transits: [transit],
      }) as PlanInput,
    );
    expect(withTransit.plan.outputHash).toBe(node.outputHash);
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

  it('Zielkarte nennt das Mondprofil der Zeile (Name, Abstand, Breite) statt „LA“; Protokoll übersetzt Namen', () => {
    const r = simulate(request({ moonProfileNames: { [STRICT]: 'moonProfile.strict' } }));
    const lines = r.cards.flatMap((c) => c.lines);
    const withMoon = lines.filter((l) => l.moon !== null);
    expect(withMoon.length).toBeGreaterThan(0);
    expect(withMoon[0]?.moon).toEqual({
      name: 'moonProfile.strict',
      separationDeg: 90,
      widthDays: 8,
      mustBeDown: false,
    });
    expect(lines.some((l) => l.moon === null)).toBe(true);
    // Protokollspalte „Mondprofil“: mitgelieferte Profile übersetzt, eigene unverändert.
    const row = r.protocol[0];
    expect(row).toBeDefined();
    const t = ((k: string) => (k === 'moonProfile.strict' ? 'Streng' : k)) as never;
    if (row) {
      expect(cell({ ...row, moonProfile: 'moonProfile.strict' }, 'profile', t, 'UTC')).toBe(
        'Streng',
      );
      expect(cell({ ...row, moonProfile: 'Eigenes' }, 'profile', t, 'UTC')).toBe('Eigenes');
    }
  });

  it('laufende Nacht: plant ab jetzt wie das Plugin und setzt eine Uhrzeit-Marke; sonst ganze Nacht', () => {
    const whole = simulate(request());
    expect(whole.fromNowUtc).toBeNull();
    expect(simulate(request({ nowUtc: null })).plan.outputHash).toBe(whole.plan.outputHash);
    const firstExpose = whole.protocol.find((x) => x.cmd === 'expose');
    expect(firstExpose).toBeDefined();
    const now = new Date(Date.parse(firstExpose?.atUtc ?? '') + 2 * 3_600_000).toISOString();
    const r = simulate(request({ nowUtc: now }));
    expect(r.fromNowUtc).toBe(now.replace(/\.\d{3}Z$/, 'Z'));
    expect(Math.min(...r.protocol.map((x) => Date.parse(x.atUtc)))).toBeGreaterThanOrEqual(
      Date.parse(now),
    );
    expect(r.chart.markers?.some((m) => m.kind === 'now')).toBe(true);
    // Nach dem Nachtfenster (Mittag): ganze Nacht wie ohne Uhrzeit.
    const noon = simulate(request({ nowUtc: '2026-09-18T18:00:00Z' }));
    expect(noon.fromNowUtc).toBeNull();
  });
});
