/** Fehleranzeige aus Problem Details über `errors.*`-i18n (rules/ui.md); 412 als Konflikthinweis. */
import { ERRORS, type ErrorCode } from '@nina-pm/shared';
import { useTranslation } from 'react-i18next';
import styles from './ProblemMessage.module.css';

export interface ProblemMessageProps {
  code: string;
  requestId?: string | undefined;
  onRetry?: (() => void) | undefined;
}

export function problemI18nKey(code: string): string {
  return code in ERRORS ? ERRORS[code as ErrorCode].i18nKey : 'common.unknownError';
}

export function ProblemMessage({ code, requestId, onRetry }: ProblemMessageProps) {
  const { t } = useTranslation();
  const text =
    code === 'resource.version_conflict' ? t('common.conflict') : t(problemI18nKey(code));
  return (
    <div className={styles.problem} role="alert">
      <p>{text}</p>
      {requestId ? <p className={styles.meta}>{t('common.requestId', { id: requestId })}</p> : null}
      {onRetry ? (
        <button type="button" className={styles.retry} onClick={onRetry}>
          {t('common.retry')}
        </button>
      ) : null}
    </div>
  );
}
