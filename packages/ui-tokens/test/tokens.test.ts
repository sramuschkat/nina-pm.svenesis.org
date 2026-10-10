import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COLORS, DENSITY, renderTokensCss, SKY, SKY_HOURS_STEPS, SPACE_PX } from '../src/tokens';

/** Relative Leuchtdichte (WCAG 2.1) für #rrggbb. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

describe('ui-tokens (TK 11.3)', () => {
  it('tokens.css ist aktuell', () => {
    expect(readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8')).toBe(
      renderTokensCss(),
    );
  });

  it('beide Themes haben dieselben Schlüssel; kein Rotlicht-Theme', () => {
    expect(Object.keys(COLORS)).toEqual(['light', 'dark']);
    expect(Object.keys(COLORS.dark).sort()).toEqual(Object.keys(COLORS.light).sort());
  });

  it('Werte der Website im hellen Theme (Farben aus style.css; Fläche/Linie nach Stilsystem AP-26d)', () => {
    expect(COLORS.light).toMatchObject({
      primary: '#1a2a3a',
      'primary-light': '#2c3e50',
      accent: '#3498db',
      white: '#ffffff',
      // AP-26d: bewusst leicht kühler als die Website (#f8f9fa / #e0e0e0).
      bg: '#f3f5f8',
      border: '#e3e7ec',
    });
  });

  it.each(['light', 'dark'] as const)('%s: Text- und Knopfkontrast ≥ 4,5:1 (WCAG AA)', (theme) => {
    const c = COLORS[theme] as Record<string, string>;
    const pairs: [string, string][] = [
      ['text', 'bg'],
      ['text', 'white'],
      ['text-light', 'bg'],
      ['text-light', 'white'],
      ['link', 'bg'],
      ['link', 'white'],
      ['on-button', 'button'],
      ['on-primary', 'primary'],
      ['danger', 'white'],
      ['success', 'white'],
      ['warning', 'white'],
      // AP-26d: weiche Kennzeichen (Text auf getönter Fläche), Auswahl und Tabellenkopf.
      ['success', 'success-bg'],
      ['warning', 'warning-bg'],
      ['danger', 'danger-bg'],
      ['info', 'info-bg'],
      ['text-light', 'neutral-bg'],
      ['link', 'selected-bg'],
      ['text', 'surface-sub'],
      ['text-light', 'surface-sub'],
    ];
    for (const [fg, bg] of pairs) {
      expect(contrast(c[fg] ?? '', c[bg] ?? ''), `${fg} auf ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('Dichte ändert nur Zeilenhöhe, Schrift, Abstand, Diagrammhöhe; Abstandsskala 4…48 px', () => {
    for (const d of Object.values(DENSITY))
      expect(Object.keys(d).sort()).toEqual(['chart-h', 'font-scale', 'row-h', 'space-scale']);
    expect([...SPACE_PX]).toEqual([4, 8, 12, 16, 24, 32, 48]);
    expect(renderTokensCss()).not.toMatch(/max-width:\s*\d+px;\n.*data-density/);
  });
});

/** sRGB (#rrggbb) → linear. */
const linear = (hex: string) =>
  [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
/** Lineares RGB → OKLab (Björn Ottosson), L in 0…100. */
function oklab([r, g, b]: readonly [number, number, number]): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    100 * (0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s),
    100 * (1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s),
    100 * (0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s),
  ];
}
/** Farbsehschwäche (Machado 2009, Stärke 1,0) im linearen RGB. */
const CVD: Record<string, readonly (readonly [number, number, number])[]> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
};
const simulate = (rgb: readonly [number, number, number], m: (typeof CVD)['protan']) =>
  m.map((row) => Math.min(1, Math.max(0, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]))) as [
    number,
    number,
    number,
  ];
const deltaE = (a: readonly number[], b: readonly number[]) =>
  Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));

describe('Auswertung „Himmel“ (AP-69): Farben auf dem Himmelsgrund', () => {
  const bg = '#060a14'; // sky-bg rgb(6, 10, 20)
  const hours = Array.from(
    { length: SKY_HOURS_STEPS },
    (_, i) => SKY[`sky-hours-${String(i + 1)}`] as string,
  );
  const mix = ['broadband', 'narrowband', 'osc', 'mixed'].map((k) => SKY[`sky-mix-${k}`] as string);

  it('Stundenskala: Helligkeit steigt deutlich je Stufe, Kontrast ≥ 3:1 gegen den Grund', () => {
    const L = hours.map((h) => oklab(linear(h))[0]);
    for (let i = 1; i < L.length; i += 1)
      expect((L[i] ?? 0) - (L[i - 1] ?? 0), `Stufe ${String(i + 1)}`).toBeGreaterThan(5);
    for (const h of hours) expect(contrast(h, bg), h).toBeGreaterThanOrEqual(3);
  });

  it('Filtermix: Kontrast ≥ 3:1, je Paar Abstand ≥ 8 – normal und bei Rot-/Grün-Schwäche', () => {
    for (const c of mix) expect(contrast(c, bg), c).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < mix.length; i += 1)
      for (let j = i + 1; j < mix.length; j += 1) {
        const a = linear(mix[i] as string);
        const b = linear(mix[j] as string);
        expect(deltaE(oklab(a), oklab(b))).toBeGreaterThanOrEqual(8);
        for (const [name, m] of Object.entries(CVD))
          expect(
            deltaE(oklab(simulate(a, m)), oklab(simulate(b, m))),
            `${name} ${String(mix[i])} ~ ${String(mix[j])}`,
          ).toBeGreaterThanOrEqual(8);
      }
  });
});
