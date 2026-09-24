/**
 * Discord OAuth2 (TK 5.1, 5.2): vertraulicher Client, Scope `identify`, PKCE S256. Das Access-Token
 * wird nach dem Abruf von `/users/@me` verworfen und nie gespeichert oder geloggt.
 */
import type { DiscordProfile } from '@nina-pm/db';

export const DISCORD_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const DISCORD_API = 'https://discord.com/api/v10';
const TIMEOUT_MS = 10_000;

export interface AuthorizeParams {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
}

export function authorizeUrl(p: AuthorizeParams): string {
  const url = new URL(DISCORD_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId,
    scope: 'identify',
    state: p.state,
    redirect_uri: p.redirectUri,
    code_challenge: p.codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'none',
  }).toString();
  return url.toString();
}

export interface CodeExchange {
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

/** Schnittstelle zu Discord – im Test durch eine Nachbildung ersetzt, die PKCE wie Discord prüft. */
export interface DiscordClient {
  /** Liefert das Profil zum Code; wirft bei jedem Fehler (falscher Code, falscher Verifier …). */
  profile(exchange: CodeExchange): Promise<DiscordProfile>;
}

export class DiscordError extends Error {
  constructor(
    readonly step: 'token' | 'me',
    readonly status: number,
  ) {
    super(`Discord ${step} fehlgeschlagen (HTTP ${status})`);
  }
}

export function httpDiscordClient(fetchImpl: typeof fetch = fetch): DiscordClient {
  return {
    async profile(x) {
      const token = await fetchImpl(`${DISCORD_API}/oauth2/token`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: x.code,
          redirect_uri: x.redirectUri,
          code_verifier: x.codeVerifier,
          client_id: x.clientId,
          client_secret: x.clientSecret,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!token.ok) throw new DiscordError('token', token.status);
      const { access_token: accessToken } = (await token.json()) as { access_token?: string };
      if (!accessToken) throw new DiscordError('token', token.status);
      const me = await fetchImpl(`${DISCORD_API}/users/@me`, {
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!me.ok) throw new DiscordError('me', me.status);
      const u = (await me.json()) as {
        id?: string;
        username?: string;
        global_name?: string | null;
        avatar?: string | null;
        mfa_enabled?: boolean;
      };
      if (!u.id || !/^\d{5,25}$/.test(u.id) || !u.username) throw new DiscordError('me', me.status);
      return {
        discordUserId: u.id,
        username: u.username,
        globalName: u.global_name ?? null,
        avatarHash: u.avatar ?? null,
        mfaEnabled: u.mfa_enabled === true,
      };
    },
  };
}
