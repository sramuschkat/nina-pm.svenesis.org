/**
 * S-33 Entscheidung über einen Änderungsantrag (FK 14.3; FA-FRG-08; AP-32b, Admin): Antragsteller, Stimmen,
 * Begründung, Gegenüberstellung alt/neu gegen die **aktuelle** Fassung, Auswirkungsvorschau, *Annehmen*
 * und *Ablehnen* (Pflichtkommentar, Bestätigungsdialog). Die Entscheidung nennt die gesehene Projektversion;
 * hat sich das Projekt inzwischen geändert (`409 change_request.conflict`), lädt die Warteschlange neu und
 * zeigt die neue Gegenüberstellung.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { changeRequestsApi, type ChangeRequestDiffEntry, type QueueItem } from '../../api/client';
import { ApiError } from '../../auth';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ProblemMessage, problemI18nKey } from '../../components/ProblemMessage';
import { problemCode } from '../equipment/shared';
import { ChangeRequestDiffTable } from './ChangeRequestDiff';
import { ImpactPanel } from './ImpactPanel';
import styles from './projects.module.css';

export function ChangeRequestDecision({
  item,
  own,
  onDone,
}: {
  item: QueueItem;
  own: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const ids = { title: useId(), comment: useId() };
  const [comment, setComment] = useState('');
  const [commentMissing, setCommentMissing] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const info = item.changeRequest;
  const decide = useMutation({
    mutationFn: (decision: 'approved' | 'rejected') =>
      changeRequestsApi.decide(
        item.id,
        {
          decision,
          comment: comment.trim() || null,
          projectVersion: info?.projectVersion ?? 0,
        },
        item.version,
      ),
    onSuccess: onDone,
    onError: (error) => {
      // Projekt oder Antrag inzwischen geändert: neu laden, Gegenüberstellung gegen die aktuelle Fassung.
      if (
        error instanceof ApiError &&
        (error.problem.code === 'change_request.conflict' || error.problem.status === 412)
      )
        void client.invalidateQueries({ queryKey: ['projects', 'queue'] });
    },
  });
  if (!info) return null;
  const conflict =
    decide.error instanceof ApiError &&
    (decide.error.problem.code === 'change_request.conflict' ||
      decide.error.problem.status === 412);
  return (
    <section className={styles.decision} aria-labelledby={ids.title}>
      <h2 id={ids.title}>{t('changeRequests.decisionTitle', { name: item.name })}</h2>
      <dl className={styles.cardFacts}>
        <dt>{t('queue.col.creator')}</dt>
        <dd>{item.createdByName}</dd>
        <dt>{t('queue.col.votes')}</dt>
        <dd>
          {item.votes.count}
          {item.votes.voters.length > 0
            ? ` (${item.votes.voters.map((v) => v.displayName).join(', ')})`
            : ''}
        </dd>
        {item.requestComment ? (
          <>
            <dt>{t('changeRequests.comment')}</dt>
            <dd>{item.requestComment}</dd>
          </>
        ) : null}
      </dl>
      {own ? <p className={styles.note}>{t('queue.ownObject')}</p> : null}
      {info.projectChangedSince ? (
        <p className={styles.note} role="note">
          {t('changeRequests.projectChanged')}
        </p>
      ) : null}
      <ChangeRequestDiffTable
        diff={info.diff as ChangeRequestDiffEntry[]}
        caption={t('changeRequests.diffCaption')}
      />
      <ImpactPanel id={item.id} kind="change-request" />
      <div className={styles.field}>
        <label htmlFor={ids.comment}>{t('changeRequests.decisionCommentLabel')}</label>
        <textarea
          id={ids.comment}
          className={styles.input}
          rows={2}
          maxLength={4000}
          value={comment}
          aria-invalid={commentMissing}
          onChange={(e) => setComment(e.target.value)}
        />
        {commentMissing ? (
          <span className={styles.fieldError}>{t('changeRequests.commentRequired')}</span>
        ) : null}
      </div>
      <div className={styles.rowActions}>
        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={decide.isPending}
          onClick={() => decide.mutate('approved')}
        >
          {t('changeRequests.approve')}
        </button>
        <button
          type="button"
          className={styles.button}
          disabled={decide.isPending}
          onClick={() => {
            if (!comment.trim()) {
              setCommentMissing(true);
              return;
            }
            setCommentMissing(false);
            setConfirmReject(true);
          }}
        >
          {t('changeRequests.reject')}
        </button>
      </div>
      {conflict ? (
        <p className={styles.warning} role="alert">
          {t('changeRequests.decideConflict')}
        </p>
      ) : decide.error && !confirmReject ? (
        <ProblemMessage code={problemCode(decide.error)} />
      ) : null}
      <ConfirmDialog
        open={confirmReject}
        title={t('changeRequests.rejectTitle', { name: item.name })}
        consequence={t('changeRequests.rejectConsequence')}
        confirmLabel={t('changeRequests.reject')}
        variant="danger"
        state={decide.isPending ? 'loading' : decide.isError ? 'error' : 'ready'}
        {...(decide.error ? { errorKey: problemI18nKey(problemCode(decide.error)) } : {})}
        onConfirm={() =>
          decide
            .mutateAsync('rejected')
            .then(() => setConfirmReject(false))
            .catch(() => undefined)
        }
        onCancel={() => setConfirmReject(false)}
      />
    </section>
  );
}
