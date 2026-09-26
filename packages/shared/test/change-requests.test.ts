/**
 * Änderungsanträge (AP-32b, FA-FRG-08): Gegenüberstellung gegen die aktuelle Fassung (auch „inzwischen
 * gleich“), Fassung „mit Antrag“ (Zeilen, neue Zeile ohne Aufnahmen, Bedingungen, Zeitraum), Prüfung des
 * Vorschlags (mindestens eine Änderung, Ablehnen nur mit Kommentar).
 */
import { describe, expect, it } from 'vitest';
import {
  applyChangeRequest,
  ChangeRequestDecision,
  ChangeRequestProposal,
  changeRequestDiff,
  type StoredChangeRequestProposal,
} from '../src';
import { FILTER_OIII, NGC281, projects } from './fixtures/plan';

const ngc = projects.find((p) => p.id === NGC281);
if (!ngc) throw new Error('Fixture fehlt');
const panel = ngc.panels[0];
const line = panel?.lines[0];
if (!panel || !line) throw new Error('Fixture fehlt');
const NEW = '00000000-0000-4000-8000-000000009999';

const proposal: StoredChangeRequestProposal = {
  lines: [{ lineId: line.id, plannedCount: 60 }],
  newLines: [
    {
      id: NEW,
      panelId: panel.id,
      filterId: FILTER_OIII,
      filterShortName: 'OIII',
      exposureS: 300,
      plannedCount: 20,
      gain: null,
      offsetAdu: null,
      binning: 1,
      readoutMode: null,
      moonMode: 'none',
      moonProfileId: null,
      enabled: true,
      notes: '',
    },
  ],
  conditions: { minAltitudeDeg: ngc.conditions.minAltitudeDeg + 5 },
  dueDate: '2026-12-01',
};

describe('changeRequestDiff', () => {
  it('Einträge je beantragtem Feld gegen die aktuelle Fassung', () => {
    const diff = changeRequestDiff(ngc, proposal);
    expect(diff.map((d) => d.field)).toEqual([
      'dueDate',
      'conditions.minAltitudeDeg',
      'line.plannedCount',
      'newLine',
    ]);
    expect(diff[2]).toMatchObject({
      lineId: line.id,
      lineLabel: 'Ha · 300 s',
      current: line.plannedCount,
      proposed: 60,
      unchanged: false,
    });
    expect(diff[3]).toMatchObject({ lineLabel: 'OIII · 300 s', current: null, unchanged: false });
  });

  it('inzwischen gleich (vom Admin geändert): unchanged', () => {
    const changed = { ...ngc, dueDate: '2026-12-01' };
    expect(changeRequestDiff(changed, proposal)[0]).toMatchObject({
      field: 'dueDate',
      unchanged: true,
    });
  });
});

describe('applyChangeRequest', () => {
  it('übernimmt Zeilen, neue Zeile ohne Aufnahmen, Bedingungen und Zeitraum', () => {
    const p = applyChangeRequest(ngc, proposal);
    const lines = p.panels[0]?.lines ?? [];
    expect(lines.map((l) => [l.filterShortName, l.plannedCount])).toEqual([
      ['Ha', 60],
      ['OIII', 20],
    ]);
    expect(lines[0]?.counters.planningNeed).toBe(60 - line.counters.accepted);
    expect(lines[1]).toMatchObject({
      hasCaptures: false,
      counters: { accepted: 0, planningNeed: 20 },
    });
    expect(p.conditions.minAltitudeDeg).toBe(ngc.conditions.minAltitudeDeg + 5);
    expect(p.conditions.twilight).toBe(ngc.conditions.twilight);
    expect(p.dueDate).toBe('2026-12-01');
    expect(p.startDate).toBe(ngc.startDate);
    // Die aktuelle Fassung bleibt unverändert.
    expect(ngc.panels[0]?.lines).toHaveLength(1);
  });
});

describe('Verträge', () => {
  it('Antrag ohne Änderung wird abgelehnt; Ablehnen nur mit Kommentar', () => {
    expect(ChangeRequestProposal.safeParse({}).success).toBe(false);
    expect(ChangeRequestProposal.safeParse({ lines: [{ lineId: line.id }] }).success).toBe(false);
    expect(ChangeRequestProposal.safeParse({ dueDate: null }).success).toBe(true);
    expect(
      ChangeRequestDecision.safeParse({ decision: 'rejected', comment: null, projectVersion: 3 })
        .success,
    ).toBe(false);
    expect(
      ChangeRequestDecision.safeParse({ decision: 'approved', comment: null, projectVersion: 3 })
        .success,
    ).toBe(true);
  });
});
