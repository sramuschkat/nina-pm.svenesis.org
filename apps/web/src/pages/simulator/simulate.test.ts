/**
 * Simulator-Rechnung (AP-13f): Worker-Ergebnis = Node-Ergebnis (Hash, FA-SIM-05), Protokoll je Eintrag,
 * Zielkarten, nicht zugeteilte Projekte, Entwürfe nur mit `selection: 'given'`.
 */
import { planNight, type PlanInput } from '@nina-pm/engine';
import { buildPlanInput, type ExecutedNight, type StoredPlan } from '@nina-pm/shared';
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
import { simulate, stillRunning, type SimulationRequest } from './simulate';

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

    // Transit dieser Nacht schon belichtet (Fenster vorbei, Ist vom Server): ausgegraute Zielkarte mit Anzahl.
    const done = simulate(
      request({
        projects: exo,
        server: {
          // Der Server liefert Exoplaneten ohne festgelegten Transit nicht aus (nightPlanInput).
          input: buildPlanInput(
            rig,
            exo.filter((p) => p.id !== NGC281),
            moonProfiles,
            nights,
            {
              night: '2026-09-17',
              site: STARFRONT,
              autofocusAfterTimeMin: rig.scheduler.overhead.afEveryMin,
            },
          ),
          inputHash: 'sha256:abc',
          projectNames: {},
          executed: {
            night: '2026-09-17',
            sessions: 1,
            blocks: [
              {
                blockId: null,
                nightPlanId: null,
                projectId: NGC281,
                panelId: null,
                title: 'NGC 281',
                kind: 'transit',
                startUtc: '2026-09-18T04:00:00Z',
                endUtc: '2026-09-18T06:00:00Z',
                endReason: 'completed',
                exposures: 558,
                running: false,
              },
            ],
            segments: [],
            events: [],
            gaps: [],
            counters: { saved: 558, skipped: 0, failed: 0 },
          },
          storedPlan: null,
          firstPlan: null,
        },
      }),
    );
    // Heute Nacht abgearbeitet: ausgegraute Zielkarte statt „Nicht zugeteilt“ (07.10.2026).
    expect(done.unallocated.some((u) => u.projectId === NGC281)).toBe(false);
    expect(done.doneCards).toEqual([
      expect.objectContaining({
        projectId: NGC281,
        transit: true,
        exposures: 558,
        fromUtc: '2026-09-18T04:00:00Z',
        toUtc: '2026-09-18T06:00:00Z',
      }),
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

  it('Deep-Sky heute Nacht belichtet, im Rest-Plan nicht mehr: ausgegraute Zielkarte; bloß angefahren nicht', () => {
    const PAUSED = '0190c3f4-0000-7000-8000-0000000000d1';
    const SLEWED = '0190c3f4-0000-7000-8000-0000000000d2';
    const block = (projectId: string, title: string, exposures: number) => ({
      blockId: null,
      nightPlanId: null,
      projectId,
      panelId: null,
      title,
      kind: 'regular' as const,
      startUtc: '2026-09-18T02:00:00Z',
      endUtc: '2026-09-18T03:00:00Z',
      endReason: 'target_removed',
      exposures,
      running: false,
    });
    const base = simulate(request());
    const r = simulate(
      request({
        server: {
          input: buildPlanInput(rig, projects, moonProfiles, nights, {
            night: '2026-09-17',
            site: STARFRONT,
            autofocusAfterTimeMin: rig.scheduler.overhead.afEveryMin,
          }),
          inputHash: 'sha256:abc',
          projectNames: { [PAUSED]: 'IC 1795' },
          executed: {
            night: '2026-09-17',
            sessions: 1,
            blocks: [
              block(PAUSED, 'IC 1795', 6),
              block(SLEWED, 'M 31', 0),
              block(base.cards[0]?.projectId ?? '', 'geplant', 3),
            ],
            segments: [],
            events: [],
            gaps: [],
            counters: { saved: 9, skipped: 0, failed: 0 },
          },
          storedPlan: null,
          firstPlan: null,
        },
      }),
    );
    // Geplante Projekte bleiben normale Zielkarten; ohne Aufnahme (nur angefahren) keine Karte.
    expect(r.doneCards.map((c) => [c.name, c.transit, c.exposures])).toEqual([
      ['IC 1795', false, 6],
    ]);
    expect(r.cards.map((c) => c.projectId)).toEqual(base.cards.map((c) => c.projectId));
    // stillRunning: jetzt laufender Block im gespeicherten Plan (mit dessen Ende) bzw. laufender Ist-Block (ohne Ende).
    const stored = {
      blocks: [
        { projectId: PAUSED, startUtc: '2026-09-18T08:00:00Z', endUtc: '2026-09-18T10:00:00Z' },
        // Späterer Block (07.10.2026): macht das Projekt nicht zu „läuft an der Rig“.
        { projectId: SLEWED, startUtc: '2026-09-18T10:00:00Z', endUtc: '2026-09-18T11:00:00Z' },
      ],
    };
    expect(stillRunning(null, stored, Date.parse('2026-09-18T09:00:00Z'))).toEqual(
      new Map([[PAUSED, '2026-09-18T10:00:00Z']]),
    );
    expect(stillRunning(null, stored, Date.parse('2026-09-18T11:00:00Z'))).toEqual(new Map());
    const running = {
      night: '2026-09-17',
      sessions: 1,
      blocks: [{ ...block(PAUSED, 'IC 1795', 6), endUtc: null, running: true }],
      segments: [],
      events: [],
      gaps: [],
      counters: { saved: 6, skipped: 0, failed: 0 },
    };
    expect(stillRunning(running, null, Number.NaN)).toEqual(new Map([[PAUSED, null]]));
  });

  it('kurz vor Nachtende: Projekt, das die Rig noch belichtet, ist „läuft an der Rig“, nicht „nicht zugeteilt“', () => {
    // Prod 07.10.2026, 06:04 CDT: 10 min dunkel übrig, die Rechnung ab jetzt teilt IC 1795 nicht mehr zu („unter der
    // Mindestzeit“), die Rig belichtete aber noch SII aus dem gespeicherten Plan.
    const end = Date.parse(simulate(request()).plan.nightWindow.endUtc);
    const now = new Date(end - 10 * 60_000).toISOString();
    const late = simulate(request({ nowUtc: now }));
    const id = late.unallocated[0]?.projectId ?? '';
    expect(id).not.toBe('');
    const blockEnd = new Date(end - 2 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const r = simulate(
      request({
        nowUtc: now,
        server: {
          input: buildPlanInput(rig, projects, moonProfiles, nights, {
            night: '2026-09-17',
            site: STARFRONT,
            autofocusAfterTimeMin: rig.scheduler.overhead.afEveryMin,
          }),
          inputHash: 'sha256:abc',
          projectNames: {},
          executed: {
            night: '2026-09-17',
            sessions: 1,
            blocks: [
              {
                blockId: null,
                nightPlanId: null,
                projectId: id,
                panelId: null,
                title: 'IC 1795',
                kind: 'regular',
                startUtc: new Date(end - 3 * 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
                endUtc: null,
                endReason: null,
                exposures: 18,
                running: true,
              },
            ],
            segments: [],
            events: [],
            gaps: [],
            counters: { saved: 18, skipped: 0, failed: 0 },
          },
          storedPlan: {
            nightPlanId: '0190c3f4-0000-7000-8000-0000000000f1',
            revision: 214,
            reason: 'refresh',
            createdAtUtc: now,
            stale: false,
            staleCause: null,
            blocks: [
              {
                id: '0190c3f4-0000-7000-8000-0000000000f2',
                projectId: id,
                kind: 'regular',
                startUtc: now,
                endUtc: blockEnd,
                entries: [],
              },
            ],
          } as never,
          firstPlan: null,
        },
      }),
    );
    expect(r.unallocated.some((u) => u.projectId === id)).toBe(false);
    // Eine Quelle (07.10.2026): Zielkarte aus dem gespeicherten Plan, Zustand „läuft an der Rig“, Ist bisher.
    expect(r.fromStored).toBe(true);
    expect(r.cards.find((c) => c.projectId === id)).toMatchObject({
      state: 'running',
      doneExposures: 18,
      toUtc: blockEnd,
    });
    expect(r.doneCards).toEqual([]);
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
    expect(r.nightOver).toBe(false);
    // Nach dem Nachtfenster (Mittag): ganze Nacht wie ohne Uhrzeit.
    const noon = simulate(request({ nowUtc: '2026-09-18T18:00:00Z' }));
    expect(noon.fromNowUtc).toBeNull();
    expect(noon.nightOver).toBe(false);
  });

  it('„ab jetzt“ nach dem Ende der Dunkelheit → Nacht vorbei statt Gründen der Rechnung (AP-71)', () => {
    const whole = simulate(request());
    const end = whole.plan.darknessEndUtc;
    expect(end).not.toBeNull();
    const after = new Date(Date.parse(end ?? '') + 10 * 60_000).toISOString();
    const r = simulate(request({ nowUtc: after }));
    expect(r.fromNowUtc).not.toBeNull();
    expect(r.nightOver).toBe(true);
  });

  it('Server-Eingabe (AP-53c): gleicher Hash, Hinweis „gleiche Eingabe“; mit Entwürfen Was-wäre-wenn', () => {
    const input = buildPlanInput(rig, projects, moonProfiles, nights, {
      night: '2026-09-17',
      site: STARFRONT,
      autofocusAfterTimeMin: rig.scheduler.overhead.afEveryMin,
    }) as PlanInput;
    const server = {
      input,
      inputHash: 'sha256:abc',
      projectNames: {},
      executed: null,
      storedPlan: null,
      firstPlan: null,
    };
    const r = simulate(request({ server }));
    expect(r.plan.inputHash).toBe(simulate(request()).plan.inputHash);
    expect(r.source).toEqual({ serverHash: 'sha256:abc', whatIf: false, stored: null });
    expect(r.actual).toBeNull();
    expect(simulate(request({ server, selection: 'given' })).source.whatIf).toBe(true);
  });

  it('laufende Nacht mit Ist und gespeichertem Plan: Erledigtes blass, Rest aus der Revision kräftig, Spalte Ist', () => {
    const whole = simulate(request());
    const exposes = whole.protocol.filter((x) => x.cmd === 'expose');
    const first = exposes[0];
    if (!first) throw new Error('keine Belichtung im Plan');
    const nowMs = Date.parse(first.atUtc) + 2 * 3_600_000;
    const stored: StoredPlan = {
      nightPlanId: '0192a7c0-0000-7000-8000-000000000b01',
      revision: 3,
      reason: 'refresh',
      createdAtUtc: first.atUtc,
      stale: true,
      staleCause: 'targets',
      blocks: whole.plan.blocks as unknown as StoredPlan['blocks'],
    };
    const executed: ExecutedNight = {
      night: '2026-09-17',
      sessions: 1,
      blocks: [
        {
          blockId: first.blockId,
          nightPlanId: stored.nightPlanId,
          projectId: first.projectId,
          panelId: null,
          title: 'NGC 281',
          kind: 'regular',
          startUtc: first.atUtc,
          endUtc: null,
          endReason: null,
          exposures: 2,
          running: true,
        },
      ],
      segments: [
        {
          blockId: first.blockId,
          projectId: first.projectId,
          filter: 'Ha',
          startUtc: first.atUtc,
          endUtc: new Date(Date.parse(first.atUtc) + 600_000).toISOString().replace('.000Z', 'Z'),
          saved: 2,
          failed: 0,
          exposureS: 300,
        },
      ],
      events: [],
      gaps: [],
      counters: { saved: 2, skipped: 0, failed: 0 },
    };
    const r = simulate(
      request({
        nowUtc: new Date(nowMs).toISOString(),
        server: {
          input: buildPlanInput(rig, projects, moonProfiles, nights, {
            night: '2026-09-17',
            site: STARFRONT,
            autofocusAfterTimeMin: rig.scheduler.overhead.afEveryMin,
          }),
          inputHash: 'sha256:abc',
          projectNames: {},
          executed,
          storedPlan: stored,
          firstPlan: stored,
        },
      }),
    );
    expect(r.actual).not.toBeNull();
    expect(r.actual?.fromStored).toBe(true);
    const past = r.chart.blocks?.filter((b) => b.tense === 'past') ?? [];
    const planned = r.chart.blocks?.filter((b) => b.tense === 'planned') ?? [];
    expect(past).toHaveLength(1);
    expect(past[0]?.toUtc).toBe(nowMs / 1000);
    expect(planned.length).toBeGreaterThan(0);
    expect(Math.min(...planned.map((b) => b.fromUtc))).toBeGreaterThanOrEqual(nowMs / 1000);
    expect(r.chart.filterBars?.[0]).toMatchObject({ tense: 'past', label: 'Ha', count: 2 });
    // Mit gespeicherter Aufnahme ist das Anfahren erledigt; den Laufzeiger trägt die laufende Planzeile (07./08.10.).
    expect(r.protocol[0]?.actual).toEqual({
      state: 'done',
      reason: null,
      count: null,
      past: true,
    });
    const running = r.protocol.filter((x) => x.actual?.state === 'running');
    expect(running).toHaveLength(1);
    expect(running[0]?.actual?.past).toBe(false);
    expect(Date.parse(running[0]?.atUtc ?? '')).toBeLessThan(nowMs);
    expect(r.protocol.some((x) => x.actual?.state === 'saved' && x.actual.count === 2)).toBe(true);
    const future = r.protocol.filter((x) => x.actual?.state === 'planned');
    expect(future.length).toBeGreaterThan(0);
    expect(future.every((x) => Date.parse(x.atUtc) >= nowMs)).toBe(true);
    // Höhe und Mond auch für die Zeilen des gespeicherten Plans.
    expect(future.every((x) => x.altDeg !== null && x.moonSepDeg !== null)).toBe(true);
    expect(r.actual?.outline.length).toBe(whole.plan.blocks.length);
    expect(r.source.stored).toMatchObject({ revision: 3, stale: true, staleCause: 'targets' });
    expect(r.actual?.counters).toEqual({ saved: 2, skipped: 0, failed: 0 });
  });
});

/**
 * Eine Quelle (Entscheidung Sven 07.10.2026): In der laufenden Nacht mit gespeichertem Plan kommen Zielkarten,
 * „Nicht zugeteilt“, Kopfzahlen und Flips aus dem offenen Rest der Revision plus Ist – nicht aus der Rechnung ab jetzt.
 */
describe('laufende Nacht aus gespeichertem Plan + Ist', () => {
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const serverInput = buildPlanInput(rig, projects, moonProfiles, nights, {
    night: '2026-09-17',
    site: STARFRONT,
    autofocusAfterTimeMin: rig.scheduler.overhead.afEveryMin,
  }) as PlanInput;
  // 10 min vor Nachtende teilt die Rechnung ab jetzt nichts mehr zu (unter der Mindestzeit).
  const end = Date.parse(simulate(request()).plan.nightWindow.endUtc);
  const nowMs = end - 10 * 60_000;
  const late = simulate(request({ nowUtc: iso(nowMs) }));
  const pid = late.unallocated[0]?.projectId ?? '';
  const project = serverInput.projects.find((p) => p.id === pid);
  const lineId = project?.panels[0]?.lines[0]?.id ?? '';
  const block = (id: string, from: number, to: number, entries: unknown[]) => ({
    id,
    kind: 'regular',
    projectId: pid,
    panelId: null,
    transitObservationId: null,
    startUtc: iso(from),
    endUtc: iso(to),
    twilightEndUtc: null,
    raDeg: project?.raDeg ?? 0,
    decDeg: project?.decDeg ?? 0,
    rotationDeg: 0,
    rotationMode: 'fixed_camera',
    meridianFlip: null,
    entries,
  });
  const expose = (seq: number, at: number) => ({
    seq,
    cmd: 'expose',
    atUtc: iso(at),
    exposureLineId: lineId,
    filter: 'Ha',
    exposureS: 60,
    gain: 100,
    offset: 20,
    binning: 1,
    readoutMode: null,
    bonus: false,
    lastOfNight: false,
  });
  const B_SKIPPED = '0190c3f4-0000-7000-8000-0000000000a1';
  const B_LATER = '0190c3f4-0000-7000-8000-0000000000a2';
  const stored = (blocks: unknown[]): StoredPlan => ({
    nightPlanId: '0190c3f4-0000-7000-8000-0000000000a0',
    revision: 7,
    reason: 'refresh',
    createdAtUtc: iso(nowMs - 3_600_000),
    stale: false,
    staleCause: null,
    blocks: blocks as StoredPlan['blocks'],
  });
  const executed = (over: Partial<ExecutedNight> = {}): ExecutedNight => ({
    night: '2026-09-17',
    sessions: 1,
    blocks: [],
    segments: [],
    events: [],
    gaps: [],
    counters: { saved: 0, skipped: 0, failed: 0 },
    ...over,
  });
  const run = (plan: StoredPlan, ex: ExecutedNight | null, endedBlockIds?: string[]) =>
    simulate(
      request({
        nowUtc: iso(nowMs),
        server: {
          input: serverInput,
          inputHash: 'sha256:abc',
          projectNames: {},
          executed: ex,
          storedPlan: plan,
          firstPlan: plan,
          ...(endedBlockIds ? { endedBlockIds } : {}),
        },
      }),
    );
  // Späterer Block im gespeicherten Plan: 2 Belichtungen und ein Flip ab jetzt.
  const later = block(B_LATER, nowMs + 2 * 60_000, end - 60_000, [
    { seq: 1, cmd: 'slew_center', atUtc: iso(nowMs + 2 * 60_000), durationS: 60 },
    expose(2, nowMs + 3 * 60_000),
    { seq: 3, cmd: 'meridian_flip', atUtc: iso(nowMs + 4 * 60_000), durationS: 60 },
    expose(4, nowMs + 5 * 60_000),
    { seq: 5, cmd: 'end', atUtc: iso(end - 60_000) },
  ]);

  it('Projekt im gespeicherten Plan ohne Ist: Zielkarte „geplant“ statt „Nicht zugeteilt“; Kopfzahlen und Flips vom Plan', () => {
    expect(pid).not.toBe('');
    const r = run(stored([later]), executed());
    expect(r.fromStored).toBe(true);
    expect(r.unallocated.some((u) => u.projectId === pid)).toBe(false);
    expect(r.cards.map((c) => [c.projectId, c.state])).toEqual([[pid, 'planned']]);
    expect(r.cards[0]?.lines.find((l) => l.lineId === lineId)?.tonight).toBe(2);
    // Ziele · Frames aus dem Rest der Revision; Flips aus deren meridian_flip-Einträgen.
    expect(r.header).toMatchObject({ targets: 1, frames: 2 });
    expect(r.chart.markers?.filter((m) => m.kind === 'flip').map((m) => m.atUtc)).toEqual([
      (nowMs + 4 * 60_000) / 1000,
    ]);
    // Filterleiste, Protokoll und Karte zählen dieselben Belichtungen.
    const bars = (r.chart.filterBars ?? []).filter((f) => f.tense === 'planned');
    expect(bars.reduce((n, f) => n + (f.count ?? 0), 0)).toBe(2);
    expect(r.protocol.filter((x) => x.cmd === 'expose').map((x) => x.no)).toEqual([1, 2]);
  });

  it('übersprungener bzw. leer beendeter Block bleibt nicht „geplant“; „läuft“ nur der jetzt laufende Block', () => {
    const skipped = block(B_SKIPPED, nowMs - 5 * 60_000, nowMs + 60_000, [
      expose(1, nowMs + 30_000),
    ]);
    // Ohne Ist: der jetzt laufende Block läuft an der Rig.
    expect(run(stored([skipped]), executed()).cards[0]?.state).toBe('running');
    // block_skipped im Ist: weder Karte noch Block im Diagramm; die Gründe kommen aus der Rechnung.
    const ev = executed({
      events: [
        {
          kind: 'block_skipped',
          atUtc: iso(nowMs - 4 * 60_000),
          blockId: B_SKIPPED,
          projectId: pid,
          code: 'center_failed',
          durationS: null,
          revision: null,
        },
      ],
    });
    const r = run(stored([skipped]), ev);
    expect(r.cards).toEqual([]);
    expect(r.chart.blocks?.some((b) => b.id === B_SKIPPED)).toBe(false);
    expect(r.unallocated.map((u) => u.projectId)).toContain(pid);
    // Leer beendet (block_end ohne Belichtung, nur über endedBlockIds bekannt): ebenso.
    expect(run(stored([skipped]), executed(), [B_SKIPPED]).cards).toEqual([]);
    // Ist-Block eines späteren Blocks: frühere Blöcke des Plans sind vorbei.
    const moved = run(
      stored([skipped, later]),
      executed({
        blocks: [
          {
            blockId: B_LATER,
            nightPlanId: null,
            projectId: pid,
            panelId: null,
            title: 'X',
            kind: 'regular',
            startUtc: iso(nowMs - 60_000),
            endUtc: null,
            endReason: null,
            exposures: 0,
            running: true,
          },
        ],
      }),
    );
    expect(moved.chart.blocks?.filter((b) => b.tense === 'planned').map((b) => b.id)).toEqual([
      B_LATER,
    ]);
    expect(moved.cards[0]?.state).toBe('running');
  });

  it('Was-wäre-wenn (eigene Entwürfe) rechnet weiter selbst', () => {
    const r = simulate(
      request({
        nowUtc: iso(nowMs),
        selection: 'given',
        server: {
          input: serverInput,
          inputHash: 'sha256:abc',
          projectNames: {},
          executed: executed(),
          storedPlan: stored([later]),
          firstPlan: null,
        },
      }),
    );
    expect(r.fromStored).toBe(false);
    expect(r.cards.every((c) => c.state === null)).toBe(true);
  });
});
