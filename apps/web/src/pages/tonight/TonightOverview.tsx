/**
 * Kopf von „Heute Nacht“ (Umbau 28.09.2026, Entwurf Sven): Einschätzung mit Countdown, vier Kennzahlen
 * (Dunkel, Mond, Wetter, Plan/NINA) und die Zeitleiste der Nacht mit gemeinsamer Achse – Himmel, Wetter,
 * Mond, Plan (Projektblöcke, Meridianflips, Flats aus der Simulation im Browser), Filter und Ereignisse.
 * Die Zahlen stehen nur hier, die ausführlichen Diagramme liegen eingeklappt darunter.
 */
import { formatTzAbbr, formatZonedTime } from '@nina-pm/shared';
import { SKY_STOPS } from '@nina-pm/ui-tokens';
import { useTranslation } from 'react-i18next';
import type { TonightRig } from '../../api/client';
import { MoonIcon, moonPhaseAt } from '../../components/moon-darkness';
import { iso, skyColor } from '../../components/night-chart/model';
import {
  NightTimeline,
  type TimelineLane,
  type TimelineSegment,
} from '../../components/night-timeline';
import { ratingColour } from '../../components/WeatherChart';
import { daylightFade } from '../../components/WeatherChart/model';
import type { NightPlanState } from '../simulator/use-night-plan';
import type { NightSky } from './night-sky';
import { TwilightTable } from './TwilightTable';
import styles from './tonight.module.css';

const unix = (s: string) => Date.parse(s) / 1000;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Ton der Einschätzung nach der Wetterklasse (0–4). */
function tone(rig: TonightRig): 'good' | 'fair' | 'poor' | 'none' {
  const w = rig.weather;
  if (!rig.dark) return 'poor';
  if (!w || w.ratingIndex === null) return 'none';
  return w.ratingIndex >= 3 ? 'good' : w.ratingIndex === 2 ? 'fair' : 'poor';
}

/** „Gut 72 % · dunkel in 2 h 13 min“ – Wetterklasse und Countdown bis bzw. in der Dunkelheit. */
export function Verdict({ rig, nowUtc }: { rig: TonightRig; nowUtc: number }) {
  const { t, i18n } = useTranslation();
  const n = (x: number, d = 0) => x.toLocaleString(i18n.language, { maximumFractionDigits: d });
  const zone = rig.siteTimeZone;
  const w = rig.weather;
  const rating =
    w && w.ratingIndex !== null && w.nightMean !== null
      ? t('tonight.verdict.rating', {
          rating: t(`weather.rating.${String(w.ratingIndex)}`),
          pct: n(w.nightMean * 100),
        })
      : t('tonight.verdict.noWeather');
  let clock: string;
  if (!rig.dark) clock = t('tonight.verdict.noDark');
  else if (rig.night !== rig.currentNight)
    // Künftige Nacht (Nachtwahl): Zeitraum der Dunkelheit statt Countdown.
    clock = t('tonight.verdict.darkFromTo', {
      from: formatZonedTime(rig.dark.fromUtc, zone),
      to: `${formatZonedTime(rig.dark.toUtc, zone)} ${formatTzAbbr(rig.dark.toUtc, zone)}`,
    });
  else {
    const from = unix(rig.dark.fromUtc);
    const to = unix(rig.dark.toUtc);
    if (nowUtc < from) {
      const min = Math.ceil((from - nowUtc) / 60);
      clock = t('tonight.verdict.darkIn', { h: Math.floor(min / 60), m: min % 60 });
    } else if (nowUtc < to)
      clock = t('tonight.verdict.darkUntil', { time: formatZonedTime(rig.dark.toUtc, zone) });
    else clock = t('tonight.verdict.darkOver');
  }
  return (
    <span className={styles.verdict} data-tone={tone(rig)}>
      {rating} · {clock}
    </span>
  );
}

/** Vier Kennzahlen: Dunkel, Mond, Wetter, Plan/NINA. */
export function KpiTiles({
  rig,
  sky,
  plan,
  deviceTimeZone,
}: {
  rig: TonightRig;
  sky: NightSky;
  plan: NightPlanState;
  /** Zeitzone des Geräts für die Dämmerungstabelle; ohne Angabe die des Browsers (Tests setzen sie fest). */
  deviceTimeZone?: string;
}) {
  const { t, i18n } = useTranslation();
  const n = (x: number, d = 0) => x.toLocaleString(i18n.language, { maximumFractionDigits: d });
  const zone = rig.siteTimeZone;
  const hm = (s: string) => formatZonedTime(s, zone);
  const abbr = (s: string) => formatTzAbbr(s, zone);
  const mid = rig.dark
    ? (unix(rig.dark.fromUtc) + unix(rig.dark.toUtc)) / 2
    : rig.nightWindow
      ? (unix(rig.nightWindow.startUtc) + unix(rig.nightWindow.endUtc)) / 2
      : null;
  const phase = mid !== null ? moonPhaseAt(mid, sky.geo) : null;
  const rise = rig.moon.events.find((e) => e.type === 'rise');
  const set = rig.moon.events.find((e) => e.type === 'set');
  let moonMax: { alt: number; t: number } | null = null;
  for (const r of sky.bodies)
    if (r.bodies.moon.altDeg > 0 && (!moonMax || r.bodies.moon.altDeg > moonMax.alt))
      moonMax = { alt: r.bodies.moon.altDeg, t: r.t };
  const w = rig.weather;
  // Eine Quelle (07.10.2026): laufende Nacht mit gespeichertem Plan → Ziele und Frames von der Rig, sonst die Rechnung.
  const fromRig = plan.rigNight ?? null;
  const header = fromRig
    ? { targets: fromRig.targets, frames: fromRig.frames }
    : (plan.result?.header ?? null);
  const current = rig.night === rig.currentNight;
  const lastSeen = rig.instances
    .map((i) => i.lastSeenAt)
    .filter((x): x is string => x !== null)
    .sort()
    .pop();
  const nina =
    rig.night !== rig.currentNight
      ? t('tonight.kpi.ninaOnlyTonight')
      : rig.instances.length === 0
        ? t('tonight.kpi.ninaNone')
        : lastSeen
          ? t('tonight.kpi.ninaSeen', { time: `${hm(lastSeen)} ${abbr(lastSeen)}` })
          : t('tonight.kpi.ninaNever');
  return (
    <ul className={styles.kpis} aria-label={t('tonight.kpi.label')}>
      <li className={styles.kpi}>
        <span className={styles.kpiLabel}>{t('tonight.kpi.dark')}</span>
        <span className={styles.kpiValue}>
          {rig.dark ? t('tonight.kpi.hours', { h: n(rig.darkHours, 1) }) : '–'}
          {rig.dark ? (
            <span className={styles.kpiValueNote}>{t('tonight.kpi.astronomical')}</span>
          ) : null}
        </span>
        {rig.dark ? null : <span className={styles.kpiSub}>{t('tonight.kpi.noDark')}</span>}
        <TwilightTable twilight={rig.twilight} timeZone={zone} deviceTimeZone={deviceTimeZone} />
      </li>
      <li className={styles.kpi}>
        <span className={styles.kpiLabel}>{t('tonight.kpi.moon')}</span>
        <span className={styles.kpiValue}>
          {phase ? (
            <MoonIcon angleDeg={phase.angleDeg} size={20} southern={sky.geo.latDeg < 0} />
          ) : null}
          {t('tonight.kpi.illum', { pct: n(rig.moon.illumPct) })}
        </span>
        <span className={styles.kpiSub}>
          {[
            rise ? t('tonight.kpi.moonRise', { time: hm(rise.atUtc) }) : '',
            set ? t('tonight.kpi.moonSet', { time: hm(set.atUtc) }) : '',
            moonMax
              ? t('tonight.kpi.moonMax', { alt: n(moonMax.alt), time: hm(iso(moonMax.t)) })
              : t('tonight.kpi.moonDown'),
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </li>
      <li className={styles.kpi}>
        <span className={styles.kpiLabel}>{t('tonight.kpi.weather')}</span>
        <span className={styles.kpiValue}>
          {w && w.ratingIndex !== null && w.nightMean !== null
            ? t('tonight.verdict.rating', {
                rating: t(`weather.rating.${String(w.ratingIndex)}`),
                pct: n(w.nightMean * 100),
              })
            : '–'}
        </span>
        <span className={styles.kpiSub}>
          {w?.bestWindow
            ? t('tonight.kpi.bestWindow', {
                from: hm(w.bestWindow.fromUtc),
                to: hm(w.bestWindow.toUtc),
              })
            : w
              ? t('tonight.kpi.noWindow')
              : t('tonight.kpi.noForecast')}
        </span>
      </li>
      <li className={styles.kpi}>
        <span className={styles.kpiLabel}>{t('tonight.kpi.plan')}</span>
        <span className={styles.kpiValue}>
          {header
            ? header.targets > 0
              ? t('tonight.kpi.targets', { n: header.targets })
              : t('tonight.kpi.nothing')
            : plan.isError
              ? '–'
              : '…'}
        </span>
        <span className={styles.kpiSub}>
          {[
            header && header.frames > 0
              ? t(plan.deliveryOff && current ? 'tonight.kpi.framesIfOn' : 'tonight.kpi.frames', {
                  n: header.frames,
                })
              : '',
            fromRig && fromRig.saved > 0 ? t('tonight.kpi.saved', { n: fromRig.saved }) : '',
            nina,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </li>
    </ul>
  );
}

/** Zeitleiste der Nacht: Himmel, Wetter, Mond, Plan, Filter, Ereignisse auf einer Achse. */
export function TonightTimeline({
  rig,
  sky,
  plan,
  nowUtc,
}: {
  rig: TonightRig;
  sky: NightSky;
  plan: NightPlanState;
  nowUtc: number;
}) {
  const { t, i18n } = useTranslation();
  const n = (x: number, d = 0) =>
    x.toLocaleString(i18n.language, { maximumFractionDigits: d }).replace(/^-/, '−');
  const win = sky.window;
  if (!win) return <p className={styles.muted}>{t('tonight.noWindow')}</p>;
  const zone = rig.siteTimeZone;
  const hm = (at: number) => formatZonedTime(iso(at), zone);
  const rows = sky.bodies;
  const step = rows.length > 1 ? (rows[1]?.t ?? 0) - (rows[0]?.t ?? 0) : 600;

  // Himmel: Dämmerungsfarben je Probe, astronomisch dunkel grün wie „Mond und Dunkelheit“.
  const skyLane: TimelineSegment[] = rows.map((r) => ({
    fromUtc: r.t,
    toUtc: r.t + step,
    color: r.sunAltDeg < -18 ? 'var(--npm-chart-sky-dark)' : skyColor(r.sunAltDeg, SKY_STOPS),
  }));
  // Wetter: Gesamtnote je Stunde, am Tag ausgeblendet (wie das Farbband der Wetterseite).
  const weatherLane: TimelineSegment[] = (rig.weather?.hours ?? []).map((h) => ({
    fromUtc: unix(h.tUtc),
    toUtc: unix(h.tUtc) + 3600,
    color: ratingColour(h.overallScore, daylightFade(h.sunAltDeg ?? 0)),
    title:
      h.ratingIndex === null || h.overallScore === null
        ? `${hm(unix(h.tUtc))} · ${t('weather.rating.none')}`
        : `${hm(unix(h.tUtc))} · ${t(`weather.rating.${String(h.ratingIndex)}`)} ${n(h.overallScore * 100)} %`,
  }));
  // Mond: zusammenhängende Zeit über dem Horizont, beschriftet mit der größten Höhe.
  const moonLane: TimelineSegment[] = [];
  let run: { from: number; to: number; max: number; maxT: number } | null = null;
  const flush = () => {
    if (!run) return;
    moonLane.push({
      fromUtc: run.from,
      toUtc: run.to,
      color: 'var(--npm-body-moon)',
      // Deckkraft 0,5–1 nach Beleuchtung: unter 0,5 fiel die Beschriftung auf der dunklen Spur unter 4,5:1
      // (axe color-contrast bei 45 % Deckkraft, 06.10.2026).
      opacity: clamp(0.5 + rig.moon.illumPct / 200, 0.5, 1),
      label: t('tonight.lane.moonMax', { alt: n(run.max), time: hm(run.maxT) }),
    });
    run = null;
  };
  for (const r of rows) {
    const alt = r.bodies.moon.altDeg;
    if (alt > 0) {
      if (!run) run = { from: r.t, to: r.t + step, max: alt, maxT: r.t };
      run.to = r.t + step;
      if (alt > run.max) {
        run.max = alt;
        run.maxT = r.t;
      }
    } else flush();
  }
  flush();
  // Plan aus der Simulation: Projektblöcke, Flips, Flats.
  const result = plan.result;
  // Ist + Plan (AP-53c): Erledigtes blass, Geplantes kräftig, Lücken schwach rot mit Grund – unabhängig davon, ob die
  // Rechnung im Browser schon fertig bzw. gelungen ist (07.10.2026).
  const actual = plan.actual ?? null;
  const planBlocks = actual ? actual.blocks : (result?.chart.blocks ?? []);
  const planLane: TimelineSegment[] =
    result || actual
      ? [
          ...planBlocks.map((b) => ({
            fromUtc: b.fromUtc,
            toUtc: b.toUtc,
            color: b.color ?? 'var(--npm-chart-series-1)',
            label: b.label,
            title: `${b.label} (${hm(b.fromUtc)}–${hm(b.toUtc)})`,
            ...(b.tense === 'past' ? { opacity: 0.4 } : {}),
          })),
          ...(actual?.gaps ?? [])
            .filter((g) => g.kind !== 'flip')
            .map((g) => ({
              fromUtc: g.fromUtc,
              toUtc: g.toUtc,
              color: 'var(--npm-chart-now)',
              opacity: 0.35,
              title: `${t(`simulator.gap.${g.kind}`, { count: g.count ?? 1 })} (${hm(g.fromUtc)}–${hm(g.toUtc)})`,
            })),
          ...(result?.plan.flatsNotAfterUtc
            ? [
                {
                  fromUtc: unix(result.plan.flatsNotBeforeUtc),
                  toUtc: unix(result.plan.flatsNotAfterUtc),
                  color: 'var(--npm-chart-dark)',
                  label: t('tonight.lane.flats'),
                },
              ]
            : []),
        ]
      : [];
  // Nur Flips (keine Jetzt-Marke); mit gespeichertem Plan dessen kommende Flips, sonst die der Rechnung (mit Ist nur
  // die kommenden).
  const flipTimes = plan.rigNight
    ? plan.rigNight.flips.map(unix)
    : (result?.chart.markers ?? [])
        .filter((m) => m.kind === 'flip' && (!actual || m.atUtc > nowUtc))
        .map((m) => m.atUtc);
  const flips = flipTimes.map((at) => ({
    atUtc: at,
    color: 'var(--npm-chart-meridian)',
    title: t('tonight.lane.flip', { time: hm(at) }),
  }));
  const filterLane: TimelineSegment[] = (
    actual ? actual.filterBars : (result?.chart.filterBars ?? [])
  ).map((f) => ({
    fromUtc: f.fromUtc,
    toUtc: f.toUtc,
    color: f.color,
    label: t('tonight.lane.filter', { filter: f.label, n: f.count }),
    ...(f.tense === 'past' ? { opacity: 0.4 } : {}),
  }));
  // Ereignisse: Milchstraßenzentrum als Fenster, Überflüge als Marken.
  const gc = sky.galactic?.tonight ?? null;
  const eventLane: TimelineSegment[] = gc
    ? [
        {
          fromUtc: gc.fromUtc,
          toUtc: gc.toUtc,
          color: 'var(--npm-chart-best)',
          label: t('tonight.lane.gc'),
          title: t('tonight.lane.gcTitle', { alt: n(gc.best.altDeg), time: hm(gc.best.t) }),
        },
      ]
    : [];
  const passMarkers = (sky.passes?.passes ?? []).map((p) => ({
    atUtc: p.max.t,
    color: 'var(--npm-chart-target-2)',
    title: t('tonight.lane.pass', {
      name: p.name,
      from: hm(p.startUtc),
      to: hm(p.endUtc),
      alt: n(p.max.altDeg),
    }),
  }));
  const planNote = plan.isError
    ? t('tonight.lane.planError')
    : plan.isPending
      ? t('tonight.lane.planPending')
      : t('tonight.lane.planEmpty');
  const lanes: TimelineLane[] = [
    { key: 'sky', label: t('tonight.lane.sky'), segments: skyLane, continuous: true },
    {
      key: 'weather',
      label: t('tonight.lane.weather'),
      segments: weatherLane,
      note: t('tonight.kpi.noForecast'),
      continuous: true,
    },
    {
      key: 'moon',
      label: t('tonight.lane.moon'),
      segments: moonLane,
      note: t('tonight.kpi.moonDown'),
      describe: true,
    },
    {
      key: 'plan',
      label: t('tonight.lane.plan'),
      segments: planLane,
      markers: flips,
      note: planNote,
      describe: true,
    },
    ...(filterLane.length > 0
      ? [{ key: 'filter', label: t('tonight.lane.filters'), segments: filterLane, describe: true }]
      : []),
    {
      key: 'events',
      label: t('tonight.lane.events'),
      segments: eventLane,
      markers: passMarkers,
      note: t('tonight.lane.noEvents'),
      describe: true,
    },
  ];
  return (
    <>
      <NightTimeline
        fromUtc={win.from}
        toUtc={win.to}
        timeZone={zone}
        nowUtc={nowUtc}
        lanes={lanes}
        label={t('tonight.timeline')}
      />
      {plan.computeError && actual ? (
        // Nur die Rechnung ab jetzt fehlt; Ist und gespeicherter Plan stehen oben (07.10.2026).
        <p className={styles.muted} role="status">
          {t('tonight.lane.computeError')}
        </p>
      ) : null}
    </>
  );
}
