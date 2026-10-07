/**
 * „Heute Nacht“ (AP-35; FA-FOL-06, FA-FOL-05). Rein: geplante Projekte eines Rigs für die aktuelle Nacht aus der
 * gespeicherten Prognose (Frames je Zeile, belegte Stunden je Projekt – Job `forecast`, AP-33) und die Zeilen,
 * die sich **nur für diese Nacht** abschalten lassen (`disabledForNight === night`).
 */
import type { z } from 'zod';
import type { ProjectView } from './contracts/projects';
import type { TonightLine, TonightProject } from './contracts/tonight';

type Project = z.infer<typeof ProjectView>;
type Line = z.infer<typeof TonightLine>;
type Planned = z.infer<typeof TonightProject>;

export interface TonightStoredNight {
  readonly lineFrames: Readonly<Record<string, number>>;
  readonly projectHours: Readonly<Record<string, number>>;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Aktive Zeilen (Panel und Zeile aktiv) mit Restbedarf oder mit „nur heute aus“ – nur diese lassen sich für
 * die Nacht umschalten; `frames` = erwartete Frames der Nacht laut Prognose.
 */
export function tonightLines(
  p: Project,
  night: string,
  lineFrames: Readonly<Record<string, number>> | undefined,
): Line[] {
  return p.panels
    .filter((panel) => panel.enabled)
    .flatMap((panel) => panel.lines)
    .filter((l) => l.enabled)
    .filter((l) => l.counters.remaining > 0 || l.disabledForNight === night)
    .map((l) => ({
      lineId: l.id,
      filter: l.filterShortName,
      frames: Math.max(0, Math.round(lineFrames?.[l.id] ?? 0)),
      disabledTonight: l.disabledForNight === night,
    }));
}

/**
 * Freigegebene, aktive Projekte des Rigs mit Frames in der Nacht oder mit einer nur heute abgeschalteten Zeile,
 * nach erwarteten Frames absteigend; die übrigen aktiven Projekte zählen als `idle` – außer denen in `shown`, die die
 * Seite schon anders zeigt (läuft an der Rig, abgearbeitet; sonst doppelt gezählt, 07.10.2026).
 */
export function tonightProjects(
  projects: readonly Project[],
  rigId: string,
  night: string,
  stored: TonightStoredNight | undefined,
  shown: ReadonlySet<string> = new Set(),
): { projects: Planned[]; idle: number } {
  const active = projects.filter(
    (p) =>
      p.rigId === rigId &&
      p.approvalStatus === 'approved' &&
      p.status === 'active' &&
      p.deletedAt === null,
  );
  const planned: Planned[] = [];
  let idle = 0;
  for (const p of active) {
    const lines = tonightLines(p, night, stored?.lineFrames);
    const frames = lines.reduce((s, l) => s + l.frames, 0);
    if (frames === 0 && !lines.some((l) => l.disabledTonight)) {
      if (!shown.has(p.id)) idle += 1;
      continue;
    }
    planned.push({
      projectId: p.id,
      name: p.name,
      createdBy: p.createdBy,
      priority: p.priority,
      frames,
      hours: round2(stored?.projectHours[p.id] ?? 0),
      lines,
    });
  }
  planned.sort((a, b) => b.frames - a.frames || a.name.localeCompare(b.name));
  return { projects: planned, idle };
}
