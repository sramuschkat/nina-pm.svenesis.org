/**
 * Einreichen (FA-FRG-02, S-31/S-32): Wunsch-Rig, gewünschter Zeitraum (Nacht-Schlüssel, NT-04) und
 * Begründung; Pflichtprüfung durch die API (`422 approval.incomplete` mit den fehlenden Angaben),
 * `If-Match` mit der Projektversion (412 → Hinweis). Formular im Seitenfluss statt Dialog.
 */
import { useMutation } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { approvalApi, type ProjectView, type RigView } from '../../api/client';
import { ApiError } from '../../auth';
import { ICON_SIZE, actionIcons } from '../../components/icons';
import { ProblemMessage } from '../../components/ProblemMessage';
import { problemCode } from '../equipment/shared';
import styles from './projects.module.css';

export interface SubmitTarget {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly rigId: string | null;
  readonly requestPeriodFrom: string | null;
  readonly requestPeriodTo: string | null;
  readonly requestComment: string | null;
}

export function SubmitPanel({
  project,
  rigs,
  onDone,
  onCancel,
}: {
  project: SubmitTarget;
  rigs: readonly RigView[];
  onDone: (view: ProjectView) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const ids = { rig: useId(), from: useId(), to: useId(), comment: useId() };
  const [rigId, setRigId] = useState(project.rigId ?? '');
  const [from, setFrom] = useState(project.requestPeriodFrom ?? '');
  const [to, setTo] = useState(project.requestPeriodTo ?? '');
  const [comment, setComment] = useState(project.requestComment ?? '');
  const submit = useMutation({
    mutationFn: () =>
      approvalApi.submit(
        project.id,
        {
          requestedRigId: rigId || null,
          requestPeriodFrom: from || null,
          requestPeriodTo: to || null,
          requestComment: comment.trim() || null,
        },
        project.version,
      ),
    onSuccess: onDone,
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit.mutate();
  };
  const missing =
    submit.error instanceof ApiError && submit.error.problem.code === 'approval.incomplete'
      ? (submit.error.problem.errors ?? []).map((x) => x.path)
      : [];
  return (
    <form
      className={styles.submitPanel}
      onSubmit={onSubmit}
      aria-label={t('approvalFlow.submitTitle', { name: project.name })}
    >
      <h3>{t('approvalFlow.submitTitle', { name: project.name })}</h3>
      <p className={styles.muted}>{t('approvalFlow.submitHint')}</p>
      <div className={styles.grid}>
        <div className={styles.field}>
          <label htmlFor={ids.rig}>{t('approvalFlow.wishRig')}</label>
          <select
            id={ids.rig}
            className={styles.input}
            value={rigId}
            onChange={(e) => setRigId(e.target.value)}
          >
            <option value="">{t('approvalFlow.noRig')}</option>
            {rigs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={ids.from}>{t('approvalFlow.periodFrom')}</label>
          <input
            id={ids.from}
            className={styles.input}
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={ids.to}>{t('approvalFlow.periodTo')}</label>
          <input
            id={ids.to}
            className={styles.input}
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>
      <div className={styles.field}>
        <label htmlFor={ids.comment}>{t('approvalFlow.reason')}</label>
        <textarea
          id={ids.comment}
          className={styles.input}
          rows={2}
          maxLength={4000}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>
      {missing.length > 0 ? (
        <div className={styles.warning} role="alert">
          <p>{t('approvalFlow.incomplete')}</p>
          <ul>
            {missing.map((m) => (
              <li key={m}>{t(`approvalFlow.missing.${m}`)}</li>
            ))}
          </ul>
        </div>
      ) : submit.error ? (
        <ProblemMessage code={problemCode(submit.error)} />
      ) : null}
      <div className={styles.rowActions}>
        <button type="submit" className={styles.buttonPrimary} disabled={submit.isPending}>
          <actionIcons.submit size={ICON_SIZE.button} aria-hidden />
          {t('approvalFlow.submit')}
        </button>
        <button type="button" className={styles.button} onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
