import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { logger } from './logger';
import { problemResponse } from './problem';

export const ORIGIN_VERIFY_HEADER = 'x-origin-verify';

/** Vergleich in konstanter Zeit, damit die Laufzeit nichts über den Wert verrät. */
export function sameSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Zugriff nur über CloudFront (SV-16, iam.md §9): CloudFront sendet den **einen** Wert aus
 * /nina-pm/origin-verify als Header; ohne passenden Header 403, bevor Fachlogik läuft.
 * `expected` liest den Wert über den SSM-Cache (TTL 5 min, TK 4.2).
 */
export function originVerify(expected: () => Promise<string>): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header(ORIGIN_VERIFY_HEADER);
    if (!header || !sameSecret(header, await expected())) {
      logger.warn('origin_verify_failed', { path: c.req.path, headerPresent: Boolean(header) });
      return problemResponse('permission.denied');
    }
    await next();
    return undefined;
  };
}
