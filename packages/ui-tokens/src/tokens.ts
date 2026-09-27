/**
 * Design-Tokens `--npm-*` (TK 11.3, rules/ui.md). Werte übernommen aus www.svenesis.org
 * (`css/style.css`, Stand 21.09.2026, Kopie in legacy/astro-tools-2026-09-21/style.css).
 * Abweichungen für WCAG AA (rules/ui.md): Text- und Knopffarbe `link`/`button` sind eine dunklere Stufe
 * des Akzentblaus – `#3498db` erreicht auf Weiß nur ≈ 3,1:1. Das Dunkel-Theme (Navy-Basis) ist ein
 * Vorschlag dieses Pakets (TK 11.3 nennt keine Werte), Abnahme über H-16.
 * Stilsystem AP-26d (Entwurf freigegeben von Sven, 26.09.2026): Fläche `bg` und Linie `border` leicht
 * kühler, Text `text`/`text-light` dunkler als auf der Website – ruhigerer Kontrast der Arbeitsseiten;
 * neue Flächen für weiche Kennzeichen (`*-bg`), Tabellenkopf (`surface-sub`) und Auswahl (`selected-bg`).
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
    text: '#1f2933',
    'text-light': '#52606d',
    bg: '#f3f5f8',
    white: '#ffffff',
    border: '#e3e7ec',
    'border-strong': '#cbd2d9',
    'surface-sub': '#f8fafc',
    'selected-bg': '#e8f1f9',
    'on-primary': '#ffffff',
    'on-primary-muted': 'rgba(255, 255, 255, 0.85)',
    'note-bg': 'rgba(26, 42, 58, 0.05)',
    danger: '#b3261e',
    'danger-hover': '#8c1d18',
    'danger-bg': '#fdecea',
    success: '#1e7e4f',
    'success-bg': '#edf7f0',
    warning: '#8a5a00',
    'warning-bg': '#fff4d6',
    info: '#1f6aa5',
    'info-bg': '#e8f1f9',
    'neutral-bg': '#eef1f4',
    muted: '#6b7785',
    skeleton: '#e9ecef',
    /** Aufwand-Kennzeichen „Transit“ (FA-PRJ-23: violett). */
    violet: '#6a3fb5',
    /** Mondkalender: heutige Nacht (Rahmen) und die besten Nächte (Stern). */
    today: '#e67e22',
    star: '#b9770e',
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
    bg: '#0d1620',
    white: '#15222f',
    border: '#243647',
    'border-strong': '#33495e',
    'surface-sub': '#1a2a3a',
    'selected-bg': '#1f3a52',
    'on-primary': '#ffffff',
    'on-primary-muted': 'rgba(255, 255, 255, 0.85)',
    'note-bg': 'rgba(255, 255, 255, 0.05)',
    danger: '#f28b82',
    'danger-hover': '#f6aea9',
    'danger-bg': '#3b1f1f',
    success: '#6fcf97',
    'success-bg': '#173325',
    warning: '#f0b429',
    'warning-bg': '#3a2f12',
    info: '#85c1e9',
    'info-bg': '#1f3a52',
    'neutral-bg': '#243647',
    muted: '#8b98a5',
    skeleton: '#243647',
    violet: '#c3a6f5',
    today: '#f39c12',
    star: '#f5b041',
  },
};

/** Themen-unabhängige Werte. */
export const BASE: Readonly<Record<string, string>> = {
  radius: '6px',
  'radius-card': '10px',
  shadow: '0 1px 2px rgba(16, 24, 40, 0.05), 0 1px 3px rgba(16, 24, 40, 0.04)',
  'max-width': '1100px',
  transition: '0.25s ease',
  font: '-apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  /** Festbreitenschrift für Protokolle (Planprotokoll des Simulators, AP-26g). */
  'font-mono': 'ui-monospace, "SF Mono", Menlo, Consolas, "Courier New", monospace',
  'focus-ring': '2px solid var(--npm-accent)',
  'header-h': '64px',
};

/**
 * Himmelsfarben des Nachtdiagramms nach Sonnenhöhe (components.md §2.3 „Hintergrund nach Sonnenhöhe
 * abgestuft“). Bewusst **themen-unabhängig**: das Diagramm zeigt den Himmel, in beiden Themes gleich
 * (Entscheidung 24.09.2026). Werte seit AP-26e exakt `CHART_SKY` des Beobachtungsplaners; unter −18° zeichnet
 * das Nachtdiagramm `chart-sky-dark` (grün, astronomisch dunkel), die Plangrafik die letzte Stufe.
 * Stützstellen absteigend, dazwischen linear je Kanal; über der ersten gilt deren Farbe, unter der letzten die
 * letzte. Vorbild: `chartSky` in legacy/…/observing-planner.js.
 */
export const SKY_STOPS: readonly (readonly [
  sunAltDeg: number,
  rgb: readonly [number, number, number],
])[] = [
  [6, [166, 140, 69]],
  [0, [93, 128, 168]],
  [-6, [62, 92, 130]],
  [-12, [31, 51, 80]],
  [-18, [14, 24, 36]],
];

/**
 * Spektralfarben des Filterspektrums (S-14, Entscheidung 24.09.2026 nach Svens Vorlage): Wellenlänge in
 * nm → sRGB, aufsteigend, dazwischen linear je Kanal; unter der ersten bzw. über der letzten Stützstelle
 * (UV/IR) gilt die Randfarbe. Themen-unabhängig: der Grund der Grafik ist dieselbe Farbe mit geringer
 * Deckkraft über dem Theme-Hintergrund, der Balken am Fuß die volle Farbe.
 */
export const SPECTRUM_STOPS: readonly (readonly [
  nm: number,
  rgb: readonly [number, number, number],
])[] = [
  [380, [80, 0, 90]],
  [400, [130, 0, 200]],
  [430, [80, 20, 255]],
  [450, [20, 40, 255]],
  [470, [0, 120, 255]],
  [490, [0, 220, 255]],
  [500, [0, 255, 200]],
  [510, [0, 255, 40]],
  [540, [120, 255, 0]],
  [570, [230, 255, 0]],
  [585, [255, 220, 0]],
  [600, [255, 170, 0]],
  [625, [255, 90, 0]],
  [645, [255, 20, 0]],
  [700, [255, 0, 0]],
  [750, [150, 0, 0]],
];

/** Übrige Farben des Nachtdiagramms auf dem Himmelsgrund (themen-unabhängig, Kontrast gegen `SKY_STOPS`). */
export const CHART: Readonly<Record<string, string>> = {
  'chart-sky-night': 'rgb(14, 24, 36)',
  /** Rahmen, Achsen und Kennzeichen im Stil des Beobachtungsplaners (AP-26e, `COL` in observing-planner.js). */
  'chart-frame': '#10151c',
  'chart-axis': '#9aa7b6',
  'chart-axis-strong': '#c3ccd6',
  'chart-sky-dark': '#0b3a2a',
  'chart-dark-edge': 'rgba(143, 209, 158, 0.75)',
  'chart-now': '#e5484d',
  'chart-meridian': '#c9a3ff',
  'chart-best': '#8fb3ff',
  'chart-moon-label': '#f5c26b',
  /** „Mond und Dunkelheit“ (Planung): Mondhöhe als gelbe Linie wie im Beobachtungsplaner, Kennzeichen über dem
   * Streifen auf dem dunklen Rahmen (aufgehellt gegenüber der Vorlage, die auf hellem Grund zeichnet). */
  'chart-moon-line': '#f5d76e',
  'chart-mark-sun': '#f0a93b',
  'chart-mark-civil': '#9cc1ee',
  'chart-mark-nautical': '#7aa3d6',
  'chart-mark-astro': '#6b91c4',
  'chart-mark-moon': '#e2c65c',
  'chart-dim-label': '#e4e9ef',
  /** Mondsymbol (Kalender, Kopf „Mond und Dunkelheit“): beleuchteter und dunkler Teil, themen-unabhängig. */
  'moon-lit': '#ecebe2',
  'moon-dark': '#2a3038',
  'chart-curve': '#eef2f6',
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
  /** Ziele im Simulator (Höhenkurven und Blöcke, FA-SIM-07); danach wiederholt sich die Reihe. */
  'chart-series-1': '#e8ecf2',
  'chart-series-2': '#7fc8f8',
  'chart-series-3': '#f6c85f',
  'chart-series-4': '#b39ddb',
  'chart-series-5': '#80cbc4',
  'chart-series-6': '#f48fb1',
};

/**
 * Sternkarte S-20 (AP-21): Farben auf dem Himmelsgrund, themen-unabhängig wie das Nachtdiagramm – die Karte
 * zeigt den Himmel. Projekt-Overlays nach Status (FA-FRM-10), Bildfeld des Rigs und Vergleichs-Rig.
 */
export const SKY: Readonly<Record<string, string>> = {
  'sky-bg': 'rgb(6, 10, 20)',
  'sky-ground': 'rgba(60, 40, 18, 0.45)',
  'sky-milky-way': 'rgba(170, 190, 230, 0.07)',
  'sky-grid-eq': 'rgba(120, 170, 230, 0.32)',
  'sky-grid-altaz': 'rgba(120, 220, 160, 0.3)',
  'sky-ecliptic': 'rgba(240, 200, 90, 0.55)',
  'sky-galactic': 'rgba(210, 140, 230, 0.5)',
  'sky-const-line': 'rgba(150, 175, 215, 0.45)',
  'sky-const-label': 'rgba(175, 195, 225, 0.75)',
  'sky-star': '#f4f6fb',
  'sky-star-label': 'rgba(228, 233, 239, 0.85)',
  'sky-dso': '#8fd3a8',
  'sky-dso-label': 'rgba(170, 225, 190, 0.9)',
  'sky-horizon': '#e67e22',
  'sky-min-alt': '#e5484d',
  'sky-meridian': 'rgba(240, 240, 240, 0.4)',
  'sky-heatmap': 'rgba(229, 72, 77, 0.22)',
  'sky-sun': '#f6c85f',
  'sky-day': 'rgba(92, 142, 212, 0.55)',
  'sky-moon': '#e8ecf2',
  'sky-planet': '#f7b267',
  'sky-frame': '#ff4fd8',
  'sky-frame-compare': '#7fc8f8',
  'sky-project-submitted': '#f6c85f',
  'sky-project-planning': '#b39ddb',
  'sky-project-active': '#2ecc71',
  'sky-project-favorite': '#f48fb1',
  'sky-project-unfinished': '#80cbc4',
  'sky-project-completed': '#7a8799',
  'sky-label': 'rgba(228, 233, 239, 0.9)',
};

/**
 * Astro-Wetter `WeatherChart` (components.md §2.5, WS-17; Vorlage legacy/…/weather-core.js): Grafik auf
 * eigenem dunklem Grund, themen-unabhängig wie Nachtdiagramm und Sternkarte. Reine Anzeige – keine dieser
 * Farben verändert einen Score.
 */
export const WEATHER: Readonly<Record<string, string>> = {
  'wx-bg': '#10151c',
  'wx-label-bg': '#0b0f14',
  'wx-grid': 'rgba(255, 255, 255, 0.06)',
  'wx-grid-day': 'rgba(255, 255, 255, 0.18)',
  'wx-text': '#9aa7b6',
  'wx-text-bright': '#e4e9ef',
  'wx-sun': '#d9c24a',
  'wx-sun-fill': 'rgba(200, 170, 50, 0.45)',
  'wx-moon': 'rgba(230, 232, 236, 0.85)',
  'wx-temp': '#e3a33b',
  'wx-dew': '#3fa9e6',
  'wx-now': '#e5484d',
  'wx-day-bar': '#1f6fd6',
  'wx-no-data': '#262c34',
  'wx-seam': 'rgba(228, 233, 239, 0.55)',
  'wx-ink-light': '#ffffff',
  'wx-ink-dark': '#1b2633',
  'wx-dew-warn': 'rgba(224, 123, 43, 0.38)',
  'wx-dew-danger': 'rgba(216, 67, 59, 0.6)',
  'wx-dark': '#8fb3ff',
};

/** Teilbewertungs-Rampe: 0 = blasses Graublau, 1 = gesättigtes Blau (linear je Kanal, §2.5). */
export const WEATHER_RAMP = {
  bad: [198, 208, 220],
  good: [30, 88, 190],
} as const satisfies Readonly<Record<string, readonly [number, number, number]>>;

/** Ampel der Gesamtnote: Stützstellen 0 / 0,45 / 0,65 / 0,85 / 1 – 0,25 bewusst ohne Stop (§2.5). */
export const WEATHER_RATING_STOPS: readonly (readonly [
  score: number,
  rgb: readonly [number, number, number],
])[] = [
  [0, [216, 67, 59]],
  [0.45, [224, 123, 43]],
  [0.65, [217, 181, 43]],
  [0.85, [63, 174, 76]],
  [1, [63, 174, 76]],
];

/** Neutraler Grund, in den die Ampel bei Tageslicht eingeblendet wird. */
export const WEATHER_NEUTRAL: readonly [number, number, number] = [31, 37, 46];

/** Windstufen `wind10Kmh` (km/h, obere Grenze inklusiv); darüber die letzte Farbe. */
export const WEATHER_WIND_STEPS: readonly (readonly [maxKmh: number, color: string])[] = [
  [10, '#3fae4c'],
  [20, '#8fbf2f'],
  [30, '#d9b52b'],
  [40, '#e07b2b'],
];
export const WEATHER_WIND_MAX = '#d8433b';

/** Anzahl der Zielfarben `chart-series-n` (AP-13f). */
export const CHART_SERIES_COUNT = 6;

/** Abstandsskala (UI-4): `--npm-space-n` = Basis × `--npm-space-scale`. */
export const SPACE_PX = [4, 8, 12, 16, 24, 32, 48] as const;

/**
 * Typografie in px bei Schriftskalierung 1 (Stilsystem AP-26d): Titel 24 · Kartentitel 16 · Fließtext,
 * Tabellen und Felder 14 · Nebentext 13 · Beschriftung und Tabellenkopf 12.
 */
export const TYPE_PX: Readonly<Record<string, number>> = {
  base: 14,
  h1: 24,
  h2: 16,
  h3: 14,
  label: 12,
  field: 14,
  small: 13,
};

/** Dichte-Schalter (TK 11.3): ändert nur Dichtewerte, nie die Breite. */
export const DENSITY: Readonly<Record<Density, Readonly<Record<string, string>>>> = {
  compact: { 'row-h': '28px', 'font-scale': '0.93', 'space-scale': '0.75', 'chart-h': '140px' },
  normal: { 'row-h': '32px', 'font-scale': '1', 'space-scale': '1', 'chart-h': '180px' },
  wide: { 'row-h': '36px', 'font-scale': '1.07', 'space-scale': '1.25', 'chart-h': '240px' },
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
    decl(SKY),
    decl(WEATHER),
    decl(COLORS.light),
    decl(DENSITY.normal),
    space,
    type,
    '  color-scheme: light;',
    '}',
    ':root[data-theme="dark"] {',
    decl(COLORS.dark),
    '  --npm-shadow: none;',
    '  color-scheme: dark;',
    '}',
    ...DENSITIES.map((d) => `:root[data-density="${d}"] {\n${decl(DENSITY[d])}\n}`),
    '',
  ].join('\n');
}
