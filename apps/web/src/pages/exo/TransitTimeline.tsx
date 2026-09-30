/**
 * Transit-Zeitleiste der Nacht (FA-EXO-10…12; Wunsch Sven 30.09.2026): Mittag bis Mittag mit Beobachtungsfenster,
 * Kontakten, Meridian, Mond, Sonne und Lichtkurve im Hausstil des Nachtdiagramms. Gemeinsam für die aufgeklappte
 * Zeile der Suche S-22 und den Reiter *Exoplanet-Transit* im Projekt (FA-EXO-17: „gleiche Zeitleiste“).
 */
import { meridianTransitUtc, moonAt, sunAt, targetAt } from '@nina-pm/engine';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { equipmentApi, type ExoTransitView } from '../../api/client';
import { NightChart } from '../../components/night-chart';
import { nightChartFromEngine } from '../../lib/night-chart-data';
import { useNumber } from '../equipment/shared';
import { depthFraction, transitFlux } from './model';
import styles from './exo.module.css';

const unix = (iso: string) => Date.parse(iso) / 1000;

export interface TimelineSite {
  readonly id: string;
  readonly name: string;
  readonly timeZone: string;
  readonly latDeg: number;
  readonly lonDeg: number;
}

export function TransitTimeline({
  x,
  site,
  night,
  minAltDeg,
  twilight,
  showFlip,
}: {
  x: ExoTransitView;
  site: TimelineSite;
  night: string;
  minAltDeg: number;
  twilight: 'civil' | 'nautical' | 'astronomical';
  showFlip: boolean;
}) {
  const { t } = useTranslation();
  const fmt = useNumber();
  const tz = site.timeZone;
  const nights = useQuery({
    queryKey: ['site-nights', site.id, 'from', night],
    queryFn: () => equipmentApi.nights(site.id, 2, night),
    staleTime: 60 * 60 * 1000,
  });
  const depthPct = x.depthMmag === null ? null : depthFraction(x.depthMmag) * 100;
  const chart = useMemo(() => {
    if (!nights.data) return null;
    const built = nightChartFromEngine({
      site: { latDeg: site.latDeg, lonDeg: site.lonDeg },
      night: night,
      timeZoneTransitions: nights.data.timeZoneTransitions.map((z) => ({
        atUtc: unix(z.atUtc),
        utcOffsetMinutes: z.utcOffsetMinutes,
      })),
      timeZone: tz,
      targets: [
        {
          id: x.key,
          label: x.planet,
          color: 'var(--npm-chart-curve)',
          target: { raJ2000Deg: x.raDeg, decJ2000Deg: x.decDeg },
        },
      ],
      minAltDeg: minAltDeg,
      twilight,
      transitLabel: t('exo.timeline.meridian'),
    });
    // Mittag bis Mittag (FK 14.3 S-22): Höhen von Ziel, Mond und Sonne im 5-min-Raster über den ganzen Tag.
    const from = built.ctx.times.noonStartUtc;
    const to = built.ctx.times.noonEndUtc;
    const at0 = { latDeg: site.latDeg, lonDeg: site.lonDeg };
    const target = { raJ2000Deg: x.raDeg, decJ2000Deg: x.decDeg };
    const grid: number[] = [];
    for (let at = from; at <= to; at += 300) grid.push(at);
    const primary = built.props.series?.[0];
    const base = {
      ...built.props,
      window: { startUtc: from, endUtc: to },
      sun: grid.map((at) => ({ atUtc: at, altDeg: sunAt(at, at0).altDeg })),
      series: primary
        ? [
            {
              ...primary,
              points: grid.map((at) => ({ atUtc: at, altDeg: targetAt(target, at, at0).altDeg })),
            },
          ]
        : [],
      moon: built.props.moon
        ? {
            ...built.props.moon,
            points: grid.map((at) => ({ atUtc: at, altDeg: moonAt(at, at0).altDeg })),
          }
        : undefined,
      markers: (() => {
        const tm = meridianTransitUtc(target, at0, from, to);
        return tm === null
          ? []
          : [{ atUtc: tm, kind: 'transit' as const, label: t('exo.timeline.meridian') }];
      })(),
    };
    const now = Date.now() / 1000;
    return {
      ...base,
      markers: [
        ...(showFlip ? (base.markers ?? []) : []),
        ...(base.window && now >= base.window.startUtc && now <= base.window.endUtc
          ? [{ atUtc: now, kind: 'now' as const, label: t('exo.timeline.now') }]
          : []),
      ],
      transit: {
        windowStartUtc: unix(x.transit.windowStartUtc),
        windowEndUtc: unix(x.transit.windowEndUtc),
        ingressUtc: unix(x.transit.ingressUtc),
        midUtc: unix(x.transit.tcUtc),
        egressUtc: unix(x.transit.egressUtc),
        flux: transitFlux(x),
        depthLabel: x.depthMmag === null ? '' : `−${fmt(x.depthMmag, 1)} mmag`,
        depthPctLabel: depthPct === null ? '' : `−${fmt(depthPct, 2)} %`,
      },
    };
  }, [nights.data, site, night, minAltDeg, twilight, x, tz, t, showFlip, fmt, depthPct]);
  return (
    <section className={styles.card} aria-label={t('exo.timelineTitle', { name: x.planet })}>
      <h3 className={styles.cardTitle}>
        {t('exo.timelineTitle', { name: x.planet })}
        <span className={styles.muted}>
          {' '}
          · {t('exo.timelineNight', { night, site: site.name })}
        </span>
      </h3>
      {chart ? (
        <NightChart
          {...chart}
          minAltDeg={minAltDeg}
          timeZone={tz}
          bands={false}
          crop={false}
          height={320}
        />
      ) : (
        <NightChart window={null} timeZone={tz} state={nights.isError ? 'error' : 'loading'} />
      )}
    </section>
  );
}
