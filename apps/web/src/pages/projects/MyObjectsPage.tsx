/**
 * S-32 Meine Objekte (FK 14.3, FA-FRG-13/15; AP-12b): Reiter nach Freigabestatus. Im Reiter
 * *Eingereicht* die ziehbare Rangliste (Griff, Rang, Objekt, Stimmen, Frist) mit Pfeilen als
 * Tastaturweg und *Zurückziehen*; sonst Karten mit Fortschritt, Plan je Filter, letztem Kommentar der
 * Freigabe und – für Entwürfe und zurückgegebene Objekte – *Einreichen*. Prognose folgt mit AP-13e.
 */
import { approvalStatuses, type ApprovalStatus } from '@nina-pm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { approvalApi, projectsApi, type ProjectListItem, type QueueItem } from '../../api/client';
import { useAuth } from '../../auth';
import { ICON_SIZE, actionIcons, uiIcons } from '../../components/icons';
import { ProblemMessage } from '../../components/ProblemMessage';
import { ProgressBar } from '../../components/ProgressBar';
import { EffortChip } from '../../components/EffortChip';
import { StatusBadge } from '../../components/StatusBadge';
import { Tabs } from '../../components/Tabs';
import { formatDateTime } from '../../lib/time';
import { problemCode, useEquipmentList, useNumber } from '../equipment/shared';
import { FilterPlan } from './ProjectListPage';
import { ProjectsLayout } from './ProjectsLayout';
import { SubmitPanel } from './SubmitPanel';
import styles from './projects.module.css';

const MINE_KEY = ['projects', 'mine'] as const;
export const QUEUE_KEY = ['projects', 'queue'] as const;

/** Neue Reihenfolge nach Verschieben von `id` an `index` (0-basiert). */
export function reorder(ids: readonly string[], id: string, index: number): string[] {
  const rest = ids.filter((x) => x !== id);
  rest.splice(Math.max(0, Math.min(index, rest.length)), 0, id);
  return rest;
}

export function MyObjectsPage() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const mine = useQuery({
    queryKey: MINE_KEY,
    queryFn: async () => (await projectsApi.list('?mine=true')).items,
  });
  const queue = useQuery({
    queryKey: QUEUE_KEY,
    queryFn: async () => (await approvalApi.queue()).items,
  });
  const items = mine.data ?? [];
  const counts = Object.fromEntries(
    approvalStatuses.map((s) => [s, items.filter((p) => p.approvalStatus === s).length]),
  ) as Record<ApprovalStatus, number>;
  const [tab, setTab] = useState<ApprovalStatus | null>(null);
  const active: ApprovalStatus = tab ?? (counts.submitted > 0 ? 'submitted' : 'draft');
  const own = (queue.data ?? [])
    .filter((q) => q.createdBy === me?.member?.id)
    .sort((a, b) => (a.submitterRank?.rank ?? 0) - (b.submitterRank?.rank ?? 0));

  return (
    <ProjectsLayout title={t('myObjects.title')}>
      {mine.isError ? (
        <ProblemMessage code={problemCode(mine.error)} onRetry={() => void mine.refetch()} />
      ) : mine.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : (
        <Tabs
          label={t('myObjects.tabs')}
          tabs={approvalStatuses.map((s) => ({
            key: s,
            label: `${t(`status.approval.${s}`)} (${String(counts[s])})`,
          }))}
          value={active}
          onChange={setTab}
          panelClassName={styles.tabPanel}
          panels={{
            [active]:
              active === 'submitted' ? (
                <RankedList entries={own} projects={items} loading={queue.isPending} />
              ) : (
                <ObjectCards items={items.filter((p) => p.approvalStatus === active)} />
              ),
          }}
        />
      )}
    </ProjectsLayout>
  );
}

// ---- Eingereicht: Rangliste (FA-FRG-15) -----------------------------------------------------------

function RankedList({
  entries,
  projects,
  loading,
}: {
  entries: readonly QueueItem[];
  projects: readonly ProjectListItem[];
  loading: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { me } = useAuth();
  const client = useQueryClient();
  const zone = me?.tenant?.timeZone ?? 'UTC';
  const [dragId, setDragId] = useState<string | null>(null);
  const ids = entries.map((e) => e.id);
  const refresh = () => client.invalidateQueries({ queryKey: ['projects'] });
  const ranking = useMutation({
    mutationFn: (order: string[]) => approvalApi.ranking(order),
    onSuccess: refresh,
  });
  const withdraw = useMutation({
    mutationFn: (e: QueueItem) => approvalApi.withdraw(e.id, e.version),
    onSuccess: refresh,
  });
  if (loading) return <p role="status">{t('common.loading')}</p>;
  if (entries.length === 0) return <p className={styles.muted}>{t('myObjects.noneSubmitted')}</p>;
  const move = (id: string, index: number) => ranking.mutate(reorder(ids, id, index));
  const onDrop = (e: DragEvent, target: string) => {
    e.preventDefault();
    if (dragId && dragId !== target) move(dragId, ids.indexOf(target));
    setDragId(null);
  };
  return (
    <>
      <p className={styles.muted}>{t('myObjects.rankHint')}</p>
      {[ranking.error, withdraw.error].map((e, i) =>
        e ? <ProblemMessage key={i} code={problemCode(e)} /> : null,
      )}
      <ol className={styles.rankList} aria-label={t('myObjects.ranking')}>
        {entries.map((e, index) => {
          const project = projects.find((p) => p.id === e.id);
          return (
            <li
              key={e.id}
              draggable
              data-dragging={dragId === e.id}
              onDragStart={() => setDragId(e.id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(ev) => ev.preventDefault()}
              onDrop={(ev) => onDrop(ev, e.id)}
              className={styles.rankItem}
            >
              <span className={styles.dragHandle} aria-hidden>
                <uiIcons.drag size={ICON_SIZE.table} />
              </span>
              <span className={styles.rankNo}>{index + 1}</span>
              <span className={styles.rankName}>
                <Link to={`/projekte/${e.id}`}>{e.name}</Link>
              </span>
              <span title={e.votes.voters.map((v) => v.displayName).join(', ')}>
                {t('myObjects.votes', { count: e.votes.count })}
              </span>
              <span className={styles.muted}>
                {e.expiresAt
                  ? t('myObjects.deadline', {
                      at: formatDateTime(e.expiresAt, zone, i18n.language),
                    })
                  : t('myObjects.noDeadline')}
              </span>
              <span className={styles.rowActions}>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={t('projectList.up', { name: e.name })}
                  disabled={index === 0 || ranking.isPending}
                  onClick={() => move(e.id, index - 1)}
                >
                  <uiIcons.up size={ICON_SIZE.table} aria-hidden />
                </button>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={t('projectList.down', { name: e.name })}
                  disabled={index === entries.length - 1 || ranking.isPending}
                  onClick={() => move(e.id, index + 1)}
                >
                  <uiIcons.down size={ICON_SIZE.table} aria-hidden />
                </button>
                <button
                  type="button"
                  className={styles.button}
                  disabled={withdraw.isPending}
                  onClick={() => withdraw.mutate(e)}
                >
                  <actionIcons.return size={ICON_SIZE.table} aria-hidden />
                  {t('approvalFlow.withdraw')}
                </button>
              </span>
              {project ? (
                <span className={styles.rankPlan}>
                  <FilterPlanLite project={project} />
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </>
  );
}

function FilterPlanLite({ project }: { project: ProjectListItem }) {
  const filters = useEquipmentList('filters');
  return <FilterPlan project={project} filters={filters.data ?? []} />;
}

// ---- Übrige Reiter: Karten ------------------------------------------------------------------------

function ObjectCards({ items }: { items: readonly ProjectListItem[] }) {
  const { t } = useTranslation();
  if (items.length === 0) return <p className={styles.muted}>{t('myObjects.empty')}</p>;
  return (
    <div className={styles.cards}>
      {items.map((p) => (
        <ObjectCard key={p.id} project={p} />
      ))}
    </div>
  );
}

function ObjectCard({ project: p }: { project: ProjectListItem }) {
  const { t } = useTranslation();
  const num = useNumber();
  const client = useQueryClient();
  const rigs = useEquipmentList('rigs');
  const filters = useEquipmentList('filters');
  const [submitting, setSubmitting] = useState(false);
  const showComment = p.approvalStatus === 'returned' || p.approvalStatus === 'rejected';
  const history = useQuery({
    queryKey: ['project-history', p.id],
    queryFn: async () => (await projectsApi.history(p.id)).items,
    enabled: showComment,
  });
  const decision = (history.data ?? []).find(
    (h) => h.kind === 'approval' && ['returned', 'rejected', 'expired'].includes(h.action),
  );
  const canSubmit = p.approvalStatus === 'draft' || p.approvalStatus === 'returned';
  return (
    <article className={styles.objectCard} aria-label={p.name}>
      <div className={styles.cardMain}>
        <h3 className={styles.cardTitle}>
          <Link to={`/projekte/${p.id}`}>{p.name}</Link>
          <StatusBadge kind="approval" value={p.approvalStatus} size="sm" />
          {p.status ? <StatusBadge kind="project" value={p.status} size="sm" /> : null}
          <EffortChip effort={p.effort} stale={p.effortStale} size="sm" />
        </h3>
        {showComment && decision ? (
          <p className={styles.note}>
            {decision.action === 'expired'
              ? t('myObjects.expired')
              : t('myObjects.comment', { comment: decision.comment ?? '' })}
          </p>
        ) : null}
        <ProgressBar
          acquired={Math.round((p.progress.percentDone / 100) * 1000)}
          planned={1000}
          showLabel={false}
        />
        <span className={styles.muted}>
          {t('projectList.progress', { pct: num(p.progress.percentDone, 0) })}
          {p.approvalStatus === 'approved' ? ` · ${t('myObjects.forecastLater')}` : ''}
        </span>
        {canSubmit && !submitting ? (
          <div>
            <button
              type="button"
              className={styles.buttonPrimary}
              onClick={() => setSubmitting(true)}
            >
              <actionIcons.submit size={ICON_SIZE.button} aria-hidden />
              {t('approvalFlow.submit')}
            </button>
          </div>
        ) : null}
        {submitting ? (
          <SubmitPanel
            project={{
              id: p.id,
              name: p.name,
              version: p.version,
              rigId: p.rigId,
              requestPeriodFrom: p.requestPeriodFrom,
              requestPeriodTo: p.requestPeriodTo,
              requestComment: p.requestComment,
            }}
            rigs={rigs.data ?? []}
            onDone={() => {
              setSubmitting(false);
              void client.invalidateQueries({ queryKey: ['projects'] });
            }}
            onCancel={() => setSubmitting(false)}
          />
        ) : null}
      </div>
      <div className={styles.cardPlan}>
        <FilterPlan project={p} filters={filters.data ?? []} />
      </div>
    </article>
  );
}
