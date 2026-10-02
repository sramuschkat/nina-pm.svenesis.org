/**
 * Farbwerte lesen, wie sie aus den Tokens im Browser ankommen: Der CSS-Minifier schreibt `rgba(…)` als
 * `#rrggbbaa` und `#ffffff` als `#fff` – die Sternkarte las beides nicht und zeichnete Heatmap, Horizontschimmer
 * und Milchstraße in deckendem Grau (Wunsch Sven 02.10.2026). Versteht `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`
 * sowie `rgb()`/`rgba()` mit Kommas oder Leerzeichen und `/ Deckkraft` (Zahl oder Prozent).
 * Ergebnis `[r, g, b, a]` mit Kanälen 0…255 und Deckkraft 0…1, sonst `null`.
 */
export function parseColor(input: string): [number, number, number, number] | null {
  const c = input.trim();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(c)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((x) => x + x).join('') : hex;
    const at = (i: number) => parseInt(full.slice(i, i + 2), 16);
    return [at(0), at(2), at(4), full.length === 8 ? Math.round((at(6) / 255) * 1000) / 1000 : 1];
  }
  const fn = /^rgba?\(([^)]*)\)$/i.exec(c)?.[1];
  if (!fn) return null;
  const parts = fn
    .replace('/', ' ')
    .split(/[\s,]+/)
    .filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const channel = (v: string) =>
    v.endsWith('%') ? (Number(v.slice(0, -1)) / 100) * 255 : Number(v);
  const alpha = (v: string | undefined) =>
    v === undefined ? 1 : v.endsWith('%') ? Number(v.slice(0, -1)) / 100 : Number(v);
  const out = [
    channel(parts[0] as string),
    channel(parts[1] as string),
    channel(parts[2] as string),
    alpha(parts[3]),
  ];
  if (out.some((v) => !Number.isFinite(v))) return null;
  return out as [number, number, number, number];
}
