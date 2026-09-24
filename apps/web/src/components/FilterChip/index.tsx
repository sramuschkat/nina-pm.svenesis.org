/**
 * `FilterChip` (components.md §2.1): Filter als Farbmarke mit Kurznamen. Ohne `onToggle` ein `<span>`,
 * mit `onToggle` ein `<button aria-pressed>`. Schrift dunkel ab Helligkeit > 60 %, sonst hell.
 */
import styles from './FilterChip.module.css';

export interface FilterChipProps {
  shortName: string;
  /** Hex aus `filter.color`, z. B. `#d33`. */
  color: string;
  size?: 'sm' | 'md';
  selected?: boolean;
  disabled?: boolean;
  onToggle?: () => void;
  title?: string;
}

const MAX_CHARS = 4;
const DARK_TEXT = '#1a1a1a';
const LIGHT_TEXT = '#ffffff';

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** Relative Leuchtdichte (WCAG 2.1). */
export function relativeLuminance(hex: string): number {
  const c = rgb(hex) ?? [128, 128, 128];
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Schriftfarbe zur Filterfarbe: „Helligkeit über 60 %“ als wahrgenommene Helligkeit; im Grenzbereich
 * gewinnt die Farbe mit dem höheren Kontrast (Ziel ≥ 4,5:1, Testfall).
 */
export function chipTextColor(hex: string): string {
  const c = rgb(hex) ?? [128, 128, 128];
  const brightness = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
  const preferred = brightness > 0.6 ? DARK_TEXT : LIGHT_TEXT;
  const other = preferred === DARK_TEXT ? LIGHT_TEXT : DARK_TEXT;
  return contrastRatio(preferred, hex) >= contrastRatio(other, hex) ? preferred : other;
}

const MIN_CONTRAST = 4.5;
const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');

/**
 * Hintergrund der Marke: die Filterfarbe; erreicht bei Mitteltönen (z. B. `#00897B`) keine der beiden
 * Schriftfarben 4,5:1, wird sie schrittweise abgedunkelt, bis helle Schrift genügt (components.md §2.1).
 */
export function chipBackground(hex: string): string {
  const ok = (h: string) =>
    Math.max(contrastRatio(DARK_TEXT, h), contrastRatio(LIGHT_TEXT, h)) >= MIN_CONTRAST;
  const c = rgb(hex);
  if (!c || ok(hex)) return hex;
  let [r, g, b] = c;
  let out = hex;
  for (let i = 0; i < 40 && !ok(out); i += 1) {
    [r, g, b] = [r * 0.95, g * 0.95, b * 0.95];
    out = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  }
  return out;
}

export function FilterChip({
  shortName,
  color,
  size = 'md',
  selected,
  disabled,
  onToggle,
  title,
}: FilterChipProps) {
  const label = shortName.length > MAX_CHARS ? shortName.slice(0, MAX_CHARS) : shortName;
  const fullTitle = title ?? (shortName.length > MAX_CHARS ? shortName : undefined);
  const background = chipBackground(color);
  const style = { background, color: chipTextColor(background) };
  const className = `${styles.chip} ${size === 'sm' ? styles.sm : styles.md} ${selected ? styles.selected : ''}`;
  if (!onToggle) {
    return (
      <span className={className} style={style} title={fullTitle}>
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={className}
      style={style}
      title={fullTitle}
      aria-pressed={selected ?? false}
      disabled={disabled}
      onClick={onToggle}
    >
      {label}
    </button>
  );
}
