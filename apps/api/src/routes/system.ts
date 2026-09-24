/**
 * Systemverwaltung unter `/api/system/v1` (Super User im System-Kontext mit 2FA; TK 5.4, 5.5, 7.2;
 * FA-SU-01…09, FA-MAN-01/02). Kein fachlicher Zugriff auf Mandanteninhalte (FA-SU-07).
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import {
  AddSuperUserRequest,
  CreateSingleUseInvitationRequest,
  CreateTenantRequest,
  IdentityStatusPatch,
  InvitationCreated,
  OwnerReassignRequest,
  ProblemError,
  SuperUserPatch,
  SuperUserView,
  SystemMemberView,
  TenantAdminView,
  TenantStatusPatch,
  Uuid,
} from '@nina-pm/shared';
import type { Context } from 'hono';
import type { ApiEnv } from '../lib/env';
import { invitationLink, isoUtc } from '../lib/format';
import { defineRoute, problemContent } from './define';
import type { ApiServices } from './services';

const idParam = z.object({ id: Uuid });
const common = {
  401: problemContent('Nicht angemeldet'),
  403: problemContent('Kein System-Kontext'),
};
const REQ = ['TK 5.4', 'FA-SU-04'];

function admin(services: ApiServices, c: Context<ApiEnv>) {
  const auth = c.get('auth');
  if (!auth || auth.ctx !== 'system') throw new ProblemError('permission.denied');
  return services.tenantAdmin({ kind: 'super_user', identityId: auth.identityId });
}

const tenantView = (t: {
  id: string;
  tenantKey: string;
  displayName: string;
  contact: string | null;
  status: 'active' | 'locked';
  ownerMemberId: string | null;
  createdAt: Date;
  admins?: number;
  users?: number;
}) => ({
  id: t.id,
  tenantKey: t.tenantKey,
  displayName: t.displayName,
  contact: t.contact,
  status: t.status,
  ownerMemberId: t.ownerMemberId,
  admins: t.admins ?? 0,
  users: t.users ?? 0,
  createdAt: isoUtc(t.createdAt),
});

export const listTenantsRoute = defineRoute(
  { action: 'system.manage', requirements: ['FA-SU-03'] },
  {
    method: 'get',
    path: '/api/system/v1/tenants',
    summary: 'Mandantenliste',
    tags: ['system'],
    responses: {
      200: {
        description: 'Mandanten',
        content: {
          'application/json': { schema: z.object({ tenants: z.array(TenantAdminView) }) },
        },
      },
      ...common,
    },
  },
);

export const createTenantRoute = defineRoute(
  { action: 'system.manage', requirements: [...REQ, 'FA-MAN-01'] },
  {
    method: 'post',
    path: '/api/system/v1/tenants',
    summary: 'Mandant anlegen (mit Built-in-Mondprofilen)',
    tags: ['system'],
    request: {
      body: { content: { 'application/json': { schema: CreateTenantRequest } }, required: true },
    },
    responses: {
      201: {
        description: 'Angelegt',
        content: { 'application/json': { schema: TenantAdminView } },
      },
      ...common,
      409: problemContent('resource.in_use (Mandanten-ID vergeben)'),
    },
  },
);

export const patchTenantRoute = defineRoute(
  { action: 'system.manage', requirements: [...REQ, 'FA-MAN-02'] },
  {
    method: 'patch',
    path: '/api/system/v1/tenants/{id}',
    summary: 'Mandant sperren/entsperren',
    tags: ['system'],
    request: {
      params: idParam,
      body: { content: { 'application/json': { schema: TenantStatusPatch } }, required: true },
    },
    responses: {
      200: {
        description: 'Geändert',
        content: { 'application/json': { schema: TenantAdminView } },
      },
      ...common,
      404: problemContent('tenant.not_found'),
    },
  },
);

export const ownerInvitationRoute = defineRoute(
  { action: 'system.manage', requirements: ['FA-SU-05', 'E3'] },
  {
    method: 'post',
    path: '/api/system/v1/tenants/{id}/invitations',
    summary: 'Owner-Einladung (eine Nutzung, optional an eine Discord-ID gebunden)',
    tags: ['system'],
    request: {
      params: idParam,
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
      ...common,
      404: problemContent('tenant.not_found'),
    },
  },
);

export const reassignOwnerRoute = defineRoute(
  { action: 'system.tenant.owner', requirements: ['FA-SU-05', 'TK 5.5'] },
  {
    method: 'put',
    path: '/api/system/v1/tenants/{id}/owner',
    summary: 'Owner im Notfall neu zuweisen (Mitglied oder neue Owner-Einladung)',
    tags: ['system'],
    request: {
      params: idParam,
      body: { content: { 'application/json': { schema: OwnerReassignRequest } }, required: true },
    },
    responses: {
      200: {
        description: 'Neu zugewiesen',
        content: {
          'application/json': { schema: z.object({ invitation: InvitationCreated.optional() }) },
        },
      },
      ...common,
      404: problemContent('tenant.not_found'),
      422: problemContent('owner_transfer.target_invalid'),
    },
  },
);

export const tenantMembersRoute = defineRoute(
  { action: 'system.manage', requirements: ['FA-SU-05', 'FA-SU-07'] },
  {
    method: 'get',
    path: '/api/system/v1/tenants/{id}/members',
    summary: 'Mitglieder für die Owner-Neuzuweisung (nur Anzeigename, Rolle, Status)',
    tags: ['system'],
    request: { params: idParam },
    responses: {
      200: {
        description: 'Mitglieder',
        content: {
          'application/json': { schema: z.object({ members: z.array(SystemMemberView) }) },
        },
      },
      ...common,
    },
  },
);

export const listSuperUsersRoute = defineRoute(
  { action: 'system.manage', requirements: ['FA-SU-06'] },
  {
    method: 'get',
    path: '/api/system/v1/super-users',
    summary: 'Super User',
    tags: ['system'],
    responses: {
      200: {
        description: 'Super User',
        content: {
          'application/json': { schema: z.object({ superUsers: z.array(SuperUserView) }) },
        },
      },
      ...common,
    },
  },
);

export const addSuperUserRoute = defineRoute(
  { action: 'system.manage', requirements: ['FA-SU-06'] },
  {
    method: 'post',
    path: '/api/system/v1/super-users',
    summary: 'Super User hinzufügen (Identität muss sich einmal angemeldet haben)',
    tags: ['system'],
    request: {
      body: { content: { 'application/json': { schema: AddSuperUserRequest } }, required: true },
    },
    responses: {
      204: { description: 'Hinzugefügt' },
      ...common,
      404: problemContent('resource.not_found'),
    },
  },
);

export const patchSuperUserRoute = defineRoute(
  { action: 'system.manage', requirements: ['FA-SU-06'] },
  {
    method: 'patch',
    path: '/api/system/v1/super-users/{id}',
    summary: 'Super User aktivieren/deaktivieren (letzter aktiver geschützt)',
    tags: ['system'],
    request: {
      params: idParam,
      body: { content: { 'application/json': { schema: SuperUserPatch } }, required: true },
    },
    responses: {
      204: { description: 'Geändert' },
      ...common,
      404: problemContent('resource.not_found'),
      409: problemContent('super_user.last_protected'),
    },
  },
);

export const deleteSuperUserRoute = defineRoute(
  { action: 'system.manage', requirements: ['FA-SU-06'] },
  {
    method: 'delete',
    path: '/api/system/v1/super-users/{id}',
    summary:
      'Super User entfernen (deaktiviert; Zeile bleibt für das System-Audit; letzter aktiver geschützt)',
    tags: ['system'],
    request: { params: idParam },
    responses: {
      204: { description: 'Entfernt' },
      ...common,
      404: problemContent('resource.not_found'),
      409: problemContent('super_user.last_protected'),
    },
  },
);

export const identityStatusRoute = defineRoute(
  { action: 'system.manage', requirements: ['FA-LOG-05'] },
  {
    method: 'patch',
    path: '/api/system/v1/identities/{id}',
    summary: 'Identität systemweit sperren/entsperren (beendet alle Sitzungen)',
    tags: ['system'],
    request: {
      params: idParam,
      body: { content: { 'application/json': { schema: IdentityStatusPatch } }, required: true },
    },
    responses: {
      204: { description: 'Geändert' },
      ...common,
      404: problemContent('resource.not_found'),
    },
  },
);

export const SYSTEM_ROUTES = [
  listTenantsRoute,
  createTenantRoute,
  patchTenantRoute,
  ownerInvitationRoute,
  reassignOwnerRoute,
  tenantMembersRoute,
  listSuperUsersRoute,
  addSuperUserRoute,
  patchSuperUserRoute,
  deleteSuperUserRoute,
  identityStatusRoute,
] as const;

export function systemRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();
  const origin = (svc: ApiServices) => new URL(svc.authConfig.redirectUri).origin;

  app.openapi(listTenantsRoute, async (c) => {
    const svc = await services();
    return c.json({ tenants: (await admin(svc, c).listTenants()).map(tenantView) }, 200);
  });

  app.openapi(createTenantRoute, async (c) => {
    const svc = await services();
    const tenant = await admin(svc, c).createTenant(c.req.valid('json'), svc.now());
    return c.json(tenantView(tenant), 201);
  });

  app.openapi(patchTenantRoute, async (c) => {
    const svc = await services();
    const tenant = await admin(svc, c).setTenantStatus(
      c.req.valid('param').id,
      c.req.valid('json').status,
      svc.now(),
    );
    return c.json(tenantView(tenant), 200);
  });

  app.openapi(ownerInvitationRoute, async (c) => {
    const svc = await services();
    const inv = await admin(svc, c).createOwnerInvitation(
      c.req.valid('param').id,
      c.req.valid('json'),
      svc.now(),
    );
    c.header('cache-control', 'no-store');
    return c.json(
      {
        id: inv.id,
        role: inv.role,
        link: invitationLink(origin(svc), inv.token),
        expiresAt: isoUtc(inv.expiresAt),
      },
      201,
    );
  });

  app.openapi(reassignOwnerRoute, async (c) => {
    const svc = await services();
    const { invitation } = await admin(svc, c).reassignOwner(
      c.req.valid('param').id,
      c.req.valid('json'),
      svc.now(),
    );
    c.header('cache-control', 'no-store');
    return c.json(
      invitation
        ? {
            invitation: {
              id: invitation.id,
              role: invitation.role,
              link: invitationLink(origin(svc), invitation.token),
              expiresAt: isoUtc(invitation.expiresAt),
            },
          }
        : {},
      200,
    );
  });

  app.openapi(tenantMembersRoute, async (c) => {
    const svc = await services();
    return c.json({ members: await admin(svc, c).listMembers(c.req.valid('param').id) }, 200);
  });

  app.openapi(listSuperUsersRoute, async (c) => {
    const svc = await services();
    const rows = await admin(svc, c).listSuperUsers();
    return c.json(
      {
        superUsers: rows.map((r) => ({
          identityId: r.identityId,
          discordUserId: r.discordUserId,
          discordUsername: r.discordUsername,
          status: r.status,
          mfa: r.mfaEnabled,
          createdAt: isoUtc(r.createdAt),
        })),
      },
      200,
    );
  });

  app.openapi(addSuperUserRoute, async (c) => {
    const svc = await services();
    await admin(svc, c).addSuperUser(c.req.valid('json').discordUserId, svc.now());
    return c.body(null, 204);
  });

  app.openapi(patchSuperUserRoute, async (c) => {
    const svc = await services();
    await admin(svc, c).changeSuperUser(c.req.valid('param').id, c.req.valid('json'), svc.now());
    return c.body(null, 204);
  });

  app.openapi(deleteSuperUserRoute, async (c) => {
    const svc = await services();
    await admin(svc, c).changeSuperUser(c.req.valid('param').id, 'delete', svc.now());
    return c.body(null, 204);
  });

  app.openapi(identityStatusRoute, async (c) => {
    const svc = await services();
    await admin(svc, c).setIdentityStatus(
      { id: c.req.valid('param').id },
      c.req.valid('json').status,
      svc.now(),
    );
    return c.body(null, 204);
  });

  return app;
}
