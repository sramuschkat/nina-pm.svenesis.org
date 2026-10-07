/**
 * Jobs `multi_sim` und `impact` (AP-32a; FA-SIM-04, FA-FRG-05; TK 7.4): Mehrnacht-Simulation eines Rigs bzw.
 * Auswirkungsvorschau eines eingereichten Objekts (14 Nächte mit und ohne es auf dem Wunsch-Rig). Rechnung
 * in `simulateNights` (shared, rein); das Ergebnis geht als JSON nach S3 `tenant/<tid>/jobs/<jobId>.json`.
 */
import {
  applyChangeRequest,
  ImpactInput,
  impactComparison,
  MAX_MULTI_SIM_NIGHTS,
  MultiSimInput,
  ProblemError,
  simulateNights,
  type ImpactResult,
  type JobResult,
  type NightTransit,
  type MultiSimResult,
  type NightWeather,
  type PlanMoonProfileSource,
  type ProjectView,
  type RigView,
  type SiteNightsView,
  type StoredChangeRequestProposal,
} from '@nina-pm/shared';
import { daysFromKey, keyFromDays } from '@nina-pm/engine';
import type { z } from 'zod';
import { isoUtc } from '../lib/format';
import { logger } from '../lib/logger';
import type { JobHandler } from './jobs';

type Project = z.infer<typeof ProjectView>;
type Rig = z.infer<typeof RigView>;
type Nights = z.infer<typeof SiteNightsView>;

export interface SimSite {
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly elevationM: number;
  readonly timeZone: string;
}

export interface RigContext {
  readonly rig: Rig;
  readonly site: SimSite & { readonly id: string };
  /** Alle nicht gelöschten Projekte mit diesem Rig als Rig oder Wunsch-Rig. */
  readonly projects: readonly Project[];
  readonly moonProfiles: readonly PlanMoonProfileSource[];
}

export interface MultiSimDeps {
  loadRig(tenantId: string, rigId: string): Promise<RigContext | null>;
  loadProject(tenantId: string, projectId: string): Promise<Project | null>;
  /** Offener Änderungsantrag mit aktueller Projektfassung (AP-32b); `null`, wenn keiner. */
  loadChangeRequest(
    tenantId: string,
    id: string,
  ): Promise<{ project: Project; proposal: StoredChangeRequestProposal } | null>;
  /** Nacht-Tabelle des Standorts ab `from` (bzw. um jetzt) mit `count` Nächten. */
  nights(site: SimSite, now: Date, from: string | undefined, count: number): Nights;
  /** Nachtbewertung aus dem Wetter-Cache des Standorts (leer ohne Vorhersage). */
  weather(site: SimSite & { readonly id: string }, now: Date): Promise<Map<string, NightWeather>>;
  putResult(tenantId: string, jobId: string, result: JobResult): Promise<string>;
  /**
   * Festgelegte Transits des Rigs in diesen Nächten (wie `POST /plan`, 07.10.2026); ohne Angabe keine – dann fehlen
   * Exoplaneten-Projekte in der Rechnung.
   */
  transits?(
    tenantId: string,
    rigId: string,
    nights: readonly string[],
    now: Date,
  ): Promise<NightTransit[]>;
}

/** Nacht-Schlüssel `from` … `from + count − 1`. */
export const nightKeys = (from: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => keyFromDays(daysFromKey(from) + i));

const plannable = (rigId: string, p: Project) =>
  p.rigId === rigId && p.approvalStatus === 'approved' && p.status === 'active';

/** Eigene Vorschau-Objekte (FK 6.14): Entwürfe, Eingereichte, Zurückgegebene des Auslösers. */
const ownPreview = (memberId: string, p: Project) =>
  p.createdBy === memberId && ['draft', 'submitted', 'returned'].includes(p.approvalStatus);

export function multiSimJobHandler(deps: MultiSimDeps): JobHandler {
  return async ({ job, now }) => {
    if (!job.tenantId) throw new Error('multi_sim ohne Mandant');
    const input = MultiSimInput.parse(job.input);
    const ctx = await deps.loadRig(job.tenantId, input.rigId);
    if (!ctx) throw new ProblemError('resource.not_found');
    const at = now();
    const projects = ctx.projects.filter(
      (p) =>
        plannable(ctx.rig.id, p) ||
        (input.includeOwnDrafts && job.createdBy !== null && ownPreview(job.createdBy, p)),
    );
    const table = deps.nights(ctx.site, at, input.nightFrom, input.nights + 1);
    const weather = input.weather ? await deps.weather(ctx.site, at) : null;
    const transits =
      (await deps.transits?.(
        job.tenantId,
        ctx.rig.id,
        nightKeys(input.nightFrom, input.nights),
        at,
      )) ?? [];
    const sim = simulateNights({
      rig: ctx.rig,
      projects,
      moonProfiles: ctx.moonProfiles,
      nightsTable: table,
      site: ctx.site,
      nightFrom: input.nightFrom,
      count: input.nights,
      weather,
      transits,
    });
    const result: MultiSimResult = {
      kind: 'multi_sim',
      rigId: ctx.rig.id,
      rigName: ctx.rig.name,
      siteTimeZone: ctx.site.timeZone,
      nightFrom: input.nightFrom,
      nightCount: input.nights,
      weather: input.weather,
      computedAt: isoUtc(at),
      nights: sim.nights,
      projects: sim.projects,
    };
    const key = await deps.putResult(job.tenantId, job.id, result);
    logger.info('multi_sim', { jobId: job.id, nights: input.nights, projects: projects.length });
    return { resultS3Key: key };
  };
}

export function impactJobHandler(deps: MultiSimDeps): JobHandler {
  return async ({ job, now }) => {
    if (!job.tenantId) throw new Error('impact ohne Mandant');
    const input = ImpactInput.parse(job.input);
    // Änderungsantrag (AP-32b): aktuelle Fassung gegen „mit Antrag“; sonst eingereichtes Objekt.
    const request = await deps.loadChangeRequest(job.tenantId, input.queueItemId);
    const target = request?.project ?? (await deps.loadProject(job.tenantId, input.queueItemId));
    if (!target) throw new ProblemError('resource.not_found');
    // In der Sicht ist `rigId` bis zur Freigabe das Wunsch-Rig (`projectView`).
    const rigId = target.rigId;
    if (!rigId)
      throw new ProblemError('validation.failed', [
        { path: 'requestedRigId', message: 'ohne Rig-Wunsch keine Auswirkungsvorschau' },
      ]);
    const ctx = await deps.loadRig(job.tenantId, rigId);
    if (!ctx) throw new ProblemError('resource.not_found');
    const at = now();
    const others = ctx.projects.filter((p) => p.id !== target.id && plannable(rigId, p));
    const table = deps.nights(ctx.site, at, undefined, MAX_MULTI_SIM_NIGHTS + 2);
    const base = {
      rig: ctx.rig,
      moonProfiles: ctx.moonProfiles,
      nightsTable: table,
      site: ctx.site,
      nightFrom: table.currentNight,
      count: MAX_MULTI_SIM_NIGHTS,
      transits:
        (await deps.transits?.(
          job.tenantId,
          ctx.rig.id,
          nightKeys(table.currentNight, MAX_MULTI_SIM_NIGHTS),
          at,
        )) ?? [],
    };
    // Das Objekt wie nach der Freigabe: auf dem Wunsch-Rig, am Ende der Priorität (FA-FRG-06).
    const lowest = Math.max(0, ...others.map((p) => p.priority)) + 1;
    const asApproved: Project = request
      ? applyChangeRequest(target, request.proposal)
      : { ...target, rigId, priority: lowest };
    const current = request && plannable(rigId, target) ? [target] : [];
    const without = simulateNights({ ...base, projects: [...others, ...current] });
    const withTarget = simulateNights({ ...base, projects: [...others, asApproved] });
    const result: ImpactResult = {
      kind: 'impact',
      queueItemId: input.queueItemId,
      projectId: target.id,
      projectName: target.name,
      rigId,
      rigName: ctx.rig.name,
      nightFrom: table.currentNight,
      nightCount: MAX_MULTI_SIM_NIGHTS,
      computedAt: isoUtc(at),
      ...impactComparison(without, withTarget, target.id),
    };
    const key = await deps.putResult(job.tenantId, job.id, result);
    logger.info('impact', { jobId: job.id, projectId: target.id, others: others.length });
    return { resultS3Key: key };
  };
}

/** Schlüssel des Ergebnisses (TK 7.4): nur unter `tenant/<tid>/jobs/` (iam.md: `tenant/*`). */
export const jobResultKey = (tenantId: string, jobId: string) =>
  `tenant/${tenantId}/jobs/${jobId}.json`;
