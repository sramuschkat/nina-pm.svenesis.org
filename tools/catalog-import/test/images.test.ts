/**
 * T-KAT-12 (dso-import.md §4, Teil AP-20): Dateinamen aus der normalisierten `primary_id` eindeutig;
 * Zuordnung der Website-Bilder (Nullen, kuratierte Bilder unter dem Messier-Namen, 320 px als Ersatz
 * für 128 px). Die Vollständigkeit gegen den echten Website-Ordner meldet `pnpm catalog:upload`
 * (H-11); die selbst erzeugten Vorschauen unter `catalog/thumbs/…` prüft AP-25.
 */
import { readFileSync } from 'node:fs';
import { catalogImageKey, catalogImagePaths } from '@nina-pm/shared';
import { describe, expect, it } from 'vitest';
import { OUTPUT_JSON } from '../src/files';
import { planImages } from '../src/images';

const rows = (
  JSON.parse(readFileSync(OUTPUT_JSON, 'utf8')) as {
    rows: { primaryId: string; names: string[] }[];
  }
).rows;

describe('T-KAT-12 Bilder', () => {
  it('Dateinamen aus der normalisierten primary_id sind eindeutig', () => {
    const keys = rows.map((r) => catalogImageKey(r.primaryId));
    expect(new Set(keys).size).toBe(rows.length);
    for (const k of keys) expect(k).toMatch(/^[a-z0-9]+$/);
    expect(catalogImagePaths('NGC 224')).toEqual({
      small: '/catalog/img/ngc/ngc224.jpg',
      large: '/catalog/img/ngc-l/ngc224.jpg',
    });
    expect(catalogImageKey('Sh2-129')).toBe('sh2129');
  });

  it('ordnet Website-Bilder über primary_id und Bezeichnungen zu (ohne führende Nullen)', () => {
    const plan = planImages(
      [
        { primaryId: 'NGC 224', names: ['M 31', 'Andromeda Galaxy'] },
        { primaryId: 'PGC 143', names: ['WLM Galaxy'] },
        { primaryId: 'ESO 56-115', names: ['Large Magellanic Cloud'] },
        { primaryId: 'NGC 7000', names: ['C 20'] },
        { primaryId: 'Sh2-129', names: [] },
        { primaryId: 'IC 9999', names: [] },
      ],
      {
        dso: ['m31.jpg'],
        ngc: ['ngc224.jpg', 'pgc000143.jpg', 'eso056115.jpg', 'ngc7000.jpg', 'ngc700.jpg'],
        ngcL: ['ngc224.jpg', 'sh2129.jpg'],
      },
    );
    expect(Object.fromEntries(plan.copies)).toEqual({
      // kuratiertes Bild (Website-Planer) vor ngc-l
      'ngc-l/ngc224.jpg': 'dso/m31.jpg',
      'ngc/ngc224.jpg': 'ngc/ngc224.jpg',
      'ngc/pgc143.jpg': 'ngc/pgc000143.jpg',
      'ngc/eso56115.jpg': 'ngc/eso056115.jpg',
      // 7000 bleibt 7000 (keine Nullen innerhalb der Nummer entfernt)
      'ngc/ngc7000.jpg': 'ngc/ngc7000.jpg',
      // ohne 128-px-Bild dient das 320-px-Bild
      'ngc-l/sh2129.jpg': 'ngc-l/sh2129.jpg',
      'ngc/sh2129.jpg': 'ngc-l/sh2129.jpg',
    });
    expect(plan).toMatchObject({ small: 5, large: 2, missingSmall: ['IC 9999'] });
  });
});
