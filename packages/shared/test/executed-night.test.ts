/**
 * Ist einer Nacht (AP-53c, FA-SIM-10): Blöcke aus block_start/block_end bzw. – Plugin vor 0.4.13 – aus den Aufnahmen,
 * Filterabschnitte, leere Blöcke als eine Lücke, Leerlauf/Safety/Übersprungenes/Flip, Zähler, laufender Block.
 * Beispielnacht wie 06./07.10.2026: Transit mit Serie, transit_interrupt-Schleife, IC 1795 mit Flip.
 */
import { describe, expect, it } from 'vitest';
import { ExecutedNight, executedNight, type ActualEventRow, type ActualLightRow } from '../src';

const P_TRANSIT = '11111111-1111-4111-8111-111111111111';
const P_IC = '22222222-2222-4222-8222-222222222222';
const B_TRANSIT = '33333333-3333-4333-8333-333333333333';
const B_IC = '44444444-4444-4444-8444-444444444444';
const PLAN = '55555555-5555-4555-8555-555555555555';
const at = (hhmm: string, day = 7) => `2026-10-0${day}T${hhmm}Z`;
const ev = (
  occurredAt: string,
  kind: string,
  extra: Partial<ActualEventRow> = {},
): ActualEventRow => ({
  occurredAt,
  kind,
  blockId: null,
  projectId: null,
  nightPlanId: PLAN,
  durationS: null,
  data: null,
  ...extra,
});
const light = (
  capturedAt: string,
  filter: string,
  exposureS: number,
  blockId: string | null,
  projectId: string,
  result = 'saved',
): ActualLightRow => ({
  capturedAt,
  exposureS,
  result,
  filter,
  blockId,
  projectId,
  panelId: null,
  nightPlanId: PLAN,
});
const names = new Map([
  [P_TRANSIT, 'WASP-3b'],
  [P_IC, 'IC 1795'],
]);

function night(now = at('08:40:00'), running = true) {
  const events: ActualEventRow[] = [
    ev(at('00:30:00'), 'plan_built', { data: { revision: 1, reason: 'initial' } }),
    ev(at('01:05:00'), 'block_start', {
      blockId: B_TRANSIT,
      projectId: P_TRANSIT,
      data: { kind: 'transit', title: 'WASP-3b' },
    }),
    ev(at('05:54:39'), 'block_end', {
      blockId: B_TRANSIT,
      projectId: P_TRANSIT,
      data: { code: 'completed', exposures: 3 },
    }),
  ];
  // transit_interrupt-Schleife: drei leere Blöcke in Folge.
  for (let k = 0; k < 3; k++) {
    const id = `66666666-6666-4666-8666-66666666666${k}`;
    events.push(
      ev(at(`05:55:${10 + k * 20}`), 'block_start', {
        blockId: id,
        projectId: P_TRANSIT,
        data: { kind: 'transit' },
      }),
    );
    events.push(
      ev(at(`05:55:${15 + k * 20}`), 'block_end', {
        blockId: id,
        projectId: P_TRANSIT,
        data: { code: 'transit_interrupt' },
      }),
    );
  }
  events.push(
    ev(at('06:07:00'), 'plan_rebuilt', { data: { revision: 2, reason: 'refresh' } }),
    ev(at('06:07:00'), 'block_start', {
      blockId: B_IC,
      projectId: P_IC,
      data: { kind: 'regular', title: 'IC 1795' },
    }),
    ev(at('08:20:00'), 'flip', { blockId: B_IC, projectId: P_IC, durationS: 780 }),
    ev(at('08:30:00'), 'skipped_timeaware', {
      blockId: B_IC,
      projectId: P_IC,
      data: { code: 'late', seq: 9 },
    }),
  );
  const lights = [
    light(at('01:11:30'), 'R', 30, B_TRANSIT, P_TRANSIT),
    light(at('01:12:05'), 'R', 30, B_TRANSIT, P_TRANSIT),
    light(at('01:12:40'), 'R', 30, B_TRANSIT, P_TRANSIT),
    light(at('06:09:00'), 'Ha', 300, B_IC, P_IC),
    light(at('06:14:10'), 'Ha', 300, B_IC, P_IC, 'failed'),
    light(at('07:41:00'), 'OIII', 300, B_IC, P_IC),
  ];
  return executedNight({ night: '2026-10-06', sessions: 1, events, lights, running, now, names });
}

describe('executedNight', () => {
  it('Blöcke, Filterabschnitte und Zähler; die transit_interrupt-Schleife ist eine Lücke', () => {
    const n = night();
    expect(ExecutedNight.parse(n)).toEqual(n);
    expect(n.blocks.map((b) => [b.title, b.kind, b.exposures, b.running])).toEqual([
      ['WASP-3b', 'transit', 3, false],
      ['IC 1795', 'regular', 2, true],
    ]);
    expect(n.blocks[0]).toMatchObject({
      startUtc: at('01:05:00'),
      endUtc: at('05:54:39'),
      endReason: 'completed',
    });
    expect(n.blocks[1]?.endUtc).toBeNull();
    const empty = n.gaps.find((g) => g.kind === 'empty_blocks');
    expect(empty).toEqual({
      kind: 'empty_blocks',
      fromUtc: at('05:55:10'),
      toUtc: at('05:55:55'),
      reason: 'transit_interrupt',
      count: 3,
    });
    expect(n.gaps.find((g) => g.kind === 'flip')).toMatchObject({
      fromUtc: at('08:07:00'),
      toUtc: at('08:20:00'),
    });
    // Zwischen Lücke und IC 1795 liegen 11 min ohne Block: Leerlauf.
    expect(n.gaps.find((g) => g.kind === 'idle')).toMatchObject({
      fromUtc: at('05:55:55'),
      toUtc: at('06:07:00'),
    });
    expect(n.segments.map((s) => [s.filter, s.saved, s.failed])).toEqual([
      ['R', 3, 0],
      ['Ha', 1, 1],
      ['OIII', 1, 0],
    ]);
    expect(n.segments[0]).toMatchObject({ startUtc: at('01:11:30'), endUtc: at('01:13:10') });
    expect(n.counters).toEqual({ saved: 5, skipped: 1, failed: 1 });
    expect(n.events.map((e) => [e.kind, e.revision ?? e.code])).toEqual([
      ['plan_built', 1],
      ['plan_rebuilt', 2],
      ['flip', null],
      ['skipped_timeaware', 'late'],
    ]);
  });

  it('ohne laufende Session bzw. nach 30 min ohne Aktivität endet der offene Block mit der letzten Aktivität', () => {
    const done = night(at('09:00:00'), false);
    expect(done.blocks[1]).toMatchObject({ running: false, endUtc: at('08:30:00') }); // übersprungene Belichtung
    const stale = night(at('08:30:00', 8), true);
    expect(stale.blocks[1]?.running).toBe(false);
  });

  it('Plugin vor 0.4.13 ohne Block-Ereignisse: Blöcke aus den Aufnahmen, Art aus dem Plan', () => {
    const n = executedNight({
      night: '2026-10-06',
      sessions: 1,
      events: [],
      lights: [
        light(at('01:11:30'), 'R', 30, B_TRANSIT, P_TRANSIT),
        light(at('04:00:00'), 'R', 30, B_TRANSIT, P_TRANSIT),
      ],
      running: false,
      now: at('09:00:00'),
      names,
      blockKinds: new Map([[B_TRANSIT, 'transit']]),
    });
    expect(n.blocks).toEqual([
      expect.objectContaining({
        title: 'WASP-3b',
        kind: 'transit',
        startUtc: at('01:11:30'),
        endUtc: at('04:00:30'),
        exposures: 2,
      }),
    ]);
    // Pause > 15 min: zwei Filterabschnitte.
    expect(n.segments).toHaveLength(2);
  });

  it('Plugin vor 0.4.13: der zuletzt begonnene Block aus den Aufnahmen läuft bei laufender Session weiter', () => {
    const opts = {
      night: '2026-10-06',
      sessions: 1,
      events: [],
      lights: [
        light(at('01:11:30'), 'R', 30, B_TRANSIT, P_TRANSIT),
        light(at('04:00:00'), 'R', 30, B_TRANSIT, P_TRANSIT),
        light(at('06:10:00', 7), 'OIII', 600, B_IC, P_IC),
        light(at('09:45:00'), 'OIII', 600, B_IC, P_IC),
      ],
      names,
      blockKinds: new Map([[B_TRANSIT, 'transit' as const]]),
    };
    // 05:01 CDT: letzte Aufnahme endete 09:55 UTC, Session läuft – IC 1795 läuft noch (Rest des Plans bleibt sichtbar).
    const n = executedNight({ ...opts, running: true, now: at('10:01:00') });
    expect(n.blocks.map((b) => [b.title, b.running, b.endUtc])).toEqual([
      ['WASP-3b', false, at('04:00:30')],
      ['IC 1795', true, null],
    ]);
    // Ohne Aktivität seit 30 min bzw. ohne laufende Session: abgeschlossen.
    expect(
      executedNight({ ...opts, running: true, now: at('10:40:00') }).blocks.at(-1)?.running,
    ).toBe(false);
    expect(
      executedNight({ ...opts, running: false, now: at('10:01:00') }).blocks.at(-1)?.running,
    ).toBe(false);
  });

  it('Plugin vor 0.4.13: Anfahren/Autofokus vor der ersten Aufnahme ist kein Leerlauf – Beginn laut gespeichertem Plan', () => {
    // 07.10.2026: der aus Aufnahmen abgeleitete Block begann erst mit der ersten Aufnahme; Slew + Autofokus davor stand
    // als rote Lücke „Leerlauf“ da.
    const opts = {
      night: '2026-10-06',
      sessions: 1,
      events: [],
      lights: [
        light(at('01:00:00'), 'R', 30, B_TRANSIT, P_TRANSIT),
        light(at('03:00:00'), 'R', 30, B_TRANSIT, P_TRANSIT),
        light(at('03:09:00'), 'OIII', 600, B_IC, P_IC),
        light(at('04:00:00'), 'OIII', 600, B_IC, P_IC),
      ],
      running: false,
      now: at('09:00:00'),
      names,
    };
    // Ohne Plan: 6 min Leerlauf zwischen 03:00:30 und 03:09.
    expect(executedNight(opts).gaps).toEqual([expect.objectContaining({ kind: 'idle' })]);
    const n = executedNight({
      ...opts,
      blockStarts: new Map([
        [B_IC, at('03:01:00')],
        // Weit vor der ersten Aufnahme bzw. im vorigen Block: höchstens 20 min, nie vor dessen Ende.
        [B_TRANSIT, at('00:00:00')],
      ]),
    });
    expect(n.blocks.map((b) => b.startUtc)).toEqual([at('00:40:00'), at('03:01:00')]);
    expect(n.gaps).toEqual([]);
  });

  it('Safety-Pause und übersprungene Blöcke benennen die Lücke', () => {
    const B2 = '77777777-7777-4777-8777-777777777777';
    const n = executedNight({
      night: '2026-10-06',
      sessions: 2,
      events: [
        ev(at('01:00:00'), 'block_start', { blockId: B_IC, projectId: P_IC }),
        ev(at('02:00:00'), 'block_end', {
          blockId: B_IC,
          projectId: P_IC,
          data: { code: 'interrupted' },
        }),
        ev(at('02:00:00'), 'safety_pause'),
        ev(at('02:40:00'), 'safety_resume'),
        ev(at('02:41:00'), 'block_start', { blockId: B2, projectId: P_IC }),
        ev(at('03:00:00'), 'block_end', {
          blockId: B2,
          projectId: P_IC,
          data: { code: 'completed' },
        }),
        ev(at('03:10:00'), 'block_skipped', {
          blockId: B_TRANSIT,
          projectId: P_TRANSIT,
          data: { code: 'center_failed' },
        }),
        ev(at('03:30:00'), 'block_start', { blockId: B_TRANSIT, projectId: P_TRANSIT }),
        ev(at('04:00:00'), 'block_end', {
          blockId: B_TRANSIT,
          projectId: P_TRANSIT,
          data: { code: 'completed' },
        }),
      ],
      lights: [
        light(at('01:10:00'), 'Ha', 300, B_IC, P_IC),
        light(at('02:45:00'), 'Ha', 300, B2, P_IC),
        light(at('03:35:00'), 'R', 30, B_TRANSIT, P_TRANSIT),
      ],
      running: false,
      now: at('09:00:00'),
      names,
    });
    expect(n.gaps.map((g) => [g.kind, g.fromUtc, g.toUtc, g.reason, g.count])).toEqual([
      ['safety', at('02:00:00'), at('02:41:00'), null, 1],
      ['skipped', at('03:00:00'), at('03:30:00'), 'center_failed', 1],
    ]);
    expect(n.sessions).toBe(2);
  });

  it('wiederholter Planabruf mit derselben Revision (Server verwendet sie wieder) → nur eine Markierung (Analyse 07.10.2026)', () => {
    const OTHER = '77777777-7777-4777-8777-777777777777';
    const n = executedNight({
      night: '2026-10-06',
      sessions: 1,
      events: [
        ev(at('00:30:00'), 'plan_built', { data: { revision: 1, reason: 'initial' } }),
        ev(at('00:35:00'), 'plan_built', { data: { revision: 1, reason: 'refresh' } }),
        ev(at('00:40:00'), 'plan_built', { data: { revision: 1, reason: 'refresh' } }),
        ev(at('00:45:00'), 'plan_rebuilt', {
          nightPlanId: OTHER,
          data: { revision: 2, reason: 'refresh' },
        }),
        ev(at('00:50:00'), 'plan_built', {
          nightPlanId: OTHER,
          data: { revision: 2, reason: 'refresh' },
        }),
      ],
      lights: [],
      running: true,
      now: at('01:00:00'),
      names,
    });
    expect(n.events.map((e) => [e.kind, e.atUtc, e.revision])).toEqual([
      ['plan_built', at('00:30:00'), 1],
      ['plan_rebuilt', at('00:45:00'), 2],
    ]);
  });
});

describe('executedNight – Rig-Nacht 09./10.10.2026', () => {
  it('einzelner kurzer leerer Block bleibt ein Block mit 0 Aufnahmen; Autofokus trägt seinen Filter', () => {
    const B_EMPTY = '77777777-7777-4777-8777-777777777777';
    const events = [
      ev(at('06:58:34', 9), 'block_start', {
        blockId: B_EMPTY,
        projectId: P_IC,
        data: { kind: 'regular', title: 'LDN 1228' },
      }),
      ev(at('06:59:21', 9), 'block_end', {
        blockId: B_EMPTY,
        projectId: P_IC,
        data: { code: 'completed' },
      }),
      ev(at('07:05:37', 9), 'af', {
        blockId: B_IC,
        projectId: P_IC,
        durationS: 318,
        data: { result: 'ok', filter: 'SII' },
      }),
    ];
    const x = executedNight({
      night: '2026-10-09',
      sessions: 1,
      events,
      lights: [],
      running: false,
      now: at('12:00:00', 9),
      names,
    });
    expect(x.blocks).toEqual([
      expect.objectContaining({ blockId: B_EMPTY, exposures: 0, running: false }),
    ]);
    expect(x.gaps.filter((g) => g.kind === 'empty_blocks')).toEqual([]);
    expect(x.events).toEqual([
      expect.objectContaining({ kind: 'af', filter: 'SII', durationS: 318 }),
    ]);
    // Die transit_interrupt-Schleife bleibt eine Lücke, ihre Blöcke stehen nicht einzeln da.
    const loop = night();
    expect(loop.blocks.some((b) => b.exposures === 0)).toBe(false);
    expect(loop.gaps.filter((g) => g.kind === 'empty_blocks')).toHaveLength(1);
  });
});
