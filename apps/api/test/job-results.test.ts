/** Job-Ergebnisse (TK 7.4, TK 12): Schlüssel unter `tenant/<tid>/jobs/`, Aufbewahrungs-Tag 2 Tage. */
import type { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { s3JobResultStore } from '../src/files/job-results';

const T = '00000000-0000-4000-8000-00000000000a';
const J = '00000000-0000-4000-8000-0000000000b1';

describe('s3JobResultStore', () => {
  it('schreibt mit Tag npm-retention=2d', async () => {
    const inputs: Record<string, unknown>[] = [];
    const client = {
      send: (cmd: { input: Record<string, unknown> }) => {
        inputs.push(cmd.input);
        return Promise.resolve({});
      },
    } as unknown as S3Client;
    const key = await s3JobResultStore(client, 'bucket').put(T, J, {
      kind: 'multi_sim',
    } as never);
    expect(key).toBe(`tenant/${T}/jobs/${J}.json`);
    expect(inputs[0]).toMatchObject({
      Bucket: 'bucket',
      Key: key,
      Tagging: 'npm-retention=2d',
      ContentType: 'application/json',
    });
  });
});
