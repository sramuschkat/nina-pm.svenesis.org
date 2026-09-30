/**
 * Exoplaneten-Teil eines Projekts (AP-42/43; FA-EXO-15…21, 30, 33, 34; transit.md §7/§8): Laden, Vorhersage der
 * kommenden beobachtbaren Transits aus der gespeicherten Ephemeride, Belegung auf dem Rig, Modus des Festlegens
 * für den Aufrufer und die Antwort `ExoProjectDetail`. Gemeinsam für `GET …/exo`, Festlegen und Aufheben.
 */
import {
  myExoProjectCounts,
  readExoCatalog,
  transitLine,
  type EphemerisRow,
  type ExoProjectRow,
  type ProjectDetail,
} from '@nina-pm/db';
import { TWILIGHT_DEG } from '@nina-pm/engine';
import {
  can,
  effectiveTenantSettings,
  ProblemError,
  transitConflict,
  transitDeadlineMs,
  type AuthContext,
  type ExoObservationView,
  type ExoProjectDetail,
  type ExoTransitView,
  type TransitLine,
} from '@nina-pm/shared';
import { siteNights } from '../lib/night-table';
import type { ApiServices } from '../routes/services';
import { nightWindows, rigTransitContext, type RigTransitContext } from './context';
import {
  catalogUpdate,
  entryFromProject,
  ephemerisView,
  findMerged,
  mergedCatalog,
} from './project';
import { cachedExoCatalog, searchTransits } from './search';

/** Nächte der Vorhersage im Reiter *Exoplanet-Transit* (FA-EXO-17; freigegeben 30.09.2026: 60 Nächte). */
export const EXO_UPCOMING_NIGHTS = 60;

type Tenant = Parameters<ApiServices['repositories']>[0];

export interface LoadedExoProject {
  readonly d: ProjectDetail;
  readonly exo: ExoProjectRow;
  readonly ephemerides: EphemerisRow[];
  readonly active: EphemerisRow;
  readonly rc: RigTransitContext | undefined;
  readonly line: { id: string; line: TransitLine } | null;
}

export async function loadExoProject(
  svc: ApiServices,
  tenant: Tenant,
  projectId: string,
): Promise<LoadedExoProject> {
  const repos = svc.repositories(tenant);
  const d = await repos.projects().detail(projectId);
  if (!d || d.project.projectType !== 'exoplanet') throw new ProblemError('resource.not_found');
  const exoRepo = repos.exoProjects();
  const exo = await exoRepo.exoProject(projectId);
  const ephemerides = await exoRepo.ephemerides(projectId);
  const active = ephemerides.find((e) => e.isActive) ?? ephemerides[0];
  if (!exo || !active) throw new ProblemError('resource.not_found');
  const rigId = d.project.rigId ?? d.project.requestedRigId;
  const rc = rigId ? await rigTransitContext(repos.equipment(), rigId) : undefined;
  const line = await transitLine(svc.db, tenant.tenantId, projectId);
  return { d, exo, ephemerides, active, rc, line };
}

export interface Upcoming {
  readonly night: string;
  readonly item: ExoTransitView;
}

/** Beobachtbare Transits der nächsten 60 Nächte (FA-EXO-17), jede Epoche einmal. */
export async function upcomingTransits(
  svc: ApiServices,
  tenant: Tenant,
  memberId: string,
  x: LoadedExoProject,
): Promise<{ fromNight: string | null; upcoming: Upcoming[] }> {
  const entry = entryFromProject(x.exo.catalogSnapshot, x.active);
  if (!x.rc || !entry) return { fromNight: null, upcoming: [] };
  const rc = x.rc;
  const p = x.d.project;
  const fromNight = siteNights(rc.site, svc.now(), undefined, 2).currentNight;
  const myProjects = await myExoProjectCounts(svc.db, tenant.tenantId, memberId);
  const k = Math.min(3, Math.max(1, Math.round(x.exo.bufferSigma))) as 1 | 2 | 3;
  const out: Upcoming[] = [];
  const seen = new Set<number>();
  for (const w of nightWindows(rc.site, fromNight, EXO_UPCOMING_NIGHTS)) {
    const items = searchTransits({
      entries: [entry],
      catalogs: [entry.catalog],
      site: { latDeg: rc.site.latitudeDeg, lonDeg: rc.site.longitudeDeg },
      nightStartUtc: w.startUtc,
      nightEndUtc: w.endUtc,
      minAltDeg: Number(p.minAltitudeDeg),
      twilightDeg: TWILIGHT_DEG[p.twilight as keyof typeof TWILIGHT_DEG],
      k,
      rigApertureMm: rc.apertureMm,
      rigFilters: rc.rigFilters,
      unconfirmedRigFilters: rc.unconfirmedRigFilters,
      exposureRig: rc.exposureRig,
      myProjects,
      baselineBeforeMin: Number(x.exo.baselineBeforeMin),
      baselineAfterMin: Number(x.exo.baselineAfterMin),
    });
    // Dieselbe Epoche kann in zwei Nachtfenstern liegen (Fenster über Mittag): einmal zeigen.
    for (const item of items)
      if (item.transit.observable && !seen.has(item.transit.n)) {
        seen.add(item.transit.n);
        out.push({ night: w.night, item });
      }
  }
  return { fromNight, upcoming: out };
}

const CLOSED = new Set(['completed', 'archived', 'unfinished']);

export type LockMode = ExoProjectDetail['lockMode'];
export type LockBlocked = ExoProjectDetail['lockBlockedReason'];

/** Was *Festlegen* für den Aufrufer bewirkt (transit.md §8). */
export function lockModeFor(
  auth: AuthContext,
  x: LoadedExoProject,
  settings: ReturnType<typeof effectiveTenantSettings>,
): { mode: LockMode; blocked: LockBlocked } {
  const p = x.d.project;
  const res = {
    tenantId: auth.tenantId ?? undefined,
    createdBy: p.createdBy,
    approvalStatus: p.approvalStatus as never,
  };
  const blocked = (reason: NonNullable<LockBlocked>) => ({ mode: null, blocked: reason });
  if (p.approvalStatus === 'rejected' || (p.status !== null && CLOSED.has(p.status)))
    return blocked('project_closed');
  if (!x.rc) return blocked('no_rig');
  if (!x.line?.line.filterId) return blocked('no_line');
  if (p.approvalStatus === 'approved') {
    if (!can(auth, 'transit.lock', { ...res, openLocks: 0 })) return blocked('no_right');
    if (can(auth, 'project.status')) return { mode: 'lock', blocked: null };
    return { mode: settings.exoUserLockNeedsAdmin ? 'request' : 'lock', blocked: null };
  }
  if (!can(auth, 'project.update', res))
    return blocked(p.approvalStatus === 'submitted' ? 'submitted' : 'no_right');
  return { mode: 'wish', blocked: null };
}

const iso = (d: Date | string) => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');
const isoOrNull = (d: Date | string | null) => (d === null ? null : iso(d));

export async function exoDetail(
  svc: ApiServices,
  tenant: Tenant,
  auth: AuthContext,
  projectId: string,
): Promise<ExoProjectDetail> {
  const repos = svc.repositories(tenant);
  const x = await loadExoProject(svc, tenant, projectId);
  const { d, exo, active, rc } = x;
  const p = d.project;
  const now = svc.now();
  const settings = effectiveTenantSettings((await repos.tenant().current())?.settings);
  const { fromNight, upcoming } = await upcomingTransits(svc, tenant, auth.memberId as string, x);
  const observations = await repos.transits().observations(projectId);
  const open = observations.filter(
    (o) => (o.status === 'requested' || o.status === 'locked') && new Date(o.windowEndUtc) > now,
  );
  const rigObs = rc ? await repos.transits().rigObservations(rc.rig.id, now) : [];
  const { mode, blocked } = lockModeFor(auth, x, settings);

  const items = upcoming.map((u) => {
    const own = open.find((o) => o.epoch === u.item.transit.n);
    const conflict = own
      ? null
      : transitConflict(
          {
            projectId,
            planet: exo.planet,
            epoch: u.item.transit.n,
            windowStartMs: Date.parse(u.item.transit.windowStartUtc),
            windowEndMs: Date.parse(u.item.transit.windowEndUtc),
            line: x.line?.line ?? null,
          },
          rigObs.filter((o) => o.projectId !== projectId || o.epoch !== u.item.transit.n),
        );
    const w = conflict ? (conflict.kind === 'share' ? conflict.primary : conflict.with) : null;
    return {
      night: u.night,
      item: u.item,
      deadlineUtc: iso(
        new Date(
          transitDeadlineMs(
            Date.parse(u.item.transit.windowStartUtc),
            rc?.rig.overhead.slewCenterS ?? 0,
          ),
        ),
      ),
      conflict:
        conflict && w
          ? {
              kind: conflict.kind,
              projectId: w.projectId,
              projectName: w.projectName,
              createdBy: w.createdBy,
              createdByName: w.createdByName,
              windowStartUtc: iso(new Date(w.windowStartMs)),
              windowEndUtc: iso(new Date(w.windowEndMs)),
            }
          : null,
      observationId: own?.id ?? null,
    };
  });
  const closed = p.status !== null && CLOSED.has(p.status);
  const suggested =
    open.length === 0 && !closed
      ? items.find((i) => i.observationId === null && (!i.conflict || i.conflict.kind === 'share'))
      : undefined;
  const admin = can(auth, 'project.status');

  const entries = await cachedExoCatalog(() => readExoCatalog(svc.db), now.getTime());
  const current = findMerged(mergedCatalog(entries), exo.catalog, exo.planet);
  return {
    projectId,
    planet: exo.planet,
    star: exo.star,
    catalog: exo.catalog as ExoProjectDetail['catalog'],
    baselineBeforeMin: Number(exo.baselineBeforeMin),
    baselineAfterMin: Number(exo.baselineAfterMin),
    bufferSigma: exo.bufferSigma,
    ephemeris: ephemerisView(active),
    history: x.ephemerides.filter((e) => e.id !== active.id).map(ephemerisView),
    catalogUpdate: current
      ? catalogUpdate(
          active,
          current,
          Number(p.raDeg ?? current.raDeg),
          Number(p.decDeg ?? current.decDeg),
          now.getTime() / 1000,
        )
      : null,
    others: await repos.exoProjects().others(exo.planet, projectId),
    rig: rc ? { id: rc.rig.id, name: rc.rig.name, apertureMm: rc.apertureMm } : null,
    site: rc
      ? {
          id: rc.site.id,
          name: rc.site.name,
          timeZone: rc.site.timeZone,
          latDeg: rc.site.latitudeDeg,
          lonDeg: rc.site.longitudeDeg,
        }
      : null,
    minAltDeg: Number(p.minAltitudeDeg),
    twilight: p.twilight as ExoProjectDetail['twilight'],
    fromNight,
    nights: EXO_UPCOMING_NIGHTS,
    upcoming: items,
    observations: observations.map((o): ExoObservationView => ({
      id: o.id,
      status: o.status as ExoObservationView['status'],
      epoch: o.epoch,
      night: String(o.night).slice(0, 10),
      ingressUtc: iso(o.ingressUtc),
      midUtc: iso(o.midUtc),
      egressUtc: iso(o.egressUtc),
      windowStartUtc: iso(o.windowStartUtc),
      windowEndUtc: iso(o.windowEndUtc),
      baselineBeforeMin: Number(o.baselineBeforeMin),
      baselineAfterMin: Number(o.baselineAfterMin),
      bufferMin: Number(o.bufferMin),
      confirmDeadlineUtc: isoOrNull(o.confirmDeadlineUtc),
      lockedAt: isoOrNull(o.lockedAt),
      lockedByName: o.lockedByName ?? null,
      plannedCount: Number(o.plannedCount),
      acquiredCount: Number(o.acquiredCount),
      sessionId: o.sessionId,
      primaryObservationId: o.primaryObservationId,
      createdAt: iso(o.createdAt),
    })),
    allowAutofocus: exo.allowAutofocus,
    allowRecenter: exo.allowRecenter,
    defocusHint: exo.defocusHint,
    lockMode: mode,
    lockBlockedReason: blocked,
    openCount: open.length,
    maxOpen: admin ? null : settings.exoUserMaxOpenLocks,
    suggestedEpoch: suggested?.item.transit.n ?? null,
  };
}
