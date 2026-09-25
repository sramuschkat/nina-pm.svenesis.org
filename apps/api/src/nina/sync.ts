/**
 * Use-Cases der NINA-API für ein Rig (AP-14a; TK 6.3, 7.3, 7.6):
 * - `bootstrap`: Rig, Standort, Optik, Kamera, bestätigte Filterradbelegung, Scheduler, Mondprofile,
 *   Nacht-Tabelle ab der Mittagsnacht (60 Nächte) und Übernahmestatus (FA-SIM-09).
 * - `targets`: auslieferbare Projekte (`isDeliverable`) mit ETag **ohne** Zähler aus Meldungen (NT-19).
 * - `plan`: Datenladen im Use-Case → `buildPlanInput` → `planNight`, Revision je Session speichern
 *   (A5-2, FA-SIM-05, NT-01, NT-20, M7).
 * Exoplaneten werden erst mit der Transit-Festlegung (R4) ausgeliefert; bis dahin nur Deep-Sky.
 */
import type { NinaPrincipal, ProjectDetail } from '@nina-pm/db';
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
  effectiveTenantSettings,
  isDeliverable,
  lineCounters,
  nina,
  ProblemError,
  sortChainKeys,
  type PlanMoonProfileSource,
  type SortChainKey,
} from '@nina-pm/shared';
import type { z } from 'zod';
import { isoUtc } from '../lib/format';
import { siteNights } from '../lib/night-table';
import { moonProfileView, rigView } from '../routes/web-equipment';
import { filterPlanSummary, projectView } from '../routes/web-projects';
import type { ApiServices } from '../routes/services';

type Bootstrap = z.output<typeof nina.NinaBootstrap>;
type Targets = z.output<typeof nina.NinaTargets>;
type NinaRigDelivery = z.output<typeof nina.NinaRigDelivery>;
type PlanRequest = z.output<typeof nina.NinaPlanRequest>;
type PlanResponse = z.output<typeof nina.NinaPlanResponse>;

/** Nächte der Bootstrap-Tabelle (TK 7.3). */
export const BOOTSTRAP_NIGHTS = 60;
export const LEASE_MINUTES = 3;
export const MIN_PLUGIN_VERSION = '1.0.0';
const SORT_KEYS = new Set<string>(sortChainKeys);

const iso = (d: Date) => isoUtc(d);

type RigRef = Pick<NinaPrincipal, 'tenantId' | 'rigId'>;

async function rigData(svc: ApiServices, p: RigRef) {
  const repos = svc.repositories({ tenantId: p.tenantId });
  const eq = repos.equipment();
  const rig = await eq.rig(p.rigId);
  if (!rig) throw new ProblemError('nina.token_invalid');
  const [site, telescope, camera, filters, profiles, tenant] = await Promise.all([
    eq.site(rig.siteId),
    eq.telescope(rig.telescopeId),
    eq.camera(rig.cameraId),
    eq.filters(),
    eq.moonProfiles(),
    repos.tenant().current(),
  ]);
  if (!site || !telescope || !camera || !tenant) throw new ProblemError('internal.error');
  return { repos, rig, site, telescope, camera, filters, profiles, tenant };
}

function readoutModes(camera: { readoutModes: readonly string[] }) {
  return camera.readoutModes.map((name, index) => ({ index, name }));
}

export async function bootstrap(svc: ApiServices, p: NinaPrincipal): Promise<Bootstrap> {
  const now = svc.now();
  const d = await rigData(svc, p);
  const s = rigView(d.rig, d.telescope, d.camera).scheduler;
  const filterOf = new Map(d.filters.map((f) => [f.id, f]));
  const table = siteNights(d.site, now, undefined, BOOTSTRAP_NIGHTS);
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

/** Auslieferbare Projekte des Rigs für eine Nacht (`isDeliverable`, TK 6.3). */
async function deliverable(
  svc: ApiServices,
  p: RigRef,
  rig: { ninaDeliveryEnabled: boolean; bonusEnabled: boolean },
  night: string,
): Promise<ProjectDetail[]> {
  const projects = svc.repositories({ tenantId: p.tenantId }).projects();
  const list = await projects.list({
    admin: true,
    deleted: false,
    rigId: p.rigId,
    approvalStatus: 'approved',
    status: 'active',
    mine: false,
    favorites: false,
  });
  return list.filter(
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
        },
        night,
      ),
  );
}

/** ETag über Projekt-Versionen, Einstellungsversion, Verwerfungen und Filterzuordnung (NT-19). */
function targetsEtag(
  settingsVersion: number,
  filterWheel: unknown,
  projects: readonly ProjectDetail[],
  rejected: Readonly<Record<string, number>>,
): string {
  const key = JSON.stringify({
    settingsVersion,
    filterWheel,
    projects: projects
      .map((d) => [d.project.id, d.project.version])
      .sort(([a], [b]) => (String(a) < String(b) ? -1 : 1)),
    rejected: Object.entries(rejected).sort(([a], [b]) => (a < b ? -1 : 1)),
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
 * Fortschritt je Filter. Nur Deep-Sky, solange Exoplaneten nicht ausgeliefert werden (R4).
 */
export async function delivery(svc: ApiServices, p: RigRef): Promise<NinaRigDelivery> {
  const d = await targetsData(svc, p);
  const confirmed = d.confirmed;
  return {
    rigId: p.rigId,
    rigName: d.rig.name,
    deliveryEnabled: d.rig.ninaDeliveryEnabled,
    night: d.night,
    generatedAtUtc: d.body.generatedAtUtc,
    settingsVersion: d.rig.settingsVersion,
    targetsEtag: d.etag,
    items: d.details.map((x) => {
      const pv = projectView(x);
      return {
        id: pv.id,
        name: pv.name,
        targetName: pv.targetName,
        projectType: x.project.projectType as 'deep_sky' | 'exoplanet',
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
      };
    }),
  };
}

async function targetsData(svc: ApiServices, p: RigRef) {
  const now = svc.now();
  const d = await rigData(svc, p);
  const view = rigView(d.rig, d.telescope, d.camera);
  const night = currentNightRow(siteNights(d.site, now, undefined, 2), iso(now)).night;
  const list = await deliverable(
    svc,
    p,
    { ...view, bonusEnabled: view.scheduler.bonusEnabled },
    night,
  );
  const deepSky = list.filter((x) => x.project.projectType === 'deep_sky');
  const rejected = await d.repos.ninaRig(p.rigId).rejectedCounts(deepSky.map((x) => x.project.id));
  const confirmed = new Map(
    d.rig.filterWheel
      .filter((s) => s.filterId !== null && s.ninaConfirmedAt !== null)
      .map((s) => [s.filterId as string, s.ninaFilterName]),
  );
  const modes = d.camera.readoutModes;
  const body: Targets = {
    rigId: p.rigId,
    generatedAtUtc: iso(now),
    mosaicPanelsIndependent: view.scheduler.mosaicPanelsIndependent,
    projects: deepSky.map((x) => {
      const pv = projectView(x);
      const c = pv.conditions;
      return {
        id: pv.id,
        version: pv.version,
        type: 'deep_sky' as const,
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
        // Position = NINA-Nummer − 1 (NT-32, AP-22); `pv.panels` ist nach `panel_index` sortiert.
        panels: pv.panels.map((panel, position) => ({
          id: panel.id,
          index: position,
          label: panel.label,
          raDeg: panel.raDeg,
          decDeg: panel.decDeg,
          rotationDeg: panel.rotationDeg,
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
            const index = l.readoutMode === null ? -1 : modes.indexOf(l.readoutMode);
            return {
              id: l.id,
              order: l.orderIndex,
              enabled: l.enabled && panel.enabled,
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
      };
    }),
  };
  return {
    body,
    etag: targetsEtag(d.rig.settingsVersion, d.rig.filterWheel, deepSky, rejected),
    details: deepSky,
    confirmed,
    night,
    rig: d.rig,
  };
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
  const view = rigView(d.rig, d.telescope, d.camera);
  const table = siteNights(d.site, now, undefined, 3);
  const current = currentNightRow(table, iso(now)).night;
  const next = table.nights[table.nights.findIndex((n) => n.night === current) + 1]?.night;
  if (req.night !== current && req.night !== next) throw new ProblemError('nina.night_invalid');
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
  const list = await deliverable(
    svc,
    p,
    { ...view, bonusEnabled: view.scheduler.bonusEnabled },
    req.night,
  );
  const deepSky = list.filter((x) => x.project.projectType === 'deep_sky');
  const rigRepo = d.repos.ninaRig(p.rigId);
  // NT-20: nur IDs abziehen, die noch nicht in `capture` stehen; Transit-Meldungen zählen nicht.
  const pendingItems = req.pendingCaptures.filter((c) => !c.transitObservationId);
  const known = await rigRepo.knownCaptureIds(pendingItems.flatMap((c) => c.captureIds));
  const pendingByLine: Record<string, number> = {};
  for (const item of pendingItems)
    pendingByLine[item.exposureLineId] =
      (pendingByLine[item.exposureLineId] ?? 0) +
      new Set(item.captureIds.filter((id) => !known.has(id))).size;
  const lastState = (p.lastState ?? {}) as {
    sequenceTriggers?: { autofocusAfterTimeMin?: number | null } | null;
  };
  const planTable = siteNights(d.site, now, req.night, 2);
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
  const input = buildPlanInput(
    view,
    deepSky.map((x) => projectView(x)),
    d.profiles.map(moonProfileView) as PlanMoonProfileSource[],
    { ...planTable, currentNight: current },
    {
      night: req.night,
      site: {
        latitudeDeg: d.site.latitudeDeg,
        longitudeDeg: d.site.longitudeDeg,
        elevationM: d.site.elevationM,
      },
      startAtUtc: req.startAtUtc ?? null,
      tonight,
      pendingByLine,
      autofocusAfterTimeMin: lastState.sequenceTriggers?.autofocusAfterTimeMin ?? null,
    },
  );
  let result;
  try {
    result = planNight(input as PlanInput);
  } catch (error) {
    // Ungültige Engine-Eingabe → 422 engine.input_invalid bzw. validation.failed (TK 7.3).
    if (error instanceof EngineInputError)
      throw new ProblemError(error.code, [{ path: 'plan', message: error.message }]);
    throw error;
  }
  const modes = d.camera.readoutModes;
  const index = (mode: string | null) => {
    const i = mode === null ? -1 : modes.indexOf(mode);
    return i < 0 ? null : i;
  };
  const revision = await rigRepo.savePlan({
    nightPlanId: result.nightPlanId,
    night: req.night,
    sessionId: req.sessionId ?? null,
    reason: req.reason,
    engineVersion: result.engineVersion,
    inputHash: result.inputHash,
    plan: result,
    now,
  });
  return {
    ...result,
    revision,
    blocks: result.blocks.map((b) => ({
      ...b,
      entries: b.entries.map((e) =>
        e.cmd === 'expose' || e.cmd === 'expose_series'
          ? { ...e, readoutModeIndex: index(e.readoutMode) }
          : e,
      ),
    })),
    diagnostics: result.diagnostics as PlanResponse['diagnostics'],
    warnings: result.warnings as PlanResponse['warnings'],
  } as PlanResponse;
}
