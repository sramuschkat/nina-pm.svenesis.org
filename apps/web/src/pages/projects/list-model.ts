/**
 * Reine Hilfen der Projektliste S-30 (AP-11c; FK 14.3, FA-PRJ-14/16/19): Filter (Suche, Rig, Objekttyp,
 * Ersteller, Status, Alle/Meine, Favoriten, Aufwand), Gruppen je Rig bzw. je Status mit Zählern und die
 * Reihenfolge (freigegebene Projekte nach Priorität, danach die übrigen nach Name).
 * Seit 30.09.2026 (Wunsch Sven) **ein** Status über die ganze Lebensdauer: vor der Freigabe der
 * Freigabestatus, danach der Projektstatus – gefiltert über Status-Chips mit Anzahl (Mehrfachauswahl).
 */
import { projectStatuses } from '@nina-pm/shared';
import type { ProjectListItem } from '../../api/client';

/** Status vor der Freigabe (Freigabestatus ohne „Freigegeben“). */
export const PRE_APPROVAL_STATUSES = ['draft', 'submitted', 'returned', 'rejected'] as const;
/** Alle Status in Anzeigereihenfolge: erst vor der Freigabe, dann die Projektstatus. */
export const LIFECYCLE_STATUSES = [...PRE_APPROVAL_STATUSES, ...projectStatuses] as const;

/** Status eines Projekts über die ganze Lebensdauer. */
export function lifecycleStatus(p: Pick<ProjectListItem, 'approvalStatus' | 'status'>): string {
  return p.approvalStatus === 'approved' ? (p.status ?? 'approved') : p.approvalStatus;
}

/** Art des Status für Übersetzung und Farbe (`status.approval.*` bzw. `status.project.*`). */
export function statusKind(status: string): 'approval' | 'project' {
  return (PRE_APPROVAL_STATUSES as readonly string[]).includes(status) || status === 'approved'
    ? 'approval'
    : 'project';
}

export interface ListFilters {
  /** Suche in Name, Zielname und Katalognamen (Filterleiste, AP-26c). */
  readonly query: string;
  readonly rigId: string;
  readonly targetType: string;
  readonly createdBy: string;
  /** Gewählte Status-Chips (`lifecycleStatus`); leer = alle. */
  readonly statuses: readonly string[];
  /** Schalter *Meine*: nur eigene Projekte (ersetzt „Meine Objekte“, 30.09.2026). */
  readonly mine: boolean;
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
  statuses: [],
  mine: false,
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

/** `meId`: Mitglied für den Schalter *Meine*. */
export function filterProjects(
  items: readonly ProjectListItem[],
  f: ListFilters,
  meId = '',
): ProjectListItem[] {
  return items.filter(
    (p) =>
      matchesQuery(f.query, p.name, p.targetName, p.catalogNames) &&
      (!f.rigId || (p.rigId ?? NO_RIG) === f.rigId) &&
      (!f.targetType || (p.targetType ?? '') === f.targetType) &&
      (!f.createdBy || p.createdBy === f.createdBy) &&
      (f.statuses.length === 0 || f.statuses.includes(lifecycleStatus(p))) &&
      (!f.mine || p.createdBy === meId) &&
      (!f.favorites || p.favorite) &&
      (!f.effort || effortKey(p.effort) === f.effort),
  );
}

/**
 * Anzahl je Status für die Chips: mit allen übrigen Filtern (Suche, Meine, Rig …), aber **ohne** die
 * Statusauswahl – sonst zeigten nicht gewählte Chips immer 0.
 */
export function statusCounts(
  items: readonly ProjectListItem[],
  f: ListFilters,
  meId = '',
): { total: number; byStatus: Readonly<Record<string, number>> } {
  const base = filterProjects(items, { ...f, statuses: [] }, meId);
  const byStatus: Record<string, number> = {};
  for (const p of base) {
    const s = lifecycleStatus(p);
    byStatus[s] = (byStatus[s] ?? 0) + 1;
  }
  return { total: base.length, byStatus };
}

/** Gruppierung der Liste (Umschalter, URL `gruppe`). */
export const GROUP_BY = ['rig', 'status', 'none'] as const;
export type GroupBy = (typeof GROUP_BY)[number];

/** Gruppen je Status in der Reihenfolge der Chips; innerhalb wie je Rig (Priorität, dann Name). */
export function groupByStatus(
  items: readonly ProjectListItem[],
): { key: string; items: ProjectListItem[] }[] {
  const by = new Map<string, ProjectListItem[]>();
  for (const p of items) {
    const s = lifecycleStatus(p);
    by.set(s, [...(by.get(s) ?? []), p]);
  }
  const order = [
    ...LIFECYCLE_STATUSES.filter((s) => by.has(s)),
    ...[...by.keys()].filter((s) => !(LIFECYCLE_STATUSES as readonly string[]).includes(s)),
  ];
  return order.map((key) => ({ key, items: sortInGroup(by.get(key) ?? []) }));
}

/** Zustand der Adresse: `status=draft,returned`, `meine=1`, `gruppe=status` (Links, Weiterleitungen). */
export function listStateFromParams(params: URLSearchParams): {
  statuses: string[];
  mine: boolean;
  groupBy: GroupBy;
} {
  const statuses = (params.get('status') ?? '')
    .split(',')
    .filter((s) => (LIFECYCLE_STATUSES as readonly string[]).includes(s));
  const g = params.get('gruppe');
  const groupBy: GroupBy = g === 'status' ? 'status' : g === 'keine' ? 'none' : 'rig';
  return { statuses, mine: params.get('meine') === '1', groupBy };
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
      const key = lifecycleStatus(p);
      const kind = statusKind(key);
      const c = counts.get(`${kind}:${key}`);
      counts.set(`${kind}:${key}`, { key, kind, n: (c?.n ?? 0) + 1 });
    }
    return { rigId, items: list, counts: [...counts.values()] };
  });
}

/**
 * Priorität (1-basiert) unter den freigegebenen Projekten der **ganzen** Rig-Gruppe – unabhängig von
 * Filtern, denn der Server rechnet mit absoluten Positionen (FA-PRJ-13, Prüfung 28.09.2026). `null` =
 * nicht freigegeben.
 */
export function priorityRank(group: readonly ProjectListItem[], id: string): number | null {
  const index = sortInGroup(group)
    .filter((p) => p.approvalStatus === 'approved')
    .findIndex((p) => p.id === id);
  return index < 0 ? null : index + 1;
}

/**
 * Neue Position (1-basiert, absolut in der ganzen Rig-Gruppe) nach Verschieben um `delta` unter den
 * **sichtbaren** Projekten (`shown`, gefiltert; Standard: alle): das Projekt nimmt den Platz des sichtbaren
 * Nachbarn ein. Vorher zählte die Position nur in der gefilterten Liste und landete am falschen Platz.
 */
export function movedPosition(
  group: readonly ProjectListItem[],
  id: string,
  delta: number,
  shown: readonly ProjectListItem[] = group,
): number | null {
  const visible = new Set(shown.map((p) => p.id));
  const approved = sortInGroup(group).filter(
    (p) => p.approvalStatus === 'approved' && (visible.has(p.id) || p.id === id),
  );
  const index = approved.findIndex((p) => p.id === id);
  if (index < 0) return null;
  const neighbor = approved[index + delta];
  return neighbor ? priorityRank(group, neighbor.id) : null;
}
