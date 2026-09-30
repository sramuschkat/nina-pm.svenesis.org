/**
 * Entscheidung über eine Transit-Bestätigung in der Warteschlange S-33 (AP-43; FA-EXO-18, FA-FRG-04/09):
 * Transit, Fenster und Frist des Rigs; *Festlegen* bzw. *Ablehnen* mit Begründung (Bestätigungsdialog). Der
 * Hinweis auf verdrängte reguläre Blöcke folgt mit AP-44 (Entscheidung Sven 30.09.2026).
 */
import { formatNightKey, formatTzAbbr, formatZonedTime } from '@nina-pm/shared';
import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { exoApi, type QueueItem } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ICON_SIZE, actionIcons } from '../../components/icons';
import { ProblemMessage, problemI18nKey } from '../../components/ProblemMessage';
import { formatDateTime } from '../../lib/time';
import { problemCode } from '../equipment/shared';
import styles from './projects.module.css';
import { Person } from '../../lib/member';

/** „22:39–04:51 CDT“ in Standortzeit (NT-03). */
export function transitWindowText(t: NonNullable<QueueItem['transit']>): string {
  if (!t.timeZone) return `${t.windowStartUtc} – ${t.windowEndUtc}`;
  return `${formatZonedTime(t.windowStartUtc, t.timeZone)}–${formatZonedTime(
    t.windowEndUtc,
    t.timeZone,
  )} ${formatTzAbbr(t.windowEndUtc, t.timeZone)}`;
}

export function TransitDecision({
  item,
  own,
  zone,
  onDone,
}: {
  item: QueueItem;
  own: boolean;
  /** Mandantenzeit für die Frist (FK 8.1: Fristen in der Mandantenzeit). */
  zone: string;
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation();
  const commentId = useId();
  const [comment, setComment] = useState('');
  const [missing, setMissing] = useState(false);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const tr = item.transit;
  const confirm = useMutation({ mutationFn: () => exoApi.confirm(item.id), onSuccess: onDone });
  const decline = useMutation({
    mutationFn: () => exoApi.decline(item.id, comment.trim()),
    onSuccess: onDone,
  });
  if (!tr) return null;
  return (
    <section className={styles.decision} aria-labelledby="transit-decision-title">
      <h2 id="transit-decision-title">
        {t('queue.transit.decisionTitle', { name: item.name, planet: tr.planet })}
      </h2>
      <dl className={styles.cardFacts}>
        <dt>{t('queue.col.creator')}</dt>
        <dd>
          <Person id={item.createdBy} name={item.createdByName} />
        </dd>
        <dt>{t('queue.transit.night')}</dt>
        <dd>
          {formatNightKey(tr.night)} · {transitWindowText(tr)}
        </dd>
        <dt>{t('queue.col.rig')}</dt>
        <dd>{tr.rigName ?? '–'}</dd>
        <dt>{t('queue.col.deadline')}</dt>
        <dd>{tr.deadlineUtc ? formatDateTime(tr.deadlineUtc, zone, i18n.language) : '–'}</dd>
        <dt>{t('queue.transit.planned')}</dt>
        <dd>{tr.plannedCount}</dd>
      </dl>
      {own ? <p className={styles.note}>{t('queue.ownObject')}</p> : null}
      <p className={styles.muted}>{t('queue.transit.displacedLater')}</p>
      <div className={styles.field}>
        <label htmlFor={commentId}>{t('queue.comment')}</label>
        <textarea
          id={commentId}
          className={styles.input}
          rows={2}
          maxLength={2000}
          value={comment}
          aria-invalid={missing ? true : undefined}
          aria-describedby={missing ? `${commentId}-error` : undefined}
          onChange={(e) => setComment(e.target.value)}
        />
        {missing ? (
          <span id={`${commentId}-error`} className={styles.fieldError}>
            {t('queue.commentRequired')}
          </span>
        ) : null}
      </div>
      {confirm.error ? <ProblemMessage code={problemCode(confirm.error)} /> : null}
      <div className={styles.rowActions}>
        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={confirm.isPending || own}
          onClick={() => confirm.mutate()}
        >
          <actionIcons.approve size={ICON_SIZE.button} aria-hidden />
          {t('queue.transit.confirm')}
        </button>
        <button
          type="button"
          className={styles.buttonDanger}
          disabled={decline.isPending || own}
          onClick={() => {
            if (!comment.trim()) {
              setMissing(true);
              return;
            }
            setMissing(false);
            setConfirmDecline(true);
          }}
        >
          <actionIcons.reject size={ICON_SIZE.button} aria-hidden />
          {t('queue.transit.decline')}
        </button>
      </div>
      <ConfirmDialog
        open={confirmDecline}
        title={t('queue.transit.declineTitle', { planet: tr.planet })}
        consequence={t('queue.transit.declineConsequence')}
        confirmLabel={t('queue.transit.decline')}
        variant="danger"
        state={decline.isPending ? 'loading' : decline.isError ? 'error' : 'ready'}
        {...(decline.error ? { errorKey: problemI18nKey(problemCode(decline.error)) } : {})}
        onConfirm={() =>
          decline
            .mutateAsync()
            .then(() => setConfirmDecline(false))
            .catch(() => undefined)
        }
        onCancel={() => setConfirmDecline(false)}
      />
    </section>
  );
}
