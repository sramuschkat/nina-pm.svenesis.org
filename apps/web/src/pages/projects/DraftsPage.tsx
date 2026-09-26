/**
 * S-34 Entwürfe (FK 14.3, FA-BER-02; AP-12b, nur Admin): Entwürfe und zurückgegebene Objekte aller
 * Mitglieder mit Ersteller und „zuletzt geändert“ (Mandantenzeit mit Kürzel); Öffnen im Projekt-Editor.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { approvalApi, type ProjectListItem } from '../../api/client';
import { useAuth, useCan } from '../../auth';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { ProblemMessage } from '../../components/ProblemMessage';
import { StatusBadge } from '../../components/StatusBadge';
import { formatDateTime } from '../../lib/time';
import { problemCode } from '../equipment/shared';
import { ProjectsLayout } from './ProjectsLayout';
import { ProjectThumb } from './ProjectImage';
import styles from './projects.module.css';

export function DraftsPage() {
  const { t, i18n } = useTranslation();
  const { me } = useAuth();
  const canAdmin = useCan('queue.decide');
  const drafts = useQuery({
    queryKey: ['projects', 'drafts'],
    queryFn: async () => (await approvalApi.drafts()).items,
    enabled: canAdmin,
  });
  const zone = me?.tenant?.timeZone ?? 'UTC';
  const columns: DataColumn<ProjectListItem>[] = [
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
      cell: (p) => <Link to={`/projekte/${p.id}`}>{p.name}</Link>,
    },
    {
      id: 'status',
      header: t('projectList.col.status'),
      sortValue: (p) => p.approvalStatus,
      priority: 2,
      cell: (p) => <StatusBadge kind="approval" value={p.approvalStatus} size="sm" />,
    },
    {
      id: 'creator',
      header: t('projectList.col.creator'),
      sortValue: (p) => p.createdByName,
      priority: 2,
      cell: (p) => p.createdByName,
    },
    {
      id: 'updatedAt',
      header: t('drafts.updatedAt'),
      sortValue: (p) => p.updatedAt,
      nowrap: true,
      cell: (p) => formatDateTime(p.updatedAt, zone, i18n.language),
    },
  ];
  return (
    <ProjectsLayout title={t('drafts.title')} meta={canAdmin ? t('drafts.hint') : undefined}>
      {!canAdmin ? (
        <ProblemMessage code={me?.mfaRequired ? 'auth.mfa_required' : 'permission.denied'} />
      ) : drafts.isError ? (
        <ProblemMessage code={problemCode(drafts.error)} onRetry={() => void drafts.refetch()} />
      ) : drafts.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : (
        <div className={styles.listCard}>
          {drafts.data.length === 0 ? (
            <div className={styles.listBody}>
              <p className={styles.muted}>{t('drafts.empty')}</p>
            </div>
          ) : (
            <DataTable
              columns={columns}
              rows={drafts.data}
              rowKey={(p) => p.id}
              rowLabel={(p) => p.name}
              label={t('drafts.title')}
            />
          )}
        </div>
      )}
    </ProjectsLayout>
  );
}
