/**
 * AP-35 (FA-FOL-06, FA-FOL-05): geplante Projekte der aktuellen Nacht aus der gespeicherten Prognose;
 * Zeilen „nur heute aus“ bleiben sichtbar (zum Wiedereinschalten), Projekte ohne Frames zählen als `idle`.
 */
import { describe, expect, it } from 'vitest';
import { tonightLines, tonightProjects } from '../src';
import { NGC281, NGC7000, projects, rig } from './fixtures/plan';

const ngc7000 = projects.find((p) => p.id === NGC7000);
const [l1, l2] = ngc7000?.panels[0]?.lines ?? [];

describe('tonightProjects', () => {
  it('Frames je Zeile und Projekt aus der Prognose, absteigend; ohne Frames → idle', () => {
    const r = tonightProjects(projects, rig.id, '2026-09-17', {
      lineFrames: { [l1?.id ?? '']: 12, [l2?.id ?? '']: 3 },
      projectHours: { [NGC7000]: 1.234 },
    });
    expect(r.projects.map((p) => [p.projectId, p.frames, p.hours])).toEqual([[NGC7000, 15, 1.23]]);
    expect(r.projects[0]?.lines.map((l) => [l.filter, l.frames, l.disabledTonight])).toEqual([
      [l1?.filterShortName, 12, false],
      [l2?.filterShortName, 3, false],
    ]);
    // NGC 281 ist freigegeben und aktiv, hat aber keine Frames in dieser Nacht.
    expect(r.projects.some((p) => p.projectId === NGC281)).toBe(false);
    expect(r.idle).toBeGreaterThanOrEqual(1);
  });

  it('„weitere aktive Projekte ohne Frames“ zählt nicht, was als läuft/abgearbeitet schon dasteht (07.10.2026)', () => {
    const usage = { lineFrames: { [l1?.id ?? '']: 12 }, projectHours: { [NGC7000]: 1 } };
    const all = tonightProjects(projects, rig.id, '2026-09-17', usage);
    const shown = tonightProjects(projects, rig.id, '2026-09-17', usage, new Set([NGC281]));
    expect(shown.projects).toEqual(all.projects);
    expect(shown.idle).toBe(all.idle - 1);
  });

  it('ohne gespeicherte Nacht: nichts geplant; „nur heute aus“ hält das Projekt in der Liste', () => {
    expect(tonightProjects(projects, rig.id, '2026-09-17', undefined).projects).toEqual([]);
    const off = projects.map((p) =>
      p.id === NGC7000
        ? {
            ...p,
            panels: p.panels.map((panel) => ({
              ...panel,
              lines: panel.lines.map((l) =>
                l.id === l1?.id ? { ...l, disabledForNight: '2026-09-17' } : l,
              ),
            })),
          }
        : p,
    );
    const p = tonightProjects(off, rig.id, '2026-09-17', undefined).projects[0];
    expect(p?.projectId).toBe(NGC7000);
    expect(p?.lines.find((l) => l.lineId === l1?.id)?.disabledTonight).toBe(true);
    // Nächste Nacht: wieder aktiv, kein Kennzeichen.
    const next = off.find((x) => x.id === NGC7000);
    expect(
      next && tonightLines(next, '2026-09-18', undefined).every((l) => !l.disabledTonight),
    ).toBe(true);
  });
});
