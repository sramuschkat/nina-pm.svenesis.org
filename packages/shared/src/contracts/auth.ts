/** Anmeldung und Sitzungen (TK 5.2, 5.3; FA-LOG-01…10, FA-SU-02). */
import { z } from 'zod';
import { authContexts, roles } from '../generated/enums';
import { Uuid, UtcInstant } from './common';

/** `next` nur als relativer Pfad derselben Anwendung (TK 5.2): `//host` und `/\host` sind fremd. */
export const SAFE_NEXT_PATTERN = /^\/(?![/\\])/;
const isControl = (text: string) =>
  [...text].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f);

export function safeNext(next: string | null | undefined): string {
  if (!next || next.length > 2048 || isControl(next) || !SAFE_NEXT_PATTERN.test(next)) return '/';
  return next;
}

/** Mandanten-ID: 3–32 Zeichen, Kleinbuchstaben, Ziffern, Bindestrich (FA-MAN-01). */
export const TenantKey = z.string().regex(/^[a-z0-9-]{3,32}$/);

/** `last_seen_at` höchstens alle 5 min schreiben (TK 5.3). */
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60_000;
/** `__Host-npm_oauth` 10 min, `__Host-npm_invite` 15 min (TK 5.3). */
export const OAUTH_COOKIE_TTL_SECONDS = 600;
export const INVITE_COOKIE_TTL_SECONDS = 900;

export const COOKIE_NAMES = {
  session: '__Host-npm_sid',
  oauth: '__Host-npm_oauth',
  invite: '__Host-npm_invite',
} as const;

export const AuthContextKindSchema = z.enum(authContexts);

export const MembershipView = z.object({
  tenantKey: z.string(),
  tenantName: z.string(),
  /** Gespeicherte Rolle; `owner` für den Owner des Mandanten. */
  role: z.enum(roles),
});

export const MeResponse = z
  .object({
    identity: z.object({
      id: Uuid,
      discordUserId: z.string(),
      username: z.string(),
      globalName: z.string().nullable(),
      avatarHash: z.string().nullable(),
      mfa: z.boolean(),
    }),
    context: AuthContextKindSchema,
    tenant: z
      .object({
        id: Uuid,
        key: z.string(),
        name: z.string(),
        /** Mandantenzeit (`tenantTimezone`, IANA) für Zeitpunkte ohne Standortbezug (NT-03). */
        timeZone: z.string(),
      })
      .nullable(),
    member: z
      .object({
        id: Uuid,
        displayName: z.string(),
        /** Gespeicherte Rolle (`owner`, `admin`, `user`). */
        role: z.enum(roles),
        /** Wirksame Rolle: ohne 2FA `user` (SV-03), in der Rollenansicht `user`. */
        effectiveRole: z.enum(['admin', 'user']),
        /**
         * Rollenansicht „Als User ansehen“ aktiv (nur Admins/Owner, je Sitzung; 30.09.2026). Fehlt = aus.
         */
        viewAsUser: z.boolean().optional(),
      })
      .nullable(),
    isSuperUser: z.boolean(),
    /** Admin-/Owner- bzw. Super-User-Rechte ruhen, bis Discord-2FA aktiv ist (FA-LOG-07). */
    mfaRequired: z.boolean(),
    /** Auswahl für den Mandantenwechsel (FA-LOG-02); Super User zusätzlich „System“. */
    memberships: z.array(MembershipView),
  })
  .meta({ id: 'MeResponse' });
export type MeResponse = z.infer<typeof MeResponse>;

/** Rollenansicht umschalten (`POST /auth/view-as`): `asUser: true` = mit User-Rechten, `false` = zurück. */
export const ViewAsRequest = z
  .object({ asUser: z.boolean() })
  .strict()
  .meta({ id: 'ViewAsRequest' });
export type ViewAsRequest = z.infer<typeof ViewAsRequest>;

export const ContextRequest = z
  .union([
    z.object({ tenantKey: TenantKey }).strict(),
    z.object({ system: z.literal(true) }).strict(),
  ])
  .meta({ id: 'ContextRequest' });
export type ContextRequest = z.infer<typeof ContextRequest>;

export const SessionView = z
  .object({
    id: Uuid,
    current: z.boolean(),
    /** Gerät/Browser aus dem User-Agent (gekürzt). */
    device: z.string().nullable(),
    ipTruncated: z.string().nullable(),
    createdAt: UtcInstant,
    lastSeenAt: UtcInstant,
  })
  .meta({ id: 'SessionView' });
export type SessionView = z.infer<typeof SessionView>;

export const SessionList = z
  .object({
    sessions: z.array(SessionView),
    /** Letzte Discord-Anmeldung der Identität (`identity.last_login_at`, S-73). */
    lastLoginAt: UtcInstant.nullable(),
  })
  .meta({ id: 'SessionList' });

/** Einladungs-Token: 256 Bit base64url (43 Zeichen). */
export const InvitationToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const InvitationClaimRequest = z
  .object({ token: InvitationToken })
  .meta({ id: 'InvitationClaimRequest' });
export const InvitationClaimResponse = z
  .object({ tenantName: z.string(), role: z.enum(roles) })
  .meta({ id: 'InvitationClaimResponse' });
