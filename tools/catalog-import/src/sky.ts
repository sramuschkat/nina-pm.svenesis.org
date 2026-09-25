/**
 * Sterndaten der Sternkarte (AP-21, FA-FRM-03 „Stellarkarte als Offline-Fallback“): liest
 * `packages/catalog-data/js/star-catalog.js` (unveränderte Kopie aus `legacy/astro-tools-2026-09-21`,
 * d3-celestial/XHIP, BSD-3-Clause) und schreibt `packages/catalog-data/sky/sky.json` – Sterne bis 6 mag
 * mit Namen und Bayer-Buchstaben, Sternbildlinien, -grenzen, -namen und die Milchstraße. Die Sterne von
 * 6 bis 8 mag bleiben in `data/stars-8.bin` (Binärformat, lädt die Karte beim Hineinzoomen).
 * Deterministisch; ein Test prüft die eingecheckte Ausgabe.
 */
import { runInNewContext } from 'node:vm';

export interface SkyData {
  readonly source: string;
  readonly licence: string;
  /** `[ra°, dec°, mag, B−V, Name de?, Name en?, Bayer?]`, hell nach schwach (J2000, Epoche 2000). */
  readonly stars: readonly (readonly (number | string)[])[];
  /** Polylinien je Sternbild: `[ra°, dec°, ra°, dec°, …]`. */
  readonly lines: Readonly<Record<string, readonly (readonly number[])[]>>;
  /** Ein geschlossener Ring je Sternbild (Serpens zweimal), J2000-Ecken der IAU-Grenzen. */
  readonly bounds: readonly (readonly [string, readonly number[]])[];
  /** `[IAU, ra°, dec°, Rang 1–3, Name de, Name lat, Name en]`. */
  readonly labels: readonly (readonly (string | number)[])[];
  /** Milchstraße in fünf Helligkeitsstufen auf einem 0,5°-Raster, lauflängencodiert (a–f + Länge). */
  readonly milkyWay: {
    readonly w: number;
    readonly h: number;
    readonly step: number;
    readonly rle: string;
  };
}

interface SvSky {
  stars: (number | string)[][];
  lines: Record<string, number[][]>;
  bounds: [string, number[]][];
  labels: (string | number)[][];
  milkyWay: SkyData['milkyWay'];
}

export function buildSkyData(starCatalogJs: string): SkyData {
  const window: { SvSky?: SvSky } = {};
  runInNewContext(starCatalogJs, { window });
  const sky = window.SvSky;
  if (!sky) throw new Error('star-catalog.js: window.SvSky fehlt');
  if (sky.stars.length < 5000)
    throw new Error(`star-catalog.js: nur ${String(sky.stars.length)} Sterne`);
  return {
    source:
      'packages/catalog-data/js/star-catalog.js (Website-Vorlage 21.09.2026): d3-celestial von Olaf Frohn, XHIP/Hipparcos, IAU-Sternbilder, Milky Way Outline Catalog (J. R. Vieira)',
    licence:
      'BSD-3-Clause (d3-celestial, Copyright (c) 2015, Olaf Frohn); Hinweis in THIRD_PARTY_NOTICES.md',
    stars: sky.stars,
    lines: sky.lines,
    bounds: sky.bounds,
    labels: sky.labels,
    milkyWay: sky.milkyWay,
  };
}

/** Eine Zeile je Stern bzw. Sternbild – lesbare Diffs bei einer neuen Vorlage. */
export function skyJson(d: SkyData): string {
  const rows = (xs: readonly unknown[]) => xs.map((x) => `    ${JSON.stringify(x)}`).join(',\n');
  const lines = Object.keys(d.lines)
    .sort()
    .map((k) => `    ${JSON.stringify(k)}: ${JSON.stringify(d.lines[k])}`)
    .join(',\n');
  return [
    '{',
    `  "source": ${JSON.stringify(d.source)},`,
    `  "licence": ${JSON.stringify(d.licence)},`,
    `  "stars": [\n${rows(d.stars)}\n  ],`,
    `  "lines": {\n${lines}\n  },`,
    `  "bounds": [\n${rows(d.bounds)}\n  ],`,
    `  "labels": [\n${rows(d.labels)}\n  ],`,
    `  "milkyWay": ${JSON.stringify(d.milkyWay)}`,
    '}',
    '',
  ].join('\n');
}
