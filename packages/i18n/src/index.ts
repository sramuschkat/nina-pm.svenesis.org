// @nina-pm/i18n – DE/EN-Texte (TK 3.1). errors.* ist aus docs/contracts/errors.json generiert;
// die Oberflächentexte liegen in locales/ (AP-06a).
import { errorMessages } from './generated/errors';
import { de } from './locales/de';
import { en } from './locales/en';

export { errorMessages } from './generated/errors';
export type { Messages } from './locales/de';
export { privacyMarkdown, sourcesMarkdown } from './legal';

export const LANGUAGES = ['de', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];
export type ErrorMessageKey = keyof (typeof errorMessages)['de'];

/** Text zu einem i18n-Schlüssel `errors.*`; unbekannte Schlüssel liefern den Schlüssel selbst. */
export function errorMessage(lang: Language, key: string): string {
  const table: Readonly<Record<string, string>> = errorMessages[lang];
  return table[key] ?? key;
}

/** Aus `errors.auth.csrfMissing` (flach) wird `{ auth: { csrfMissing } }` für i18next. */
function nestErrors(flat: Readonly<Record<string, string>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.replace(/^errors\./, '').split('.');
    let node = out;
    for (const part of parts.slice(0, -1)) node = (node[part] ??= {}) as Record<string, unknown>;
    node[parts.at(-1) ?? key] = value;
  }
  return out;
}

/** Ressourcen für i18next: ein Namespace `translation` je Sprache mit Oberflächentexten und `errors.*`. */
export const resources = {
  de: { translation: { ...de, errors: nestErrors(errorMessages.de) } },
  en: { translation: { ...en, errors: nestErrors(errorMessages.en) } },
} as const;

/** Alle Schlüssel (Punkt-Pfade) eines Übersetzungsbaums – für den i18n-Lint. */
export function flattenKeys(tree: unknown, prefix = ''): string[] {
  if (typeof tree !== 'object' || tree === null) return [prefix];
  return Object.entries(tree).flatMap(([k, v]) => flattenKeys(v, prefix ? `${prefix}.${k}` : k));
}
