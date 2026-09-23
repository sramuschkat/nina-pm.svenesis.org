// @nina-pm/i18n – DE/EN-Texte (TK 3.1). errors.* ist aus docs/contracts/errors.json generiert;
// AP-06a ergänzt die Oberflächentexte.
import { errorMessages } from './generated/errors';

export { errorMessages } from './generated/errors';

export const LANGUAGES = ['de', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];
export type ErrorMessageKey = keyof (typeof errorMessages)['de'];

/** Text zu einem i18n-Schlüssel `errors.*`; unbekannte Schlüssel liefern den Schlüssel selbst. */
export function errorMessage(lang: Language, key: string): string {
  const table: Readonly<Record<string, string>> = errorMessages[lang];
  return table[key] ?? key;
}
