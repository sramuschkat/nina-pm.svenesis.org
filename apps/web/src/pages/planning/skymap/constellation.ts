/**
 * Sternbild eines Orts: seit der Astronomie-Prüfung 28.09.2026 in der Engine (`sky.constellationAt`), damit
 * Sternkarte und Katalog-Import (Sharpless-Objekte) dieselbe Zuordnung nutzen.
 */
import { sky } from '@nina-pm/engine';

export const constellationAt = sky.constellationAt;
