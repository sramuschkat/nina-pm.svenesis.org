/**
 * Nacht-Simulator S-40 (AP-13f, FA-SIM-01…08): reine Rechnung für den Web Worker. Eingabe über
 * `buildPlanInput` (A5-2, keine eigene Abbildung), Plan über `planNight` (dieselbe Engine wie der
 * Planaufbau, FA-SIM-05); daraus Diagramm, Zielkarten, nicht zugeteilte Projekte und Planprotokoll –
 * Protokoll, Karten, Blöcke und Filterleiste über `simulationView` aus `@nina-pm/shared` (wie der Plugin-Simulator,
 * AP-53); hier kommen Farben und Höhenkurven dazu.
 * Keine Uhr: „jetzt“ ergänzt die Seite.
 * Eine Eingabe-Quelle (AP-53c, FA-SIM-05): Mit `server` rechnet der Simulator mit der Engine-Eingabe des Servers
 * (`GET /simulations/input`, dieselbe Funktion wie `POST /plan`); nur mit eigenen Entwürfen (Was-wäre-wenn) baut er sie
 * selbst. Läuft die Nacht bzw. ist sie mit Session vorbei, zeigt er Ist + Plan (`actual-view.ts`, FA-SIM-10).
 */
import { planNight, unixFromIso, type NightPlan, type PlanInput } from '@nina-pm/engine';
import {
  buildPlanInput,
  isDeliverable,
  type ExecutedNight,
  type StoredPlan,
  simulationView,
  type PlanTransitSource,
  type SimCard,
  type SimCheck,
  type SimUnallocated,
} from '@nina-pm/shared';
import { CHART_SERIES_COUNT } from '@nina-pm/ui-tokens';
import type { NightChartProps } from '../../components/night-chart';
import { nightChartFromEngine } from '../../lib/night-chart-data';
import { actualView, type ActualProtocolRow, type ActualView } from './actual-view';

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
  /**
   * Festgelegte Transits der Nacht an diesem Rig (`GET /simulations/transits`): Exoplaneten-Projekte plant der
   * Simulator nur mit ihnen – als Transitblock wie `POST /plan` (06.10.2026; vorher fehlten sie im Web-Plan).
   */
  readonly transits?: readonly PlanTransitSource[];
  /** Eingabe, Ist und gespeicherter Plan vom Server (`GET /simulations/input`, AP-53c). */
  readonly server?: {
    readonly input: unknown;
    readonly inputHash: string;
    readonly projectNames: Readonly<Record<string, string>>;
    readonly executed: ExecutedNight | null;
    readonly storedPlan: StoredPlan | null;
    readonly firstPlan: StoredPlan | null;
  } | null;
}

export type Check = SimCheck;

export interface TargetCard extends Omit<SimCard, 'projectIndex' | 'lines'> {
  /** Ersteller (`app_user.id`) – Bild und Name auf der Zielkarte (30.09.2026). */
  readonly createdBy: string | null;
  readonly color: string;
  readonly lines: readonly (SimCard['lines'][number] & { readonly color: string })[];
}

export type UnallocatedProject = SimUnallocated;

/**
 * Projekt mit Ist dieser Nacht ohne Zielkarte in der Rechnung ab jetzt (07.10.2026): läuft an der Rig (gespeicherter
 * Plan) oder heute Nacht abgearbeitet (fertig, pausiert, Transit vorbei, ausgegraut) – statt „Nicht zugeteilt“.
 */
export interface DoneCard {
  readonly projectId: string;
  readonly name: string;
  readonly createdBy: string | null;
  readonly color: string;
  readonly transit: boolean;
  /** Läuft an der Rig (laufender Block oder offener Block im gespeicherten Plan); sonst abgearbeitet. */
  readonly running: boolean;
  readonly exposures: number;
  readonly fromUtc: string;
  readonly toUtc: string | null;
}

export type ProtocolRow = ActualProtocolRow;

/** Herkunft der Eingabe für den Hash-Hinweis (AP-53c). */
export interface SimulationSource {
  /** `inputHash` des Servers; `null` ohne Server-Eingabe. */
  readonly serverHash: string | null;
  /** Eigene Eingabe (Entwürfe): weicht vom Server ab. */
  readonly whatIf: boolean;
  readonly stored: Omit<StoredPlan, 'blocks'> | null;
}

export interface SimulationResult {
  readonly plan: NightPlan;
  readonly chart: Omit<NightChartProps, 'state'>;
  readonly cards: readonly TargetCard[];
  /** Heute Nacht abgearbeitet, nicht mehr im Rest-Plan: ausgegraut nach den Zielkarten. */
  readonly doneCards: readonly DoneCard[];
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
  /** Ist + Plan (laufende bzw. vergangene Nacht mit Session), sonst `null`. */
  readonly actual: ActualView | null;
  readonly source: SimulationSource;
}

const colorOf = (i: number) => `var(--npm-chart-series-${String((i % CHART_SERIES_COUNT) + 1)})`;

/**
 * Auslieferungsregel wie `POST /plan` (FA-SIM-05, TK 6.3 `isDeliverable`): Startdatum erreicht und Arbeit vorhanden
 * (Planungsbedarf > 0 oder Bonus). Der Schalter *An NINA ausliefern* zählt nicht – der Simulator zeigt, was das Rig
 * eingeschaltet täte. Exoplaneten nur mit festgelegtem Transit dieser Nacht (`req.transits`).
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
      hasLockedTransit: (req.transits ?? []).some((t) => t.projectId === p.id),
    },
    req.night,
  );
}

/** Exoplaneten-Projekt ohne festgelegten Transit dieser Nacht – fehlt im Plan, steht mit Grund unter „nicht zugeteilt“. */
function withoutTransit(req: SimulationRequest, p: SimulationRequest['projects'][number]): boolean {
  return (
    p.projectType === 'exoplanet' &&
    (req.selection === 'given' ||
      (p.approvalStatus === 'approved' && p.status === 'active' && p.deletedAt === null)) &&
    !(req.transits ?? []).some((t) => t.projectId === p.id)
  );
}

/** Planstand ohne Blöcke (Hash-Hinweis). */
function storedInfo(p: StoredPlan): Omit<StoredPlan, 'blocks'> {
  return {
    nightPlanId: p.nightPlanId,
    revision: p.revision,
    reason: p.reason,
    createdAtUtc: p.createdAtUtc,
    stale: p.stale,
    staleCause: p.staleCause,
  };
}

/**
 * Projekte dieser Nacht ohne Zielkarte in der Rechnung ab jetzt (07.10.2026) – Simulator-Zielkarten und Tabelle „Plan für
 * diese Nacht“:
 * - **läuft an der Rig** (`running`): laufender Ist-Block oder offener Block im gespeicherten Plan – den führt das Plugin
 *   aus, auch wenn die Rechnung ab jetzt nichts mehr zuteilt (IC 1795 um 06:04 CDT: 10 min dunkel, „unter der
 *   Mindestzeit“, die Rig belichtete aber noch SII);
 * - **abgearbeitet**: belichtet, aber nicht mehr geplant (fertig, pausiert, Transit vorbei).
 */
export function doneTonight(
  executedBlocks: readonly ExecutedNight['blocks'][number][],
  planned: ReadonlySet<string>,
  running: ReadonlyMap<string, string | null>,
  names: ReadonlyMap<string, string>,
  creators: ReadonlyMap<string, string>,
  colorOfProject: (id: string) => string,
): DoneCard[] {
  const by = new Map<string, DoneCard>();
  for (const b of executedBlocks) {
    if (planned.has(b.projectId)) continue;
    const cur = by.get(b.projectId);
    const toUtc = b.endUtc === null || cur?.toUtc === null ? null : maxIso(cur?.toUtc, b.endUtc);
    by.set(b.projectId, {
      projectId: b.projectId,
      name: names.get(b.projectId) || b.title || b.projectId,
      createdBy: creators.get(b.projectId) ?? null,
      color: colorOfProject(b.projectId),
      transit: (cur?.transit ?? false) || b.kind === 'transit',
      running: false,
      exposures: (cur?.exposures ?? 0) + b.exposures,
      fromUtc: cur && cur.fromUtc < b.startUtc ? cur.fromUtc : b.startUtc,
      toUtc,
    });
  }
  for (const [projectId, until] of running) {
    const c = by.get(projectId);
    // Noch nicht begonnene Blöcke des gespeicherten Plans zeigt die Grafik; eine Karte gibt es erst mit Ist.
    if (c) by.set(projectId, { ...c, running: true, toUtc: until });
  }
  // Ohne gespeicherte Aufnahme nur Transits und Laufendes; sonst wäre ein bloß angefahrenes Ziel „abgearbeitet“.
  // Laufendes vor Abgearbeitetem, jeweils nach Beginn.
  return [...by.values()]
    .filter((c) => c.exposures > 0 || c.transit || c.running)
    .sort((a, b) => Number(b.running) - Number(a.running) || a.fromUtc.localeCompare(b.fromUtc));
}

const maxIso = (a: string | undefined, b: string) => (a !== undefined && a > b ? a : b);

/**
 * Projekte, an denen die Rig noch arbeitet, mit dem Ende ihres letzten offenen Blocks im gespeicherten Plan (`null`, wenn
 * nur ein laufender Ist-Block bekannt ist): laufender Ist-Block oder ein noch nicht beendeter Block des gespeicherten Plans.
 */
export function stillRunning(
  executed: ExecutedNight | null | undefined,
  stored: { readonly blocks: readonly { projectId: string; endUtc: string }[] } | null | undefined,
  nowMs: number,
): Map<string, string | null> {
  const ids = new Map<string, string | null>(
    (executed?.blocks ?? []).filter((b) => b.running).map((b) => [b.projectId, null]),
  );
  if (Number.isFinite(nowMs))
    for (const b of stored?.blocks ?? [])
      if (Date.parse(b.endUtc) > nowMs)
        ids.set(b.projectId, maxIso(ids.get(b.projectId) ?? undefined, b.endUtc));
  return ids;
}

export function simulate(req: SimulationRequest): SimulationResult {
  // Entwürfe ohne Panel kann die Engine nicht planen (engine.input_invalid) – sie fehlen im Plan.
  // Exoplaneten nie wie Deep-Sky: ohne festgelegten Transit auch nicht mit eigenen Entwürfen (`given`).
  const candidates = req.projects.filter(
    (p) =>
      p.panels.length > 0 &&
      !withoutTransit(req, p) &&
      (req.selection === 'given' || deliverable(req, p)),
  );
  const server = req.server && req.selection === 'plannable' ? req.server : null;
  const input = server
    ? (server.input as PlanInput)
    : (buildPlanInput(req.rig, candidates, req.moonProfiles, req.nights, {
        night: req.night,
        site: {
          latitudeDeg: req.site.latitudeDeg,
          longitudeDeg: req.site.longitudeDeg,
          elevationM: req.site.elevationM,
        },
        selection: req.selection,
        // AF-Intervall des Rigs wie der Server, solange er die Trigger der Sequenz nicht kennt (FA-SIM-05).
        autofocusAfterTimeMin: req.rig.scheduler.overhead.afEveryMin,
        transits: (req.transits ?? []).filter((t) => candidates.some((p) => p.id === t.projectId)),
      }) as PlanInput);
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
  const names = new Map([
    ...Object.entries(req.server?.projectNames ?? {}),
    ...req.projects.map((p) => [p.id, p.name] as const),
  ]);
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
  // Ist + Plan (AP-53c): laufende Nacht bzw. vergangene mit Session – Erledigtes blass, Kommendes kräftig.
  const extra = new Map<string, string>();
  const colorOfProject = (id: string) => {
    const known = color.get(id) ?? extra.get(id);
    if (known) return known;
    const next = colorOf(projects.length + extra.size);
    extra.set(id, next);
    return next;
  };
  const nightOver = Number.isFinite(nowMs) && nowMs >= Date.parse(whole.nightWindow.endUtc);
  const actual =
    req.server && (running || nightOver)
      ? actualView({
          executed: req.server.executed,
          stored: server ? req.server.storedPlan : null,
          first: req.server.firstPlan,
          nowMs,
          running,
          computed: { blocks, filterBars, protocol: view.protocol },
          colorOfProject,
          filterColor,
          names,
          gapLabel: () => '',
        })
      : null;
  const chart = actual
    ? {
        ...base,
        series: base.series ?? [],
        // Flips der Rechnung nur noch ab jetzt; erledigte stehen als Lücke im Ist.
        markers: markers.filter((m) => m.kind !== 'flip' || m.atUtc > nowMs / 1000),
        blocks: actual.blocks,
        filterBars: actual.filterBars,
        gaps: actual.gaps,
      }
    : { ...base, series: base.series ?? [], markers, blocks, filterBars };

  const cards: TargetCard[] = view.cards.map(({ projectIndex, ...c }) => ({
    ...c,
    createdBy: creators.get(c.projectId) ?? null,
    color: colorOf(projectIndex),
    lines: c.lines.map((l) => ({ ...l, color: filterColor(l.filter) })),
  }));
  const doneCards = doneTonight(
    req.server?.executed?.blocks ?? [],
    new Set(cards.map((c) => c.projectId)),
    stillRunning(req.server?.executed, req.server?.storedPlan, nowMs),
    names,
    creators,
    colorOfProject,
  );
  const isDone = new Set(doneCards.map((c) => c.projectId));
  return {
    plan,
    chart,
    cards,
    doneCards,
    unallocated: [
      ...view.unallocated.filter((u) => !isDone.has(u.projectId)),
      ...req.projects
        .filter((p) => withoutTransit(req, p) && !isDone.has(p.id))
        .map((p) => ({
          projectId: p.id,
          name: p.name,
          reasons: [{ reason: 'no_locked_transit' }],
        })),
    ],
    protocol: actual ? actual.protocol : view.protocol,
    lineNames: view.lineNames,
    header: view.header,
    fromNowUtc,
    actual,
    source: {
      serverHash: req.server?.inputHash ?? null,
      whatIf: req.server !== undefined && req.server !== null && server === null,
      stored: req.server?.storedPlan ? storedInfo(req.server.storedPlan) : null,
    },
  };
}
