/**
 * Mandanteneinstellungen (S-71, FA-MAN-05; TK 7.2, DAT5-22): Schlüssel **ausschließlich** aus
 * `enums.json tenantSettingsKeys`; unbekannte Schlüssel lehnt `PATCH /web/v1/tenant/settings` mit
 * `422 validation.failed` ab. Keine Sicherheitsschlüssel (SV-01, SV-03). Standardwerte nach FK:
 * FA-FRG-10 (Admin-Objekte ohne Warteschlange: an), FA-PRJ-12 (automatisch „Bereit zur Bearbeitung“: aus;
 * zurück nach „Aktiv“ bei Restbedarf: an), FA-AUS-06 (User verwerfen eigene Aufnahmen: aus), FA-EXO-18.
 */
import { z } from 'zod';
import { tenantSettingsKeys } from '../generated/enums';
import { DEFAULT_EXO_USER_MAX_OPEN_LOCKS } from '../permissions';
import { UtcInstant } from './common';
import { DEFAULT_TENANT_TIMEZONE } from './tenants';

/** IANA-Zone, die die Laufzeit kennt (FK 8.1). */
export const IanaTimeZone = z
  .string()
  .min(1)
  .max(64)
  .refine((zone) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  }, 'Unbekannte IANA-Zeitzone');

const SETTING_SCHEMAS = {
  tenantTimezone: IanaTimeZone,
  defaultLanguage: z.enum(['de', 'en']),
  userCorrections: z.boolean(),
  exoUserLockNeedsAdmin: z.boolean(),
  exoUserMaxOpenLocks: z.number().int().min(1).max(20),
  autoReactivateOnRemaining: z.boolean(),
  autoReadyToProcess: z.boolean(),
  adminSelfApproval: z.boolean(),
  /** Tage bis zum Verfall einer offenen Einreichung; `null` = keine Frist (Entscheidung Sven, 24.09.2026). */
  approvalDeadlineDays: z.number().int().min(1).max(365).nullable(),
} as const satisfies Record<(typeof tenantSettingsKeys)[number], z.ZodType>;

export const TenantSettings = z.object(SETTING_SCHEMAS).strict().meta({ id: 'TenantSettings' });
export type TenantSettings = z.infer<typeof TenantSettings>;

export const TENANT_SETTING_DEFAULTS: TenantSettings = {
  tenantTimezone: DEFAULT_TENANT_TIMEZONE,
  defaultLanguage: 'de',
  userCorrections: false,
  exoUserLockNeedsAdmin: true,
  exoUserMaxOpenLocks: DEFAULT_EXO_USER_MAX_OPEN_LOCKS,
  autoReactivateOnRemaining: true,
  autoReadyToProcess: false,
  adminSelfApproval: true,
  approvalDeadlineDays: null,
};

/** Gespeicherte Werte über die Standardwerte legen; Ungültiges fällt auf den Standard zurück. */
export function effectiveTenantSettings(stored: unknown): TenantSettings {
  const out: Record<string, unknown> = { ...TENANT_SETTING_DEFAULTS };
  if (stored && typeof stored === 'object') {
    for (const [key, schema] of Object.entries(SETTING_SCHEMAS)) {
      const value = (stored as Record<string, unknown>)[key];
      if (value !== undefined && schema.safeParse(value).success) out[key] = value;
    }
  }
  return out as TenantSettings;
}

export const TenantSettingsView = z
  .object({ displayName: z.string(), settings: TenantSettings, updatedAt: UtcInstant })
  .meta({ id: 'TenantSettingsView' });

export const TenantSettingsPatch = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    settings: z.object(SETTING_SCHEMAS).partial().strict().optional(),
  })
  .strict()
  .refine((p) => p.displayName !== undefined || p.settings !== undefined, 'leer')
  .meta({ id: 'TenantSettingsPatch' });
export type TenantSettingsPatch = z.infer<typeof TenantSettingsPatch>;

/** Änderungsprotokoll (S-72, `change_log`, ohne Anmeldeprotokoll SV-11). */
export const ChangeLogEntry = z
  .object({
    id: z.uuid(),
    entity: z.string(),
    entityId: z.uuid(),
    /** Anzeigename des handelnden Mitglieds; `null` = System bzw. ehemaliges Mitglied ohne Namen. */
    actorName: z.string().nullable(),
    /** Anzeigename des betroffenen Mitglieds bei `entity = 'app_user'`. */
    subjectName: z.string().nullable(),
    action: z.string(),
    diff: z.record(z.string(), z.unknown()),
    createdAt: UtcInstant,
  })
  .meta({ id: 'ChangeLogEntry' });

export const ChangeLogList = z
  .object({ items: z.array(ChangeLogEntry), nextCursor: z.string().nullable() })
  .meta({ id: 'ChangeLogList' });

export const ChangeLogQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
  entity: z.string().max(40).optional(),
});
