/**
 * Kontextleiste der Planung (S-20 Sternkarte, S-21 Objektbrowser – gleicher Aufbau, Wunsch Sven 27.09.2026):
 * Rig · Nacht („Nacht ab dem Abend des …“ mit Mondkalender, ← →) · „Heute Nacht“ · seitenbezogener Zusatz rechts
 * (Objektbrowser: Dunkelheit; Sternkarte: Uhrzeit, Zone, „Jetzt“). Rig und Nacht sind Bezug, kein Filter.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RigSelect, type RigOption } from '../../components/RigSelect';
import { NightPicker } from './NightPicker';
import styles from './PlanningContext.module.css';

export interface PlanningSite {
  readonly id: string;
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly timeZone: string;
}

export function PlanningContext({
  rigs,
  rigId,
  onRigChange,
  site,
  siteGeo,
  night,
  today,
  onNightChange,
  onTonight,
  empty,
  children,
}: {
  rigs: readonly RigOption[];
  rigId: string | null;
  onRigChange: (id: string | null) => void;
  site: PlanningSite | null;
  /** Stabile Koordinaten des Standorts (Mondkalender rechnet daran). */
  siteGeo: { latDeg: number; lonDeg: number } | null;
  night: string | null;
  /** Heutige Nacht aus der Nacht-Tabelle des Servers (NT-01). */
  today: string | null;
  onNightChange: (night: string) => void;
  onTonight: () => void;
  /** Hinweis ohne Rig (z. B. „Noch kein Rig angelegt“). */
  empty?: ReactNode;
  /** Seitenbezogener Zusatz rechts. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section className={styles.context} aria-label={t('catalog.context')}>
      <span className={styles.label} aria-hidden>
        {t('catalog.rig')}
      </span>
      <div className={styles.rigField}>
        <RigSelect rigs={[...rigs]} value={rigId} onChange={onRigChange} label={t('catalog.rig')} />
      </div>
      {site && siteGeo ? (
        <>
          <span className={styles.divider} aria-hidden />
          <div className={styles.nightNav}>
            {night ? (
              <NightPicker
                night={night}
                onChange={onNightChange}
                today={today}
                siteId={site.id}
                site={siteGeo}
                timeZone={site.timeZone}
                prevLabel={t('catalog.prevNight')}
                nextLabel={t('catalog.nextNight')}
              />
            ) : (
              <strong>–</strong>
            )}
            <button type="button" className={styles.buttonSm} onClick={onTonight}>
              {t('catalog.tonight')}
            </button>
          </div>
        </>
      ) : (
        (empty ?? null)
      )}
      {children ? <div className={styles.extra}>{children}</div> : null}
    </section>
  );
}
