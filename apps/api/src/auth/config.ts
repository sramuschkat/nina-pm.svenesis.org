/** Anmelde-Konfiguration aus SSM (iam.md §8; Werte nie im Code, nie im Log). */
export interface AuthConfig {
  cookieSecret(): Promise<string>;
  discordClientId(): Promise<string>;
  discordClientSecret(): Promise<string>;
  /** Discord-User-IDs aus `/nina-pm/bootstrap-super-users` (kommagetrennt, SV-17). */
  bootstrapSuperUsers(): Promise<readonly string[]>;
  /** `https://nina-pm.svenesis.org/api/auth/discord/callback` (TK 5.1). */
  readonly redirectUri: string;
}

export const PROD_REDIRECT_URI = 'https://nina-pm.svenesis.org/api/auth/discord/callback';

export function parseIdList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d{5,25}$/.test(s));
}
