/**
 * Redaktion für Logs (TK 16.1, AP-05): keine Tokens, Cookies, Geheimnisse oder Webhook-URLs.
 * Schlüssel mit sensiblem Namen werden ersetzt, Discord-Webhook-URLs und Bearer-Tokens auch in
 * freien Zeichenketten.
 */
const SENSITIVE_KEY =
  /(authorization|cookie|token|secret|password|passwd|webhook|signature|credential|session|x-origin-verify|x-amz-security|policy|uploadticketid)/i;
const WEBHOOK_URL = /https:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/api\/webhooks\/[^\s"']+/gi;
const BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/g;
const NPM_TOKEN = /\bnpm_[A-Za-z0-9_-]{8,}/g;
const PRESIGNED = /([?&](?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token)=)[^&\s"']+/gi;

export const REDACTED = '[redacted]';

export function redactString(value: string): string {
  return value
    .replace(WEBHOOK_URL, REDACTED)
    .replace(BEARER, `$1${REDACTED}`)
    .replace(NPM_TOKEN, REDACTED)
    .replace(PRESIGNED, `$1${REDACTED}`);
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTED;
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}
