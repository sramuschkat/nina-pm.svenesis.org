/**
 * Problem Details (RFC 9457, rules/api.md). Codes nur aus docs/contracts/errors.json – der Test
 * `problem.test.ts` prüft, dass jeder hier verwendete Code dort mit demselben HTTP-Status steht.
 * Das vollständige Fehlermodell folgt mit AP-05 in packages/shared.
 */
export const PROBLEMS = {
  'permission.denied': { status: 403, title: 'Keine Berechtigung' },
  'resource.not_found': { status: 404, title: 'Nicht gefunden' },
  'internal.error': { status: 500, title: 'Interner Fehler' },
} as const;

export type ProblemCode = keyof typeof PROBLEMS;

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  code: ProblemCode;
  requestId?: string;
}

export function problemBody(code: ProblemCode, requestId?: string): ProblemBody {
  const { status, title } = PROBLEMS[code];
  return { type: 'about:blank', title, status, code, ...(requestId ? { requestId } : {}) };
}

export function problemResponse(code: ProblemCode, requestId?: string): Response {
  const body = problemBody(code, requestId);
  return new Response(JSON.stringify(body), {
    status: body.status,
    headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store' },
  });
}
