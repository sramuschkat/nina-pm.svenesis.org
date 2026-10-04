/**
 * Discord-Webhook-Mock (CC-12, AP-60): nimmt `POST /api/webhooks/<id>/<token>` an, merkt sich jeden
 * Aufruf und antwortet nach Drehbuch – je Aufruf der nächste Eintrag aus `script`, danach `fallback`.
 * Damit prüfen die Tests 429 (`retry_after`), 5xx, 404 und 302 ohne Netz; `pnpm discord-mock` startet ihn
 * für `pnpm dev:api` (`DISCORD_MOCK_URL=http://127.0.0.1:3399`).
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockReply {
  readonly status: number;
  /** JSON-Antwort, z. B. `{ retry_after: 1.5 }` bei 429. */
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface MockCall {
  readonly path: string;
  readonly query: string;
  readonly body: unknown;
}

export interface DiscordMock {
  readonly url: string;
  readonly calls: MockCall[];
  /** Antworten der nächsten Aufrufe (in Reihenfolge). */
  script(...replies: MockReply[]): void;
  /** Zurücksetzen: Aufrufe und Drehbuch leeren. */
  reset(): void;
  close(): Promise<void>;
}

const read = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

export async function startDiscordMock(
  opts: { port?: number; fallback?: MockReply; onCall?: (call: MockCall) => void } = {},
): Promise<DiscordMock> {
  const calls: MockCall[] = [];
  let queue: MockReply[] = [];
  const fallback = opts.fallback ?? { status: 200, body: { id: '1', type: 0 } };
  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method !== 'POST' || !/^\/api\/webhooks\/\d+\/[\w-]+$/.test(url.pathname)) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'Unknown Webhook', code: 10015 }));
        return;
      }
      const raw = await read(req);
      let body: unknown = raw;
      try {
        body = JSON.parse(raw) as unknown;
      } catch {
        // Rohtext behalten.
      }
      const call = { path: url.pathname, query: url.search, body };
      calls.push(call);
      opts.onCall?.(call);
      const reply = queue.shift() ?? fallback;
      res.writeHead(reply.status, { 'content-type': 'application/json', ...(reply.headers ?? {}) });
      res.end(reply.body === undefined ? '' : JSON.stringify(reply.body));
    })();
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    script: (...replies) => {
      queue = [...queue, ...replies];
    },
    reset: () => {
      calls.length = 0;
      queue = [];
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * `fetch`, das Aufrufe an `discord.com`/`discordapp.com` an den Mock umleitet (Pfad und Abfrage bleiben).
 * Die Host-Prüfung des Senders läuft vorher auf der echten URL.
 */
export function mockFetch(mock: Pick<DiscordMock, 'url'>) {
  return (url: string, init: RequestInit) => {
    const u = new URL(url);
    if (u.hostname !== 'discord.com' && u.hostname !== 'discordapp.com')
      throw new Error(`discord-mock: unerwarteter Host ${u.hostname}`);
    return fetch(`${mock.url}${u.pathname}${u.search}`, init);
  };
}
