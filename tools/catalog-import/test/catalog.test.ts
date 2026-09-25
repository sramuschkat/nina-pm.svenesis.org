/**
 * Pflicht-Tests des Katalog-Imports (docs/specs/catalog/dso-import.md §4, T-KAT-01…10) gegen die
 * eingecheckten Quellen (OpenNGC v20260501 + Website-Auszug); dazu: die eingecheckte Ausgabe entspricht
 * dem Build (deterministisch). T-KAT-11 (Idempotenz in `dso_object`) prüft der Repository-Test,
 * T-KAT-12 (Bilder) in `images.test.ts` (Zuordnung) und AP-25 (eigene Vorschauen).
 */
import { readFileSync } from 'node:fs';
import { dsoObjectTypes } from '@nina-pm/shared';
import { describe, expect, it } from 'vitest';
import {
  axisPa,
  buildCatalog,
  decToDeg,
  displayName,
  IAU_CONSTELLATIONS,
  normalizeDesignation,
  raToDeg,
  squeeze,
  type DsoRow,
} from '../src/build';
import {
  catalogData,
  OUTPUT_JSON,
  OUTPUT_META,
  OUTPUT_REPORT,
  readCatalogInput,
} from '../src/files';
import { catalogJson, catalogMeta, importReport } from '../src/output';

const input = readCatalogInput();
const build = buildCatalog(input);
const byId = new Map(build.rows.map((r) => [r.primaryId, r]));
/** Bezeichnung → Zeile (primary_id oder Name mit Katalogkürzel). */
const lookup = new Map<string, DsoRow>();
for (const r of build.rows)
  for (const n of [r.primaryId, ...r.names]) if (!lookup.has(squeeze(n))) lookup.set(squeeze(n), r);
const findable = (d: string) => lookup.has(squeeze(normalizeDesignation(d)));
const rowOf = (d: string) => lookup.get(squeeze(normalizeDesignation(d)));
const gone = new Set(build.nonexistent.map(squeeze));
const isOpenNgc = (r: DsoRow) => r.source.startsWith('openngc:');
const version = JSON.parse(readFileSync(`${catalogData}openngc/VERSION.json`, 'utf8')) as {
  files: Record<string, { rows: number }>;
};

describe('Normalisierung und Umrechnung (§2)', () => {
  it('Bezeichnungen, RA/Dec, Positionswinkel', () => {
    expect(normalizeDesignation('NGC0224')).toBe('NGC 224');
    expect(normalizeDesignation('ESO056-115')).toBe('ESO 56-115');
    expect(normalizeDesignation('PGC 002557')).toBe('PGC 2557');
    expect(normalizeDesignation('SH 2-155')).toBe('Sh2-155');
    expect(normalizeDesignation('IC0080 NED01')).toBe('IC 80 NED01');
    expect(normalizeDesignation('NGC5866B')).toBe('NGC 5866B');
    expect(raToDeg('00:42:44.35')).toBeCloseTo(10.684792, 6);
    expect(decToDeg('-00:24:54.8')).toBeCloseTo(-0.415222, 6);
    expect(axisPa(180, 2, 1)).toBe(0);
    expect(axisPa(190, 2, 1)).toBe(10);
    expect(axisPa(35, 2, null)).toBeNull();
  });
});

describe('Pflicht-Tests T-KAT', () => {
  it('T-KAT-01 Wertebereiche je Zeile', () => {
    const bad = build.rows.filter(
      (r) =>
        !(r.raDeg >= 0 && r.raDeg < 360) ||
        Math.abs(r.decDeg) > 90 ||
        !(dsoObjectTypes as readonly string[]).includes(r.objectType) ||
        (r.sizeMajorArcmin !== null && !(r.sizeMajorArcmin > 0)) ||
        (r.sizeMinorArcmin !== null &&
          r.sizeMajorArcmin !== null &&
          r.sizeMinorArcmin > r.sizeMajorArcmin) ||
        (r.positionAngleDeg !== null && !(r.positionAngleDeg >= 0 && r.positionAngleDeg < 180)) ||
        (isOpenNgc(r) &&
          !(IAU_CONSTELLATIONS as readonly string[]).includes(r.constellation ?? '')),
    );
    expect(bad.map((r) => r.primaryId)).toEqual([]);
  });

  it('T-KAT-02 Helligkeiten und Bänder', () => {
    for (const r of build.rows) {
      expect(r.magBandUsed).toBe(r.magV !== null ? 'V' : r.magB !== null ? 'B' : null);
      if (!isOpenNgc(r)) expect([r.magV, r.magB, r.surfBrMagArcsec2]).toEqual([null, null, null]);
    }
    const starsWithSurface = build.rows.filter(
      (r) => r.surfBrMagArcsec2 !== null && ['*', '**', '*Ass', 'Nova'].includes(r.objectType),
    );
    expect(starsWithSurface).toEqual([]);
    expect(byId.get('NGC 224')).toMatchObject({
      magV: 3.44,
      magB: 4.29,
      magBandUsed: 'V',
      surfBrMagArcsec2: 23.63,
    });
  });

  it('T-KAT-03 Positionswinkel nur mit beiden Achsen, 180 kommt nicht vor', () => {
    for (const r of build.rows) {
      if (r.sizeMajorArcmin === null || r.sizeMinorArcmin === null)
        expect(r.positionAngleDeg).toBeNull();
      expect(r.positionAngleDeg).not.toBe(180);
    }
    expect(byId.get('NGC 224')?.positionAngleDeg).toBe(35);
  });

  it('T-KAT-04 Aliasziele: eindeutig, nie auf sich selbst', () => {
    const owners = new Map<string, string>();
    const clash: string[] = [];
    for (const r of build.rows)
      for (const n of r.names) {
        expect(squeeze(n)).not.toBe(squeeze(r.primaryId));
        if (!/^[A-Za-z]+(?:2-|\s)[\dJ+-]/.test(n)) continue;
        const prev = owners.get(squeeze(n));
        if (prev && prev !== r.primaryId) clash.push(`${n}: ${prev} / ${r.primaryId}`);
        owners.set(squeeze(n), r.primaryId);
        if (byId.has(n)) clash.push(`${n} ist zugleich primary_id`);
      }
    expect(clash).toEqual([]);
    expect(rowOf('NGC 224') && displayName(rowOf('NGC 224') as DsoRow)).toBe('M 31');
  });

  it('T-KAT-05 Messier, NGC, IC vollständig (nur NonEx darf fehlen)', () => {
    const want = [
      ...Array.from({ length: 110 }, (_, i) => `M ${String(i + 1)}`),
      ...Array.from({ length: 7840 }, (_, i) => `NGC ${String(i + 1)}`),
      ...Array.from({ length: 5386 }, (_, i) => `IC ${String(i + 1)}`),
    ];
    expect(want.filter((d) => !findable(d) && !gone.has(squeeze(d)))).toEqual([]);
  });

  it('T-KAT-06 Caldwell und Sharpless vollständig, 14 Paare, 4 eigene Regionen', () => {
    const want = [
      ...Array.from({ length: 109 }, (_, i) => `C ${String(i + 1)}`),
      ...Array.from({ length: 313 }, (_, i) => `Sh2-${String(i + 1)}`),
    ];
    expect(want.filter((d) => !findable(d))).toEqual([]);
    const pairs: [string, string][] = [
      ['Sh2-281', 'M 42'],
      ['Sh2-117', 'NGC 7000'],
      ['Sh2-49', 'M 16'],
      ['Sh2-25', 'M 8'],
      ['Sh2-30', 'M 20'],
      ['Sh2-275', 'NGC 2237'],
      ['Sh2-131', 'IC 1396'],
      ['Sh2-155', 'C 9'],
      ['Sh2-244', 'M 1'],
      ['C 30', 'NGC 7331'],
      ['C 14', 'NGC 869'],
      ['C 20', 'NGC 7000'],
      ['C 50', 'NGC 2239'],
      ['C 37', 'NGC 6882'],
    ];
    expect(pairs.filter(([a, b]) => rowOf(a) !== rowOf(b)).map(([a, b]) => `${a} ≠ ${b}`)).toEqual(
      [],
    );
    for (const own of ['Sh2-103', 'Sh2-129', 'Sh2-240', 'Sh2-276'])
      expect(rowOf(own)?.primaryId).toBe(own);
    expect(displayName(byId.get('Sh2-103') as DsoRow)).toBe('Sh2-103');
  });

  it('T-KAT-07 Dubletten: M 102 = NGC 5866, M 16 = IC 4703, keine Dup/NonEx-Zeile', () => {
    expect(build.rows.filter((r) => r.objectType === 'Dup' || r.objectType === 'NonEx')).toEqual(
      [],
    );
    expect(rowOf('M 102')?.primaryId).toBe('NGC 5866');
    expect(rowOf('IC 4703')).toBe(rowOf('M 16'));
    expect(byId.has('IC 4703')).toBe(false);
    expect(build.merged.map((m) => m.from)).toContain('IC 4703');
  });

  it('T-KAT-08 Helligkeiten nur aus OpenNGC, Herkunft je Zeile', () => {
    const curated = JSON.parse(
      input.curatedJs.replace(/^[\s\S]*?=\s*/, '').replace(/;\s*$/, ''),
    ) as {
      id: string;
      m?: number;
    }[];
    const differs = curated.filter((o) => {
      const r = rowOf(o.id);
      return r && o.m !== undefined && r.magV !== null && r.magV !== o.m;
    });
    expect(differs.length).toBeGreaterThanOrEqual(20);
    const noSource = build.rows.filter((r) => !isOpenNgc(r) && !r.source.startsWith('sharpless:'));
    expect(noSource).toEqual([]);
    expect(build.rows.filter((r) => r.source.startsWith('sharpless:')).length).toBe(
      build.counts.sharpless,
    );
    expect(byId.get('NGC 224')?.source).toBe('openngc:NGC.csv v20260501');
  });

  it('T-KAT-09 Bezeichnungen normalisiert, Sterne benannt, keine Sternnummern an Nebeln', () => {
    const all = build.rows.flatMap((r) => [r.primaryId, ...r.names]);
    expect(
      all.filter(
        (n) => /^(PGC|UGC|UGCA|HD|HIP|Mel|Cl|LBN|ESO|NGC|IC|M|C|B) 0/.test(n) || /^SH 2/.test(n),
      ),
    ).toEqual([]);
    expect(byId.get('NGC 1990')?.names).toContain('Alnilam');
    expect(rowOf('M 73')?.primaryId).toBe('NGC 6994');
    const starNumbersOnNebulae = build.rows.filter(
      (r) =>
        !['*', '**', '*Ass'].includes(r.objectType) &&
        r.names.some((n) => /^(HD|HIP|WDS) /.test(n)),
    );
    expect(starNumbersOnNebulae.map((r) => r.primaryId)).toEqual([]);
    expect(byId.get('NGC 5457')?.names ?? []).not.toContain('M 102');
  });

  it('T-KAT-10 Objektzahl je Datei (Sollwerte der Version)', () => {
    expect(build.counts.ngcCsv).toBe(version.files['NGC.csv']?.rows);
    expect(build.counts.addendumCsv).toBe(version.files['addendum.csv']?.rows);
    expect(importReport(build)).toContain('13969 + 64 = 14033');
  });
});

describe('Ausgabe', () => {
  it('die eingecheckte Ausgabe entspricht dem Build (pnpm catalog:build)', () => {
    expect(readFileSync(OUTPUT_JSON, 'utf8')).toBe(catalogJson(build));
    expect(readFileSync(OUTPUT_REPORT, 'utf8')).toBe(importReport(build));
    expect(readFileSync(OUTPUT_META, 'utf8')).toBe(catalogMeta(build));
  });

  it('Kandidaten der Galerie > 800 (§3 Nr. 6)', () => {
    const cands = build.rows.filter(
      (r) =>
        !['*', '**', '*Ass'].includes(r.objectType) &&
        r.sizeMajorArcmin !== null &&
        r.sizeMajorArcmin >= 3 &&
        r.sizeMajorArcmin <= 180 &&
        !/(\d[A-Z]| NED\d+)$/.test(r.primaryId),
    );
    expect(cands.length).toBeGreaterThan(800);
  });
});
