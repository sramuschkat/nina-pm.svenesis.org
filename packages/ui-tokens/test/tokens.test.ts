import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COLORS, DENSITY, renderTokensCss, SPACE_PX } from '../src/tokens';

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
