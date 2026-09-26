/**
 * Vorschaubild des Projekt-Bildfelds (AP-25; FA-PRJ-02, TK 12, Entscheidung Sven 26.09.2026): Ausschnitt
 * aus CDS hips2fits in Größe, Lage und Drehung des Bildfelds (Rig-Bildfeld bzw. ganzes Mosaik), abgelegt
 * unter `catalog/thumbs/<sha256>.jpg` – getrennt von den kopierten Katalogbildern `catalog/img/…`
 * (dso-import.md §2). Der Schlüssel entsteht aus der kanonischen Zahlform (`q(x, 1e6)`, feste
 * Feldreihenfolge, fester Trenner), damit identische Ausschnitte denselben Schlüssel haben.
 */
import { q, sha256hex } from '@nina-pm/engine';

/** HiPS der Vorschaubilder (DSS2 Farbe, ganzer Himmel). */
export const THUMBNAIL_SURVEY = 'CDS/P/DSS2/color';
/** Längere Bildkante in Pixeln. */
export const THUMBNAIL_LONG_SIDE_PX = 320;
/** Rand um das Bildfeld (15 % je Achse), damit der Rahmen im Bild Luft hat. */
export const THUMBNAIL_MARGIN = 1.15;
export const THUMBNAIL_PREFIX = 'catalog/thumbs/';

export interface ThumbnailParams {
  readonly raDeg: number;
  readonly decDeg: number;
  /** Kantenlängen des Ausschnitts in Grad (mit Rand). */
  readonly fovWidthDeg: number;
  readonly fovHeightDeg: number;
  /** Kamera-Positionswinkel (Bild-Oberkante von Nord über Ost, flip-rotation.md §3), 0 ≤ pa < 360. */
  readonly rotationDeg: number;
  readonly survey: string;
}

const norm360 = (x: number) => ((x % 360) + 360) % 360;

/**
 * Ausschnitt eines Projekts: Mittelpunkt = Projektkoordinaten, Größe = Rig-Bildfeld bzw. Mosaik
 * (`n · fov − (n − 1) · Überlappung`), Drehung = Projektwinkel, ohne Rotator der Kamerawinkel (NT-30).
 */
export function projectThumbnailParams(
  project: {
    readonly raDeg: number | null;
    readonly decDeg: number | null;
    readonly rotationDeg: number;
    readonly mosaic: { readonly cols: number; readonly rows: number; readonly overlapPct: number };
  },
  rig: {
    readonly hasRotator: boolean;
    readonly defaultRotationDeg: number | null;
    readonly derived: { readonly fovWidthDeg: number; readonly fovHeightDeg: number };
  },
  survey: string = THUMBNAIL_SURVEY,
): ThumbnailParams | null {
  if (project.raDeg === null || project.decDeg === null) return null;
  const { fovWidthDeg: w, fovHeightDeg: h } = rig.derived;
  if (!(w > 0 && h > 0)) return null;
  const ov = project.mosaic.overlapPct / 100;
  const cols = Math.max(1, project.mosaic.cols);
  const rows = Math.max(1, project.mosaic.rows);
  return {
    raDeg: project.raDeg,
    decDeg: project.decDeg,
    fovWidthDeg: w * (cols - (cols - 1) * ov) * THUMBNAIL_MARGIN,
    fovHeightDeg: h * (rows - (rows - 1) * ov) * THUMBNAIL_MARGIN,
    rotationDeg: norm360(rig.hasRotator ? project.rotationDeg : (rig.defaultRotationDeg ?? 0)),
    survey,
  };
}

/** Kanonische Zeichenkette des Ausschnitts (Grundlage des Schlüssels, Testvektor im Paket). */
export function thumbnailCanonical(p: ThumbnailParams): string {
  return [
    'v1',
    q(norm360(p.raDeg), 1e6),
    q(p.decDeg, 1e6),
    q(p.fovWidthDeg, 1e6),
    q(p.fovHeightDeg, 1e6),
    q(norm360(p.rotationDeg), 1e6),
    p.survey,
  ].join('|');
}

/** S3-Schlüssel im Web-Bucket: `catalog/thumbs/<sha256>.jpg`. */
export function thumbnailKey(p: ThumbnailParams): string {
  return `${THUMBNAIL_PREFIX}${sha256hex(thumbnailCanonical(p))}.jpg`;
}

/** Pfad für den Browser (gleicher Origin, CloudFront `/catalog/*`). */
export const thumbnailUrl = (key: string) => `/${key}`;

/** Bildgröße in Pixeln: längere Kante 320 px, Seitenverhältnis des Ausschnitts. */
export function thumbnailSize(p: ThumbnailParams): { width: number; height: number } {
  const long = THUMBNAIL_LONG_SIDE_PX;
  return p.fovWidthDeg >= p.fovHeightDeg
    ? { width: long, height: Math.max(1, Math.round((long * p.fovHeightDeg) / p.fovWidthDeg)) }
    : { width: Math.max(1, Math.round((long * p.fovWidthDeg) / p.fovHeightDeg)), height: long };
}

/**
 * hips2fits-Aufruf (TK 12, AST-D26): Dezimalgrad, `fov` = Breite des Ausschnitts, `coordsys=icrs`,
 * `projection=TAN`. **Drehung:** `rotation_angle = −pa` – gegen hips2fits geprüft (M 31, PA ≈ 35°: bei
 * `rotation_angle = −35` steht die Großachse senkrecht, die Bild-Oberkante zeigt also in Richtung `pa`).
 */
export function hips2fitsUrl(p: ThumbnailParams): string {
  const { width, height } = thumbnailSize(p);
  const rot = q(norm360(p.rotationDeg), 1e6);
  const params = new URLSearchParams({
    hips: p.survey,
    width: String(width),
    height: String(height),
    fov: String(q(p.fovWidthDeg, 1e6)),
    projection: 'TAN',
    coordsys: 'icrs',
    ra: String(q(norm360(p.raDeg), 1e6)),
    dec: String(q(p.decDeg, 1e6)),
    rotation_angle: String(rot === 0 ? 0 : -rot),
    format: 'jpg',
  });
  return `https://alasky.cds.unistra.fr/hips-image-services/hips2fits?${params.toString()}`;
}
