/**
 * Ist + Plan im Web (AP-53c): Nummerierung je Belichtungszeile über die ganze Nacht (Analyse 07.10.2026) – vorher standen
 * die Ist-Zeilen ohne Nr. und das Geplante begann wieder bei 1.
 */
import type { ExecutedNight, StoredPlan } from '@nina-pm/shared';
import { describe, expect, it } from 'vitest';
import { actualView } from './actual-view';

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
});
