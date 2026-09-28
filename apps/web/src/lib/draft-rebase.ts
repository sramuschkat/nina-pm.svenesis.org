/**
 * Entwurf gegen die Fassung, auf der er beruht (Prüfung 28.09.2026, verlorene Änderungen): Editoren merken
 * sich neben dem Entwurf die **Basis** (Stand und Version beim Öffnen bzw. letzten Speichern). Geändert
 * ist, was sich gegenüber der Basis unterscheidet, und gespeichert wird mit der Version der Basis – nicht
 * mit der Version einer später nachgeladenen Fassung, sonst setzte ein Speichern fremde Änderungen still
 * zurück.
 *
 * Kommt eine neuere Fassung an (Neuladen beim Fensterfokus, eigene Änderung an Zeilen/Panels/Filterrad),
 * hebt `rebaseDraft` den Entwurf darauf (Dreiwege-Abgleich je Feld, Unterobjekte je Schlüssel): Felder,
 * die der Nutzer nicht angefasst hat, übernehmen den neuen Stand; seine Änderungen bleiben. Haben beide
 * dasselbe Feld verschieden geändert, ist das ein echter Konflikt (`null`) – die Basis bleibt, der Editor
 * zeigt den Neu-laden-Hinweis und der Server antwortet beim Speichern mit 412.
 */

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Wertgleichheit für Entwurfsfelder (Zahlen, Texte, `null`, kleine Arrays und Objekte). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Entwurf von `base` auf `next` heben; `null` bei Konflikt. Unterobjekte (z. B. die Bedingungen eines
 * Projekts) werden je Schlüssel abgeglichen, Arrays als Ganzes.
 */
export function rebaseDraft<D extends object>(draft: D, base: D, next: D): D | null {
  const out: Record<string, unknown> = {};
  const d = draft as Record<string, unknown>;
  const b = base as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  for (const key of new Set([...Object.keys(d), ...Object.keys(n)])) {
    const mine = d[key];
    const theirs = n[key];
    const was = b[key];
    if (isPlainObject(mine) && isPlainObject(theirs) && isPlainObject(was)) {
      const nested = rebaseDraft(mine, was, theirs);
      if (nested === null) return null;
      out[key] = nested;
      continue;
    }
    const changedHere = !sameValue(mine, was);
    const changedThere = !sameValue(theirs, was);
    if (changedHere && changedThere && !sameValue(mine, theirs)) return null;
    out[key] = changedHere ? mine : theirs;
  }
  return out as D;
}
