/** Persönliche Einstellungen je Mitgliedschaft (`user_preference`, TK 7.2, 11.3). */
import { z } from 'zod';
import { ExoSearchSettings } from './exo';
import { ConditionsValue } from './projects';

/** Erlaubte Schlüssel mit Wert-Schema; weitere Pakete ergänzen hier (z. B. `coord.format`). */
export const PREFERENCE_SCHEMAS = {
  'ui.theme': z.enum(['light', 'dark']),
  'ui.density': z.enum(['compact', 'normal', 'wide']),
  'ui.navCollapsed': z.boolean(),
  /** „Als Standard setzen“ im Projekt-Editor (FA-PRJ-04): Bedingungen für neue Projekte. */
  'project.defaultConditions': ConditionsValue,
  /** Filter der Transitsuche S-22 (FA-EXO-05, AP-42). */
  'exo.search': ExoSearchSettings,
} as const;

export type PreferenceKey = keyof typeof PREFERENCE_SCHEMAS;
export const PREFERENCE_KEYS = Object.keys(PREFERENCE_SCHEMAS) as PreferenceKey[];

export const PreferenceKeySchema = z.enum(PREFERENCE_KEYS as [PreferenceKey, ...PreferenceKey[]]);

export const Preferences = z
  .object({
    'ui.theme': PREFERENCE_SCHEMAS['ui.theme'].optional(),
    'ui.density': PREFERENCE_SCHEMAS['ui.density'].optional(),
    'ui.navCollapsed': PREFERENCE_SCHEMAS['ui.navCollapsed'].optional(),
    'project.defaultConditions': PREFERENCE_SCHEMAS['project.defaultConditions'].optional(),
    'exo.search': PREFERENCE_SCHEMAS['exo.search'].optional(),
  })
  .meta({ id: 'Preferences' });
export type Preferences = z.infer<typeof Preferences>;

export const PreferenceValue = z.object({ value: z.unknown() }).meta({ id: 'PreferenceValue' });
