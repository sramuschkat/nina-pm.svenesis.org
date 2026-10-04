/**
 * Lokaler Webhook-Weg (nur `pnpm dev:api`, nie im Lambda-Bundle): Aufrufe an `discord.com`/`discordapp.com`
 * gehen an `tools/discord-mock` (`DISCORD_MOCK_URL`, CC-12) bzw. ohne Mock nur ins Log. Die Host-Prüfung
 * vor dem Senden bleibt unverändert – umgeleitet wird erst danach.
 */
import { logger } from '../lib/logger';
import type { FetchLike } from './webhook';

export function discordLocalFetch(mockUrl: string | undefined): FetchLike {
  return async (url, init) => {
    const path = new URL(url).pathname;
    if (!mockUrl) {
      logger.info('local_discord_post', { path: path.replace(/\/[\w-]+$/, '/…') });
      return new Response(null, { status: 204 });
    }
    return fetch(`${mockUrl.replace(/\/$/, '')}${path}${new URL(url).search}`, init);
  };
}
