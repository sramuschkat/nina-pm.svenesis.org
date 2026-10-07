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
 */
import { useQueries, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { equipmentApi, projectsApi, simulationApi, type ProjectView } from '../../api/client';
import { useEquipmentList } from '../equipment/shared';
import { actualView, type ActualView } from './actual-view';
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
  /** Heute Nacht abgearbeitet, im Rest-Plan nicht mehr zugeteilt (07.10.2026); ohne Ist leer. */
  readonly done?: readonly DoneCard[];
  /** Letzte gespeicherte Revision der Nacht mit Hinweis `stale` (AP-53c). */
  readonly stored?: SimulationSource['stored'];
}

export function useNightPlan(rigId: string | null, night: string | null): NightPlanState {
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
  const result = sim.data ?? null;
  const filterColors = useMemo(
    () => Object.fromEntries((filters.data ?? []).map((f) => [f.shortName, f.colorHex])),
    [filters.data],
  );
  const actual = useMemo((): ActualView | null => {
    const data = serverInput.data;
    if (!data || !result) return null;
    const nowMs = nowMin * 60_000;
    const start = Date.parse(result.plan.nightWindow.startUtc);
    const end = Date.parse(result.plan.nightWindow.endUtc);
    const running = nowMs > start && nowMs < end;
    if (!running && nowMs < end) return null;
    const colors = new Map(result.cards.map((c) => [c.projectId, c.color]));
    let extra = colors.size;
    return actualView({
      executed: data.executed as never,
      stored: data.storedPlan as never,
      first: data.firstPlan as never,
      nowMs,
      running,
      computed: {
        blocks: result.chart.blocks ?? [],
        filterBars: result.chart.filterBars ?? [],
        protocol: result.protocol,
      },
      colorOfProject: (id) => {
        const known = colors.get(id);
        if (known) return known;
        const next = `var(--npm-chart-series-${String((extra++ % 6) + 1)})`;
        colors.set(id, next);
        return next;
      },
      filterColor: (f) => filterColors[f] ?? 'var(--npm-chart-marker)',
      names: new Map(Object.entries(data.projectNames)),
      gapLabel: () => '',
    });
  }, [serverInput.data, result, nowMin, filterColors]);
  const done = useMemo(() => {
    const data = serverInput.data;
    if (!actual || !data?.executed || !result) return [];
    const colors = new Map(result.cards.map((c) => [c.projectId, c.color]));
    return doneTonight(
      data.executed.blocks,
      new Set(result.cards.map((c) => c.projectId)),
      stillRunning(data.executed, data.storedPlan, nowMin * 60_000),
      new Map(Object.entries(data.projectNames)),
      new Map(projects.map((p) => [p.id, p.createdBy])),
      (id) => colors.get(id) ?? 'var(--npm-chart-marker)',
    );
  }, [actual, serverInput.data, result, projects, nowMin]);
  const stored = serverInput.data?.storedPlan
    ? {
        nightPlanId: serverInput.data.storedPlan.nightPlanId,
        revision: serverInput.data.storedPlan.revision,
        reason: serverInput.data.storedPlan.reason,
        createdAtUtc: serverInput.data.storedPlan.createdAtUtc,
        stale: serverInput.data.storedPlan.stale,
        staleCause: serverInput.data.storedPlan.staleCause,
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
