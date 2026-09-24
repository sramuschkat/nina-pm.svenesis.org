/**
 * Design-Tokens `--npm-*` (TK 11.3, rules/ui.md). Werte übernommen aus www.svenesis.org
 * (`css/style.css`, Stand 21.09.2026, Kopie in legacy/astro-tools-2026-09-21/style.css).
 * Abweichungen für WCAG AA (rules/ui.md): Text- und Knopffarbe `link`/`button` sind eine dunklere Stufe
 * des Akzentblaus – `#3498db` erreicht auf Weiß nur ≈ 3,1:1. Das Dunkel-Theme (Navy-Basis) ist ein
 * Vorschlag dieses Pakets (TK 11.3 nennt keine Werte), Abnahme über H-16.
 * Quelle der generierten Datei `tokens.css` (`pnpm --filter @nina-pm/ui-tokens generate`).
 */

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
export const DENSITIES = ['compact', 'normal', 'wide'] as const;
export type Density = (typeof DENSITIES)[number];

/** Farbwerte je Theme (Schlüssel ohne Präfix `--npm-`). */
export const COLORS: Readonly<Record<Theme, Readonly<Record<string, string>>>> = {
  light: {
    primary: '#1a2a3a',
    'primary-light': '#2c3e50',
    accent: '#3498db',
    'accent-hover': '#2980b9',
    link: '#1f6aa5',
    'link-hover': '#174f7c',
    button: '#1f6aa5',
    'button-hover': '#174f7c',
    'on-button': '#ffffff',
    text: '#333333',
    'text-light': '#595959',
    bg: '#f8f9fa',
    white: '#ffffff',
    border: '#e0e0e0',
    'on-primary': '#ffffff',
    'on-primary-muted': 'rgba(255, 255, 255, 0.85)',
    'note-bg': 'rgba(26, 42, 58, 0.05)',
    danger: '#b3261e',
    'danger-hover': '#8c1d18',
    'danger-bg': '#fdecea',
    success: '#1e7e4f',
    warning: '#8a5a00',
    'warning-bg': '#fff3cd',
    muted: '#6b7785',
    skeleton: '#e9ecef',
  },
  dark: {
    primary: '#0b1621',
    'primary-light': '#1a2a3a',
    accent: '#5dade2',
    'accent-hover': '#85c1e9',
    link: '#85c1e9',
    'link-hover': '#aed6f1',
    button: '#5dade2',
    'button-hover': '#85c1e9',
    'on-button': '#0b1621',
    text: '#e6edf3',
    'text-light': '#a9b6c3',
    bg: '#0f1a24',
    white: '#1a2a3a',
    border: '#2c3e50',
    'on-primary': '#ffffff',
    'on-primary-muted': 'rgba(255, 255, 255, 0.85)',
    'note-bg': 'rgba(255, 255, 255, 0.05)',
    danger: '#f28b82',
    'danger-hover': '#f6aea9',
    'danger-bg': '#3b1f1f',
    success: '#6fcf97',
    warning: '#f0b429',
    'warning-bg': '#3a2f12',
    muted: '#8b98a5',
    skeleton: '#243647',
  },
};

/** Themen-unabhängige Werte. */
export const BASE: Readonly<Record<string, string>> = {
  radius: '8px',
  shadow: '0 2px 12px rgba(0, 0, 0, 0.08)',
  'max-width': '1100px',
  transition: '0.25s ease',
  font: '-apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  'focus-ring': '2px solid var(--npm-accent)',
  'header-h': '64px',
};

/**
 * Himmelsfarben des Nachtdiagramms nach Sonnenhöhe (components.md §2.3 „Hintergrund nach Sonnenhöhe
 * abgestuft“). Bewusst **themen-unabhängig**: das Diagramm zeigt den Himmel, in beiden Themes gleich
 * (Entscheidung 24.09.2026). Stützstellen absteigend, dazwischen linear je Kanal; über der ersten gilt
 * deren Farbe, unter der letzten die letzte. Vorbild: `chartSky` in legacy/…/observing-planner.js.
 */
export const SKY_STOPS: readonly (readonly [
  sunAltDeg: number,
  rgb: readonly [number, number, number],
])[] = [
  [6, [166, 140, 69]],
  [0, [176, 138, 74]],
  [-3, [96, 110, 140]],
  [-6, [62, 104, 150]],
  [-12, [26, 50, 86]],
  [-18, [9, 14, 24]],
];

/** Übrige Farben des Nachtdiagramms auf dem Himmelsgrund (themen-unabhängig, Kontrast gegen `SKY_STOPS`). */
export const CHART: Readonly<Record<string, string>> = {
  'chart-sky-night': 'rgb(9, 14, 24)',
  'chart-grid': 'rgba(255, 255, 255, 0.16)',
  'chart-label': 'rgba(228, 233, 239, 0.8)',
  'chart-target': '#e8ecf2',
  'chart-target-2': '#7fc8f8',
  'chart-moon': '#d8433b',
  'chart-moon-fill': 'rgba(216, 67, 59, 0.28)',
  'chart-min-alt': '#e5484d',
  'chart-marker': '#7fb2e5',
  'chart-recommended': '#2ecc71',
  'chart-moonless': '#16a085',
  'chart-moonlit': '#e5484d',
  'chart-above': '#e67e22',
  'chart-dark': '#7a8799',
};

/** Abstandsskala (UI-4): `--npm-space-n` = Basis × `--npm-space-scale`. */
export const SPACE_PX = [4, 8, 12, 16, 24, 32, 48] as const;

/** Typografie in px bei Schriftskalierung 1 (TK 11.3, gemessen auf Astro-Wetter). */
export const TYPE_PX: Readonly<Record<string, number>> = {
  base: 16,
  h1: 32,
  h2: 20,
  h3: 16.8,
  label: 12.8,
  field: 15.2,
  small: 13.6,
};

/** Dichte-Schalter (TK 11.3): ändert nur Dichtewerte, nie die Breite. */
export const DENSITY: Readonly<Record<Density, Readonly<Record<string, string>>>> = {
  compact: { 'row-h': '28px', 'font-scale': '0.9', 'space-scale': '0.75', 'chart-h': '140px' },
  normal: { 'row-h': '34px', 'font-scale': '1', 'space-scale': '1', 'chart-h': '180px' },
  wide: { 'row-h': '40px', 'font-scale': '1.05', 'space-scale': '1.25', 'chart-h': '240px' },
};

export const STORAGE_KEYS = {
  theme: 'npm.theme',
  density: 'npm.density',
  lang: 'npm.lang',
} as const;

const decl = (entries: Readonly<Record<string, string>>, indent = '  ') =>
  Object.entries(entries)
    .map(([k, v]) => `${indent}--npm-${k}: ${v};`)
    .join('\n');

/** Erzeugt `tokens.css`: Basis + Theme `light` als Standard, `dark` über `data-theme`, Dichte über `data-density`. */
export function renderTokensCss(): string {
  const space = SPACE_PX.map(
    (px, i) => `  --npm-space-${i + 1}: calc(${px}px * var(--npm-space-scale));`,
  ).join('\n');
  const type = Object.entries(TYPE_PX)
    .map(([k, px]) => `  --npm-font-${k}: calc(${px}px * var(--npm-font-scale));`)
    .join('\n');
  return [
    '/* Generiert aus src/tokens.ts – nicht von Hand ändern (pnpm --filter @nina-pm/ui-tokens generate). */',
    ':root,',
    ':root[data-theme="light"] {',
    decl(BASE),
    decl(CHART),
    decl(COLORS.light),
    decl(DENSITY.normal),
    space,
    type,
    '  color-scheme: light;',
    '}',
    ':root[data-theme="dark"] {',
    decl(COLORS.dark),
    '  --npm-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);',
    '  color-scheme: dark;',
    '}',
    ...DENSITIES.map((d) => `:root[data-density="${d}"] {\n${decl(DENSITY[d])}\n}`),
    '',
  ].join('\n');
}
