/**
 * Gemeinsamer `httpClient` für ausgehende Aufrufe (TK 14): Zeitlimit je Aufruf (Standard 10 s), zwei
 * Wiederholungen mit exponentiellem Abstand, User-Agent `Svenesis-NINA-PM/<version>`. Wiederholt werden
 * Netzfehler und Zeitüberschreitungen, `429`/`5xx` nur mit `retryOnStatus` – der Hauptabruf des Wetters
 * endet dort ohne Wiederholung (TK 13).
 */
export const USER_AGENT_BASE = 'Svenesis-NINA-PM';
export const SITE_URL = 'https://nina-pm.svenesis.org';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${String(status)}`);
    this.name = 'HttpError';
  }
}

export interface HttpClientOptions {
  readonly fetchImpl?: typeof fetch;
  readonly version?: string;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface GetJsonOptions {
  readonly timeoutMs?: number;
  readonly retries?: number;
  readonly retryOnStatus?: boolean;
}

export interface HttpClient {
  getJson(url: string, options?: GetJsonOptions): Promise<unknown>;
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export function httpClient(options: HttpClientOptions = {}): HttpClient {
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? wait;
  const userAgent = `${USER_AGENT_BASE}/${options.version ?? 'dev'} (+${SITE_URL})`;
  return {
    async getJson(url, o = {}) {
      const retries = o.retries ?? 2;
      let lastError: unknown;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        if (attempt > 0) await sleep(500 * 2 ** (attempt - 1));
        try {
          const res = await doFetch(url, {
            headers: { 'user-agent': userAgent, accept: 'application/json' },
            signal: AbortSignal.timeout(o.timeoutMs ?? 10_000),
          });
          if (!res.ok) {
            const error = new HttpError(res.status, url);
            const transient = res.status === 429 || res.status >= 500;
            if (!(o.retryOnStatus ?? true) || !transient) throw error;
            lastError = error;
            continue;
          }
          return (await res.json()) as unknown;
        } catch (error) {
          // Wiederholbare Statusantworten landen nicht hier (oben `continue`), alle übrigen enden sofort.
          if (error instanceof HttpError) throw error;
          lastError = error;
        }
      }
      throw lastError instanceof Error ? lastError : new Error('Abruf fehlgeschlagen');
    },
  };
}
