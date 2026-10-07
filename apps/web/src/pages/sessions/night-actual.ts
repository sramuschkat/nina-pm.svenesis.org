/**
 * Nachtgrafik mit Ist für das Nacht-Detail (AP-64, S-61 Übersicht): derselbe Baustein wie Simulator und „Heute Nacht“ –
 * `useNightPlan` holt die Eingabe der Nacht über die Ist-Route (`GET /simulations/input`) und rechnet daraus Himmel,
 * Höhenkurven und `actualView` (Projektbalken, Filterleiste, Lücken mit Grund). Eine vergangene Nacht zeigt nur das
 * Ist, ohne Plan-Rest. Dazu Autofokus-Marken aus den Ereignissen der Session.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { NightSessionDetail } from '../../api/client';
import type { NightChartProps } from '../../components/night-chart';
import { useNightPlan } from '../simulator/use-night-plan';
import type { NightGap } from './night-model';

export interface NightActual {
  /** Eigenschaften für `NightChart` (`variant="plan"`); `null`, solange nichts gerechnet ist. */
  readonly chart: Omit<NightChartProps, 'state'> | null;
  /** Lücken im Ist (Sekunden UTC); `null` ohne Ist. */
  readonly gaps: readonly NightGap[] | null;
  readonly isPending: boolean;
  readonly isError: boolean;
}

export function useNightActual(
  nightOf: { readonly rigId: string; readonly night: string } | null,
  events: NightSessionDetail['events'] | null,
): NightActual {
  const { t } = useTranslation();
  const plan = useNightPlan(nightOf?.rigId ?? null, nightOf?.night ?? null);
  const actual = plan.actual ?? null;
  const result = plan.result;
  const chart = useMemo((): NightActual['chart'] => {
    if (!result) return null;
    const af = (events ?? [])
      .filter((e) => e.kind === 'af')
      .map((e) => ({
        atUtc: Date.parse(e.occurredAt) / 1000,
        kind: 'custom' as const,
        label: t('evaluation.night.afMarker'),
      }));
    return {
      ...result.chart,
      series: result.chart.series ?? [],
      // Vergangene Nacht: nur Ist (Erledigtes), keine geplanten Flips; erledigte Flips stehen als Lücke im Ist.
      markers: [
        ...(result.chart.markers ?? []).filter((m) => m.kind !== 'flip' && m.kind !== 'now'),
        ...af,
      ],
      blocks: actual ? actual.blocks : [],
      filterBars: actual ? actual.filterBars : [],
      gaps: (actual?.gaps ?? []).map((g) => ({
        ...g,
        label: t(`simulator.gap.${g.kind}`, { count: g.count ?? 1 }),
      })),
    };
  }, [result, actual, events, t]);
  return {
    chart,
    gaps: actual ? actual.gaps : null,
    isPending: plan.isPending && !actual,
    isError: plan.isError && chart === null,
  };
}
