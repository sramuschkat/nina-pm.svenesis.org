/**
 * Gegenüberstellung eines Änderungsantrags (AP-32b, FA-FRG-08): je beantragtem Feld die **aktuelle** Fassung
 * und der Vorschlag; Einträge, die inzwischen schon dem Vorschlag entsprechen, sind gekennzeichnet.
 * Genutzt im Reiter *Änderungsanträge* des Projekts und in der Warteschlange (S-33).
 */
import { formatNightKey } from '@nina-pm/shared';
import { useTranslation } from 'react-i18next';
import type { ChangeRequestDiffEntry } from '../../api/client';
import styles from './projects.module.css';

/** Beschriftung der Bedingungen aus dem Projekt-Editor (`projectEditor.cond.*`). */
const COND_LABEL: Record<string, string> = {
  minAltitudeDeg: 'minAltitude',
  minTimeOnTargetH: 'minTime',
  twilight: 'twilight',
  moonAvoidanceEnabled: 'moonEnabled',
  moonMustBeDown: 'moonMustBeDown',
  moonSeparationDeg: 'moonSeparation',
  moonWidthDays: 'moonWidth',
  moonRelaxScale: 'moonRelax',
  moonMinAltDeg: 'moonMinAlt',
  moonMaxAltDeg: 'moonMaxAlt',
  moonMaxIlluminationPct: 'moonIllumination',
};

export function useChangeRequestFormat() {
  const { t, i18n } = useTranslation();
  const label = (d: ChangeRequestDiffEntry) => {
    if (d.field.startsWith('conditions.')) {
      const key = COND_LABEL[d.field.slice('conditions.'.length)];
      return key ? t(`projectEditor.cond.${key}`) : d.field;
    }
    if (d.field === 'line.plannedCount')
      return t('changeRequests.field.linePlanned', { line: d.lineLabel ?? '–' });
    if (d.field === 'line.enabled')
      return t('changeRequests.field.lineEnabled', { line: d.lineLabel ?? '–' });
    if (d.field === 'newLine')
      return t('changeRequests.field.newLine', { line: d.lineLabel ?? '–' });
    return t(`changeRequests.field.${d.field}`, { defaultValue: d.field });
  };
  const value = (d: ChangeRequestDiffEntry, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '–';
    if (typeof v === 'boolean') return v ? t('changeRequests.yes') : t('changeRequests.no');
    if (d.field === 'startDate' || d.field === 'dueDate') return formatNightKey(String(v));
    if (d.field === 'conditions.twilight')
      return t(`nightChart.twilight.${String(v)}`, { defaultValue: String(v) });
    if (d.field === 'newLine' && typeof v === 'object') {
      const n = v as { plannedCount?: number; exposureS?: number };
      return t('changeRequests.newLineValue', { count: n.plannedCount ?? 0, s: n.exposureS ?? 0 });
    }
    if (typeof v === 'number') return v.toLocaleString(i18n.language);
    const text = String(v);
    return text.length > 80 ? `${text.slice(0, 79)}…` : text;
  };
  return { label, value };
}

export function ChangeRequestDiffTable({
  diff,
  caption,
}: {
  diff: readonly ChangeRequestDiffEntry[];
  caption: string;
}) {
  const { t } = useTranslation();
  const f = useChangeRequestFormat();
  if (diff.length === 0) return <p className={styles.muted}>{t('changeRequests.noDiff')}</p>;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.diffTable}>
        <caption className={styles.srOnly}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{t('changeRequests.col.field')}</th>
            <th scope="col">{t('changeRequests.col.current')}</th>
            <th scope="col">{t('changeRequests.col.proposed')}</th>
          </tr>
        </thead>
        <tbody>
          {diff.map((d, i) => (
            <tr key={`${d.field}-${d.lineId ?? ''}-${String(i)}`} data-unchanged={d.unchanged}>
              <th scope="row">{f.label(d)}</th>
              <td>{f.value(d, d.current)}</td>
              <td>
                <strong>{f.value(d, d.proposed)}</strong>
                {d.unchanged ? (
                  <span className={styles.muted}> ({t('changeRequests.alreadyCurrent')})</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
