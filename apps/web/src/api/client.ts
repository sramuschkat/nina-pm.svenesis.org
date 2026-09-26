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
  setPreference: (
    key: 'ui.theme' | 'ui.density' | 'ui.navCollapsed' | 'project.defaultConditions',
    value: unknown,
  ) => apiFetch<undefined>(`/api/web/v1/me/preferences/${key}`, { method: 'PUT', json: { value } }),
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
export type WeatherView = Schemas['WeatherView'];
export type WeatherHourView = Schemas['WeatherHourView'];
export type WeatherNightView = Schemas['WeatherNightView'];

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
  /** Rig ändern mit `If-Match` (`settingsVersion`, 412 bei parallelem Speichern). */
  updateRig: (id: string, body: object, version: number) =>
    apiFetch<RigView>(`${V1}/rigs/${id}`, { ...json('PUT', body), ...ifMatch(version) }),
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
  nights: (siteId: string, count = 60, from?: string) =>
    apiFetch<SiteNightsView>(
      `${V1}/sites/${siteId}/nights?count=${String(count)}${from ? `&from=${from}` : ''}`,
    ),
  /** Astro-Wetter des Standorts (AP-23, S-50). */
  weather: (siteId: string) => apiFetch<WeatherView>(`${V1}/sites/${siteId}/weather`),
};

export type ProjectView = Schemas['ProjectView'];
export type ProjectListItem = Schemas['ProjectListItem'];
export type PanelView = Schemas['PanelView'];
export type LineView = Schemas['LineView'];
export type NoteView = Schemas['NoteView'];
export type HistoryEntry = Schemas['HistoryEntry'];
export type RigCheckView = Schemas['RigCheckView'];
export type ProjectConditionsView = ProjectView['conditions'];

/** Projekte (S-31, AP-11a/b): Projekt mit Panels und Zeilen; Änderungen am Projekt mit `If-Match`. */
export const projectsApi = {
  list: (query = '') => apiFetch<{ items: ProjectListItem[] }>(`${V1}/projects${query}`),
  get: (id: string) => apiFetch<ProjectView>(`${V1}/projects/${id}`),
  create: (body: object & { id: string }) =>
    apiFetch<ProjectView>(`${V1}/projects`, json('POST', body)),
  /** Teiländerung mit `If-Match: "<version>"` (412 `resource.version_conflict`). */
  patch: (id: string, body: object, version: number) =>
    apiFetch<ProjectView>(`${V1}/projects/${id}`, { ...json('PATCH', body), ...ifMatch(version) }),
  remove: (id: string) => apiFetch<undefined>(`${V1}/projects/${id}`, json('DELETE')),
  /** Papierkorb: wiederherstellen (Admin/Owner, E4). */
  restore: (id: string) => apiFetch<ProjectView>(`${V1}/projects/${id}/restore`, json('POST')),
  /** Priorität je Rig (FA-PRJ-13): neue Position 1-basiert unter den freigegebenen Projekten. */
  priority: (id: string, position: number) =>
    apiFetch<unknown>(`${V1}/projects/${id}/priority`, json('PUT', { position })),
  duplicate: (id: string, body: { id: string; name?: string }) =>
    apiFetch<ProjectView>(`${V1}/projects/${id}/duplicate`, json('POST', body)),
  addPanel: (id: string, body: object & { id: string }) =>
    apiFetch<ProjectView>(`${V1}/projects/${id}/panels`, json('POST', body)),
  patchPanel: (id: string, panelId: string, body: object) =>
    apiFetch<ProjectView>(`${V1}/projects/${id}/panels/${panelId}`, json('PATCH', body)),
  deletePanel: (id: string, panelId: string) =>
    apiFetch<{ soft: boolean }>(`${V1}/projects/${id}/panels/${panelId}`, json('DELETE')),
  /** Panels umsortieren (FA-PRJ-06): alle aktiven Panels in neuer Reihenfolge (NINA-Nummer). */
  reorderPanels: (id: string, panelIds: string[], version: number) =>
    apiFetch<ProjectView>(`${V1}/projects/${id}/panels/order`, {
      ...json('PUT', { panelIds }),
      ...ifMatch(version),
    }),
  /** Mosaik aus der Sternkarte übernehmen (AP-22): Panels rechnet der Server mit der Engine. */
  applyMosaic: (
    id: string,
    body: {
      raDeg: number;
      decDeg: number;
      rotationDeg: number;
      cols: number;
      rows: number;
      overlapPct: number;
      copyPlan: boolean;
    },
    version: number,
  ) =>
    apiFetch<ProjectView>(`${V1}/projects/${id}/mosaic`, {
      ...json('POST', body),
      ...ifMatch(version),
    }),
  addLine: (id: string, body: object & { id: string; panelId: string }) =>
    apiFetch<ProjectView>(`${V1}/projects/${id}/lines`, json('POST', body)),
  patchLine: (id: string, lineId: string, body: object) =>
    apiFetch<ProjectView>(`${V1}/projects/${id}/lines/${lineId}`, json('PATCH', body)),
  deleteLine: (id: string, lineId: string) =>
    apiFetch<{ soft: boolean }>(`${V1}/projects/${id}/lines/${lineId}`, json('DELETE')),
  duplicateLine: (id: string, lineId: string, body: { id: string; deactivateSource: boolean }) =>
    apiFetch<ProjectView>(`${V1}/projects/${id}/lines/${lineId}/duplicate`, json('POST', body)),
  applyTemplate: (
    id: string,
    body: { templateId: string; panelId: string | null; replace: boolean },
  ) => apiFetch<ProjectView>(`${V1}/projects/${id}/apply-template`, json('POST', body)),
  setStatus: (id: string, status: string) =>
    apiFetch<ProjectView>(`${V1}/projects/${id}/status`, json('PUT', { status })),
  favorite: (id: string, on: boolean) =>
    apiFetch<undefined>(`${V1}/me/favorites/${id}`, json(on ? 'PUT' : 'DELETE')),
  notes: (id: string) => apiFetch<{ items: NoteView[] }>(`${V1}/projects/${id}/notes`),
  addNote: (id: string, bodyMd: string) =>
    apiFetch<NoteView>(`${V1}/projects/${id}/notes`, json('POST', { bodyMd })),
  history: (id: string) => apiFetch<{ items: HistoryEntry[] }>(`${V1}/projects/${id}/history`),
  rigCheck: (rigId: string, projectId: string) =>
    apiFetch<RigCheckView>(`${V1}/rigs/${rigId}/compatibility`, json('POST', { projectId })),
};

export type SimulationCreate = Schemas['SimulationCreate'];
export type SimulationSaved = Schemas['SimulationSaved'];

export type MultiSimInput = Schemas['MultiSimInput'];
export type MultiSimResult = Schemas['MultiSimResult'];
export type ImpactResult = Schemas['ImpactResult'];
export type JobView = Schemas['JobView'];

/**
 * Simulator S-40 (AP-13f): im Browser gerechneten Plan speichern (`night_plan`, TK 7.2); Mehrnacht-
 * Simulation als Job (AP-32a, FA-SIM-04).
 */
export const simulationApi = {
  save: (body: SimulationCreate) =>
    apiFetch<SimulationSaved>(`${V1}/simulations`, json('POST', body)),
  multi: (body: MultiSimInput) =>
    apiFetch<{ jobId: string }>(`${V1}/simulations/multi`, json('POST', body)),
};

/** Jobs (TK 7.4): Status abfragen, Ergebnis von `multi_sim`/`impact` holen (AP-32a). */
export const jobsApi = {
  get: (id: string) => apiFetch<JobView>(`${V1}/jobs/${id}`),
  result: (id: string) => apiFetch<MultiSimResult | ImpactResult>(`${V1}/jobs/${id}/result`),
};

export type QueueItem = Schemas['QueueItem'];
export type QueueVotes = Schemas['QueueVotes'];

/** Freigabe-Workflow (AP-12a): Einreichen … Ablehnen mit `If-Match`, Stimmen, Rangfolge, Entwürfe. */
export const approvalApi = {
  submit: (
    id: string,
    body: {
      requestedRigId?: string | null;
      requestPeriodFrom?: string | null;
      requestPeriodTo?: string | null;
      requestComment?: string | null;
    },
    version: number,
  ) =>
    apiFetch<ProjectView>(`${V1}/projects/${id}/submit`, {
      ...json('POST', body),
      ...ifMatch(version),
    }),
  /** Auswirkungsvorschau als Job `impact` (AP-32a, FA-FRG-05, Admin). */
  impact: (kind: 'project' | 'change-request', id: string) =>
    apiFetch<{ jobId: string }>(`${V1}/queue/${kind}/${id}/impact`, json('POST')),
  withdraw: (id: string, version: number) =>
    apiFetch<ProjectView>(`${V1}/projects/${id}/withdraw`, {
      ...json('POST'),
      ...ifMatch(version),
    }),
  approve: (
    id: string,
    body: {
      rigId: string;
      priorityPosition?: number;
      status: 'planning' | 'active';
      startDate?: string | null;
      dueDate?: string | null;
      comment?: string | null;
      acceptRigConflicts?: boolean;
    },
    version: number,
  ) =>
    apiFetch<ProjectView>(`${V1}/projects/${id}/approve`, {
      ...json('POST', body),
      ...ifMatch(version),
    }),
  returnToUser: (id: string, comment: string, version: number) =>
    apiFetch<ProjectView>(`${V1}/projects/${id}/return`, {
      ...json('POST', { comment }),
      ...ifMatch(version),
    }),
  reject: (id: string, comment: string, version: number) =>
    apiFetch<ProjectView>(`${V1}/projects/${id}/reject`, {
      ...json('POST', { comment }),
      ...ifMatch(version),
    }),
  queue: () => apiFetch<{ items: QueueItem[] }>(`${V1}/queue`),
  /** Stimme für ein eingereichtes Objekt bzw. einen offenen Änderungsantrag (AP-32b). */
  vote: (id: string, on: boolean, kind: 'project' | 'change-request' = 'project') =>
    apiFetch<QueueVotes>(`${V1}/queue/${kind}/${id}/vote`, json(on ? 'PUT' : 'DELETE')),
  acknowledge: (id: string) =>
    apiFetch<undefined>(`${V1}/queue/project/${id}/vote/acknowledge`, json('POST')),
  /** Rangfolge der eigenen Einreichungen und offenen Änderungsanträge (FA-FRG-15, AP-32b). */
  ranking: (items: readonly { kind: 'project' | 'change-request'; id: string }[]) =>
    apiFetch<undefined>(`${V1}/me/submission-ranking`, json('PUT', { items })),
  drafts: () => apiFetch<{ items: ProjectListItem[] }>(`${V1}/drafts`),
};

export type ProjectReport = Schemas['ProjectReport'];
export type ReportProject = Schemas['ReportProject'];

/** Projektbericht S-63 (AP-34): Zeitraum (Nacht-Schlüssel), Status, Rig, Typ. */
export const reportsApi = {
  projects: (q: { from?: string; to?: string; status?: string; rigId?: string; type?: string }) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
    const s = p.toString();
    return apiFetch<ProjectReport>(`${V1}/reports/projects${s ? `?${s}` : ''}`);
  },
};

export type ForecastView = Schemas['ForecastView'];
export type ForecastProject = Schemas['ForecastProject'];

/** Folgeplanung S-62 (AP-33): gespeicherte Mehrnacht-Prognose je Rig und Neuberechnung (Job `forecast`). */
export const forecastApi = {
  get: (rigId: string) =>
    apiFetch<ForecastView>(`${V1}/forecast?rigId=${encodeURIComponent(rigId)}`),
  run: (rigId: string) =>
    apiFetch<{ jobId: string }>(`${V1}/forecast/run`, json('POST', { rigId })),
};

export type ChangeRequestView = Schemas['ChangeRequestView'];
export type ChangeRequestDiffEntry = Schemas['ChangeRequestDiffEntry'];
export type ChangeRequestProposal = Schemas['ChangeRequestProposal'];

/** Änderungsanträge (AP-32b, FA-FRG-08): eigene Version (`If-Match`), Entscheidung mit Projektversion. */
export const changeRequestsApi = {
  list: (projectId: string) =>
    apiFetch<{ items: ChangeRequestView[] }>(`${V1}/projects/${projectId}/change-requests`),
  get: (id: string) => apiFetch<ChangeRequestView>(`${V1}/change-requests/${id}`),
  create: (
    projectId: string,
    body: { id: string; proposal: ChangeRequestProposal; comment: string | null },
  ) =>
    apiFetch<ChangeRequestView>(`${V1}/projects/${projectId}/change-requests`, json('POST', body)),
  update: (
    id: string,
    body: { proposal: ChangeRequestProposal; comment: string | null },
    version: number,
  ) =>
    apiFetch<ChangeRequestView>(`${V1}/change-requests/${id}`, {
      ...json('PATCH', body),
      ...ifMatch(version),
    }),
  withdraw: (id: string, version: number) =>
    apiFetch<ChangeRequestView>(`${V1}/change-requests/${id}/withdraw`, {
      ...json('POST'),
      ...ifMatch(version),
    }),
  decide: (
    id: string,
    body: { decision: 'approved' | 'rejected'; comment: string | null; projectVersion: number },
    version: number,
  ) =>
    apiFetch<ChangeRequestView>(`${V1}/change-requests/${id}/decide`, {
      ...json('POST', body),
      ...ifMatch(version),
    }),
};

export type NinaInstance = Schemas['NinaInstanceView'];
export type NinaInstanceCreated = Schemas['NinaInstanceCreated'];
export type NinaInstanceDiagnostics = Schemas['NinaInstanceDiagnostics'];
export type NinaCallEntry = Schemas['NinaCallEntry'];
export type NinaRigDelivery = Schemas['NinaRigDelivery'];
export type NinaDeliveryItem = Schemas['NinaDeliveryItem'];

/** NINA im Web (AP-14c): Instanzen & Tokens (S-42), Diagnose, Lease-Freigabe, Auslieferung (S-41). */
export const ninaApi = {
  instances: (rigId?: string) =>
    apiFetch<{ items: NinaInstance[] }>(
      `${V1}/nina-instances${rigId ? `?rigId=${encodeURIComponent(rigId)}` : ''}`,
    ),
  /** Token nur in dieser Antwort (SV-08); danach nur noch das Präfix. */
  create: (body: { id: string; rigId: string; name: string }) =>
    apiFetch<NinaInstanceCreated>(`${V1}/nina-instances`, json('POST', body)),
  revoke: (id: string) => apiFetch<NinaInstance>(`${V1}/nina-instances/${id}/revoke`, json('POST')),
  /** Nur ohne Sessions und Kommandos, sonst `409 resource.in_use` (FA-ADM-02). */
  remove: (id: string) => apiFetch<undefined>(`${V1}/nina-instances/${id}`, json('DELETE')),
  diagnostics: (id: string) =>
    apiFetch<NinaInstanceDiagnostics>(`${V1}/nina-instances/${id}/diagnostics`),
  releaseLease: (rigId: string) =>
    apiFetch<{ releasedSessionId: string | null }>(
      `${V1}/rigs/${rigId}/lease/release`,
      json('POST'),
    ),
  delivery: (rigId: string) => apiFetch<NinaRigDelivery>(`${V1}/rigs/${rigId}/delivery`),
};

export type NightSession = Schemas['NightSession'];
export type NightSessionDetail = Schemas['NightSessionDetail'];
export type NightSessionLineRow = Schemas['NightSessionLineRow'];
export type NightSessionCapture = Schemas['NightSessionCapture'];
export type NightSessionKpis = Schemas['NightSessionKpis'];
export type NightSessionReason = Schemas['NightSessionReason'];
export type CaptureRejectResult = Schemas['CaptureRejectResult'];

/** Sessions und Auswertung R1 (AP-15, S-60/S-61): Liste, Detail, Korrektur, geprüft, Zuordnung. */
export const sessionsApi = {
  list: (query: { rigId?: string; unreviewed?: boolean } = {}) => {
    const q = new URLSearchParams();
    if (query.rigId) q.set('rigId', query.rigId);
    if (query.unreviewed) q.set('unreviewed', 'true');
    const s = q.toString();
    return apiFetch<{ items: NightSession[] }>(`${V1}/sessions${s ? `?${s}` : ''}`);
  },
  get: (id: string) => apiFetch<NightSessionDetail>(`${V1}/sessions/${id}`),
  correct: (
    id: string,
    body: {
      exposureLineId: string;
      rejected: number;
      reason: string | null;
      comment: string | null;
    },
  ) =>
    apiFetch<{ rejectedCount: number; projectStatus: string | null }>(
      `${V1}/sessions/${id}/corrections`,
      json('POST', body),
    ),
  review: (id: string, reviewed: boolean) =>
    apiFetch<undefined>(`${V1}/sessions/${id}/review`, json('PUT', { reviewed })),
  /** Einzelne Aufnahme verwerfen bzw. zurücknehmen (FA-AUS-20; Rechte wie Korrektur). */
  reject: (captureId: string, rejected: boolean, reason: string | null) =>
    apiFetch<CaptureRejectResult>(
      `${V1}/captures/${captureId}`,
      json('PATCH', { rejected, reason }),
    ),
  /** Nicht zugeordnete Aufnahme einer Zeile zuordnen (FA-AUS-22, Admin). */
  assign: (captureId: string, exposureLineId: string) =>
    apiFetch<undefined>(`${V1}/captures/${captureId}/assign`, json('PATCH', { exposureLineId })),
};

export type SessionLogView = Schemas['SessionLogView'];
export type SessionLogValues = Schemas['SessionLogValues'];
export type ClearNightView = Schemas['ClearNightView'];
export type ClearNightNight = Schemas['ClearNightNight'];

/** Sitzungsprotokoll und Klarnacht-Statistik (AP-30; S-61 *Protokoll*, S-64). */
export const sessionLogApi = {
  get: (sessionId: string) => apiFetch<SessionLogView>(`${V1}/sessions/${sessionId}/log`),
  /** Speichern mit `If-Match: "<version>"` (412 `resource.version_conflict`). */
  save: (sessionId: string, values: SessionLogValues, version: string) =>
    apiFetch<SessionLogView>(`${V1}/sessions/${sessionId}/log`, {
      ...json('PUT', values),
      headers: { 'If-Match': `"${version}"` },
    }),
  clearNights: (siteId: string, from: string, to: string) =>
    apiFetch<ClearNightView>(
      `${V1}/sites/${siteId}/clear-nights?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
  /** Nacht ohne Session als „bewölkt/nicht genutzt“ erfassen bzw. zurücknehmen (FA-AUS-17, Admin). */
  markUnused: (siteId: string, night: string, on: boolean) =>
    apiFetch<undefined>(
      `${V1}/sites/${siteId}/clear-nights/${night}`,
      on ? json('PUT', { usable: false }) : json('DELETE'),
    ),
};

export type DsoView = Schemas['DsoView'];
export type DsoList = Schemas['DsoList'];
export type DsoNight = Schemas['DsoNight'];
export type CatalogStatus = Schemas['CatalogStatus'];
export type DsoMarker = Schemas['DsoMarker'];
export type DsoRegion = Schemas['DsoRegion'];

/** Filter des Objektbrowsers (S-21) bzw. der Katalogsuche im Editor – wie `DsoQuery`. */
export interface DsoSearch {
  q?: string;
  group?: string;
  catalog?: string;
  constellation?: string;
  magMax?: number;
  surfBrMax?: number;
  sizeMinArcmin?: number;
  sizeMaxArcmin?: number;
  fitsFovArcmin?: number;
  siteId?: string;
  night?: string;
  minAltDeg?: number;
  twilight?: string;
  minUsableHours?: number;
  rigFovArcmin?: number;
  candidates?: 'true';
  family?: 'galaxies' | 'nebulae' | 'clusters';
  sort?: 'name' | 'mag' | 'size' | 'usable' | 'altitude' | 'score';
  dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export function dsoSearchParams(s: DsoSearch): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(s))
    if (v !== undefined && v !== '' && !(typeof v === 'number' && Number.isNaN(v)))
      p.set(k, String(v));
  return p.toString();
}

/** Objektkatalog (AP-20, S-21, Katalogsuche im Editor, S-82). */
export const catalogApi = {
  search: (s: DsoSearch) => apiFetch<DsoList>(`${V1}/dso?${dsoSearchParams(s)}`),
  /** Katalog-Overlay der Sternkarte (FA-FRM-09): Objekte im Umkreis, Dichte über `magMax`. */
  region: (q: { ra: number; dec: number; radius: number; magMax: number; limit?: number }) =>
    apiFetch<DsoRegion>(`${V1}/dso/region?${dsoSearchParams(q as unknown as DsoSearch)}`),
  status: () => apiFetch<CatalogStatus>('/api/system/v1/catalogs'),
  refresh: () => apiFetch<{ jobId: string }>('/api/system/v1/catalogs/dso/refresh', json('POST')),
};
