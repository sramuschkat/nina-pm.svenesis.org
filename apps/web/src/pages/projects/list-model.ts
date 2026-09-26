/**
 * Reine Hilfen der Projektliste S-30 (AP-11c; FK 14.3, FA-PRJ-14/16/19): Filter (Suche, Rig, Objekttyp,
 * Ersteller, Freigabestatus, Projektstatus, Favoriten, Aufwand), Gruppen je Rig mit Zählern je Status und die
 * Reihenfolge (freigegebene Projekte nach Priorität, danach die übrigen nach Name).
 */
import type { ProjectListItem } from '../../api/client';

export interface ListFilters {
  /** Suche in Name, Zielname und Katalognamen (Filterleiste, AP-26c). */
  readonly query: string;
  readonly rigId: string;
  readonly targetType: string;
  readonly createdBy: string;
  readonly approvalStatus: string;
  readonly status: string;
  readonly favorites: boolean;
  /** Aufwand-Kennzeichen (FA-PRJ-14/23): `effortTags`, `done` (fertig) oder `none` (noch nicht berechnet). */
  readonly effort: string;
}

/** Filterwerte des Aufwand-Kennzeichens (S-30, S-33). */
export const EFFORT_FILTERS = [
  'single_night',
  'multi_night',
  'not_feasible',
  'transit',
  'done',
  'none',
] as const;

/** Filterwert eines Kennzeichens: Tag, `done` bei Planungsbedarf 0, `none` ohne Berechnung. */
export function effortKey(effort: { tag: string | null } | null | undefined): string {
  if (!effort) return 'none';
  return effort.tag ?? 'done';
}

export const NO_FILTERS: ListFilters = {
  query: '',
  rigId: '',
  targetType: '',
  createdBy: '',
  approvalStatus: '',
  status: '',
  favorites: false,
  effort: '',
};

/** Kennung der Gruppe ohne Rig (Entwürfe ohne Rig-Wunsch). */
export const NO_RIG = 'none';

/** Suchtext passt, wenn eines der Felder ihn (ohne Groß-/Kleinschreibung) enthält. */
export function matchesQuery(query: string, ...fields: readonly (string | null)[]): boolean {
  const q = query.trim().toLowerCase();
  return !q || fields.some((x) => (x ?? '').toLowerCase().includes(q));
}

export function filterProjects(
  items: readonly ProjectListItem[],
  f: ListFilters,
): ProjectListItem[] {
  return items.filter(
    (p) =>
      matchesQuery(f.query, p.name, p.targetName, p.catalogNames) &&
      (!f.rigId || (p.rigId ?? NO_RIG) === f.rigId) &&
      (!f.targetType || (p.targetType ?? '') === f.targetType) &&
      (!f.createdBy || p.createdBy === f.createdBy) &&
      (!f.approvalStatus || p.approvalStatus === f.approvalStatus) &&
      (!f.status || p.status === f.status) &&
      (!f.favorites || p.favorite) &&
      (!f.effort || effortKey(p.effort) === f.effort),
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
