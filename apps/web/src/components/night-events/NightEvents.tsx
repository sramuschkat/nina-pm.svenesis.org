/**
 * „Ereignisse der Nacht“ (Heute Nacht, Wunsch Sven 27.09.2026; Vorbild `renderEvents` im Beobachtungsplaner):
 * vier aufklappbare Gruppen mit Anzahl und erster Zeile im Kopf – Überflüge von Raumstationen und Hubble,
 * Meteorströme, Zentrum der Milchstraße, die nächsten Finsternisse am Standort. Leere Gruppen entfallen (die
 * Überflüge bleiben, wenn es einen Hinweis zu veralteten Bahndaten gibt). Reine Anzeige der Engine-Ergebnisse
 * (`sky.satellitePassesForNight`, `sky.showersTonight`, `sky.meteorRate`, `sky.galacticCentre`,
 * `sky.nextEclipses`); Zeiten in Standortzeit.
 */
import type { sky } from '@nina-pm/engine';
import { formatTzAbbr, formatZonedTime } from '@nina-pm/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { iso } from '../night-chart/model';
import { ICON_SIZE, skyEventIcons } from '../icons';
import styles from './NightEvents.module.css';

const COMPASS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;

export interface NightEventsProps {
  readonly timeZone: string;
  /** Ein Zeitpunkt der Nacht (Zonenkürzel im Hinweis). */
  readonly nightUtc: number;
  /** Überflüge der Nacht; `null`, solange die Bahndaten laden. */
  readonly passes: sky.NightPasses | null;
  readonly showers: readonly {
    readonly tonight: sky.ShowerTonight;
    readonly rate: sky.MeteorRate | null;
  }[];
  /** Beleuchteter Anteil des Mondes zur Mitte der Nacht, % (Spalte „Mond“ der Ströme). */
  readonly moonIllumPct: number;
  /** Grenzgröße der Schätzung „Erwartet“ (Vorlage: 6,0 mag). */
  readonly limitingMag: number;
  readonly galactic: sky.GalacticCentre | null;
  readonly season: sky.GalacticSeason | null;
  readonly eclipses: readonly sky.SiteEclipse[];
}

export function NightEvents(props: NightEventsProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'en' ? 'en-GB' : 'de-DE';
  const { timeZone } = props;
  // Minuszeichen statt Bindestrich (−0,6 mag)
  const n = (x: number, d = 0) =>
    x.toLocaleString(i18n.language, { maximumFractionDigits: d }).replace(/^-/, '−');
  // Auf die nächste Minute gerundet wie die Vorlage (Ende 02:24:53Z → 21:25 CDT).
  const hm = (at: number) => formatZonedTime(iso(Math.round(at / 60) * 60), timeZone);
  const dir = (az: number) => t(`bodies.compass.${COMPASS[Math.round(az / 45) % 8] ?? 'n'}`);
  const day = (at: number, withTime: boolean) =>
    `${new Intl.DateTimeFormat(lang, {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone,
    }).format(at * 1000)}${withTime ? `, ${hm(at)} ${formatTzAbbr(iso(at), timeZone)}` : ''}`;
  const span = (a: number | null, b: number | null) =>
    a === null || b === null ? null : { a: hm(a), b: hm(b) };
  const monthName = (m: number) =>
    new Intl.DateTimeFormat(lang, { month: 'short', timeZone: 'UTC' })
      .format(Date.UTC(2026, m, 15))
      .replace('.', '');

  const groups: {
    key: keyof typeof skyEventIcons;
    count: number;
    peek: string;
    body: ReactNode;
  }[] = [];

  // Überflüge
  const p = props.passes;
  if (p) {
    const warning =
      p.stale.length === 0
        ? null
        : p.allStale
          ? t('events.stale', {
              date: day(Math.max(...p.stale.map((s) => s.epochUtc)), false),
            })
          : t('events.staleSome', {
              list: p.stale
                .map((s) => t('events.staleItem', { name: s.name, date: day(s.epochUtc, false) }))
                .join(', '),
            });
    if (p.passes.length > 0 || warning) {
      const first = p.passes[0];
      groups.push({
        key: 'satellites',
        count: p.passes.length,
        peek: first ? `${first.name} · ${hm(first.startUtc)}–${hm(first.endUtc)}` : '',
        body: (
          <>
            {warning ? <p className={styles.warning}>{warning}</p> : null}
            {p.passes.length > 0 ? (
              <Table
                label={t('events.group.satellites')}
                head={['sat', 'time', 'high', 'mag', 'path'].map((k) => t(`events.head.${k}`))}
                rows={p.passes.map((s) => {
                  const from = s.track[0];
                  const to = s.track[s.track.length - 1];
                  return [
                    s.name,
                    `${hm(s.startUtc)}–${hm(s.endUtc)}`,
                    t('events.at', {
                      time: hm(s.max.t),
                      alt: n(s.max.altDeg),
                      dir: dir(s.max.azDeg),
                    }),
                    s.brightestMag === null
                      ? '–'
                      : t('events.upTo', { v: `${n(s.brightestMag, 1)} mag` }),
                    [
                      from && to
                        ? t('events.path', { from: dir(from.azDeg), to: dir(to.azDeg) })
                        : '',
                      s.faded ? t('events.shadow') : '',
                    ]
                      .filter(Boolean)
                      .join(' · '),
                  ];
                })}
              />
            ) : (
              <p className={styles.muted}>{t('events.noPass')}</p>
            )}
          </>
        ),
      });
    }
  }

  // Meteorströme
  if (props.showers.length > 0) {
    const peak = (d: number) => {
      const dd = Math.round(Math.abs(d));
      if (dd < 1) return t('events.peakNow');
      if (d > 0) return dd === 1 ? t('events.peakInOne') : t('events.peakIn', { d: dd });
      return dd === 1 ? t('events.peakAgoOne') : t('events.peakAgo', { d: dd });
    };
    const radiant = (s: sky.ShowerTonight) => {
      if (!s.best) return t('events.radNoDark');
      if (s.best.altDeg <= 0) return t('events.radDown');
      if (s.from30Utc !== null)
        return t('events.radFrom', {
          time: hm(s.from30Utc),
          best: hm(s.best.t),
          alt: n(s.best.altDeg),
        });
      return t('events.radLow', { best: hm(s.best.t), alt: n(s.best.altDeg) });
    };
    const first = props.showers[0];
    groups.push({
      key: 'showers',
      count: props.showers.length,
      peek: first
        ? `${t(`events.shower.${first.tonight.shower.key}`)} · ${peak(first.tonight.daysToPeak)}`
        : '',
      body: (
        <>
          <Table
            label={t('events.group.showers')}
            head={['shower', 'peak', 'radiant', 'zhr', 'expect', 'moon'].map((k) =>
              t(`events.head.${k}`),
            )}
            rows={props.showers.map(({ tonight: s, rate }) => [
              t(`events.shower.${s.shower.key}`),
              peak(s.daysToPeak),
              radiant(s),
              t('events.upTo', { v: n(s.shower.zhr) }),
              rate && rate.t !== null
                ? t('events.rate', {
                    n: n(rate.perHour, rate.perHour < 1 ? 1 : 0),
                    time: hm(rate.t),
                  })
                : '–',
              t('events.illum', { pct: n(props.moonIllumPct) }),
            ])}
          />
          <p className={styles.note}>
            {t('events.zhrNote')} {t('events.rateNote', { lm: n(props.limitingMag, 1) })}
          </p>
        </>
      ),
    });
  }

  // Zentrum der Milchstraße
  const gc = props.galactic;
  if (gc) {
    const tn = gc.tonight;
    const season = props.season;
    const seasonText = !season
      ? '–'
      : season.none
        ? t('events.gcNoSeason')
        : season.allYear
          ? t('events.allYear')
          : season.runs
              .map((r) =>
                r.fromMonth === r.toMonth
                  ? monthName(r.fromMonth)
                  : `${monthName(r.fromMonth)}–${monthName(r.toMonth)}`,
              )
              .join(', ');
    const when = tn
      ? `${tn.fromUtc === tn.toUtc ? hm(tn.fromUtc) : `${hm(tn.fromUtc)}–${hm(tn.toUtc)}`}${tn.level === -12 ? ` ${t('events.gcNautical')}` : ''}`
      : t('events.gcNone');
    groups.push({
      key: 'galacticCentre',
      count: tn ? 1 : 0,
      peek: `${t('events.gcName')} · ${when}`,
      body: (
        <>
          <Table
            label={t('events.group.galacticCentre')}
            head={['sat', 'gcWhen', 'gcBest', 'moon', 'gcSeason'].map((k) => t(`events.head.${k}`))}
            rows={[
              [
                t('events.gcName'),
                when,
                tn
                  ? t('events.at', {
                      time: hm(tn.best.t),
                      alt: n(tn.best.altDeg),
                      dir: dir(tn.best.azDeg),
                    })
                  : '–',
                tn
                  ? tn.moonSepDeg === null
                    ? t('events.moonDown', { pct: n(tn.moonIllumPct) })
                    : t('events.moonSep', { pct: n(tn.moonIllumPct), d: n(tn.moonSepDeg) })
                  : '–',
                seasonText,
              ],
            ]}
          />
          <p className={styles.note}>{t('events.gcNote')}</p>
        </>
      ),
    });
  }

  // Finsternisse
  if (props.eclipses.length > 0) {
    const name = (e: sky.SiteEclipse) =>
      e.body === 'lunar' ? t(`events.eclLunar.${e.kind}`) : t(`events.eclSolar.${e.kind}`);
    const first = props.eclipses[0];
    groups.push({
      key: 'eclipses',
      count: props.eclipses.length,
      peek: first ? `${name(first)} · ${day(first.maxUtc, true)}` : '',
      body: (
        <>
          <Table
            label={t('events.group.eclipses')}
            head={['ecl', 'eclWhen', 'eclPhase', 'eclVis'].map((k) => t(`events.head.${k}`))}
            rows={props.eclipses.map((e) => {
              const size =
                e.body === 'solar'
                  ? t('events.eclObsc', { p: n(e.obscuration * 100) })
                  : t('events.eclMag', {
                      m: (e.umbralMag > 0 ? e.umbralMag : e.penumbralMag).toLocaleString(
                        i18n.language,
                        { minimumFractionDigits: 2, maximumFractionDigits: 2 },
                      ),
                    });
              let phases: string[];
              if (e.body === 'solar') {
                const central = span(e.c2Utc, e.c3Utc);
                phases = [
                  `${hm(e.c1Utc)}–${hm(e.c4Utc)}`,
                  central && e.kind !== 'partial' ? t(`events.eclCentral.${e.kind}`, central) : '',
                ];
              } else {
                const umbra = span(e.u1Utc, e.u4Utc);
                const total = span(e.u2Utc, e.u3Utc);
                phases = [
                  umbra
                    ? t('events.eclUmbra', umbra)
                    : t('events.eclPenumbra', { a: hm(e.p1Utc), b: hm(e.p4Utc) }),
                  total ? t('events.eclTotal', total) : '',
                ];
              }
              return [
                name(e),
                `${day(e.maxUtc, true)} · ${size}`,
                phases.filter(Boolean).join(' · '),
                `${e.whole ? t('events.eclWhole') : t('events.eclPart', { a: hm(e.visFromUtc), b: hm(e.visToUtc) })} · ${t('events.eclAlt', { a: n(e.altDeg) })}`,
              ];
            })}
          />
          <p className={styles.note}>{t('events.eclNote')}</p>
        </>
      ),
    });
  }

  if (groups.length === 0) return <p className={styles.muted}>{t('events.none')}</p>;
  return (
    <div className={styles.groups}>
      {groups.map((g) => {
        const Icon = skyEventIcons[g.key];
        return (
          <details key={g.key} className={styles.group}>
            <summary className={styles.summary}>
              <Icon size={ICON_SIZE.button} className={styles.icon} aria-hidden />
              <span className={styles.title}>{t(`events.group.${g.key}`)}</span>
              <span className={styles.badge} aria-label={t('events.count', { n: g.count })}>
                {g.count}
              </span>
              {g.peek ? <span className={styles.peek}>{g.peek}</span> : null}
            </summary>
            <div className={styles.body}>{g.body}</div>
          </details>
        );
      })}
      <p className={styles.note}>
        {t('events.zoneNote', { zone: formatTzAbbr(iso(props.nightUtc), timeZone) })}
      </p>
    </div>
  );
}

function Table({
  label,
  head,
  rows,
}: {
  label: string;
  head: readonly string[];
  rows: readonly (readonly string[])[];
}) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table} aria-label={label}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${String(i)}-${r[0] ?? ''}`}>
              {r.map((c, k) => (
                <td key={`${String(k)}-${head[k] ?? ''}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
