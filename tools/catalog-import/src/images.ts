/**
 * Katalogbilder zuordnen (AP-20, H-11; dso-import.md §2, T-KAT-12): die Website legt Bilder unter
 * ihren eigenen Bezeichnern ab (`img/ngc/pgc000143.jpg`, kuratiert `img/dso/m31.jpg`). Hochgeladen wird
 * jedes Bild **unverändert** unter der normalisierten `primary_id` (`catalog/img/ngc/<key>.jpg`,
 * `catalog/img/ngc-l/<key>.jpg`), damit Oberfläche und AP-25 es ohne Liste finden.
 *
 * Reihenfolge je Zeile, über `primary_id` und alle Bezeichnungen, Ziffernfolgen ohne führende Nullen:
 * - 128 px (`small`): `img/ngc/`, sonst das 320-px-Bild.
 * - 320 px (`large`): kuratiert `img/dso/` (wie der Beobachtungsplaner der Website), sonst `img/ngc-l/`.
 */
import { catalogImageKey, designationPrefix } from '@nina-pm/shared';

export interface ImageListing {
  readonly dso: readonly string[];
  readonly ngc: readonly string[];
  readonly ngcL: readonly string[];
}

export interface ImageRow {
  readonly primaryId: string;
  readonly names: readonly string[];
}

export interface ImagePlan {
  /** Ziel (relativ zu `catalog/img/`) → Quelle (relativ zum Website-Ordner `img/`). */
  readonly copies: ReadonlyMap<string, string>;
  readonly small: number;
  readonly large: number;
  /** Zeilen ohne 128-px-Bild – die erzeugt AP-25 (`catalog/thumbs/…`). */
  readonly missingSmall: readonly string[];
}

/** Vergleichsform der Dateinamen: `pgc000143.jpg` → `pgc143`. */
const loose = (key: string) => key.replace(/\.jpg$/, '').replace(/(^|[a-z])0+(?=\d)/g, '$1');

function index(files: readonly string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of [...files].filter((x) => x.endsWith('.jpg')).sort()) {
    const k = loose(f);
    if (!m.has(k)) m.set(k, f);
  }
  return m;
}

export function planImages(rows: readonly ImageRow[], listing: ImageListing): ImagePlan {
  const dso = index(listing.dso);
  const ngc = index(listing.ngc);
  const ngcL = index(listing.ngcL);
  const copies = new Map<string, string>();
  const missingSmall: string[] = [];
  let small = 0;
  let large = 0;
  for (const row of rows) {
    const key = catalogImageKey(row.primaryId);
    const candidates = [
      row.primaryId,
      ...row.names.filter((n) => designationPrefix(n) !== null),
    ].map((n) => loose(catalogImageKey(n)));
    const find = (m: Map<string, string>) => {
      for (const c of candidates) {
        const f = m.get(c);
        if (f) return f;
      }
      return null;
    };
    const curated = find(dso);
    const largeFile = find(ngcL);
    const big = curated ? `dso/${curated}` : largeFile ? `ngc-l/${largeFile}` : null;
    const thumb = find(ngc);
    if (big) {
      copies.set(`ngc-l/${key}.jpg`, big);
      large += 1;
    }
    const smallSource = thumb ? `ngc/${thumb}` : big;
    if (smallSource) {
      copies.set(`ngc/${key}.jpg`, smallSource);
      small += 1;
    } else missingSmall.push(row.primaryId);
  }
  return { copies, small, large, missingSmall };
}
