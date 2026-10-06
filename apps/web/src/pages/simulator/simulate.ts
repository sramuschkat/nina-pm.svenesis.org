/**
 * Nacht-Simulator S-40 (AP-13f, FA-SIM-01…08): reine Rechnung für den Web Worker. Eingabe über
 * `buildPlanInput` (A5-2, keine eigene Abbildung), Plan über `planNight` (dieselbe Engine wie der
 * Planaufbau, FA-SIM-05); daraus Diagramm, Zielkarten, nicht zugeteilte Projekte und Planprotokoll –
 * Protokoll, Karten, Blöcke und Filterleiste über `simulationView` aus `@nina-pm/shared` (wie der Plugin-Simulator,
 * AP-53); hier kommen Farben und Höhenkurven dazu.
 * Keine Uhr: „jetzt“ ergänzt die Seite.
 */
import { planNight, unixFromIso, type NightPlan, type PlanInput } from '@nina-pm/engine';
import {
  buildPlanInput,
  isDeliverable,
  simulationView,
  type SimCard,
  type SimCheck,
  type SimProtocolRow,
  type SimUnallocated,
} from '@nina-pm/shared';
import { CHART_SERIES_COUNT } from '@nina-pm/ui-tokens';
import type { NightChartProps } from '../../components/night-chart';
import { nightChartFromEngine } from '../../lib/night-chart-data';

type BuildArgs = Parameters<typeof buildPlanInput>;

export interface SimulationRequest {
  readonly rig: BuildArgs[0];
  readonly projects: BuildArgs[1];
  readonly moonProfiles: BuildArgs[2];
  readonly nights: BuildArgs[3];
  readonly night: string;
  readonly site: {
    readonly latitudeDeg: number;
    readonly longitudeDeg: number;
    readonly elevationM: number;
    readonly timeZone: string;
  };
  /** `given`: auch eigene Entwürfe und Einreichungen (nur lokal, FK 6.14); sonst freigegeben und aktiv. */
  readonly selection: 'plannable' | 'given';
  /** Filterfarben je Kurzname (Filterbalken, Farbchips). */
  readonly filterColors: Readonly<Record<string, string>>;
  /** Namen der Mondprofile (Protokoll, Zielkarten); mitgelieferte als `moonProfile.<key>`. */
  readonly moonProfileNames: Readonly<Record<string, string>>;
  /**
   * Aktuelle Uhrzeit (ISO, UTC). Läuft die gewählte Nacht schon, plant der Simulator ab jetzt – wie das Plugin
   * (`POST /plan` mitten in der Nacht) – und zeigt eine Uhrzeit-Marke (06.10.2026). Ohne Angabe: ganze Nacht.
   */
  readonly nowUtc?: string | null;
}

export type Check = SimCheck;

export interface TargetCard extends Omit<SimCard, 'projectIndex' | 'lines'> {
  /** Ersteller (`app_user.id`) – Bild und Name auf der Zielkarte (30.09.2026). */
  readonly createdBy: string | null;
  readonly color: string;
  readonly lines: readonly (SimCard['lines'][number] & { readonly color: string })[];
}

export type UnallocatedProject = SimUnallocated;

export type ProtocolRow = SimProtocolRow;

export interface SimulationResult {
  readonly plan: NightPlan;
  readonly chart: Omit<NightChartProps, 'state'>;
  readonly cards: readonly TargetCard[];
  readonly unallocated: readonly UnallocatedProject[];
  readonly protocol: readonly ProtocolRow[];
  /** Filter-Kurzname je Zeile (Diagnose je Zeile). */
  readonly lineNames: Readonly<Record<string, string>>;
  readonly header: {
    readonly darkHours: number;
    readonly targets: number;
    readonly frames: number;
    readonly moonIllumPct: number;
  };
  /** Läuft die Nacht schon: Planbeginn „jetzt“ (UTC), sonst `null` (ganze Nacht). */
  readonly fromNowUtc: string | null;
}

const colorOf = (i: number) => `var(--npm-chart-series-${String((i % CHART_SERIES_COUNT) + 1)})`;

/**
 * Auslieferungsregel wie `POST /plan` (FA-SIM-05, TK 6.3 `isDeliverable`): Startdatum erreicht und Arbeit vorhanden
 * (Planungsbedarf > 0 oder Bonus). Der Schalter *An NINA ausliefern* zählt nicht – der Simulator zeigt, was das Rig
 * eingeschaltet täte. Exoplaneten fehlen ohnehin (keine Transits in der Web-Simulation).
 */
function deliverable(req: SimulationRequest, p: SimulationRequest['projects'][number]): boolean {
  const s = req.rig.scheduler;
  return isDeliverable(
    {
      approvalStatus: p.approvalStatus,
      status: p.status,
      deletedAt: p.deletedAt,
      ninaDeliveryEnabled: true,
      bonusEnabled: s.bonusEnabled,
      startDate: p.startDate,
      projectType: p.projectType,
      lines: p.panels.flatMap((panel) =>
        panel.lines.map((l) => ({
          enabled: l.enabled && panel.enabled,
          disabledForNight: l.disabledForNight,
          plannedCount: l.plannedCount,
          acquiredCount: l.counters.acquired,
          rejectedCount: l.counters.rejected,
          bonusCount: l.counters.bonus,
          bonusRejectedCount: l.counters.bonusRejected,
        })),
      ),
      overshootPct: s.overshootPct,
    },
    req.night,
  );
}

export function simulate(req: SimulationRequest): SimulationResult {
  // Entwürfe ohne Panel kann die Engine nicht planen (engine.input_invalid) – sie fehlen im Plan.
  const candidates = req.projects.filter(
    (p) => p.panels.length > 0 && (req.selection === 'given' || deliverable(req, p)),
  );
  const input = buildPlanInput(req.rig, candidates, req.moonProfiles, req.nights, {
    night: req.night,
    site: {
      latitudeDeg: req.site.latitudeDeg,
      longitudeDeg: req.site.longitudeDeg,
      elevationM: req.site.elevationM,
    },
    selection: req.selection,
    // AF-Intervall des Rigs wie der Server, solange er die Trigger der Sequenz nicht kennt (FA-SIM-05).
    autofocusAfterTimeMin: req.rig.scheduler.overhead.afEveryMin,
  }) as PlanInput;
  const whole = planNight(input);
  const nowMs = req.nowUtc ? Date.parse(req.nowUtc) : Number.NaN;
  const running =
    Number.isFinite(nowMs) &&
    nowMs > Date.parse(whole.nightWindow.startUtc) &&
    nowMs < Date.parse(whole.nightWindow.endUtc);
  const fromNowUtc = running ? new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, 'Z') : null;
  const planInput: PlanInput = fromNowUtc ? { ...input, startAtUtc: fromNowUtc } : input;
  const plan = fromNowUtc ? planNight(planInput) : whole;
  const site = { latDeg: req.site.latitudeDeg, lonDeg: req.site.longitudeDeg };
  const projects = input.projects;
  const names = new Map(req.projects.map((p) => [p.id, p.name]));
  const creators = new Map(req.projects.map((p) => [p.id, p.createdBy]));
  const color = new Map(projects.map((p, i) => [p.id, colorOf(i)]));
  // Protokoll, Zielkarten, Blöcke und Filterleiste: dieselbe Rechnung wie der Plugin-Simulator (AP-53).
  const view = simulationView(planInput, plan, {
    site: req.site,
    names,
    moonProfileNames: req.moonProfileNames,
  });
  const filterColor = (filter: string) => req.filterColors[filter] ?? 'var(--npm-chart-marker)';

  // Diagramm: Höhenkurven je Ziel, Blöcke, Filterbalken, Flip-Marken.
  const { props: base } = nightChartFromEngine({
    site,
    night: req.night,
    timeZoneTransitions: input.timeZoneTransitions.map((t) => ({
      atUtc: unixFromIso(t.atUtc),
      utcOffsetMinutes: t.utcOffsetMinutes,
    })),
    timeZone: req.site.timeZone,
    targets: projects.map((p) => ({
      id: p.id,
      label: names.get(p.id) ?? p.id,
      color: color.get(p.id) ?? colorOf(0),
      target: { raJ2000Deg: p.raDeg, decJ2000Deg: p.decDeg },
    })),
    minAltDeg: projects.length > 0 ? Math.min(...projects.map((p) => p.minAltitudeDeg)) : 30,
    twilight: 'astronomical',
    transitLabel: '',
  });
  const blocks = view.blocks.map((b) => ({
    id: b.id,
    fromUtc: b.fromUtc,
    toUtc: b.toUtc,
    label: b.label,
    kind: b.kind,
    color: colorOf(b.projectIndex),
  }));
  const filterBars = view.filterBars.map((f) => ({
    fromUtc: f.fromUtc,
    toUtc: f.toUtc,
    color: filterColor(f.filter),
    label: f.filter,
    count: f.count,
  }));
  const markers = [
    ...view.flips.map((f) => ({ atUtc: f.atUtc, kind: 'flip' as const, label: 'Flip' })),
    ...(fromNowUtc ? [{ atUtc: nowMs / 1000, kind: 'now' as const, label: '' }] : []),
  ];
  const chart = { ...base, series: base.series ?? [], markers, blocks, filterBars };

  const cards: TargetCard[] = view.cards.map(({ projectIndex, ...c }) => ({
    ...c,
    createdBy: creators.get(c.projectId) ?? null,
    color: colorOf(projectIndex),
    lines: c.lines.map((l) => ({ ...l, color: filterColor(l.filter) })),
  }));
  return {
    plan,
    chart,
    cards,
    unallocated: view.unallocated,
    protocol: view.protocol,
    lineNames: view.lineNames,
    header: view.header,
    fromNowUtc,
  };
}
