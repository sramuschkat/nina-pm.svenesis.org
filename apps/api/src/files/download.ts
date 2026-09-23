/** Download-Links (TK 12): presigned GET 15 min auf einen serverseitig ermittelten Schlüssel. */
import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DOWNLOAD_URL_TTL_SECONDS } from '@nina-pm/shared';

export interface DownloadSigner {
  presignGet(key: string): Promise<{ url: string; expiresAt: string }>;
}

export function s3DownloadSigner(s3: S3Client, bucket: string, now: () => Date): DownloadSigner {
  return {
    async presignGet(key) {
      if (!key.startsWith('tenant/')) throw new Error('Download nur unter tenant/');
      const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: DOWNLOAD_URL_TTL_SECONDS,
      });
      const expiresAt = new Date(now().getTime() + DOWNLOAD_URL_TTL_SECONDS * 1000)
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z');
      return { url, expiresAt };
    },
  };
}
