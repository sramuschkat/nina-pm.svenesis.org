/**
 * Ergebnisse der Jobs `multi_sim`/`impact` (AP-32a, TK 7.4) als JSON unter `tenant/<tid>/jobs/<jobId>.json`
 * im Daten-Bucket: der Worker schreibt (`dataBucket.grantReadWrite(worker, 'tenant/*')`), die API liest
 * (`dataBucket.grantRead(api, 'tenant/*')`, iam.md) – ohne CORS und ohne presigned URL im Browser.
 */
import { GetObjectCommand, NoSuchKey, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { DATA_RETENTION_DAYS, retentionTagging, type JobResult } from '@nina-pm/shared';
import { jobResultKey } from '../worker/multi-sim';

export interface JobResultStore {
  get(key: string): Promise<unknown>;
  put(tenantId: string, jobId: string, result: JobResult): Promise<string>;
}

const guard = (key: string) => {
  if (!/^tenant\/[0-9a-f-]{36}\/jobs\/[0-9a-f-]{36}\.json$/.test(key))
    throw new Error('Ungültiger Ergebnisschlüssel');
};

export function s3JobResultStore(s3: S3Client, bucket: string): JobResultStore {
  return {
    async get(key) {
      guard(key);
      try {
        const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const text = await r.Body?.transformToString('utf-8');
        return text ? (JSON.parse(text) as unknown) : null;
      } catch (error) {
        if (error instanceof NoSuchKey) return null;
        throw error;
      }
    },
    async put(tenantId, jobId, result) {
      const key = jobResultKey(tenantId, jobId);
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: JSON.stringify(result),
          ContentType: 'application/json',
          // Aufbewahrung 2 Tage über die Lebenszyklusregel des Buckets (TK 12).
          Tagging: retentionTagging(DATA_RETENTION_DAYS.jobs),
        }),
      );
      return key;
    },
  };
}

/** Lokaler Stack und Tests: Ergebnisse im Speicher. */
export function memoryJobResultStore(): JobResultStore & { readonly items: Map<string, unknown> } {
  const items = new Map<string, unknown>();
  return {
    items,
    get: (key) => Promise.resolve(items.get(key) ?? null),
    put: (tenantId, jobId, result) => {
      const key = jobResultKey(tenantId, jobId);
      items.set(key, JSON.parse(JSON.stringify(result)) as unknown);
      return Promise.resolve(key);
    },
  };
}
