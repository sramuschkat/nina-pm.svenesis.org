/**
 * „Voraussichtlich fertig“ je Projekt (FA-FOL-02, FA-FOL-04): aus der gespeicherten Prognose des Rigs. Gemeinsam für die
 * Auswertung „Projekte“ (AP-64) und die aktiven Projekte der Startseite „Heute“ (AP-73, FA-FOL-10).
 */
import { daysFromKey } from '@nina-pm/engine';
import { formatNightKey } from '@nina-pm/shared';
import type { TFunction } from 'i18next';
import type { ForecastProject } from '../../api/client';

/** „Voraussichtlich fertig“ aus der Prognose (FA-FOL-02) bzw. Saisonwarnung (FA-FOL-04). */
export interface Eta {
  readonly tone: 'ok' | 'warn' | 'done' | 'none';
  readonly kind: 'done' | 'nights' | 'season' | 'none' | 'open';
  readonly nights?: number;
  readonly night?: string;
  readonly optimistic?: number | null;
  readonly seasonNights?: number | null;
}

/** Rein: Prognose eines Projekts → Anzeige. Saisonwarnung vor der Schätzung (Hinweisfarbe). */
export function etaOf(f: ForecastProject | undefined, currentNight: string | null): Eta {
  if (!f) return { tone: 'none', kind: 'none' };
  if (f.needFrames === 0) return { tone: 'done', kind: 'done' };
  if (f.seasonWarning) {
    const end = f.seasonWarning.seasonEnd;
    const left =
      end && currentNight ? Math.max(0, daysFromKey(end) - daysFromKey(currentNight)) : null;
    return { tone: 'warn', kind: 'season', seasonNights: left };
  }
  const r = f.realistic;
  if (r.nights === null || r.completesNight === null) return { tone: 'none', kind: 'open' };
  return {
    tone: 'ok',
    kind: 'nights',
    nights: r.nights,
    night: r.completesNight,
    optimistic: f.optimistic.nights,
  };
}

/** Wert („≈ 4 Nächte“) und Hinweis („realistisch bis … · optimistisch 2 Nächte“) einer Schätzung. */
export function etaText(eta: Eta, t: TFunction, pending: boolean): { value: string; note: string } {
  const value =
    eta.kind === 'done'
      ? t('evaluation.projects.etaDone')
      : eta.kind === 'season'
        ? eta.seasonNights !== null && eta.seasonNights !== undefined
          ? t('evaluation.projects.seasonEnds', { count: eta.seasonNights })
          : t('forecast.seasonShort')
        : eta.kind === 'nights'
          ? t('evaluation.projects.etaNights', { count: eta.nights ?? 0 })
          : eta.kind === 'open'
            ? t('forecast.estimateNone')
            : pending
              ? t('common.loading')
              : '–';
  const note =
    eta.kind === 'nights'
      ? t('evaluation.projects.etaNote', {
          night: formatNightKey(eta.night ?? ''),
          optimistic:
            eta.optimistic === null || eta.optimistic === undefined ? '–' : String(eta.optimistic),
        })
      : eta.kind === 'season'
        ? t('evaluation.projects.seasonNote')
        : eta.kind === 'none' && !pending
          ? t('evaluation.projects.noForecast')
          : ' ';
  return { value, note };
}
