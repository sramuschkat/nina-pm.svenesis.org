import { ERRORS } from '@nina-pm/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { problemBody } from '../src/lib/problem';
import type { AuthContext } from '@nina-pm/shared';
import { ORIGIN_SECRET as SECRET } from './support/stack';

const viaCloudFront = { 'x-origin-verify': SECRET };
const fixed = (auth: AuthContext) => () => Promise.resolve({ auth });

describe('Problem Details (TK 7.1)', () => {
  it('Status und Titel aus errors.json', () => {
    for (const code of [
      'permission.denied',
      'auth.csrf_missing',
      'job.not_found',
      'internal.error',
    ] as const) {
      expect(problemBody(code)).toMatchObject({
        status: ERRORS[code].http,
        title: ERRORS[code].titleDe,
        code,
      });
    }
  });

  it('Validierungsfehler → 422 validation.failed mit errors[]', async () => {
    const app = createApp({
      originVerifyValue: () => Promise.resolve(SECRET),
      buildId: 'b',
      resolveSession: fixed({
        identityId: 'i',
        sessionId: 's',
        ctx: 'tenant',
        tenantId: 't',
        memberId: 'm',
        role: 'user',
        isOwner: false,
        isSuperUser: false,
        mfa: true,
        mfaRequired: false,
        viewAsUser: false,
      }),
    });
    const res = await app.request('/api/web/v1/jobs/keine-uuid', { headers: viaCloudFront });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; errors: { path: string }[] };
    expect(body.code).toBe('validation.failed');
    expect(body.errors[0]?.path).toBe('$.id');
  });

  it('unerwarteter Fehler → 500 internal.error nur mit requestId, ohne Stacktrace, SQL-/AWS-Text oder Schlüssel', async () => {
    const leak = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "ux_job_dedupe_active" – AccessDenied arn:aws:s3:::svenesis-nina-pm-data/tenant/x',
      ),
      { code: '23505' },
    );
    const app = createApp({
      originVerifyValue: () => Promise.resolve(SECRET),
      buildId: 'b',
      resolveSession: fixed({
        identityId: 'i',
        sessionId: 's',
        ctx: 'tenant',
        tenantId: 't',
        memberId: 'm',
        role: 'admin',
        isOwner: false,
        isSuperUser: false,
        mfa: true,
        mfaRequired: false,
        viewAsUser: false,
      }),
      services: () => Promise.reject(leak),
    });
    const res = await app.request('/api/web/v1/jobs/00000000-0000-4000-8000-000000000001', {
      headers: { ...viaCloudFront, 'x-amzn-requestid': 'req-123' },
    });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      type: 'about:blank',
      title: ERRORS['internal.error'].titleDe,
      status: 500,
      code: 'internal.error',
      requestId: 'req-123',
    });
    for (const forbidden of [
      'duplicate key',
      'ux_job',
      'arn:aws',
      'tenant/',
      'at ',
      'AccessDenied',
      SECRET,
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });
});
