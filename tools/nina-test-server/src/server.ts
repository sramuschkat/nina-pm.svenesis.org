/**
 * NINA-Test-Server (AP-16a, execution.md §9, ops/plugin-test-protocol.md): die NINA-API unter `/api/nina/v1` für
 * die Plugin-Protokolle tagsüber. Jede Antwort trägt `X-NPM-Test: 1` (NIN-17 Bedingung c) und wird vor dem
 * Senden gegen die zod-Verträge aus `packages/shared` geprüft – eine Abweichung ist ein Fehler des Servers (500).
 * Steuerung über `POST /test/actions {action}`, Auswertung über `GET /test/report`. Token: `npm_test` (weitere
 * Instanzen im Szenario `lease`: `npm_test2`, …).
 */
import { nina } from '@nina-pm/shared';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { z } from 'zod';
import { uuidFor } from './examples';
import { loadRig, loadScenario, type RigConfig, type Scenario } from './scenario';
import { freshState, TestWorld } from './world';

type Json = Record<string, unknown>;

export interface TestRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body?: unknown;
}

export interface TestResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body?: unknown;
}

/** `drop_responses`: Anfrage annehmen, aber nie antworten (ersetzt das Trennen des Netzes, P-09). */
export const DROP = Symbol('drop');

export const TEST_ACTIONS = [
  'targets_change',
  'pause_project',
  'lock_transit',
  'skip_block',
  'lease_release',
  'rig_busy',
  'revoke_token',
  'drop_responses',
  'restore_responses',
  'clock_skew',
  'filter_wheel_changed',
  'clear',
] as const;
export type TestAction = (typeof TEST_ACTIONS)[number];

interface SessionRecord {
  id: string;
  instance: string;
  night: string;
  nightPlanId: string | null;
  status: 'running' | 'completed' | 'aborted';
  offline: boolean;
  startedAtUtc: string;
  patches: Json[];
}

const NINA = '/api/nina/v1';
const iso = (sec: number) => new Date(Math.round(sec) * 1000).toISOString().replace('.000Z', 'Z');

export class NinaTestServer {
  readonly world: TestWorld;
  private readonly tokens: Map<string, string>;
  private flags = { revoked: false, rigBusy: false, drop: false, leaseRelease: false };
  private lease: { sessionId: string; instance: string; untilS: number } | null = null;
  private appliedTimeline = new Set<number>();
  readonly sessions = new Map<string, SessionRecord>();
  readonly captures: Json[] = [];
  readonly events: Json[] = [];
  readonly plans: Json[] = [];
  readonly actions: Json[] = [];
  heartbeats = 0;
  lastHeartbeat: Json | null = null;

  constructor(
    readonly scenario: Scenario,
    rig: RigConfig = loadRig(),
    readonly nowS: () => number = () => Date.now() / 1000,
  ) {
    this.world = new TestWorld(scenario, rig, nowS, freshState());
    this.tokens = new Map([['npm_test', 'Test-Instanz 1']]);
    for (let i = 0; i < (scenario.extraInstances ?? 0); i += 1)
      this.tokens.set(`npm_test${String(i + 2)}`, `Test-Instanz ${String(i + 2)}`);
  }

  // ---- Anfrage → Antwort -------------------------------------------------------------------------

  async handle(req: TestRequest): Promise<TestResponse | typeof DROP> {
    await Promise.resolve();
    this.runTimeline();
    if (req.path.startsWith('/test/')) return this.testRoute(req);
    if (!req.path.startsWith(NINA)) return problem(404, 'resource.not_found', 'Unbekannter Pfad');
    if (this.flags.drop) return DROP;

    const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
    const instance = this.tokens.get(token);
    if (this.flags.revoked || !instance)
      return problem(401, 'nina.token_invalid', 'Token ungültig oder widerrufen');

    const route = req.path.slice(NINA.length);
    const key = `${req.method} ${route.replace(/\/sessions\/[^/]+/, '/sessions/{id}')}`;
    switch (key) {
      case 'GET /bootstrap':
        return ok(nina.NinaBootstrap, this.world.bootstrap(instance));
      case 'GET /targets': {
        const etag = this.world.targetsEtag();
        if (req.headers['if-none-match'] === etag)
          return { status: 304, headers: { ...testHeaders(), etag } };
        return ok(nina.NinaTargets, this.world.targets(), { etag });
      }
      case 'POST /plan':
        return this.plan(req.body);
      case 'POST /sessions':
        return this.createSession(req.body, instance);
      case 'PATCH /sessions/{id}':
        return this.patchSession(sessionIdOf(route), req.body, instance);
      case 'POST /sessions/{id}/captures':
        return this.ingest(sessionIdOf(route), nina.NinaCaptureBatch, req.body, 'captures');
      case 'POST /sessions/{id}/events':
        return this.ingest(sessionIdOf(route), nina.NinaEventBatch, req.body, 'events');
      case 'POST /heartbeat':
        return this.heartbeat(req.body, instance);
      default:
        return problem(404, 'resource.not_found', `${req.method} ${req.path}`);
    }
  }

  private plan(body: unknown): TestResponse {
    const r = nina.NinaPlanRequest.safeParse(body);
    if (!r.success) return invalid(r.error);
    if (!this.world.validNights().includes(r.data.night))
      return problem(
        422,
        'nina.night_invalid',
        `Nacht ${r.data.night} ist weder die aktuelle noch die folgende`,
      );
    const plan = this.world.plan(r.data.night, r.data as unknown as Json);
    this.plans.push({
      nightPlanId: plan.nightPlanId,
      revision: plan.revision,
      reason: r.data.reason,
      night: plan.night,
      blocks: (plan.blocks as Json[]).length,
      atUtc: iso(this.world.serverTimeS()),
    });
    return ok(nina.NinaPlanResponse, plan);
  }

  private leaseFor(sessionId: string, instance: string) {
    const now = this.nowS();
    const minutes = 3;
    const free = !this.lease || this.lease.untilS < now || this.lease.sessionId === sessionId;
    if (free) this.lease = { sessionId, instance, untilS: now + minutes * 60 };
    return { ok: free || this.lease?.instance === instance, untilS: this.lease?.untilS ?? now };
  }

  private createSession(body: unknown, instance: string): TestResponse {
    const r = nina.NinaSessionCreate.safeParse(body);
    if (!r.success) return invalid(r.error);
    if (!this.world.validNights().includes(r.data.night))
      return problem(
        422,
        'nina.night_invalid',
        `Nacht ${r.data.night} ist weder die aktuelle noch die folgende`,
      );
    const existing = this.sessions.get(r.data.id);
    if (!existing) {
      const held =
        this.lease && this.lease.untilS >= this.nowS() && this.lease.instance !== instance;
      if ((this.flags.rigBusy || held) && !r.data.offline)
        return problem(
          409,
          'session.rig_busy',
          'Das Rig wird von einer anderen NINA-Instanz belegt',
        );
      this.sessions.set(r.data.id, {
        id: r.data.id,
        instance,
        night: r.data.night,
        nightPlanId: r.data.nightPlanId,
        status: 'running',
        offline: r.data.offline,
        startedAtUtc: r.data.startedAtUtc,
        patches: [],
      });
    }
    const lease = r.data.offline ? null : this.leaseFor(r.data.id, instance);
    return ok(
      nina.NinaSessionCreated,
      {
        sessionId: r.data.id,
        lease: { untilUtc: lease ? iso(lease.untilS) : null },
        planLogUploadUrl: 'http://localhost/test/plan-log',
        planLogUploadFields: {},
      },
      {},
      existing ? 200 : 201,
    );
  }

  private patchSession(id: string, body: unknown, instance: string): TestResponse {
    const r = nina.NinaSessionPatch.safeParse(body);
    if (!r.success) return invalid(r.error);
    const s = this.sessions.get(id);
    if (!s) return problem(409, 'session.unknown', 'Session unbekannt');
    if (r.data.status === 'running') {
      if (s.status !== 'running')
        return problem(409, 'session.closed', 'Session ist abgeschlossen');
      if (this.flags.rigBusy)
        return problem(
          409,
          'session.rig_busy',
          'Das Rig wird von einer anderen NINA-Instanz belegt',
        );
    }
    s.patches.push(r.data as unknown as Json);
    if (r.data.status === 'completed' || r.data.status === 'aborted') s.status = r.data.status;
    if (r.data.offlinePlan) s.nightPlanId = r.data.offlinePlan.nightPlanId;
    const lease = s.status === 'running' ? this.leaseFor(id, instance) : null;
    return ok(nina.NinaSessionPatched, {
      sessionId: id,
      status: s.status,
      lease: { untilUtc: lease ? iso(lease.untilS) : null, leaseLost: lease ? !lease.ok : false },
      nightPlanId: s.nightPlanId,
      reportStatus: s.status === 'completed' && r.data.outboxPending === 0 ? 'pending' : 'none',
    });
  }

  private ingest(
    sessionId: string,
    schema: typeof nina.NinaCaptureBatch | typeof nina.NinaEventBatch,
    body: unknown,
    kind: 'captures' | 'events',
  ): TestResponse {
    if (!this.sessions.has(sessionId)) return problem(409, 'session.unknown', 'Session unbekannt');
    const r = schema.safeParse(body);
    if (!r.success) return invalid(r.error);
    if (kind === 'captures') {
      const results = (r.data as z.infer<typeof nina.NinaCaptureBatch>).captures.map((c) => {
        const duplicate = this.captures.some((x) => x.id === c.id);
        if (!duplicate) this.captures.push({ sessionId, ...c });
        return { id: c.id, status: duplicate ? 'duplicate' : 'accepted' };
      });
      return ok(nina.NinaCaptureResults, { results });
    }
    let accepted = 0;
    let duplicate = 0;
    for (const e of (r.data as z.infer<typeof nina.NinaEventBatch>).events) {
      if (this.events.some((x) => x.id === e.id)) duplicate += 1;
      else {
        this.events.push({ sessionId, ...e });
        accepted += 1;
      }
    }
    return ok(nina.NinaEventResults, { accepted, duplicate });
  }

  private heartbeat(body: unknown, instance: string): TestResponse {
    const r = nina.NinaHeartbeat.safeParse(body);
    if (!r.success) return invalid(r.error);
    this.heartbeats += 1;
    this.lastHeartbeat = { instance, ...(r.data as unknown as Json) };
    let lease: { untilUtc: string | null; leaseLost: boolean } | null = null;
    if (r.data.sessionId && this.sessions.get(r.data.sessionId)?.status === 'running') {
      if (this.flags.leaseRelease) {
        // lease_release (P-17): die Lease ist weg, eine andere Instanz könnte übernehmen.
        this.flags.leaseRelease = false;
        this.lease = null;
        lease = { untilUtc: null, leaseLost: true };
      } else {
        const l = this.leaseFor(r.data.sessionId, instance);
        lease = { untilUtc: iso(l.untilS), leaseLost: !l.ok };
      }
    }
    return ok(nina.NinaHeartbeatResponse, {
      serverTimeUtc: iso(this.world.serverTimeS()),
      lease,
      settingsVersion: 7,
      targetsEtag: this.world.targetsEtag(),
      commands: [],
    });
  }

  // ---- Steuerung ----------------------------------------------------------------------------------

  private testRoute(req: TestRequest): TestResponse {
    if (req.method === 'GET' && req.path === '/test/report') return json(200, this.report());
    if (req.method === 'POST' && req.path === '/test/actions') {
      const body = (req.body ?? {}) as { action?: string; seconds?: number };
      if (!TEST_ACTIONS.includes(body.action as TestAction))
        return problem(
          422,
          'validation.failed',
          `action muss eine von ${TEST_ACTIONS.join(', ')} sein`,
        );
      this.apply(body.action as TestAction, body.seconds);
      return json(200, { ok: true, action: body.action });
    }
    if (req.method === 'POST' && req.path === '/test/plan-log') return json(204, undefined);
    return problem(404, 'resource.not_found', `${req.method} ${req.path}`);
  }

  apply(action: TestAction, seconds?: number): void {
    const s = this.world.state;
    this.actions.push({
      action,
      ...(seconds !== undefined ? { seconds } : {}),
      atUtc: iso(this.nowS()),
    });
    switch (action) {
      case 'targets_change':
        s.targetsVersion += 1;
        break;
      case 'pause_project': {
        const active = this.world.projects().find((p) => p.status === 'active');
        if (active) s.pausedProjects.add(active.id as string);
        s.targetsVersion += 1;
        break;
      }
      case 'lock_transit':
        s.transitLocked = true;
        s.targetsVersion += 1;
        break;
      case 'skip_block': {
        const now = this.nowS();
        const running = this.world.timeline().find((b) => b.startS <= now && now < b.endS);
        if (running) s.skippedBlocks.add(uuidFor(`block:${String(running.index)}`));
        break;
      }
      case 'lease_release':
        this.flags.leaseRelease = true;
        break;
      case 'rig_busy':
        this.flags.rigBusy = true;
        break;
      case 'revoke_token':
        this.flags.revoked = true;
        break;
      case 'drop_responses':
        this.flags.drop = true;
        break;
      case 'restore_responses':
        this.flags.drop = false;
        break;
      case 'clock_skew':
        s.clockSkewS = seconds ?? 90;
        break;
      case 'filter_wheel_changed':
        s.filterWheelChanged = true;
        s.targetsVersion += 1;
        break;
      case 'clear':
        this.flags = { revoked: false, rigBusy: false, drop: false, leaseRelease: false };
        Object.assign(s, {
          ...freshState(),
          targetsVersion: s.targetsVersion + 1,
          planRevision: s.planRevision,
        });
        break;
    }
  }

  /** Aktionen der Szenario-Zeitleiste, sobald ihre Minute erreicht ist (je einmal). */
  private runTimeline(): void {
    const elapsedMin = (this.nowS() - this.world.epochS) / 60;
    (this.scenario.timeline ?? []).forEach((t, i) => {
      if (elapsedMin >= t.atMin && !this.appliedTimeline.has(i)) {
        this.appliedTimeline.add(i);
        this.apply(t.action as TestAction, t.seconds);
      }
    });
  }

  report(): Json {
    return {
      scenario: this.scenario.name,
      epochUtc: iso(this.world.epochS),
      nowUtc: iso(this.nowS()),
      flags: this.flags,
      targetsEtag: this.world.targetsEtag(),
      plans: this.plans,
      sessions: [...this.sessions.values()],
      captures: this.captures,
      events: this.events,
      heartbeats: { count: this.heartbeats, last: this.lastHeartbeat },
      actions: this.actions,
      skippedBlocks: [...this.world.state.skippedBlocks],
    };
  }

  // ---- HTTP ---------------------------------------------------------------------------------------

  listen(port: number, host = '0.0.0.0'): Promise<Server> {
    const server = createServer((req, res) => void this.serve(req, res));
    return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
  }

  private async serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      return send(res, problem(422, 'validation.failed', 'JSON ungültig'));
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v]),
    );
    const r = await this.handle({ method: req.method ?? 'GET', path: url.pathname, headers, body });
    if (r === DROP) return; // Verbindung bleibt offen, bis der Client aufgibt.
    send(res, r);
  }
}

function sessionIdOf(route: string): string {
  return /\/sessions\/([^/]+)/.exec(route)?.[1] ?? '';
}

const testHeaders = () => ({ 'x-npm-test': '1' });

function json(status: number, body: unknown, extra: Record<string, string> = {}): TestResponse {
  return {
    status,
    headers: { ...testHeaders(), 'content-type': 'application/json', ...extra },
    body,
  };
}

function ok<S extends z.ZodType>(
  schema: S,
  body: unknown,
  extra: Record<string, string> = {},
  status = 200,
): TestResponse {
  const r = schema.safeParse(body);
  if (!r.success)
    return json(500, { code: 'test.contract_violation', issues: r.error.issues.slice(0, 20) });
  return json(status, body, extra);
}

function problem(status: number, code: string, title: string, errors?: unknown): TestResponse {
  return {
    status,
    headers: { ...testHeaders(), 'content-type': 'application/problem+json' },
    body: { type: 'about:blank', title, status, code, ...(errors ? { errors } : {}) },
  };
}

function invalid(error: z.ZodError): TestResponse {
  return problem(
    422,
    'validation.failed',
    'Anfrage entspricht nicht dem Vertrag',
    error.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message })),
  );
}

function send(res: ServerResponse, r: TestResponse): void {
  res.writeHead(r.status, r.headers);
  res.end(r.body === undefined ? undefined : JSON.stringify(r.body));
}

export function createTestServer(name: string, nowS?: () => number): NinaTestServer {
  return new NinaTestServer(loadScenario(name), loadRig(), nowS);
}
