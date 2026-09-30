/**
 * Zeilen einer Nacht mit erwarteten Frames und „nur für die kommende Nacht“ ab- bzw. wieder einschalten
 * (FA-FOL-05; S-02 und S-62). Umschalten nur für Admins (`project.status`); danach neuer Prognoselauf über
 * `onChanged` (FA-FOL-05: jede Umsetzung erzeugt einen Kontrolllauf).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { tonightApi, type TonightLine } from '../../api/client';
import { useCan } from '../../auth';
import { FilterChip } from '../../components/FilterChip';
import { ProblemMessage } from '../../components/ProblemMessage';
import { problemCode } from '../admin/shared';
import styles from './tonight.module.css';

export function TonightLines({
  projectId,
  lines,
  colorOf,
  onChanged,
  readOnly = false,
}: {
  projectId: string;
  lines: readonly TonightLine[];
  colorOf: (filter: string) => string;
  onChanged: () => void;
  /** Künftige Nacht (Nachtwahl): „nur heute aus“ gilt nur für die laufende Nacht. */
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const canAct = useCan('project.status');
  const client = useQueryClient();
  const toggle = useMutation({
    mutationFn: (l: TonightLine) => tonightApi.setLine(projectId, l.lineId, !l.disabledTonight),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['tonight'] }),
        client.invalidateQueries({ queryKey: ['forecast'] }),
        client.invalidateQueries({ queryKey: ['projects'] }),
      ]);
      onChanged();
    },
  });
  return (
    <>
      <ul className={styles.lines}>
        {lines.map((l) => (
          <li key={l.lineId} className={styles.line} data-off={l.disabledTonight || undefined}>
            <FilterChip shortName={l.filter} color={colorOf(l.filter)} size="sm" />
            <span className={styles.lineFrames}>
              {t('tonight.lineFrames', { frames: l.frames })}
            </span>
            {l.disabledTonight ? (
              <span className={styles.offBadge}>{t('tonight.offTonight')}</span>
            ) : null}
            {canAct && !readOnly ? (
              <button
                type="button"
                className={styles.lineButton}
                disabled={toggle.isPending}
                aria-label={
                  l.disabledTonight
                    ? t('tonight.turnOnLabel', { filter: l.filter })
                    : t('tonight.turnOffLabel', { filter: l.filter, frames: l.frames })
                }
                onClick={() => toggle.mutate(l)}
              >
                {l.disabledTonight ? t('tonight.turnOn') : t('tonight.turnOff')}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {toggle.error ? <ProblemMessage code={problemCode(toggle.error)} /> : null}
    </>
  );
}
