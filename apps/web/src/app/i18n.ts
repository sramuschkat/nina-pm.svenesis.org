import { resources, type Language } from '@nina-pm/i18n';
import { STORAGE_KEYS } from '@nina-pm/ui-tokens';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { readStorage, writeStorage } from './storage';

/** DE Standard, EN; Wahl nur im Browser (`npm.lang`, TK 11.3). */
export function initialLanguage(): Language {
  const stored = readStorage(STORAGE_KEYS.lang);
  return stored === 'en' ? 'en' : 'de';
}

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage(),
  fallbackLng: 'de',
  interpolation: { escapeValue: false },
  returnNull: false,
});

i18n.on('languageChanged', (lng) => {
  writeStorage(STORAGE_KEYS.lang, lng);
  document.documentElement.lang = lng;
});
document.documentElement.lang = i18n.language;

export default i18n;
