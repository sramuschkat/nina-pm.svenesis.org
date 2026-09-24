/** Browser-Speicher nur für Sofortwerte (Theme, Dichte, Sprache); Wahrheit ist `user_preference` (TK 11.3). */
export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // privater Modus o. Ä. – der Wert gilt dann nur für diese Sitzung
  }
}
