/**
 * Webhook-Aufruf (TK 7.7, FA-DIS-02, SV-10): vor **jedem** Senden Host und Form der URL prüfen, keine
 * Weiterleitungen (`redirect: 'manual'` – eine 3xx-Antwort ist ein Fehler), `?wait=true`, Zeitlimit.
 * Die URL selbst erscheint nie in Ergebnis, Fehlertext oder Log.
 */
import { isDiscordWebhookUrl } from '@nina-pm/shared';

export interface DiscordMessage {
  readonly username: string;
  readonly content?: string;
  readonly embeds: readonly object[];
  readonly allowed_mentions: { readonly parse: readonly [] };
}

export type WebhookResult =
  | { readonly kind: 'ok' }
  /** `429`: erst nach `retryAfterS` erneut versuchen. */
  | { readonly kind: 'rate_limited'; readonly retryAfterS: number }
  /** `5xx` oder Netzfehler/Zeitüberschreitung: später erneut. */
  | { readonly kind: 'retry'; readonly status: number | null }
  /** `401`/`403`/`404`: Webhook gelöscht bzw. nicht berechtigt – Kanal deaktivieren (FA-DIS-05). */
  | { readonly kind: 'gone'; readonly status: number }
  /** `3xx`: nicht gefolgt, Zustellung als Fehler. */
  | { readonly kind: 'redirect'; readonly status: number }
  /** Übrige `4xx` (z. B. `400` bei ungültigem Embed): kein Wiederholen. */
  | { readonly kind: 'rejected'; readonly status: number }
  /** URL fehlt oder hält der Prüfung nicht stand: nicht aufgerufen. */
  | { readonly kind: 'invalid' };

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export const WEBHOOK_TIMEOUT_MS = 10_000;

async function retryAfterSeconds(res: Response): Promise<number> {
  const header = Number(res.headers.get('retry-after'));
  try {
    const body = (await res.json()) as { retry_after?: unknown };
    if (typeof body.retry_after === 'number' && Number.isFinite(body.retry_after))
      return Math.max(0, body.retry_after);
  } catch {
    // Kein JSON – Header nehmen.
  }
  return Number.isFinite(header) && header > 0 ? header : 5;
}

export async function postWebhook(
  url: string | null,
  message: DiscordMessage,
  fetchImpl: FetchLike = fetch,
  timeoutMs = WEBHOOK_TIMEOUT_MS,
): Promise<WebhookResult> {
  if (!isDiscordWebhookUrl(url)) return { kind: 'invalid' };
  let res: Response;
  try {
    res = await fetchImpl(`${url}?wait=true`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Svenesis-NINA-PM (nina-pm.svenesis.org)',
      },
      body: JSON.stringify(message),
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { kind: 'retry', status: null };
  }
  const status = res.status;
  // `redirect: 'manual'` liefert in Node eine 3xx-Antwort (bzw. `opaqueredirect` mit Status 0).
  if ((status >= 300 && status < 400) || res.type === 'opaqueredirect')
    return { kind: 'redirect', status };
  if (status >= 200 && status < 300) return { kind: 'ok' };
  if (status === 429) return { kind: 'rate_limited', retryAfterS: await retryAfterSeconds(res) };
  if (status === 401 || status === 403 || status === 404) return { kind: 'gone', status };
  if (status >= 500) return { kind: 'retry', status };
  return { kind: 'rejected', status };
}
