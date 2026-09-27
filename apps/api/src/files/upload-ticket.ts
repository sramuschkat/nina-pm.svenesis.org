/**
 * Upload-Tickets (TK 12, SEC-23/56/57, SV-09). Der Schlüssel entsteht **serverseitig**; die presigned
 * POST signiert `["eq", "$key", <schlüssel>]` bei allen Zwecken (nie `starts-with`) und
 * `content-length-range`. Nie presigned PUT. Der Aufrufer erhält eine `uploadTicketId` (HMAC-signiert,
 * Schlüssel abgeleitet aus /nina-pm/oauth/cookie-secret) und nennt im Folgeaufruf nur diese ID.
 */
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import {
  ProblemError,
  UPLOAD_LIMITS,
  UPLOAD_RETENTION_DAYS,
  retentionTaggingXml,
  UPLOAD_POST_TTL_SECONDS,
  UPLOAD_TICKET_TTL_SECONDS,
  type UploadPurpose,
  type UploadTicket,
} from '@nina-pm/shared';

export interface UploadDeps {
  readonly s3: S3Client;
  readonly bucket: string;
  /** Geheimnis für die Ticket-Signatur (SSM-Cache); nie geloggt. */
  readonly secret: () => Promise<string>;
  readonly now: () => Date;
  readonly uuid: () => string;
}

export interface UploadTicketOptions {
  /** Gewählter Content-Type; muss in `contentTypes` stehen (Standard: der erste). */
  readonly contentType?: string;
  /** Dateiname für Transit-Ergebnisse; wird bereinigt. */
  readonly fileName?: string;
}

interface TicketPayload {
  v: 1;
  p: UploadPurpose;
  t: string;
  o: string;
  k: string;
  exp: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function safeFileName(name: string | undefined): string {
  const cleaned = (name ?? '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 100);
  return cleaned || 'upload';
}

/** Objektschlüssel je Zweck (TK 12) – ausschließlich serverseitig gebildet. */
export function uploadObjectKey(
  purpose: UploadPurpose,
  tenantId: string,
  objectId: string,
  uuid: string,
  fileName?: string,
): string {
  if (!UUID.test(tenantId) || !UUID.test(objectId) || !UUID.test(uuid)) {
    throw new ProblemError('validation.failed', [{ path: 'objectId', message: 'UUID erwartet' }]);
  }
  switch (purpose) {
    case 'transit_result':
      return `tenant/${tenantId}/results/${objectId}/${uuid}-${safeFileName(fileName)}`;
    case 'tenant_import':
      return `tenant/${tenantId}/imports/${objectId}.json`;
    case 'plan_log':
      return `tenant/${tenantId}/plans/${objectId}.json.gz`;
  }
}

async function signingKey(secret: () => Promise<string>): Promise<Buffer> {
  return Buffer.from(hkdfSync('sha256', await secret(), 'nina-pm', 'upload-ticket/v1', 32));
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');
const isoSeconds = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Ablauf der signierten Politik (S3 prüft ihn) – maßgeblich für `expiresAt`. */
function policyExpiration(fields: Record<string, string>): string | undefined {
  const policy = fields.Policy;
  if (!policy) return undefined;
  const { expiration } = JSON.parse(Buffer.from(policy, 'base64').toString('utf8')) as {
    expiration?: string;
  };
  return expiration ? isoSeconds(new Date(expiration)) : undefined;
}

export async function createUploadTicket(
  deps: UploadDeps,
  purpose: UploadPurpose,
  tenantId: string,
  objectId: string,
  sizeMax: number,
  contentTypes: readonly string[],
  options: UploadTicketOptions = {},
): Promise<UploadTicket & { key: string }> {
  const limit = UPLOAD_LIMITS[purpose];
  if (!Number.isInteger(sizeMax) || sizeMax < 1 || sizeMax > limit.sizeMax) {
    throw new Error(`sizeMax ${sizeMax} außerhalb 1 … ${limit.sizeMax} für ${purpose}`);
  }
  if (contentTypes.length === 0 || contentTypes.some((t) => !limit.contentTypes.includes(t))) {
    throw new Error(`Content-Types ${contentTypes.join(', ')} nicht erlaubt für ${purpose}`);
  }
  const contentType = options.contentType ?? contentTypes[0];
  if (!contentType || !contentTypes.includes(contentType)) {
    throw new ProblemError('file.type_not_allowed', [
      { path: 'contentType', message: 'nicht erlaubt' },
    ]);
  }
  const key = uploadObjectKey(purpose, tenantId, objectId, deps.uuid(), options.fileName);
  const now = deps.now();
  // Befristete Zwecke tragen das Aufbewahrungs-Tag; `eq $tagging` verhindert, dass der Client es weglässt.
  const retention = UPLOAD_RETENTION_DAYS[purpose];
  const tagging = retention === null ? null : retentionTaggingXml(retention);
  const post = await createPresignedPost(deps.s3, {
    Bucket: deps.bucket,
    Key: key,
    Conditions: [
      ['content-length-range', 1, sizeMax],
      ['eq', '$Content-Type', contentType],
      ['eq', '$key', key],
      ...(tagging === null ? [] : [['eq', '$tagging', tagging] as ['eq', string, string]]),
    ],
    Fields: { 'Content-Type': contentType, ...(tagging === null ? {} : { tagging }) },
    Expires: UPLOAD_POST_TTL_SECONDS,
  });
  const payload: TicketPayload = {
    v: 1,
    p: purpose,
    t: tenantId,
    o: objectId,
    k: key,
    exp: Math.floor(now.getTime() / 1000) + UPLOAD_TICKET_TTL_SECONDS,
  };
  const body = b64(JSON.stringify(payload));
  const mac = createHmac('sha256', await signingKey(deps.secret))
    .update(body)
    .digest();
  return {
    uploadTicketId: `${body}.${b64(mac)}`,
    url: post.url,
    fields: post.fields,
    expiresAt:
      policyExpiration(post.fields) ??
      isoSeconds(new Date(now.getTime() + UPLOAD_POST_TTL_SECONDS * 1000)),
    key,
  };
}

export interface VerifiedTicket {
  readonly key: string;
  readonly objectId: string;
}

/**
 * Prüft eine `uploadTicketId` (SEC-57): Signatur, Ablauf, Zweck, Mandant und ggf. Objekt. Jede
 * Abweichung – auch ein fremder Mandant – endet gleich mit `422 validation.failed`.
 */
export async function verifyUploadTicket(
  deps: Pick<UploadDeps, 'secret' | 'now'>,
  uploadTicketId: string,
  expected: { purpose: UploadPurpose; tenantId: string; objectId?: string },
): Promise<VerifiedTicket> {
  const invalid = () =>
    new ProblemError('validation.failed', [
      { path: 'uploadTicketId', message: 'ungültig oder abgelaufen' },
    ]);
  const [body, mac, ...rest] = uploadTicketId.split('.');
  if (!body || !mac || rest.length > 0 || uploadTicketId.length > 2048) throw invalid();
  const expectedMac = createHmac('sha256', await signingKey(deps.secret))
    .update(body)
    .digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expectedMac.length || !timingSafeEqual(given, expectedMac)) throw invalid();
  let payload: TicketPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TicketPayload;
  } catch {
    throw invalid();
  }
  const nowSec = Math.floor(deps.now().getTime() / 1000);
  if (
    payload.v !== 1 ||
    payload.exp <= nowSec ||
    payload.p !== expected.purpose ||
    payload.t !== expected.tenantId ||
    (expected.objectId !== undefined && payload.o !== expected.objectId) ||
    !payload.k.startsWith(`tenant/${expected.tenantId}/`)
  ) {
    throw invalid();
  }
  return { key: payload.k, objectId: payload.o };
}
