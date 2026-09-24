/**
 * Web-API-Client (TK 11.2, 11.4): Typen generiert aus docs/api/openapi.yaml (`pnpm --filter @nina-pm/web
 * api:generate` → schema.d.ts), Aufruf über den fetch-Wrapper mit CSRF-Header und 401-Weiterleitung.
 */
import { apiFetch, createApiFetch } from '../auth/api-fetch';
import type { components } from './schema';

export type Schemas = components['schemas'];
export type Me = Schemas['MeResponse'];
export type Preferences = Schemas['Preferences'];
export type InvitationPreview = Schemas['InvitationPreview'];
export type InvitationClaim = Schemas['InvitationClaimResponse'];
export type NotificationList = Schemas['NotificationList'];
export type TenantAdmin = Schemas['TenantAdminView'];
export type SystemMember = Schemas['SystemMemberView'];
export type SuperUser = Schemas['SuperUserView'];
export type SystemAuditEntry = Schemas['SystemAuditEntry'];
export type SystemAuditList = Schemas['SystemAuditList'];
export type IdentityAdmin = Schemas['IdentityAdminView'];
export type InvitationCreated = Schemas['InvitationCreated'];
export interface MaintenanceBanner {
  active: boolean;
  textDe: string;
  textEn: string;
}

/** Für `/auth/me`: 401 heißt „anonym“, keine Weiterleitung. */
const quiet = createApiFetch(fetch, { currentPath: () => '/', go: () => undefined });

export const api = {
  me: () => quiet<Me>('/api/auth/me'),
  setContext: (body: { tenantKey: string } | { system: true }) =>
    apiFetch<Me>('/api/auth/context', { method: 'POST', json: body }),
  logout: () => apiFetch<undefined>('/api/auth/logout', { method: 'POST' }),
  logoutEverywhere: () => apiFetch<undefined>('/api/auth/sessions', { method: 'DELETE' }),
  previewInvitation: (token: string) =>
    quiet<InvitationPreview>('/api/auth/invitations/preview', { method: 'POST', json: { token } }),
  claimInvitation: (token: string) =>
    quiet<InvitationClaim>('/api/auth/invitation/claim', { method: 'POST', json: { token } }),
  preferences: () => apiFetch<Preferences>('/api/web/v1/me/preferences'),
  setPreference: (key: 'ui.theme' | 'ui.density' | 'ui.navCollapsed', value: unknown) =>
    apiFetch<undefined>(`/api/web/v1/me/preferences/${key}`, { method: 'PUT', json: { value } }),
  notifications: (limit = 50) =>
    apiFetch<NotificationList>(`/api/web/v1/notifications?limit=${limit}`),
  banner: () => quiet<{ banner: { de: string; en: string } | null }>('/api/banner'),
  markNotificationsRead: (body: { ids: string[] } | { all: true }) =>
    apiFetch<{ unreadCount: number }>('/api/web/v1/notifications/read', {
      method: 'POST',
      json: body,
    }),
};

const json = (method: string, body?: unknown) => ({
  method,
  ...(body !== undefined ? { json: body } : {}),
});

/** System-Kontext (S-80…S-82, TK 7.2). */
export const systemApi = {
  tenants: () => apiFetch<{ tenants: TenantAdmin[] }>('/api/system/v1/tenants'),
  createTenant: (body: { tenantKey: string; displayName: string; contact?: string }) =>
    apiFetch<TenantAdmin>('/api/system/v1/tenants', json('POST', body)),
  setTenantStatus: (id: string, status: 'active' | 'locked') =>
    apiFetch<TenantAdmin>(`/api/system/v1/tenants/${id}`, json('PATCH', { status })),
  deleteTenant: (id: string, confirmTenantKey: string) =>
    apiFetch<undefined>(`/api/system/v1/tenants/${id}`, json('DELETE', { confirmTenantKey })),
  ownerInvitation: (id: string, body: { id: string; discordUserId?: string; validDays?: number }) =>
    apiFetch<InvitationCreated>(`/api/system/v1/tenants/${id}/invitations`, json('POST', body)),
  tenantMembers: (id: string) =>
    apiFetch<{ members: SystemMember[] }>(`/api/system/v1/tenants/${id}/members`),
  reassignOwner: (
    id: string,
    body:
      | { memberId: string; reason: string; keepPreviousAsAdmin: boolean }
      | {
          invite: { id: string; discordUserId?: string };
          reason: string;
          keepPreviousAsAdmin: boolean;
        },
  ) =>
    apiFetch<{ invitation?: InvitationCreated }>(
      `/api/system/v1/tenants/${id}/owner`,
      json('PUT', body),
    ),
  superUsers: () => apiFetch<{ superUsers: SuperUser[] }>('/api/system/v1/super-users'),
  addSuperUser: (discordUserId: string) =>
    apiFetch<undefined>('/api/system/v1/super-users', json('POST', { discordUserId })),
  setSuperUserStatus: (identityId: string, status: 'active' | 'disabled') =>
    apiFetch<undefined>(`/api/system/v1/super-users/${identityId}`, json('PATCH', { status })),
  removeSuperUser: (identityId: string) =>
    apiFetch<undefined>(`/api/system/v1/super-users/${identityId}`, json('DELETE')),
  identity: (discordUserId: string) =>
    apiFetch<IdentityAdmin>(
      `/api/system/v1/identities?discordUserId=${encodeURIComponent(discordUserId)}`,
    ),
  setIdentityStatus: (id: string, status: 'active' | 'blocked') =>
    apiFetch<undefined>(`/api/system/v1/identities/${id}`, json('PATCH', { status })),
  audit: (q: { cursor?: string | undefined; tenantId?: string | undefined; limit?: number }) => {
    const p = new URLSearchParams({ limit: String(q.limit ?? 50) });
    if (q.cursor) p.set('cursor', q.cursor);
    if (q.tenantId) p.set('tenantId', q.tenantId);
    return apiFetch<SystemAuditList>(`/api/system/v1/audit?${p.toString()}`);
  },
  banner: () =>
    apiFetch<{ key: string; value: MaintenanceBanner | null; updatedAt: string | null }>(
      '/api/system/v1/settings/maintenanceBanner',
    ),
  setBanner: (value: MaintenanceBanner) =>
    apiFetch<unknown>('/api/system/v1/settings/maintenanceBanner', json('PUT', { value })),
};
