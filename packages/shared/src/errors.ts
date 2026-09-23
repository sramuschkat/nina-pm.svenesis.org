/** Fehlercodes (TK 7.1, rules/api.md): Quelle docs/contracts/errors.json, generiert in ./generated. */
import { ERRORS, type ErrorCode } from './generated/errors';

export { ERROR_CODES, ERRORS, type ErrorCode } from './generated/errors';

export interface FieldError {
  /** Stelle des Fehlers, z. B. `input.nights` oder `$.projects[3].name`. */
  readonly path: string;
  readonly message: string;
}

/**
 * Fachlicher Fehler mit Code aus errors.json. Die API rendert ihn als Problem Details, der Worker
 * schreibt ihn als Grund eines `failed`-Jobs. Die Nachricht bleibt intern (Log), nie in der Antwort.
 */
export class ProblemError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    readonly errors?: readonly FieldError[],
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'ProblemError';
    this.status = ERRORS[code].http;
  }
}

export function isProblemError(error: unknown): error is ProblemError {
  return error instanceof ProblemError;
}

export function httpStatusOf(code: ErrorCode): number {
  return ERRORS[code].http;
}
