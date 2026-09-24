/**
 * Aufwand-Kennzeichen (AP-13e, `specs/engine/effort.md` Pflicht-Tests 1–12, FK 8.9): Fälle mit
 * gleichbleibenden Nächten über einen Ersatz für `planNight` (Kapazität je Nacht in Belichtungen),
 * sichtbar/nicht sichtbar, Transit und Leistung mit der echten Engine.
 */
import { describe, expect, it } from 'vitest';
import {
  daysFromKey,
  effortPeriod,
  estimateEffort,
  sampleNights,
  type EffortInput,
  type NightPlan,
  type PlanInput,
  type PlanLine,
  type PlanProject,
} from '../src';

const CHICAGO = [
  { atUtc: '2025-11-02T07:00:00Z', utcOffsetMinutes: -360 },
  { atUtc: '2026-03-08T08:00:00Z', utcOffsetMinutes: -300 },
  { atUtc: '2026-11-01T07:00:00Z', utcOffsetMinutes: -360 },
  { atUtc: '2027-03-14T08:00:00Z', utcOffsetMinutes: -300 },
];
const STARFRONT = { latitudeDeg: 31.5471, longitudeDeg: -99.3823, elevationM: 400 };
const PROFILE = 'moon-strict';

function line(id: string, over: Partial<PlanLine> = {}): PlanLine {
  return {
    id,
    filter: id,
    ninaFilterName: id,
    exposureS: 300,
    planned: 40,
    accepted: 0,
    pending: 0,
    enabled: true,
    moonProfileId: null,
    gain: null,
    offset: null,
    binning: 1,
    readoutMode: null,
    ...over,
  };
}

function project(lines: PlanLine[], over: Partial<PlanProject> = {}): PlanProject {
  return {
    id: 'p1',
    raDeg: 13.2046,
    decDeg: 56.6297,
    rotationDeg: 0,
    priority: 1,
    minAltitudeDeg: 30,
    minTimeOnTargetH: 1,
    twilight: 'astronomical',
    startDate: null,
    dueDate: null,
    panels: [{ id: 'pa', index: 0, raDeg: 13.2046, decDeg: 56.6297, rotationDeg: 0, lines }],
    transit: null,
    ...over,
  };
}

function plan(p: PlanProject, downloadS = 0): PlanInput {
  return {
    mode: 'productive',
    night: '2026-09-17',
    site: STARFRONT,
    tzdataVersion: '2026a',
    timeZoneTransitions: CHICAGO,
    rig: {
      id: 'rig',
      hasRotator: true,
      defaultRotationDeg: null,
      rotationToleranceDeg: 5,
      hasFilterWheel: true,
    },
    scheduler: {
      strategy: 'proportional',
      sortChain: [],
      bonusEnabled: false,
      overshootPct: 0,
      mosaicPanelsIndependent: true,
      ditherEnabled: false,
      ditherEvery: 0,
      filterSwitchEnabled: false,
      filterSwitchEvery: 0,
      filterSwitchTolerancePct: 0,
      flatsSource: 'panel',
      flip: { enabled: false, afterMin: 5, maxAfterMin: 15, pauseBeforeMin: 0, durationS: 240 },
      overhead: {
        slewCenterS: 0,
        filterChangeS: 0,
        ditherSettleS: 0,
        afEveryMin: 0,
        afDurationS: 0,
        downloadS,
      },
    },
    moonProfiles: [
      {
        id: PROFILE,
        separationDeg: 120,
        widthDays: 7,
        relaxScale: 2,
        moonMinAltDeg: -15,
        moonMaxAltDeg: 5,
        maxIlluminationPct: 10,
        moonMustBeDown: true,
      },
    ],
    projects: [p],
    startAtUtc: null,
    tonight: null,
  };
}

/**
 * Ersatz-Nacht: `dark(night)` Sekunden mondfrei, `bright(night)` Sekunden mit Mond. Mondempfindliche
 * Zeilen (mit Profil) nutzen nur die mondfreie Zeit; die mondfreie Zeit wird nach Restbedarf geteilt
 * (wie Pass 1a/1b mit Konkurrenz der Zeilen), die Zeit mit Mond geht an die übrigen Zeilen.
 */
function fakeNight(dark: (night: string) => number, bright: (night: string) => number = () => 0) {
  return (input: PlanInput): NightPlan => {
    const p = input.projects[0] as PlanProject;
    const ls = p.panels.flatMap((x) => x.lines);
    const ov = input.scheduler.overhead.downloadS;
    const need = new Map(ls.map((l) => [l.id, l.planned]));
    const got = new Map<string, number>();
    const give = (ids: PlanLine[], sec: number) => {
      const total = ids.reduce((s, l) => s + (need.get(l.id) ?? 0) * (l.exposureS + ov), 0);
      if (total <= 0) return;
      for (const l of ids) {
        const want = (need.get(l.id) ?? 0) * (l.exposureS + ov);
        const share = Math.min(want, (sec * want) / total);
        const n = Math.min(need.get(l.id) ?? 0, Math.floor(share / (l.exposureS + ov) + 1e-9));
        got.set(l.id, (got.get(l.id) ?? 0) + n);
        need.set(l.id, (need.get(l.id) ?? 0) - n);
      }
    };
    const withWork = () => ls.filter((l) => (need.get(l.id) ?? 0) > 0);
    give(withWork(), dark(input.night));
    give(
      withWork().filter((l) => l.moonProfileId === null),
      bright(input.night),
    );
    const diagnostics = ls
      .filter((l) => l.planned > 0 && (got.get(l.id) ?? 0) === 0)
      .map((l) => ({
        projectId: p.id,
        lineId: l.id,
        reason: dark(input.night) + bright(input.night) === 0 ? 'not_visible' : 'moon_blocked',
      }));
    const entries = ls.flatMap((l) =>
      Array.from({ length: got.get(l.id) ?? 0 }, (_, k) => ({
        seq: k + 1,
        cmd: 'expose' as const,
        atUtc: '2026-09-18T03:00:00Z',
        exposureLineId: l.id,
        filter: l.filter,
        exposureS: l.exposureS,
        gain: null,
        offset: null,
        binning: 1,
        readoutMode: null,
        bonus: false,
        lastOfNight: false,
      })),
    );
    return {
      blocks: entries.length > 0 ? [{ projectId: p.id, entries }] : [],
      diagnostics,
    } as unknown as NightPlan;
  };
}

const effort = (
  lines: PlanLine[],
  from: string,
  to: string,
  stride: number,
  planNight: (i: PlanInput) => NightPlan,
  downloadS = 0,
) =>
  estimateEffort(
    { plan: plan(project(lines), downloadS), fromNight: from, toNight: to, stride },
    { planNight },
  );

const H = 3600;
const dayIndex = (night: string) => daysFromKey(night) - daysFromKey('2026-10-01');

describe('estimateEffort – Pflicht-Tests (effort.md)', () => {
  it('1: kleines Projekt passt in eine Nacht → single_night', () => {
    const r = effort(
      [line('Ha', { planned: 10 })],
      '2026-10-01',
      '2026-10-30',
      3,
      fakeNight(() => 5 * H),
    );
    expect(r?.tag).toBe('single_night');
    expect(r?.nights).toBe(1);
    expect(r?.earliestCompletion).toBe('2026-10-01');
    expect(r?.bestNight).toBe('2026-10-01');
    expect(r?.bestNightHoursByStage).toEqual([
      { moonProfileId: null, filters: ['Ha'], hours: 0.8 },
    ]);
    expect(r?.limitingFactor).toBeNull();
    expect(r?.requiredHours).toBe(0.8);
  });

  it('2: 20 h Bedarf bei 5 h/Nacht → multi_night, 4 Nächte', () => {
    const r = effort(
      [line('L', { planned: 240 })],
      '2026-10-01',
      '2026-10-30',
      3,
      fakeNight(() => 5 * H),
    );
    expect(r?.tag).toBe('multi_night');
    expect(r?.nights).toBe(4);
    expect(r?.earliestCompletion).toBe('2026-10-04');
    expect(r?.requiredHours).toBe(20);
  });

  it('3: wie 2 mit downloadS = 5 → 5 Nächte (Overhead wirkt)', () => {
    const r = effort(
      [line('L', { planned: 240 })],
      '2026-10-01',
      '2026-10-30',
      3,
      fakeNight(() => 5 * H),
      5,
    );
    expect(r?.tag).toBe('multi_night');
    expect(r?.nights).toBe(5);
    expect(r?.requiredHours).toBe(20.3);
  });

  it('4: Mond blockiert Breitband in 10 von 14 Nächten → multi_night, begrenzt durch Breitband/moon_blocked', () => {
    const lines = [
      line('Ha', { planned: 20 }),
      line('L', { planned: 100, moonProfileId: PROFILE }),
    ];
    const r = effort(
      lines,
      '2026-10-01',
      '2026-10-14',
      3,
      fakeNight(
        (n) => (dayIndex(n) >= 10 ? 5 * H : 0),
        (n) => (dayIndex(n) >= 10 ? 0 : 5 * H),
      ),
    );
    expect(r?.tag).toBe('multi_night');
    expect(r?.limitingFactor).toEqual({
      lineId: 'L',
      filterShortName: 'L',
      reason: 'moon_blocked',
    });
    expect(r?.earliestCompletion).toBe('2026-10-14');
  });

  it('5: Ziel geht nach 20 Nächten unter, Bedarf 30 Nächte → not_feasible, erreichbarer Anteil in Sekunden', () => {
    const r = effort(
      [line('L', { planned: 1800 }), line('R', { planned: 0 })],
      '2026-10-01',
      '2026-11-09',
      1,
      fakeNight((n) => (dayIndex(n) < 20 ? 5 * H : 0)),
    );
    expect(r?.tag).toBe('not_feasible');
    expect(r?.nights).toBe(20);
    expect(r?.achievablePct).toBe(66);
    expect(r?.limitingFactor).toEqual({ lineId: 'L', filterShortName: 'L', reason: 'not_visible' });
  });

  it('5b: erreichbarer Anteil in Sekunden, nicht in Frames (ENG-18)', () => {
    // 60 × 60 s gedeckt, 60 × 600 s nie: Frames 50 %, Sekunden ⌊100 · 3600/39600⌋ = 9 %.
    const r = effort(
      [
        line('R', { planned: 60, exposureS: 60 }),
        line('Ha', { planned: 60, exposureS: 600, moonProfileId: PROFILE }),
      ],
      '2026-10-01',
      '2026-10-10',
      1,
      fakeNight(
        () => 0,
        () => 5 * H,
      ),
    );
    expect(r?.tag).toBe('not_feasible');
    expect(r?.achievablePct).toBe(9);
    expect(r?.limitingFactor?.lineId).toBe('Ha');
  });

  it('8: stride 1 und stride 3 liefern bei gleichbleibenden Nächten dasselbe Ergebnis', () => {
    const run = (stride: number) =>
      effort(
        [line('L', { planned: 500 })],
        '2026-10-01',
        '2026-11-29',
        stride,
        fakeNight(() => 4 * H),
      );
    const a = run(1);
    const b = run(3);
    expect([b?.tag, b?.nights, b?.earliestCompletion]).toEqual([
      a?.tag,
      a?.nights,
      a?.earliestCompletion,
    ]);
    expect(a?.nights).toBe(11);
  });

  it('9: need = 0 → null (UI „fertig“)', () => {
    const r = effort(
      [line('L', { planned: 10, accepted: 10 }), line('R', { planned: 5, enabled: false })],
      '2026-10-01',
      '2026-10-30',
      3,
      fakeNight(() => 5 * H),
    );
    expect(r).toBeNull();
  });

  it('10: Schmalband gedeckt → nächste Stichprobe plant nur Breitband (weniger Nächte als mit vollem Bedarf)', () => {
    const lines = [line('Ha', { planned: 60 }), line('L', { planned: 60, moonProfileId: PROFILE })];
    const planNight = fakeNight(
      () => 2 * H,
      () => 3 * H,
    );
    const r = effort(lines, '2026-10-01', '2026-10-30', 1, planNight);
    // Voller Bedarf: L erhält 12 von 24 mondfreien Belichtungen je Nacht → 5 Nächte.
    const full = planNight(plan(project(lines)));
    const lFull = full.blocks
      .flatMap((b) => b.entries)
      .filter((e) => e.cmd === 'expose' && e.exposureLineId === 'L').length;
    expect(lFull).toBe(12);
    expect(Math.ceil(60 / lFull)).toBe(5);
    expect(r?.tag).toBe('multi_night');
    expect(r?.nights).toBe(4);
    expect(r?.nights).toBeLessThan(5);
  });

  it('11: Gleichstand bei bestNight → frühere Nacht', () => {
    const r = effort(
      [line('L', { planned: 500 })],
      '2026-10-01',
      '2026-10-30',
      3,
      fakeNight((n) => ([3, 6].includes(dayIndex(n)) ? 5 * H : 1 * H)),
    );
    expect(r?.bestNight).toBe('2026-10-04');
  });

  it('12: Stichprobe ohne Kapazität → Zwischennächte brechen sofort ab, nights wächst nicht (ENG5-3)', () => {
    const r = effort(
      [line('L', { planned: 60 })],
      '2026-10-01',
      '2026-10-30',
      3,
      fakeNight((n) => (dayIndex(n) >= 6 ? 5 * H : 0)),
    );
    expect(r?.tag).toBe('single_night');
    const r2 = effort(
      [line('L', { planned: 120 })],
      '2026-10-01',
      '2026-10-30',
      3,
      fakeNight((n) => (dayIndex(n) >= 6 ? 5 * H : 0)),
    );
    expect(r2?.tag).toBe('multi_night');
    expect(r2?.nights).toBe(2);
    expect(r2?.earliestCompletion).toBe('2026-10-08');
  });

  it('Zwischennächte zählen nicht über das Zeitraumende hinaus', () => {
    const r = effort(
      [line('L', { planned: 600 })],
      '2026-10-01',
      '2026-10-05',
      3,
      fakeNight(() => 5 * H),
    );
    expect(r?.tag).toBe('not_feasible');
    expect(r?.nights).toBe(5);
    expect(r?.achievablePct).toBe(50);
  });

  it('Eingabeprüfung: genau ein Projekt, stride ≥ 1, höchstens 180 Nächte', () => {
    const base: EffortInput = {
      plan: plan(project([line('L')])),
      fromNight: '2026-10-01',
      toNight: '2026-10-10',
      stride: 3,
    };
    expect(() => estimateEffort({ ...base, stride: 0 })).toThrow(/stride/);
    expect(() => estimateEffort({ ...base, toNight: '2027-04-01' })).toThrow(/Zeitraum/);
    expect(() => estimateEffort({ ...base, plan: { ...base.plan, projects: [] } })).toThrow(
      /genau ein/,
    );
    expect(sampleNights('2026-10-30', '2026-11-05', 3)).toEqual([
      '2026-10-30',
      '2026-11-02',
      '2026-11-05',
    ]);
  });
});

describe('estimateEffort – echte Engine (Starfront)', () => {
  it('6: nie über Mindesthöhe → not_feasible 0 %, reason not_visible', () => {
    const p = project([line('L', { planned: 20 })], {
      decDeg: -80,
      panels: [
        {
          id: 'pa',
          index: 0,
          raDeg: 13.2,
          decDeg: -80,
          rotationDeg: 0,
          lines: [line('L', { planned: 20 })],
        },
      ],
    });
    const r = estimateEffort({
      plan: plan(p),
      fromNight: '2026-10-01',
      toNight: '2026-10-07',
      stride: 3,
    });
    expect(r?.tag).toBe('not_feasible');
    expect(r?.achievablePct).toBe(0);
    expect(r?.limitingFactor).toEqual({ lineId: 'L', filterShortName: 'L', reason: 'not_visible' });
    expect(r?.bestNight).toBeNull();
  });

  it('7: Exoplanet → transit mit fullyObservable (ganz) bzw. Anteil (teilweise)', () => {
    // HAT-P-17: Meridian 2026-09-18 04:28Z, Höhe ≈ 89°.
    const p = project([line('V', { planned: 0 })], {
      raDeg: 324.5367,
      decDeg: 30.4882,
      panels: [
        {
          id: 'pa',
          index: 0,
          raDeg: 324.5367,
          decDeg: 30.4882,
          rotationDeg: 0,
          lines: [line('V', { planned: 0 })],
        },
      ],
    });
    const at = (a: string, b: string) =>
      estimateEffort({
        plan: plan(p),
        fromNight: '2026-09-17',
        toNight: '2026-09-17',
        stride: 3,
        exoplanet: { window: { night: '2026-09-17', windowStartUtc: a, windowEndUtc: b } },
      });
    const full = at('2026-09-18T03:00:00Z', '2026-09-18T06:00:00Z');
    expect([full?.tag, full?.fullyObservable, full?.coveragePct, full?.requiredHours]).toEqual([
      'transit',
      true,
      100,
      3,
    ]);
    const partial = at('2026-09-18T09:00:00Z', '2026-09-18T13:00:00Z');
    expect(partial?.fullyObservable).toBe(false);
    expect(partial?.coveragePct).toBeGreaterThan(0);
    expect(partial?.coveragePct).toBeLessThan(100);
    const none = estimateEffort({
      plan: plan(p),
      fromNight: '2026-09-17',
      toNight: '2026-09-17',
      stride: 3,
      exoplanet: { window: null },
    });
    expect([none?.tag, none?.fullyObservable, none?.coveragePct]).toEqual(['transit', null, null]);
  });

  it('Determinismus: gleicher inputHash und gleiches Ergebnis', () => {
    const input: EffortInput = {
      plan: plan(
        project([line('Ha', { planned: 30 }), line('L', { planned: 30, moonProfileId: PROFILE })]),
      ),
      fromNight: '2026-10-01',
      toNight: '2026-10-10',
      stride: 3,
    };
    const a = estimateEffort(input);
    expect(estimateEffort(input)).toEqual(a);
    expect(a?.inputHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(estimateEffort({ ...input, stride: 5 })?.inputHash).not.toBe(a?.inputHash);
  });

  it('Leistung: 180 Nächte, stride 3, 3 Zeilen ≤ 5 s', () => {
    const lines = [
      line('Ha', { planned: 400 }),
      line('OIII', { planned: 400 }),
      line('L', { planned: 400, moonProfileId: PROFILE }),
    ];
    const started = performance.now();
    const r = estimateEffort({
      plan: plan(project(lines), 3),
      fromNight: '2026-10-01',
      toNight: '2027-03-29',
      stride: 3,
    });
    const ms = performance.now() - started;
    expect(r).not.toBeNull();
    expect(r?.planRuns).toBeLessThanOrEqual(120);
    expect(ms).toBeLessThan(5000);
  });
});

describe('effortPeriod (effort.md „Eingabe“, NT-01)', () => {
  const today = '2026-10-01';
  it('ohne Wunsch: heute … Saisonende, ohne Saisonende 180 Nächte', () => {
    expect(
      effortPeriod({
        currentNight: today,
        requestFrom: null,
        requestTo: null,
        seasonEnd: '2027-01-15',
      }),
    ).toEqual({
      fromNight: today,
      toNight: '2027-01-15',
    });
    expect(
      effortPeriod({ currentNight: today, requestFrom: null, requestTo: null, seasonEnd: null }),
    ).toEqual({
      fromNight: today,
      toNight: '2027-03-29',
    });
  });
  it('Wunschzeitraum vor heute wird auf heute gekürzt, höchstens 180 Nächte', () => {
    expect(
      effortPeriod({
        currentNight: today,
        requestFrom: '2026-09-01',
        requestTo: '2026-10-20',
        seasonEnd: null,
      }),
    ).toEqual({ fromNight: today, toNight: '2026-10-20' });
    expect(
      effortPeriod({
        currentNight: today,
        requestFrom: '2026-11-01',
        requestTo: '2028-01-01',
        seasonEnd: null,
      }),
    ).toEqual({ fromNight: '2026-11-01', toNight: '2027-04-29' });
  });
  it('abgelaufener Wunschzeitraum → Standardzeitraum', () => {
    expect(
      effortPeriod({
        currentNight: today,
        requestFrom: '2026-08-01',
        requestTo: '2026-09-01',
        seasonEnd: '2026-12-01',
      }),
    ).toEqual({ fromNight: today, toNight: '2026-12-01' });
  });
});
