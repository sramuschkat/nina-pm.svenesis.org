/**
 * i18n-Lint (CC-12, AP-06a): DE und EN haben dieselben Schlüssel; jeder in apps/web benutzte Schlüssel
 * existiert; kein Schlüssel ist überzählig (weder direkt noch über ein dynamisches Präfix benutzt).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { flattenKeys } from '../src/index';
import { de } from '../src/locales/de';
import { en } from '../src/locales/en';

const webSrc = fileURLToPath(new URL('../../../apps/web/src/', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')
      ? [path]
      : [];
  });
}

const code = sources(webSrc)
  .map((p) => readFileSync(p, 'utf8'))
  .join('\n');
const errorCodes = new Set(
  (
    JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../../docs/contracts/errors.json', import.meta.url)),
        'utf8',
      ),
    ) as { errors: { code: string }[] }
  ).errors.map((e) => e.code),
);
const deKeys = flattenKeys(de);
const enKeys = flattenKeys(en);

/** Direkt benutzte Schlüssel: jede Zeichenkette im Code, die ein Schlüssel sein kann. */
const literals = new Set(
  [...code.matchAll(/['"`]([a-z][a-zA-Z]*(?:\.[a-zA-Z_]+)+)['"`]/g)].map((m) => m[1]),
);
/** Dynamische Präfixe: t(`nav.${…}`), `status.${kind}.${value}` … */
const prefixes = [...code.matchAll(/`([a-z][a-zA-Z]*(?:\.[a-zA-Z_]+)*\.)\$\{/g)].map(
  (m) => m[1] ?? '',
);

describe('i18n-Lint (CC-12)', () => {
  it('DE und EN haben dieselben Schlüssel (keine fehlenden, keine überzähligen)', () => {
    expect(enKeys.filter((k) => !deKeys.includes(k))).toEqual([]);
    expect(deKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
  });

  it('jeder im Code benutzte Schlüssel existiert', () => {
    const areas = new Set(Object.keys(de));
    // Fehlercodes (`auth.unauthenticated`) sind keine i18n-Schlüssel – deren Text liegt unter `errors.*`.
    const used = [...literals].filter(
      (k): k is string => k !== undefined && !errorCodes.has(k) && areas.has(k.split('.')[0] ?? ''),
    );
    expect(
      used.filter((k) => !deKeys.includes(k) && !deKeys.some((d) => d.startsWith(`${k}.`))),
    ).toEqual([]);
  });

  it('kein Schlüssel ist überzählig', () => {
    const unused = deKeys.filter((k) => !literals.has(k) && !prefixes.some((p) => k.startsWith(p)));
    expect(unused).toEqual([]);
  });

  it('Dynamische Präfixe zeigen auf vorhandene Bereiche', () => {
    for (const p of prefixes)
      expect(
        deKeys.some((k) => k.startsWith(p)),
        p,
      ).toBe(true);
  });
});
