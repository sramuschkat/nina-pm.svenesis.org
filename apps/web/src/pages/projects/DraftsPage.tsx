/**
 * S-34 Entwürfe (FK 14.3, FA-BER-02; AP-12b, nur Admin): Entwürfe und zurückgegebene Objekte aller
 * Mitglieder mit Ersteller und „zuletzt geändert“ (Mandantenzeit mit Kürzel); Öffnen im Projekt-Editor.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { approvalApi } from '../../api/client';
import { useAuth, useCan } from '../../auth';
import { ProblemMessage } from '../../components/ProblemMessage';
import { StatusBadge } from '../../components/StatusBadge';
import { formatDateTime } from '../../lib/time';
import { problemCode } from '../equipment/shared';
import { ProjectsLayout } from './ProjectsLayout';
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
  return (
    <ProjectsLayout title={t('drafts.title')}>
      {!canAdmin ? (
        <ProblemMessage code={me?.mfaRequired ? 'auth.mfa_required' : 'permission.denied'} />
      ) : drafts.isError ? (
        <ProblemMessage code={problemCode(drafts.error)} onRetry={() => void drafts.refetch()} />
      ) : drafts.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : drafts.data.length === 0 ? (
        <p className={styles.muted}>{t('drafts.empty')}</p>
      ) : (
        <>
          <p className={styles.note}>{t('drafts.hint')}</p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('projectList.col.name')}</th>
                  <th scope="col">{t('projectList.col.status')}</th>
                  <th scope="col">{t('projectList.col.creator')}</th>
                  <th scope="col">{t('drafts.updatedAt')}</th>
                </tr>
              </thead>
              <tbody>
                {drafts.data.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/projekte/${p.id}`}>{p.name}</Link>
                    </td>
                    <td>
                      <StatusBadge kind="approval" value={p.approvalStatus} size="sm" />
                    </td>
                    <td>{p.createdByName}</td>
                    <td>{formatDateTime(p.updatedAt, zone, i18n.language)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </ProjectsLayout>
  );
}
