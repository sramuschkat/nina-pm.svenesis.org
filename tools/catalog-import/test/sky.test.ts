/**
 * Sterndaten der Sternkarte (AP-21): `sky/sky.json` entspricht dem Build aus `js/star-catalog.js`
 * (deterministisch), enthält alle 88 Sternbilder und die hellen Sterne mit Namen.
 */
import { readFileSync } from 'node:fs';
import { IAU_CONSTELLATIONS } from '@nina-pm/shared';
import { describe, expect, it } from 'vitest';
import { OUTPUT_SKY, STAR_CATALOG_JS } from '../src/files';
import { buildSkyData, skyJson } from '../src/sky';

const sky = buildSkyData(readFileSync(STAR_CATALOG_JS, 'utf8'));

describe('Sterndaten (sky.json)', () => {
  it('eingecheckte Ausgabe entspricht dem Build', () => {
    expect(readFileSync(OUTPUT_SKY, 'utf8')).toBe(skyJson(sky));
  });

  it('Sterne bis 6 mag, hell nach schwach, Sirius zuerst', () => {
    expect(sky.stars.length).toBeGreaterThan(5000);
    expect(sky.stars[0]?.[4]).toBe('Sirius');
    const mags = sky.stars.map((s) => s[2] as number);
    expect(Math.max(...mags)).toBeLessThanOrEqual(6);
    expect(mags).toEqual([...mags].sort((a, b) => a - b));
  });

  it('alle 88 Sternbilder mit Linien, Grenzen und Namen', () => {
    const labels = new Set(sky.labels.map((l) => l[0]));
    const bounds = new Set(sky.bounds.map((b) => b[0]));
    for (const c of IAU_CONSTELLATIONS) {
      expect(labels.has(c), c).toBe(true);
      expect(bounds.has(c), c).toBe(true);
    }
    expect(Object.keys(sky.lines)).toHaveLength(88);
    expect(sky.milkyWay).toMatchObject({ w: 720, h: 360, step: 0.5 });
  });
});
