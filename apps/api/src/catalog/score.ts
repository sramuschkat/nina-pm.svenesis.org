/**
 * Zielvorschläge „Beste der Nacht“ (FA-FRM-13, AP-21): Bewertungslogik aus dem Svenesis-Beobachtungsplaner,
 * portiert aus `legacy/astro-tools-2026-09-21/js/observing-planner.js` (computeObjects: Foto-Bewertung) und
 * `js/sky-map.js` (rigFraming, imagingCandidate). Das Bildfeld kommt aus dem gewählten Rig statt der festen
 * 101,5′ der Website; Helligkeit V, sonst B aus OpenNGC. Keine Regel des Schedulers – nur Rangliste.
 */
import type { DsoTypeGroup } from '@nina-pm/shared';

/** Kurzcode der Website je Anzeigegruppe; `null` = kein Bildkandidat (Sterne, Sonstiges). */
export const WEBSITE_KIND: Readonly<Record<DsoTypeGroup, string | null>> = {
  galaxy: 'Gx',
  open_cluster: 'OC',
  globular_cluster: 'GC',
  planetary_nebula: 'PN',
  emission_nebula: 'EN',
  reflection_nebula: 'RN',
  dark_nebula: 'DN',
  supernova_remnant: 'SNR',
  multiple_star: null,
  other: null,
};

/**
 * Mondempfindlichkeit beim Fotografieren mit dem Rig: Emissionsnebel, Supernova-Überreste und planetarische
 * Nebel gehen durch Schmalbandfilter, die der Mond kaum stört; Galaxien, Reflexions- und Dunkelnebel und
 * Haufen brauchen Breitband.
 */
export const MOON_SENS_RIG: Readonly<Record<string, number>> = {
  Gx: 1,
  RN: 1,
  DN: 1,
  EN: 0.25,
  SNR: 0.3,
  PN: 0.3,
  GC: 0.4,
  OC: 0.3,
};

/** Filterempfehlung (FA-FRM-13): Schmalband für Emissionsobjekte, sonst Breitband (LRGB). */
export function filterHint(group: DsoTypeGroup): 'narrowband' | 'broadband' | null {
  const k = WEBSITE_KIND[group];
  if (k === null) return null;
  return k === 'EN' || k === 'SNR' || k === 'PN' ? 'narrowband' : 'broadband';
}

/**
 * Bildkandidat (Website `imagingCandidate`): Größe 3′ bis 3°, keine Komponente mit Buchstaben, Galaxien bis
 * 12 mag, Kugelhaufen bis 10 mag, offene Haufen bis 8 mag und ab 5′, jeder Nebel und Supernova-Überrest.
 */
export function imagingCandidate(o: {
  primaryId: string;
  group: DsoTypeGroup;
  sizeMajorArcmin: number | null;
  mag: number | null;
}): boolean {
  const k = WEBSITE_KIND[o.group];
  const s = o.sizeMajorArcmin;
  if (k === null || s === null || s < 3 || s > 180) return false;
  if (/^(NGC|IC) \d+ ?[A-Z]/.test(o.primaryId)) return false;
  if (k === 'Gx') return o.mag !== null && o.mag <= 12;
  if (k === 'GC') return o.mag !== null && o.mag <= 10;
  if (k === 'OC') return o.mag !== null && o.mag <= 8 && s >= 5;
  return true;
}

/**
 * Füllung des Bildfelds (Website `rigFraming`, Bildfeld `fov` in Bogenminuten): 0,3 bis 2′, steigend bis 1
 * bei 12′, 1 bis 90 % des Felds, fallend auf 0,55 bei 1,8 Feldern (Zweier-Mosaik), danach 0,45; 0,6 ohne Größe.
 */
export function framingFactor(sizeArcmin: number | null, fov: number): number {
  const s = sizeArcmin;
  if (s === null || !(s > 0)) return 0.6;
  if (s <= 2) return 0.3;
  if (s < 12) return 0.3 + (0.7 * Math.log(s / 2)) / Math.log(6);
  if (s <= 0.9 * fov) return 1;
  if (s <= 1.8 * fov) return 1 - (0.45 * (s - 0.9 * fov)) / (0.9 * fov);
  return 0.45;
}

/** Helligkeit: voll bis 7 mag, halb bei 12 mag; 0,7 ohne Helligkeit (Sharpless-Regionen, viele Nebel). */
export function brightnessFactor(mag: number | null): number {
  if (mag === null) return 0.7;
  return Math.min(1, Math.max(0.4, 0.4 + (0.6 * (13 - mag)) / 6));
}

/** Gewicht einer Stichprobe: nichts unter 20°, voll ab 60°, abzüglich Mond (voll bis 10°, nichts ab 90°). */
export function sampleWeight(
  altDeg: number,
  moon: { up: boolean; illumFraction: number; sepDeg: number } | null,
  kind: string,
): number {
  const altF = Math.min(1, Math.max(0, (altDeg - 20) / 40));
  const pen =
    moon && moon.up
      ? moon.illumFraction * Math.min(1, Math.max(0, 1 - (moon.sepDeg - 10) / 80))
      : 0;
  return altF * (1 - 0.85 * pen * (MOON_SENS_RIG[kind] ?? 1));
}

/** Gesamtwertung 0–1: Anteil der gewichteten Stunden an der Dunkelheit × Füllung × Helligkeit. */
export function photoScore(
  weightedHours: number,
  darkHours: number,
  sizeArcmin: number | null,
  fovArcmin: number,
  mag: number | null,
): number {
  const share = Math.min(1, Math.max(0, weightedHours / Math.max(darkHours, 1)));
  return share * framingFactor(sizeArcmin, fovArcmin) * brightnessFactor(mag);
}
