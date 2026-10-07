/**
 * S-02 „Heute Nacht“ (FK 14.3; FA-FOL-06, FA-FOL-05; AP-35; Umbau 27./28.09.2026 nach Entwurf Sven): zuerst das
 * **Rig** wählen – damit steht der Standort fest –, dann für die **aktuelle Nacht** des Standorts
 * (`GET /web/v1/tonight`, vom Server nach NT-01 – nie aus dem Browserdatum):
 * 0. Nachtwahl als Mondkalender: laufende Nacht und die folgenden sechs (`?nacht=`, 30.09.2026 – so weit reicht
 *    das Astro-Wetter); künftige Nächte zeigen den Plan aus dem heutigen Projektstand, NINA nur die laufende,
 * 1. Kopf mit Einschätzung und Countdown,
 * 2. vier Kennzahlen (Dunkel, Mond, Wetter, Plan/NINA) – die Zahlen stehen nur hier,
 * 3. Zeitleiste der Nacht auf einer Achse: Himmel, Wetter, Mond, Plan (Simulation im Browser wie der
 *    Simulator: Projektblöcke, Flips, Flats), Filter, Ereignisse; rote Linie „jetzt“,
 * 4. direkt darunter eingeklappt: „Nachtwetter im Detail“ (Stundentabelle Astro-Wetter) und die Sichtbarkeit
 *    von Mond & Planeten (28.09.2026),
 * 5. zwei Spalten: links der Plan (geplante Projekte aus der Prognose, „nur heute aus“, Safety-Link),
 *    rechts „Ereignisse der Nacht“.
 * Alle Zeiten in Standortzeit mit Kürzel (NT-03).
 */
import {
  formatNightKey,
  formatTzAbbr,
  formatZonedTime,
  nightUsage,
  tonightProjects,
} from '@nina-pm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState, type ReactNode } from 'react';
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
import { WeatherChart } from '../../components/WeatherChart';
import { useJob } from '../../lib/use-job';
import { problemCode } from '../admin/shared';
import { useEquipmentList } from '../equipment/shared';
import { useNightPlan, type NightPlanState } from '../simulator/use-night-plan';
import type { DoneCard } from '../simulator/simulate';
import { chartProps, useNow, useSiteWeather } from '../weather/WeatherPage';
import { LIMITING_MAG, useNightSky, type NightSky } from './night-sky';
import { CommentCount } from '../../components/CommentCount';
import { useCommentCounts } from '../../lib/use-comment-counts';
import styles from './tonight.module.css';
import { MoonCalendar } from './MoonCalendar';
import { TonightLines } from './TonightLines';
import { KpiTiles, TonightTimeline, Verdict } from './TonightOverview';
import { Person } from '../../lib/member';

export const TONIGHT_PATH = '/heute-nacht';
export const TONIGHT_KEY = ['tonight'] as const;

/** Zeile ohne Frames im Rest: läuft an der Rig, noch geplant (gespeicherter Plan) bzw. abgearbeitet (07.10.2026). */
const DONE_TEXT = {
  running: 'tonight.runningTonight',
  planned: 'tonight.plannedTonight',
  done: 'tonight.doneTonight',
} as const;

export function TonightPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const now = Math.floor(useNow().getTime() / 1000);
  const tonight = useQuery({
    queryKey: TONIGHT_KEY,
    queryFn: () => tonightApi.get(),
    // Die aktuelle Nacht wechselt am Ende des Nachtfensters; NINA meldet sich laufend.
    refetchInterval: 5 * 60_000,
  });
  const equipmentRigs = useEquipmentList('rigs');
  const sites = useEquipmentList('sites');
  const telescopes = useEquipmentList('telescopes');
  const cameras = useEquipmentList('cameras');
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
  // Gewählte Nacht (Mondkalender); die laufende Nacht kommt aus der Übersicht.
  const wantedNight = params.get('nacht');
  const future = rig !== null && wantedNight !== null && wantedNight !== rig.currentNight;
  const selectedQuery = useQuery({
    queryKey: [...TONIGHT_KEY, rig?.rigId ?? '', wantedNight ?? ''],
    queryFn: () => tonightApi.get(rig?.rigId, wantedNight ?? undefined),
    enabled: future,
    refetchInterval: 5 * 60_000,
  });
  const shown = future ? (selectedQuery.data?.rigs[0] ?? null) : rig;
  const setNight = (night: string) => {
    const next = new URLSearchParams(params);
    if (rig && night !== rig.currentNight) next.set('nacht', night);
    else next.delete('nacht');
    setParams(next, { replace: true });
  };
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
              {rig.siteName} ·{' '}
              {t('tonight.night', { night: formatNightKey(shown?.night ?? rig.night) })}
            </span>
            {shown ? <Verdict rig={shown} nowUtc={now} /> : null}
            {site ? (
              <MoonCalendar
                rig={rig}
                geo={{ latDeg: site.latitudeDeg, lonDeg: site.longitudeDeg }}
                selected={shown?.night ?? rig.night}
                onSelect={setNight}
              />
            ) : null}
          </section>
          {future && selectedQuery.isError ? (
            <ProblemMessage
              code={problemCode(selectedQuery.error)}
              onRetry={() => setNight(rig.currentNight)}
            />
          ) : !shown ? (
            <p className={styles.muted} role="status">
              {t('common.loading')}
            </p>
          ) : site ? (
            <Night key={`${shown.rigId}-${shown.night}`} rig={shown} site={site} now={now} />
          ) : null}
        </>
      )}
    </div>
  );
}

/** Alles unterhalb der Kontextleiste für das gewählte Rig. */
function Night({ rig, site, now }: { rig: TonightRig; site: SiteView; now: number }) {
  const { t } = useTranslation();
  const filters = useEquipmentList('filters');
  const colorOf = (short: string) =>
    (filters.data ?? []).find((f) => f.shortName === short)?.colorHex ?? '#888888';
  const sky = useNightSky(site, rig);
  const current = rig.night === rig.currentNight;
  // Laufende Nacht und Nachtfenster vom Server: läuft die Session nach Fensterende noch, bleibt die Nacht „laufend“.
  const plan = useNightPlan(rig.rigId, rig.night, { current, window: rig.nightWindow });
  const timelineId = useId();
  return (
    <>
      {current ? null : <p className={styles.futureNote}>{t('tonight.futureNote')}</p>}
      {plan.deliveryOff ? (
        // Rig-Schalter „An NINA ausliefern“ aus (07.10.2026): die Rechnung zeigt nur, was das Rig eingeschaltet täte.
        <p className={styles.futureNote} role="status">
          {t('tonight.deliveryOff')}
        </p>
      ) : null}
      <KpiTiles rig={rig} sky={sky} plan={plan} />
      <section className={styles.card} aria-labelledby={timelineId}>
        <div className={styles.cardHead}>
          <h2 id={timelineId} className={styles.cardTitle}>
            {t('tonight.timeline')}
          </h2>
        </div>
        <div className={styles.cardBody}>
          <TonightTimeline rig={rig} sky={sky} plan={plan} nowUtc={now} />
        </div>
      </section>
      {/* Details direkt unter der Zeitleiste, eingeklappt (Wunsch Sven 28.09.2026). */}
      <Fold title={t('tonight.detail')}>
        <NightDetail site={site} night={rig.night} />
      </Fold>
      <Fold title={t('tonight.bodiesDetail')}>
        <MoonAndPlanets site={site} sky={sky} now={now} />
      </Fold>
      <div className={styles.split}>
        <RigCard rig={rig} colorOf={colorOf} plan={plan} timeZone={site.timeZone} />
        <SkyEvents site={site} sky={sky} />
      </div>
    </>
  );
}

/** Eingeklappter Abschnitt (details/summary) – Diagramme für wer tiefer schauen will. */
function Fold({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details className={styles.fold} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className={styles.foldSummary}>{title}</summary>
      {open ? <div className={styles.foldBody}>{children}</div> : null}
    </details>
  );
}

/** „Nacht im Detail“: Stundentabelle aus Astro-Wetter (AP-23), ← → wie auf der Wetterseite. */
function NightDetail({ site, night }: { site: SiteView; night: string }) {
  const { t } = useTranslation();
  const now = useNow();
  const weather = useSiteWeather(site.id);
  const [selected, setSelected] = useState<string | null>(null);
  const view = weather.data;
  if (weather.isError)
    return (
      <ProblemMessage code={problemCode(weather.error)} onRetry={() => void weather.refetch()} />
    );
  if (!view)
    return (
      <p className={styles.muted} role="status">
        {t('common.loading')}
      </p>
    );
  if (view.status !== 'ready') return <p className={styles.muted}>{t('tonight.weatherNone')}</p>;
  return (
    <WeatherChart
      {...chartProps(view, now)}
      detailOnly
      selectedNight={selected ?? night}
      onSelectNight={setSelected}
    />
  );
}

/** „Ereignisse der Nacht“ (rechte Spalte): Gruppen aufklappbar mit erster Zeile im Kopf. */
function SkyEvents({ site, sky }: { site: SiteView; sky: NightSky }) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <div className={styles.cardHead}>
        <h2 id={headingId} className={styles.cardTitle}>
          {t('events.title')}
        </h2>
        {sky.satellitesGenerated !== null ? (
          <span className={styles.muted}>
            {t('events.data', {
              date: new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-GB' : 'de-DE', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                timeZone: site.timeZone,
              }).format(sky.satellitesGenerated),
            })}
          </span>
        ) : null}
      </div>
      <div className={styles.cardBody}>
        {!sky.window ? (
          <p className={styles.muted}>{t('tonight.noWindow')}</p>
        ) : (
          <NightEvents
            timeZone={site.timeZone}
            nightUtc={sky.window.from}
            passes={sky.passes}
            showers={sky.showers}
            moonIllumPct={sky.moonIllumPct}
            limitingMag={LIMITING_MAG}
            galactic={sky.galactic}
            season={sky.season}
            eclipses={sky.eclipses}
          />
        )}
      </div>
    </section>
  );
}

/** Sichtbarkeit von Mond & Planeten (eingeklappt): Karten und Balken der Vorlage. */
function MoonAndPlanets({ site, sky, now }: { site: SiteView; sky: NightSky; now: number }) {
  const { t } = useTranslation();
  const rows = sky.bodies;
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last || rows.length < 2)
    return <p className={styles.muted}>{t('tonight.noWindow')}</p>;
  const inNight = now >= first.t && now <= last.t;
  const at = inNight ? now : Math.floor((first.t + 3 * 3600) / 300) * 300;
  return (
    <NightBodies rows={rows} site={sky.geo} timeZone={site.timeZone} atUtc={at} atIsNow={inNight} />
  );
}

/** Plan der Nacht: geplante Projekte aus der Prognose (AP-33) mit „nur heute aus“, Safety-Link, Prognose rechnen. */
function RigCard({
  rig,
  colorOf,
  plan,
  timeZone,
}: {
  rig: TonightRig;
  colorOf: (filter: string) => string;
  plan: NightPlanState;
  timeZone: string;
}) {
  const { t, i18n } = useTranslation();
  // Laufende Nacht (eine Quelle, Entscheidung Sven 07.10.2026): mit gespeichertem Plan Frames aus dessen offenem Rest
  // (was die Rig ausführt), sonst aus dem ab jetzt gerechneten Plan (wie Zeitleiste und Simulator, mit Transits); die
  // gespeicherte Prognose wird nur einmal je Standortnacht gerechnet und kennt spätere Freigaben nicht.
  // Künftige Nächte (Nachtwahl) bleiben bei der Prognose.
  const fromRig = plan.rigNight ?? null;
  const usage =
    rig.night !== rig.currentNight
      ? null
      : fromRig
        ? nightUsage({ blocks: fromRig.blocks } as unknown as Parameters<typeof nightUsage>[0])
        : plan.result
          ? nightUsage(plan.result.plan)
          : null;
  const states = new Map((plan.done ?? []).map((d) => [d.projectId, d]));
  const live = usage
    ? tonightProjects(
        plan.projects as unknown as Parameters<typeof tonightProjects>[0],
        rig.rigId,
        rig.night,
        usage,
        new Set(states.keys()),
      )
    : null;
  // Ohne Frames im Rest (07.10.2026): läuft an der Rig, im gespeicherten Plan noch geplant bzw. heute Nacht abgearbeitet
  // (ausgegraut) – unter den geplanten.
  type Row = TonightRig['projects'][number] & {
    readonly done?: DoneCard;
    readonly state?: DoneCard['state'];
  };
  const planned = (live?.projects ?? rig.projects).map((p) => ({
    ...p,
    ...(states.get(p.projectId) ? { state: states.get(p.projectId)?.state } : {}),
  }));
  const rows: Row[] = [
    ...planned,
    ...(live ? (plan.done ?? []) : [])
      .filter((d) => !planned.some((p) => p.projectId === d.projectId))
      .map((d) => ({
        projectId: d.projectId,
        name: d.name,
        createdBy: d.createdBy ?? '',
        priority: 0,
        frames: 0,
        hours: 0,
        lines: [],
        done: d,
      })),
  ];
  const hm = (atUtc: string) =>
    `${formatZonedTime(atUtc, timeZone)} ${formatTzAbbr(atUtc, timeZone)}`;
  const idle = live?.idle ?? rig.idleProjects;
  const covered = live !== null || rig.forecast.covered;
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
  const comments = useCommentCounts();
  const done = job.job.data?.status === 'done';
  useEffect(() => {
    if (done) void client.invalidateQueries({ queryKey: TONIGHT_KEY });
  }, [done, client]);
  const columns: DataColumn<Row>[] = [
    {
      id: 'name',
      header: t('tonight.col.project'),
      sortValue: (p) => p.name,
      cell: (p) => (
        <>
          <Link to={`/projekte/${p.projectId}`}>{p.name}</Link>{' '}
          <CommentCount count={comments(p.projectId)} />
          {!p.done && p.state === 'running' ? (
            <span className={styles.muted}> · {t('tonight.runningTag')}</span>
          ) : null}
        </>
      ),
    },
    {
      // Ersteller mit Bild (Wunsch Sven 30.09.2026); Name aus dem Mitgliederverzeichnis.
      id: 'creator',
      header: t('tonight.col.creator'),
      priority: 3,
      cell: (p) => <Person id={p.createdBy || null} />,
    },
    {
      id: 'frames',
      header: t('tonight.col.frames'),
      align: 'end',
      sortValue: (p) => p.frames,
      cell: (p) => (p.done ? '–' : p.frames),
    },
    {
      id: 'hours',
      header: t('tonight.col.hours'),
      align: 'end',
      priority: 2,
      sortValue: (p) => p.hours,
      cell: (p) => (p.done ? '–' : `${n(p.hours)} h`),
    },
    {
      id: 'lines',
      header: t('tonight.col.lines'),
      cell: (p) =>
        p.done ? (
          <span className={styles.muted}>
            {t(DONE_TEXT[p.done.state], {
              n: p.done.exposures,
              from: hm(p.done.fromUtc),
              to: p.done.toUtc ? hm(p.done.toUtc) : '…',
            })}
          </span>
        ) : (
          <TonightLines
            projectId={p.projectId}
            lines={p.lines}
            colorOf={colorOf}
            onChanged={() => run.mutate()}
            readOnly={rig.night !== rig.currentNight}
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
        {plan.stored?.stale ? (
          // AP-53c (Entscheidung 4): die Rig plant noch mit einer älteren Eingabe.
          <span className={styles.staleBadge} role="status">
            {t('simulator.source.stale', {
              revision: plan.stored.revision,
              time: `${formatZonedTime(plan.stored.createdAtUtc, timeZone)} ${formatTzAbbr(plan.stored.createdAtUtc, timeZone)}`,
            })}
            {' · '}
            {t(
              plan.stored.staleCause === 'settings'
                ? 'simulator.source.staleSettings'
                : 'simulator.source.staleTargets',
            )}
          </span>
        ) : null}
        {rig.weatherSafetyUrl ? (
          <a
            className={styles.more}
            href={rig.weatherSafetyUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('tonight.safety')}
          </a>
        ) : null}
      </div>
      <div className={styles.cardBody}>
        {run.error ? <ProblemMessage code={problemCode(run.error)} /> : null}
        {job.failed ? <ProblemMessage code={job.errorCode ?? 'internal.error'} /> : null}
        {job.running ? (
          <p className={styles.muted} role="status">
            {t('tonight.computing')}
          </p>
        ) : null}
        {!covered ? (
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
            rows={rows}
            rowKey={(p) => p.projectId}
            rowLabel={(p) => p.name}
            rowProps={(p) =>
              p.done?.state === 'done' ? { className: styles.rowDone, 'data-done': 'true' } : {}
            }
            label={t('tonight.plannedLabel', { rig: rig.rigName })}
            empty={t('tonight.noProjects')}
          />
        )}
        {covered && idle > 0 ? (
          <p className={styles.muted}>{t('tonight.idle', { n: idle })}</p>
        ) : null}
      </div>
    </section>
  );
}
