/**
 * Use-Cases der NINA-API für ein Rig (AP-14a; TK 6.3, 7.3, 7.6):
 * - `bootstrap`: Rig, Standort, Optik, Kamera, bestätigte Filterradbelegung, Scheduler, Mondprofile,
 *   Nacht-Tabelle ab der Mittagsnacht (60 Nächte) und Übernahmestatus (FA-SIM-09).
 * - `targets`: auslieferbare Projekte (`isDeliverable`) mit ETag **ohne** Zähler aus Meldungen (NT-19).
 * - `plan`: Datenladen im Use-Case → `buildPlanInput` → `planNight`, Revision je Session speichern
 *   (A5-2, FA-SIM-05, NT-01, NT-20, M7).
 * Exoplaneten-Projekte nur in der Nacht ihres festgelegten Transits (AP-44; transit.md §9): in `targets` mit
 * Ephemeride und Beobachtung, in `POST /plan` als Transit-Einheit (`buildPlanInput` mit `transits`).
 */
import type { DeliveredTransit, FlatRecord, NinaPrincipal, ProjectDetail } from '@nina-pm/db';
import {
  EngineInputError,
  ENGINE_VERSION,
  planNight,
  sha256hex,
  type PlanInput,
} from '@nina-pm/engine';
import {
  buildPlanInput,
  currentNightRow,
  effectiveRig,
  effectiveTenantSettings,
  filterTypes,
  isDeliverable,
  lineCounters,
  nina,
  ProblemError,
  sortChainKeys,
  type FilterType,
  type PlanMoonProfileSource,
  type PlanTransitSource,
  type SortChainKey,
} from '@nina-pm/shared';
import type { z } from 'zod';
import { isoUtc } from '../lib/format';
import { logger } from '../lib/logger';
import { graceNight, siteNights } from '../lib/night-table';
import { moonProfileView, rigView } from '../routes/web-equipment';
import { filterPlanSummary, projectView } from '../routes/web-projects';
import type { ApiServices } from '../routes/services';
import {
  omit,
  PLAN_STORM_WINDOW_MS,
  planContentKey,
  PlanRequestRate,
  reusablePlan,
} from './plan-revisions';

type ProjectViewLine = ReturnType<typeof projectView>['panels'][number]['lines'][number];

type Bootstrap = z.output<typeof nina.NinaBootstrap>;
type Targets = z.output<typeof nina.NinaTargets>;
type TargetProject = Targets['projects'][number];
type NinaRigDelivery = z.output<typeof nina.NinaRigDelivery>;
type PlanRequest = z.output<typeof nina.NinaPlanRequest>;
type PlanResponse = z.output<typeof nina.NinaPlanResponse>;

/** Nächte der Bootstrap-Tabelle (TK 7.3). */
export const BOOTSTRAP_NIGHTS = 60;
export const LEASE_MINUTES = 3;
export const MIN_PLUGIN_VERSION = '1.0.0';
const SORT_KEYS = new Set<string>(sortChainKeys);
const FILTER_TYPES: ReadonlySet<string> = new Set(filterTypes);
const isFilterType = (t: string): t is FilterType => FILTER_TYPES.has(t);

const iso = (d: Date) => isoUtc(d);

export type RigRef = Pick<NinaPrincipal, 'tenantId' | 'rigId'>;

export async function rigData(svc: ApiServices, p: RigRef) {
  const repos = svc.repositories({ tenantId: p.tenantId });
  const eq = repos.equipment();
  const rig = await eq.rig(p.rigId);
  if (!rig) throw new ProblemError('nina.token_invalid');
  const [site, telescope, camera, filters, profiles, tenant, measured] = await Promise.all([
    eq.site(rig.siteId),
    eq.telescope(rig.telescopeId),
    eq.camera(rig.cameraId),
    eq.filters(),
    eq.moonProfiles(),
    repos.tenant().current(),
    repos.ninaRig(p.rigId).measuredOverhead(),
  ]);
  if (!site || !telescope || !camera || !tenant) throw new ProblemError('internal.error');
  return { repos, rig, site, telescope, camera, filters, profiles, tenant, measured };
}

function readoutModes(camera: { readoutModes: readonly string[] }) {
  return camera.readoutModes.map((name, index) => ({ index, name }));
}

export async function bootstrap(svc: ApiServices, p: NinaPrincipal): Promise<Bootstrap> {
  const now = svc.now();
  const d = await rigData(svc, p);
  // Wirksame Overheads (AP-65) wie in der Engine-Eingabe: das Plugin misst die Download-Zeit gleich.
  const s = effectiveRig(rigView(d.rig, d.telescope, d.camera, d.measured)).scheduler;
  const filterOf = new Map(d.filters.map((f) => [f.id, f]));
  const table = siteNights(d.site, now, undefined, BOOTSTRAP_NIGHTS, { twilight: true });
  await d.repos.ninaRig(p.rigId).recordSettingsFetched(p.instanceId, d.rig.settingsVersion, now);
  return {
    apiVersion: '1',
    serverTimeUtc: iso(now),
    server: { engineVersion: ENGINE_VERSION, minPluginVersion: MIN_PLUGIN_VERSION },
    instance: { id: p.instanceId, name: p.instanceName },
    tenant: {
      key: d.tenant.tenantKey,
      name: d.tenant.displayName,
      timeZone: effectiveTenantSettings(d.tenant.settings).tenantTimezone,
    },
    rig: {
      id: d.rig.id,
      name: d.rig.name,
      settingsVersion: d.rig.settingsVersion,
      site: {
        name: d.site.name,
        latDeg: d.site.latitudeDeg,
        lonDeg: d.site.longitudeDeg,
        elevationM: d.site.elevationM,
        timeZone: d.site.timeZone,
      },
      telescope: {
        name: d.telescope.name,
        apertureMm: d.telescope.apertureMm,
        focalLengthMm: d.telescope.focalLengthMm,
        reducerFactor: d.telescope.reducerFactor,
      },
      camera: {
        name: d.camera.name,
        pixelSizeUm: d.camera.pixelSizeUm,
        widthPx: d.camera.widthPx,
        heightPx: d.camera.heightPx,
        defaultGain: d.camera.defaultGain,
        defaultOffset: d.camera.defaultOffset,
        readoutModes: readoutModes(d.camera),
        binning: [...d.camera.supportedBinning],
        setpointC: d.camera.coolingSetpointC,
        toleranceC: d.camera.coolingToleranceC,
      },
      rotator: {
        present: d.rig.hasRotator,
        defaultRotationDeg: d.rig.defaultRotationDeg,
        toleranceDeg: d.rig.rotationToleranceDeg,
        skipOnMismatch: d.rig.skipOnRotationMismatch,
      },
      filters: d.rig.filterWheel
        .filter((slot) => slot.filterId !== null && filterOf.has(slot.filterId))
        .map((slot) => {
          const f = filterOf.get(slot.filterId as string);
          return {
            shortName: f?.shortName ?? '',
            name: f?.fullName || (f?.shortName ?? ''),
            color: f?.colorHex ?? '#CCCCCC',
            position: slot.position,
            ninaFilterName: slot.ninaConfirmedAt !== null ? slot.ninaFilterName : null,
            ...(f && isFilterType(f.filterType) ? { type: f.filterType } : {}),
          };
        }),
      scheduler: {
        strategy: s.strategy,
        playback: s.playback,
        sortChain: s.sortChain.filter((k): k is SortChainKey => SORT_KEYS.has(k)),
        bonus: { enabled: s.bonusEnabled },
        mosaicPanelsIndependent: s.mosaicPanelsIndependent,
        dither: { enabled: s.ditherEnabled, every: s.ditherEvery },
        filterSwitch: {
          enabled: s.filterSwitchEnabled,
          every: s.filterSwitchEvery,
          tolerancePct: s.filterSwitchTolerancePct,
        },
        flats: {
          enabled: s.flatsEnabled,
          source: s.flatsSource,
          fullSet: s.flatsFullSet,
          count: s.flatCount,
          darkFlats: { enabled: s.darkFlatsEnabled, count: s.darkFlatCount },
          auto: { mode: s.flatsAutoMode, intervalDays: s.flatsAutoIntervalDays },
        },
        meridianFlip: {
          enabled: s.flipEnabled,
          afterMin: s.flipAfterMeridianMin,
          maxAfterMin: s.flipMaxAfterMeridianMin,
          pauseBeforeMin: s.flipPauseBeforeMeridianMin,
          durationS: s.flipDurationS,
        },
        overhead: s.overhead,
        overshootPct: s.overshootPct,
      },
      leaseMinutes: LEASE_MINUTES,
    },
    moonProfiles: d.profiles.map((m) => ({
      id: m.id,
      name: m.name,
      separationDeg: m.separationDeg,
      widthDays: m.widthDays,
      relax: m.relaxScale,
      minAltDeg: m.moonMinAltDeg,
      maxAltDeg: m.moonMaxAltDeg,
      maxIlluminationPct: m.maxIlluminationPct,
      moonMustBeDown: m.moonMustBeDown,
    })),
    tzdataVersion: table.tzdataVersion,
    nights: table.nights,
    timeZoneTransitions: table.timeZoneTransitions,
  };
}

/** Auslieferbare Projekte des Rigs für eine Nacht (`isDeliverable`, TK 6.3) mit deren festgelegten Transits. */
export async function deliverable(
  svc: ApiServices,
  p: RigRef,
  rig: { ninaDeliveryEnabled: boolean; bonusEnabled: boolean },
  night: string,
  now: Date,
): Promise<Delivery> {
  const r = await deliverableByNight(svc, p, rig, [night], now);
  return { projects: r.nights[0] ?? [], transits: r.transits };
}

/** Auslieferung einer Nacht: Projekte und – je Exoplaneten-Projekt – der festgelegte Transit (Schlüssel Nacht:Projekt). */
export interface Delivery {
  readonly projects: ProjectDetail[];
  readonly transits: ReadonlyMap<string, DeliveredTransit>;
}

/**
 * Wie `deliverable`, für mehrere Nächte mit einer Abfrage (Tagesschleife, `targets.deliveryNights`, AP-52).
 * Exoplaneten (TK 6.3 `hasLockedTransit`, transit.md §9): auslieferbar **nur in der Nacht** einer festgelegten,
 * primären Beobachtung mit Fensterende nach `now` und aktiver Transit-Zeile – ohne Fenster in dieser Nacht entfällt die
 * Transit-Einheit (`allocation.md` §3 Nr. 6), und ein Exoplaneten-Projekt wird nie wie Deep-Sky belichtet.
 * `transits` enthält je Nacht höchstens einen Transit je Projekt (den frühesten).
 */
export async function deliverableByNight(
  svc: ApiServices,
  p: RigRef,
  rig: { ninaDeliveryEnabled: boolean; bonusEnabled: boolean },
  nights: readonly string[],
  now: Date,
): Promise<{ nights: ProjectDetail[][]; transits: Map<string, DeliveredTransit> }> {
  const repos = svc.repositories({ tenantId: p.tenantId });
  const [list, locked] = await Promise.all([
    repos.projects().list({
      admin: true,
      deleted: false,
      rigId: p.rigId,
      approvalStatus: 'approved',
      status: 'active',
      mine: false,
      favorites: false,
    }),
    repos.ninaRig(p.rigId).lockedTransits(nights, now),
  ]);
  // `lockedTransits` ist nach Fensterbeginn sortiert: je Nacht und Projekt gewinnt der früheste.
  const transits = new Map<string, DeliveredTransit>();
  for (const t of locked) {
    const key = transitKey(t.night, t.projectId);
    if (t.lineId !== null && !transits.has(key)) transits.set(key, t);
  }
  return {
    transits,
    nights: nights.map((night) =>
      list.filter(
        (d) =>
          d.project.rigId === p.rigId &&
          isDeliverable(
            {
              approvalStatus: d.project.approvalStatus,
              status: d.project.status,
              deletedAt: d.project.deletedAt,
              ninaDeliveryEnabled: rig.ninaDeliveryEnabled,
              bonusEnabled: rig.bonusEnabled,
              startDate: d.project.startDate,
              projectType: d.project.projectType as 'deep_sky' | 'exoplanet',
              lines: d.panels.flatMap((panel) =>
                panel.lines.map((l) => ({
                  ...l,
                  enabled: l.enabled && panel.enabled !== false,
                  deleted: l.deletedAt !== null,
                })),
              ),
              overshootPct: d.overshootPct,
              hasLockedTransit: transits.has(transitKey(night, d.project.id)),
            },
            night,
          ),
      ),
    ),
  };
}

const transitKey = (night: string, projectId: string) => `${night}:${projectId}`;

/** Festgelegte Transits einer Nacht je Projekt-ID. */
function transitsOfNight(
  all: ReadonlyMap<string, DeliveredTransit>,
  night: string,
): Map<string, DeliveredTransit> {
  return new Map(
    [...all.values()].filter((t) => t.night === night).map((t) => [t.projectId, t] as const),
  );
}

/**
 * Anteil der Tagesschleife am Targets-ETag (AP-52; Analyse 07.10.2026): die aktuelle Nacht und nur, **ob** eine der
 * folgenden Nächte etwas ausliefert – nicht die Zahl je Nacht. Die Tagesschleife des Plugins fragt nur „irgendeine Nacht ab
 * der nächsten auszuführenden nicht leer“ (`DayLoop.HasDelivery`); die Projekte der aktuellen Nacht stehen ohnehin im
 * ETag. Änderungen nur für morgen (Startdatum, Transit-Festlegung) lösen so keine Neuplanung der laufenden Nacht und kein
 * falsches „Rig plant noch mit Rev. n (Ziele geändert)“ mehr aus. Ein 304 mit älteren Zählern je Nacht ergibt dieselbe
 * Entscheidung der Tagesschleife.
 */
export function deliveryEtagPart(deliveryNights: readonly { night: string; projects: number }[]) {
  return {
    night: deliveryNights[0]?.night ?? null,
    laterDelivery: deliveryNights.slice(1).some((n) => n.projects > 0),
  };
}

/** ETag über Projekt-Versionen, Einstellungsversion, Verwerfungen und Filterzuordnung (NT-19). */
function targetsEtag(
  settingsVersion: number,
  filterWheel: unknown,
  projects: readonly ProjectDetail[],
  rejected: Readonly<Record<string, number>>,
  flats: ReadonlyMap<string, readonly FlatRecord[]>,
  deliveryNights: readonly { night: string; projects: number }[],
  transits: ReadonlyMap<string, DeliveredTransit>,
): string {
  const key = JSON.stringify({
    settingsVersion,
    filterWheel,
    projects: projects
      .map((d) => [d.project.id, d.project.version])
      .sort(([a], [b]) => (String(a) < String(b) ? -1 : 1)),
    rejected: Object.entries(rejected).sort(([a], [b]) => (a < b ? -1 : 1)),
    // Neue Flats ändern die Auswahl am nächsten Morgen (AP-50b).
    flats: [...flats.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
    // Tagesschleife (AP-52): aktuelle Nacht und „folgende Nächte liefern aus“, nicht die Zahl je Nacht.
    delivery: deliveryEtagPart(deliveryNights),
    // Transit-Festlegungen (TK 7.6): Festlegen, Aufheben und Erlaubnisse ändern die Auslieferung, ohne dass die
    // Projektversion steigt. Ohne Zähler aus Meldungen (NT-19).
    transits: [...transits.values()]
      .map((t) => [
        t.observationId,
        t.projectId,
        t.night,
        iso(t.windowStartUtc),
        iso(t.windowEndUtc),
        iso(t.lockedAt),
        t.plannedCount,
        t.allowAutofocus,
        t.allowRecenter,
        t.ephemeris.id,
        t.lineId,
      ])
      .sort(([a], [b]) => (String(a) < String(b) ? -1 : 1)),
  });
  return `"t-${sha256hex(key).slice(0, 16)}"`;
}

export async function targets(
  svc: ApiServices,
  p: RigRef,
): Promise<{ body: Targets; etag: string }> {
  const { body, etag } = await targetsData(svc, p);
  return { body, etag };
}

/**
 * „An NINA ausgeliefert“ (S-41, FA-NIN-22): dieselbe Liste wie `targets` für das Rig, je Ziel mit Stand und
 * Fortschritt je Filter – Exoplaneten-Projekte nur in der Nacht ihres festgelegten Transits (AP-44). Projekte, die heute
 * Nacht gearbeitet haben und nicht mehr ausgeliefert werden, stehen mit `doneTonight` dabei (ausgegraut, 07.10.2026).
 */
export async function delivery(svc: ApiServices, p: RigRef): Promise<NinaRigDelivery> {
  const d = await targetsData(svc, p);
  const confirmed = d.confirmed;
  // Kommentare je Projekt (FA-PRJ-17): nur für die Web-Ansicht, nicht Teil von `targets`.
  const repos = svc.repositories({ tenantId: p.tenantId });
  // Heute Nacht abgearbeitet (07.10.2026): Projekte mit gespeicherten Lights dieser Nacht, die nicht mehr in `targets`
  // stehen (fertig, pausiert, Transit vorbei) – alle Projektarten; die Web-Ansicht zeigt sie ausgegraut.
  const shipped = new Set(d.details.map((x) => x.project.id));
  const done = new Map<string, { acquired: number; untilMs: number }>();
  for (const l of (await repos.ninaRig(p.rigId).nightActual(d.night)).lights) {
    if (!l.projectId || l.result !== 'saved' || shipped.has(l.projectId)) continue;
    const cur = done.get(l.projectId) ?? { acquired: 0, untilMs: 0 };
    done.set(l.projectId, {
      acquired: cur.acquired + 1,
      untilMs: Math.max(cur.untilMs, l.capturedAt.getTime() + l.exposureS * 1000),
    });
  }
  const doneDetails =
    done.size === 0
      ? []
      : (
          await repos.projects().list({
            admin: true,
            deleted: false,
            rigId: p.rigId,
            mine: false,
            favorites: false,
          })
        ).filter((x) => done.has(x.project.id) && x.project.rigId === p.rigId);
  const comments = await repos
    .projects()
    .commentCounts([...d.details, ...doneDetails].map((x) => x.project.id));
  return {
    rigId: p.rigId,
    rigName: d.rig.name,
    deliveryEnabled: d.rig.ninaDeliveryEnabled,
    night: d.night,
    generatedAtUtc: d.body.generatedAtUtc,
    settingsVersion: d.rig.settingsVersion,
    targetsEtag: d.etag,
    items: [...d.details, ...doneDetails].map((x) => {
      const pv = projectView(x);
      const doneTonight = done.get(pv.id);
      return {
        id: pv.id,
        name: pv.name,
        targetName: pv.targetName,
        projectType: x.project.projectType as 'deep_sky' | 'exoplanet',
        createdBy: pv.createdBy,
        status: pv.status ?? 'active',
        priority: pv.priority,
        version: pv.version,
        updatedAt: pv.updatedAt,
        panelCount: Math.max(1, pv.panels.length),
        raDeg: pv.raDeg ?? pv.panels[0]?.raDeg ?? null,
        decDeg: pv.decDeg ?? pv.panels[0]?.decDeg ?? null,
        rotationDeg: pv.rotationDeg ?? pv.panels[0]?.rotationDeg ?? null,
        filters: filterPlanSummary(x).map((f) => ({
          filterId: f.filterId,
          filterShortName: f.filterShortName,
          ninaFilterName: f.filterId === null ? null : (confirmed.get(f.filterId) ?? null),
          planned: f.planned,
          accepted: f.accepted,
        })),
        commentCount: comments.get(pv.id) ?? 0,
        ...(doneTonight
          ? {
              doneTonight: {
                acquired: doneTonight.acquired,
                untilUtc: iso(new Date(doneTonight.untilMs)),
              },
            }
          : {}),
      };
    }),
  };
}

async function targetsData(svc: ApiServices, p: RigRef) {
  const now = svc.now();
  const d = await rigData(svc, p);
  const view = rigView(d.rig, d.telescope, d.camera);
  // Aktuelle und zwei folgende Nächte (Tagesschleife, FA-NIN-07); ausgeliefert wird die aktuelle.
  const table = siteNights(d.site, now, undefined, 4);
  const night = currentNightRow(table, iso(now)).night;
  const index = table.nights.findIndex((n) => n.night === night);
  const ahead = table.nights.slice(index, index + 3).map((n) => n.night);
  const delivered = await deliverableByNight(
    svc,
    p,
    { ...view, bonusEnabled: view.scheduler.bonusEnabled },
    ahead,
    now,
  );
  const [list = [], ...later] = delivered.nights;
  const deliveryNights = ahead.map((n, i) => ({
    night: n,
    projects: (i === 0 ? list : (later[i - 1] ?? [])).length,
  }));
  const transits = transitsOfNight(delivered.transits, night);
  const ids = list.map((x) => x.project.id);
  const rejected = await d.repos.ninaRig(p.rigId).rejectedCounts(ids);
  const flats = await d.repos.ninaRig(p.rigId).flatRecords(ids);
  const confirmed = new Map(
    d.rig.filterWheel
      .filter((s) => s.filterId !== null && s.ninaConfirmedAt !== null)
      .map((s) => [s.filterId as string, s.ninaFilterName]),
  );
  const modes = d.camera.readoutModes;
  const lineBase = (l: ProjectViewLine) => {
    const index = l.readoutMode === null ? -1 : modes.indexOf(l.readoutMode);
    return {
      id: l.id,
      filter: l.filterShortName,
      ninaFilterName: l.filterId === null ? null : (confirmed.get(l.filterId) ?? null),
      exposureS: l.exposureS,
      gain: l.gain,
      offset: l.offsetAdu,
      binning: l.binning,
      readoutMode: l.readoutMode,
      readoutModeIndex: index < 0 ? null : index,
      moon:
        l.moonMode === 'profile' && l.moonProfileId
          ? { mode: 'profile' as const, profileId: l.moonProfileId }
          : l.moonMode === 'project_default'
            ? { mode: 'project_default' as const }
            : { mode: 'none' as const },
    };
  };
  const projects: TargetProject[] = [];
  for (const x of list) {
    const pv = projectView(x);
    const c = pv.conditions;
    const common = {
      id: pv.id,
      version: pv.version,
      name: pv.name,
      target: {
        name: pv.targetName,
        objectType: pv.targetType,
        catalogNames: pv.catalogNames,
      },
      status: pv.status ?? 'active',
      priority: pv.priority,
      startDate: pv.startDate,
      dueDate: pv.dueDate,
      flatsOnRecord: flats.get(pv.id) ?? [],
      conditions: {
        minAltitudeDeg: c.minAltitudeDeg,
        minTimeOnTargetH: c.minTimeOnTargetH,
        twilight: c.twilight,
        moonDefault: c.moonAvoidanceEnabled
          ? {
              enabled: true,
              separationDeg: c.moonSeparationDeg,
              widthDays: c.moonWidthDays,
              relax: c.moonRelaxScale,
              minAltDeg: c.moonMinAltDeg,
              maxAltDeg: c.moonMaxAltDeg,
              maxIlluminationPct: c.moonMaxIlluminationPct,
              moonMustBeDown: c.moonMustBeDown,
            }
          : { enabled: false },
      },
      // Zentrum und Raster für den Framing-Assistenten (FA-NIN-02, AP-16h); ohne Rotator gilt der
      // Kamerawinkel des Rigs als pa₀ (NT-30).
      center: {
        raDeg: pv.raDeg ?? pv.panels[0]?.raDeg ?? 0,
        decDeg: pv.decDeg ?? pv.panels[0]?.decDeg ?? 0,
        rotationDeg:
          !d.rig.hasRotator && d.rig.defaultRotationDeg !== null
            ? d.rig.defaultRotationDeg
            : (pv.rotationDeg ?? pv.panels[0]?.rotationDeg ?? 0),
      },
    };
    const panelBase = (panel: (typeof pv.panels)[number], position: number) => ({
      id: panel.id,
      index: position,
      label: panel.label,
      raDeg: panel.raDeg,
      decDeg: panel.decDeg,
      rotationDeg: panel.rotationDeg,
    });
    if (x.project.projectType === 'exoplanet') {
      // Exoplanet (transit.md §9): ein Panel mit genau der Transit-Zeile, Ephemeride der Festlegung und die
      // Beobachtung dieser Nacht. `isDeliverable` hat schon geprüft, dass es sie gibt.
      const t = transits.get(pv.id);
      const panel = pv.panels[0];
      const line = panel?.lines.find((l) => l.id === t?.lineId);
      if (!t || !panel || !line) continue;
      projects.push({
        ...common,
        type: 'exoplanet',
        panels: [{ ...panelBase(panel, 0), lines: [lineBase(line)] }],
        exoplanet: {
          planet: t.planet,
          ephemeris: {
            t0BjdTdb: t.ephemeris.t0BjdTdb,
            t0SigmaD: t.ephemeris.t0SigmaD,
            periodD: t.ephemeris.periodD,
            periodSigmaD: t.ephemeris.periodSigmaD,
            // Ohne Katalogdauer die Dauer der Beobachtung (Ein- bis Austritt).
            durationH:
              t.ephemeris.durationH ?? (t.egressUtc.getTime() - t.ingressUtc.getTime()) / 3_600_000,
          },
          observation: {
            id: t.observationId,
            status: 'locked',
            epoch: t.epoch,
            night: t.night,
            ingressUtc: iso(t.ingressUtc),
            midUtc: iso(t.midUtc),
            egressUtc: iso(t.egressUtc),
            windowStartUtc: iso(t.windowStartUtc),
            windowEndUtc: iso(t.windowEndUtc),
            allowAutofocus: t.allowAutofocus,
            allowRecenter: t.allowRecenter,
            counts: {
              planned: t.plannedCount,
              acquired: t.acquiredCount,
              rejected: t.rejectedCount,
            },
          },
        },
      });
      continue;
    }
    projects.push({
      ...common,
      type: 'deep_sky',
      mosaic: {
        rows: pv.mosaic.rows,
        columns: pv.mosaic.cols,
        overlapPct: pv.mosaic.overlapPct,
      },
      // Position = NINA-Nummer − 1 (NT-32, AP-22); `pv.panels` ist nach `panel_index` sortiert.
      panels: pv.panels.map((panel, position) => ({
        ...panelBase(panel, position),
        lines: panel.lines.map((l) => {
          const k = lineCounters(
            {
              plannedCount: l.plannedCount,
              acquiredCount: l.counters.acquired,
              rejectedCount: l.counters.rejected,
              bonusCount: l.counters.bonus,
              bonusRejectedCount: l.counters.bonusRejected,
            },
            x.overshootPct,
          );
          return {
            ...lineBase(l),
            order: l.orderIndex,
            enabled: l.enabled && panel.enabled && l.disabledForNight !== night,
            counts: {
              planned: k.planned,
              acquired: k.acquired,
              rejected: k.rejected,
              accepted: k.accepted,
              remaining: k.remaining,
              planningNeed: k.planningNeed,
              bonus: k.bonus,
              bonusRejected: k.bonusRejected,
            },
          };
        }),
      })),
      exoplanet: null,
    });
  }
  const body: Targets = {
    rigId: p.rigId,
    generatedAtUtc: iso(now),
    mosaicPanelsIndependent: view.scheduler.mosaicPanelsIndependent,
    deliveryNights,
    projects,
  };
  const shipped = new Set(projects.map((x) => x.id));
  const details = list.filter((x) => shipped.has(x.project.id));
  return {
    body,
    etag: targetsEtag(
      d.rig.settingsVersion,
      d.rig.filterWheel,
      details,
      rejected,
      flats,
      deliveryNights,
      transits,
    ),
    details,
    confirmed,
    night,
    rig: d.rig,
  };
}

export type RigDataResult = Awaited<ReturnType<typeof rigData>>;

/**
 * Engine-Eingabe einer Nacht für das Rig des Tokens (FA-SIM-05): auslieferbare Deep-Sky-Projekte, Exoplaneten-Projekte
 * mit festgelegtem Transit dieser Nacht als Transit-Einheit (`transits`, transit.md §3/§9), Mondprofile, Nacht-Tabelle
 * ab `night`, Autofokus-Intervall nur mit gemeldetem Trigger (M7). `POST /plan` und der Plugin-Simulator
 * (`GET /simulation`, AP-53) rechnen damit dieselbe Eingabe.
 */
export async function nightPlanInput(
  svc: ApiServices,
  p: RigRef & { readonly lastState?: unknown },
  d: RigDataResult,
  o: {
    night: string;
    currentNight: string;
    now: Date;
    startAtUtc: string | null;
    tonight: Parameters<typeof buildPlanInput>[4]['tonight'];
    pendingByLine: Record<string, number>;
    /** Web (AP-53c): auch ohne eingeschaltete NINA-Auslieferung rechnen – wie bisher der Web-Simulator. */
    ignoreDeliverySwitch?: boolean;
  },
) {
  // Wirksame Overheads (AP-65): gemessener Median ab 10 Messungen, sonst bzw. mit Schalter „fest“ der getippte Wert.
  const view = effectiveRig(rigView(d.rig, d.telescope, d.camera, d.measured));
  const delivered = await deliverable(
    svc,
    p,
    {
      ...view,
      ...(o.ignoreDeliverySwitch ? { ninaDeliveryEnabled: true } : {}),
      bonusEnabled: view.scheduler.bonusEnabled,
    },
    o.night,
    o.now,
  );
  const ofNight = transitsOfNight(delivered.transits, o.night);
  // Exoplaneten nur mit Transit dieser Nacht (`isDeliverable` hat das geprüft); nie als reguläre Einheit.
  const projects = delivered.projects
    .filter((x) => x.project.projectType === 'deep_sky' || ofNight.has(x.project.id))
    .map((x) => projectView(x));
  const transits: PlanTransitSource[] = projects.flatMap((x) => {
    const t = ofNight.get(x.id);
    return t && t.lineId !== null
      ? [
          {
            projectId: t.projectId,
            observationId: t.observationId,
            lineId: t.lineId,
            windowStartUtc: iso(t.windowStartUtc),
            windowEndUtc: iso(t.windowEndUtc),
            lockedAtUtc: iso(t.lockedAt),
          },
        ]
      : [];
  });
  const lastState = (p.lastState ?? {}) as {
    sequenceTriggers?: { autofocusAfterTimeMin?: number | null } | null;
  };
  const planTable = siteNights(d.site, o.now, o.night, 2);
  const input = buildPlanInput(
    view,
    projects,
    d.profiles.map(moonProfileView) as PlanMoonProfileSource[],
    { ...planTable, currentNight: o.currentNight },
    {
      night: o.night,
      site: {
        latitudeDeg: d.site.latitudeDeg,
        longitudeDeg: d.site.longitudeDeg,
        elevationM: d.site.elevationM,
      },
      startAtUtc: o.startAtUtc,
      tonight: o.tonight,
      pendingByLine: o.pendingByLine,
      transits,
      // Trigger noch unbekannt (kein Heartbeat mit NINA-PM-Container, z. B. erster Plan nach dem NINA-Start): mit dem
      // Intervall des Rigs planen statt ohne Autofokus (Analyse 04.10.2026); bekannt ohne Trigger → ohne (M7).
      autofocusAfterTimeMin: lastState.sequenceTriggers
        ? (lastState.sequenceTriggers.autofocusAfterTimeMin ?? null)
        : view.scheduler.overhead.afEveryMin,
    },
  ) as PlanInput;
  return { input, projects };
}

/** `planNight` mit ungültiger Eingabe → `422 engine.input_invalid` bzw. `validation.failed` (TK 7.3). */
export function runEngine(input: PlanInput) {
  try {
    return planNight(input);
  } catch (error) {
    if (error instanceof EngineInputError)
      throw new ProblemError(error.code, [{ path: 'plan', message: error.message }]);
    throw error;
  }
}

/**
 * `POST /plan`: `night` nur `currentNight` oder die folgende Nacht (NT-01); offene Meldungen ohne
 * bereits gespeicherte IDs (NT-20); `afEveryMin` nur mit gemeldetem Trigger *Autofokus nach Zeit* (M7).
 */
export async function plan(
  svc: ApiServices,
  p: NinaPrincipal,
  req: PlanRequest,
): Promise<PlanResponse> {
  const now = svc.now();
  const d = await rigData(svc, p);
  const table = siteNights(d.site, now, undefined, 3);
  const current = currentNightRow(table, iso(now)).night;
  const next = table.nights[table.nights.findIndex((n) => n.night === current) + 1]?.night;
  if (req.night !== current && req.night !== next && req.night !== graceNight(table, now))
    throw new ProblemError('nina.night_invalid');
  if (req.reason === 'initial' && req.tonight) {
    const filled = (v: unknown) =>
      v !== undefined &&
      v !== null &&
      !(Array.isArray(v) && v.length === 0) &&
      !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
    if (Object.entries(req.tonight).some(([k, v]) => k !== 'lastAutofocusUtc' && filled(v)))
      throw new ProblemError('validation.failed', [
        { path: 'tonight', message: 'bei reason initial nur lastAutofocusUtc zulässig' },
      ]);
  }
  const rigRepo = d.repos.ninaRig(p.rigId);
  // NT-20: nur IDs abziehen, die noch nicht in `capture` stehen; Transit-Meldungen zählen nicht.
  const pendingItems = req.pendingCaptures.filter((c) => !c.transitObservationId);
  const known = await rigRepo.knownCaptureIds(pendingItems.flatMap((c) => c.captureIds));
  const pendingByLine: Record<string, number> = {};
  for (const item of pendingItems)
    pendingByLine[item.exposureLineId] =
      (pendingByLine[item.exposureLineId] ?? 0) +
      new Set(item.captureIds.filter((id) => !known.has(id))).size;
  const tonight = req.tonight
    ? {
        pastBlocks: req.tonight.pastBlocks ?? [],
        exposedSecByUnit: req.tonight.exposedSecByUnit ?? {},
        lastAutofocusUtc: req.tonight.lastAutofocusUtc ?? null,
        filterCycle: req.tonight.filterCycle ?? [],
        flipDoneByPanel: req.tonight.flipDoneByPanel ?? {},
        currentUnitId: req.tonight.currentUnitId ?? null,
      }
    : null;
  const { input } = await nightPlanInput(svc, p, d, {
    night: req.night,
    currentNight: current,
    now,
    startAtUtc: req.startAtUtc ?? null,
    tonight,
    pendingByLine,
  });
  let result = runEngine(input);
  // Erstplan mitten in der Nacht (Spec-Ergänzung 04.10.2026, Sven): ab jetzt rechnen, sonst verteilte die Engine die schon
  // vergangene Dunkelzeit mit, und die Blöcke darin gingen verloren. Vor Beginn des Nachtfensters bleibt `startAtUtc`
  // leer – gleicher Hash wie der Simulator im Plugin (execution.md §10).
  if (
    req.reason === 'initial' &&
    !req.startAtUtc &&
    now.getTime() > Date.parse(result.nightWindow.startUtc)
  )
    result = runEngine({ ...input, startAtUtc: iso(now) });
  const modes = d.camera.readoutModes;
  const index = (mode: string | null) => {
    const i = mode === null ? -1 : modes.indexOf(mode);
    return i < 0 ? null : i;
  };
  // Abrufsturm (Analyse 07.10.2026): nur Warnung, keine Ablehnung.
  if (req.sessionId) {
    const burst = planRequests.record(req.sessionId, now);
    if (burst !== null)
      logger.warn('nina_plan_request_storm', {
        rigId: p.rigId,
        sessionId: req.sessionId,
        requests: burst,
        windowS: PLAN_STORM_WINDOW_MS / 1000,
      });
  }
  // Stand der Eingabe für „Rig plant noch mit Rev. n“ (AP-53c): Ziele-ETag des Plugins und Einstellungsversion.
  const stamp = { targetsEtag: req.targetsEtag ?? null, settingsVersion: d.rig.settingsVersion };
  const saved = await rigRepo.savePlan({
    nightPlanId: result.nightPlanId,
    night: req.night,
    sessionId: req.sessionId ?? null,
    reason: req.reason,
    engineVersion: result.engineVersion,
    inputHash: result.inputHash,
    // Inhaltsgleiche Revision (nur `startAtUtc` und daraus abgeleitete IDs anders, z. B. leerer Plan alle 5 min) nicht
    // neu speichern, sondern wiederverwenden (Analyse 07.10.2026, execution.md §3.2).
    contentKey: planContentKey(result, stamp),
    reusable: reusablePlan(result, now),
    plan: { ...result, ...stamp },
    now,
  });
  // Wiederverwendet: so antworten, wie die Revision gespeichert ist (gleicher Inhalt, ihre IDs).
  const base = saved.reused
    ? ({
        ...withoutStamp(saved.reused.summary),
        blocks: saved.reused.blocks,
      } as unknown as typeof result)
    : result;
  if (saved.reused)
    logger.info('nina_plan_reused', {
      rigId: p.rigId,
      sessionId: req.sessionId ?? null,
      revision: saved.revision,
    });
  return {
    ...base,
    nightPlanId: saved.nightPlanId,
    revision: saved.revision,
    blocks: base.blocks.map((b) => ({
      ...b,
      entries: b.entries.map((e) =>
        e.cmd === 'expose' || e.cmd === 'expose_series'
          ? { ...e, readoutModeIndex: index(e.readoutMode) }
          : e,
      ),
    })),
    diagnostics: base.diagnostics as PlanResponse['diagnostics'],
    warnings: base.warnings as PlanResponse['warnings'],
  } as PlanResponse;
}

/** Planabrufe je Session in diesem Lambda-Container (Abrufsturm, nur Warnung). */
const planRequests = new PlanRequestRate();

/** Gespeicherte Zusatzfelder einer Revision, die nicht zur Plan-Antwort gehören. */
function withoutStamp(summary: Record<string, unknown>): Record<string, unknown> {
  return omit(summary, ['targetsEtag', 'settingsVersion', 'contentKey', 'sourceNightPlanId']);
}
