/** Dateien eines Mandanten entfernen (FA-MAN-03): alle Objekte unter `tenant/<id>/` im Daten-Bucket (TK 12). */
import { DeleteObjectsCommand, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';

export interface TenantFileStore {
  /** Löscht alle Objekte des Mandanten; liefert die Anzahl. */
  deleteTenantFiles(tenantId: string): Promise<number>;
}

/** Größe und Anzahl der Dateien eines Mandanten (AP-07d, `daily`). */
export interface TenantUsageReader {
  usage(tenantId: string): Promise<{ bytes: number; count: number }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function s3TenantFileStore(s3: S3Client, bucket: string): TenantFileStore {
  return {
    async deleteTenantFiles(tenantId) {
      if (!UUID.test(tenantId)) throw new Error('Mandanten-ID ist keine UUID');
      const prefix = `tenant/${tenantId}/`;
      let total = 0;
      let token: string | undefined;
      do {
        const page = await s3.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
        );
        const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
        if (keys.length > 0) {
          await s3.send(
            new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }),
          );
          total += keys.length;
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return total;
    },
  };
}

export function s3TenantUsageReader(s3: S3Client, bucket: string): TenantUsageReader {
  return {
    async usage(tenantId) {
      if (!UUID.test(tenantId)) throw new Error('Mandanten-ID ist keine UUID');
      let bytes = 0;
      let count = 0;
      let token: string | undefined;
      do {
        const page = await s3.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: `tenant/${tenantId}/`,
            ContinuationToken: token,
          }),
        );
        for (const o of page.Contents ?? []) {
          bytes += o.Size ?? 0;
          count += 1;
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return { bytes, count };
    },
  };
}
