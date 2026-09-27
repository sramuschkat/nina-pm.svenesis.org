/**
 * Dateien eines Mandanten entfernen (FA-MAN-03): alle Objekte unter `tenant/<id>/` im Daten-Bucket (TK 12) –
 * **jede Version und jeder Löschmarker**. Der Bucket ist versioniert; ein Löschen ohne Versions-ID setzte nur
 * einen Marker, die Daten blieben erhalten.
 */
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  type S3Client,
} from '@aws-sdk/client-s3';

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
      let keyMarker: string | undefined;
      let versionMarker: string | undefined;
      for (;;) {
        const page = await s3.send(
          new ListObjectVersionsCommand({
            Bucket: bucket,
            Prefix: prefix,
            KeyMarker: keyMarker,
            VersionIdMarker: versionMarker,
          }),
        );
        const entries = [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])].flatMap((v) =>
          v.Key && v.VersionId ? [{ Key: v.Key, VersionId: v.VersionId }] : [],
        );
        // DeleteObjects nimmt höchstens 1.000 Einträge; eine Seite liefert zusammen höchstens so viele.
        for (let i = 0; i < entries.length; i += 1000) {
          const res = await s3.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: entries.slice(i, i + 1000), Quiet: true },
            }),
          );
          if (res.Errors && res.Errors.length > 0)
            throw new Error(
              `S3-Löschen unvollständig: ${String(res.Errors.length)} Fehler, z. B. ${res.Errors[0]?.Code ?? '?'}`,
            );
          total += Math.min(1000, entries.length - i);
        }
        if (!page.IsTruncated) return total;
        keyMarker = page.NextKeyMarker;
        versionMarker = page.NextVersionIdMarker;
      }
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
