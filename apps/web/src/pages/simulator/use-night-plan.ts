/**
 * Nachtplan eines Rigs für eine Nacht im Browser (Heute Nacht, Zeitleiste; 28.09.2026): dieselben Daten wie
 * der Simulator – Rig, freigegebene und aktive Projekte, Mondprofile, Filterfarben, Nacht-Tabelle des Servers
 * (NT-02) – über `buildPlanInput` → `planNight` im Web Worker (`useSimulator`). Ergebnis identisch mit dem
 * Simulator bei `selection: 'plannable'` (FA-SIM-05), einschließlich der festgelegten Transits der Nacht
 * (`GET /simulations/transits`, 06.10.2026 – vorher fehlte der Transit in Plan- und Filterzeile). Nur Anzeige, nichts
 * wird gespeichert.
 * AP-53c: Eingabe vom Server (`GET /simulations/input`, dieselbe wie `POST /plan`); läuft die Nacht bzw. ist sie mit
 * Session vorbei, liefert der Hook zusätzlich Ist + Plan (`actual`, Erledigtes blass, Rest aus der gespeicherten
 * Revision kräftig) und den Planstand (`stored`, „Rig plant noch mit Rev. n“).
 * Analyse 07.10.2026:
 * - Die laufende Nacht rechnet ab jetzt (`nowUtc`) wie Simulator und Plugin – vorher ab Dämmerung, mit Frames für
 *   längst vergangene Fenster.
 * - Eine Quelle: Mit gespeichertem Plan kommen Tabelle, Kennzahl und Flips aus dessen offenem Rest plus Ist
 *   (`rigNight`); die Rechnung im Worker nur ohne gespeicherten Plan.
 * - Ist und gespeicherter Plan hängen nicht an der Rechnung im Worker: Rechnet sie noch oder scheitert sie, stehen
 *   beide trotzdem da (`computeError` nur für die Rechnung).
 * - `deliveryOff`: Rig-Schalter *An NINA ausliefern* aus – die Rechnung zeigt dann, was das Rig eingeschaltet täte.
 */
import { useQueries, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { CHART_SERIES_COUNT } from '@nina-pm/ui-tokens';
import { equipmentApi, projectsApi, simulationApi, type ProjectView } from '../../api/client';
import { useEquipmentList } from '../equipment/shared';
import { actualView, type ActualView } from './actual-view';
import { rigNight, type RigNight } from './rig-night';
import {
  doneTonight,
  stillRunning,
  type DoneCard,
  type SimulationRequest,
  type SimulationResult,
  type SimulationSource,
} from './simulate';
import { useSimulator } from './use-simulator';

export interface NightPlanState {
  readonly result: SimulationResult | null;
  /** Freigegebene, aktive Projekte des Rigs, mit denen gerechnet wurde (Tabelle „Plan für diese Nacht“). */
  readonly projects: readonly ProjectView[];
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly refetch: () => void;
  /** Ist + Plan der laufenden bzw. vergangenen Nacht mit Session (AP-53c), sonst `null`. */
  readonly actual?: ActualView | null;
  /**
   * Projekte mit Zustand aus gespeichertem Plan + Ist (läuft, geplant, abgearbeitet); ohne gespeicherten Plan die
   * heute Nacht abgearbeiteten bzw. laufenden, die die Rechnung ab jetzt nicht mehr zuteilt (07.10.2026).
   */
  readonly done?: readonly DoneCard[];
  /** Letzte gespeicherte Revision der Nacht mit Hinweis `stale` (AP-53c). */
  readonly stored?: SimulationSource['stored'];
  /** Laufende Nacht mit gespeichertem Plan: offener Rest + Ist (eine Quelle, 07.10.2026), sonst `null`. */
  readonly rigNight?: RigNight | null;
  /** Die Rechnung im Worker ist gescheitert (Ist und gespeicherter Plan bleiben sichtbar). */
  readonly computeError?: boolean;
  /** Rig-Schalter *An NINA ausliefern* ist aus: NINA bekommt keine Ziele. */
  readonly deliveryOff?: boolean;
}

export interface NightPlanOptions {
  /** Die Nacht ist die laufende des Standorts (vom Server, auch nach Fensterende bei noch laufender Session). */
  readonly current?: boolean;
  /** Nachtfenster der Nacht (`TonightRig.nightWindow`); ohne Angabe aus der Rechnung. */
  readonly window?: { readonly startUtc: string; readonly endUtc: string } | null;
}

const seriesColor = (i: number) =>
  `var(--npm-chart-series-${String((i % CHART_SERIES_COUNT) + 1)})`;

export function useNightPlan(
  rigId: string | null,
  night: string | null,
  options: NightPlanOptions = {},
): NightPlanState {
  const rigs = useEquipmentList('rigs');
  const sites = useEquipmentList('sites');
  const filters = useEquipmentList('filters');
  const moonProfiles = useEquipmentList('moon-profiles');
  const rig = (rigs.data ?? []).find((r) => r.id === rigId) ?? null;
  const site = (sites.data ?? []).find((s) => s.id === rig?.siteId) ?? null;
  const table = useQuery({
    queryKey: ['site-nights', site?.id, 'from', night],
    queryFn: () => equipmentApi.nights(site?.id ?? '', 2, night ?? undefined),
    enabled: site !== null && night !== null,
  });
  const approved = useQuery({
    queryKey: ['projects', 'simulator', rigId],
    queryFn: async () =>
      (await projectsApi.list(`?rigId=${rigId ?? ''}&approvalStatus=approved&status=active`)).items,
    enabled: rigId !== null,
  });
  const ids = useMemo(
    () => [...new Set((approved.data ?? []).map((p) => p.id))].sort(),
    [approved.data],
  );
  const details = useQueries({
    queries: ids.map((id) => ({ queryKey: ['projects', id], queryFn: () => projectsApi.get(id) })),
  });
  const projects = details.map((d) => d.data).filter((p): p is ProjectView => p !== undefined);
  const transits = useQuery({
    queryKey: ['simulation-transits', rigId, night],
    queryFn: () => simulationApi.transits(rigId ?? '', night ?? ''),
    enabled: rigId !== null && night !== null,
  });
  // Eine Eingabe-Quelle (AP-53c): Eingabe, Ist und gespeicherter Plan vom Server, alle 2 min neu.
  const serverInput = useQuery({
    queryKey: ['simulation-input', rigId, night],
    queryFn: () => simulationApi.input(rigId ?? '', night ?? ''),
    enabled: rigId !== null && night !== null,
    refetchInterval: 120_000,
    retry: false,
  });
  const [nowMin, setNowMin] = useState(() => Math.floor(Date.now() / 60_000));
  useEffect(() => {
    const timer = setInterval(() => setNowMin(Math.floor(Date.now() / 60_000)), 60_000);
    return () => clearInterval(timer);
  }, []);
  // Laufende Nacht: vom Aufrufer (Server, `TonightRig.currentNight`), sonst aus der Nacht-Tabelle.
  const current =
    options.current ??
    (night !== null && table.data !== undefined && table.data.currentNight === night);
  const request = useMemo((): SimulationRequest | null => {
    if (!rig || !site || !night || !table.data || !moonProfiles.data || !filters.data) return null;
    if (approved.isPending || transits.isPending || details.some((d) => d.isPending)) return null;
    if (serverInput.isPending && rigId !== null) return null;
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
      selection: 'plannable',
      filterColors: Object.fromEntries(filters.data.map((f) => [f.shortName, f.colorHex])),
      moonProfileNames: Object.fromEntries(moonProfiles.data.map((p) => [p.id, p.name])),
      // Laufende Nacht ab jetzt wie Simulator und Plugin (07.10.2026; vorher ganze Nacht ab Dämmerung).
      nowUtc: current ? new Date(nowMin * 60_000).toISOString() : null,
      transits: transits.data?.items ?? [],
      // Ohne Ist (`executed`/`storedPlan`): die rechnet der Hook unten minütlich, ohne neue Simulation.
      server: serverInput.data
        ? {
            input: serverInput.data.input,
            inputHash: serverInput.data.inputHash,
            projectNames: serverInput.data.projectNames,
            executed: null,
            storedPlan: null,
            firstPlan: null,
          }
        : null,
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
    approved.isPending,
    transits.isPending,
    transits.data,
    serverInput.data,
    current,
    nowMin,
  ]);
  const run = useSimulator();
  const key = request ? JSON.stringify(request) : '';
  const sim = useQuery({
    queryKey: ['simulation', key],
    queryFn: ({ signal }) => run(request as SimulationRequest, signal),
    enabled: request !== null,
    staleTime: Infinity,
    retry: false,
    // Zwischen zwei Minuten-Rechnungen das letzte Ergebnis stehen lassen.
    placeholderData: (prev) => prev,
  });
  const result = sim.data ?? null;
  const filterColors = useMemo(
    () => Object.fromEntries((filters.data ?? []).map((f) => [f.shortName, f.colorHex])),
    [filters.data],
  );
  // Nachtfenster: vom Aufrufer, sonst aus der Rechnung.
  const window = options.window ?? result?.plan.nightWindow ?? null;
  const nowMs = nowMin * 60_000;
  const started = window !== null && nowMs > Date.parse(window.startUtc);
  const over = window !== null && nowMs >= Date.parse(window.endUtc);
  // Läuft: laufende Nacht nach Fensterbeginn – auch nach Fensterende, solange der Server sie als laufend meldet
  // (Session läuft noch: Flats, Rest eines Transits).
  const running = current && started;
  const data = serverInput.data;
  // Farben wie der Simulator: Stelle in der Server-Eingabe, danach weitere Projekte des Ist.
  const colorOfProject = useMemo(() => {
    const colors = new Map(
      ((data?.input.projects ?? []) as { id: string }[]).map((p, i) => [p.id, seriesColor(i)]),
    );
    return (id: string) => {
      const known = colors.get(id);
      if (known) return known;
      const next = seriesColor(colors.size);
      colors.set(id, next);
      return next;
    };
  }, [data]);
  const live = useMemo(
    () =>
      data && running
        ? rigNight({
            executed: data.executed as never,
            stored: data.storedPlan as never,
            endedBlockIds: data.endedBlockIds,
            nowMs,
          })
        : null,
    [data, running, nowMs],
  );
  const actual = useMemo((): ActualView | null => {
    if (!data || !(running || (over && !current))) return null;
    return actualView({
      executed: data.executed as never,
      stored: data.storedPlan as never,
      endedBlockIds: data.endedBlockIds,
      first: data.firstPlan as never,
      nowMs,
      running,
      // Ohne gespeicherten Plan das Kommende aus der Rechnung – fehlt sie (rechnet noch, gescheitert), nur das Ist.
      computed: {
        blocks: result?.chart.blocks ?? [],
        filterBars: result?.chart.filterBars ?? [],
        protocol: result?.protocol ?? [],
      },
      colorOfProject,
      filterColor: (f) => filterColors[f] ?? 'var(--npm-chart-marker)',
      names: new Map(Object.entries(data.projectNames)),
      gapLabel: () => '',
    });
  }, [data, result, nowMs, running, over, current, filterColors, colorOfProject]);
  const done = useMemo((): DoneCard[] => {
    if (!data) return [];
    const names = new Map(Object.entries(data.projectNames));
    const creators = new Map(projects.map((p) => [p.id, p.createdBy]));
    if (live)
      return [...live.projects.values()].map((p) => ({
        projectId: p.projectId,
        name: names.get(p.projectId) || p.title || p.projectId,
        createdBy: creators.get(p.projectId) ?? null,
        color: colorOfProject(p.projectId),
        transit: p.transit,
        state: p.state,
        exposures: p.exposures,
        fromUtc: p.fromUtc,
        toUtc: p.toUtc,
      }));
    if (!actual || !data.executed || !result) return [];
    return doneTonight(
      data.executed.blocks,
      new Set(result.cards.map((c) => c.projectId)),
      stillRunning(data.executed, data.storedPlan, nowMs),
      names,
      creators,
      colorOfProject,
    );
  }, [actual, live, data, result, projects, nowMs, colorOfProject]);
  const stored = data?.storedPlan
    ? {
        nightPlanId: data.storedPlan.nightPlanId,
        revision: data.storedPlan.revision,
        reason: data.storedPlan.reason,
        createdAtUtc: data.storedPlan.createdAtUtc,
        stale: data.storedPlan.stale,
        staleCause: data.storedPlan.staleCause,
      }
    : null;
  const failed =
    table.isError ||
    approved.isError ||
    transits.isError ||
    details.some((d) => d.isError) ||
    sim.isError;
  return {
    result,
    actual,
    done,
    stored,
    rigNight: live,
    computeError: sim.isError,
    deliveryOff: rig !== null && rig.ninaDeliveryEnabled === false,
    projects,
    isPending: !failed && (request === null || sim.isPending),
    isError: failed,
    refetch: () => {
      void approved.refetch();
      void transits.refetch();
      void serverInput.refetch();
      void sim.refetch();
    },
  };
}
