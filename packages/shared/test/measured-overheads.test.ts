/**
 * Gemessene Overheads (AP-65, FA-RIG-04b): Messregeln, Ausreißer, Median/p25/p75, Rückfall unter 10 Messungen,
 * Schalter „fest“ und wirksame Werte in der Engine-Eingabe.
 */
import { describe, expect, it } from 'vitest';
import {
  effectiveScheduler,
  MEASURED_MIN_SAMPLES,
  measuredOverheads,
  overheadSamples,
  overheadStat,
  rigOverheads,
  type MeasureOptions,
  type OverheadEvent,
  type OverheadLight,
  type OverheadNight,
} from '../src/measured-overheads';
import type { MeasuredOverheads, SchedulerSettings } from '../src';

const at = (hms: string, day = '2026-10-07') => Date.parse(`${day}T${hms}Z`);
const ev = (
  kind: string,
  hms: string,
  o: Partial<Omit<OverheadEvent, 'kind' | 'atMs'>> = {},
): OverheadEvent => ({
  kind,
  atMs: at(hms),
  blockId: o.blockId ?? null,
  projectId: o.projectId ?? null,
  durationS: o.durationS ?? null,
  data: o.data ?? null,
});

/** Lights eines Blocks: Beginn, Belichtung, Filter und Abstand (s) nach jeder Belichtung. */
function series(
  blockId: string,
  startMs: number,
  exposureS: number,
  gaps: readonly number[],
  filterOf: (i: number) => string,
  transit = false,
): OverheadLight[] {
  const out: OverheadLight[] = [];
  let t = startMs;
  for (let i = 0; i <= gaps.length; i++) {
    out.push({ startMs: t, exposureS, filter: filterOf(i), blockId, transit });
    t += (exposureS + (gaps[i] ?? 0)) * 1000;
  }
  return out;
}

const opts: MeasureOptions = {
  ditherEnabled: true,
  ditherEvery: 1,
  typedDownloadS: 5,
  typedDitherSettleS: 20,
};

/**
 * Nachbildung der Rig-Nacht 06./07.10.2026 (Starfront): IC 1795 mit Dither nach jeder Aufnahme (Download 4 s + Dither
 * 19 s), Autofokus nach Zeit (210 s) zwischen zwei Lights, ein Filterwechsel Ha → OIII (10 s), Meridian-Flip 15 min mit
 * Autofokus nach dem Flip (3 min); danach eine Transit-Serie ohne Dither (Download 4 s).
 */
function rigNight(): OverheadNight {
  const ic = 'block-ic1795';
  const tr = 'block-transit';
  // IC 1795: Start 02:00:00, erste Aufnahme nach 35 s; 12 × 300 s, Abstände 23 s, nach Nr. 4 Autofokus (+210 s),
  // nach Nr. 6 Filterwechsel (33 s = 4 + 19 + 10), nach Nr. 9 Flip (900 s inkl. Autofokus 180 s).
  const gaps = [23, 23, 23, 23 + 210, 23, 33, 23, 23, 23 + 900, 23, 23];
  const icLights = series(ic, at('02:00:35'), 300, gaps, (i) => (i < 6 ? 'Ha' : 'OIII'));
  const end = (i: number) => (icLights[i]?.startMs ?? 0) + 300_000;
  const afEnd = end(3) + 4000 + 19_000 + 210_000; // AF nach dem Dither, vor der nächsten Aufnahme
  const flipEnd = (icLights[9]?.startMs ?? 0) - 1000;
  const icEvents: OverheadEvent[] = [
    ev('block_start', '02:00:00', {
      blockId: ic,
      projectId: 'p-ic',
      data: { kind: 'regular', slewCenterS: 35 },
    }),
    { ...ev('af', '00:00:00'), atMs: afEnd, blockId: ic, durationS: 210, data: { result: 'ok' } },
    { ...ev('flip', '00:00:00'), atMs: flipEnd, blockId: ic, durationS: 900 },
    {
      ...ev('af', '00:00:00'),
      atMs: flipEnd - 10_000,
      blockId: ic,
      durationS: 180,
      data: { result: 'ok', filter: 'L' },
    },
  ];
  // Transit: Start 04:30:00, Anfahren 28 s, erste Aufnahme erst nach 60 s (Warten auf die Serie zählt nicht),
  // 25 × 60 s, Abstände 4 s.
  const trLights = series(tr, at('04:31:00'), 60, Array(24).fill(4), () => 'R', true);
  const trEvents = [
    ev('block_start', '04:30:00', {
      blockId: tr,
      projectId: 'p-exo',
      data: { kind: 'transit', slewCenterS: 28 },
    }),
  ];
  return {
    night: '2026-10-06',
    events: [...icEvents, ...trEvents],
    lights: [...icLights, ...trLights],
  };
}

describe('measuredOverheads – Rig-Nacht 06./07.10.2026 nachgebildet', () => {
  const m = measuredOverheads([rigNight()], opts);

  it('Download aus der Transit-Serie (ohne Dither), Dither = Abstand − Download', () => {
    expect(m.downloadS).toEqual({ medianS: 4, n: 24, p25S: 4, p75S: 4 });
    expect(m.ditherSettleS?.medianS).toBe(19);
    // 11 Abstände in IC 1795: einer mit Autofokus, einer mit Flip, einer mit Filterwechsel → 8 Dither-Messungen.
    expect(m.ditherSettleS?.n).toBe(8);
  });

  it('Filterwechsel = Abstand − Download − Dither', () => {
    expect(m.filterChangeS).toEqual({ medianS: 10, n: 1, p25S: 10, p75S: 10 });
  });

  it('Autofokus aus `af`; Flip ohne den Autofokus im Flip', () => {
    expect(m.afDurationS).toEqual({ medianS: 195, n: 2, p25S: 187.5, p75S: 202.5 });
    expect(m.flipDurationS).toEqual({ medianS: 720, n: 1, p25S: 720, p75S: 720 });
  });

  it('Anfahren + Zentrieren aus `block_start.data.slewCenterS` (Warten auf den Plan zählt nicht)', () => {
    expect(m.slewCenterS).toEqual({ medianS: 31.5, n: 2, p25S: 29.8, p75S: 33.3 });
  });
});

describe('measuredOverheads – Ausreißer und Ausschlüsse', () => {
  const start = (hms: string, slewCenterS?: number) =>
    ev('block_start', hms, {
      blockId: hms,
      projectId: 'p',
      data: slewCenterS === undefined ? { kind: 'regular' } : { kind: 'regular', slewCenterS },
    });

  it('Anfahren über 30 min, mit Autofokus/Flip darin und ohne Dauer (Slew entfallen, Plugin < 0.4.19) verworfen', () => {
    const night: OverheadNight = {
      night: '2026-10-06',
      events: [
        start('01:00:00', 40), // zählt
        start('02:00:00'), // ohne Dauer
        start('03:00:00', 1900), // > 30 min
        start('04:00:00', 300), // Autofokus darin
        { ...ev('af', '04:04:00'), durationS: 200, data: { result: 'ok' } },
        start('05:00:00', 400), // Flip darin
        { ...ev('flip', '05:06:00'), durationS: 300 },
        start('06:00:00', 60), // zählt
      ],
      // Die erste Belichtung zählt nicht: das Plugin wartet danach ggf. auf den Plan.
      lights: [
        {
          startMs: at('06:05:00'),
          exposureS: 120,
          filter: 'L',
          blockId: '06:00:00',
          transit: false,
        },
      ],
    };
    const s = overheadSamples([night], opts).slewCenterS.map((x) => x.valueS);
    expect(s).toEqual([40, 60]);
  });

  it('Abstände > 10 min, negative und mit Ereignis dazwischen (Safety, Neuplanung) verworfen', () => {
    const lights = series('x', at('01:00:00'), 300, [5, 700, 5, 5, -2], () => 'L');
    const end2 = (lights[2]?.startMs ?? 0) + 300_000;
    const night: OverheadNight = {
      night: '2026-10-06',
      events: [
        { ...ev('safety_pause', '00:00:00'), atMs: end2 + 1000 },
        { ...ev('plan_rebuilt', '00:00:00'), atMs: (lights[3]?.startMs ?? 0) + 301_000 },
      ],
      lights,
    };
    const s = overheadSamples([night], { ...opts, ditherEnabled: false });
    expect(s.downloadS.map((x) => x.valueS)).toEqual([5]);
  });

  it('Dither alle 3 Belichtungen wie die Engine (Zähler ab Filterwechsel neu)', () => {
    // Abstände: 5 5 25 | 5 5 25 – ab Lichtern gleichen Filters; Download-Median 5 → Dither 20.
    const lights = series('y', at('01:00:00'), 60, [5, 5, 25, 5, 5, 25], () => 'L');
    const s = overheadSamples([{ night: '2026-10-06', events: [], lights }], {
      ...opts,
      ditherEvery: 3,
    });
    expect(s.downloadS.map((x) => x.valueS)).toEqual([5, 5, 5, 5]);
    expect(s.ditherSettleS.map((x) => x.valueS)).toEqual([20, 20]);
  });

  it('gescheiterter Autofokus zählt nicht', () => {
    const night: OverheadNight = {
      night: '2026-10-06',
      events: [
        { ...ev('af', '01:00:00'), durationS: 150, data: { result: 'failed', code: 'failed' } },
        { ...ev('af', '02:00:00'), durationS: 240, data: { result: 'ok' } },
      ],
      lights: [],
    };
    expect(overheadSamples([night], opts).afDurationS.map((x) => x.valueS)).toEqual([240]);
  });
});

describe('overheadStat – Median, p25/p75, rollierend 40', () => {
  it('lineare Interpolation', () => {
    const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v, i) => ({ atMs: i, valueS: v }));
    expect(overheadStat(samples)).toEqual({ medianS: 5.5, n: 10, p25S: 3.3, p75S: 7.8 });
  });

  it('nur die letzten 40 Messungen nach Zeit', () => {
    // 10 alte mit 1000 s, dann 40 neue mit 10 s → die alten fallen heraus.
    const samples = [
      ...Array.from({ length: 10 }, (_, i) => ({ atMs: i, valueS: 1000 })),
      ...Array.from({ length: 40 }, (_, i) => ({ atMs: 100 + i, valueS: 10 })),
    ].reverse();
    expect(overheadStat(samples)).toEqual({ medianS: 10, n: 40, p25S: 10, p75S: 10 });
  });

  it('ohne Messung null', () => {
    expect(overheadStat([])).toBeNull();
  });
});

describe('rigOverheads / effectiveScheduler – wirksame Werte', () => {
  const scheduler = {
    flipDurationS: 240,
    overhead: {
      slewCenterS: 120,
      filterChangeS: 10,
      ditherSettleS: 20,
      afEveryMin: 60,
      afDurationS: 180,
      downloadS: 5,
    },
    overheadFixed: ['afDurationS'],
  } satisfies Pick<SchedulerSettings, 'overhead' | 'flipDurationS' | 'overheadFixed'>;
  const stat = (medianS: number, n: number) => ({ medianS, n, p25S: medianS, p75S: medianS });
  const measured: MeasuredOverheads = {
    computedAtUtc: '2026-10-07T14:00:00Z',
    fromNight: '2026-09-08',
    toNight: '2026-10-06',
    nights: 3,
    values: {
      slewCenterS: stat(35.4, 12),
      filterChangeS: stat(9.5, MEASURED_MIN_SAMPLES - 1),
      ditherSettleS: stat(18.5, 40),
      afDurationS: stat(250, 20),
      downloadS: null,
      flipDurationS: stat(1080, 10),
    },
  };

  it('ab 10 Messungen gemessen (ganze Sekunden), darunter, ohne Messung oder „fest“ getippt', () => {
    const v = rigOverheads(scheduler, measured);
    const by = Object.fromEntries(v.values.map((x) => [x.key, x]));
    expect(by.slewCenterS).toMatchObject({ effectiveS: 35, source: 'measured', deviates: true });
    expect(by.filterChangeS).toMatchObject({ effectiveS: 10, source: 'typed', deviates: false });
    expect(by.ditherSettleS).toMatchObject({ effectiveS: 19, source: 'measured', deviates: false });
    expect(by.afDurationS).toMatchObject({ effectiveS: 180, source: 'typed', fixed: true });
    expect(by.downloadS).toMatchObject({ effectiveS: 5, source: 'typed', measured: null });
    expect(by.flipDurationS).toMatchObject({
      effectiveS: 1080,
      source: 'measured',
      deviates: true,
    });
    expect(v).toMatchObject({ minSamples: 10, nights: 3, toNight: '2026-10-06' });
  });

  it('Engine-Eingabe bekommt nur andere Zahlen; ohne Messung unverändert', () => {
    const eff = effectiveScheduler(scheduler, rigOverheads(scheduler, measured));
    expect(eff.flipDurationS).toBe(1080);
    expect(eff.overhead).toEqual({
      slewCenterS: 35,
      filterChangeS: 10,
      ditherSettleS: 19,
      afEveryMin: 60,
      afDurationS: 180,
      downloadS: 5,
    });
    expect(effectiveScheduler(scheduler, rigOverheads(scheduler, null))).toEqual(scheduler);
    expect(effectiveScheduler(scheduler, undefined)).toBe(scheduler);
  });
});
