/**
 * Status-Chips der Projektliste (S-30, FA-PRJ-19; Wunsch Sven 30.09.2026): *Alle* und je Status ein
 * Umschalter mit Anzahl – vor der Freigabe der Freigabestatus, danach der Projektstatus. Mehrfachauswahl;
 * Chips mit 0 bleiben sichtbar (gedämpft), damit die Zeile nicht springt. Punktfarbe wie `StatusBadge`.
 */
import { projectStatuses } from '@nina-pm/shared';
import { useTranslation } from 'react-i18next';
import { statusTone } from '../../components/StatusBadge';
import { PRE_APPROVAL_STATUSES, statusKind } from './list-model';
import styles from './projects.module.css';

export function StatusChips({
  total,
  counts,
  selected,
  onChange,
}: {
  /** Anzahl ohne Statusauswahl (Chip *Alle*). */
  total: number;
  counts: Readonly<Record<string, number>>;
  selected: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  const chip = (status: string) => {
    const kind = statusKind(status);
    const n = counts[status] ?? 0;
    const on = selected.includes(status);
    return (
      <button
        key={status}
        type="button"
        className={`${styles.statusChip} ${n === 0 && !on ? styles.statusChipEmpty : ''}`}
        aria-pressed={on}
        data-tone={statusTone(kind, status)}
        onClick={() => onChange(on ? selected.filter((s) => s !== status) : [...selected, status])}
      >
        <span className={styles.statusDot} aria-hidden />
        {t(`status.${kind}.${status}`)}
        <span className={styles.statusCount}>{n}</span>
      </button>
    );
  };
  return (
    <div className={styles.statusBar} role="group" aria-label={t('projectList.statusChips.label')}>
      <button
        type="button"
        className={styles.statusChip}
        aria-pressed={selected.length === 0}
        onClick={() => onChange([])}
      >
        {t('projectList.statusChips.all')}
        <span className={styles.statusCount}>{total}</span>
      </button>
      <div
        className={styles.statusGroup}
        role="group"
        aria-label={t('projectList.statusChips.before')}
      >
        <span className={styles.statusGroupLabel} aria-hidden>
          {t('projectList.statusChips.before')}
        </span>
        {PRE_APPROVAL_STATUSES.map(chip)}
      </div>
      <div
        className={styles.statusGroup}
        role="group"
        aria-label={t('projectList.statusChips.approved')}
      >
        <span className={styles.statusGroupLabel} aria-hidden>
          {t('projectList.statusChips.approved')}
        </span>
        {projectStatuses.map(chip)}
      </div>
    </div>
  );
}
