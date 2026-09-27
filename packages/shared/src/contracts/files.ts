/** Dateien und S3 (TK 12): Upload-Tickets (presigned POST) und Download-Links über Zweck + ID. */
import { z } from 'zod';
import { downloadPurposes, uploadPurposes, type UploadPurpose } from '../generated/enums';
import { Uuid, UtcInstant } from './common';

/** Obergrenzen je Zweck in Byte – erzwingt S3 über `content-length-range` (SEC-23). */
export const UPLOAD_LIMITS: Readonly<
  Record<UploadPurpose, { sizeMax: number; contentTypes: readonly string[] }>
> = {
  transit_result: {
    sizeMax: 20_971_520,
    contentTypes: ['text/plain', 'text/csv', 'application/json', 'image/png'],
  },
  tenant_import: { sizeMax: 52_428_800, contentTypes: ['application/json'] },
  plan_log: { sizeMax: 5_242_880, contentTypes: ['application/gzip'] },
};

/**
 * Aufbewahrung im Daten-Bucket (TK 12, Lebenszyklus): Die Schlüssel beginnen mit der Mandanten-ID
 * (`tenant/<id>/jobs/…`), ein Präfixfilter je Kategorie geht deshalb nicht – jedes befristete Objekt trägt beim
 * Schreiben das Tag `npm-retention=<Tage>d`, und je Wert gibt es eine Lebenszyklusregel. Ohne Tag bleibt ein Objekt
 * (Transit-Ergebnisse). Alte Versionen verfallen nach `DATA_NONCURRENT_DAYS`, abgebrochene Uploads nach
 * `DATA_ABORT_MULTIPART_DAYS`; ein abgelaufenes Objekt ist damit spätestens nach Frist + 30 Tagen ganz weg.
 */
export const RETENTION_TAG = 'npm-retention';
export const DATA_RETENTION_DAYS = { jobs: 2, exports: 7, imports: 7, plans: 400 } as const;
export const DATA_NONCURRENT_DAYS = 30;
export const DATA_ABORT_MULTIPART_DAYS = 1;
/** Frist je Upload-Zweck in Tagen; `null` = unbefristet. */
export const UPLOAD_RETENTION_DAYS: Readonly<Record<UploadPurpose, number | null>> = {
  transit_result: null,
  tenant_import: DATA_RETENTION_DAYS.imports,
  plan_log: DATA_RETENTION_DAYS.plans,
};
/** Alle Fristen, für die der Bucket eine Regel braucht (aufsteigend, ohne Doppelte). */
export const RETENTION_DAY_VALUES: readonly number[] = [
  ...new Set(Object.values(DATA_RETENTION_DAYS)),
].sort((a, b) => a - b);
/** Tag-Wert (`7d`). */
export const retentionValue = (days: number) => `${String(days)}d`;
/** `Tagging` für `PutObject` (URL-Query-Form). */
export const retentionTagging = (days: number) => `${RETENTION_TAG}=${retentionValue(days)}`;
/** `tagging`-Feld des presigned POST (XML, S3). */
export const retentionTaggingXml = (days: number) =>
  `<Tagging><TagSet><Tag><Key>${RETENTION_TAG}</Key><Value>${retentionValue(days)}</Value></Tag></TagSet></Tagging>`;

/** Größter Anfrage-Body der API (TK 15): 1 MiB; größere Daten nur per presigned POST. */
export const REQUEST_BODY_MAX_BYTES = 1_048_576;

/** Gültigkeit der presigned POST (TK 12) und der Ticket-ID für den Folgeaufruf. */
export const UPLOAD_POST_TTL_SECONDS = 300;
export const UPLOAD_TICKET_TTL_SECONDS = 3600;
/** Download-Links (presigned GET) 15 min (TK 12). */
export const DOWNLOAD_URL_TTL_SECONDS = 900;

export const UploadPurposeSchema = z.enum(uploadPurposes);
export const DownloadPurposeSchema = z.enum(downloadPurposes);

export const UploadTicket = z
  .object({
    uploadTicketId: z.string(),
    url: z.url(),
    fields: z.record(z.string(), z.string()),
    expiresAt: UtcInstant,
  })
  .meta({ id: 'UploadTicket' });
export type UploadTicket = z.infer<typeof UploadTicket>;

export const DownloadUrlQuery = z.object({ purpose: DownloadPurposeSchema, id: Uuid });
export const DownloadUrl = z
  .object({ url: z.url(), expiresAt: UtcInstant })
  .meta({ id: 'DownloadUrl' });
