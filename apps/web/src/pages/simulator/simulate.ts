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
 * Eine Quelle (Entscheidung Sven 07.10.2026): Läuft die Nacht und hat die Rig einen gespeicherten Plan, kommen Zielkarten,
 * „Nicht zugeteilt“, Kopfzahlen und Flips aus dessen offenem Rest plus Ist (`rig-night.ts`); die Rechnung ab jetzt nur
 * noch für Was-wäre-wenn und Nächte ohne gespeicherten Plan (und für die Gründe unter „Nicht zugeteilt“).
 */
import { planNight, unixFromIso, type NightPlan, type PlanInput } from '@nina-pm/engine';
import {
  buildPlanInput,
  effectiveRig,
  isDeliverable,
  protocolSky,
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
import { rigNight, type RigNight, type RigProjectState } from './rig-night';

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
    /** Vom Plugin beendete bzw. übersprungene Blöcke (nicht mehr „geplant“). */
    readonly endedBlockIds?: readonly string[] | undefined;
  } | null;
}

export type Check = SimCheck;

export interface TargetCard extends Omit<SimCard, 'projectIndex' | 'lines'> {
  /** Ersteller (`app_user.id`) – Bild und Name auf der Zielkarte (30.09.2026). */
  readonly createdBy: string | null;
  readonly color: string;
  readonly lines: readonly (SimCard['lines'][number] & { readonly color: string })[];
  /**
   * Laufende Nacht mit gespeichertem Plan (07.10.2026): `running` = Block läuft an der Rig, `planned` = späterer Block;
   * sonst (Rechnung) `null`.
   */
  readonly state: 'running' | 'planned' | null;
  /** Gespeicherte Aufnahmen der Nacht bisher (Ist); ohne Ist 0. */
  readonly doneExposures: number;
}

export type UnallocatedProject = SimUnallocated;

/**
 * Projekt ohne Zielkarte (07.10.2026): läuft an der Rig bzw. ist im gespeicherten Plan noch geplant, steht aber nicht
 * (mehr) in der Eingabe – oder ist heute Nacht abgearbeitet (fertig, pausiert, Transit vorbei, ausgegraut) – statt
 * „Nicht zugeteilt“.
 */
export interface DoneCard {
  readonly projectId: string;
  readonly name: string;
  readonly createdBy: string | null;
  readonly color: string;
  readonly transit: boolean;
  /** `running`: Block läuft an der Rig; `planned`: späterer Block im gespeicherten Plan; `done`: abgearbeitet. */
  readonly state: RigProjectState;
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
  /**
   * Laufende Nacht aus gespeichertem Plan + Ist (07.10.2026): Karten, Kopfzahlen und Flips von der Rig; die Gründe unter
   * „Nicht zugeteilt“ stammen aus der Rechnung ab jetzt.
   */
  readonly fromStored: boolean;
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
  /**
   * „Ab jetzt“ liegt nach dem Ende der Dunkelheit (AP-71): Die Rechnung findet nichts mehr, ihre Gründe („nicht sichtbar“)
   * sagen nichts über die Projekte – das Web zeigt „Nacht vorbei“.
   */
  readonly nightOver: boolean;
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
 * Projekte dieser Nacht mit Ist ohne Zielkarte in der Rechnung ab jetzt (Was-wäre-wenn bzw. ohne gespeicherten Plan;
 * mit gespeichertem Plan gilt `rig-night.ts`):
 * - **läuft an der Rig** (`running`): laufender Ist-Block bzw. der jetzt laufende Block des gespeicherten Plans;
 * - **abgearbeitet** (`done`): belichtet, aber nicht mehr geplant (fertig, pausiert, Transit vorbei).
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
      state: 'done',
      exposures: (cur?.exposures ?? 0) + b.exposures,
      fromUtc: cur && cur.fromUtc < b.startUtc ? cur.fromUtc : b.startUtc,
      toUtc,
    });
  }
  for (const [projectId, until] of running) {
    const c = by.get(projectId);
    // Noch nicht begonnene Blöcke des gespeicherten Plans zeigt die Grafik; eine Karte gibt es erst mit Ist.
    if (c) by.set(projectId, { ...c, state: 'running', toUtc: until });
  }
  // Ohne gespeicherte Aufnahme nur Transits und Laufendes; sonst wäre ein bloß angefahrenes Ziel „abgearbeitet“.
  return sortDone(
    [...by.values()].filter((c) => c.exposures > 0 || c.transit || c.state !== 'done'),
  );
}

const STATE_ORDER: Record<RigProjectState, number> = { running: 0, planned: 1, done: 2 };

/** Laufendes vor Geplantem vor Abgearbeitetem, jeweils nach Beginn. */
const sortDone = (cards: DoneCard[]) =>
  cards.sort(
    (a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.fromUtc.localeCompare(b.fromUtc),
  );

const maxIso = (a: string | undefined, b: string) => (a !== undefined && a > b ? a : b);

/**
 * Projekte, an denen die Rig gerade arbeitet, mit dem Ende ihres jetzt laufenden Blocks im gespeicherten Plan (`null`,
 * wenn nur ein laufender Ist-Block bekannt ist). Nur der **jetzt** laufende Block zählt – ein späterer Block macht ein
 * Projekt nicht zu „läuft an der Rig“ (07.10.2026).
 */
export function stillRunning(
  executed: ExecutedNight | null | undefined,
  stored:
    | { readonly blocks: readonly { projectId: string; startUtc: string; endUtc: string }[] }
    | null
    | undefined,
  nowMs: number,
): Map<string, string | null> {
  const ids = new Map<string, string | null>(
    (executed?.blocks ?? []).filter((b) => b.running).map((b) => [b.projectId, null]),
  );
  if (Number.isFinite(nowMs))
    for (const b of stored?.blocks ?? [])
      if (Date.parse(b.startUtc) <= nowMs && Date.parse(b.endUtc) > nowMs)
        ids.set(b.projectId, maxIso(ids.get(b.projectId) ?? undefined, b.endUtc));
  return ids;
}

/** Belichtungen je Projekt und Filter wie die Engine (`summary.plannedFrames`: `expose`, auch Bonus). */
function plannedFramesOf(blocks: NightPlan['blocks']): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const b of blocks)
    for (const e of b.entries) {
      if (e.cmd !== 'expose') continue;
      const perProject = (out[b.projectId] ??= {});
      perProject[e.filter] = (perProject[e.filter] ?? 0) + 1;
    }
  return out;
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
    : // Wirksame Overheads wie der Server (AP-65): gemessen ab 10 Messungen, sonst bzw. mit „fest“ getippt.
      (buildPlanInput(effectiveRig(req.rig), candidates, req.moonProfiles, req.nights, {
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
  const computed = fromNowUtc ? planNight(planInput) : whole;
  // Eine Quelle (07.10.2026): laufende Nacht mit gespeichertem Plan → offener Rest der Revision + Ist.
  const live: RigNight | null =
    server && running
      ? rigNight({
          executed: server.executed,
          stored: server.storedPlan,
          endedBlockIds: server.endedBlockIds,
          nowMs,
        })
      : null;
  // Gezeigter Plan: Rest der Revision (Diagnosen der Rechnung nur für Projekte ohne Block und ohne Ist) bzw. Rechnung.
  const plan: NightPlan = live
    ? {
        ...computed,
        blocks: live.blocks,
        summary: { targets: live.targets, plannedFrames: plannedFramesOf(live.blocks) },
        diagnostics: computed.diagnostics.filter((d) => !live.projects.has(d.projectId)),
        warnings: [],
      }
    : computed;
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
  // Flips: mit gespeichertem Plan dessen kommende `meridian_flip`-Einträge, sonst die der Rechnung.
  const flips = live ? live.flips.map((at) => ({ atUtc: Date.parse(at) / 1000 })) : view.flips;
  const markers = [
    ...flips.map((f) => ({ atUtc: f.atUtc, kind: 'flip' as const, label: 'Flip' })),
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
          endedBlockIds: req.server.endedBlockIds,
          first: req.server.firstPlan,
          nowMs,
          running,
          computed: { blocks, filterBars, protocol: view.protocol },
          colorOfProject,
          filterColor,
          names,
          gapLabel: () => '',
          sky: protocolSky(planInput, { site: req.site, moonProfileNames: req.moonProfileNames }),
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

  const cards: TargetCard[] = view.cards.map(({ projectIndex, ...c }) => {
    const rig = live?.projects.get(c.projectId);
    return {
      ...c,
      createdBy: creators.get(c.projectId) ?? null,
      color: colorOf(projectIndex),
      lines: c.lines.map((l) => ({ ...l, color: filterColor(l.filter) })),
      state: rig ? (rig.state === 'running' ? 'running' : 'planned') : null,
      doneExposures: rig?.exposures ?? 0,
    };
  });
  const carded = new Set(cards.map((c) => c.projectId));
  const doneCards = live
    ? sortDone(
        [...live.projects.values()]
          .filter((p) => !carded.has(p.projectId))
          .map((p) => ({
            projectId: p.projectId,
            name: names.get(p.projectId) || p.title || p.projectId,
            createdBy: creators.get(p.projectId) ?? null,
            color: colorOfProject(p.projectId),
            transit: p.transit,
            state: p.state,
            exposures: p.exposures,
            fromUtc: p.fromUtc,
            toUtc: p.toUtc,
          })),
      )
    : doneTonight(
        req.server?.executed?.blocks ?? [],
        carded,
        stillRunning(req.server?.executed, req.server?.storedPlan, nowMs),
        names,
        creators,
        colorOfProject,
      );
  // Mit gespeichertem Plan: „Nicht zugeteilt“ nur, was weder offen geplant noch belichtet ist.
  const isDone = new Set([...doneCards.map((c) => c.projectId), ...(live?.projects.keys() ?? [])]);
  return {
    plan,
    chart,
    cards,
    doneCards,
    fromStored: live !== null,
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
    header: live ? { ...view.header, targets: live.targets, frames: live.frames } : view.header,
    fromNowUtc,
    nightOver:
      fromNowUtc !== null && nowMs >= Date.parse(whole.darknessEndUtc ?? whole.nightWindow.endUtc),
    actual,
    source: {
      serverHash: req.server?.inputHash ?? null,
      whatIf: req.server !== undefined && req.server !== null && server === null,
      stored: req.server?.storedPlan ? storedInfo(req.server.storedPlan) : null,
    },
  };
}
