/**
 * Hochgeladene JSON-Dateien (TK 7.1, SV-09): `JSON.parse` in try/catch, danach zod mit
 * `.max()`-Grenzen je Liste und Zeichenkette. Die Dateigröße erzwingt S3 (`content-length-range`);
 * der Job löscht nichts, aufgeräumt wird über den S3-Lebenszyklus.
 */
import { z } from 'zod';
import { ProblemError, type FieldError } from '../errors';

export const UPLOAD_JSON_LIMITS = { maxEntities: 50_000, maxStringLength: 65_536 } as const;

/** Zeichenkette mit Obergrenze (Standard 64 KiB). */
export const boundedString = (max: number = UPLOAD_JSON_LIMITS.maxStringLength) =>
  z.string().max(max);

/** Liste mit Obergrenze (Standard 50.000 Einträge je Entitätsart). */
export const boundedList = <T extends z.ZodType>(
  item: T,
  max: number = UPLOAD_JSON_LIMITS.maxEntities,
) => z.array(item).max(max);

const MAX_REPORTED_ERRORS = 20;

export function toFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.slice(0, MAX_REPORTED_ERRORS).map((issue) => ({
    path: [
      '$',
      ...issue.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)),
    ].join(''),
    message: issue.message,
  }));
}

/** Parst hochgeladenes JSON; Fehler → `ProblemError('validation.failed')` mit Verweis auf die Stelle. */
export function parseUploadedJson<T extends z.ZodType>(text: string, schema: T): z.infer<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ungültiges JSON';
    throw new ProblemError('validation.failed', [{ path: '$', message: `JSON: ${message}` }]);
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw new ProblemError('validation.failed', toFieldErrors(result.error));
  return result.data;
}
