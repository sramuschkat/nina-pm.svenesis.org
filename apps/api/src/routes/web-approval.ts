/**
 * Freigabe-Workflow (AP-12a; TK 7.2 „Warteschlange“, „Freigabe“, „Entwürfe“; FA-FRG-01…16): Einreichen,
 * Zurückziehen, Freigeben, Zurückgeben, Ablehnen (jeweils `If-Match`), Stimmen, Rangfolge des
 * Einreichers, Warteschlange für alle Mitglieder und Entwürfe für Admins. Die Routen-Aktion prüft die
 * Rolle; die Entscheidung mit dem Objekt (eigene Entwürfe, Freigabestatus) fällt im Handler mit `can`,
 * fachliche Regeln (eigene Stimme, geschlossene Abstimmung, eigene Objekte) im Repository.
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import type { QueueEntry } from '@nina-pm/db';
import {
  ApproveInput,
  can,
  DecisionComment,
  ProblemError,
  ProjectListItem,
  ProjectView,
  QueueItem,
  QueueKind,
  QueueVotes,
  SubmissionRanking,
  SubmitInput,
  suggestPriorityPosition,
  Uuid,
  type Action,
  type AuthContext,
} from '@nina-pm/shared';
import type { Context } from 'hono';
import type { ApiEnv } from '../lib/env';
import { isoUtcOrNull } from '../lib/format';
import { defineRoute, problemContent } from './define';
import type { ApiServices } from './services';
import { requireTenant } from './tenant';
import { scheduleProjectJobs } from './effort-trigger';
import { effortView, listItem, projectView } from './web-projects';

const BASE = '/api/web/v1';
const idParam = z.object({ id: Uuid });
const voteParam = z.object({ kind: QueueKind, id: Uuid });
const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });
const errors = {
  401: problemContent('Nicht angemeldet'),
  403: problemContent('Keine Berechtigung'),
  404: problemContent('resource.not_found'),
  422: problemContent('validation.failed'),
};
const ifMatch = z.object({
  'if-match': z
    .string()
    .optional()
    .meta({ description: '`version` des Projekts; abweichend → 412' }),
});
const decisionResponses = {
  200: { description: 'Neuer Stand', ...json(ProjectView) },
  ...errors,
  409: problemContent('approval.not_allowed / approval.own_object / approval.rig_conflict'),
  412: problemContent('resource.version_conflict'),
};

// ---- Routen ---------------------------------------------------------------------------------------

export const submitRoute = defineRoute(
  { action: 'project.submit', requirements: ['FA-FRG-02', 'FA-FRG-15', 'FA-PRJ-01'] },
  {
    method: 'post',
    path: `${BASE}/projects/{id}/submit`,
    summary: 'Einreichen (Pflichtprüfung, Wunschangaben, ans Ende der eigenen Rangfolge)',
    tags: ['approval'],
    request: { params: idParam, headers: ifMatch, body: { ...json(SubmitInput), required: true } },
    responses: decisionResponses,
  },
);

export const withdrawRoute = defineRoute(
  { action: 'project.withdraw', requirements: ['FA-FRG-03', 'FA-FRG-15'] },
  {
    method: 'post',
    path: `${BASE}/projects/{id}/withdraw`,
    summary: 'Einreichung zurückziehen → Entwurf',
    tags: ['approval'],
    request: { params: idParam, headers: ifMatch },
    responses: decisionResponses,
  },
);

export const approveRoute = defineRoute(
  { action: 'queue.decide', requirements: ['FA-FRG-06', 'FA-FRG-10', 'FA-FRG-14', 'FA-RIG-12'] },
  {
    method: 'post',
    path: `${BASE}/projects/{id}/approve`,
    summary: 'Freigeben mit Rig, Position je Rig, Projektstatus, Terminen',
    tags: ['approval'],
    request: { params: idParam, headers: ifMatch, body: { ...json(ApproveInput), required: true } },
    responses: decisionResponses,
  },
);

export const returnRoute = defineRoute(
  { action: 'queue.decide', requirements: ['FA-FRG-07', 'FA-FRG-14'] },
  {
    method: 'post',
    path: `${BASE}/projects/{id}/return`,
    summary: 'Zurückgeben mit Pflichtkommentar → Zurückgegeben',
    tags: ['approval'],
    request: {
      params: idParam,
      headers: ifMatch,
      body: { ...json(DecisionComment), required: true },
    },
    responses: decisionResponses,
  },
);

export const rejectRoute = defineRoute(
  { action: 'queue.decide', requirements: ['FA-FRG-07', 'FA-FRG-14'] },
  {
    method: 'post',
    path: `${BASE}/projects/{id}/reject`,
    summary: 'Ablehnen mit Pflichtkommentar → Abgelehnt (endgültig)',
    tags: ['approval'],
    request: {
      params: idParam,
      headers: ifMatch,
      body: { ...json(DecisionComment), required: true },
    },
    responses: decisionResponses,
  },
);

export const queueRoute = defineRoute(
  { action: 'queue.read', requirements: ['FA-FRG-04', 'FA-FRG-14', 'FA-FRG-16'] },
  {
    method: 'get',
    path: `${BASE}/queue`,
    summary: 'Warteschlange: eingereichte Objekte mit Stimmen, Rang, Plan-Chips',
    tags: ['approval'],
    responses: {
      200: { description: 'Warteschlange', ...json(z.object({ items: z.array(QueueItem) })) },
      401: errors[401],
      403: errors[403],
    },
  },
);

export const voteRoute = defineRoute(
  { action: 'queue.vote', requirements: ['FA-FRG-14'] },
  {
    method: 'put',
    path: `${BASE}/queue/{kind}/{id}/vote`,
    summary: 'Stimme abgeben (nicht für eigene, nur solange eingereicht)',
    tags: ['approval'],
    request: { params: voteParam },
    responses: {
      200: { description: 'Stimmen', ...json(QueueVotes) },
      ...errors,
      409: problemContent('vote.own_object / vote.closed'),
    },
  },
);

export const unvoteRoute = defineRoute(
  { action: 'queue.vote', requirements: ['FA-FRG-14'] },
  {
    method: 'delete',
    path: `${BASE}/queue/{kind}/{id}/vote`,
    summary: 'Stimme zurücknehmen',
    tags: ['approval'],
    request: { params: voteParam },
    responses: {
      200: { description: 'Stimmen', ...json(QueueVotes) },
      ...errors,
      409: problemContent('vote.own_object / vote.closed'),
    },
  },
);

export const acknowledgeRoute = defineRoute(
  { action: 'queue.vote', requirements: ['FA-FRG-14'] },
  {
    method: 'post',
    path: `${BASE}/queue/{kind}/{id}/vote/acknowledge`,
    summary: 'Hinweis „geändert seit deiner Stimme“ quittieren',
    tags: ['approval'],
    request: { params: voteParam },
    responses: { 204: { description: 'Quittiert' }, ...errors },
  },
);

export const rankingRoute = defineRoute(
  { action: 'project.rank', requirements: ['FA-FRG-15'] },
  {
    method: 'put',
    path: `${BASE}/me/submission-ranking`,
    summary: 'Rangfolge der eigenen offenen Gegenstände (vollständige Liste, sonst 422)',
    tags: ['approval'],
    request: { body: { ...json(SubmissionRanking), required: true } },
    responses: {
      204: { description: 'Gespeichert' },
      ...errors,
      422: problemContent('ranking.incomplete / validation.failed'),
    },
  },
);

export const draftsRoute = defineRoute(
  { action: 'queue.decide', requirements: ['FA-BER-02'] },
  {
    method: 'get',
    path: `${BASE}/drafts`,
    summary: 'Entwürfe und zurückgegebene Objekte aller Mitglieder (S-34)',
    tags: ['approval'],
    responses: {
      200: { description: 'Entwürfe', ...json(z.object({ items: z.array(ProjectListItem) })) },
      401: errors[401],
      403: errors[403],
    },
  },
);

export const APPROVAL_ROUTES = [
  submitRoute,
  withdrawRoute,
  approveRoute,
  returnRoute,
  rejectRoute,
  queueRoute,
  voteRoute,
  unvoteRoute,
  acknowledgeRoute,
  rankingRoute,
  draftsRoute,
] as const;

// ---- Ansichten ------------------------------------------------------------------------------------

function queueItem(
  e: QueueEntry,
  suggestedPriorityPosition: number | null,
): z.output<typeof QueueItem> {
  const p = e.detail.project;
  const active = e.detail.panels.flatMap((panel) => panel.lines).filter((l) => l.enabled);
  return {
    kind: 'project',
    id: p.id,
    projectId: p.id,
    name: p.name,
    projectType: p.projectType,
    targetName: p.targetName,
    targetType: p.targetType,
    createdBy: p.createdBy,
    createdByName: e.createdByName,
    submittedAt: e.submittedAt ? e.submittedAt.toISOString() : null,
    expiresAt: e.expiresAt ? e.expiresAt.toISOString() : null,
    requestedRigId: p.requestedRigId ?? p.rigId,
    target: p.raDeg !== null && p.decDeg !== null ? { raDeg: p.raDeg, decDeg: p.decDeg } : null,
    conditions: {
      minAltitudeDeg: p.minAltitudeDeg,
      minTimeOnTargetH: p.minTimeOnTargetH,
      twilight: p.twilight as 'astronomical' | 'nautical' | 'civil',
    },
    startDate: p.startDate,
    requestPeriodFrom: p.requestPeriodFrom,
    requestPeriodTo: p.requestPeriodTo,
    requestComment: p.requestComment,
    contentChangedAt: isoUtcOrNull(p.contentChangedAt),
    votes: e.votes,
    submitterRank: e.rank,
    planSummary: active.map((l) => ({
      filterId: l.filterId,
      filterShortName: l.filterShortName,
      count: l.plannedCount,
      exposureS: l.exposureS,
      gain: l.gain,
      offset: l.offsetAdu,
      binning: l.binning,
      readoutMode: l.readoutMode,
      moonMode: l.moonMode as 'profile' | 'project_default' | 'none',
      moonProfileId: l.moonProfileId,
    })),
    panelCount: e.detail.panels.length,
    estimatedHours: active.reduce((s, l) => s + l.plannedCount * l.exposureS, 0) / 3600,
    effort: effortView(p),
    suggestedPriorityPosition,
    version: p.version,
  };
}

// ---- Handler --------------------------------------------------------------------------------------

function expectedVersion(header: string | undefined): number | undefined {
  if (header === undefined) return undefined;
  const m = /^(?:W\/)?"?(\d+)"?$/.exec(header.trim());
  if (!m) throw new ProblemError('resource.version_conflict');
  return Number(m[1]);
}

export function webApprovalRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();

  const ctx = async (c: Context<ApiEnv>) => {
    const svc = await services();
    const { auth, tenant } = requireTenant(c);
    const repos = svc.repositories(tenant);
    return {
      svc,
      auth,
      projects: repos.projects(),
      approvals: repos.approvals(),
      /** Aufwand-Kennzeichen nach Einreichen/Freigeben neu rechnen (Job `effort`, AP-13e). */
      effort: (projectId: string) => scheduleProjectJobs(svc, repos, projectId),
    };
  };

  /** Objekt laden und Aktion mit dem Objekt prüfen (wie Projekte): fremde/gelöschte → 404, fehlendes Recht → 403. */
  const authorized = async (
    c: Awaited<ReturnType<typeof ctx>>,
    auth: AuthContext,
    id: string,
    action: Action,
  ) => {
    const meta = await c.projects.meta(id);
    if (!meta) throw new ProblemError('resource.not_found');
    const res = {
      tenantId: auth.tenantId ?? undefined,
      createdBy: meta.createdBy,
      approvalStatus: meta.approvalStatus as never,
    };
    // Eigene Objekte entscheidet das Repository: Freigabe `approval.own_object` (FA-FRG-10), Stimme
    // `vote.own_object` (FA-FRG-14) – fachliche 409 statt 403.
    const own = meta.createdBy === auth.memberId;
    const repoDecides = own && (action === 'queue.decide' || action === 'queue.vote');
    if (!repoDecides && !can(auth, action, res)) throw new ProblemError('permission.denied');
    return meta;
  };

  app.openapi(submitRoute, async (c) => {
    const x = await ctx(c);
    const { id } = c.req.valid('param');
    await authorized(x, x.auth, id, 'project.submit');
    const d = await x.approvals.submit(
      id,
      c.req.valid('json'),
      x.svc.now(),
      expectedVersion(c.req.valid('header')['if-match']),
    );
    await x.effort(id);
    return c.json(projectView(d), 200);
  });

  app.openapi(withdrawRoute, async (c) => {
    const x = await ctx(c);
    const { id } = c.req.valid('param');
    await authorized(x, x.auth, id, 'project.withdraw');
    const d = await x.approvals.withdraw(
      id,
      x.svc.now(),
      expectedVersion(c.req.valid('header')['if-match']),
    );
    return c.json(projectView(d), 200);
  });

  app.openapi(approveRoute, async (c) => {
    const x = await ctx(c);
    const { id } = c.req.valid('param');
    await authorized(x, x.auth, id, 'queue.decide');
    const d = await x.approvals.approve(
      id,
      c.req.valid('json'),
      x.svc.now(),
      expectedVersion(c.req.valid('header')['if-match']),
    );
    await x.effort(id);
    return c.json(projectView(d), 200);
  });

  app.openapi(returnRoute, async (c) => {
    const x = await ctx(c);
    const { id } = c.req.valid('param');
    await authorized(x, x.auth, id, 'queue.decide');
    const d = await x.approvals.returnToUser(
      id,
      c.req.valid('json').comment,
      x.svc.now(),
      expectedVersion(c.req.valid('header')['if-match']),
    );
    return c.json(projectView(d), 200);
  });

  app.openapi(rejectRoute, async (c) => {
    const x = await ctx(c);
    const { id } = c.req.valid('param');
    await authorized(x, x.auth, id, 'queue.decide');
    const d = await x.approvals.reject(
      id,
      c.req.valid('json').comment,
      x.svc.now(),
      expectedVersion(c.req.valid('header')['if-match']),
    );
    return c.json(projectView(d), 200);
  });

  app.openapi(queueRoute, async (c) => {
    const x = await ctx(c);
    const entries = await x.approvals.queue();
    // Einfügeposition nur für Admins (FA-FRG-16): je Wunsch-Rig die freigegebenen Projekte mit Endstand.
    const admin = can(x.auth, 'queue.decide');
    const peers = admin
      ? await x.approvals.rigPriorityVotes(
          entries.flatMap((e) => {
            const rig = e.detail.project.requestedRigId ?? e.detail.project.rigId;
            return rig ? [rig] : [];
          }),
        )
      : new Map<string, { projectId: string; votes: number }[]>();
    c.header('cache-control', 'no-store');
    return c.json(
      {
        items: entries.map((e) => {
          const rig = e.detail.project.requestedRigId ?? e.detail.project.rigId;
          return queueItem(
            e,
            admin && rig ? suggestPriorityPosition(e.votes.count, peers.get(rig) ?? []) : null,
          );
        }),
      },
      200,
    );
  });

  const voteSubject = async (x: Awaited<ReturnType<typeof ctx>>, kind: string, id: string) => {
    // Änderungsanträge folgen mit R3; bis dahin existiert kein solcher Gegenstand.
    if (kind !== 'project') throw new ProblemError('resource.not_found');
    await authorized(x, x.auth, id, 'queue.vote');
  };

  app.openapi(voteRoute, async (c) => {
    const x = await ctx(c);
    const { kind, id } = c.req.valid('param');
    await voteSubject(x, kind, id);
    return c.json(await x.approvals.vote(id, true, x.svc.now()), 200);
  });

  app.openapi(unvoteRoute, async (c) => {
    const x = await ctx(c);
    const { kind, id } = c.req.valid('param');
    await voteSubject(x, kind, id);
    return c.json(await x.approvals.vote(id, false, x.svc.now()), 200);
  });

  app.openapi(acknowledgeRoute, async (c) => {
    const x = await ctx(c);
    const { kind, id } = c.req.valid('param');
    await voteSubject(x, kind, id);
    await x.approvals.acknowledge(id, x.svc.now());
    return c.body(null, 204);
  });

  app.openapi(rankingRoute, async (c) => {
    const x = await ctx(c);
    await x.approvals.setRanking(c.req.valid('json'), x.svc.now());
    return c.body(null, 204);
  });

  app.openapi(draftsRoute, async (c) => {
    const x = await ctx(c);
    c.header('cache-control', 'no-store');
    return c.json({ items: (await x.approvals.drafts()).map(listItem) }, 200);
  });

  return app;
}
