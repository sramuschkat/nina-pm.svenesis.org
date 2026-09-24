/**
 * Engine → Nachtdiagramm (AP-10): Nachtkontext und Nutzbarkeit aus `@nina-pm/engine` in die
 * Eigenschaften des Bausteins `NightChart` übersetzen. Zeitzonen kommen aus der Server-Tabelle
 * (`timeZoneTransitions`, NT-02) – `Intl` dient im Baustein nur der Beschriftung.
 */
import {
  buildEligibility,
  buildNightContext,
  meridianTransitUtc,
  type NightContext,
  type Target,
  type TimeZoneTransition,
  type TwilightLimit,
} from '@nina-pm/engine';
import type { NightChartProps } from '../components/night-chart';

export interface ChartTarget {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly target: Target;
}

export interface NightChartInput {
  readonly site: { latDeg: number; lonDeg: number };
  readonly night: string;
  readonly timeZoneTransitions: readonly TimeZoneTransition[];
  readonly timeZone: string;
  readonly targets: readonly ChartTarget[];
  readonly minAltDeg: number;
  readonly twilight: TwilightLimit;
  readonly transitLabel: string;
}

const span = (c: { startUtc: number | null; endUtc: number | null; kind: string }) => ({
  startUtc: c.startUtc,
  endUtc: c.endUtc,
  allNight: c.kind === 'polarNight',
});

export function nightChartFromEngine(input: NightChartInput): {
  props: Omit<NightChartProps, 'state'>;
  ctx: NightContext;
} {
  const ctx = buildNightContext({
    site: input.site,
    night: input.night,
    timeZoneTransitions: input.timeZoneTransitions,
  });
  const { startUtc, endUtc } = ctx.times.nightWindow;
  const series = input.targets.map((t) => {
    const e = buildEligibility(ctx, {
      target: t.target,
      twilight: input.twilight,
      minAltDeg: input.minAltDeg,
    });
    return {
      id: t.id,
      label: t.label,
      color: t.color,
      points: e.targetAltDeg.map((altDeg, k) => ({
        atUtc: ctx.boundaryUtc[k] as number,
        altDeg,
      })),
    };
  });
  const markers = input.targets
    .map((t) => {
      const at = meridianTransitUtc(t.target, input.site, startUtc, endUtc);
      return at === null
        ? null
        : { atUtc: at, kind: 'transit' as const, label: input.transitLabel };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);
  const mid = ctx.moon[Math.floor(ctx.moon.length / 2)];
  return {
    ctx,
    props: {
      window: { startUtc, endUtc },
      twilight: {
        civil: span(ctx.times.twilight.civil),
        nautical: span(ctx.times.twilight.nautical),
        astronomical: span(ctx.times.twilight.astronomical),
      },
      series,
      moon: {
        points: ctx.moon.map((m, k) => ({ atUtc: ctx.boundaryUtc[k] as number, altDeg: m.altDeg })),
        illuminationPct: mid?.illumPct ?? 0,
      },
      markers,
      minAltDeg: input.minAltDeg,
      timeZone: input.timeZone,
    },
  };
}
