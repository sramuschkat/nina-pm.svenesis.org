/**
 * Warteschlange S-33, Spalte „Sichtbarkeit 4 Wochen“ (AP-24, FK 14.3): je Eintrag vier Mini-Balken mit den
 * nutzbaren Stunden je Nacht der kommenden Wochen am Standort des Wunsch-Rigs. Rechnung im Saison-Worker
 * (ein Aufruf für alle Einträge) mit der Nacht-Tabelle des Servers; ohne Rig oder Koordinaten „–“.
 */
import type { SeasonBar, SeasonTargetInput } from '@nina-pm/shared';
import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { equipmentApi, type QueueItem, type RigView, type SiteView } from '../../api/client';
import { useVisibilityWeeks } from '../../lib/use-season';
import { useNumber } from '../equipment/shared';
import styles from './projects.module.css';

export const VISIBILITY_WEEKS = 4;

/** Wochen-Sichtbarkeit je Eintrag (gleiche Reihenfolge wie `items`); `null` = nicht berechenbar. */
export function useQueueVisibility(
  items: readonly QueueItem[],
  rigs: readonly RigView[],
  sites: readonly SiteView[],
): { state: 'loading' | 'ready' | 'error'; weeks: (SeasonBar[] | null)[] } {
  const siteOf = (q: QueueItem) => {
    const rig = rigs.find((r) => r.id === q.requestedRigId);
    return rig ? (sites.find((s) => s.id === rig.siteId) ?? null) : null;
  };
  const siteIds = [...new Set(items.map((q) => siteOf(q)?.id).filter((x): x is string => !!x))];
  const tables = useQueries({
    queries: siteIds.map((id) => ({
      queryKey: ['site-nights', id, 'weeks'],
      queryFn: () => equipmentApi.nights(id, VISIBILITY_WEEKS * 7 + 2),
      staleTime: 60 * 60 * 1000,
    })),
  });
  const tableOf = (id: string) => tables[siteIds.indexOf(id)]?.data ?? null;
  const inputs = items.map((q): SeasonTargetInput | null => {
    const site = siteOf(q);
    const nights = site ? tableOf(site.id) : null;
    if (!site || !nights || !q.target) return null;
    return {
      site: { latitudeDeg: site.latitudeDeg, longitudeDeg: site.longitudeDeg },
      nights,
      target: q.target,
      conditions: q.conditions,
      startDate: q.startDate,
    };
  });
  const present = inputs.filter((i): i is SeasonTargetInput => i !== null);
  const pending = tables.some((x) => x.isPending);
  const result = useVisibilityWeeks(pending ? null : present);
  let k = 0;
  const weeks = inputs.map((i) => (i === null ? null : (result.data?.[k++] ?? null)));
  return {
    state: tables.some((x) => x.isError) ? 'error' : pending ? 'loading' : result.state,
    weeks,
  };
}

/** Maßstab der Mini-Balken: volle Höhe bei 10 h je Nacht. */
const FULL_HOURS = 10;

export function VisibilityBars({ weeks, name }: { weeks: readonly SeasonBar[]; name: string }) {
  const { t, i18n } = useTranslation();
  const num = useNumber();
  const date = (key: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      day: '2-digit',
      month: '2-digit',
      timeZone: 'UTC',
    }).format(new Date(Date.parse(`${key}T12:00:00Z`)));
  const text = weeks
    .map((w) =>
      t('queue.visibilityWeek', {
        date: date(w.month),
        h: num(w.usableHours, 1),
        usable: w.usable ? '' : t('queue.visibilityShort'),
      }),
    )
    .join(' · ');
  return (
    <span
      className={styles.visBars}
      role="img"
      aria-label={t('queue.visibilityLabel', { name, text })}
      title={text}
    >
      {weeks.map((w) => (
        <span
          key={w.month}
          className={w.usable ? styles.visBar : styles.visBarShort}
          style={{
            height: `${String(Math.max(2, Math.min(100, (100 * w.usableHours) / FULL_HOURS)))}%`,
          }}
        />
      ))}
    </span>
  );
}
