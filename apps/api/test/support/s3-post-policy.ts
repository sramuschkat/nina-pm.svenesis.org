/**
 * Nachbildung der S3-Prüfung einer presigned POST (Mock statt MinIO, AP-05): wertet die signierte
 * Politik (`Policy`, base64) gegen ein Formular und eine Dateigröße aus – so wie S3 es tut:
 * Ablauf, jede Bedingung, und jedes Formularfeld muss durch eine Bedingung gedeckt sein.
 */
type Condition = Record<string, string> | [string, string | number, string | number];

export interface PolicyUpload {
  readonly bucket: string;
  /** Formularfelder, wie der Browser sie sendet (Felder aus dem Ticket plus ggf. geänderte). */
  readonly form: Record<string, string>;
  readonly size: number;
  readonly now: Date;
}

const EXEMPT = new Set(['policy', 'x-amz-signature', 'file']);

export function evaluatePostPolicy(
  policyBase64: string,
  upload: PolicyUpload,
): { ok: boolean; reason?: string } {
  const policy = JSON.parse(Buffer.from(policyBase64, 'base64').toString('utf8')) as {
    expiration: string;
    conditions: Condition[];
  };
  if (Date.parse(policy.expiration) <= upload.now.getTime())
    return { ok: false, reason: 'expired' };
  const form = Object.fromEntries(
    Object.entries(upload.form).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const covered = new Set<string>();
  const value = (field: string) => (field === 'bucket' ? upload.bucket : form[field]);

  for (const c of policy.conditions) {
    if (Array.isArray(c)) {
      const [op, a, b] = c;
      if (op === 'content-length-range') {
        if (upload.size < Number(a) || upload.size > Number(b))
          return { ok: false, reason: 'content-length-range' };
        continue;
      }
      const field = String(a).replace(/^\$/, '').toLowerCase();
      covered.add(field);
      if (op === 'eq' && value(field) !== String(b)) return { ok: false, reason: `eq ${field}` };
      if (op === 'starts-with' && !(value(field) ?? '').startsWith(String(b))) {
        return { ok: false, reason: `starts-with ${field}` };
      }
    } else {
      for (const [k, v] of Object.entries(c)) {
        const field = k.toLowerCase();
        covered.add(field);
        if (value(field) !== v) return { ok: false, reason: `match ${field}` };
      }
    }
  }
  for (const field of Object.keys(form)) {
    if (!EXEMPT.has(field) && !field.startsWith('x-ignore-') && !covered.has(field)) {
      return { ok: false, reason: `extra field ${field}` };
    }
  }
  return { ok: true };
}
