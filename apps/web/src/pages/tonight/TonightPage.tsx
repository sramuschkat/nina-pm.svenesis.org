/**
 * S-02 „Heute Nacht“ (FK 14.3; FA-FOL-06, FA-FOL-05; AP-35; Umbau Wunsch Sven 27.09.2026): zuerst das **Rig**
 * wählen – damit steht der Standort fest –, dann für die **aktuelle Nacht** des Standorts (`GET /web/v1/tonight`,
 * vom Server nach NT-01 bestimmt – nie aus dem Browserdatum):
 * 1. „Mond und Dunkelheit“ (wie Objektbrowser und Sternkarte),
 * 2. der Plan des Rigs: NINA-Instanzen, Safety-Link, geplante Projekte mit erwarteten Frames (Prognose,
 *    AP-33), Zeilen „nur heute aus“ (Admin) – Dunkelheit, Mond und Wetter stehen in den Abschnitten 1 und 3
 *    und sind hier nicht doppelt (Wunsch Sven 27.09.2026),
 * 3. „Nacht im Detail“ (Stundentabelle aus Astro-Wetter, AP-23),
 * 4. „Mond & Planeten“ (Vorlage Beobachtungsplaner),
 * 5. „Ereignisse der Nacht“ (Überflüge, Meteorströme, Milchstraßenzentrum, Finsternisse; Vorlage
 *    Beobachtungsplaner, Bahndaten täglich vom `worker`).
 * Ungeprüfte Sessions und offene Warteschlange stehen nicht mehr hier (Sessions bzw. Projekte). Alle Zeiten in
 * Standortzeit mit Kürzel (NT-03).
 */
import { sky } from '@nina-pm/engine';
import { formatNightKey } from '@nina-pm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { forecastApi, tonightApi, type SiteView, type TonightRig } from '../../api/client';
import { useCan } from '../../auth';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { NightBodies } from '../../components/night-bodies';
import { NightEvents } from '../../components/night-events';
import { PageHeader } from '../../components/PageHeader';
import { ProblemMessage } from '../../components/ProblemMessage';
import { RigSelect, type RigOption } from '../../components/RigSelect';
import { SiteTime } from '../../components/SiteTime';
import { WeatherChart } from '../../components/WeatherChart';
import { useJob } from '../../lib/use-job';
import { problemCode } from '../admin/shared';
import { useEquipmentList } from '../equipment/shared';
import { SiteMoonDarkness } from '../planning/SiteMoonDarkness';
import { chartProps, useNow, useSiteWeather } from '../weather/WeatherPage';
import styles from './tonight.module.css';
import { TonightLines } from './TonightLines';
import { useSkySatellites } from './sky-satellites';

export const TONIGHT_PATH = '/heute-nacht';
export const TONIGHT_KEY = ['tonight'] as const;

export function TonightPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tonight = useQuery({
    queryKey: TONIGHT_KEY,
    queryFn: () => tonightApi.get(),
    // Die aktuelle Nacht wechselt am Ende des Nachtfensters; NINA meldet sich laufend.
    refetchInterval: 5 * 60_000,
  });
  const filters = useEquipmentList('filters');
  const equipmentRigs = useEquipmentList('rigs');
  const sites = useEquipmentList('sites');
  const telescopes = useEquipmentList('telescopes');
  const cameras = useEquipmentList('cameras');
  const colorOf = (short: string) =>
    (filters.data ?? []).find((f) => f.shortName === short)?.colorHex ?? '#888888';
  const rigs = tonight.data?.rigs ?? [];
  const rigOptions: RigOption[] = rigs.map((r) => {
    const e = (equipmentRigs.data ?? []).find((x) => x.id === r.rigId);
    return {
      id: r.rigId,
      name: r.rigName,
      siteName: r.siteName,
      telescopeName: (telescopes.data ?? []).find((x) => x.id === e?.telescopeId)?.name ?? '',
      cameraName: (cameras.data ?? []).find((x) => x.id === e?.cameraId)?.name ?? '',
      scaleArcsecPx: e?.derived.scaleArcsecPx ?? 0,
      fovDeg: [e?.derived.fovWidthDeg ?? 0, e?.derived.fovHeightDeg ?? 0],
      showInPlanning: e?.showInPlanning ?? true,
    };
  });
  // Rig aus der URL, sonst das erste für die Planung markierte, sonst das erste.
  const wanted = params.get('rig');
  const rig =
    rigs.find((r) => r.rigId === wanted) ??
    rigs.find((r) => rigOptions.find((o) => o.id === r.rigId)?.showInPlanning) ??
    rigs[0] ??
    null;
  const site = (sites.data ?? []).find((s) => s.id === rig?.siteId) ?? null;
  const contextId = useId();
  return (
    <div className={styles.page}>
      <PageHeader title={t('tonight.title')} meta={t('tonight.intro')} />
      {tonight.isError ? (
        <ProblemMessage code={problemCode(tonight.error)} onRetry={() => void tonight.refetch()} />
      ) : tonight.isPending ? (
        <p className={styles.muted} role="status">
          {t('common.loading')}
        </p>
      ) : rigs.length === 0 || !rig ? (
        <p className={styles.muted}>{t('tonight.empty')}</p>
      ) : (
        <>
          <section className={styles.context} aria-labelledby={contextId}>
            <h2 id={contextId} className="visually-hidden">
              {t('tonight.context')}
            </h2>
            <div className={styles.contextRig}>
              <RigSelect
                rigs={rigOptions}
                value={rig.rigId}
                onChange={(id) => {
                  const next = new URLSearchParams(params);
                  if (id) next.set('rig', id);
                  else next.delete('rig');
                  setParams(next, { replace: true });
                }}
              />
            </div>
            <span className={styles.muted}>
              {rig.siteName} · {t('tonight.night', { night: formatNightKey(rig.night) })}
            </span>
          </section>
          {site ? (
            <section className={styles.card} aria-label={t('moonDark.title')}>
              <div className={styles.cardBody}>
                <SiteMoonDarkness site={site} night={rig.night} current={rig.night} />
              </div>
            </section>
          ) : null}
          <RigCard key={rig.rigId} rig={rig} colorOf={colorOf} />
          {site ? <NightDetail site={site} night={rig.night} /> : null}
          {site ? <MoonAndPlanets site={site} rig={rig} /> : null}
          {site ? <SkyEvents site={site} rig={rig} /> : null}
        </>
      )}
    </div>
  );
}

/** „Nacht im Detail“: Stundentabelle aus Astro-Wetter (AP-23) für die Nacht des Rigs, ← → wie auf der Wetterseite. */
function NightDetail({ site, night }: { site: SiteView; night: string }) {
  const { t } = useTranslation();
  const headingId = useId();
  const now = useNow();
  const weather = useSiteWeather(site.id);
  const [selected, setSelected] = useState<string | null>(null);
  const view = weather.data;
  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <div className={styles.cardHead}>
        <h2 id={headingId} className={styles.cardTitle}>
          {t('tonight.detail')}
        </h2>
      </div>
      <div className={styles.cardBody}>
        {weather.isError ? (
          <ProblemMessage
            code={problemCode(weather.error)}
            onRetry={() => void weather.refetch()}
          />
        ) : !view ? (
          <p className={styles.muted} role="status">
            {t('common.loading')}
          </p>
        ) : view.status !== 'ready' ? (
          <p className={styles.muted}>{t('tonight.weatherNone')}</p>
        ) : (
          <WeatherChart
            {...chartProps(view, now)}
            detailOnly
            selectedNight={selected ?? night}
            onSelectNight={setSelected}
          />
        )}
      </div>
    </section>
  );
}

/**
 * „Mond & Planeten“ (Vorlage Beobachtungsplaner): Proben alle 10 min von einer Stunde vor Beginn bis eine Stunde
 * nach Ende des Nachtfensters (auf volle Stunden); Spalte „jetzt“ in der Nacht zur aktuellen Zeit, sonst 30 min
 * nach Beginn der Dunkelheit.
 */
/** Fenster von „Mond & Planeten“ und „Ereignisse der Nacht“: eine Stunde vor bis eine Stunde nach dem Nachtfenster. */
function eventWindow(rig: TonightRig): { from: number; to: number } | null {
  if (!rig.nightWindow) return null;
  const from = Date.parse(rig.nightWindow.startUtc) / 1000;
  const to = Date.parse(rig.nightWindow.endUtc) / 1000;
  return {
    from: Math.floor((from - 3600) / 3600) * 3600,
    to: Math.ceil((to + 3600) / 3600) * 3600,
  };
}

/** Grenzgröße der Schätzung „Erwartet“ (Vorlage: Standard 6,0 mag). */
const LIMITING_MAG = 6;

/**
 * „Ereignisse der Nacht“: Überflüge (Bahndaten `catalog/sky/satellites.json`), Meteorströme, Zentrum der
 * Milchstraße und die nächsten Finsternisse – alles aus der Engine, Proben alle 10 min wie die Vorlage.
 */
function SkyEvents({ site, rig }: { site: SiteView; rig: TonightRig }) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const satellites = useSkySatellites();
  const geo = useMemo(
    () => ({ latDeg: site.latitudeDeg, lonDeg: site.longitudeDeg }),
    [site.latitudeDeg, site.longitudeDeg],
  );
  const win = eventWindow(rig);
  const from = win?.from ?? null;
  const to = win?.to ?? null;
  const night = useMemo(() => {
    if (from === null || to === null) return null;
    const samples = sky.eventSamples(geo, from, to);
    const galactic = sky.galacticCentre(samples, geo);
    const mid = samples[Math.floor(samples.length / 2)];
    return {
      showers: sky.showersTonight(samples, geo).map((s) => ({
        tonight: s,
        rate: sky.meteorRate(s.shower, samples, geo, LIMITING_MAG),
      })),
      moonIllumPct: mid?.moonIllumPct ?? 0,
      galactic,
      season: galactic ? sky.galacticSeason(galactic.monthsHours) : null,
      eclipses: sky.nextEclipses(geo, from),
    };
  }, [geo, from, to]);
  const passes = useMemo(() => {
    if (!satellites.data || from === null || to === null) return null;
    return sky.satellitePassesForNight(satellites.data.satellites, from, to, {
      ...geo,
      elevationM: site.elevationM,
    });
  }, [satellites.data, geo, site.elevationM, from, to]);
  const generated = satellites.data ? Date.parse(satellites.data.generated) : null;
  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <div className={styles.cardHead}>
        <h2 id={headingId} className={styles.cardTitle}>
          {t('events.title')}
        </h2>
        {generated !== null ? (
          <span className={styles.muted}>
            {t('events.data', {
              date: new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-GB' : 'de-DE', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                timeZone: site.timeZone,
              }).format(generated),
            })}
          </span>
        ) : null}
      </div>
      <div className={styles.cardBody}>
        {!night || from === null ? (
          <p className={styles.muted}>{t('tonight.noWindow')}</p>
        ) : (
          <NightEvents
            timeZone={site.timeZone}
            nightUtc={from}
            passes={passes}
            showers={night.showers}
            moonIllumPct={night.moonIllumPct}
            limitingMag={LIMITING_MAG}
            galactic={night.galactic}
            season={night.season}
            eclipses={night.eclipses}
          />
        )}
      </div>
    </section>
  );
}

function MoonAndPlanets({ site, rig }: { site: SiteView; rig: TonightRig }) {
  const { t } = useTranslation();
  const headingId = useId();
  const now = Math.floor(useNow().getTime() / 1000);
  const geo = useMemo(
    () => ({ latDeg: site.latitudeDeg, lonDeg: site.longitudeDeg }),
    [site.latitudeDeg, site.longitudeDeg],
  );
  const from = rig.nightWindow ? Date.parse(rig.nightWindow.startUtc) / 1000 : null;
  const to = rig.nightWindow ? Date.parse(rig.nightWindow.endUtc) / 1000 : null;
  const rows = useMemo(() => {
    if (from === null || to === null) return [];
    const start = Math.floor((from - 3600) / 3600) * 3600;
    const end = Math.ceil((to + 3600) / 3600) * 3600;
    return sky.nightBodySamples(geo, start, end);
  }, [geo, from, to]);
  const first = rows[0];
  const last = rows[rows.length - 1];
  const inNight = first !== undefined && last !== undefined && now >= first.t && now <= last.t;
  const darkFrom = rig.dark ? Date.parse(rig.dark.fromUtc) / 1000 : (from ?? now);
  const at = inNight ? now : Math.floor((darkFrom + 1800) / 300) * 300;
  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <div className={styles.cardHead}>
        <h2 id={headingId} className={styles.cardTitle}>
          {t('bodies.title')}
        </h2>
      </div>
      <div className={styles.cardBody}>
        {rows.length > 1 ? (
          <NightBodies
            rows={rows}
            site={geo}
            timeZone={site.timeZone}
            atUtc={at}
            atIsNow={inNight}
          />
        ) : (
          <p className={styles.muted}>{t('tonight.noWindow')}</p>
        )}
      </div>
    </section>
  );
}

function RigCard({ rig, colorOf }: { rig: TonightRig; colorOf: (filter: string) => string }) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const canRun = useCan('simulation.run');
  const client = useQueryClient();
  const n = (x: number, d = 1) => x.toLocaleString(i18n.language, { maximumFractionDigits: d });
  const [jobId, setJobId] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => forecastApi.run(rig.rigId),
    onSuccess: (r) => setJobId(r.jobId),
  });
  const job = useJob<unknown>(jobId);
  const done = job.job.data?.status === 'done';
  useEffect(() => {
    if (done) void client.invalidateQueries({ queryKey: TONIGHT_KEY });
  }, [done, client]);
  const zone = rig.siteTimeZone;
  const columns: DataColumn<TonightRig['projects'][number]>[] = [
    {
      id: 'name',
      header: t('tonight.col.project'),
      sortValue: (p) => p.name,
      cell: (p) => <Link to={`/projekte/${p.projectId}`}>{p.name}</Link>,
    },
    {
      id: 'frames',
      header: t('tonight.col.frames'),
      align: 'end',
      sortValue: (p) => p.frames,
      cell: (p) => p.frames,
    },
    {
      id: 'hours',
      header: t('tonight.col.hours'),
      align: 'end',
      priority: 2,
      sortValue: (p) => p.hours,
      cell: (p) => `${n(p.hours)} h`,
    },
    {
      id: 'lines',
      header: t('tonight.col.lines'),
      cell: (p) => (
        <TonightLines
          projectId={p.projectId}
          lines={p.lines}
          colorOf={colorOf}
          onChanged={() => run.mutate()}
        />
      ),
    },
  ];
  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <div className={styles.cardHead}>
        <h2 id={headingId} className={styles.cardTitle}>
          {t('tonight.planTitle')}
        </h2>
      </div>
      <div className={styles.cardBody}>
        <dl className={styles.facts}>
          <div>
            <dt>{t('tonight.nina')}</dt>
            <dd>
              {rig.instances.length === 0
                ? t('tonight.ninaNone')
                : rig.instances.map((i, k) => (
                    <span key={i.id}>
                      {k > 0 ? ' · ' : ''}
                      {i.name}:{' '}
                      {i.lastSeenAt ? (
                        <>
                          {t('tonight.ninaSeen')}{' '}
                          <SiteTime atUtc={i.lastSeenAt} siteTimeZone={zone} withDate />
                        </>
                      ) : (
                        t('tonight.ninaNever')
                      )}
                    </span>
                  ))}
            </dd>
          </div>
        </dl>
        {rig.weatherSafetyUrl ? (
          <p>
            <a href={rig.weatherSafetyUrl} target="_blank" rel="noopener noreferrer">
              {t('tonight.safety')}
            </a>
          </p>
        ) : null}
        <h3 className={styles.subTitle}>{t('tonight.planned')}</h3>
        {run.error ? <ProblemMessage code={problemCode(run.error)} /> : null}
        {job.failed ? <ProblemMessage code={job.errorCode ?? 'internal.error'} /> : null}
        {job.running ? (
          <p className={styles.muted} role="status">
            {t('tonight.computing')}
          </p>
        ) : null}
        {!rig.forecast.covered ? (
          <p className={styles.note}>
            {t('tonight.notCovered')}{' '}
            {canRun ? (
              <button
                type="button"
                className={styles.button}
                disabled={run.isPending || job.running}
                onClick={() => run.mutate()}
              >
                {t('tonight.compute')}
              </button>
            ) : null}
          </p>
        ) : (
          <DataTable
            columns={columns}
            rows={rig.projects}
            rowKey={(p) => p.projectId}
            rowLabel={(p) => p.name}
            label={t('tonight.plannedLabel', { rig: rig.rigName })}
            empty={t('tonight.noProjects')}
          />
        )}
        {rig.forecast.covered && rig.idleProjects > 0 ? (
          <p className={styles.muted}>{t('tonight.idle', { n: rig.idleProjects })}</p>
        ) : null}
      </div>
    </section>
  );
}
