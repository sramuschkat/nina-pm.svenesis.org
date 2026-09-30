/**
 * *Meine Rangfolge* in der Warteschlange (S-33, FA-FRG-15; bis 30.09.2026 Reiter *Eingereicht* von „Meine
 * Objekte“): eigene eingereichte Objekte und offene Änderungsanträge (AP-32b) als ziehbare Rangliste (Griff,
 * Rang, Objekt, Stimmen, Frist) mit Pfeilen als Tastaturweg und *Zurückziehen*.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  approvalApi,
  changeRequestsApi,
  projectsApi,
  type ProjectListItem,
  type QueueItem,
} from '../../api/client';
import { useAuth } from '../../auth';
import { ICON_SIZE, actionIcons, uiIcons } from '../../components/icons';
import { ProblemMessage } from '../../components/ProblemMessage';
import { formatDateTime } from '../../lib/time';
import { problemCode, useEquipmentList } from '../equipment/shared';
import { FilterPlan } from './ProjectListPage';
import styles from './projects.module.css';

/** Neue Reihenfolge nach Verschieben von `id` an `index` (0-basiert). */
export function reorder(ids: readonly string[], id: string, index: number): string[] {
  const rest = ids.filter((x) => x !== id);
  rest.splice(Math.max(0, Math.min(index, rest.length)), 0, id);
  return rest;
}

export function SubmissionRanking({
  entries,
  loading,
}: {
  /** Eigene Einreichungen und offene Änderungsanträge, nach Rang sortiert (ohne Transit). */
  entries: readonly QueueItem[];
  loading: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { me } = useAuth();
  const client = useQueryClient();
  const zone = me?.tenant?.timeZone ?? 'UTC';
  const [dragId, setDragId] = useState<string | null>(null);
  const ids = entries.map((e) => e.id);
  const refresh = () => client.invalidateQueries({ queryKey: ['projects'] });
  const kindOf = new Map(entries.map((e) => [e.id, e.kind]));
  // Plan je Filter der eigenen Projekte (Minibalken unter dem Eintrag).
  const mine = useQuery({
    queryKey: ['projects', 'mine'],
    queryFn: async () => (await projectsApi.list('?mine=true')).items,
  });
  const projects = mine.data ?? [];
  const ranking = useMutation({
    mutationFn: (order: string[]) =>
      approvalApi.ranking(
        order.map((id) => {
          const k = kindOf.get(id);
          return {
            kind: k === 'change-request' ? ('change-request' as const) : ('project' as const),
            id,
          };
        }),
      ),
    onSuccess: refresh,
  });
  // Offene Änderungsanträge (AP-32b) teilen sich die Rangfolge; Zurückziehen über den Antrag.
  const withdraw = useMutation({
    mutationFn: async (e: QueueItem): Promise<unknown> =>
      e.kind === 'change-request'
        ? changeRequestsApi.withdraw(e.id, e.version)
        : approvalApi.withdraw(e.id, e.version),
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
          const project = projects.find((p) => p.id === e.projectId);
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
                <Link to={`/projekte/${e.projectId}`}>{e.name}</Link>
                {e.kind === 'change-request' ? (
                  <span className={styles.muted}> · {t('changeRequests.badge')}</span>
                ) : null}
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
