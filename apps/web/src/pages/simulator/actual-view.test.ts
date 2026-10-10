/**
 * Ist + Plan im Web (AP-53c): Nummerierung je Belichtungszeile über die ganze Nacht (Analyse 07.10.2026) – vorher standen
 * die Ist-Zeilen ohne Nr. und das Geplante begann wieder bei 1. Rig-Nacht 07./08.10.2026: die laufende Belichtung fehlte
 * (Nr. um eins verschoben), der Laufzeiger stand am Blockstart, Höhe und Mond waren leer.
 */
import type { ExecutedNight, StoredPlan } from '@nina-pm/shared';
import { describe, expect, it } from 'vitest';
import { actualView, upcomingEntries, type StoredBlock } from './actual-view';

const P = '0190c3f4-0000-7000-8000-0000000000c1';
const B1 = '0190c3f4-0000-7000-8000-0000000000c2';
const B2 = '0190c3f4-0000-7000-8000-0000000000c3';
const LINE = '0190c3f4-0000-7000-8000-0000000000c4';
const NOW = Date.parse('2026-09-18T05:00:00Z');

const expose = (seq: number, atUtc: string) => ({
  seq,
  cmd: 'expose',
  atUtc,
  exposureLineId: LINE,
  filter: 'Ha',
  exposureS: 300,
  gain: 100,
  offset: 20,
  binning: 1,
  readoutMode: null,
  bonus: false,
  lastOfNight: false,
});

const executed: ExecutedNight = {
  night: '2026-09-17',
  sessions: 1,
  blocks: [
    {
      blockId: B1,
      nightPlanId: null,
      projectId: P,
      panelId: null,
      title: 'NGC 281',
      kind: 'regular',
      startUtc: '2026-09-18T03:00:00Z',
      endUtc: '2026-09-18T04:00:00Z',
      endReason: 'completed',
      exposures: 5,
      running: false,
    },
  ],
  segments: [
    {
      blockId: B1,
      projectId: P,
      filter: 'Ha',
      startUtc: '2026-09-18T03:05:00Z',
      endUtc: '2026-09-18T03:20:00Z',
      saved: 3,
      failed: 1,
      exposureS: 300,
    },
    {
      blockId: B1,
      projectId: P,
      filter: 'Ha',
      startUtc: '2026-09-18T03:40:00Z',
      endUtc: '2026-09-18T03:50:00Z',
      saved: 2,
      failed: 0,
      exposureS: 300,
    },
  ],
  events: [],
  gaps: [],
  counters: { saved: 5, skipped: 0, failed: 1 },
};

const stored = {
  nightPlanId: '0190c3f4-0000-7000-8000-0000000000c0',
  revision: 2,
  reason: 'refresh',
  createdAtUtc: '2026-09-18T02:00:00Z',
  stale: false,
  staleCause: null,
  blocks: [
    {
      id: B2,
      kind: 'regular',
      projectId: P,
      panelId: null,
      transitObservationId: null,
      startUtc: '2026-09-18T05:10:00Z',
      endUtc: '2026-09-18T06:00:00Z',
      twilightEndUtc: null,
      raDeg: 13.2,
      decDeg: 56.6,
      rotationDeg: 0,
      rotationMode: 'fixed_camera',
      meridianFlip: null,
      entries: [
        expose(1, '2026-09-18T05:12:00Z'),
        expose(2, '2026-09-18T05:17:00Z'),
        { seq: 3, cmd: 'end', atUtc: '2026-09-18T06:00:00Z' },
      ],
    },
  ],
} as unknown as StoredPlan;

describe('actualView', () => {
  it('nummeriert je Belichtungszeile: Ist-Abschnitte mit ihrer letzten Nr., Geplantes zählt weiter', () => {
    const v = actualView({
      executed,
      stored,
      first: null,
      nowMs: NOW,
      running: true,
      computed: { blocks: [], filterBars: [], protocol: [] },
      colorOfProject: () => 'var(--npm-chart-series-1)',
      filterColor: () => 'var(--npm-chart-marker)',
      names: new Map([[P, 'NGC 281']]),
      gapLabel: () => '',
    });
    const exposes = (v?.protocol ?? []).filter((r) => r.cmd === 'expose');
    expect(exposes.map((r) => [r.actual?.state, r.no])).toEqual([
      ['saved', 3],
      ['saved', 5],
      ['planned', 6],
      ['planned', 7],
    ]);
  });

  it('zeigt die laufende Planzeile mit Laufzeiger, Nr. und Himmelsspalten; der Blockstart ist erledigt', () => {
    const run: ExecutedNight = {
      ...executed,
      blocks: [
        ...executed.blocks,
        {
          blockId: B2,
          nightPlanId: null,
          projectId: P,
          panelId: null,
          title: 'NGC 281',
          kind: 'regular',
          startUtc: '2026-09-18T04:50:00Z',
          endUtc: null,
          endReason: null,
          exposures: 1,
          running: true,
        },
      ],
      segments: [
        ...executed.segments,
        {
          blockId: B2,
          projectId: P,
          filter: 'Ha',
          startUtc: '2026-09-18T04:52:00Z',
          endUtc: '2026-09-18T04:57:00Z',
          saved: 1,
          failed: 0,
          exposureS: 300,
        },
      ],
      counters: { saved: 6, skipped: 0, failed: 1 },
    } as ExecutedNight;
    const plan = {
      ...stored,
      blocks: [
        {
          ...(stored.blocks[0] as object),
          startUtc: '2026-09-18T04:50:00Z',
          entries: [
            { seq: 1, cmd: 'slew_center', atUtc: '2026-09-18T04:50:00Z', durationS: 90 },
            expose(2, '2026-09-18T04:52:00Z'),
            expose(3, '2026-09-18T04:57:30Z'),
            { seq: 4, cmd: 'dither', atUtc: '2026-09-18T05:02:30Z', durationS: 18 },
            expose(5, '2026-09-18T05:02:48Z'),
            { seq: 6, cmd: 'end', atUtc: '2026-09-18T06:00:00Z' },
          ],
        },
      ],
    } as unknown as StoredPlan;
    const v = actualView({
      executed: run,
      stored: plan,
      first: null,
      nowMs: NOW,
      running: true,
      computed: { blocks: [], filterBars: [], protocol: [] },
      colorOfProject: () => 'var(--npm-chart-series-1)',
      filterColor: () => 'var(--npm-chart-marker)',
      names: new Map([[P, 'NGC 281']]),
      gapLabel: () => '',
      sky: (_b, e) => ({
        altDeg: e.atUtc === '2026-09-18T04:57:30Z' ? 61.5 : 60,
        moonSepDeg: 90,
        dark: true,
        moonOk: e.cmd === 'expose' ? true : null,
        requiredSepDeg: null,
        la: e.cmd === 'expose' ? false : null,
        moonProfile: '',
      }),
    });
    const rows = v?.protocol ?? [];
    expect(rows.filter((r) => r.actual?.state === 'running').map((r) => [r.cmd, r.atUtc])).toEqual([
      ['expose', '2026-09-18T04:57:30Z'],
    ]);
    expect(rows.find((r) => r.key === `ist:${B2}:start`)?.actual?.state).toBe('done');
    const ahead = rows.filter((r) => !r.actual?.past);
    expect(ahead.map((r) => [r.cmd, r.no, r.actual?.state])).toEqual([
      ['expose', 7, 'running'],
      ['dither', null, 'planned'],
      ['expose', 8, 'planned'],
      ['end', null, 'planned'],
    ]);
    expect(ahead[0]?.altDeg).toBe(61.5);
    expect(ahead[0]?.moonOk).toBe(true);
  });

  it('Rig liegt zurück: laufend ist die nächste Belichtung nach dem Ist, ab dem Ende der letzten Aufnahme', () => {
    // Sammelliste 08.10.2026, Punkt 6: SII 2 stand mit der Planzeit 01:00:53 da, tatsächlich lief sie ab ≈ 01:09:40.
    const run: ExecutedNight = {
      ...executed,
      blocks: [
        ...executed.blocks,
        {
          blockId: B2,
          nightPlanId: null,
          projectId: P,
          panelId: null,
          title: 'NGC 281',
          kind: 'regular',
          startUtc: '2026-09-18T04:50:00Z',
          endUtc: null,
          endReason: null,
          exposures: 2,
          running: true,
        },
      ],
      segments: [
        ...executed.segments,
        {
          blockId: B2,
          projectId: P,
          filter: 'Ha',
          startUtc: '2026-09-18T04:55:00Z',
          endUtc: '2026-09-18T05:08:00Z',
          saved: 2,
          failed: 0,
          exposureS: 300,
        },
      ],
    } as ExecutedNight;
    const plan = {
      ...stored,
      blocks: [
        {
          ...(stored.blocks[0] as object),
          startUtc: '2026-09-18T04:50:00Z',
          entries: [
            { seq: 1, cmd: 'slew_center', atUtc: '2026-09-18T04:50:00Z', durationS: 90 },
            expose(2, '2026-09-18T04:52:00Z'),
            expose(3, '2026-09-18T04:57:30Z'),
            { seq: 4, cmd: 'dither', atUtc: '2026-09-18T05:02:30Z', durationS: 18 },
            expose(5, '2026-09-18T05:02:48Z'),
            { seq: 6, cmd: 'dither', atUtc: '2026-09-18T05:07:48Z', durationS: 18 },
            expose(7, '2026-09-18T05:08:06Z'),
            { seq: 8, cmd: 'end', atUtc: '2026-09-18T06:00:00Z' },
          ],
        },
      ],
    } as unknown as StoredPlan;
    const v = actualView({
      executed: run,
      stored: plan,
      first: null,
      nowMs: Date.parse('2026-09-18T05:10:00Z'),
      running: true,
      computed: { blocks: [], filterBars: [], protocol: [] },
      colorOfProject: () => 'var(--npm-chart-series-1)',
      filterColor: () => 'var(--npm-chart-marker)',
      names: new Map([[P, 'NGC 281']]),
      gapLabel: () => '',
    });
    const ahead = (v?.protocol ?? []).filter((r) => !r.actual?.past);
    // Verzug 05:08:00 − 05:02:48 = 312 s: Belichtung 5 läuft ab 05:08, Dither und Belichtung 7 verschoben.
    expect(ahead.map((r) => [r.cmd, r.atUtc, r.actual?.state])).toEqual([
      ['expose', '2026-09-18T05:08:00.000Z', 'running'],
      ['dither', '2026-09-18T05:13:00.000Z', 'planned'],
      ['expose', '2026-09-18T05:13:18.000Z', 'planned'],
      ['end', '2026-09-18T06:00:00Z', 'planned'],
    ]);
  });

  it('Blockstart trägt den Laufzeiger, solange noch nichts gespeichert ist und keine Planzeile läuft', () => {
    const v = actualView({
      executed: {
        ...executed,
        blocks: [
          {
            ...executed.blocks[0],
            blockId: null,
            startUtc: '2026-09-18T04:58:00Z',
            endUtc: null,
            exposures: 0,
            running: true,
          },
        ],
        segments: [],
      } as ExecutedNight,
      stored: null,
      first: null,
      nowMs: NOW,
      running: true,
      computed: { blocks: [], filterBars: [], protocol: [] },
      colorOfProject: () => 'var(--npm-chart-series-1)',
      filterColor: () => 'var(--npm-chart-marker)',
      names: new Map([[P, 'NGC 281']]),
      gapLabel: () => '',
    });
    expect(v?.protocol.filter((r) => r.actual?.state === 'running').map((r) => r.cmd)).toEqual([
      'slew_center',
    ]);
  });
});

/**
 * Rig-Nacht 09./10.10.2026 (LDN 1228, G 180 s): Das Rig lag 5:16 min zurück; das Web schob G 35/36 hinter das Blockende,
 * G 36 stand um 02:01:41 mitten im Folgeblock (IC 5146). Das Plugin nimmt eine Belichtung nur, wenn sie bis Blockende
 * + 60 s fertig ist; ein geplanter Autofokus kurz nach dem Autofokus des Filterwechsels entfällt (`AF_SKIPPED recent`).
 */
describe('upcomingEntries (Rig liegt zurück)', () => {
  const g = (seq: number, atUtc: string) => ({
    ...expose(seq, atUtc),
    filter: 'G',
    exposureS: 180,
  });
  const block = (extra: StoredBlock['entries'] = []): StoredBlock => ({
    id: B2,
    kind: 'regular',
    projectId: P,
    startUtc: '2026-10-10T06:00:00Z',
    endUtc: '2026-10-10T07:00:10Z',
    raDeg: 314.5,
    decDeg: 78.6,
    rotationDeg: 0,
    entries: [
      g(1, '2026-10-10T06:41:00Z'),
      g(2, '2026-10-10T06:44:05Z'),
      ...extra,
      { seq: 3, cmd: 'dither', atUtc: '2026-10-10T06:47:10Z', durationS: 19 },
      g(4, '2026-10-10T06:47:29Z'),
      g(5, '2026-10-10T06:50:34Z'),
      { seq: 6, cmd: 'dither', atUtc: '2026-10-10T06:53:39Z', durationS: 19 },
      g(7, '2026-10-10T06:53:58Z'),
      g(8, '2026-10-10T06:57:03Z'),
      { seq: 9, cmd: 'end', atUtc: '2026-10-10T07:00:10Z' },
    ],
  });
  const iso = (x: { at: number }) => new Date(x.at * 1000).toISOString().slice(11, 19);

  it('Belichtungen, die nicht bis Blockende + 60 s fertig werden, entfallen – nichts landet hinter dem Blockende', () => {
    const items = upcomingEntries(block(), { seq: 1, delayS: 316 }, null, 0);
    const planned = items.filter((x) => x.state === 'planned');
    expect(planned.map((x) => x.entry.seq)).toEqual([1, 2, 3, 4, 5, 9]);
    // Nach der letzten passenden Belichtung kein Dither mehr; Ende bleibt fest.
    expect(planned.find((x) => x.entry.seq === 9)?.at).toBe(
      Date.parse('2026-10-10T07:00:10Z') / 1000,
    );
    expect(iso(planned.find((x) => x.entry.seq === 5) ?? { at: 0 })).toBe('06:55:50');
    const note = items.find((x) => x.reason === 'block_end');
    expect(note).toMatchObject({ state: 'skipped', count: 2, entry: { filter: 'G' } });
    // Kein Eintrag nach dem Blockende.
    expect(Math.max(...items.map((x) => x.at))).toBeLessThanOrEqual(
      Date.parse('2026-10-10T07:00:10Z') / 1000,
    );
    // Hinweis vor „Ende“.
    expect(items.indexOf(note as (typeof items)[number])).toBeLessThan(
      items.findIndex((x) => x.entry.cmd === 'end'),
    );
  });

  it('pünktlich: nichts entfällt, Zeiten unverändert', () => {
    const items = upcomingEntries(block(), null, null, 0);
    expect(items.every((x) => x.state === 'planned' && !x.shifted)).toBe(true);
    expect(items).toHaveLength(9);
  });

  it('geplanter Autofokus kurz nach einem Autofokus entfällt und verschiebt nichts', () => {
    const af = { seq: 21, cmd: 'autofocus_hint', atUtc: '2026-10-10T06:47:10Z', durationS: 124 };
    const lastAf = Date.parse('2026-10-10T06:44:00Z') / 1000;
    const items = upcomingEntries(block([af]), { seq: 1, delayS: 316 }, lastAf, 60);
    expect(items.find((x) => x.entry.seq === 21)).toMatchObject({
      state: 'skipped',
      reason: 'af_recent',
    });
    // Verzug danach 316 − 124 = 192 s: G 5 um 06:53:46 statt 06:55:50.
    expect(iso(items.find((x) => x.entry.seq === 5) ?? { at: 0 })).toBe('06:53:46');
    // Autofokus lange nach dem letzten: bleibt geplant.
    const later = upcomingEntries(block([af]), { seq: 1, delayS: 316 }, lastAf - 3600, 60);
    expect(later.find((x) => x.entry.seq === 21)?.state).toBe('planned');
  });

  it('Ist + Plan: Flats-Zeile; entfallene Belichtungen nicht im Folgeblock', () => {
    const v = actualView({
      executed,
      stored,
      first: null,
      nowMs: NOW,
      running: true,
      computed: { blocks: [], filterBars: [], protocol: [] },
      colorOfProject: () => 'var(--npm-chart-series-1)',
      filterColor: () => 'var(--npm-chart-marker)',
      names: new Map([[P, 'NGC 281']]),
      gapLabel: () => '',
      flatsAtUtc: '2026-09-18T11:16:00Z',
    });
    const last = v?.protocol[v.protocol.length - 1];
    expect(last).toMatchObject({ cmd: 'flats', atUtc: '2026-09-18T11:16:00Z' });
    expect(last?.actual?.state).toBe('planned');
  });
});
