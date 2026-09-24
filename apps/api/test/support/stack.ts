/**
 * Lokaler Test-Stack ohne Docker: API-App mit echten Repositories auf PGlite (alle Migrationen),
 * Discord-Nachbildung, verstellbarer Uhr und Cookie-Handhabung. Dieselben Tests laufen im CI.
 * Eine Instanz je Testdatei (`beforeAll`), zwischen den Tests `reset()` statt neuer Migrationen.
 */
import {
  AuditRepository,
  EquipmentRepository,
  ApprovalRepository,
  SimulationRepository,
  ProjectRepository,
  AuthRepository,
  JobRepository,
  MemberRepository,
  NotificationRepository,
  PreferenceRepository,
  TenantAdminRepository,
  readMaintenanceBanner,
  TenantRepository,
} from '@nina-pm/db';
import { openPglite, type PgliteDatabase } from '@nina-pm/db/testing/pglite';
import { COOKIE_NAMES } from '@nina-pm/shared';
import { createApp } from '../../src/app';
import { PROD_REDIRECT_URI } from '../../src/auth/config';
import { randomToken, sha256Hex } from '../../src/auth/crypto';
import type { ApiServices } from '../../src/routes/services';
import { FakeDiscord } from './fake-discord';
import type { DiscordProfile } from '@nina-pm/db';

export const ORIGIN_SECRET = 'a'.repeat(43);
export const COOKIE_SECRET = 'test-cookie-secret-0123456789abcdefghijklmnop';

export interface RequestOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly cookies?: Record<string, string>;
  readonly headers?: Record<string, string>;
  /** CSRF-Header weglassen (Standard: bei nicht-GET gesetzt). */
  readonly noCsrf?: boolean;
}

export function setCookies(res: Response): Record<string, { value: string; raw: string }> {
  const out: Record<string, { value: string; raw: string }> = {};
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(';');
    const index = pair?.indexOf('=') ?? -1;
    if (pair && index > 0) out[pair.slice(0, index)] = { value: pair.slice(index + 1), raw };
  }
  return out;
}

export async function createStack() {
  const pg: PgliteDatabase = await openPglite();
  const START = new Date('2026-09-24T10:00:00Z');
  let now = START;
  const discord = new FakeDiscord();
  let bootstrapIds: string[] = [];
  const auth = new AuthRepository(pg.db);
  const deletedFiles: string[] = [];
  const tenantFiles = {
    deleteTenantFiles: (tenantId: string) => {
      deletedFiles.push(tenantId);
      return Promise.resolve(0);
    },
  };
  const services: ApiServices = {
    repositories: (ctx) => ({
      job: new JobRepository(pg.db, ctx),
      member: new MemberRepository(pg.db, ctx),
      preference: () => new PreferenceRepository(pg.db, ctx),
      notification: () => new NotificationRepository(pg.db, ctx),
      audit: () => new AuditRepository(pg.db, ctx),
      equipment: () => new EquipmentRepository(pg.db, ctx),
      projects: () => new ProjectRepository(pg.db, ctx),
      approvals: () => new ApprovalRepository(pg.db, ctx),
      simulations: () => new SimulationRepository(pg.db, ctx),
      tenant: () => new TenantRepository(pg.db, ctx),
    }),
    tenantAdmin: (actor) => new TenantAdminRepository(pg.db, actor),
    auth,
    authConfig: {
      cookieSecret: () => Promise.resolve(COOKIE_SECRET),
      discordClientId: () => Promise.resolve('1552568154146742332'),
      discordClientSecret: () => Promise.resolve('test-client-secret'),
      bootstrapSuperUsers: () => Promise.resolve(bootstrapIds),
      redirectUri: PROD_REDIRECT_URI,
    },
    discord,
    downloads: {
      presignGet: (key) =>
        Promise.resolve({
          url: `https://svenesis-nina-pm-data.s3.eu-central-1.amazonaws.com/${key}?X-Amz-Signature=x`,
          expiresAt: '2026-09-24T10:15:00Z',
        }),
    },
    tenantFiles,
    maintenanceBanner: () => readMaintenanceBanner(pg.db),
    jobInvoker: { invoke: () => Promise.resolve() },
    now: () => now,
  };
  const app = createApp({
    originVerifyValue: () => Promise.resolve(ORIGIN_SECRET),
    buildId: 'test',
    services: () => Promise.resolve(services),
  });

  const request = (path: string, o: RequestOptions = {}) => {
    const method = o.method ?? 'GET';
    const headers: Record<string, string> = { 'x-origin-verify': ORIGIN_SECRET, ...o.headers };
    if (method !== 'GET' && !o.noCsrf) headers['x-npm-request'] = '1';
    if (o.body !== undefined) headers['content-type'] = 'application/json';
    if (o.cookies) {
      headers.cookie = Object.entries(o.cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
    }
    return app.request(path, {
      method,
      headers,
      ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
    });
  };

  const db = pg.admin;
  const uuid = () => crypto.randomUUID();

  const seed = {
    async tenant(key: string, status: 'active' | 'locked' = 'active') {
      const id = uuid();
      await db.query(
        'INSERT INTO tenant (id, tenant_key, display_name, status) VALUES ($1, $2, $3, $4)',
        [id, key, `Mandant ${key}`, status],
      );
      return id;
    },
    async identity(p: Partial<DiscordProfile> & { status?: 'active' | 'blocked' } = {}) {
      const id = uuid();
      const discordUserId =
        p.discordUserId ?? `3${String(Math.floor(Math.random() * 1e15)).padStart(17, '0')}`;
      await db.query(
        'INSERT INTO identity (id, discord_user_id, discord_username, mfa_enabled, status) VALUES ($1, $2, $3, $4, $5)',
        [
          id,
          discordUserId,
          p.username ?? `u${discordUserId.slice(-6)}`,
          p.mfaEnabled ?? true,
          p.status ?? 'active',
        ],
      );
      return { id, discordUserId };
    },
    async member(identityId: string, tenantId: string, role: 'admin' | 'user', status = 'active') {
      const id = uuid();
      await db.query(
        "INSERT INTO app_user (id, tenant_id, identity_id, display_name, role, status) VALUES ($1, $2, $3, 'Mitglied', $4, $5)",
        [id, tenantId, identityId, role, status],
      );
      return id;
    },
    async owner(tenantId: string, memberId: string) {
      await db.query('UPDATE tenant SET owner_member_id = $1 WHERE id = $2', [memberId, tenantId]);
    },
    async superUser(identityId: string, status: 'active' | 'disabled' = 'active') {
      await db.query('INSERT INTO super_user (identity_id, status) VALUES ($1, $2)', [
        identityId,
        status,
      ]);
    },
    async invitation(
      tenantId: string,
      role: 'owner' | 'admin' | 'user',
      over: { discordUserId?: string; expiresAt?: Date; maxUses?: number } = {},
    ) {
      const token = randomToken();
      await db.query(
        'INSERT INTO invitation (tenant_id, token_hash, role, discord_user_id, max_uses, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [
          tenantId,
          sha256Hex(token),
          role,
          over.discordUserId ?? null,
          over.maxUses ?? 1,
          (over.expiresAt ?? new Date(now.getTime() + 7 * 86_400_000)).toISOString(),
        ],
      );
      return token;
    },
    /** Sitzung direkt anlegen (ohne Discord) – liefert den Cookie-Wert. */
    async session(
      identityId: string,
      tenantId: string | null,
      context: 'tenant' | 'system' | 'select',
    ) {
      const sid = randomToken();
      await auth.createSession({
        sessionHash: sha256Hex(sid),
        identityId,
        tenantId,
        context,
        userAgent: null,
        ipTruncated: null,
        now,
      });
      return sid;
    },
  };

  /** Kompletter Anmeldeablauf: start → Discord → callback. */
  async function login(
    profile: DiscordProfile,
    o: {
      next?: string;
      mandant?: string;
      cookies?: Record<string, string>;
      headers?: Record<string, string>;
    } = {},
  ) {
    const q = new URLSearchParams();
    if (o.next !== undefined) q.set('next', o.next);
    if (o.mandant !== undefined) q.set('mandant', o.mandant);
    const start = await request(`/api/auth/discord/start?${q.toString()}`);
    const oauth = setCookies(start)[COOKIE_NAMES.oauth]?.value ?? '';
    const { code, state } = discord.authorize(start.headers.get('location') ?? '', profile);
    const callback = await request(`/api/auth/discord/callback?code=${code}&state=${state}`, {
      cookies: { [COOKIE_NAMES.oauth]: oauth, ...o.cookies },
      ...(o.headers ? { headers: o.headers } : {}),
    });
    const sid = setCookies(callback)[COOKIE_NAMES.session]?.value;
    return { start, callback, location: callback.headers.get('location'), sid, oauth };
  }

  return {
    app,
    pg,
    services,
    discord,
    request,
    deletedFiles,
    seed,
    login,
    clock: {
      now: () => now,
      set: (d: Date) => (now = d),
      advance: (ms: number) => (now = new Date(now.getTime() + ms)),
    },
    setBootstrapIds: (ids: string[]) => (bootstrapIds = ids),
    /** Ausgangszustand für den nächsten Test: leere Tabellen, Uhr, Discord-Nachbildung, Bootstrap-Liste. */
    reset: async () => {
      await pg.reset();
      now = START;
      discord.clear();
      bootstrapIds = [];
    },
    close: () => pg.close(),
  };
}

export type Stack = Awaited<ReturnType<typeof createStack>>;
