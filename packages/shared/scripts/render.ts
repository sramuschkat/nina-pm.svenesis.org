/** Renderer für die generierten Vertragsdateien (auch vom Test contracts.spec.ts benutzt). */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface ErrorContract {
  code: string;
  http: number;
  i18nKey: string;
  titleDe: string;
  titleEn: string;
}

const contract = (name: string) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../../docs/contracts/${name}`, import.meta.url)),
      'utf8',
    ),
  ) as Record<string, unknown>;

export function loadErrors(): ErrorContract[] {
  return (contract('errors.json') as { errors: ErrorContract[] }).errors;
}

export function loadEnums(): Record<string, unknown> {
  const enums = { ...contract('enums.json') };
  delete enums.$comment;
  return enums;
}

const HEADER =
  '// Generiert aus docs/contracts – nicht von Hand ändern (pnpm contracts:generate).\n';
const lit = (v: unknown) => JSON.stringify(v);
const pascal = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const singular = (s: string) =>
  s.endsWith('ies')
    ? `${s.slice(0, -3)}y`
    : /(us|x|ch|sh)es$/.test(s)
      ? s.slice(0, -2)
      : s.replace(/s$/, '');

export function renderErrors(): string {
  const errors = loadErrors();
  const lines = [
    HEADER,
    'export const ERRORS = {',
    ...errors.map(
      (e) =>
        `  ${lit(e.code)}: { http: ${e.http}, i18nKey: ${lit(e.i18nKey)}, titleDe: ${lit(e.titleDe)}, titleEn: ${lit(e.titleEn)} },`,
    ),
    '} as const;',
    '',
    'export type ErrorCode = keyof typeof ERRORS;',
    '',
    'export const ERROR_CODES = Object.keys(ERRORS) as ErrorCode[];',
    '',
  ];
  return lines.join('\n');
}

/** Typnamen, die sonst mit handgeschriebenen Typen kollidieren (AuthContext, TK 5.3). */
const TYPE_NAMES: Record<string, string> = { authContexts: 'AuthContextKind' };

export function renderEnums(): string {
  const enums = loadEnums();
  const lines = [HEADER];
  for (const [name, value] of Object.entries(enums)) {
    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      const type = TYPE_NAMES[name] ?? pascal(singular(name));
      lines.push(`export const ${name} = ${lit(value)} as const;`);
      lines.push(
        `export type ${type === pascal(name) ? `${type}Value` : type} = (typeof ${name})[number];`,
        '',
      );
    } else {
      lines.push(`export const ${name} = ${JSON.stringify(value, null, 2)} as const;`, '');
    }
  }
  return lines.join('\n');
}

export function renderI18nErrors(): string {
  const errors = loadErrors();
  const map = (lang: 'titleDe' | 'titleEn') =>
    errors.map((e) => `    ${lit(e.i18nKey)}: ${lit(e[lang])},`);
  return [
    HEADER,
    'export const errorMessages = {',
    '  de: {',
    ...map('titleDe'),
    '  },',
    '  en: {',
    ...map('titleEn'),
    '  },',
    '} as const;',
    '',
  ].join('\n');
}
