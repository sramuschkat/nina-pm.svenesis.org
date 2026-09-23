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
