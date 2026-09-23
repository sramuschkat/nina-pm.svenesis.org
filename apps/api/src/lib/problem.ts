/**
 * Problem Details (RFC 9457, TK 7.1, rules/api.md). Codes ausschließlich aus
 * docs/contracts/errors.json (generiert in @nina-pm/shared); Titel deutsch aus `titleDe` – die
 * Oberfläche übersetzt über `code` bzw. den i18n-Schlüssel.
 */
import { ERRORS, type ErrorCode, type FieldError } from '@nina-pm/shared';

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  requestId?: string;
  errors?: FieldError[];
}

export interface ProblemOptions {
  readonly requestId?: string | undefined;
  readonly errors?: readonly FieldError[] | undefined;
}

export function problemBody(code: ErrorCode, options: ProblemOptions = {}): ProblemBody {
  const { http, titleDe } = ERRORS[code];
  return {
    type: 'about:blank',
    title: titleDe,
    status: http,
    code,
    ...(options.requestId ? { requestId: options.requestId } : {}),
    ...(options.errors?.length ? { errors: [...options.errors] } : {}),
  };
}

export function problemResponse(code: ErrorCode, options: ProblemOptions = {}): Response {
  const body = problemBody(code, options);
  return new Response(JSON.stringify(body), {
    status: body.status,
    headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store' },
  });
}
