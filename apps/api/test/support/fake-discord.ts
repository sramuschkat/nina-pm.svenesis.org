/**
 * Nachbildung von Discord OAuth2 für Tests: gibt Codes aus und prüft beim Tausch – wie Discord – dass
 * `SHA-256(code_verifier)` zur `code_challenge` der Anmeldung passt und der Code nur einmal gilt.
 */
import type { DiscordProfile } from '@nina-pm/db';
import type { CodeExchange, DiscordClient } from '../../src/auth/discord';
import { pkceChallenge } from '../../src/auth/crypto';

interface Grant {
  profile: DiscordProfile;
  challenge: string;
  redirectUri: string;
}

export class FakeDiscord implements DiscordClient {
  private grants = new Map<string, Grant>();
  private seq = 0;
  exchanges: CodeExchange[] = [];

  /** Zurücksetzen zwischen Tests (eine Instanz je Testdatei). */
  clear(): void {
    this.grants.clear();
    this.exchanges = [];
    this.seq = 0;
  }

  /** „Der Browser meldet sich bei Discord an“: liefert den Code für den Callback. */
  authorize(authorizeUrl: string, profile: DiscordProfile): { code: string; state: string } {
    const url = new URL(authorizeUrl);
    if (url.searchParams.get('code_challenge_method') !== 'S256') throw new Error('PKCE fehlt');
    this.seq += 1;
    const code = `code-${this.seq}`;
    this.grants.set(code, {
      profile,
      challenge: url.searchParams.get('code_challenge') ?? '',
      redirectUri: url.searchParams.get('redirect_uri') ?? '',
    });
    return { code, state: url.searchParams.get('state') ?? '' };
  }

  profile(exchange: CodeExchange): Promise<DiscordProfile> {
    this.exchanges.push(exchange);
    const grant = this.grants.get(exchange.code);
    this.grants.delete(exchange.code);
    if (!grant) return Promise.reject(new Error('invalid_grant: unbekannter Code'));
    if (pkceChallenge(exchange.codeVerifier) !== grant.challenge) {
      return Promise.reject(new Error('invalid_grant: code_verifier passt nicht'));
    }
    if (exchange.redirectUri !== grant.redirectUri)
      return Promise.reject(new Error('invalid_grant: redirect_uri'));
    return Promise.resolve(grant.profile);
  }
}

let discordSeq = 1000;
export function discordProfile(over: Partial<DiscordProfile> = {}): DiscordProfile {
  discordSeq += 1;
  return {
    discordUserId: `2000000000000${discordSeq}`,
    username: `tester${discordSeq}`,
    globalName: `Tester ${discordSeq}`,
    avatarHash: null,
    mfaEnabled: true,
    ...over,
  };
}
