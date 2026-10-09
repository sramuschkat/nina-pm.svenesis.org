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
export type MemberDirectoryEntry = Schemas['MemberDirectoryEntry'];
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
  /** Rollenansicht „Als User ansehen“ ein-/ausschalten (nur Admin/Owner mit 2FA, je Sitzung). */
  viewAs: (asUser: boolean) =>
    apiFetch<Me>('/api/auth/view-as', { method: 'POST', json: { asUser } }),
  logout: () => apiFetch<undefined>('/api/auth/logout', { method: 'POST' }),
  logoutEverywhere: () => apiFetch<undefined>('/api/auth/sessions', { method: 'DELETE' }),
  previewInvitation: (token: string) =>
    quiet<InvitationPreview>('/api/auth/invitations/preview', { method: 'POST', json: { token } }),
  claimInvitation: (token: string) =>
    quiet<InvitationClaim>('/api/auth/invitation/claim', { method: 'POST', json: { token } }),
  preferences: () => apiFetch<Preferences>('/api/web/v1/me/preferences'),
  setPreference: (
    key: 'ui.theme' | 'ui.density' | 'ui.navCollapsed' | 'project.defaultConditions' | 'exo.search',
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
  /** Name und Discord-Bild aller Mitglieder (Anzeige, jedes Mitglied; 30.09.2026). */
  directory: () => apiFetch<{ items: MemberDirectoryEntry[] }>('/api/web/v1/members/directory'),
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

export type DiscordSettingsView = Schemas['DiscordSettingsView'];
export type DiscordChannelView = Schemas['DiscordChannelView'];
export type DiscordGuild = Schemas['DiscordGuild'];
export type DiscordChannelCreate = Schemas['DiscordChannelCreate'];
export type DiscordChannelPatch = Schemas['DiscordChannelPatch'];

/** Discord ausgehend (S-71 Reiter Discord, FA-DIS-01…05): Webhook-URLs nur schreibbar (SV-10). */
export const discordApi = {
  settings: () => apiFetch<DiscordSettingsView>('/api/web/v1/tenant/discord'),
  saveGuild: (body: DiscordGuild) =>
    apiFetch<DiscordGuild>('/api/web/v1/tenant/discord', json('PUT', body)),
  createChannel: (body: DiscordChannelCreate) =>
    apiFetch<DiscordChannelView>('/api/web/v1/tenant/discord/channels', json('POST', body)),
  updateChannel: (id: string, body: DiscordChannelPatch) =>
    apiFetch<DiscordChannelView>(`/api/web/v1/tenant/discord/channels/${id}`, json('PATCH', body)),
  deleteChannel: (id: string) =>
    apiFetch<undefined>(`/api/web/v1/tenant/discord/channels/${id}`, json('DELETE')),
  testChannel: (id: string) =>
    apiFetch<{ ok: true; sentAt: string }>(
      `/api/web/v1/tenant/discord/channels/${id}/test`,
      json('POST'),
    ),
  resendReport: (sessionId: string) =>
    apiFetch<{ channels: number }>(`/api/web/v1/sessions/${sessionId}/report/resend`, json('POST')),
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
export type FocusOffsetsView = Schemas['FocusOffsetsView'];
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

export type EquipmentBundle = Schemas['EquipmentBundle'];

/**
 * Bündeln gleichzeitiger Abrufe (01.10.2026): Ein Seitenaufruf schickte bis zu 19 Anfragen auf einmal, jede
 * belegte eine eigene Lambda-Instanz (Alarm 5xx 30.09.2026). Gleichzeitige Stammdaten-Listen teilen sich einen
 * Aufruf `GET /equipment`; Einzelabrufe von Projekten im selben Moment gehen gesammelt an
 * `GET /project-details`. Cache-Schlüssel und Invalidierung der Seiten bleiben unverändert.
 */
const BUNDLE_KEY: Partial<Record<EquipmentKind, keyof EquipmentBundle>> = {
  sites: 'sites',
  telescopes: 'telescopes',
  cameras: 'cameras',
  filters: 'filters',
  'moon-profiles': 'moonProfiles',
  rigs: 'rigs',
};
let bundleInFlight: Promise<EquipmentBundle> | null = null;
/** Ein Aufruf für alle gleichzeitig laufenden Stammdaten-Listen; danach wieder frisch. */
function loadEquipmentBundle(): Promise<EquipmentBundle> {
  bundleInFlight ??= apiFetch<EquipmentBundle>(`${V1}/equipment`).finally(() => {
    bundleInFlight = null;
  });
  return bundleInFlight;
}

const PROJECT_BATCH_MAX = 50;
interface ProjectWaiter {
  resolve: (p: ProjectView) => void;
  reject: (e: unknown) => void;
}
let projectQueue = new Map<string, ProjectWaiter[]>();
const singleProject = (id: string) => apiFetch<ProjectView>(`${V1}/projects/${id}`);
/** Gesammelte Einzelabrufe eines Moments: einer allein wie bisher, sonst `GET /project-details`. */
function flushProjects() {
  const queue = projectQueue;
  projectQueue = new Map<string, ProjectWaiter[]>();
  const ids = [...queue.keys()];
  const settle = (id: string, p: Promise<ProjectView>) => {
    for (const w of queue.get(id) ?? []) p.then(w.resolve, w.reject);
  };
  if (ids.length === 1) {
    settle(ids[0] as string, singleProject(ids[0] as string));
    return;
  }
  for (let i = 0; i < ids.length; i += PROJECT_BATCH_MAX) {
    const chunk = ids.slice(i, i + PROJECT_BATCH_MAX);
    const batch = apiFetch<{ items: ProjectView[] }>(
      `${V1}/project-details?ids=${chunk.join(',')}`,
    );
    for (const id of chunk)
      settle(
        id,
        // Fehlt ein Projekt (nicht lesbar, unbekannt), liefert der Einzelabruf den richtigen Fehler.
        batch.then((r) => r.items.find((p) => p.id === id) ?? singleProject(id)),
      );
  }
}
function batchedProject(id: string): Promise<ProjectView> {
  return new Promise((resolve, reject) => {
    if (projectQueue.size === 0) setTimeout(flushProjects, 0);
    projectQueue.set(id, [...(projectQueue.get(id) ?? []), { resolve, reject }]);
  });
}

/** Ausrüstung (S-10…S-15, AP-09a): CRUD je Objektart, Scheduler, Filterrad, Nacht-Tabelle. */
export const equipmentApi = {
  list: <K extends EquipmentKind>(kind: K, query = ''): Promise<{ items: EquipmentKinds[K][] }> => {
    const key = BUNDLE_KEY[kind];
    if (key && !query)
      return loadEquipmentBundle().then((b) => ({ items: b[key] as EquipmentKinds[K][] }));
    return apiFetch<{ items: EquipmentKinds[K][] }>(`${V1}/${kind}${query}`);
  },
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
  focusOffsets: (id: string) => apiFetch<FocusOffsetsView>(`${V1}/rigs/${id}/focus-offsets`),
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
export type CommentReaction = NoteView['reactions'][number]['emoji'];
export type HistoryEntry = Schemas['HistoryEntry'];
export type ProjectFlatsView = Schemas['ProjectFlatsView'];
export type RigCheckView = Schemas['RigCheckView'];
export type ProjectConditionsView = ProjectView['conditions'];

/** Projekte (S-31, AP-11a/b): Projekt mit Panels und Zeilen; Änderungen am Projekt mit `If-Match`. */
export const projectsApi = {
  list: (query = '') => apiFetch<{ items: ProjectListItem[] }>(`${V1}/projects${query}`),
  get: (id: string) => batchedProject(id),
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
  /** Kommentare (FA-PRJ-17): flach, neueste zuerst; Antworten mit `parentId`. */
  notes: (id: string) => apiFetch<{ items: NoteView[] }>(`${V1}/projects/${id}/notes`),
  addNote: (id: string, bodyMd: string, parentId: string | null = null) =>
    apiFetch<NoteView>(
      `${V1}/projects/${id}/notes`,
      json('POST', parentId ? { bodyMd, parentId } : { bodyMd }),
    ),
  editNote: (id: string, noteId: string, bodyMd: string) =>
    apiFetch<NoteView>(`${V1}/projects/${id}/notes/${noteId}`, json('PATCH', { bodyMd })),
  deleteNote: (id: string, noteId: string) =>
    apiFetch<undefined>(`${V1}/projects/${id}/notes/${noteId}`, json('DELETE')),
  /** Eigene Reaktion setzen (`active`) bzw. entfernen – idempotent. */
  reactNote: (id: string, noteId: string, emoji: CommentReaction, active: boolean) =>
    apiFetch<NoteView>(
      `${V1}/projects/${id}/notes/${noteId}/reactions`,
      json('PUT', { emoji, active }),
    ),
  history: (id: string) => apiFetch<{ items: HistoryEntry[] }>(`${V1}/projects/${id}/history`),
  /** Flat-Markierung je Belichtungszeile nach der Auto-Flats-Regel des Rigs (AP-50b). */
  flats: (id: string) => apiFetch<ProjectFlatsView>(`${V1}/projects/${id}/flats`),
  rigCheck: (rigId: string, projectId: string) =>
    apiFetch<RigCheckView>(`${V1}/rigs/${rigId}/compatibility`, json('POST', { projectId })),
};

export type SimulationCreate = Schemas['SimulationCreate'];
export type SimulationSaved = Schemas['SimulationSaved'];
export type SimulationTransits = Schemas['SimulationTransits'];
export type SimulationInput = Schemas['SimulationInput'];

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
  /** Festgelegte Transits der Nacht am Rig – wie `POST /plan` (06.10.2026). */
  transits: (rigId: string, night: string) =>
    apiFetch<SimulationTransits>(
      `${V1}/simulations/transits?${new URLSearchParams({ rigId, night }).toString()}`,
    ),
  /** Engine-Eingabe, Ist und gespeicherter Plan der Nacht (AP-53c) – eine Eingabe-Quelle mit `POST /plan`. */
  input: (rigId: string, night: string) =>
    apiFetch<SimulationInput>(
      `${V1}/simulations/input?${new URLSearchParams({ rigId, night }).toString()}`,
    ),
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
};

export type ProjectReport = Schemas['ProjectReport'];
export type ReportProject = Schemas['ReportProject'];

/** Projektbericht S-63 (AP-34): Zeitraum (Nacht-Schlüssel), Status, Rig, Typ. */
export const reportsApi = {
  projects: (q: {
    from?: string;
    to?: string;
    status?: string;
    rigId?: string;
    type?: string;
    projectId?: string;
  }) => {
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

export type TelemetryView = Schemas['TelemetryView'];
export type TelemetrySeries = Schemas['TelemetrySeries'];

/** Rig-Zustand S-43 (AP-67): Telemetrie eines Rigs (Mini-PC, Powerbox) für einen Zeitraum. */
export const telemetryApi = {
  get: (rigId: string, from: string, to: string) =>
    apiFetch<TelemetryView>(
      `${V1}/rigs/${rigId}/telemetry?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
};

export type TonightView = Schemas['TonightView'];
export type TonightRig = Schemas['TonightRig'];
export type TonightLine = Schemas['TonightLine'];

/**
 * „Heute Nacht“ S-02 (AP-35): aktuelle Nacht je Rig (Server, NT-01) und Zeile nur für die kommende Nacht
 * ab- bzw. wieder einschalten (FA-FOL-05, Admin).
 */
export const tonightApi = {
  /** Ohne `night` die laufende Nacht; mit `night` eine der folgenden sechs (Nachtwahl, 30.09.2026). */
  get: (rigId?: string, night?: string) => {
    const q = new URLSearchParams({
      ...(rigId ? { rigId } : {}),
      ...(night ? { night } : {}),
    }).toString();
    return apiFetch<TonightView>(`${V1}/tonight${q ? `?${q}` : ''}`);
  },
  setLine: (projectId: string, lineId: string, disabled: boolean) =>
    apiFetch<ProjectView>(
      `${V1}/projects/${projectId}/lines/${lineId}/tonight`,
      json('PUT', { disabled }),
    ),
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
  /** Kommando an das Plugin aller aktiven Instanzen des Rigs (TK 7.6), zugestellt mit dem nächsten Heartbeat. */
  command: (rigId: string, command: 'refresh_targets' | 'reset_plan') =>
    apiFetch<{ commandIds: string[] }>(`${V1}/rigs/${rigId}/commands`, json('POST', { command })),
};

export type NightSession = Schemas['NightSessionListItem'];
export type NightSessionListItem = Schemas['NightSessionListItem'];
export type NightSessionProject = Schemas['NightSessionProject'];
export type NightSessionSummary = Schemas['NightSessionSummary'];
export type NightSessionDetail = Schemas['NightSessionDetail'];
export type NightSessionLineRow = Schemas['NightSessionLineRow'];
export type NightSessionCapture = Schemas['NightSessionCapture'];
export type NightSessionKpis = Schemas['NightSessionKpis'];
export type NightSessionReason = Schemas['NightSessionReason'];
export type CaptureRejectResult = Schemas['CaptureRejectResult'];

/** Sessions und Auswertung R1 (AP-15, S-60/S-61): Liste, Detail, Korrektur, geprüft, Zuordnung. */
export const sessionsApi = {
  /** Nächte seitenweise (AP-64): Zeitraum als Nacht-Schlüssel, Fortsetzung über `cursor`. */
  list: (
    query: {
      rigId?: string;
      unreviewed?: boolean;
      from?: string;
      to?: string;
      limit?: number;
      cursor?: string;
    } = {},
  ) => {
    const q = new URLSearchParams();
    if (query.rigId) q.set('rigId', query.rigId);
    if (query.unreviewed) q.set('unreviewed', 'true');
    if (query.from) q.set('from', query.from);
    if (query.to) q.set('to', query.to);
    if (query.limit) q.set('limit', String(query.limit));
    if (query.cursor) q.set('cursor', query.cursor);
    const s = q.toString();
    return apiFetch<{ items: NightSessionListItem[]; nextCursor: string | null }>(
      `${V1}/sessions${s ? `?${s}` : ''}`,
    );
  },
  /** Kennzahlen der Nächte für Rig und Zeitraum (AP-64). */
  summary: (query: { rigId?: string; from?: string; to?: string } = {}) => {
    const q = new URLSearchParams();
    if (query.rigId) q.set('rigId', query.rigId);
    if (query.from) q.set('from', query.from);
    if (query.to) q.set('to', query.to);
    const s = q.toString();
    return apiFetch<NightSessionSummary>(`${V1}/sessions/summary${s ? `?${s}` : ''}`);
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
export type ExoTransitView = Schemas['ExoTransitView'];
export type ExoTransitList = Schemas['ExoTransitList'];
export type ExoSearchSettings = Schemas['ExoSearchSettings'];
export type ExoProjectDetail = Schemas['ExoProjectDetail'];
export type ExoProjectCreated = Schemas['ExoProjectCreated'];
export type ExoEphemerisView = Schemas['ExoEphemerisView'];
export type ExoObservationView = Schemas['ExoObservationView'];
export type ExoProjectPatch = Schemas['ExoProjectPatch'];
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

/** Transitsuche S-22 (AP-42): Transits je Rig und Nacht. */
export const exoApi = {
  transits: (q: {
    rigId: string;
    night?: string | null;
    catalogs: readonly string[];
    minAltDeg: number;
  }) =>
    apiFetch<ExoTransitList>(
      `${V1}/exo/transits?${new URLSearchParams({
        rigId: q.rigId,
        ...(q.night ? { night: q.night } : {}),
        catalogs: [...q.catalogs].sort().join(','),
        minAltDeg: String(q.minAltDeg),
      }).toString()}`,
    ),
  /** Projekt aus einer Ergebniszeile anlegen bzw. das eigene öffnen (FA-EXO-15, OP-22). */
  createProject: (body: {
    id: string;
    rigId: string;
    catalog: string;
    planet: string;
    twilight: string;
    minAltDeg: number;
    exposureS: number | null;
  }) => apiFetch<ExoProjectCreated>(`${V1}/exo/projects`, json('POST', body)),
  /** Reiter *Exoplanet-Transit* (FA-EXO-16/17). */
  project: (projectId: string) => apiFetch<ExoProjectDetail>(`${V1}/projects/${projectId}/exo`),
  /** Neuere Katalog-Ephemeride übernehmen (FA-EXO-16). */
  refreshEphemeris: (projectId: string) =>
    apiFetch<ExoProjectDetail>(`${V1}/projects/${projectId}/ephemeris/refresh`, json('POST')),
  /** Transit festlegen bzw. wünschen (FA-EXO-18, transit.md §8). */
  lock: (projectId: string, epoch: number) =>
    apiFetch<ExoProjectDetail>(`${V1}/projects/${projectId}/exo/lock`, json('POST', { epoch })),
  /** Festlegung aufheben (→ storniert). */
  unlock: (projectId: string, observationId: string) =>
    apiFetch<ExoProjectDetail>(
      `${V1}/projects/${projectId}/exo/lock/${observationId}`,
      json('DELETE'),
    ),
  /** Transit-Einstellungen (FA-EXO-19/20). */
  patch: (projectId: string, body: ExoProjectPatch) =>
    apiFetch<ExoProjectDetail>(`${V1}/projects/${projectId}/exo`, json('PATCH', body)),
  /** Transit-Bestätigung in der Warteschlange (FA-EXO-18): festlegen bzw. ablehnen. */
  confirm: (observationId: string) =>
    apiFetch<undefined>(`${V1}/transit-observations/${observationId}/confirm`, json('POST')),
  decline: (observationId: string, comment: string) =>
    apiFetch<undefined>(
      `${V1}/transit-observations/${observationId}/decline`,
      json('POST', { comment }),
    ),
};

/** Objektkatalog (AP-20, S-21, Katalogsuche im Editor, S-82). */
export const catalogApi = {
  search: (s: DsoSearch) => apiFetch<DsoList>(`${V1}/dso?${dsoSearchParams(s)}`),
  /** Katalog-Overlay der Sternkarte (FA-FRM-09): Objekte im Umkreis, Dichte über `magMax`. */
  region: (
    q: { ra: number; dec: number; radius: number; magMax: number; limit?: number },
    signal?: AbortSignal,
  ) =>
    apiFetch<DsoRegion>(
      `${V1}/dso/region?${dsoSearchParams(q as unknown as DsoSearch)}`,
      signal ? { signal } : {},
    ),
  status: () => apiFetch<CatalogStatus>('/api/system/v1/catalogs'),
  /** Neu importieren (Job `catalog_refresh`): Objektkatalog oder Exoplaneten-Katalog (AP-40). */
  refresh: (catalog: 'dso' | 'exoclock' | 'nasa' | 'toi' = 'dso') =>
    apiFetch<{ jobId: string }>(`/api/system/v1/catalogs/${catalog}/refresh`, json('POST')),
};
