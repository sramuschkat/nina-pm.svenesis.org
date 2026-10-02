import { describe, expect, it } from 'vitest';
import { parseColor } from './color';

describe('parseColor (Tokens nach dem CSS-Minifier, 02.10.2026)', () => {
  it('Hex in allen Längen, auch mit Deckkraft', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1]);
    expect(parseColor('#0008')).toEqual([0, 0, 0, 0.533]);
    expect(parseColor('#5ce1e6')).toEqual([92, 225, 230, 1]);
    // So kommt `rgba(255, 190, 110, 0.12)` aus dem Build an.
    expect(parseColor('#ffbe6e1f')).toEqual([255, 190, 110, 0.122]);
    expect(parseColor('#C4342C80')).toEqual([196, 52, 44, 0.502]);
  });

  it('rgb()/rgba() mit Kommas, Leerzeichen und Schrägstrich', () => {
    expect(parseColor('rgba(205, 215, 255, 0.3)')).toEqual([205, 215, 255, 0.3]);
    expect(parseColor('rgb(6, 10, 20)')).toEqual([6, 10, 20, 1]);
    expect(parseColor('rgb(255 190 110 / 12%)')).toEqual([255, 190, 110, 0.12]);
    expect(parseColor(' rgba(0 0 0 / .5) ')).toEqual([0, 0, 0, 0.5]);
  });

  it('Unbekanntes ergibt null', () => {
    for (const x of ['', 'red', '#12', '#12345', 'rgb(1, 2)', 'rgb(a, b, c)', 'var(--x)'])
      expect(parseColor(x)).toBeNull();
  });
});
