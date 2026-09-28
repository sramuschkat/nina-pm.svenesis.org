/**
 * Landschaft am Horizont der Sternkarte (Wunsch Sven 28.09.2026): sanfte Hügel nach der Vorlage
 * `legacy/astro-tools-2026-09-21/js/sky-map.js` (Hügellinie aus drei Sinuswellen) und darauf Waldstücke und
 * einzelne Bäume – Nadelbäume als Spitzen, Laubbäume als runde Kronen. Alles niedrig: Hügel bis etwa 1,5°,
 * Bäume bis etwa 2°, zusammen höchstens gut 3°. Die Landschaft ist Zierde, kein echter Horizont des
 * Standorts; sie hängt am Azimut und dreht mit der Ansicht. Fest erzeugt (eigener Zufallsgenerator mit
 * festem Startwert), damit sie bei jedem Aufruf gleich aussieht.
 */

const DEG = Math.PI / 180;

/** Höhe der Hügellinie (Grad) über dem mathematischen Horizont je Azimut (Grad). */
export function hillAlt(azDeg: number): number {
  const a = azDeg * DEG;
  return Math.max(
    0.15,
    0.55 + 0.45 * Math.sin(2 * a + 0.5) + 0.3 * Math.sin(5 * a + 1.3) + 0.18 * Math.sin(11 * a + 2),
  );
}

export interface Tree {
  readonly azDeg: number;
  /** Höhe über der Hügellinie (Grad). */
  readonly heightDeg: number;
  readonly kind: 'conifer' | 'broadleaf';
}

/** Kleiner, fester Zufallsgenerator (mulberry32). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Dichte des Walds je Azimut: über 0 liegt ein Waldstück, darunter freies Feld mit vereinzelten Bäumen. */
const forest = (azDeg: number) => {
  const a = azDeg * DEG;
  return Math.sin(3 * a + 1) + 0.45 * Math.sin(7 * a + 0.3) + 0.25 * Math.sin(17 * a + 2.1);
};

function makeTrees(): Tree[] {
  const rand = rng(20260928);
  const out: Tree[] = [];
  let az = 0;
  while (az < 360) {
    const dense = forest(az) > 0.35;
    if (dense || rand() < 0.08) {
      out.push({
        azDeg: az,
        heightDeg: (dense ? 0.9 : 0.7) + rand() * (dense ? 1.1 : 0.9),
        kind: rand() < 0.6 ? 'conifer' : 'broadleaf',
      });
    }
    az += dense ? 0.25 + rand() * 0.45 : 0.6 + rand() * 1.2;
  }
  return out;
}

export const TREES: readonly Tree[] = makeTrees();

/** Bäume je vollem Grad (für die Suche der Bäume nahe einem Azimut). */
const BUCKETS: readonly (readonly Tree[])[] = (() => {
  const b: Tree[][] = Array.from({ length: 360 }, () => []);
  for (const t of TREES) b[Math.floor(t.azDeg) % 360]?.push(t);
  return b;
})();

const wrap180 = (d: number) => (((d % 360) + 540) % 360) - 180;

/** Oberkante eines Baums bei Abstand `d` (Grad) von seiner Mitte, über seinem Fuß; `null` außerhalb. */
function treeTop(t: Tree, d: number): number | null {
  const h = t.heightDeg;
  if (t.kind === 'conifer') {
    const half = 0.22 * h;
    const ad = Math.abs(d);
    if (ad >= half) return null;
    // Leicht gestufte Spitze: zwei Astkränze wie bei einer Fichte.
    const f = 1 - ad / half;
    return h * f * (0.92 + 0.08 * Math.cos(f * 5 * Math.PI));
  }
  const r = 0.36 * h;
  const cy = h - r;
  if (Math.abs(d) < r) return cy + Math.sqrt(r * r - d * d);
  if (Math.abs(d) < 0.06 * h) return cy;
  return null;
}

/** Oberkante der Landschaft (Grad über dem mathematischen Horizont) je Azimut: Hügel oder Baum. */
export function landscapeAlt(azDeg: number): number {
  const az = ((azDeg % 360) + 360) % 360;
  const base = hillAlt(az);
  let top = base;
  const k = Math.floor(az);
  for (const dk of [-1, 0, 1]) {
    for (const t of BUCKETS[(k + dk + 360) % 360] ?? []) {
      const d = wrap180(az - t.azDeg);
      const tt = treeTop(t, d);
      if (tt !== null) top = Math.max(top, hillAlt(t.azDeg) + tt);
    }
  }
  return top;
}

/** Höchster Punkt der Landschaft (Grad), für Tests und die Wahl des Sichtbereichs. */
export const LANDSCAPE_MAX_DEG = Math.max(
  ...Array.from({ length: 3600 }, (_, i) => landscapeAlt(i / 10)),
);
