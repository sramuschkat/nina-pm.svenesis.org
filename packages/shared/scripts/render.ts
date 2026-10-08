/** Renderer für die generierten Vertragsdateien (auch vom Test contracts.spec.ts benutzt). */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { GoldenPlanSchema } from '../src/contracts/grid';
import { nina } from '../src/contracts';
import { NightPlanSchema, PlanInputSchema } from '../src/contracts/plan';

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

/** JSON Schema des Soll-Plan-/Grid-Formats (AP-13a) aus dem zod-Vertrag. */
export function renderGridSchema(): string {
  const schema = z.toJSONSchema(GoldenPlanSchema, { target: 'draft-2020-12' });
  return `${JSON.stringify({ ...schema, title: 'Svenesis NINA-PM – Soll-Plan / Grid (allocation.md §11.2)' }, null, 2)}\n`;
}

/** JSON Schemas des Planungsvertrags (AP-13c, TK 7.5): `PlanInput` und `NightPlan`. */
export function renderPlanSchemas(): { planInput: string; nightPlan: string } {
  const render = (schema: z.ZodType, title: string) =>
    `${JSON.stringify({ ...z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }), title }, null, 2)}\n`;
  return {
    planInput: render(PlanInputSchema, 'Svenesis NINA-PM – PlanInput (TK 8.2)'),
    nightPlan: render(NightPlanSchema, 'Svenesis NINA-PM – NightPlan (TK 7.6)'),
  };
}

/** JSON-Schemas der NINA-API (AP-14a, TK 7.5): Dateiname → Inhalt in docs/contracts/nina/. */
export function renderNinaSchemas(): Record<string, string> {
  const render = (schema: z.ZodType, title: string) =>
    `${JSON.stringify({ ...z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }), title }, null, 2)}\n`;
  const t = (name: string) => `Svenesis NINA-PM – NINA-API ${name} (TK 7.6)`;
  return {
    'bootstrap.response.schema.json': render(nina.NinaBootstrap, t('GET /bootstrap')),
    'targets.response.schema.json': render(nina.NinaTargets, t('GET /targets')),
    'plan.request.schema.json': render(nina.NinaPlanRequest, t('POST /plan (Anfrage)')),
    'plan.response.schema.json': render(nina.NinaPlanResponse, t('POST /plan (Antwort)')),
    'simulation.response.schema.json': render(nina.NinaSimulation, t('GET /simulation (AP-53)')),
    'session.create.request.schema.json': render(nina.NinaSessionCreate, t('POST /sessions')),
    'session.create.response.schema.json': render(
      nina.NinaSessionCreated,
      t('POST /sessions (Antwort)'),
    ),
    'session.patch.request.schema.json': render(nina.NinaSessionPatch, t('PATCH /sessions/{id}')),
    'session.patch.response.schema.json': render(
      nina.NinaSessionPatched,
      t('PATCH /sessions/{id} (Antwort)'),
    ),
    'captures.request.schema.json': render(
      nina.NinaCaptureBatch,
      t('POST /sessions/{id}/captures'),
    ),
    'captures.response.schema.json': render(
      nina.NinaCaptureResults,
      t('POST /sessions/{id}/captures (Antwort)'),
    ),
    'events.request.schema.json': render(nina.NinaEventBatch, t('POST /sessions/{id}/events')),
    'heartbeat.request.schema.json': render(nina.NinaHeartbeat, t('POST /heartbeat')),
    'heartbeat.response.schema.json': render(
      nina.NinaHeartbeatResponse,
      t('POST /heartbeat (Antwort)'),
    ),
    'telemetry.request.schema.json': render(nina.NinaTelemetryBatch, t('POST /telemetry (AP-67)')),
    'telemetry.response.schema.json': render(
      nina.NinaTelemetryResults,
      t('POST /telemetry (Antwort)'),
    ),
  };
}
