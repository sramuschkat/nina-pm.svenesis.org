/**
 * Mandanten, Einladungen, Mitglieder, Owner und Super User (FA-MAN, FA-SU-05…09, FA-BEN-01…11; TK 5.4, 5.5, 7.2).
 */
import { z } from 'zod';
import { memberStatuses, roles, superUserStatuses, tenantStatuses } from '../generated/enums';
import { TenantKey } from './auth';
import { Uuid, UtcInstant } from './common';

/** Mandantenzeit, solange `tenantTimezone` nicht gesetzt ist (FA-MAN-05). */
export const DEFAULT_TENANT_TIMEZONE = 'Europe/Berlin';

export const DiscordUserId = z.string().regex(/^\d{5,25}$/);

/** Built-in-Mondprofile je Mandant (specs/engine/moon.md, Name = i18n-Schlüssel). */
export const BUILT_IN_MOON_PROFILES = [
  {
    name: 'moonProfile.none',
    separationDeg: 180,
    widthDays: 14,
    relaxScale: 0,
    moonMinAltDeg: -90,
    moonMaxAltDeg: -2,
    maxIlluminationPct: 0,
    moonMustBeDown: true,
  },
  {
    name: 'moonProfile.strict',
    separationDeg: 90,
    widthDays: 8,
    relaxScale: 0,
    moonMinAltDeg: -15,
    moonMaxAltDeg: 5,
    maxIlluminationPct: 30,
    moonMustBeDown: false,
  },
  {
    name: 'moonProfile.moderate',
    separationDeg: 60,
    widthDays: 5,
    relaxScale: 2,
    moonMinAltDeg: -15,
    moonMaxAltDeg: 5,
    maxIlluminationPct: 60,
    moonMustBeDown: false,
  },
  {
    name: 'moonProfile.relaxed',
    separationDeg: 25,
    widthDays: 3,
    relaxScale: 3,
    moonMinAltDeg: -15,
    moonMaxAltDeg: 5,
    maxIlluminationPct: 80,
    moonMustBeDown: false,
  },
] as const;

/** Einladungen: Standard 7 Tage, höchstens 30; nur User-Einladungen mehrfach nutzbar (FA-BEN-01, Schema-CHECK). */
export const INVITATION_DEFAULT_DAYS = 7;
export const INVITATION_MAX_DAYS = 30;

export const CreateTenantRequest = z
  .object({
    tenantKey: TenantKey.refine((k) => k !== 'system', 'reserviert'),
    displayName: z.string().trim().min(1).max(120),
    contact: z.string().trim().max(200).optional(),
  })
  .meta({ id: 'CreateTenantRequest' });

export const TenantStatusPatch = z
  .object({ status: z.enum(tenantStatuses) })
  .meta({ id: 'TenantStatusPatch' });

export const TenantAdminView = z
  .object({
    id: Uuid,
    tenantKey: z.string(),
    displayName: z.string(),
    contact: z.string().nullable(),
    status: z.enum(tenantStatuses),
    /** `null` = Owner ausstehend (Einladung offen, FA-BEN-03). */
    ownerMemberId: Uuid.nullable(),
    ownerDisplayName: z.string().nullable(),
    admins: z.number().int(),
    users: z.number().int(),
    /** Kennzahlen FA-SU-03 (ohne fachliche Inhalte, FA-SU-07). */
    rigs: z.number().int(),
    ninaInstances: z.number().int(),
    ninaLastSeenAt: UtcInstant.nullable(),
    lastLoginAt: UtcInstant.nullable(),
    createdAt: UtcInstant,
  })
  .meta({ id: 'TenantAdminView' });

const invitationBase = {
  /** Client-UUID für Idempotenz (TK 7.1). */
  id: Uuid,
  discordUserId: DiscordUserId.optional(),
  validDays: z.number().int().min(1).max(INVITATION_MAX_DAYS).default(INVITATION_DEFAULT_DAYS),
  note: z.string().trim().max(500).optional(),
};

/** `POST /web/v1/invitations`: Rolle fest `user` (SEC-50); mehrfach nutzbar bis 50. */
export const CreateUserInvitationRequest = z
  .object({ ...invitationBase, maxUses: z.number().int().min(1).max(50).default(1) })
  .strict()
  .meta({ id: 'CreateUserInvitationRequest' });

/** `POST /web/v1/invitations/admin` und Owner-Einladung des Super Users: genau eine Nutzung. */
export const CreateSingleUseInvitationRequest = z
  .object(invitationBase)
  .strict()
  .meta({ id: 'CreateSingleUseInvitationRequest' });

export const InvitationCreated = z
  .object({
    id: Uuid,
    role: z.enum(roles),
    /** Einladungslink; das Token steht im Fragment und erreicht so keine Zugriffslogs (DAT-20). Nur einmal angezeigt. */
    link: z.url(),
    expiresAt: UtcInstant,
  })
  .meta({ id: 'InvitationCreated' });
export type InvitationCreated = z.infer<typeof InvitationCreated>;

export const InvitationView = z
  .object({
    id: Uuid,
    role: z.enum(roles),
    discordUserId: z.string().nullable(),
    note: z.string().nullable(),
    maxUses: z.number().int(),
    usedCount: z.number().int(),
    expiresAt: UtcInstant,
    revokedAt: UtcInstant.nullable(),
    createdAt: UtcInstant,
    /** Vom Owner bzw. Super User erzeugt – nur der Owner widerruft sie (FA-BEN-08). */
    ownerOnly: z.boolean(),
  })
  .meta({ id: 'InvitationView' });

export const InvitationPreviewRequest = z
  .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .meta({ id: 'InvitationPreviewRequest' });
export const InvitationPreview = z
  .object({ tenantName: z.string(), role: z.enum(roles), expiresAt: UtcInstant })
  .meta({ id: 'InvitationPreview' });

export const MemberView = z
  .object({
    id: Uuid,
    displayName: z.string(),
    discordUsername: z.string(),
    avatarHash: z.string().nullable(),
    /** Gespeicherte Rolle, `owner` für den Owner. */
    role: z.enum(roles),
    status: z.enum(memberStatuses),
    mfa: z.boolean(),
    /** Owner/Admin ohne 2FA: Rechte ruhen (FA-BEN-04, FA-LOG-07). */
    rightsDormant: z.boolean(),
    lastLoginAt: UtcInstant.nullable(),
    /** Eigene Objekte nach Freigabestatus (FA-BEN-04). */
    objects: z.object({
      draft: z.number().int(),
      submitted: z.number().int(),
      approved: z.number().int(),
    }),
  })
  .meta({ id: 'MemberView' });

export const MemberPatch = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .strict()
  .refine((p) => p.displayName !== undefined || p.status !== undefined, 'leer')
  .meta({ id: 'MemberPatch' });

export const RoleChangeRequest = z
  .object({ role: z.enum(['admin', 'user']), reason: z.string().trim().max(500).optional() })
  .strict()
  .meta({ id: 'RoleChangeRequest' });

export const OwnerTransferRequest = z
  .object({ memberId: Uuid })
  .strict()
  .meta({ id: 'OwnerTransferRequest' });

/** Notfall-Neuzuweisung durch den Super User (FA-SU-05): an ein Mitglied oder per neuer Owner-Einladung. */
export const OwnerReassignRequest = z
  .union([
    z
      .object({
        memberId: Uuid,
        reason: z.string().trim().min(1).max(500),
        keepPreviousAsAdmin: z.boolean().default(false),
      })
      .strict(),
    z
      .object({
        invite: z
          .object({
            id: Uuid,
            discordUserId: DiscordUserId.optional(),
            validDays: z
              .number()
              .int()
              .min(1)
              .max(INVITATION_MAX_DAYS)
              .default(INVITATION_DEFAULT_DAYS),
          })
          .strict(),
        reason: z.string().trim().min(1).max(500),
        keepPreviousAsAdmin: z.boolean().default(false),
      })
      .strict(),
  ])
  .meta({ id: 'OwnerReassignRequest' });

export const SystemMemberView = z
  .object({
    id: Uuid,
    displayName: z.string(),
    role: z.enum(roles),
    status: z.enum(memberStatuses),
  })
  .meta({ id: 'SystemMemberView' });

export const SuperUserView = z
  .object({
    identityId: Uuid,
    discordUserId: z.string(),
    discordUsername: z.string(),
    status: z.enum(superUserStatuses),
    mfa: z.boolean(),
    createdAt: UtcInstant,
  })
  .meta({ id: 'SuperUserView' });

export const AddSuperUserRequest = z
  .object({ discordUserId: DiscordUserId })
  .strict()
  .meta({ id: 'AddSuperUserRequest' });
export const SuperUserPatch = z
  .object({ status: z.enum(superUserStatuses) })
  .strict()
  .meta({ id: 'SuperUserPatch' });
export const IdentityStatusPatch = z
  .object({ status: z.enum(['active', 'blocked']) })
  .strict()
  .meta({ id: 'IdentityStatusPatch' });
