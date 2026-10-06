/**
 * S-40 Nacht-Simulator (AP-13f; FK 6.7, 14.3; FA-SIM-01…08): Ergebnis zuerst (AP-26b). Oben eine
 * Kurzfassung der Einstellungen (Rig, Standort, Teleskop, Strategie, Wiedergabe) mit Schalter
 * *Einstellungen*, der Rigwahl, Entwürfe und Scheduler-Einstellungen (Admin bearbeitbar) auf- und
 * zuklappt – zugeklappt, sobald Rig und Nacht feststehen. Darunter Nachtwahl und das Ergebnis auf einer
 * Seite (AP-26g): Zielkarten, Nachtplan (Grafik, Zeitschieber), Planprotokoll (kompakt, Kopieren/CSV),
 * Prüfungen.
 * Daten: Rig, Projekte, Mondprofile und Nacht-Tabelle des Servers (NT-02) → `buildPlanInput`
 * → `planNight` im Web Worker. Entwürfe des Users nur lokal; Speichern als `night_plan`.
 * Seitengerüst `PageHeader` mit den NINA-Bereichsreitern, *Simulieren* als Hauptaktion rechts;
 * Einstellungen, Nachtwahl und Ergebnis als Karten (Stilsystem AP-26d).
 */
import { daysFromKey, keyFromDays } from '@nina-pm/engine';
import { formatTzAbbr, formatZonedTime, formatNightKey } from '@nina-pm/shared';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import {
  equipmentApi,
  projectsApi,
  simulationApi,
  type ProjectView,
  type RigView,
} from '../../api/client';
import { useCan } from '../../auth';
import { CheckList, type CheckItem } from '../../components/CheckList';
import { DataTable, type DataColumn, type SortValue } from '../../components/DataTable';
import { FilterChip } from '../../components/FilterChip';
import { ICON_SIZE, actionIcons, uiIcons } from '../../components/icons';
import { NightChart } from '../../components/night-chart';
import { clock } from '../../components/night-chart/model';
import { PageHeader } from '../../components/PageHeader';
import { ProblemMessage } from '../../components/ProblemMessage';
import { RigSelect, type RigOption } from '../../components/RigSelect';
import { SchedulerForm } from '../equipment/RigsPage';
import { NinaTabs } from '../nina/NinaLayout';
import { MultiNightPanel } from './MultiNightPanel';
import { UptakeStatus } from '../nina/UptakeStatus';
import { problemCode, useEquipmentList } from '../equipment/shared';
import {
  PROTOCOL_COLUMNS,
  cell,
  protocolCsv,
  protocolTsv,
  siteClock,
  type ProtocolColumn,
} from './protocol';
import type {
  Check,
  ProtocolRow,
  SimulationRequest,
  SimulationResult,
  TargetCard,
} from './simulate';
import { moonProfileLabel } from '../../lib/moon-profile-label';
import { useUniformWidth } from '../../lib/use-uniform-width';
import { CommentCount } from '../../components/CommentCount';
import { useCommentCounts } from '../../lib/use-comment-counts';
import styles from './simulator.module.css';
import { useSimulator } from './use-simulator';
import { Person } from '../../lib/member';

const EDITABLE_OWN = new Set(['draft', 'submitted', 'returned']);
const hm = (atUtc: string, tz: string) =>
  `${formatZonedTime(atUtc, tz)} ${formatTzAbbr(atUtc, tz)}`;
const iso = (unix: number) => new Date(unix * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const shiftNight = (night: string, days: number) => keyFromDays(daysFromKey(night) + days);

/**
 * Protokollspalten (AP-26a): Zeit, Befehl und Ziel bleiben immer sichtbar; je größer die Priorität,
 * desto früher weicht die Spalte in die Detailzeile. Sortiert wird nach Rohwerten, nicht nach Text.
 */
const PROTOCOL_SPEC: Record<
  ProtocolColumn,
  { priority: number; sort: (r: ProtocolRow) => SortValue }
> = {
  time: { priority: 1, sort: (r) => r.atUtc },
  cmd: { priority: 1, sort: (r) => r.cmd },
  target: { priority: 1, sort: (r) => r.projectName },
  panel: { priority: 3, sort: (r) => r.panel },
  no: { priority: 3, sort: (r) => r.no },
  filter: { priority: 2, sort: (r) => r.filter },
  exposure: { priority: 2, sort: (r) => r.exposureS },
  gain: { priority: 5, sort: (r) => r.gain },
  offset: { priority: 5, sort: (r) => r.offset },
  binning: { priority: 5, sort: (r) => r.binning },
  readout: { priority: 6, sort: (r) => r.readoutMode },
  rotation: { priority: 5, sort: (r) => r.rotationDeg },
  ra: { priority: 7, sort: (r) => r.raDeg },
  dec: { priority: 7, sort: (r) => r.decDeg },
  alt: { priority: 3, sort: (r) => r.altDeg },
  moonSep: { priority: 4, sort: (r) => r.moonSepDeg },
  moonOk: { priority: 4, sort: (r) => r.moonOk },
  required: { priority: 6, sort: (r) => r.requiredSepDeg },
  dark: { priority: 6, sort: (r) => r.dark },
  la: { priority: 6, sort: (r) => r.la },
  profile: { priority: 5, sort: (r) => r.moonProfile },
};

const protocolColumns = (t: Parameters<typeof cell>[2], tz: string): DataColumn<ProtocolRow>[] =>
  PROTOCOL_COLUMNS.map((c) => ({
    id: c,
    header: t(`simulator.col.${c}`),
    sortValue: PROTOCOL_SPEC[c].sort,
    priority: PROTOCOL_SPEC[c].priority,
    ...(c === 'time' ? { align: 'end' as const, nowrap: true } : {}),
    cell: (r: ProtocolRow) => cell(r, c, t, tz),
  }));

export function SimulatorPage() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const comments = useCommentCounts();
  const [params, setParams] = useSearchParams();
  const rigs = useEquipmentList('rigs');
  const sites = useEquipmentList('sites');
  const telescopes = useEquipmentList('telescopes');
  const cameras = useEquipmentList('cameras');
  const filters = useEquipmentList('filters');
  const moonProfiles = useEquipmentList('moon-profiles');
  const canSettings = useCan('rig.settings.write');
  const canToggle = useCan('project.status');
  const canSave = useCan('simulation.run');
  const [withDrafts, setWithDrafts] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  /** `null` = Voreinstellung: aufgeklappt, solange Rig oder Nacht fehlen (AP-26b). */
  // `einstellungen=1` (Link aus Ausrüstung → Rigs → Scheduler, AP-26i) öffnet die Einstellungen.
  const [settingsOpen, setSettingsOpen] = useState<boolean | null>(() =>
    params.get('einstellungen') === '1' ? true : null,
  );
  /** Gewähltes Ziel (Kartentitel): Rand in Zielfarbe, Blöcke in der Plangrafik hervorgehoben (AP-26g). */
  const [picked, setPicked] = useState<string | null>(null);
  /** Bereich *Mehrnacht* (AP-32a, FA-SIM-04) – Knopf neben *Simulieren* wie in der Skizze S-40. */
  const [multiOpen, setMultiOpen] = useState(false);
  const ids = { drafts: useId(), slider: useId(), settings: useId() };

  const rigList = rigs.data ?? [];
  const rigId =
    params.get('rig') ?? rigList.find((r) => r.showInPlanning)?.id ?? rigList[0]?.id ?? null;
  const rig: RigView | null = rigList.find((r) => r.id === rigId) ?? null;
  const site = (sites.data ?? []).find((s) => s.id === rig?.siteId) ?? null;
  const telescope = (telescopes.data ?? []).find((x) => x.id === rig?.telescopeId) ?? null;
  const rigOptions: RigOption[] = rigList.map((r) => ({
    id: r.id,
    name: r.name,
    siteName: (sites.data ?? []).find((s) => s.id === r.siteId)?.name ?? '',
    telescopeName: (telescopes.data ?? []).find((x) => x.id === r.telescopeId)?.name ?? '',
    cameraName: (cameras.data ?? []).find((x) => x.id === r.cameraId)?.name ?? '',
    scaleArcsecPx: r.derived.scaleArcsecPx,
    fovDeg: [r.derived.fovWidthDeg, r.derived.fovHeightDeg],
    showInPlanning: r.showInPlanning,
  }));

  // Nacht-Tabelle des Servers: „Heute Nacht“ = currentNight (NT-01), gewählte Nacht ab `from`.
  const current = useQuery({
    queryKey: ['site-nights', site?.id, 'current'],
    queryFn: () => equipmentApi.nights(site?.id ?? '', 2),
    enabled: site !== null,
  });
  const night = params.get('nacht') ?? current.data?.currentNight ?? null;
  const table = useQuery({
    queryKey: ['site-nights', site?.id, 'from', night],
    queryFn: () => equipmentApi.nights(site?.id ?? '', 2, night ?? undefined),
    enabled: site !== null && night !== null,
  });
  const go = (next: { rig?: string | null; nacht?: string | null }) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === undefined) p.delete(k);
      else p.set(k, v);
    }
    setCursor(null);
    setParams(p, { replace: true });
  };

  // Projekte des Rigs: freigegeben und aktiv; auf Wunsch eigene Entwürfe und Einreichungen (nur lokal).
  const approved = useQuery({
    queryKey: ['projects', 'simulator', rigId],
    queryFn: async () =>
      (await projectsApi.list(`?rigId=${rigId ?? ''}&approvalStatus=approved&status=active`)).items,
    enabled: rigId !== null,
  });
  const mine = useQuery({
    queryKey: ['projects', 'simulator-mine'],
    queryFn: async () => (await projectsApi.list('?mine=true')).items,
    enabled: withDrafts,
  });
  const projectIds = useMemo(() => {
    const own = withDrafts
      ? (mine.data ?? []).filter((p) => p.rigId === rigId && EDITABLE_OWN.has(p.approvalStatus))
      : [];
    return [...new Set([...(approved.data ?? []), ...own].map((p) => p.id))].sort();
  }, [approved.data, mine.data, withDrafts, rigId]);
  const details = useQueries({
    queries: projectIds.map((id) => ({
      queryKey: ['projects', id],
      queryFn: () => projectsApi.get(id),
    })),
  });
  const projects = details.map((d) => d.data).filter((p): p is ProjectView => p !== undefined);
  // Festgelegte Transits der Nacht: Exoplaneten plant der Simulator nur damit, wie `POST /plan` (06.10.2026).
  const transits = useQuery({
    queryKey: ['simulation-transits', rigId, night],
    queryFn: () => simulationApi.transits(rigId ?? '', night ?? ''),
    enabled: rigId !== null && night !== null,
  });

  // Uhrzeit im Minutentakt: Läuft die aktuelle Nacht schon, rechnet der Simulator ab jetzt wie das Plugin.
  const [nowMin, setNowMin] = useState(() => Math.floor(Date.now() / 60_000));
  useEffect(() => {
    const timer = setInterval(() => setNowMin(Math.floor(Date.now() / 60_000)), 60_000);
    return () => clearInterval(timer);
  }, []);
  const isCurrentNight = night !== null && night === current.data?.currentNight;
  const request = useMemo((): SimulationRequest | null => {
    if (!rig || !site || !night || !table.data || !moonProfiles.data || !filters.data) return null;
    if (details.some((d) => d.isPending) || approved.isPending || transits.isPending) return null;
    return {
      rig: rig as SimulationRequest['rig'],
      projects: projects as unknown as SimulationRequest['projects'],
      moonProfiles: moonProfiles.data,
      nights: table.data,
      night,
      site: {
        latitudeDeg: site.latitudeDeg,
        longitudeDeg: site.longitudeDeg,
        elevationM: site.elevationM,
        timeZone: site.timeZone,
      },
      selection: withDrafts ? 'given' : 'plannable',
      filterColors: Object.fromEntries(filters.data.map((f) => [f.shortName, f.colorHex])),
      moonProfileNames: Object.fromEntries(moonProfiles.data.map((p) => [p.id, p.name])),
      nowUtc: isCurrentNight ? new Date(nowMin * 60_000).toISOString() : null,
      transits: transits.data?.items ?? [],
    };
    // `details` wechselt je Abfrage die Identität; `projects` trägt die Daten.
  }, [
    rig,
    site,
    night,
    table.data,
    moonProfiles.data,
    filters.data,
    projects,
    withDrafts,
    isCurrentNight,
    nowMin,
    transits.data,
  ]);
  const run = useSimulator();
  const key = request ? JSON.stringify(request) : '';
  const sim = useQuery({
    queryKey: ['simulation', key],
    queryFn: ({ signal }) => run(request as SimulationRequest, signal),
    enabled: request !== null,
    staleTime: Infinity,
    retry: false,
  });
  const save = useMutation({
    mutationFn: (r: SimulationResult) =>
      simulationApi.save({
        rigId: rig?.id ?? '',
        night: night ?? '',
        plan: r.plan as never,
      }),
  });
  const toggle = useMutation({
    mutationFn: (v: { projectId: string; lineId: string; enabled: boolean }) =>
      projectsApi.patchLine(v.projectId, v.lineId, { enabled: v.enabled }),
    onSuccess: (_d, v) => client.invalidateQueries({ queryKey: ['projects', v.projectId] }),
  });

  const tz = site?.timeZone ?? 'UTC';
  const result = sim.data ?? null;
  /**
   * Zeile des Planprotokolls zur Uhrzeit des Schiebers (AP-26h): der letzte Eintrag, der bis dahin
   * begonnen hat. Das Protokoll springt dorthin und markiert sie.
   */
  const activeRow = useMemo(() => {
    if (!result || cursor === null) return null;
    let key: string | null = null;
    for (const r of result.protocol) if (Date.parse(r.atUtc) / 1000 <= cursor) key = r.key;
    return key;
  }, [result, cursor]);
  const logBox = useRef<HTMLDivElement>(null);
  // Filtermarken aller Zielkarten gleich breit (AP-26j, Wunsch Sven 26.09.2026).
  const cardsRef = useUniformWidth(`.${styles.lines} > li > :first-child`, '--sim-chip-w');
  useEffect(() => {
    const box = logBox.current;
    if (!box || activeRow === null) return;
    const row = box.querySelector<HTMLElement>(`tr[data-row="${CSS.escape(activeRow)}"]`);
    if (!row) return;
    // Nur das Protokoll rollen, nicht die Seite (der Schieber bleibt im Blick).
    const b = box.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    box.scrollTop += r.top - b.top - box.clientHeight / 2 + r.height / 2;
  }, [activeRow]);
  const highlighted = useMemo(
    () =>
      result && picked
        ? result.plan.blocks.filter((b) => b.projectId === picked).map((b) => b.id)
        : undefined,
    [result, picked],
  );
  const nowIso = new Date().toISOString();
  // Voreinstellung (AP-26b): aufgeklappt, solange Rig, Standort oder Nacht fehlen – dann gibt es kein
  // Ergebnis und die Einstellungen sind der Einstieg; sonst zugeklappt, das Ergebnis steht oben.
  // Während Standorte und Nacht-Tabelle laden, bleibt es zu – sonst springt die Seite beim Laden.
  const settled = !sites.isPending && !current.isLoading;
  const expanded = settingsOpen ?? (rig === null || (settled && (site === null || night === null)));
  const summary = rig
    ? [
        rig.name,
        site?.name,
        telescope?.name,
        `${t('rigs.scheduler.strategy')}: ${t(`rigs.strategy.${rig.scheduler.strategy}`)}`,
        `${t('rigs.scheduler.playback')}: ${t(`rigs.playback.${rig.scheduler.playback}`)}`,
        withDrafts ? t('simulator.withDraftsShort') : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : t('simulator.noRigChosen');

  if (rigs.isPending || rigList.length === 0)
    return (
      <div className={styles.page}>
        <PageHeader title={t('simulator.title')} nav={<NinaTabs />} />
        {rigs.isPending ? (
          <p role="status">{t('common.loading')}</p>
        ) : (
          <p className={styles.note}>{t('simulator.noRig')}</p>
        )}
      </div>
    );

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('simulator.title')}
        nav={<NinaTabs />}
        actions={
          <>
            {canSave && result ? (
              <button
                type="button"
                className={styles.button}
                onClick={() => save.mutate(result)}
                disabled={save.isPending}
              >
                <actionIcons.save size={ICON_SIZE.button} aria-hidden />
                {t('simulator.save')}
              </button>
            ) : null}
            {canSave ? (
              <button
                type="button"
                className={styles.button}
                aria-expanded={multiOpen}
                onClick={() => setMultiOpen(!multiOpen)}
              >
                {t('simulator.multiNight')}
              </button>
            ) : null}
            <button
              type="button"
              className={styles.buttonPrimary}
              onClick={() => void sim.refetch()}
              disabled={request === null || sim.isFetching}
            >
              <actionIcons.simulate size={ICON_SIZE.button} aria-hidden />
              {t('simulator.simulate')}
            </button>
          </>
        }
      />
      {save.isSuccess ? (
        <p className={styles.success} role="status">
          {t('simulator.saved')}
        </p>
      ) : null}
      {save.error ? <ProblemMessage code={problemCode(save.error)} /> : null}

      <section className={styles.summary} aria-label={t('simulator.settings')}>
        <div className={styles.summaryBar}>
          <button
            type="button"
            className={styles.button}
            aria-expanded={expanded}
            aria-controls={ids.settings}
            onClick={() => setSettingsOpen(!expanded)}
          >
            {expanded ? (
              <uiIcons.detailOpen size={ICON_SIZE.button} aria-hidden />
            ) : (
              <uiIcons.detailClosed size={ICON_SIZE.button} aria-hidden />
            )}
            {t('simulator.settings')}
          </button>
          <span className={styles.summaryText}>{summary}</span>
        </div>
        <div id={ids.settings} className={styles.settingsPanel} hidden={!expanded}>
          <div className={styles.rigRow}>
            <div className={styles.rigSelect}>
              <RigSelect
                rigs={rigOptions}
                value={rigId}
                onChange={(id) => go({ rig: id })}
                label={t('simulator.rig')}
              />
            </div>
            <dl className={styles.facts}>
              <dt>{t('simulator.site')}</dt>
              <dd>{site?.name ?? '–'}</dd>
              <dt>{t('simulator.telescope')}</dt>
              <dd>{telescope?.name ?? '–'}</dd>
            </dl>
            <label className={styles.check} htmlFor={ids.drafts}>
              <input
                id={ids.drafts}
                type="checkbox"
                checked={withDrafts}
                onChange={(e) => setWithDrafts(e.target.checked)}
              />
              {t('simulator.withDrafts')}
            </label>
          </div>
          {rig ? (
            <>
              {/* AP-26i: Übernahmestatus kompakt neben dem Hinweis, darunter die Einstellungen in Abschnitten. */}
              <div className={styles.settingsInfo}>
                <p className={styles.muted}>{t('simulator.howItWorks')}</p>
                <aside className={styles.nina} aria-label={t('simulator.nina')}>
                  <strong>{t('simulator.nina')}</strong>
                  <UptakeStatus rigId={rig.id} settingsVersion={rig.settingsVersion} />
                </aside>
              </div>
              <SchedulerForm rig={rig} canWrite={canSettings} />
            </>
          ) : null}
        </div>
      </section>

      <div className={styles.dateRow}>
        <button
          type="button"
          className={styles.button}
          aria-label={t('simulator.prevNight')}
          title={t('simulator.prevNight')}
          disabled={!night}
          onClick={() => night && go({ nacht: shiftNight(night, -1) })}
        >
          <uiIcons.previous size={ICON_SIZE.button} aria-hidden />
        </button>
        <strong>{night ? t('simulator.night', { night: formatNightKey(night) }) : '–'}</strong>
        <button
          type="button"
          className={styles.button}
          aria-label={t('simulator.nextNight')}
          title={t('simulator.nextNight')}
          disabled={!night}
          onClick={() => night && go({ nacht: shiftNight(night, 1) })}
        >
          <uiIcons.next size={ICON_SIZE.button} aria-hidden />
        </button>
        <button type="button" className={styles.button} onClick={() => go({ nacht: null })}>
          {t('simulator.tonight')}
        </button>
      </div>

      {multiOpen && canSave && rig && night ? (
        // Neuer Zustand je Rig, Startnacht und Entwurfswahl – sonst bliebe das Ergebnis der vorigen Auswahl stehen.
        <MultiNightPanel
          key={`${rig.id}|${night}|${withDrafts}`}
          rigId={rig.id}
          nightFrom={night}
          withDrafts={withDrafts}
          site={site ? { id: site.id, name: site.name } : null}
        />
      ) : null}

      {sim.isError ? (
        <ProblemMessage code={problemCode(sim.error)} onRetry={() => void sim.refetch()} />
      ) : sim.isFetching && !result ? (
        <p role="status">{t('simulator.running')}</p>
      ) : null}

      {result ? (
        <>
          {/* Ergebnis auf einer Seite (AP-26g, Vorlage Sven 26.09.2026): Zielkarten, Nachtplan, Planprotokoll,
              Prüfungen – untereinander statt auf Reitern. */}
          <section className={styles.block} aria-labelledby={`${ids.settings}-targets`}>
            <h2 id={`${ids.settings}-targets`} className={styles.blockTitle}>
              {t('simulator.tab.targets')}
            </h2>
            {result.cards.length === 0 && result.unallocated.length === 0 ? (
              <p className={styles.note}>{t('simulator.empty')}</p>
            ) : (
              <div className={styles.cards} ref={cardsRef}>
                {result.cards.map((c) => (
                  <TargetCardView
                    key={c.projectId}
                    card={c}
                    comments={comments(c.projectId)}
                    selected={picked === c.projectId}
                    onSelect={() => {
                      const next = picked === c.projectId ? null : c.projectId;
                      setPicked(next);
                      // Wirkung sichtbar machen: der Nachtplan liegt unter den Karten (01.10.2026).
                      if (next)
                        document
                          .getElementById(`${ids.settings}-plan`)
                          ?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
                    }}
                    tz={tz}
                    hasRotator={rig?.hasRotator ?? false}
                    canToggle={canToggle}
                    onToggle={(lineId, enabled) =>
                      toggle.mutate({ projectId: c.projectId, lineId, enabled })
                    }
                  />
                ))}
                {result.unallocated.length > 0 ? (
                  <article className={styles.card} aria-label={t('simulator.unallocated')}>
                    <h3>{t('simulator.unallocated')}</h3>
                    <ul className={styles.plain}>
                      {result.unallocated.map((u) => (
                        <li key={u.projectId}>
                          <strong>{u.name}</strong>{' '}
                          <span className={styles.muted}>
                            {u.reasons.length === 0
                              ? t('simulator.noReason')
                              : [
                                  ...new Set(
                                    u.reasons.map((r) =>
                                      t(`effort.reason.${r.reason}`, {
                                        defaultValue: r.reason,
                                      }),
                                    ),
                                  ),
                                ].join(', ')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </article>
                ) : null}
              </div>
            )}
            {toggle.error ? <ProblemMessage code={problemCode(toggle.error)} /> : null}
          </section>

          <section className={styles.block} aria-labelledby={`${ids.settings}-plan`}>
            <div className={styles.blockHead}>
              <h2 id={`${ids.settings}-plan`} className={styles.blockTitle}>
                {t('simulator.tab.plan', {
                  zone: formatTzAbbr(result.plan.nightWindow.startUtc, tz),
                })}
              </h2>
              <span className={styles.stats}>
                {t('simulator.stats.siteTime', { time: hm(nowIso, tz) })}
                {result ? (
                  <>
                    {' · '}
                    {t('simulator.stats.dark', {
                      hours: result.header.darkHours.toLocaleString(i18n.language),
                    })}
                    {' · '}
                    {t('simulator.stats.targets', { n: result.header.targets })}
                    {' · '}
                    {t('simulator.stats.frames', { n: result.header.frames })}
                    {' · '}
                    {t('simulator.stats.moon', { pct: result.header.moonIllumPct })}
                    {result.fromNowUtc ? (
                      <>
                        {' · '}
                        {t('simulator.fromNow', {
                          time: clock(Date.parse(result.fromNowUtc) / 1000, tz),
                        })}
                      </>
                    ) : null}
                  </>
                ) : null}
              </span>
            </div>
            <NightChart
              {...result.chart}
              variant="plan"
              cursorUtc={cursor}
              onCursorChange={setCursor}
              highlightBlockIds={highlighted}
              height={300}
              state="ready"
            />
            <TimeSlider
              id={ids.slider}
              result={result}
              tz={tz}
              value={cursor}
              onChange={setCursor}
            />
          </section>

          <section className={styles.block} aria-labelledby={`${ids.settings}-log`}>
            <div className={styles.blockHead}>
              <h2 id={`${ids.settings}-log`} className={styles.blockTitle}>
                {t('simulator.protocol')}
              </h2>
              <div className={styles.blockTools}>
                {copied ? (
                  <span className={styles.muted} role="status">
                    {t('simulator.copied')}
                  </span>
                ) : null}
                <button
                  type="button"
                  className={styles.button}
                  onClick={() =>
                    void navigator.clipboard
                      ?.writeText(protocolTsv(result.protocol, t, tz))
                      .then(() => setCopied(true))
                  }
                >
                  <actionIcons.duplicate size={ICON_SIZE.button} aria-hidden />
                  {t('simulator.copy')}
                </button>
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => downloadCsv(protocolCsv(result.protocol, t, tz), night ?? 'plan')}
                >
                  <actionIcons.export size={ICON_SIZE.button} aria-hidden />
                  {t('simulator.csv')}
                </button>
              </div>
            </div>
            <div className={styles.logBox} ref={logBox}>
              <DataTable
                className={styles.log}
                columns={protocolColumns(t, tz)}
                rows={result.protocol}
                rowKey={(r) => r.key}
                rowProps={(r) => ({
                  'data-row': r.key,
                  ...(r.key === activeRow
                    ? { 'data-selected': 'true', 'aria-current': 'true' as const }
                    : {}),
                })}
                rowLabel={(r) => `${siteClock(r.atUtc, tz)} ${r.projectName}`}
                label={t('simulator.protocol')}
              />
            </div>
          </section>

          <section className={styles.block} aria-labelledby={`${ids.settings}-findings`}>
            <h2 id={`${ids.settings}-findings`} className={styles.blockTitle}>
              {t('simulator.tab.findings')}
              {result.plan.warnings.length > 0 ? (
                <>
                  {' '}
                  <span
                    className={
                      result.plan.warnings.some((w) => w.level === 'error')
                        ? styles.badgeError
                        : styles.badge
                    }
                  >
                    {result.plan.warnings.length}
                  </span>
                </>
              ) : null}
            </h2>
            <Findings result={result} tz={tz} />
            <p className={styles.hash}>{t('simulator.hash', { hash: result.plan.outputHash })}</p>
          </section>
        </>
      ) : null}
    </div>
  );
}

function downloadCsv(text: string, night: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `planprotokoll-${night}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const checkOk = (c: Check): boolean | null => (c === 'none' ? null : c === 'ok');

function TargetCardView({
  card,
  tz,
  hasRotator,
  canToggle,
  onToggle,
  selected,
  onSelect,
  comments,
}: {
  card: TargetCard;
  /** Anzahl Kommentare des Projekts (FA-PRJ-17). */
  comments: number;
  selected: boolean;
  onSelect: () => void;
  tz: string;
  hasRotator: boolean;
  canToggle: boolean;
  onToggle: (lineId: string, enabled: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const hours = (card.allocatedS / 3600).toLocaleString(i18n.language, {
    maximumFractionDigits: 1,
  });
  const items: CheckItem[] = [
    {
      id: 'altitude',
      label: t('simulator.card.check.altitude'),
      ok: checkOk(card.checks.altitude),
    },
    { id: 'time', label: t('simulator.card.check.time'), ok: checkOk(card.checks.time) },
    { id: 'moon', label: t('simulator.card.check.moon'), ok: checkOk(card.checks.moon) },
    {
      id: 'darkness',
      label: t('simulator.card.check.darkness'),
      ok: checkOk(card.checks.darkness),
    },
    {
      id: 'rotation',
      label: t('simulator.card.check.rotation'),
      ok: card.checks.rotation === 'ok',
      detail:
        card.checks.rotation === 'warn'
          ? t('simulator.card.rotationWarn')
          : hasRotator
            ? t('simulator.card.rotationRotator')
            : t('simulator.card.rotationFixed'),
    },
  ];
  return (
    <article
      className={styles.card}
      aria-label={card.name}
      data-selected={selected ? 'true' : undefined}
      style={{ '--card-color': card.color } as CSSProperties}
    >
      <h3 className={styles.cardTitle}>
        <button
          type="button"
          className={styles.cardPick}
          aria-pressed={selected}
          title={t('simulator.card.pick')}
          onClick={onSelect}
        >
          <span className={styles.swatch} style={{ background: card.color }} aria-hidden />
          {card.name}
        </button>
        <Link
          className={styles.cardOpen}
          to={`/projekte/${card.projectId}`}
          aria-label={t('simulator.card.open', { name: card.name })}
          title={t('simulator.card.open', { name: card.name })}
        >
          <actionIcons.external size={ICON_SIZE.table} aria-hidden />
        </Link>
        <CommentCount count={comments} />
        {card.transit ? <span className={styles.tag}>{t('simulator.card.transit')}</span> : null}
      </h3>
      <dl className={styles.facts}>
        <dt>{t('simulator.card.creator')}</dt>
        <dd>
          <Person id={card.createdBy} />
        </dd>
        <dt>{t('simulator.card.window')}</dt>
        <dd>
          {card.fromUtc && card.toUtc ? `${hm(card.fromUtc, tz)} – ${hm(card.toUtc, tz)}` : '–'}
        </dd>
        <dt>{t('simulator.card.hours')}</dt>
        <dd>{hours} h</dd>
        <dt>{t('simulator.card.altitude')}</dt>
        <dd>
          {card.altMinDeg === null || card.altMaxDeg === null
            ? '–'
            : `${card.altMinDeg.toFixed(0)}° – ${card.altMaxDeg.toFixed(0)}°`}
        </dd>
        <dt>{t('simulator.card.moonSep')}</dt>
        <dd>{card.moonSepMinDeg === null ? '–' : `≥ ${card.moonSepMinDeg.toFixed(0)}°`}</dd>
      </dl>
      {card.flips.map((f) => (
        <p key={f.atUtc} className={styles.flag}>
          {f.inTransitWindow
            ? t('simulator.card.flipInWindow', { time: hm(f.atUtc, tz) })
            : t('simulator.card.flip', {
                time: hm(f.atUtc, tz),
                min: Math.round(f.durationS / 60),
              })}
        </p>
      ))}
      {card.transit ? <p className={styles.note}>{t('simulator.card.transitBox')}</p> : null}
      <h4 className={styles.subhead}>{t('simulator.card.lines')}</h4>
      <ul className={styles.lines}>
        {card.lines.map((l) => (
          <li key={l.lineId}>
            <FilterChip shortName={l.filter} color={l.color} size="sm" />
            <span className={styles.muted}>
              {t('simulator.card.remaining', { need: l.need, tonight: l.tonight })}
            </span>
            {l.moon ? (
              <span
                className={styles.tag}
                title={
                  l.moon.mustBeDown
                    ? t('simulator.card.moonTitleDown', { name: moonProfileLabel(t, l.moon.name) })
                    : t('simulator.card.moonTitle', {
                        name: moonProfileLabel(t, l.moon.name),
                        sep: l.moon.separationDeg.toLocaleString(i18n.language),
                        width: l.moon.widthDays.toLocaleString(i18n.language),
                      })
                }
              >
                {t('simulator.card.moon', { name: moonProfileLabel(t, l.moon.name) })}
              </span>
            ) : null}
            {canToggle ? (
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={l.enabled}
                  onChange={(e) => onToggle(l.lineId, e.target.checked)}
                />
                <span className="visually-hidden">
                  {t('simulator.card.enabled', { filter: l.filter })}
                </span>
              </label>
            ) : null}
          </li>
        ))}
      </ul>
      <CheckList items={items} />
    </article>
  );
}

/** FA-SIM-02: „Was macht das Rig um 02:14 CDT?“ – Schieber über das Nachtfenster in 5-min-Schritten. */
function TimeSlider({
  id,
  result,
  tz,
  value,
  onChange,
}: {
  id: string;
  result: SimulationResult;
  tz: string;
  value: number | null;
  onChange: (v: number) => void;
}) {
  const { t } = useTranslation();
  const start = Date.parse(result.plan.nightWindow.startUtc) / 1000;
  const end = Date.parse(result.plan.nightWindow.endUtc) / 1000;
  const at = value ?? start;
  const atIso = iso(at);
  const block = result.plan.blocks.find(
    (b) => Date.parse(b.startUtc) / 1000 <= at && at < Date.parse(b.endUtc) / 1000,
  );
  const entry = block
    ? [...block.entries].reverse().find((e) => Date.parse(e.atUtc) / 1000 <= at)
    : undefined;
  const row = entry
    ? result.protocol.find((r) => r.key === `${block?.id ?? ''}:${String(entry.seq)}`)
    : undefined;
  const doing = row
    ? `${row.projectName} · ${cell(row, 'cmd', t, tz)}${row.filter ? ` ${row.filter}` : ''}`
    : t('simulator.sliderIdle');
  return (
    <div className={styles.slider}>
      <label htmlFor={id}>{t('simulator.slider', { time: hm(atIso, tz) })}</label>
      <input
        id={id}
        type="range"
        min={start}
        max={end}
        step={300}
        value={at}
        aria-valuetext={`${hm(atIso, tz)}: ${doing}`}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output htmlFor={id}>{doing}</output>
    </div>
  );
}

function Findings({ result, tz }: { result: SimulationResult; tz: string }) {
  const { t } = useTranslation();
  const names = new Map(result.cards.map((c) => [c.projectId, c.name]));
  for (const u of result.unallocated) names.set(u.projectId, u.name);
  return (
    <div className={styles.findings}>
      <section aria-labelledby="sim-warnings">
        <h3 id="sim-warnings">{t('simulator.warnings')}</h3>
        {result.plan.warnings.length === 0 ? (
          <p className={styles.muted}>{t('simulator.noWarnings')}</p>
        ) : (
          <ul className={styles.plain}>
            {result.plan.warnings.map((w, i) => (
              <li
                key={`${w.code}:${String(i)}`}
                className={w.level === 'error' ? styles.error : styles.warn}
              >
                <strong>
                  {t(`simulator.level.${w.level}`)} · {w.code}
                </strong>
                {': '}
                {t(`simulator.warning.${w.code}`, { defaultValue: w.code })}
                {w.atUtc ? ` · ${siteClock(w.atUtc, tz)}` : ''}
                {w.durationS ? ` · ${String(Math.round(w.durationS / 60))} min` : ''}
                {w.message ? ` – ${w.message}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="sim-diagnostics">
        <h3 id="sim-diagnostics">{t('simulator.diagnostics')}</h3>
        {result.plan.diagnostics.length === 0 ? (
          <p className={styles.muted}>{t('simulator.noDiagnostics')}</p>
        ) : (
          <ul className={styles.plain}>
            {result.plan.diagnostics.map((d, i) => (
              <li key={`${d.projectId}:${d.lineId ?? ''}:${d.reason}:${String(i)}`}>
                <strong>{names.get(d.projectId) ?? d.projectId}</strong>
                {d.lineId ? ` (${result.lineNames[d.lineId] ?? d.lineId})` : ''}
                {': '}
                {t(`effort.reason.${d.reason}`, { defaultValue: d.reason })}
                {d.message ? ` – ${d.message}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
