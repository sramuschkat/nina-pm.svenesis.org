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
export type Member = Schemas['MemberView'];
export type TenantSettingsView = Schemas['TenantSettingsView'];
export type TenantSettings = Schemas['TenantSettings'];
export type ChangeLogEntry = Schemas['ChangeLogEntry'];
export type SessionList = Schemas['SessionList'];
export type Invitation = Schemas['InvitationView'];
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

/** Mitglieder und Einladungen im Mandanten (S-70, TK 7.2). */
export const memberApi = {
  list: () => apiFetch<{ members: Member[] }>('/api/web/v1/members'),
  patch: (id: string, body: { displayName?: string; status?: 'active' | 'disabled' }) =>
    apiFetch<undefined>(`/api/web/v1/members/${id}`, json('PATCH', body)),
  remove: (id: string) => apiFetch<undefined>(`/api/web/v1/members/${id}`, json('DELETE')),
  setRole: (id: string, role: 'admin' | 'user', reason?: string) =>
    apiFetch<undefined>(
      `/api/web/v1/members/${id}/role`,
      json('PUT', { role, ...(reason ? { reason } : {}) }),
    ),
  endSessions: (id: string) =>
    apiFetch<undefined>(`/api/web/v1/members/${id}/sessions`, json('DELETE')),
  invitations: () => apiFetch<{ invitations: Invitation[] }>('/api/web/v1/invitations'),
  invite: (
    role: 'user' | 'admin',
    body: {
      id: string;
      discordUserId?: string;
      validDays?: number;
      maxUses?: number;
      note?: string;
    },
  ) =>
    apiFetch<InvitationCreated>(
      role === 'admin' ? '/api/web/v1/invitations/admin' : '/api/web/v1/invitations',
      json('POST', body),
    ),
  revokeInvitation: (id: string) =>
    apiFetch<undefined>(`/api/web/v1/invitations/${id}`, json('DELETE')),
  leave: () => apiFetch<undefined>('/api/web/v1/me/leave', json('POST')),
};

/** Mandant (S-70 Owner übertragen, S-71 Einstellungen, S-72 Protokolle). */
export const tenantApi = {
  settings: () => apiFetch<TenantSettingsView>('/api/web/v1/tenant/settings'),
  updateSettings: (body: { displayName?: string; settings?: Partial<TenantSettings> }) =>
    apiFetch<TenantSettingsView>('/api/web/v1/tenant/settings', json('PATCH', body)),
  transferOwner: (memberId: string) =>
    apiFetch<undefined>('/api/web/v1/tenant/owner-transfer', json('POST', { memberId })),
  changes: (q: { cursor?: string | undefined; entity?: string | undefined }) => {
    const p = new URLSearchParams({ limit: '50' });
    if (q.cursor) p.set('cursor', q.cursor);
    if (q.entity) p.set('entity', q.entity);
    return apiFetch<{ items: ChangeLogEntry[]; nextCursor: string | null }>(
      `/api/web/v1/audit/changes?${p.toString()}`,
    );
  },
  systemAudit: (cursor?: string) =>
    apiFetch<SystemAuditList>(
      `/api/web/v1/audit/system?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),
};

/** Eigene Anmeldesitzungen (S-73, TK 5.3) – in jedem Kontext. */
export const sessionApi = {
  list: () => apiFetch<SessionList>('/api/auth/sessions'),
  end: (id: string) => apiFetch<undefined>(`/api/auth/sessions/${id}`, json('DELETE')),
  endAll: () => apiFetch<undefined>('/api/auth/sessions', json('DELETE')),
};

export type SiteView = Schemas['SiteView'];
export type SiteLinkView = Schemas['SiteLinkView'];
export type TelescopeView = Schemas['TelescopeView'];
export type CameraView = Schemas['CameraView'];
export type FilterView = Schemas['FilterView'];
export type MoonProfileView = Schemas['MoonProfileView'];
export type ExposureTemplateView = Schemas['ExposureTemplateView'];
export type RigView = Schemas['RigView'];
export type FilterWheelView = Schemas['FilterWheelView'];
export type SiteNightsView = Schemas['SiteNightsView'];

/** Pfade der Stammdaten unter `/api/web/v1` (TK 7.2) mit Ansicht je Objektart. */
export interface EquipmentKinds {
  sites: SiteView;
  'site-links': SiteLinkView;
  telescopes: TelescopeView;
  cameras: CameraView;
  filters: FilterView;
  'moon-profiles': MoonProfileView;
  'exposure-templates': ExposureTemplateView;
  rigs: RigView;
}
export type EquipmentKind = keyof EquipmentKinds;

const V1 = '/api/web/v1';
const ifMatch = (version: number | undefined) =>
  version === undefined ? {} : { headers: { 'If-Match': `"${String(version)}"` } };

/** Ausrüstung (S-10…S-15, AP-09a): CRUD je Objektart, Scheduler, Filterrad, Nacht-Tabelle. */
export const equipmentApi = {
  list: <K extends EquipmentKind>(kind: K, query = '') =>
    apiFetch<{ items: EquipmentKinds[K][] }>(`${V1}/${kind}${query}`),
  create: <K extends EquipmentKind>(kind: K, body: object & { id: string }) =>
    apiFetch<EquipmentKinds[K]>(`${V1}/${kind}`, json('POST', body)),
  update: <K extends EquipmentKind>(kind: K, id: string, body: object) =>
    apiFetch<EquipmentKinds[K]>(`${V1}/${kind}/${id}`, json('PUT', body)),
  remove: (kind: EquipmentKind, id: string) =>
    apiFetch<undefined>(`${V1}/${kind}/${id}`, json('DELETE')),
  schedulerSettings: (id: string, body: RigView['scheduler'], version?: number) =>
    apiFetch<RigView>(`${V1}/rigs/${id}/scheduler-settings`, {
      ...json('PUT', body),
      ...ifMatch(version),
    }),
  filterWheel: (id: string) => apiFetch<FilterWheelView>(`${V1}/rigs/${id}/filter-wheel`),
  putFilterWheel: (
    id: string,
    slots: { position: number; filterId: string | null; ninaFilterName: string | null }[],
    version?: number,
  ) =>
    apiFetch<FilterWheelView>(`${V1}/rigs/${id}/filter-wheel`, {
      ...json('PUT', { slots }),
      ...ifMatch(version),
    }),
  nights: (siteId: string, count = 60) =>
    apiFetch<SiteNightsView>(`${V1}/sites/${siteId}/nights?count=${String(count)}`),
};
