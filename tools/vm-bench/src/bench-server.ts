/**
 * Prüfstand-Server auf dem Mac: Auftragswarteschlange für den Agenten in der Windows-VM. Der Agent fragt
 * `GET /agent/next` (Kopf `X-Bench-Key`), lädt bereitgestellte Dateien (`GET /files/<name>`), lädt Ergebnisse hoch
 * (`PUT /agent/upload/<auftrag>/<datei>`) und meldet den Abschluss (`POST /agent/done/<auftrag>`). Die Einrichtungs-
 * und Agentenskripte liegen ohne Schlüssel unter `/setup/…` (sie enthalten keine Geheimnisse).
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

/** Aufträge, die der Agent kennt (feste Liste; alles andere lehnt er ab). */
export type JobType =
  | 'ping'
  | 'restart-nina'
  | 'set-trained-flats'
  | 'stop-nina'
  | 'install-plugin'
  | 'put-sequence'
  | 'collect-log'
  | 'app-events'
  | 'update-agent'
  | 'clone-profile';

export interface Job {
  readonly id: string;
  readonly type: JobType;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface JobResult {
  readonly ok: boolean;
  readonly message: string;
  /** Hochgeladene Dateien (Name → Pfad auf dem Mac). */
  readonly files: Readonly<Record<string, string>>;
}

export interface AgentInfo {
  readonly lastSeen: Date;
  readonly nina: string;
  readonly host: string;
}

const SETUP_DIR = fileURLToPath(new URL('../agent/', import.meta.url));
const SETUP_FILES = ['Install-NinaPmBench.ps1', 'NinaPmBenchAgent.ps1'];
const MAX_UPLOAD = 64 * 1024 * 1024;

interface Pending {
  readonly job: Job;
  readonly outDir: string;
  readonly files: Record<string, string>;
  taken: boolean;
  resolve: (r: JobResult) => void;
}

export class BenchServer {
  private readonly queue: Pending[] = [];
  private readonly staged = new Map<string, { path: string; sha256: string }>();
  private http?: Server;
  agent?: AgentInfo;

  constructor(private readonly key: string) {}

  /** Datei für den Agenten bereitstellen; liefert Name und SHA-256 (der Agent prüft ihn). */
  stage(path: string): { name: string; sha256: string } {
    const name = basename(path);
    const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
    this.staged.set(name, { path, sha256 });
    return { name, sha256 };
  }

  /** Auftrag einreihen; erfüllt sich mit dem Ergebnis des Agenten. */
  enqueue(type: JobType, args: Record<string, unknown>, outDir: string): Promise<JobResult> {
    return new Promise((resolve) => {
      this.queue.push({
        job: { id: randomUUID(), type, args },
        outDir,
        files: {},
        taken: false,
        resolve,
      });
    });
  }

  /** Wartet, bis der Agent sich meldet (höchstens `timeoutMs`). */
  async waitForAgent(timeoutMs: number): Promise<AgentInfo | undefined> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (this.agent && Date.now() - this.agent.lastSeen.getTime() < 15_000) return this.agent;
      await new Promise((r) => setTimeout(r, 500));
    }
    return undefined;
  }

  listen(port: number, host = '0.0.0.0'): Promise<Server> {
    this.http = createServer((req, res) => {
      this.handle(req, res).catch((e: unknown) => send(res, 500, { error: String(e) }));
    });
    const http = this.http;
    return new Promise((done) => http.listen(port, host, () => done(http)));
  }

  close(): void {
    this.http?.close();
  }

  private authorized(req: IncomingMessage): boolean {
    const given = Buffer.from(String(req.headers['x-bench-key'] ?? ''));
    const want = Buffer.from(this.key);
    return given.length === want.length && timingSafeEqual(given, want);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://bench');
    const parts = url.pathname.split('/').filter(Boolean);
    if (
      req.method === 'GET' &&
      parts[0] === 'setup' &&
      parts.length === 2 &&
      SETUP_FILES.includes(parts[1] ?? '')
    ) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(readFileSync(join(SETUP_DIR, parts[1] ?? '')));
      return;
    }
    if (!this.authorized(req)) return send(res, 401, { error: 'X-Bench-Key fehlt oder falsch' });

    if (req.method === 'GET' && url.pathname === '/agent/next') {
      this.agent = {
        lastSeen: new Date(),
        nina: url.searchParams.get('nina') ?? '?',
        host: url.searchParams.get('host') ?? '?',
      };
      const next = this.queue.find((p) => !p.taken);
      if (!next) return void res.writeHead(204).end();
      next.taken = true;
      return send(res, 200, next.job);
    }
    if (req.method === 'GET' && parts[0] === 'files' && parts.length === 2) {
      const f = this.staged.get(parts[1] ?? '');
      if (!f) return send(res, 404, { error: 'Datei nicht bereitgestellt' });
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-sha256': f.sha256 });
      res.end(readFileSync(f.path));
      return;
    }
    const pending = this.queue.find((p) => p.job.id === parts[2]);
    if (
      req.method === 'PUT' &&
      parts[0] === 'agent' &&
      parts[1] === 'upload' &&
      parts.length === 4
    ) {
      if (!pending) return send(res, 404, { error: 'Auftrag unbekannt' });
      const name = basename(parts[3] ?? '');
      const body = await readBody(req, MAX_UPLOAD);
      mkdirSync(pending.outDir, { recursive: true });
      const path = join(pending.outDir, name);
      writeFileSync(path, body);
      pending.files[name] = path;
      return send(res, 200, { saved: name, bytes: body.length });
    }
    if (
      req.method === 'POST' &&
      parts[0] === 'agent' &&
      parts[1] === 'done' &&
      parts.length === 3
    ) {
      if (!pending) return send(res, 404, { error: 'Auftrag unbekannt' });
      const r = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8') || '{}') as {
        ok?: boolean;
        message?: string;
      };
      this.queue.splice(this.queue.indexOf(pending), 1);
      pending.resolve({ ok: r.ok === true, message: r.message ?? '', files: pending.files });
      return send(res, 200, { done: pending.job.id });
    }
    send(res, 404, { error: `unbekannt: ${req.method ?? ''} ${url.pathname}` });
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        fail(new Error('zu groß'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => done(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}
