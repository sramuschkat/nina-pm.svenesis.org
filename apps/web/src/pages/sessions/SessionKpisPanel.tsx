/**
 * S-61 Reiter *Kennzahlen* (FK 14.3; FA-AUS-04, FA-AUS-05, FA-AUS-09; AP-31): Effizienz (Belichtung /
 * nutzbare Dunkelzeit), Overhead mit Autofokus, Flip und sonstigem Overhead, Safety-Pausen, Block- und
 * Filterwechsel, Plan-Treue gegen den ersten Plan der Session (dieselben Begriffe wie Soll/Ist: ohne Bonus,
 * nur Aufnahmen dieser Session, 07.10.2026) und Abweichungsgründe mit Anzahl und Dauer.
 * Die Werte rechnet der Server (`sessionKpis`); die Seite zeigt sie nur an.
 */
import { useTranslation } from 'react-i18next';
import type { NightSessionDetail, NightSessionReason } from '../../api/client';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { SiteTime } from '../../components/SiteTime';
import styles from './sessions.module.css';

export function SessionKpisPanel({ detail }: { detail: NightSessionDetail }) {
  const { t, i18n } = useTranslation();
  const k = detail.kpis;
  const zone = detail.session.siteTimeZone;
  const n = (v: number, digits = 1) =>
    v.toLocaleString(i18n.language, { maximumFractionDigits: digits });
  const pct = (v: number | null) => (v === null ? '–' : `${n(v)} %`);
  const dur = (s: number | null) => {
    if (s === null) return '–';
    const total = Math.round(s);
    if (total < 60) return t('sessions.kpis.dur.s', { s: total });
    const m = Math.round(total / 60);
    if (m < 60) return t('sessions.kpis.dur.m', { m });
    return t('sessions.kpis.dur.hm', { h: Math.floor(m / 60), m: String(m % 60).padStart(2, '0') });
  };
  const reasonColumns: DataColumn<NightSessionReason>[] = [
    {
      id: 'reason',
      header: t('sessions.kpis.col.reason'),
      sortValue: (r) => t(`sessions.kpis.reason.${r.reason}`),
      cell: (r) => t(`sessions.kpis.reason.${r.reason}`),
    },
    {
      id: 'count',
      header: t('sessions.kpis.col.count'),
      sortValue: (r) => r.count,
      align: 'end',
      cell: (r) => r.count,
    },
    {
      id: 'duration',
      header: t('sessions.kpis.col.duration'),
      sortValue: (r) => r.durationS,
      align: 'end',
      nowrap: true,
      cell: (r) => dur(r.durationS),
    },
  ];
  const stat = (label: string, value: string, hint?: React.ReactNode) => (
    <div className={styles.stat}>
      <span className={styles.muted}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {hint ? <span className={styles.muted}>{hint}</span> : null}
    </div>
  );
  return (
    <>
      <h2 className={styles.srOnly}>{t('sessions.detail.tab.kpis')}</h2>
      <div className={styles.kpiGrid}>
        {stat(
          t('sessions.kpis.efficiency'),
          pct(k.efficiencyPct),
          t('sessions.kpis.efficiencyHint', {
            exposure: dur(k.exposureS),
            dark: dur(k.usableDarkS),
          }),
        )}
        {stat(
          t('sessions.kpis.darkWindow'),
          dur(k.usableDarkS),
          k.darkFromUtc && k.darkToUtc ? (
            <>
              <SiteTime atUtc={k.darkFromUtc} siteTimeZone={zone} />
              {' – '}
              <SiteTime atUtc={k.darkToUtc} siteTimeZone={zone} />
            </>
          ) : (
            t('sessions.kpis.noDarkness')
          ),
        )}
        {stat(
          t('sessions.kpis.overhead'),
          k.overhead ? `${n(k.overhead.pct)} %` : '–',
          k.overhead
            ? t('sessions.kpis.overheadHint', {
                af: dur(k.overhead.autofocusS),
                flip: dur(k.overhead.flipS),
                other: dur(k.overhead.otherS),
              })
            : t('sessions.kpis.running'),
        )}
        {stat(t('sessions.kpis.safetyPause'), dur(k.safetyPauseS))}
        {stat(t('sessions.kpis.blockChanges'), String(k.blockChanges))}
        {stat(t('sessions.kpis.filterChanges'), String(k.filterChanges))}
        {stat(
          t('sessions.kpis.planFrames'),
          k.plan ? pct(k.plan.framesPct) : '–',
          k.plan
            ? t('sessions.kpis.planFramesHint', {
                acquired: k.plan.acquiredFrames,
                planned: k.plan.plannedFrames,
              })
            : t('sessions.kpis.noPlan'),
        )}
        {stat(
          t('sessions.kpis.planTime'),
          k.plan ? pct(k.plan.timePct) : '–',
          k.plan
            ? t('sessions.kpis.planTimeHint', {
                acquired: dur(k.plan.acquiredExposureS),
                planned: dur(k.plan.plannedExposureS),
              })
            : undefined,
        )}
      </div>
      <p className={styles.muted}>{t('sessions.plan.definition')}</p>
      <p className={styles.muted}>{t('sessions.kpis.overheadNote')}</p>
      <h3 className={styles.subTitle}>{t('sessions.kpis.reasons')}</h3>
      <DataTable
        columns={reasonColumns}
        rows={detail.reasons}
        rowKey={(r) => r.reason}
        rowLabel={(r) => t(`sessions.kpis.reason.${r.reason}`)}
        label={t('sessions.kpis.reasons')}
        empty={t('sessions.kpis.noReasons')}
      />
    </>
  );
}
