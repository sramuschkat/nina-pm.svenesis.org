/**
 * Reine Hilfen der Projektliste S-30 (AP-11c; FK 14.3, FA-PRJ-14/16/19): Filter (Rig, Objekttyp,
 * Ersteller, Freigabestatus, Projektstatus, Favoriten), Gruppen je Rig mit Zählern je Status und die
 * Reihenfolge (freigegebene Projekte nach Priorität, danach die übrigen nach Name).
 */
import type { ProjectListItem } from '../../api/client';

export interface ListFilters {
  readonly rigId: string;
  readonly targetType: string;
  readonly createdBy: string;
  readonly approvalStatus: string;
  readonly status: string;
  readonly favorites: boolean;
}

export const NO_FILTERS: ListFilters = {
  rigId: '',
  targetType: '',
  createdBy: '',
  approvalStatus: '',
  status: '',
  favorites: false,
};

/** Kennung der Gruppe ohne Rig (Entwürfe ohne Rig-Wunsch). */
export const NO_RIG = 'none';

export function filterProjects(
  items: readonly ProjectListItem[],
  f: ListFilters,
): ProjectListItem[] {
  return items.filter(
    (p) =>
      (!f.rigId || (p.rigId ?? NO_RIG) === f.rigId) &&
      (!f.targetType || (p.targetType ?? '') === f.targetType) &&
      (!f.createdBy || p.createdBy === f.createdBy) &&
      (!f.approvalStatus || p.approvalStatus === f.approvalStatus) &&
      (!f.status || p.status === f.status) &&
      (!f.favorites || p.favorite),
  );
}

/** Auswahlwerte der Filter aus der geladenen Liste. */
export function filterOptions(items: readonly ProjectListItem[]) {
  const types = [...new Set(items.map((p) => p.targetType).filter((x): x is string => !!x))];
  const creators = new Map(items.map((p) => [p.createdBy, p.createdByName]));
  return {
    targetTypes: types.sort((a, b) => a.localeCompare(b)),
    creators: [...creators.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Freigegebene zuerst nach Priorität (Priorität je Rig, FA-PRJ-13), dann die übrigen nach Name. */
export function sortInGroup(items: readonly ProjectListItem[]): ProjectListItem[] {
  const approved = items
    .filter((p) => p.approvalStatus === 'approved')
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  const others = items
    .filter((p) => p.approvalStatus !== 'approved')
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...approved, ...others];
}

export interface RigGroup {
  readonly rigId: string;
  readonly items: ProjectListItem[];
  /** Anzahl je Projektstatus bzw. – vor der Freigabe – je Freigabestatus. */
  readonly counts: { key: string; kind: 'project' | 'approval'; n: number }[];
}

/** Gruppen je Rig in der Reihenfolge der Rigs; Projekte ohne Rig zuletzt. */
export function groupByRig(
  items: readonly ProjectListItem[],
  rigOrder: readonly string[],
): RigGroup[] {
  const by = new Map<string, ProjectListItem[]>();
  for (const p of items) {
    const key = p.rigId ?? NO_RIG;
    by.set(key, [...(by.get(key) ?? []), p]);
  }
  const order = [
    ...rigOrder.filter((id) => by.has(id)),
    ...[...by.keys()].filter((k) => !rigOrder.includes(k) && k !== NO_RIG),
  ];
  if (by.has(NO_RIG)) order.push(NO_RIG);
  return order.map((rigId) => {
    const list = sortInGroup(by.get(rigId) ?? []);
    const counts = new Map<string, { key: string; kind: 'project' | 'approval'; n: number }>();
    for (const p of list) {
      const kind = p.status ? 'project' : 'approval';
      const key = p.status ?? p.approvalStatus;
      const c = counts.get(`${kind}:${key}`);
      counts.set(`${kind}:${key}`, { key, kind, n: (c?.n ?? 0) + 1 });
    }
    return { rigId, items: list, counts: [...counts.values()] };
  });
}

/** Neue Position (1-basiert) unter den freigegebenen Projekten des Rigs nach Verschieben um `delta`. */
export function movedPosition(
  group: readonly ProjectListItem[],
  id: string,
  delta: number,
): number | null {
  const approved = sortInGroup(group).filter((p) => p.approvalStatus === 'approved');
  const index = approved.findIndex((p) => p.id === id);
  if (index < 0) return null;
  const next = index + delta;
  if (next < 0 || next >= approved.length) return null;
  return next + 1;
}
