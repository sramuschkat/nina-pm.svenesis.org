/**
 * `StatusBadge` (components.md §2.8): Text ausschließlich über `status.<kind>.<value>`; Farbe aus einer
 * Tabelle hier. Unbekannter Wert → neutrale Farbe und roher Wert, kein Absturz. `effort` mit `null` → nichts.
 */
import { useTranslation } from 'react-i18next';
import styles from './StatusBadge.module.css';

export type StatusKind = 'project' | 'approval' | 'session' | 'transit' | 'effort';
type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'muted';

const TONES: Readonly<Record<StatusKind, Readonly<Record<string, Tone>>>> = {
  project: {
    planning: 'info',
    active: 'success',
    on_hold: 'warning',
    ready_to_process: 'info',
    unfinished: 'warning',
    completed: 'success',
    archived: 'muted',
  },
  approval: {
    draft: 'muted',
    submitted: 'info',
    approved: 'success',
    returned: 'warning',
    rejected: 'danger',
  },
  session: { running: 'info', completed: 'success', aborted: 'danger', stale: 'warning' },
  transit: {
    requested: 'info',
    locked: 'success',
    observed: 'success',
    missed: 'danger',
    cancelled: 'muted',
  },
  effort: { single_night: 'success', multi_night: 'info', not_feasible: 'danger', transit: 'info' },
};

export interface StatusBadgeProps {
  kind: StatusKind;
  value: string | null;
  size?: 'sm' | 'md';
  withTooltip?: boolean;
}

export function StatusBadge({ kind, value, size = 'md', withTooltip }: StatusBadgeProps) {
  const { t, i18n } = useTranslation();
  if (value === null || value === '') return null;
  const key = `status.${kind}.${value}`;
  const known = i18n.exists(key);
  const text = known ? t(key) : value;
  const tone: Tone = TONES[kind][value] ?? 'neutral';
  return (
    <span
      className={`${styles.badge} ${styles[tone]} ${size === 'sm' ? styles.sm : ''}`}
      title={withTooltip ? text : undefined}
      data-tone={tone}
    >
      {text}
    </span>
  );
}
