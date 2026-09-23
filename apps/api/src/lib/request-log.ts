import type { MiddlewareHandler } from 'hono';
import type { ApiEnv } from './env';
import { logger } from './logger';
import { redactString } from './redact';

/** Request-ID aus dem Lambda-Kontext (API Gateway), sonst aus den Headern von Gateway/CloudFront. */
export function requestIdMiddleware(): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const event = (c.env as { event?: { requestContext?: { requestId?: string } } } | undefined)
      ?.event;
    c.set(
      'requestId',
      event?.requestContext?.requestId ??
        c.req.header('x-amzn-requestid') ??
        c.req.header('x-amz-cf-id'),
    );
    await next();
  };
}

/**
 * Request-Logging (TK 16.1): Methode, Pfad ohne Query, Status, Dauer, Request-ID und Mandant –
 * keine Header, keine Cookies, keine Query (sie kann Tickets tragen), kein Body.
 */
export function requestLog(now: () => number = Date.now): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const started = now();
    await next();
    const auth = c.get('auth');
    logger.info('request', {
      method: c.req.method,
      path: redactString(c.req.path),
      status: c.res.status,
      durationMs: now() - started,
      requestId: c.get('requestId'),
      tenantId: auth?.tenantId ?? undefined,
      memberId: auth?.memberId ?? undefined,
    });
  };
}
