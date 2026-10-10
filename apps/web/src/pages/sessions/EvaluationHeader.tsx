/**
 * Kopf des Bereichs Auswertung (AP-64; seit AP-77 ohne „Projekte“): Titel, Bereichsreiter Nächte | Standort-Statistik | Himmel als
 * Segmentsteuerung und der gemeinsame Filter Rig + Zeitraum (in der URL, bleibt beim Reiterwechsel und beim Zurück
 * erhalten). Die Standort-Statistik wählt statt des Rigs einen Standort, vorbelegt mit dem Standort des Rigs.
 */
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useSearchParams } from 'react-router';
import { useAuth } from '../../auth';
import { PageHeader } from '../../components/PageHeader';
import { useEquipmentList } from '../equipment/shared';
import { nightKeyIn } from '../projects/queue-model';
import {
  EVALUATION_PATHS,
  filterSearch,
  parseFilter,
  periodRange,
  PERIODS,
  type EvaluationFilter,
} from './evaluation';
import styles from './evaluation.module.css';

/** Filter des Bereichs aus der URL samt Zeitraum in Nächten; `ready` erst mit geladenem Mandanten (Zeitzone). */
export function useEvaluationFilter() {
  const [params, setParams] = useSearchParams();
  const filter = parseFilter(params);
  const { me } = useAuth();
  const zone = me?.tenant?.timeZone ?? 'UTC';
  const today = nightKeyIn(Date.now(), zone);
  const range = periodRange(filter, today);
  const update = (patch: Partial<EvaluationFilter>) => {
    const next = { ...filter, ...patch };
    // Eigene Parameter der Seite (z. B. „nur ungeprüfte“) bleiben stehen.
    const keep = new URLSearchParams(params);
    for (const k of ['rig', 'standort', 'zeitraum', 'von', 'bis']) keep.delete(k);
    const own = new URLSearchParams(filterSearch(next).slice(1));
    for (const [k, v] of own) keep.set(k, v);
    setParams(keep, { replace: true });
  };
  return {
    filter,
    range,
    today,
    update,
    search: filterSearch(filter),
    ready: me?.tenant != null,
  };
}

export function EvaluationTabs({ search }: { search: string }) {
  const { t } = useTranslation();
  const tabs = [
    { to: EVALUATION_PATHS.nights, label: t('evaluation.tab.nights') },
    { to: EVALUATION_PATHS.site, label: t('evaluation.tab.site') },
    { to: EVALUATION_PATHS.sky, label: t('evaluation.tab.sky') },
  ];
  return (
    <nav className={styles.segments} aria-label={t('evaluation.tabsLabel')}>
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={`${tab.to}${search}`} end className={styles.segment}>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function EvaluationHeader({
  mode = 'rig',
  actions,
  extra,
}: {
  /** `site`: Auswahl „Standort“ statt Rig (Standort-Statistik). */
  mode?: 'rig' | 'site';
  actions?: ReactNode;
  /** Weitere Filter des Reiters (z. B. Status und Objekttyp der Projekte). */
  extra?: ReactNode;
}) {
  const { t } = useTranslation();
  const { filter, range, update, search } = useEvaluationFilter();
  const rigs = useEquipmentList('rigs');
  const sites = useEquipmentList('sites');
  const ids = { rig: useId(), site: useId(), period: useId(), from: useId(), to: useId() };
  const rigSite = (rigs.data ?? []).find((r) => r.id === filter.rigId)?.siteId ?? '';
  const siteId = filter.siteId || rigSite || (sites.data ?? [])[0]?.id || '';
  return (
    <PageHeader
      title={t('evaluation.title')}
      {...(actions ? { actions } : {})}
      nav={
        <div className={styles.headNav}>
          <EvaluationTabs search={search} />
          <div className={styles.filters} role="group" aria-label={t('evaluation.filterLabel')}>
            {mode === 'site' ? (
              <div className={styles.field}>
                <label htmlFor={ids.site}>{t('evaluation.siteLabel')}</label>
                <select
                  id={ids.site}
                  className={styles.select}
                  value={siteId}
                  onChange={(e) =>
                    update({ siteId: e.target.value === rigSite ? '' : e.target.value })
                  }
                >
                  {(sites.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className={styles.field}>
                <label htmlFor={ids.rig}>{t('evaluation.rig')}</label>
                <select
                  id={ids.rig}
                  className={styles.select}
                  value={filter.rigId}
                  onChange={(e) => update({ rigId: e.target.value, siteId: '' })}
                >
                  <option value="">{t('evaluation.allRigs')}</option>
                  {(rigs.data ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className={styles.field}>
              <label htmlFor={ids.period}>{t('evaluation.period')}</label>
              <select
                id={ids.period}
                className={styles.select}
                value={filter.period}
                onChange={(e) => {
                  const period = e.target.value as EvaluationFilter['period'];
                  // Von–bis startet mit dem bisherigen Zeitraum.
                  update(
                    period === 'custom' ? { period, from: range.from, to: range.to } : { period },
                  );
                }}
              >
                {PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {t(`evaluation.periods.${p}`)}
                  </option>
                ))}
              </select>
            </div>
            {filter.period === 'custom' ? (
              <>
                <div className={styles.field}>
                  <label htmlFor={ids.from}>{t('evaluation.from')}</label>
                  <input
                    id={ids.from}
                    type="date"
                    className={styles.select}
                    value={range.from}
                    onChange={(e) => update({ from: e.target.value })}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor={ids.to}>{t('evaluation.to')}</label>
                  <input
                    id={ids.to}
                    type="date"
                    className={styles.select}
                    value={range.to}
                    onChange={(e) => update({ to: e.target.value })}
                  />
                </div>
              </>
            ) : null}
            {extra}
          </div>
        </div>
      }
    />
  );
}

/** Standort der Standort-Statistik: gewählter Standort, sonst der des Rigs, sonst der erste. */
export function useEvaluationSite(): string {
  const { filter } = useEvaluationFilter();
  const rigs = useEquipmentList('rigs');
  const sites = useEquipmentList('sites');
  const rigSite = (rigs.data ?? []).find((r) => r.id === filter.rigId)?.siteId ?? '';
  return filter.siteId || rigSite || (sites.data ?? [])[0]?.id || '';
}
