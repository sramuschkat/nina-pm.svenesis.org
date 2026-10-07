/**
 * Nachtplan eines Rigs für eine Nacht im Browser (Heute Nacht, Zeitleiste; 28.09.2026): dieselben Daten wie
 * der Simulator – Rig, freigegebene und aktive Projekte, Mondprofile, Filterfarben, Nacht-Tabelle des Servers
 * (NT-02) – über `buildPlanInput` → `planNight` im Web Worker (`useSimulator`). Ergebnis identisch mit dem
 * Simulator bei `selection: 'plannable'` (FA-SIM-05), einschließlich der festgelegten Transits der Nacht
 * (`GET /simulations/transits`, 06.10.2026 – vorher fehlte der Transit in Plan- und Filterzeile). Nur Anzeige, nichts
 * wird gespeichert.
 */
import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { equipmentApi, projectsApi, simulationApi, type ProjectView } from '../../api/client';
import { useEquipmentList } from '../equipment/shared';
import type { SimulationRequest, SimulationResult } from './simulate';
import { useSimulator } from './use-simulator';

export interface NightPlanState {
  readonly result: SimulationResult | null;
  /** Freigegebene, aktive Projekte des Rigs, mit denen gerechnet wurde (Tabelle „Plan für diese Nacht“). */
  readonly projects: readonly ProjectView[];
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly refetch: () => void;
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
  const request = useMemo((): SimulationRequest | null => {
    if (!rig || !site || !night || !table.data || !moonProfiles.data || !filters.data) return null;
    if (approved.isPending || transits.isPending || details.some((d) => d.isPending)) return null;
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
  const failed =
    table.isError ||
    approved.isError ||
    transits.isError ||
    details.some((d) => d.isError) ||
    sim.isError;
  return {
    result: sim.data ?? null,
    projects,
    isPending: !failed && (request === null || sim.isPending),
    isError: failed,
    refetch: () => {
      void approved.refetch();
      void transits.refetch();
      void sim.refetch();
    },
  };
}
