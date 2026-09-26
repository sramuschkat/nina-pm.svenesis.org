/**
 * Rechenfunktionen des Saison-Workers (AP-24): Saisondiagramm und Wochen-Sichtbarkeit aus
 * `packages/shared/src/season.ts`. Eigenes Modul, damit der Hauptthread sie ohne Worker (Tests, alte
 * Browser) direkt aufrufen kann, ohne `expose` auszuführen.
 */
import {
  seasonChartData,
  visibilityWeeks,
  type SeasonRange,
  type SeasonTargetInput,
} from '@nina-pm/shared';

export const seasonApi = {
  chart: (input: SeasonTargetInput, range: SeasonRange) => seasonChartData(input, range),
  weeks: (inputs: readonly SeasonTargetInput[]) => inputs.map((i) => visibilityWeeks(i)),
};

export type SeasonApi = typeof seasonApi;
