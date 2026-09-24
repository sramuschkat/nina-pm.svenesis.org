/**
 * Mitglieder, Einladungen, Rollen und Owner (TK 5.5, 7.2; FA-BEN-01…10, E2, SEC-50).
 * Reihenfolge der Prüfungen im Repository: eigene Rolle (`409 member.cannot_change_self`) → Owner
 * (`409 member.owner_protected`) → Berechtigung mit Zielobjekt (`403 permission.denied`).
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import type { MemberRepository, TargetCheck } from '@nina-pm/db';
import {
  can,
  CreateSingleUseInvitationRequest,
  CreateUserInvitationRequest,
  InvitationCreated,
  InvitationView,
  MemberPatch,
  MemberView,
  OwnerTransferRequest,
  ProblemError,
  RoleChangeRequest,
  Uuid,
  type AuthContext,
} from '@nina-pm/shared';
import type { Context } from 'hono';
import type { ApiEnv } from '../lib/env';
import { invitationLink, isoUtc, isoUtcOrNull } from '../lib/format';
import { defineRoute, problemContent } from './define';
import type { ApiServices } from './services';
import { requireTenant } from './tenant';

const idParam = z.object({ id: Uuid });
const denied = () => new ProblemError('permission.denied');
const errors = {
  401: problemContent('Nicht angemeldet'),
  403: problemContent('Keine Berechtigung'),
  404: problemContent('resource.not_found'),
  409: problemContent(
    'member.owner_protected, member.cannot_change_self, member.owner_cannot_leave',
  ),
};

/** Admins bearbeiten nur Mitglieder mit Rolle User, Admins nur der Owner (FA-BEN-02, FA-BEN-08). */
const memberCheck =
  (auth: AuthContext): TargetCheck =>
  (target) => {
    if (!can(auth, target.targetRole === 'admin' ? 'member.admin.manage' : 'member.manage', target))
      throw denied();
  };

/** Rollen vergibt und entzieht nur der Owner (E2). */
const roleCheck =
  (auth: AuthContext): TargetCheck =>
  (target) => {
    if (!can(auth, 'member.admin.manage', target)) throw denied();
  };

async function members(
  services: () => Promise<ApiServices>,
  c: Context<ApiEnv>,
): Promise<{ repo: MemberRepository; auth: AuthContext; svc: ApiServices }> {
  const svc = await services();
  const { auth, tenant } = requireTenant(c);
  return { repo: svc.repositories(tenant).member, auth, svc };
}

export const listMembersRoute = defineRoute(
  { action: 'member.manage', requirements: ['FA-BEN-04'] },
  {
    method: 'get',
    path: '/api/web/v1/members',
    summary: 'Mitgliederliste',
    tags: ['members'],
    responses: {
      200: {
        description: 'Mitglieder',
        content: { 'application/json': { schema: z.object({ members: z.array(MemberView) }) } },
      },
      401: errors[401],
      403: errors[403],
    },
  },
);

export const patchMemberRoute = defineRoute(
  { action: 'member.manage', requirements: ['FA-BEN-02', 'FA-BEN-08'] },
  {
    method: 'patch',
    path: '/api/web/v1/members/{id}',
    summary: 'Anzeigename bzw. Status (aktiv/deaktiviert) ändern',
    tags: ['members'],
    request: {
      params: idParam,
      body: { content: { 'application/json': { schema: MemberPatch } }, required: true },
    },
    responses: { 204: { description: 'Geändert' }, ...errors },
  },
);

export const deleteMemberRoute = defineRoute(
  { action: 'member.manage', requirements: ['FA-BEN-02', 'FA-BEN-08'] },
  {
    method: 'delete',
    path: '/api/web/v1/members/{id}',
    summary: 'Mitglied entfernen',
    tags: ['members'],
    request: { params: idParam },
    responses: { 204: { description: 'Entfernt' }, ...errors },
  },
);

export const roleRoute = defineRoute(
  // Route-Aktion member.manage, damit ein Admin auf den Owner `409 member.owner_protected` erhält
  // (Brief AP-04b); die Rollenänderung selbst verlangt member.admin.manage (nur Owner, E2).
  { action: 'member.manage', requirements: ['FA-BEN-06', 'FA-BEN-08', 'E2'] },
  {
    method: 'put',
    path: '/api/web/v1/members/{id}/role',
    summary: 'Admin ernennen oder entziehen (nur Owner)',
    tags: ['members'],
    request: {
      params: idParam,
      body: { content: { 'application/json': { schema: RoleChangeRequest } }, required: true },
    },
    responses: { 204: { description: 'Geändert' }, ...errors },
  },
);

export const memberSessionsRoute = defineRoute(
  { action: 'member.manage', requirements: ['TK 5.3', 'FA-BEN-08'] },
  {
    method: 'delete',
    path: '/api/web/v1/members/{id}/sessions',
    summary: 'Anmeldesitzungen eines Mitglieds in diesem Mandanten beenden (nie für den Owner)',
    tags: ['members'],
    request: { params: idParam },
    responses: { 204: { description: 'Beendet' }, ...errors },
  },
);

export const leaveRoute = defineRoute(
  { action: 'member.leave', requirements: ['FA-BEN-10'] },
  {
    method: 'post',
    path: '/api/web/v1/me/leave',
    summary: 'Mandant verlassen (nicht für den Owner)',
    tags: ['members'],
    responses: {
      204: { description: 'Verlassen' },
      401: errors[401],
      403: errors[403],
      409: errors[409],
    },
  },
);

export const ownerTransferRoute = defineRoute(
  { action: 'tenant.owner.transfer', requirements: ['FA-BEN-09', 'E2'] },
  {
    method: 'post',
    path: '/api/web/v1/tenant/owner-transfer',
    summary: 'Owner sofort an einen aktiven Admin übertragen',
    tags: ['members'],
    request: {
      body: { content: { 'application/json': { schema: OwnerTransferRequest } }, required: true },
    },
    responses: {
      204: { description: 'Übertragen' },
      401: errors[401],
      403: errors[403],
      422: problemContent('owner_transfer.target_invalid'),
    },
  },
);

export const createInvitationRoute = defineRoute(
  { action: 'member.manage', requirements: ['FA-BEN-01', 'SEC-50'] },
  {
    method: 'post',
    path: '/api/web/v1/invitations',
    summary: 'User-Einladung (Rolle fest `user`)',
    tags: ['invitations'],
    request: {
      body: {
        content: { 'application/json': { schema: CreateUserInvitationRequest } },
        required: true,
      },
    },
    responses: {
      201: {
        description: 'Einladung (Link nur einmal)',
        content: { 'application/json': { schema: InvitationCreated } },
      },
      401: errors[401],
      403: errors[403],
      409: problemContent('resource.in_use'),
    },
  },
);

export const createAdminInvitationRoute = defineRoute(
  { action: 'member.admin.manage', requirements: ['FA-BEN-01', 'FA-BEN-06', 'SEC-50'] },
  {
    method: 'post',
    path: '/api/web/v1/invitations/admin',
    summary: 'Admin-Einladung (nur Owner, eine Nutzung)',
    tags: ['invitations'],
    request: {
      body: {
        content: { 'application/json': { schema: CreateSingleUseInvitationRequest } },
        required: true,
      },
    },
    responses: {
      201: {
        description: 'Einladung (Link nur einmal)',
        content: { 'application/json': { schema: InvitationCreated } },
      },
      401: errors[401],
      403: errors[403],
      409: problemContent('resource.in_use'),
    },
  },
);

export const listInvitationsRoute = defineRoute(
  { action: 'member.manage', requirements: ['FA-BEN-01', 'FA-BEN-04'] },
  {
    method: 'get',
    path: '/api/web/v1/invitations',
    summary: 'Einladungen des Mandanten',
    tags: ['invitations'],
    responses: {
      200: {
        description: 'Einladungen',
        content: {
          'application/json': { schema: z.object({ invitations: z.array(InvitationView) }) },
        },
      },
      401: errors[401],
      403: errors[403],
    },
  },
);

export const revokeInvitationRoute = defineRoute(
  { action: 'member.manage', requirements: ['FA-BEN-01', 'FA-BEN-08'] },
  {
    method: 'delete',
    path: '/api/web/v1/invitations/{id}',
    summary: 'Einladung widerrufen (Einladungen des Owners nur durch den Owner)',
    tags: ['invitations'],
    request: { params: idParam },
    responses: {
      204: { description: 'Widerrufen' },
      401: errors[401],
      403: errors[403],
      404: errors[404],
    },
  },
);

export const MEMBER_ROUTES = [
  listMembersRoute,
  patchMemberRoute,
  deleteMemberRoute,
  roleRoute,
  memberSessionsRoute,
  leaveRoute,
  ownerTransferRoute,
  createInvitationRoute,
  createAdminInvitationRoute,
  listInvitationsRoute,
  revokeInvitationRoute,
] as const;

export function webMemberRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();

  app.openapi(listMembersRoute, async (c) => {
    const { repo } = await members(services, c);
    const rows = await repo.list();
    return c.json(
      {
        members: rows.map((m) => ({
          id: m.id,
          displayName: m.displayName,
          discordUsername: m.discordUsername,
          avatarHash: m.avatarHash,
          role: m.isOwner ? ('owner' as const) : m.role,
          status: m.status,
          mfa: m.mfaEnabled,
          rightsDormant: m.role === 'admin' && !m.mfaEnabled,
          lastLoginAt: isoUtcOrNull(m.lastLoginAt),
        })),
      },
      200,
    );
  });

  app.openapi(patchMemberRoute, async (c) => {
    const { repo, auth, svc } = await members(services, c);
    await repo.updateMember(
      c.req.valid('param').id,
      c.req.valid('json'),
      memberCheck(auth),
      svc.now(),
    );
    return c.body(null, 204);
  });

  app.openapi(deleteMemberRoute, async (c) => {
    const { repo, auth, svc } = await members(services, c);
    await repo.removeMember(c.req.valid('param').id, memberCheck(auth), svc.now());
    return c.body(null, 204);
  });

  app.openapi(roleRoute, async (c) => {
    const { repo, auth, svc } = await members(services, c);
    const { role, reason } = c.req.valid('json');
    await repo.changeRole(c.req.valid('param').id, role, reason, roleCheck(auth), svc.now());
    return c.body(null, 204);
  });

  app.openapi(memberSessionsRoute, async (c) => {
    const { repo, auth } = await members(services, c);
    const id = c.req.valid('param').id;
    await repo.revokeSessions(id, id === auth.memberId ? () => undefined : memberCheck(auth));
    return c.body(null, 204);
  });

  app.openapi(leaveRoute, async (c) => {
    const { repo, svc } = await members(services, c);
    await repo.leave(svc.now());
    return c.body(null, 204);
  });

  app.openapi(ownerTransferRoute, async (c) => {
    const { repo, auth, svc } = await members(services, c);
    const { memberId } = c.req.valid('json');
    if (!can(auth, 'tenant.owner.transfer', { targetMemberId: memberId }))
      throw new ProblemError('owner_transfer.target_invalid');
    await repo.transferOwner(memberId, svc.now());
    return c.body(null, 204);
  });

  const created = (
    svc: ApiServices,
    inv: { id: string; role: 'owner' | 'admin' | 'user'; token: string; expiresAt: Date },
  ) => ({
    id: inv.id,
    role: inv.role,
    link: invitationLink(new URL(svc.authConfig.redirectUri).origin, inv.token),
    expiresAt: isoUtc(inv.expiresAt),
  });

  app.openapi(createInvitationRoute, async (c) => {
    const { repo, svc } = await members(services, c);
    const body = c.req.valid('json');
    const inv = await repo.createInvitation({ ...body, role: 'user' }, svc.now());
    c.header('cache-control', 'no-store');
    return c.json(created(svc, inv), 201);
  });

  app.openapi(createAdminInvitationRoute, async (c) => {
    const { repo, svc } = await members(services, c);
    const body = c.req.valid('json');
    const inv = await repo.createInvitation({ ...body, role: 'admin' }, svc.now());
    c.header('cache-control', 'no-store');
    return c.json(created(svc, inv), 201);
  });

  app.openapi(listInvitationsRoute, async (c) => {
    const { repo } = await members(services, c);
    const rows = await repo.listInvitations();
    return c.json(
      {
        invitations: rows.map((i) => ({
          id: i.id,
          role: i.role,
          discordUserId: i.discordUserId,
          note: i.note,
          maxUses: i.maxUses,
          usedCount: i.usedCount,
          expiresAt: isoUtc(i.expiresAt),
          revokedAt: isoUtcOrNull(i.revokedAt),
          createdAt: isoUtc(i.createdAt),
          ownerOnly: i.ownerOnly,
        })),
      },
      200,
    );
  });

  app.openapi(revokeInvitationRoute, async (c) => {
    const { repo, svc } = await members(services, c);
    await repo.revokeInvitation(c.req.valid('param').id, svc.now());
    return c.body(null, 204);
  });

  return app;
}
