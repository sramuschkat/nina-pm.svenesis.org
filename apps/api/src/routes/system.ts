/**
 * Systemverwaltung unter `/api/system/v1` (Super User im System-Kontext mit 2FA; TK 5.4, 5.5, 7.2;
 * FA-SU-01…09, FA-MAN-01/02). Kein fachlicher Zugriff auf Mandanteninhalte (FA-SU-07).
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import {
  AddSuperUserRequest,
  DeleteTenantRequest,
  IdentityAdminView,
  IdentityLookupQuery,
  CreateSingleUseInvitationRequest,
  CreateTenantRequest,
  IdentityStatusPatch,
  InvitationCreated,
  OwnerReassignRequest,
  ProblemError,
  SuperUserPatch,
  SuperUserView,
  SystemAuditList,
  SystemAuditQuery,
  SystemMemberView,
  SystemSettingKeySchema,
  SystemSettingView,
  TenantAdminView,
  TenantStatusPatch,
  Uuid,
} from '@nina-pm/shared';
import type { SystemAuditRow, TenantAdminRepository } from '@nina-pm/db';
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

type TenantSummary = Awaited<ReturnType<TenantAdminRepository['tenantSummary']>>;

const tenantView = (t: TenantSummary) => ({
  id: t.id,
  tenantKey: t.tenantKey,
  displayName: t.displayName,
  contact: t.contact,
  status: t.status,
  ownerMemberId: t.ownerMemberId,
  ownerDisplayName: t.ownerDisplayName ?? null,
  admins: t.admins,
  users: t.users,
  rigs: t.rigs,
  ninaInstances: t.ninaInstances,
  ninaLastSeenAt: t.ninaLastSeenAt ? isoUtc(t.ninaLastSeenAt) : null,
  lastLoginAt: t.lastLoginAt ? isoUtc(t.lastLoginAt) : null,
  createdAt: isoUtc(t.createdAt),
});

export const auditView = (r: SystemAuditRow) => ({
  id: r.id,
  actor: r.actor,
  actorName: r.actorName,
  tenantId: r.tenantId,
  tenantKey: r.tenantKey ?? (typeof r.details.tenantKey === 'string' ? r.details.tenantKey : null),
  action: r.action,
  details: r.details,
  createdAt: isoUtc(r.createdAt),
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

export const deleteTenantRoute = defineRoute(
  { action: 'system.manage', requirements: ['FA-MAN-03', 'FA-SU-04', 'E4'] },
  {
    method: 'delete',
    path: '/api/system/v1/tenants/{id}',
    summary: 'Mandant mit allen Daten löschen (nur mit exakter Mandanten-ID)',
    tags: ['system'],
    request: {
      params: idParam,
      body: { content: { 'application/json': { schema: DeleteTenantRequest } }, required: true },
    },
    responses: {
      204: { description: 'Gelöscht' },
      ...common,
      404: problemContent('tenant.not_found'),
      422: problemContent('validation.failed (Mandanten-ID stimmt nicht)'),
    },
  },
);

export const systemAuditRoute = defineRoute(
  { action: 'system.manage', requirements: ['FA-SU-09', 'SV-11'] },
  {
    method: 'get',
    path: '/api/system/v1/audit',
    summary: 'System-Audit (neueste zuerst, optional je Mandant)',
    tags: ['system'],
    request: { query: SystemAuditQuery },
    responses: {
      200: {
        description: 'Einträge',
        content: { 'application/json': { schema: SystemAuditList } },
      },
      ...common,
    },
  },
);

const settingParam = z.object({ key: SystemSettingKeySchema });

export const getSettingRoute = defineRoute(
  { action: 'system.manage', requirements: ['FA-SU-08'] },
  {
    method: 'get',
    path: '/api/system/v1/settings/{key}',
    summary: 'Systemweite Einstellung lesen',
    tags: ['system'],
    request: { params: settingParam },
    responses: {
      200: { description: 'Wert', content: { 'application/json': { schema: SystemSettingView } } },
      ...common,
    },
  },
);

export const putSettingRoute = defineRoute(
  { action: 'system.manage', requirements: ['FA-SU-08'] },
  {
    method: 'put',
    path: '/api/system/v1/settings/{key}',
    summary: 'Systemweite Einstellung setzen (u. a. Wartungsbanner)',
    tags: ['system'],
    request: {
      params: settingParam,
      body: {
        content: { 'application/json': { schema: z.object({ value: z.unknown() }).strict() } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Gesetzt',
        content: { 'application/json': { schema: SystemSettingView } },
      },
      ...common,
      422: problemContent('validation.failed'),
    },
  },
);

export const identityLookupRoute = defineRoute(
  { action: 'system.manage', requirements: ['FA-LOG-05'] },
  {
    method: 'get',
    path: '/api/system/v1/identities',
    summary: 'Identität über die Discord-User-ID finden (zum Sperren)',
    tags: ['system'],
    request: { query: IdentityLookupQuery },
    responses: {
      200: {
        description: 'Identität',
        content: { 'application/json': { schema: IdentityAdminView } },
      },
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
  deleteTenantRoute,
  systemAuditRoute,
  getSettingRoute,
  putSettingRoute,
  identityLookupRoute,
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
    const repo = admin(svc, c);
    const tenant = await repo.createTenant(c.req.valid('json'), svc.now());
    return c.json(tenantView(await repo.tenantSummary(tenant.id)), 201);
  });

  app.openapi(patchTenantRoute, async (c) => {
    const svc = await services();
    const repo = admin(svc, c);
    const { id } = c.req.valid('param');
    await repo.setTenantStatus(id, c.req.valid('json').status, svc.now());
    return c.json(tenantView(await repo.tenantSummary(id)), 200);
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

  app.openapi(deleteTenantRoute, async (c) => {
    const svc = await services();
    const repo = admin(svc, c);
    const { id } = c.req.valid('param');
    const { confirmTenantKey } = c.req.valid('json');
    const tenant = await repo.tenantById(id);
    if (!tenant) throw new ProblemError('tenant.not_found');
    if (confirmTenantKey.trim() !== tenant.tenantKey)
      throw new ProblemError('validation.failed', [
        { path: 'confirmTenantKey', message: 'Mandanten-ID stimmt nicht überein' },
      ]);
    // Dateien zuerst: scheitert S3, bleibt der Mandant bestehen und das Löschen ist wiederholbar.
    await svc.tenantFiles.deleteTenantFiles(id);
    await repo.deleteTenant(id, confirmTenantKey, svc.now());
    return c.body(null, 204);
  });

  app.openapi(systemAuditRoute, async (c) => {
    const svc = await services();
    const page = await admin(svc, c).listAudit(c.req.valid('query'));
    return c.json({ items: page.items.map(auditView), nextCursor: page.nextCursor }, 200);
  });

  app.openapi(getSettingRoute, async (c) => {
    const svc = await services();
    const row = await admin(svc, c).getSetting(c.req.valid('param').key);
    return c.json(
      { key: row.key, value: row.value, updatedAt: row.updatedAt ? isoUtc(row.updatedAt) : null },
      200,
    );
  });

  app.openapi(putSettingRoute, async (c) => {
    const svc = await services();
    const row = await admin(svc, c).putSetting(
      c.req.valid('param').key,
      c.req.valid('json').value,
      svc.now(),
    );
    return c.json(
      { key: row.key, value: row.value, updatedAt: row.updatedAt ? isoUtc(row.updatedAt) : null },
      200,
    );
  });

  app.openapi(identityLookupRoute, async (c) => {
    const svc = await services();
    const row = await admin(svc, c).identityByDiscordId(c.req.valid('query').discordUserId);
    return c.json(
      {
        id: row.id,
        discordUserId: row.discordUserId,
        discordUsername: row.discordUsername,
        globalName: row.discordGlobalName,
        status: row.status,
        isSuperUser: row.superUserId !== null,
        lastLoginAt: row.lastLoginAt ? isoUtc(row.lastLoginAt) : null,
      },
      200,
    );
  });

  return app;
}
