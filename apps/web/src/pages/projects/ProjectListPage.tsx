/**
 * S-30 Projektliste (FK 14.3, FA-PRJ-13/14/15/16/19; AP-11c): Filterleiste (Rig, Objekttyp, Ersteller,
 * Freigabestatus, Projektstatus, Favoriten, Aufwand als Platzhalter bis AP-13e), Ansichten
 * Liste/Karten/Detail, Gruppen je Rig mit Kopfzeile und Zählern je Status, Priorität per Ziehen bzw.
 * Pfeilen (nur Admin, freigegebene Projekte), Projektkarte mit Reitern *Zielinfo* und *Höhenkurve*, Plan je
 * Filter und Fortschritt; *Löschen* über `ConfirmDialog`. Ansicht *Gelöscht* (Admin/Owner) mit
 * Löschzeitpunkt in Mandantenzeit, Rig, Ersteller und *Wiederherstellen* ohne Dialog (E4).
 */
import { approvalStatuses, formatTzAbbr, projectStatuses } from '@nina-pm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  equipmentApi,
  projectsApi,
  type FilterView,
  type ProjectListItem,
  type RigView,
  type SiteView,
} from '../../api/client';
import { useAuth, useCan } from '../../auth';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { formatCoordinate } from '../../components/CoordinateInput/coords';
import { FilterChip } from '../../components/FilterChip';
import { ICON_SIZE, actionIcons, uiIcons } from '../../components/icons';
import { NightChart } from '../../components/night-chart';
import { ProblemMessage, problemI18nKey } from '../../components/ProblemMessage';
import { ProgressBar } from '../../components/ProgressBar';
import { StatusBadge } from '../../components/StatusBadge';
import { nightChartFromEngine } from '../../lib/night-chart-data';
import { problemCode, useEquipmentList, useNumber } from '../equipment/shared';
import {
  NO_FILTERS,
  NO_RIG,
  filterOptions,
  filterProjects,
  groupByRig,
  movedPosition,
  type ListFilters,
} from './list-model';
import { engineMoonProfile } from './model';
import { ProjectsLayout } from './ProjectsLayout';
import styles from './projects.module.css';

type View = 'list' | 'cards' | 'detail';
const LIST_KEY = ['projects', 'list'] as const;
const DELETED_KEY = ['projects', 'deleted'] as const;

export function ProjectListPage() {
  const { t } = useTranslation();
  const canAdmin = useCan('project.status');
  const [tab, setTab] = useState<'active' | 'deleted'>('active');
  const baseId = useId();
  return (
    <ProjectsLayout title={t('projectList.title')}>
      {canAdmin ? (
        <div className={styles.tabs} role="tablist" aria-label={t('projectList.views')}>
          {(['active', 'deleted'] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`${baseId}-${key}`}
              aria-selected={tab === key}
              aria-controls={`${baseId}-panel`}
              className={styles.tab}
              onClick={() => setTab(key)}
            >
              <span className={styles.tabIcon}>
                {key === 'deleted' ? (
                  <actionIcons.deleted size={ICON_SIZE.table} aria-hidden />
                ) : null}
                {t(`projectList.tab.${key}`)}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <div
        role={canAdmin ? 'tabpanel' : undefined}
        id={`${baseId}-panel`}
        aria-labelledby={canAdmin ? `${baseId}-${tab}` : undefined}
        className={styles.stack}
      >
        {tab === 'deleted' && canAdmin ? <DeletedView /> : <ActiveView />}
      </div>
    </ProjectsLayout>
  );
}

// ---- Liste --------------------------------------------------------------------------------------

function ActiveView() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const canAdmin = useCan('project.status');
  const list = useQuery({
    queryKey: LIST_KEY,
    queryFn: async () => (await projectsApi.list()).items,
  });
  const rigs = useEquipmentList('rigs');
  const sites = useEquipmentList('sites');
  const telescopes = useEquipmentList('telescopes');
  const cameras = useEquipmentList('cameras');
  const filtersList = useEquipmentList('filters');
  const [filters, setFilters] = useState<ListFilters>(NO_FILTERS);
  const [view, setView] = useState<View>('list');
  const [remove, setRemove] = useState<ProjectListItem | null>(null);
  const ids = {
    rig: useId(),
    type: useId(),
    creator: useId(),
    approval: useId(),
    status: useId(),
    effort: useId(),
  };

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

  const items = list.data ?? [];
  const options = useMemo(() => filterOptions(items), [items]);
  const shown = filterProjects(items, filters);
  const groups = groupByRig(
    shown,
    (rigs.data ?? []).map((r) => r.id),
  );
  const set = <K extends keyof ListFilters>(key: K, value: ListFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));

  if (list.isError)
    return <ProblemMessage code={problemCode(list.error)} onRetry={() => void list.refetch()} />;
  if (list.isPending) return <p role="status">{t('common.loading')}</p>;

  const rigLabel = (rigId: string) => {
    if (rigId === NO_RIG) return t('projectList.noRig');
    const rig = (rigs.data ?? []).find((r) => r.id === rigId);
    if (!rig) return t('projectList.unknownRig');
    const site = (sites.data ?? []).find((s) => s.id === rig.siteId)?.name;
    const tel = (telescopes.data ?? []).find((s) => s.id === rig.telescopeId)?.name;
    const cam = (cameras.data ?? []).find((s) => s.id === rig.cameraId)?.name;
    return [rig.name, site, tel, cam].filter(Boolean).join(' · ');
  };

  return (
    <>
      <fieldset className={styles.filterBar}>
        <legend>{t('projectList.filters')}</legend>
        <label htmlFor={ids.rig}>
          {t('projectList.filter.rig')}
          <select
            id={ids.rig}
            className={styles.input}
            value={filters.rigId}
            onChange={(e) => set('rigId', e.target.value)}
          >
            <option value="">{t('projectList.all')}</option>
            {(rigs.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
            <option value={NO_RIG}>{t('projectList.noRig')}</option>
          </select>
        </label>
        <label htmlFor={ids.type}>
          {t('projectList.filter.type')}
          <select
            id={ids.type}
            className={styles.input}
            value={filters.targetType}
            onChange={(e) => set('targetType', e.target.value)}
          >
            <option value="">{t('projectList.all')}</option>
            {options.targetTypes.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={ids.creator}>
          {t('projectList.filter.creator')}
          <select
            id={ids.creator}
            className={styles.input}
            value={filters.createdBy}
            onChange={(e) => set('createdBy', e.target.value)}
          >
            <option value="">{t('projectList.all')}</option>
            {options.creators.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={ids.approval}>
          {t('projectList.filter.approval')}
          <select
            id={ids.approval}
            className={styles.input}
            value={filters.approvalStatus}
            onChange={(e) => set('approvalStatus', e.target.value)}
          >
            <option value="">{t('projectList.all')}</option>
            {approvalStatuses.map((s) => (
              <option key={s} value={s}>
                {t(`status.approval.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={ids.status}>
          {t('projectList.filter.status')}
          <select
            id={ids.status}
            className={styles.input}
            value={filters.status}
            onChange={(e) => set('status', e.target.value)}
          >
            <option value="">{t('projectList.all')}</option>
            {projectStatuses.map((s) => (
              <option key={s} value={s}>
                {t(`status.project.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={ids.effort}>
          {t('projectList.filter.effort')}
          <select
            id={ids.effort}
            className={styles.input}
            disabled
            title={t('projectEditor.effortHint')}
          >
            <option>{t('projectList.effortLater')}</option>
          </select>
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={filters.favorites}
            onChange={(e) => set('favorites', e.target.checked)}
          />
          {t('projectList.filter.favorites')}
        </label>
      </fieldset>
      <div className={styles.planHead}>
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
        {canAdmin ? <span className={styles.muted}>{t('projectList.priorityHint')}</span> : null}
        <span className={styles.muted} role="status">
          {t('projectList.count', { n: shown.length, total: items.length })}
        </span>
      </div>
      {[favorite.error, priority.error].map((e, i) =>
        e ? <ProblemMessage key={i} code={problemCode(e)} /> : null,
      )}
      {items.length === 0 ? (
        <p className={styles.note}>{t('projectList.empty')}</p>
      ) : shown.length === 0 ? (
        <p className={styles.note}>{t('projectList.noMatch')}</p>
      ) : (
        groups.map((g) => (
          <section key={g.rigId} className={styles.group} aria-label={rigLabel(g.rigId)}>
            <div className={styles.groupHead}>
              <h2>{rigLabel(g.rigId)}</h2>
              <span className={styles.muted}>
                {g.counts
                  .map((c) => `${String(c.n)} ${t(`status.${c.kind}.${c.key}`)}`)
                  .join(' · ')}
              </span>
            </div>
            {view === 'list' ? (
              <ProjectTable
                items={g.items}
                filters={filtersList.data ?? []}
                onFavorite={(id, on) => favorite.mutate({ id, on })}
                onDelete={setRemove}
                onMove={(id, delta) => {
                  const position = movedPosition(g.items, id, delta);
                  if (position !== null) priority.mutate({ id, position });
                }}
                onDropAt={(id, position) => priority.mutate({ id, position })}
              />
            ) : (
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
            )}
          </section>
        ))
      )}
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
          setRemove(null);
          del.reset();
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

function ProjectTable({
  items,
  filters,
  onFavorite,
  onDelete,
  onMove,
  onDropAt,
}: {
  items: readonly ProjectListItem[];
  filters: readonly FilterView[];
  onFavorite: (id: string, on: boolean) => void;
  onDelete: (p: ProjectListItem) => void;
  onMove: (id: string, delta: number) => void;
  onDropAt: (id: string, position: number) => void;
}) {
  const { t } = useTranslation();
  const canAdmin = useCan('project.status');
  const canFavorite = useCan('me.favorites');
  const [dragId, setDragId] = useState<string | null>(null);
  const approved = items.filter((p) => p.approvalStatus === 'approved');
  const onDrop = (e: DragEvent, target: ProjectListItem) => {
    e.preventDefault();
    const index = approved.findIndex((p) => p.id === target.id);
    if (dragId && index >= 0 && dragId !== target.id) onDropAt(dragId, index + 1);
    setDragId(null);
  };
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {canAdmin ? <th scope="col">{t('projectList.col.priority')}</th> : null}
            <th scope="col">{t('projectList.col.name')}</th>
            <th scope="col">{t('projectList.col.status')}</th>
            <th scope="col">{t('projectList.col.type')}</th>
            <th scope="col">{t('projectList.col.coordinates')}</th>
            <th scope="col">{t('projectList.col.progress')}</th>
            <th scope="col">{t('projectList.col.plan')}</th>
            <th scope="col">{t('projectList.col.creator')}</th>
            <th scope="col">{t('projectList.col.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => {
            const isApproved = p.approvalStatus === 'approved';
            const index = approved.findIndex((x) => x.id === p.id);
            return (
              <tr
                key={p.id}
                draggable={canAdmin && isApproved}
                data-dragging={dragId === p.id}
                onDragStart={() => setDragId(p.id)}
                onDragEnd={() => setDragId(null)}
                onDragOver={(e) => (canAdmin && isApproved ? e.preventDefault() : undefined)}
                onDrop={(e) => onDrop(e, p)}
              >
                {canAdmin ? (
                  <td className={styles.priorityCell}>
                    {isApproved ? (
                      <>
                        <span className={styles.dragHandle} aria-hidden>
                          {index + 1}
                        </span>
                        <button
                          type="button"
                          className={styles.iconButton}
                          aria-label={t('projectList.up', { name: p.name })}
                          disabled={index === 0}
                          onClick={() => onMove(p.id, -1)}
                        >
                          <uiIcons.up size={ICON_SIZE.table} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className={styles.iconButton}
                          aria-label={t('projectList.down', { name: p.name })}
                          disabled={index === approved.length - 1}
                          onClick={() => onMove(p.id, 1)}
                        >
                          <uiIcons.down size={ICON_SIZE.table} aria-hidden />
                        </button>
                      </>
                    ) : (
                      '–'
                    )}
                  </td>
                ) : null}
                <td>
                  <Link to={`/projekte/${p.id}`}>{p.name}</Link>
                </td>
                <td>
                  <span className={styles.badges}>
                    {p.status ? <StatusBadge kind="project" value={p.status} size="sm" /> : null}
                    {p.approvalStatus !== 'approved' ? (
                      <StatusBadge kind="approval" value={p.approvalStatus} size="sm" />
                    ) : null}
                  </span>
                </td>
                <td>{p.targetType ?? '–'}</td>
                <td className={styles.coords}>{coords(p)}</td>
                <td>
                  <ProgressBar
                    acquired={Math.round((p.progress.percentDone / 100) * 1000)}
                    planned={1000}
                    size="sm"
                    showLabel={false}
                  />
                  <span
                    className={styles.muted}
                  >{`${String(Math.round(p.progress.percentDone))} %`}</span>
                </td>
                <td>
                  <FilterPlan project={p} filters={filters} />
                </td>
                <td>{p.createdByName}</td>
                <td>
                  <RowActions
                    project={p}
                    canFavorite={canFavorite}
                    onFavorite={onFavorite}
                    onDelete={onDelete}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
  const canDelete = useCan('project.delete', {
    createdBy: project.createdBy,
    approvalStatus: project.approvalStatus,
  });
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
      {canDelete ? (
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t('projectList.deleteFor', { name: project.name })}
          onClick={() => onDelete(project)}
        >
          <actionIcons.delete size={ICON_SIZE.table} aria-hidden />
        </button>
      ) : null}
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
        <div className={styles.thumb}>{t('projectList.thumbLater')}</div>
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
          <span className={styles.effort} title={t('projectEditor.effortHint')}>
            {t('projectEditor.effortPending')}
          </span>
        </h3>
        <div className={styles.tabs} role="tablist" aria-label={t('projectList.cardTabs')}>
          {(['info', 'altitude'] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`${baseId}-${key}`}
              aria-selected={tab === key}
              aria-controls={`${baseId}-panel`}
              className={styles.tab}
              onClick={() => setTab(key)}
            >
              {t(`projectList.cardTab.${key}`)}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-${tab}`}>
          {tab === 'info' ? (
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
          ) : (
            <AltitudeCurve project={p} site={site} />
          )}
        </div>
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
    <NightChart {...chart} height={140} />
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
      <ProblemMessage code={problemCode(deleted.error)} onRetry={() => void deleted.refetch()} />
    );
  if (deleted.isPending) return <p role="status">{t('common.loading')}</p>;
  return (
    <>
      <p className={styles.note}>{t('projectList.deletedHint')}</p>
      {restore.error ? <ProblemMessage code={problemCode(restore.error)} /> : null}
      {deleted.data.length === 0 ? (
        <p className={styles.muted}>{t('projectList.deletedEmpty')}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t('projectList.col.name')}</th>
                <th scope="col">{t('projectList.col.deletedAt')}</th>
                <th scope="col">{t('projectEditor.rig')}</th>
                <th scope="col">{t('projectList.col.creator')}</th>
                <th scope="col">{t('projectList.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {deleted.data.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.deletedAt ? when(p.deletedAt) : '–'}</td>
                  <td>{(rigs.data ?? []).find((r) => r.id === p.rigId)?.name ?? '–'}</td>
                  <td>{p.createdByName}</td>
                  <td>
                    <button
                      type="button"
                      className={styles.button}
                      disabled={restore.isPending}
                      onClick={() => restore.mutate(p.id)}
                    >
                      <actionIcons.restore size={ICON_SIZE.button} aria-hidden />
                      {t('projectList.restore')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
