/**
 * S-30 Projektliste (FK 14.3, FA-PRJ-13/14/15/16/19; AP-11c): Filterleiste (FilterBar, AP-26c: Suche,
 * Schalter *Alle / Meine*, Chips; aufklappbar Rig, Objekttyp, Ersteller, Favoriten, Aufwand), darunter die
 * **Status-Chips mit Anzahl** (Freigabe- und Projektstatus, Mehrfachauswahl), Ansichten Liste/Karten/Detail,
 * Gruppierung je Rig (Kopfzeile, Zähler, Priorität per Ziehen bzw. Pfeilen – nur Admin, freigegebene
 * Projekte), je Status oder ohne; Projektkarte mit Reitern *Zielinfo* und *Höhenkurve*, Plan je Filter und
 * Fortschritt; *Löschen* über `ConfirmDialog`. Umschalter *Papierkorb* (Admin/Owner) mit Löschzeitpunkt in
 * Mandantenzeit, Rig, Ersteller und *Wiederherstellen* ohne Dialog (E4).
 * Seit 30.09.2026 ersetzt die Liste „Meine Objekte“ (S-32, Schalter *Meine*) und „Entwürfe“ (S-34, Chips
 * *Entwurf* und *Zurückgegeben*); Status, *Meine* und Gruppierung stehen in der Adresse.
 */
import { formatTzAbbr } from '@nina-pm/shared';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useId, useMemo, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  equipmentApi,
  projectsApi,
  type FilterView,
  type ProjectListItem,
  type RigView,
  type SiteView,
} from '../../api/client';
import { useAuth, useCan } from '../../auth';
import { ActionMenu } from '../../components/ActionMenu';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataColumn, type SortState } from '../../components/DataTable';
import { formatCoordinate } from '../../components/CoordinateInput/coords';
import { FilterBar, FilterCheck, FilterField, FilterToggle } from '../../components/FilterBar';
import { FilterChip } from '../../components/FilterChip';
import { ICON_SIZE, actionIcons, uiIcons } from '../../components/icons';
import { NightChart } from '../../components/night-chart';
import { ProblemMessage, problemI18nKey } from '../../components/ProblemMessage';
import { ProgressBar } from '../../components/ProgressBar';
import { EffortChip } from '../../components/EffortChip';
import { StatusBadge } from '../../components/StatusBadge';
import { Tabs } from '../../components/Tabs';
import { nightChartFromEngine } from '../../lib/night-chart-data';
import { formatDateTime } from '../../lib/time';
import { problemCode, useEquipmentList, useNumber } from '../equipment/shared';
import {
  EFFORT_FILTERS,
  NO_FILTERS,
  NO_RIG,
  filterOptions,
  filterProjects,
  groupByRig,
  groupByStatus,
  LIFECYCLE_STATUSES,
  lifecycleStatus,
  listStateFromParams,
  movedPosition,
  priorityRank,
  statusCounts,
  statusKind,
  type GroupBy,
  type ListFilters,
} from './list-model';
import { engineMoonProfile } from './model';
import { ProjectsLayout } from './ProjectsLayout';
import { ProjectImage, ProjectThumb } from './ProjectImage';
import styles from './projects.module.css';
import { StatusChips } from './StatusChips';
import { Person } from '../../lib/member';

type View = 'list' | 'cards' | 'detail';
const LIST_KEY = ['projects', 'list'] as const;
const DELETED_KEY = ['projects', 'deleted'] as const;

/**
 * Filterleiste in einer Zeile (FilterBar, AP-26c): Suche, aktive Filter als Chips, übrige Filter
 * aufklappbar; *Papierkorb* (nur Admin) schaltet statt eines Reiters auf die gelöschten Projekte um.
 */
export function ProjectListPage() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const meId = me?.member?.id ?? '';
  const canAdmin = useCan('project.status');
  const [trash, setTrash] = useState(false);
  const [local, setLocal] = useState<ListFilters>(NO_FILTERS);
  const [view, setView] = useState<View>('list');
  // Status, *Meine* und Gruppierung aus der Adresse (Links, Weiterleitung alter Seiten).
  const [params, setParams] = useSearchParams();
  const url = listStateFromParams(params);
  const setUrl = (patch: { status?: string[]; mine?: boolean; groupBy?: GroupBy }) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const put = (key: string, value: string | null) =>
          value ? next.set(key, value) : next.delete(key);
        if (patch.status) put('status', patch.status.join(','));
        if (patch.mine !== undefined) put('meine', patch.mine ? '1' : null);
        if (patch.groupBy)
          put(
            'gruppe',
            patch.groupBy === 'rig' ? null : patch.groupBy === 'none' ? 'keine' : 'status',
          );
        return next;
      },
      { replace: true },
    );
  const filters: ListFilters = { ...local, statuses: url.statuses, mine: url.mine };
  const list = useQuery({
    queryKey: LIST_KEY,
    queryFn: async () => (await projectsApi.list()).items,
  });
  const rigs = useEquipmentList('rigs');
  const items = list.data ?? [];
  const options = useMemo(() => filterOptions(items), [items]);
  const shown = filterProjects(items, filters, meId);
  const counts = statusCounts(items, filters, meId);
  const showTrash = canAdmin && trash;
  const set = <K extends keyof ListFilters>(key: K, value: ListFilters[K]) =>
    setLocal((f) => ({ ...f, [key]: value }));
  const ids = {
    rig: useId(),
    type: useId(),
    creator: useId(),
    effort: useId(),
    group: useId(),
  };
  const effortLabel = (k: string) =>
    k === 'done' || k === 'none' ? t(`effort.filter.${k}`) : t(`status.effort.${k}`);
  const rigName = (id: string) =>
    id === NO_RIG
      ? t('projectList.noRig')
      : ((rigs.data ?? []).find((r) => r.id === id)?.name ?? t('projectList.unknownRig'));
  const chip = (id: keyof ListFilters, label: string, value: string) => ({
    id,
    label: t('filterBar.chip', { label, value }),
    onRemove: () => set(id, NO_FILTERS[id]),
  });
  const chips = [
    ...(filters.rigId ? [chip('rigId', t('projectList.filter.rig'), rigName(filters.rigId))] : []),
    ...(filters.targetType
      ? [chip('targetType', t('projectList.filter.type'), filters.targetType)]
      : []),
    ...(filters.createdBy
      ? [
          chip(
            'createdBy',
            t('projectList.filter.creator'),
            options.creators.find((c) => c.id === filters.createdBy)?.name ?? '–',
          ),
        ]
      : []),
    ...(filters.effort
      ? [chip('effort', t('projectList.filter.effort'), effortLabel(filters.effort))]
      : []),
    ...(filters.favorites
      ? [
          {
            id: 'favorites',
            label: t('projectList.filter.favorites'),
            onRemove: () => set('favorites', false),
          },
        ]
      : []),
  ];
  const select = (
    id: string,
    label: string,
    key: 'rigId' | 'targetType' | 'createdBy' | 'effort',
    opts: readonly (readonly [string, string])[],
  ) => (
    <FilterField label={label} htmlFor={id}>
      <select
        id={id}
        className={styles.input}
        value={filters[key]}
        onChange={(e) => set(key, e.target.value)}
      >
        <option value="">{t('projectList.all')}</option>
        {opts.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </FilterField>
  );
  const panel = (
    <>
      {select(ids.rig, t('projectList.filter.rig'), 'rigId', [
        ...(rigs.data ?? []).map((r) => [r.id, r.name] as const),
        [NO_RIG, t('projectList.noRig')],
      ])}
      {select(
        ids.type,
        t('projectList.filter.type'),
        'targetType',
        options.targetTypes.map((x) => [x, x] as const),
      )}
      {select(
        ids.creator,
        t('projectList.filter.creator'),
        'createdBy',
        options.creators.map((c) => [c.id, c.name] as const),
      )}
      {select(
        ids.effort,
        t('projectList.filter.effort'),
        'effort',
        EFFORT_FILTERS.map((k) => [k, effortLabel(k)] as const),
      )}
      <FilterCheck
        label={t('projectList.filter.favorites')}
        checked={filters.favorites}
        onChange={(on) => set('favorites', on)}
      />
    </>
  );
  const whoSwitch = (
    <div className={styles.segmented} role="radiogroup" aria-label={t('projectList.who.label')}>
      {([false, true] as const).map((mine) => (
        <button
          key={String(mine)}
          type="button"
          role="radio"
          aria-checked={url.mine === mine}
          className={url.mine === mine ? styles.segmentActive : styles.segment}
          onClick={() => setUrl({ mine })}
        >
          {t(mine ? 'projectList.who.mine' : 'projectList.who.all')}
        </button>
      ))}
    </div>
  );
  const groupSelect = (
    <label className={styles.groupSelect} htmlFor={ids.group}>
      <span>{t('projectList.groupBy.label')}</span>
      <select
        id={ids.group}
        className={styles.input}
        value={url.groupBy}
        onChange={(e) => setUrl({ groupBy: e.target.value as GroupBy })}
      >
        {(['rig', 'status', 'none'] as const).map((g) => (
          <option key={g} value={g}>
            {t(`projectList.groupBy.${g}`)}
          </option>
        ))}
      </select>
    </label>
  );
  const viewSwitch = (
    <div className={styles.segmented} role="radiogroup" aria-label={t('projectList.viewLabel')}>
      {(['list', 'cards', 'detail'] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={view === v}
          className={view === v ? styles.segmentActive : styles.segment}
          onClick={() => setView(v)}
        >
          {t(`projectList.view.${v}`)}
        </button>
      ))}
    </div>
  );
  return (
    <ProjectsLayout title={t('projectList.title')}>
      <div className={styles.listCard}>
        <FilterBar
          label={t('projectList.filters')}
          className={styles.listBar}
          {...(showTrash
            ? {}
            : {
                search: {
                  value: filters.query,
                  onChange: (q: string) => set('query', q),
                  label: t('projectList.search'),
                  placeholder: t('projectList.searchPlaceholder'),
                  maxLength: 80,
                },
                inline: whoSwitch,
                chips,
                panel,
                onReset: () => {
                  setLocal(NO_FILTERS);
                  setUrl({ status: [] });
                },
                view: (
                  <>
                    {groupSelect}
                    {viewSwitch}
                  </>
                ),
                ...(list.data
                  ? { count: t('projectList.count', { n: shown.length, total: items.length }) }
                  : {}),
              })}
          extra={
            canAdmin ? (
              <FilterToggle
                label={t('projectList.trash')}
                icon={<actionIcons.deleted size={ICON_SIZE.table} aria-hidden />}
                pressed={trash}
                onChange={setTrash}
              />
            ) : null
          }
        />
        {showTrash ? (
          <DeletedView />
        ) : (
          <>
            {list.data ? (
              <StatusChips
                total={counts.total}
                counts={counts.byStatus}
                selected={url.statuses}
                onChange={(status) => setUrl({ status })}
              />
            ) : null}
            <ActiveView list={list} items={items} shown={shown} view={view} groupBy={url.groupBy} />
          </>
        )}
      </div>
    </ProjectsLayout>
  );
}

// ---- Liste --------------------------------------------------------------------------------------

/** Gruppe der Liste: je Rig (`key` = Rig), je Status (`key` = Status) oder eine ohne Kopf (`all`). */
interface ListGroup {
  readonly key: string;
  readonly items: ProjectListItem[];
  /** Zähler je Status in der Kopfzeile (nur je Rig). */
  readonly counts: readonly { key: string; kind: 'project' | 'approval'; n: number }[];
}

function ActiveView({
  list,
  items,
  shown,
  view,
  groupBy,
}: {
  list: UseQueryResult<ProjectListItem[]>;
  items: readonly ProjectListItem[];
  shown: ProjectListItem[];
  view: View;
  groupBy: GroupBy;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const canAdmin = useCan('project.status');
  const rigs = useEquipmentList('rigs');
  const sites = useEquipmentList('sites');
  const telescopes = useEquipmentList('telescopes');
  const cameras = useEquipmentList('cameras');
  const filtersList = useEquipmentList('filters');
  const [remove, setRemove] = useState<ProjectListItem | null>(null);

  const refresh = () => client.invalidateQueries({ queryKey: ['projects'] });
  const favorite = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => projectsApi.favorite(id, on),
    onSuccess: refresh,
  });
  const priority = useMutation({
    mutationFn: ({ id, position }: { id: string; position: number }) =>
      projectsApi.priority(id, position),
    onSuccess: refresh,
  });
  const del = useMutation({
    mutationFn: (id: string) => projectsApi.remove(id),
    onSuccess: async () => {
      setRemove(null);
      await refresh();
    },
  });

  const rigOrder = (rigs.data ?? []).map((r) => r.id);
  const groups: ListGroup[] =
    groupBy === 'rig'
      ? groupByRig(shown, rigOrder).map((g) => ({ key: g.rigId, items: g.items, counts: g.counts }))
      : groupBy === 'status'
        ? groupByStatus(shown).map((g) => ({ ...g, counts: [] }))
        : [
            {
              key: 'all',
              items: [...shown].sort((a, b) => a.name.localeCompare(b.name)),
              counts: [],
            },
          ];
  // Ungefilterte Gruppen je Rig: Priorität und Verschieben rechnen absolut (der Server kennt keine Filter).
  const allGroups: ListGroup[] = groupByRig(items, rigOrder).map((g) => ({
    key: g.rigId,
    items: g.items,
    counts: g.counts,
  }));

  if (list.isError)
    return (
      <div className={styles.listBody}>
        <ProblemMessage code={problemCode(list.error)} onRetry={() => void list.refetch()} />
      </div>
    );
  if (list.isPending)
    return (
      <div className={styles.listBody}>
        <p role="status">{t('common.loading')}</p>
      </div>
    );

  const rigName = (rigId: string) => {
    if (rigId === NO_RIG) return t('projectList.noRig');
    return (rigs.data ?? []).find((r) => r.id === rigId)?.name ?? t('projectList.unknownRig');
  };
  /** Standort, Teleskop und Kamera des Rigs (gedämpft neben dem Namen). */
  const rigMeta = (rigId: string) => {
    const rig = (rigs.data ?? []).find((r) => r.id === rigId);
    if (!rig) return '';
    const site = (sites.data ?? []).find((s) => s.id === rig.siteId)?.name;
    const tel = (telescopes.data ?? []).find((s) => s.id === rig.telescopeId)?.name;
    const cam = (cameras.data ?? []).find((s) => s.id === rig.cameraId)?.name;
    return [site, tel, cam].filter(Boolean).join(' · ');
  };
  const rigLabel = (rigId: string) => [rigName(rigId), rigMeta(rigId)].filter(Boolean).join(' · ');
  const statusName = (status: string) => t(`status.${statusKind(status)}.${status}`);
  const groupName = (key: string) => (groupBy === 'status' ? statusName(key) : rigName(key));
  const groupMeta = (key: string) => (groupBy === 'rig' ? rigMeta(key) : '');
  const errors = [favorite.error, priority.error].filter((e) => e !== null);

  return (
    <>
      {errors.length > 0 ? (
        <div className={styles.listBody}>
          {errors.map((e, i) => (
            <ProblemMessage key={i} code={problemCode(e)} />
          ))}
        </div>
      ) : null}
      {items.length === 0 ? (
        <div className={styles.listBody}>
          <p className={styles.note}>{t('projectList.empty')}</p>
        </div>
      ) : shown.length === 0 ? (
        <div className={styles.listBody}>
          <p className={styles.note}>{t('projectList.noMatch')}</p>
        </div>
      ) : (
        <>
          {view === 'list' ? (
            <ProjectTable
              groups={groups}
              allGroups={allGroups}
              groupBy={groupBy}
              groupName={groupName}
              groupMeta={groupMeta}
              filters={filtersList.data ?? []}
              onFavorite={(id, on) => favorite.mutate({ id, on })}
              onDelete={setRemove}
              onMove={(group, shownInGroup, id, delta) => {
                const position = movedPosition(group, id, delta, shownInGroup);
                if (position !== null) priority.mutate({ id, position });
              }}
              onDropAt={(id, position) => priority.mutate({ id, position })}
            />
          ) : (
            <div className={styles.listBody}>
              {groups.map((g) => (
                <section
                  key={g.key}
                  className={styles.group}
                  aria-label={
                    groupBy === 'rig'
                      ? rigLabel(g.key)
                      : groupBy === 'status'
                        ? statusName(g.key)
                        : t('projectList.title')
                  }
                >
                  {groupBy === 'none' ? null : (
                    <div className={styles.groupHead}>
                      <h2>{groupName(g.key)}</h2>
                      <span className={styles.muted}>
                        {groupBy === 'rig'
                          ? rigMeta(g.key)
                          : t('projectList.groupCount', { n: g.items.length })}
                      </span>
                      <span className={styles.groupCounts}>
                        {g.counts
                          .map((c) => `${String(c.n)} ${t(`status.${c.kind}.${c.key}`)}`)
                          .join(' · ')}
                      </span>
                    </div>
                  )}
                  <div className={view === 'cards' ? styles.cards : styles.detailCards}>
                    {g.items.map((p) => (
                      <ProjectCard
                        key={p.id}
                        project={p}
                        filters={filtersList.data ?? []}
                        rig={(rigs.data ?? []).find((r) => r.id === p.rigId) ?? null}
                        sites={sites.data ?? []}
                        rigLine={p.rigId ? rigLabel(p.rigId) : t('projectList.noRig')}
                        initialTab={view === 'detail' ? 'altitude' : 'info'}
                        onFavorite={(on) => favorite.mutate({ id: p.id, on })}
                        onDelete={() => setRemove(p)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}
      {canAdmin && view === 'list' && groupBy === 'rig' && shown.length > 0 ? (
        <p className={styles.listFoot}>{t('projectList.priorityHint')}</p>
      ) : null}
      <ConfirmDialog
        open={remove !== null}
        title={t('projectEditor.deleteTitle', { name: remove?.name ?? '' })}
        consequence={t('projectEditor.deleteConsequence')}
        confirmLabel={t('projectEditor.delete')}
        variant="danger"
        state={del.isPending ? 'loading' : del.isError ? 'error' : 'ready'}
        {...(del.error ? { errorKey: problemI18nKey(problemCode(del.error)) } : {})}
        onConfirm={() => (remove ? del.mutateAsync(remove.id).catch(() => undefined) : undefined)}
        onCancel={() => {
          const name = remove?.name ?? '';
          setRemove(null);
          del.reset();
          // Fokus zurück auf das ⋯-Menü der Zeile (der Dialog wurde aus dem Menü geöffnet).
          setTimeout(() => {
            const label = t('projectList.moreFor', { name });
            [...document.querySelectorAll<HTMLButtonElement>('button[aria-label]')]
              .find((b) => b.getAttribute('aria-label') === label)
              ?.focus();
          }, 0);
        }}
      />
    </>
  );
}

/** Plan je Filter als Chip mit Minibalken „14/15 × 600 s“ (FA-PRJ-14). */
export function FilterPlan({
  project,
  filters,
}: {
  project: ProjectListItem;
  filters: readonly FilterView[];
}) {
  if (project.filters.length === 0) return null;
  return (
    <ul className={styles.filterPlan}>
      {project.filters.map((f) => (
        <li key={f.filterId ?? f.filterShortName}>
          <FilterChip
            shortName={f.filterShortName}
            color={filters.find((x) => x.id === f.filterId)?.colorHex ?? '#888888'}
            size="sm"
          />
          <ProgressBar
            acquired={f.accepted}
            planned={f.planned}
            exposureS={f.exposureS}
            size="sm"
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * Projektliste als **eine** Tabelle, je Rig eine Zwischenüberschrift (AP-26a): Spalten fluchten,
 * sortierbar per Spaltenkopf (innerhalb der Rig-Gruppe), bei wenig Platz Spalten ausblenden. Priorität
 * per Pfeil bzw. Ziehen nur in der Standard-Reihenfolge (ohne aktive Sortierung).
 */
function ProjectTable({
  groups,
  allGroups,
  groupBy,
  groupName,
  groupMeta,
  filters,
  onFavorite,
  onDelete,
  onMove,
  onDropAt,
}: {
  groups: readonly ListGroup[];
  /** Gruppen je Rig ohne Filter – Grundlage der (absoluten) Priorität. */
  allGroups: readonly ListGroup[];
  groupBy: GroupBy;
  groupName: (key: string) => string;
  groupMeta: (key: string) => string;
  filters: readonly FilterView[];
  onFavorite: (id: string, on: boolean) => void;
  onDelete: (p: ProjectListItem) => void;
  onMove: (
    group: readonly ProjectListItem[],
    shownInGroup: readonly ProjectListItem[],
    id: string,
    delta: number,
  ) => void;
  onDropAt: (id: string, position: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const canAdmin = useCan('project.status');
  const { me } = useAuth();
  const zone = me?.tenant?.timeZone ?? 'UTC';
  const canFavorite = useCan('me.favorites');
  const [dragId, setDragId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState | null>(null);
  // Priorität gilt je Rig: Pfeile, Ziehen und Spalte nur bei Gruppierung je Rig.
  const byRig = groupBy === 'rig';
  const groupOf = (p: ProjectListItem) =>
    byRig ? (p.rigId ?? NO_RIG) : groupBy === 'status' ? lifecycleStatus(p) : 'all';
  const byGroup = new Map(groups.map((g) => [g.key, g]));
  const allByGroup = new Map(allGroups.map((g) => [g.key, g]));
  const itemsOf = (p: ProjectListItem) => byGroup.get(groupOf(p))?.items ?? [];
  const allItemsOf = (p: ProjectListItem) => allByGroup.get(groupOf(p))?.items ?? itemsOf(p);
  const approvedOf = (p: ProjectListItem) =>
    itemsOf(p).filter((x) => x.approvalStatus === 'approved');
  // Priorität lässt sich nur in der Standard-Reihenfolge ändern.
  const reorder = canAdmin && byRig && sort === null;
  const onDrop = (e: DragEvent, target: ProjectListItem) => {
    e.preventDefault();
    const approved = approvedOf(target);
    const position = priorityRank(allItemsOf(target), target.id);
    const sameGroup = approved.some((p) => p.id === dragId);
    if (dragId && sameGroup && position !== null && dragId !== target.id)
      onDropAt(dragId, position);
    setDragId(null);
  };
  const priorityColumn: DataColumn<ProjectListItem> = {
    id: 'priority',
    header: t('projectList.col.priority'),
    nowrap: true,
    cell: (p) => {
      if (p.approvalStatus !== 'approved') return '–';
      // Sichtbare Nachbarn bestimmen die Pfeile, die Zahl ist die echte Priorität im Rig.
      const approved = approvedOf(p);
      const index = approved.findIndex((x) => x.id === p.id);
      return (
        <span className={styles.priorityCell}>
          <span className={styles.dragHandle} aria-hidden>
            {priorityRank(allItemsOf(p), p.id) ?? index + 1}
          </span>
          {reorder ? (
            <>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={t('projectList.up', { name: p.name })}
                disabled={index === 0}
                onClick={() => onMove(allItemsOf(p), itemsOf(p), p.id, -1)}
              >
                <uiIcons.up size={ICON_SIZE.table} aria-hidden />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={t('projectList.down', { name: p.name })}
                disabled={index === approved.length - 1}
                onClick={() => onMove(allItemsOf(p), itemsOf(p), p.id, 1)}
              >
                <uiIcons.down size={ICON_SIZE.table} aria-hidden />
              </button>
            </>
          ) : null}
        </span>
      );
    },
  };
  const columns: DataColumn<ProjectListItem>[] = [
    ...(canAdmin && byRig ? [priorityColumn] : []),
    {
      id: 'image',
      header: t('catalog.col.image'),
      headerHidden: true,
      // Immer sichtbar (Wunsch Sven 26.09.2026), die Spalte ist nur 40 px breit.
      priority: 1,
      cell: (p) => (
        <ProjectThumb thumbnailUrl={p.thumbnailUrl} primaryId={p.dsoPrimaryId} name={p.name} />
      ),
    },
    {
      id: 'name',
      header: t('projectList.col.name'),
      sortValue: (p) => p.name,
      nowrap: true,
      cell: (p) => <Link to={`/projekte/${p.id}`}>{p.name}</Link>,
    },
    {
      id: 'status',
      header: t('projectList.col.status'),
      sortValue: (p) => LIFECYCLE_STATUSES.indexOf(lifecycleStatus(p) as never),
      cell: (p) => {
        const s = lifecycleStatus(p);
        return (
          <span className={styles.statusCell}>
            <StatusBadge kind={statusKind(s)} value={s} size="sm" />
            {s === 'returned' || s === 'rejected' ? <DecisionNote projectId={p.id} /> : null}
          </span>
        );
      },
    },
    {
      id: 'effort',
      header: t('projectList.col.effort'),
      sortValue: (p) => p.effort?.nights ?? null,
      priority: 2,
      nowrap: true,
      cell: (p) => <EffortChip effort={p.effort} stale={p.effortStale} size="sm" />,
    },
    {
      id: 'progress',
      header: t('projectList.col.progress'),
      sortValue: (p) => p.progress.percentDone,
      priority: 2,
      nowrap: true,
      cell: (p) => (
        <span className={styles.progressCell}>
          <ProgressBar
            acquired={Math.round((p.progress.percentDone / 100) * 1000)}
            planned={1000}
            size="sm"
            showLabel={false}
          />
          <span className={styles.muted}>{`${String(Math.round(p.progress.percentDone))} %`}</span>
        </span>
      ),
    },
    {
      id: 'plan',
      header: t('projectList.col.plan'),
      priority: 3,
      cell: (p) => <FilterPlan project={p} filters={filters} />,
    },
    {
      id: 'creator',
      header: t('projectList.col.creator'),
      sortValue: (p) => p.createdByName,
      priority: 3,
      nowrap: true,
      cell: (p) => <Person id={p.createdBy} name={p.createdByName} />,
    },
    {
      // „Zuletzt geändert“ (vorher Spalte der Entwürfe-Liste S-34) in Mandantenzeit mit Kürzel.
      id: 'updatedAt',
      header: t('projectList.col.updatedAt'),
      sortValue: (p) => p.updatedAt,
      priority: 4,
      nowrap: true,
      cell: (p) => formatDateTime(p.updatedAt, zone, i18n.language),
    },
    {
      id: 'coordinates',
      header: t('projectList.col.coordinates'),
      sortValue: (p) => p.raDeg,
      priority: 4,
      nowrap: true,
      className: styles.coords,
      cell: (p) => coords(p),
    },
    {
      id: 'type',
      header: t('projectList.col.type'),
      sortValue: (p) => p.targetType,
      priority: 5,
      cell: (p) => p.targetType ?? '–',
    },
    {
      id: 'actions',
      header: t('projectList.col.actions'),
      headerHidden: true,
      cell: (p) => (
        <RowActions
          project={p}
          canFavorite={canFavorite}
          onFavorite={onFavorite}
          onDelete={onDelete}
        />
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={groups.flatMap((g) => g.items)}
      rowKey={(p) => p.id}
      rowLabel={(p) => p.name}
      label={t('projectList.title')}
      sort={sort}
      onSortChange={setSort}
      {...(groupBy === 'none'
        ? {}
        : {
            groups: {
              key: groupOf,
              header: (key: string) => (
                <span className={styles.groupHeadInline}>
                  <strong>{groupName(key)}</strong>
                  {groupMeta(key) ? (
                    <span className={styles.groupMeta}>{groupMeta(key)}</span>
                  ) : null}
                  <span className={styles.groupCounts}>
                    {byRig
                      ? (byGroup.get(key)?.counts ?? [])
                          .map((c) => `${String(c.n)} ${t(`status.${c.kind}.${c.key}`)}`)
                          .join(' · ')
                      : t('projectList.groupCount', { n: byGroup.get(key)?.items.length ?? 0 })}
                  </span>
                </span>
              ),
            },
          })}
      // Gleiche Spalten über alle Status-Chips und Filter (neu gerechnet nur bei neuer Breite).
      stableColumns
      // Kommentar der Freigabe vollständig in der Detailzeile (in der Statusspalte gekürzt).
      renderDetail={(p) => {
        const s = lifecycleStatus(p);
        return s === 'returned' || s === 'rejected' ? <DecisionNote projectId={p.id} full /> : null;
      }}
      rowProps={(p) => {
        const draggable = reorder && p.approvalStatus === 'approved';
        return {
          draggable,
          'data-dragging': dragId === p.id,
          onDragStart: () => setDragId(p.id),
          onDragEnd: () => setDragId(null),
          onDragOver: (e) => (draggable ? e.preventDefault() : undefined),
          onDrop: (e) => onDrop(e, p),
        };
      }}
    />
  );
}

/**
 * Letzter Kommentar der Freigabe bei zurückgegebenen bzw. abgelehnten Projekten (vorher auf den Karten von
 * „Meine Objekte“, FA-FRG-13): aus dem Verlauf, gekürzt, voller Text im Tooltip.
 */
function DecisionNote({ projectId, full = false }: { projectId: string; full?: boolean }) {
  const { t } = useTranslation();
  const history = useQuery({
    queryKey: ['project-history', projectId],
    queryFn: async () => (await projectsApi.history(projectId)).items,
  });
  const decision = (history.data ?? []).find(
    (h) => h.kind === 'approval' && ['returned', 'rejected', 'expired'].includes(h.action),
  );
  if (!decision) return null;
  const text =
    decision.action === 'expired'
      ? t('myObjects.expired')
      : t('myObjects.comment', { comment: decision.comment ?? '' });
  return (
    <span
      className={full ? styles.decisionFull : styles.decisionNote}
      title={full ? undefined : text}
    >
      {text}
    </span>
  );
}

function coords(p: ProjectListItem) {
  if (p.raDeg === null || p.decDeg === null) return '–';
  return `${formatCoordinate('ra', p.raDeg, 'sexagesimal')} · ${formatCoordinate('dec', p.decDeg, 'sexagesimal')}`;
}

function RowActions({
  project,
  canFavorite,
  onFavorite,
  onDelete,
}: {
  project: ProjectListItem;
  canFavorite: boolean;
  onFavorite: (id: string, on: boolean) => void;
  onDelete: (p: ProjectListItem) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const resource = { createdBy: project.createdBy, approvalStatus: project.approvalStatus };
  const canDelete = useCan('project.delete', resource);
  // Einreichen (vorher auf den Karten von „Meine Objekte“): öffnet den Dialog im Projekt-Editor.
  const canSubmit =
    useCan('project.submit', resource) &&
    (project.approvalStatus === 'draft' || project.approvalStatus === 'returned');
  const Star = actionIcons.favorite;
  return (
    <span className={styles.rowActions}>
      {canFavorite ? (
        <button
          type="button"
          className={`${styles.iconButton} ${styles.favorite}`}
          aria-pressed={project.favorite}
          aria-label={t('projectList.favoriteFor', { name: project.name })}
          onClick={() => onFavorite(project.id, !project.favorite)}
        >
          <Star
            size={ICON_SIZE.table}
            aria-hidden
            fill={project.favorite ? 'currentColor' : 'none'}
          />
        </button>
      ) : null}
      <ActionMenu
        label={t('projectList.moreFor', { name: project.name })}
        size="sm"
        items={[
          ...(canSubmit
            ? [
                {
                  key: 'submit',
                  label: t('approvalFlow.submit'),
                  icon: <actionIcons.submit size={ICON_SIZE.table} aria-hidden />,
                  onSelect: () => void navigate(`/projekte/${project.id}?einreichen=1`),
                },
              ]
            : []),
          ...(canDelete
            ? [
                {
                  key: 'delete',
                  label: t('projectEditor.delete'),
                  icon: <actionIcons.delete size={ICON_SIZE.table} aria-hidden />,
                  danger: true,
                  onSelect: () => onDelete(project),
                },
              ]
            : []),
        ]}
      />
    </span>
  );
}

// ---- Karte ----------------------------------------------------------------------------------------

function ProjectCard({
  project: p,
  filters,
  rig,
  sites,
  rigLine,
  initialTab,
  onFavorite,
  onDelete,
}: {
  project: ProjectListItem;
  filters: readonly FilterView[];
  rig: RigView | null;
  sites: readonly SiteView[];
  rigLine: string;
  initialTab: 'info' | 'altitude';
  onFavorite: (on: boolean) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const num = useNumber();
  const canFavorite = useCan('me.favorites');
  const [tab, setTab] = useState<'info' | 'altitude'>(initialTab);
  const baseId = useId();
  const site = sites.find((s) => s.id === rig?.siteId) ?? null;
  const plannedH = p.progress.plannedS / 3600;
  const currentH = p.progress.integrationS / 3600;
  return (
    <article className={styles.card} aria-labelledby={`${baseId}-name`}>
      <div className={styles.cardSide}>
        <ProjectImage
          thumbnailUrl={p.thumbnailUrl}
          primaryId={p.dsoPrimaryId}
          name={p.targetName || p.name}
          className={styles.thumbImage}
          fallback={<div className={styles.thumb}>{t('projectList.thumbLater')}</div>}
        />
        <Link to={`/projekte/${p.id}`} className={styles.button}>
          {t('projectList.open')}
        </Link>
        <RowActions
          project={p}
          canFavorite={canFavorite}
          onFavorite={(_, on) => onFavorite(on)}
          onDelete={onDelete}
        />
      </div>
      <div className={styles.cardMain}>
        <h3 id={`${baseId}-name`} className={styles.cardTitle}>
          <Link to={`/projekte/${p.id}`}>{p.name}</Link>
          {p.status ? <StatusBadge kind="project" value={p.status} size="sm" /> : null}
          {p.approvalStatus !== 'approved' ? (
            <StatusBadge kind="approval" value={p.approvalStatus} size="sm" />
          ) : null}
          {p.targetType ? <span className={styles.typeTag}>{p.targetType}</span> : null}
          <EffortChip effort={p.effort} stale={p.effortStale} size="sm" />
        </h3>
        <Tabs
          label={t('projectList.cardTabs')}
          tabs={(['info', 'altitude'] as const).map((key) => ({
            key,
            label: t(`projectList.cardTab.${key}`),
          }))}
          value={tab}
          onChange={setTab}
          panelClassName={styles.tabPanel}
          panels={{
            info: (
              <dl className={styles.cardFacts}>
                <dt>{t('projectList.col.coordinates')}</dt>
                <dd>{coords(p)}</dd>
                <dt>{t('projectEditor.field.rotation')}</dt>
                <dd>{`${num(p.rotationDeg, 1)}°`}</dd>
                <dt>{t('projectEditor.field.catalogNames')}</dt>
                <dd>{p.catalogNames || p.targetName || '–'}</dd>
                <dt>{t('projectEditor.rig')}</dt>
                <dd>{rigLine}</dd>
                {p.panelCount > 1 ? (
                  <>
                    <dt>{t('projectEditor.plan.panels')}</dt>
                    <dd>{p.panelCount}</dd>
                  </>
                ) : null}
              </dl>
            ),
            altitude: <AltitudeCurve project={p} site={site} />,
          }}
        />
        <ProgressBar
          acquired={Math.round((p.progress.percentDone / 100) * 1000)}
          planned={1000}
          showLabel={false}
        />
        <span className={styles.muted}>
          {t('projectList.progress', { pct: num(p.progress.percentDone, 0) })}
        </span>
      </div>
      <div className={styles.cardPlan}>
        <FilterPlan project={p} filters={filters} />
        <span className={styles.muted}>
          {t('projectList.integration', { planned: num(plannedH, 1), current: num(currentH, 1) })}
        </span>
      </div>
    </article>
  );
}

/** Höhenkurve der laufenden Nacht am Standort des Rigs (Engine im Browser, Nacht-Tabelle NT-02). */
function AltitudeCurve({ project: p, site }: { project: ProjectListItem; site: SiteView | null }) {
  const { t } = useTranslation();
  const nights = useQuery({
    queryKey: ['site-nights', site?.id],
    queryFn: () => equipmentApi.nights(site?.id ?? '', 60),
    enabled: site !== null,
    staleTime: 60 * 60 * 1000,
  });
  const night = nights.data?.currentNight ?? null;
  const chart = useMemo(() => {
    if (!site || !night || !nights.data || p.raDeg === null || p.decDeg === null) return null;
    return nightChartFromEngine({
      site: { latDeg: site.latitudeDeg, lonDeg: site.longitudeDeg },
      night,
      timeZoneTransitions: nights.data.timeZoneTransitions.map((z) => ({
        atUtc: Date.parse(z.atUtc) / 1000,
        utcOffsetMinutes: z.utcOffsetMinutes,
      })),
      timeZone: site.timeZone,
      targets: [
        {
          id: p.id,
          label: p.targetName || p.name,
          color: 'var(--npm-chart-target)',
          target: { raJ2000Deg: p.raDeg, decJ2000Deg: p.decDeg },
        },
      ],
      minAltDeg: p.conditions.minAltitudeDeg,
      twilight: p.conditions.twilight,
      transitLabel: t('projectEditor.charts.meridian'),
      moonProfile: engineMoonProfile(p.conditions),
    }).props;
  }, [site, night, nights.data, p, t]);
  if (!site) return <p className={styles.muted}>{t('projectEditor.charts.needsRig')}</p>;
  if (p.raDeg === null || p.decDeg === null)
    return <p className={styles.muted}>{t('projectEditor.charts.needsCoordinates')}</p>;
  return chart ? (
    <NightChart {...chart} height={160} bands={false} />
  ) : (
    <NightChart
      window={null}
      timeZone={site.timeZone}
      state={nights.isError ? 'error' : 'loading'}
      onRetry={() => void nights.refetch()}
    />
  );
}

// ---- Gelöscht (Papierkorb, E4) --------------------------------------------------------------------

function DeletedView() {
  const { t, i18n } = useTranslation();
  const { me } = useAuth();
  const client = useQueryClient();
  const rigs = useEquipmentList('rigs');
  const deleted = useQuery({
    queryKey: DELETED_KEY,
    queryFn: async () => (await projectsApi.list('?deleted=true')).items,
  });
  const restore = useMutation({
    mutationFn: (id: string) => projectsApi.restore(id),
    onSuccess: () => client.invalidateQueries({ queryKey: ['projects'] }),
  });
  const zone = me?.tenant?.timeZone ?? 'UTC';
  const when = (iso: string) =>
    `${new Intl.DateTimeFormat(i18n.language, {
      timeZone: zone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(Date.parse(iso))} ${formatTzAbbr(iso, zone)}`;
  if (deleted.isError)
    return (
      <div className={styles.listBody}>
        <ProblemMessage code={problemCode(deleted.error)} onRetry={() => void deleted.refetch()} />
      </div>
    );
  if (deleted.isPending)
    return (
      <div className={styles.listBody}>
        <p role="status">{t('common.loading')}</p>
      </div>
    );
  return (
    <>
      <div className={styles.listBody}>
        <p className={styles.note}>{t('projectList.deletedHint')}</p>
        {restore.error ? <ProblemMessage code={problemCode(restore.error)} /> : null}
        {deleted.data.length === 0 ? (
          <p className={styles.muted}>{t('projectList.deletedEmpty')}</p>
        ) : null}
      </div>
      {deleted.data.length === 0 ? null : (
        <DataTable
          columns={[
            {
              id: 'name',
              header: t('projectList.col.name'),
              sortValue: (p) => p.name,
              nowrap: true,
              cell: (p) => p.name,
            },
            {
              id: 'deletedAt',
              header: t('projectList.col.deletedAt'),
              sortValue: (p) => p.deletedAt,
              nowrap: true,
              priority: 2,
              cell: (p) => (p.deletedAt ? when(p.deletedAt) : '–'),
            },
            {
              id: 'rig',
              header: t('projectEditor.rig'),
              sortValue: (p) => (rigs.data ?? []).find((r) => r.id === p.rigId)?.name ?? null,
              priority: 3,
              cell: (p) => (rigs.data ?? []).find((r) => r.id === p.rigId)?.name ?? '–',
            },
            {
              id: 'creator',
              header: t('projectList.col.creator'),
              sortValue: (p) => p.createdByName,
              priority: 3,
              cell: (p) => <Person id={p.createdBy} name={p.createdByName} />,
            },
            {
              id: 'actions',
              header: t('projectList.col.actions'),
              headerHidden: true,
              cell: (p) => (
                <button
                  type="button"
                  className={styles.button}
                  disabled={restore.isPending}
                  onClick={() => restore.mutate(p.id)}
                >
                  <actionIcons.restore size={ICON_SIZE.button} aria-hidden />
                  {t('projectList.restore')}
                </button>
              ),
            },
          ]}
          rows={deleted.data}
          rowKey={(p) => p.id}
          rowLabel={(p) => p.name}
          label={t('projectList.trash')}
          defaultSort={{ id: 'deletedAt', dir: 'desc' }}
        />
      )}
    </>
  );
}
