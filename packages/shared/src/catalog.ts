/**
 * Bezeichnungen im Objektkatalog (specs/catalog/dso-import.md §3; AP-20): Vergleichsform, Katalogkürzel,
 * Anzeigename und Anzeigegruppe – dieselbe Regel für Import, API und Oberfläche.
 */
import { dsoObjectTypeGroups } from './generated/enums';
import type { DsoTypeGroup } from './contracts/catalog';

/** Vergleichsform: ohne Leerzeichen, ohne Groß-/Kleinschreibung (§3 Nr. 5). */
export const squeezeDesignation = (s: string) => s.replace(/\s+/g, '').toUpperCase();

/** Katalogkürzel einer Bezeichnung (`NGC 224` → `NGC`, `Sh2-155` → `Sh`); Trivialnamen → `null`. */
export const designationPrefix = (designation: string) =>
  /^([A-Za-z]+)(?:2-|\s)(?=[\dJ+-])/.exec(designation)?.[1] ?? null;

const NAME_ORDER = ['M', 'NGC', 'IC', 'C', 'Sh'];

/** Rang für die Reihenfolge Messier → NGC → IC → Caldwell → Sharpless → sonstige → Trivialnamen. */
export function designationRank(name: string): number {
  const p = designationPrefix(name);
  if (p === null) return 100;
  const i = NAME_ORDER.indexOf(p);
  return i >= 0 ? i : 50;
}

/** Anzeigename: erste Bezeichnung in der Reihenfolge Messier → NGC → IC → Caldwell → Sharpless → sonstige. */
export function dsoDisplayName(primaryId: string, names: readonly string[]): string {
  return (
    [primaryId, ...names]
      .filter((n) => designationPrefix(n) !== null)
      .sort((a, b) => designationRank(a) - designationRank(b))[0] ?? primaryId
  );
}

export function dsoTypeGroup(objectType: string): DsoTypeGroup {
  return ((dsoObjectTypeGroups as Record<string, string>)[objectType] ?? 'other') as DsoTypeGroup;
}

/**
 * Dateiname der Katalogbilder aus der normalisierten `primary_id` (dso-import.md §2, T-KAT-12):
 * Kleinbuchstaben, nur Buchstaben und Ziffern (`NGC 224` → `ngc224`, `Sh2-129` → `sh2129`).
 */
export const catalogImageKey = (primaryId: string) =>
  primaryId.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Kopierte Katalogbilder unter `catalog/img/…` (H-11): 128 px je Zeile, 320 px wo vorhanden. */
export const catalogImagePaths = (primaryId: string) => ({
  small: `/catalog/img/ngc/${catalogImageKey(primaryId)}.jpg`,
  large: `/catalog/img/ngc-l/${catalogImageKey(primaryId)}.jpg`,
});
