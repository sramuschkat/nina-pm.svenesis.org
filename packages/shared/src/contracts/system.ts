/**
 * System-Administration (AP-07a; FA-SU-03…09, FA-MAN-03, FA-LOG-05; TK 5.4, 7.2): Löschen eines
 * Mandanten mit Namenseingabe, System-Audit, systemweite Einstellungen (Wartungsbanner), Identitäten.
 */
import { z } from 'zod';
import { systemSettingKeys } from '../generated/enums';
import { Uuid, UtcInstant } from './common';
import { DiscordUserId } from './tenants';

/** `DELETE /system/v1/tenants/{id}`: exakt die Mandanten-ID (FA-MAN-03, E4); sonst `422 validation.failed`. */
export const DeleteTenantRequest = z
  .object({ confirmTenantKey: z.string().max(64) })
  .strict()
  .meta({ id: 'DeleteTenantRequest' });

export const SystemAuditEntry = z
  .object({
    id: Uuid,
    actor: z.enum(['super_user', 'ops_cli']),
    /** Anzeigename des Super Users (Discord); `null` bei `ops_cli`. */
    actorName: z.string().nullable(),
    tenantId: Uuid.nullable(),
    tenantKey: z.string().nullable(),
    action: z.string(),
    details: z.record(z.string(), z.unknown()),
    createdAt: UtcInstant,
  })
  .meta({ id: 'SystemAuditEntry' });
export type SystemAuditEntry = z.infer<typeof SystemAuditEntry>;

export const SystemAuditList = z
  .object({ items: z.array(SystemAuditEntry), nextCursor: z.string().nullable() })
  .meta({ id: 'SystemAuditList' });

export const SystemAuditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
  tenantId: Uuid.optional(),
});

export const SystemSettingKeySchema = z.enum(systemSettingKeys);

/** Wartungshinweis für alle Mandanten (FA-SU-08), `system_setting.maintenanceBanner`. */
export const MaintenanceBanner = z
  .object({
    active: z.boolean(),
    textDe: z.string().trim().max(500),
    textEn: z.string().trim().max(500),
  })
  .strict()
  .refine((b) => !b.active || (b.textDe.length > 0 && b.textEn.length > 0), {
    message: 'Text DE und EN erforderlich',
    path: ['textDe'],
  })
  .meta({ id: 'MaintenanceBanner' });
export type MaintenanceBanner = z.infer<typeof MaintenanceBanner>;

/** Wert je Schlüssel – ein Schema je `systemSettingKeys`-Eintrag. */
export const SYSTEM_SETTING_SCHEMAS = {
  maintenanceBanner: MaintenanceBanner,
} as const satisfies Record<(typeof systemSettingKeys)[number], z.ZodType>;

export const SystemSettingView = z
  .object({
    key: SystemSettingKeySchema,
    value: z.unknown().nullable(),
    updatedAt: UtcInstant.nullable(),
  })
  .meta({ id: 'SystemSettingView' });

/** Öffentlicher Wartungshinweis (auch ohne Anmeldung): `null`, wenn keiner aktiv ist. */
export const PublicBanner = z
  .object({ banner: z.object({ de: z.string(), en: z.string() }).nullable() })
  .meta({ id: 'PublicBanner' });

/** Identität für das systemweite Sperren (FA-LOG-05) – nur Discord-Stammdaten, keine Mandanteninhalte. */
export const IdentityAdminView = z
  .object({
    id: Uuid,
    discordUserId: z.string(),
    discordUsername: z.string(),
    globalName: z.string().nullable(),
    status: z.enum(['active', 'blocked']),
    isSuperUser: z.boolean(),
    lastLoginAt: UtcInstant.nullable(),
  })
  .meta({ id: 'IdentityAdminView' });

export const IdentityLookupQuery = z.object({ discordUserId: DiscordUserId });
