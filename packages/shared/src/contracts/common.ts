/** zod-Basisschemas (TK 7.1, 7.5): Vertragsquelle der API; OpenAPI wird daraus generiert. */
import { z } from 'zod';
import { ERROR_CODES } from '../generated/errors';

export const Uuid = z.uuid().meta({ description: 'UUID' });

/** Zeitpunkt ISO-8601 UTC mit `Z` (rules/api.md). */
export const UtcInstant = z.iso
  .datetime({ offset: false })
  .meta({ example: '2026-09-18T13:00:00Z' });

/** Nacht-Schlüssel `YYYY-MM-DD` (specs/engine/night.md §1). */
export const NightKey = z.iso.date().meta({ example: '2026-09-18' });

/** Cursor-Paginierung (TK 7.1): `limit` ≤ 200, Standard 50. */
export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(512).optional(),
});

export const FieldErrorSchema = z.object({ path: z.string(), message: z.string() });

/** Problem Details (RFC 9457) mit `code` aus errors.json. */
export const ProblemDetails = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    code: z.enum(ERROR_CODES as [string, ...string[]]),
    requestId: z.string().optional(),
    errors: z.array(FieldErrorSchema).optional(),
  })
  .meta({ id: 'ProblemDetails' });
