/**
 * `EffortChip` (FA-PRJ-23, FK 8.9; AP-13e): Aufwand-Kennzeichen „1 Nacht“ (grün), „ca. n Nächte“ (blau),
 * „nicht machbar (x %)“ (rot), „Transit“ (violett) bzw. „fertig“; veraltet mit „wird aktualisiert“.
 * Der Tooltip nennt benötigte Stunden, beste Nacht je Mondstufe, begrenzenden Faktor und frühestes Ende.
 * Rein darstellend: Daten nur über Eigenschaften (components.md §1), keine Rechteprüfung.
 */
import type { EffortView } from '@nina-pm/shared';
import { formatNightKey } from '@nina-pm/shared';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { actionIcons } from '../icons';
import styles from './EffortChip.module.css';

type Tone = 'success' | 'info' | 'danger' | 'violet' | 'muted';
type Effort = Pick<
  EffortView,
  | 'tag'
  | 'nights'
  | 'achievablePct'
  | 'requiredHours'
  | 'bestNight'
  | 'bestNightHoursByStage'
  | 'limitingFactor'
  | 'earliestCompletion'
  | 'fullyObservable'
  | 'coveragePct'
  | 'fromNight'
  | 'toNight'
>;

export interface EffortChipProps {
  /** Gespeichertes bzw. live gerechnetes Kennzeichen; `null` = noch nicht berechnet. */
  effort: Effort | null | undefined;
  /** `project.effortStale`: Kennzeichen veraltet, Neuberechnung läuft. */
  stale?: boolean;
  state?: 'loading' | 'empty' | 'error' | 'ready';
  size?: 'sm' | 'md';
  /** Live im Browser gerechnet (Projekt-Editor). */
  live?: boolean;
  onRetry?: () => void;
}

const TONES: Readonly<Record<string, Tone>> = {
  single_night: 'success',
  multi_night: 'info',
  not_feasible: 'danger',
  transit: 'violet',
};

const hours = (h: number, lang: string) =>
  new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'de-DE', { maximumFractionDigits: 1 }).format(h);

export function effortLabel(e: Effort, t: TFunction): string {
  switch (e.tag) {
    case null:
      return t('effort.done');
    case 'single_night':
      return t('effort.singleNight');
    case 'multi_night':
      return t('effort.multiNight', { count: e.nights ?? 0 });
    case 'not_feasible':
      return t('effort.notFeasible', { pct: e.achievablePct ?? 0 });
    case 'transit':
      if (e.fullyObservable === true) return t('effort.transitFull');
      if (e.fullyObservable === false)
        return t('effort.transitPartial', { pct: e.coveragePct ?? 0 });
      return t('effort.transit');
  }
}

export function effortTooltip(e: Effort, t: TFunction, lang: string): string {
  if (e.tag === null) return t('effort.done');
  const lines: string[] = [t('effort.tip.estimate')];
  if (e.tag === 'transit') {
    lines.push(
      e.coveragePct === null
        ? t('effort.tip.noWindow')
        : t('effort.tip.coverage', { pct: e.coveragePct }),
    );
    return lines.join('\n');
  }
  if (e.requiredHours !== null)
    lines.push(t('effort.tip.required', { hours: hours(e.requiredHours, lang) }));
  if (e.bestNight !== null && e.bestNightHoursByStage.length > 0)
    lines.push(
      t('effort.tip.best', {
        night: formatNightKey(e.bestNight),
        stages: e.bestNightHoursByStage
          .map((s) =>
            t('effort.tip.stage', { filters: s.filters.join('/'), hours: hours(s.hours, lang) }),
          )
          .join(' · '),
      }),
    );
  if (e.limitingFactor?.reason)
    lines.push(
      t('effort.tip.limiting', {
        filter: e.limitingFactor.filterShortName,
        reason: t(`effort.reason.${e.limitingFactor.reason}`),
      }),
    );
  if (e.earliestCompletion !== null)
    lines.push(t('effort.tip.earliest', { night: formatNightKey(e.earliestCompletion) }));
  if (e.fromNight !== null && e.toNight !== null)
    lines.push(
      t('effort.tip.period', { from: formatNightKey(e.fromNight), to: formatNightKey(e.toNight) }),
    );
  return lines.join('\n');
}

export function EffortChip({ effort, stale, state, size = 'md', live, onRetry }: EffortChipProps) {
  const { t, i18n } = useTranslation();
  const derived = state ?? (effort ? 'ready' : 'empty');
  const cls = `${styles.chip} ${size === 'sm' ? styles.sm : ''}`;
  if (derived === 'loading')
    return (
      <span className={`${cls} ${styles.skeleton}`} role="status" aria-busy="true">
        {t('effort.loading')}
      </span>
    );
  if (derived === 'error')
    return (
      <span className={`${cls} ${styles.muted}`} role="status">
        {t('effort.error')}
        {onRetry ? (
          <button type="button" className={styles.retry} onClick={onRetry}>
            {t('effort.retry')}
          </button>
        ) : null}
      </span>
    );
  if (derived === 'empty' || !effort)
    return (
      <span className={`${cls} ${styles.muted}`} data-state="empty">
        {stale ? t('effort.stale') : t('effort.pending')}
      </span>
    );
  const label = effortLabel(effort, t);
  const tip = [effortTooltip(effort, t, i18n.language), live ? t('effort.live') : null]
    .filter(Boolean)
    .join('\n');
  const tone: Tone = effort.tag === null ? 'muted' : (TONES[effort.tag] ?? 'muted');
  const full = stale ? `${label} · ${t('effort.stale')}` : label;
  // In Tabellen (`sm`) nur ein Symbol statt „· wird aktualisiert“: der Text machte die Spalte ~100 px
  // breiter und blendete in der Projektliste andere Spalten aus (30.09.2026); er steht im Tooltip.
  const compactStale = stale && size === 'sm';
  return (
    <span
      className={`${cls} ${styles[tone]}`}
      data-tone={tone}
      // Fokussierbar, damit der Tooltip auch per Tastatur erreichbar ist (components.md §1).
      tabIndex={0}
      title={compactStale ? `${t('effort.stale')}\n${tip}` : tip}
      aria-label={`${t('effort.label')}: ${full}. ${tip.replace(/\n/g, ' ')}`}
    >
      {label}
      {compactStale ? (
        <actionIcons.refresh size={12} aria-hidden className={styles.staleIcon} />
      ) : stale ? (
        <span className={styles.stale}> · {t('effort.stale')}</span>
      ) : null}
    </span>
  );
}
