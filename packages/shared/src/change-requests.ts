/**
 * Änderungsanträge (AP-32b, FA-FRG-08): Gegenüberstellung alt/neu gegen die **aktuelle** Fassung und die
 * Fassung „mit Antrag“ (für Plan-Chips der Warteschlange und die Auswirkungsvorschau). Rein, ohne
 * Datenbank – Server und Oberfläche rechnen damit dasselbe.
 */
import type { z } from 'zod';
import type {
  ChangeRequestDiffEntry,
  StoredChangeRequestProposal,
} from './contracts/change-requests';
import type { ProjectView } from './contracts/projects';

type Project = z.infer<typeof ProjectView>;
type Line = Project['panels'][number]['lines'][number];

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Beschriftung einer Zeile: „Ha · 300 s“, bei Mosaik mit Panel. */
export function changeRequestLineLabel(
  project: Project,
  line: Pick<Line, 'filterShortName' | 'exposureS' | 'panelId'>,
) {
  const panel = project.panels.find((p) => p.id === line.panelId);
  const base = `${line.filterShortName} · ${String(line.exposureS)} s`;
  return project.panels.length > 1 && panel ? `${base} · ${panel.label}` : base;
}

/** Gegenüberstellung je geändertem Feld; `unchanged`, wenn die aktuelle Fassung schon dem Vorschlag entspricht. */
export function changeRequestDiff(
  project: Project,
  proposal: StoredChangeRequestProposal,
): ChangeRequestDiffEntry[] {
  const out: ChangeRequestDiffEntry[] = [];
  const field = (name: string, current: unknown, proposed: unknown) =>
    out.push({
      field: name,
      lineId: null,
      lineLabel: null,
      current: current ?? null,
      proposed: proposed ?? null,
      unchanged: same(current, proposed),
    });
  if (proposal.descriptionMd !== undefined)
    field('descriptionMd', project.descriptionMd, proposal.descriptionMd);
  if (proposal.startDate !== undefined) field('startDate', project.startDate, proposal.startDate);
  if (proposal.dueDate !== undefined) field('dueDate', project.dueDate, proposal.dueDate);
  for (const [k, v] of Object.entries(proposal.conditions ?? {}))
    field(`conditions.${k}`, (project.conditions as Record<string, unknown>)[k], v);
  const lines = new Map(project.panels.flatMap((p) => p.lines).map((l) => [l.id, l]));
  for (const change of proposal.lines) {
    const line = lines.get(change.lineId);
    const label = line ? changeRequestLineLabel(project, line) : null;
    for (const key of ['plannedCount', 'enabled'] as const) {
      if (change[key] === undefined) continue;
      const current = line ? line[key] : null;
      out.push({
        field: `line.${key}`,
        lineId: change.lineId,
        lineLabel: label,
        current,
        proposed: change[key],
        unchanged: same(current, change[key]),
      });
    }
  }
  for (const add of proposal.newLines) {
    const exists = lines.has(add.id);
    out.push({
      field: 'newLine',
      lineId: add.id,
      lineLabel: changeRequestLineLabel(project, {
        filterShortName: add.filterShortName ?? '?',
        exposureS: add.exposureS,
        panelId: add.panelId,
      }),
      current: null,
      proposed: { plannedCount: add.plannedCount, exposureS: add.exposureS, enabled: add.enabled },
      unchanged: exists,
    });
  }
  return out;
}

/**
 * Projekt „mit Antrag“: Felder, Bedingungen und Zeilen des Vorschlags übernommen, neue Zeilen ohne
 * Aufnahmen angehängt (Auswirkungsvorschau, Plan-Chips). Zeilen gelöschter Panels entfallen.
 */
export function applyChangeRequest(
  project: Project,
  proposal: StoredChangeRequestProposal,
): Project {
  const changes = new Map(proposal.lines.map((c) => [c.lineId, c]));
  const counters = (planned: number): Line['counters'] => ({
    planned,
    acquired: 0,
    rejected: 0,
    accepted: 0,
    remaining: planned,
    planningNeed: planned,
    bonus: 0,
    bonusRejected: 0,
    percentDone: 0,
    integrationS: 0,
  });
  const panels = project.panels.map((panel) => {
    const updated = panel.lines.map((l): Line => {
      const c = changes.get(l.id);
      if (!c) return l;
      const plannedCount = c.plannedCount ?? l.plannedCount;
      const remaining = Math.max(0, plannedCount - l.counters.accepted);
      return {
        ...l,
        plannedCount,
        enabled: c.enabled ?? l.enabled,
        counters: { ...l.counters, planned: plannedCount, remaining, planningNeed: remaining },
      };
    });
    const added = proposal.newLines
      .filter((a) => a.panelId === panel.id && !panel.lines.some((l) => l.id === a.id))
      .map((a, i): Line => ({
        id: a.id,
        panelId: a.panelId,
        filterId: a.filterId,
        filterShortName: a.filterShortName ?? '',
        exposureS: a.exposureS,
        plannedCount: a.plannedCount,
        gain: a.gain,
        offsetAdu: a.offsetAdu,
        binning: a.binning,
        readoutMode: a.readoutMode,
        disabledForNight: null,
        moonMode: a.moonMode,
        moonProfileId: a.moonProfileId,
        enabled: a.enabled,
        orderIndex: panel.lines.length + i,
        notes: a.notes,
        hasCaptures: false,
        counters: counters(a.plannedCount),
      }));
    return { ...panel, lines: [...updated, ...added] };
  });
  return {
    ...project,
    ...(proposal.descriptionMd !== undefined ? { descriptionMd: proposal.descriptionMd } : {}),
    ...(proposal.startDate !== undefined ? { startDate: proposal.startDate } : {}),
    ...(proposal.dueDate !== undefined ? { dueDate: proposal.dueDate } : {}),
    conditions: { ...project.conditions, ...(proposal.conditions ?? {}) },
    panels,
  };
}
