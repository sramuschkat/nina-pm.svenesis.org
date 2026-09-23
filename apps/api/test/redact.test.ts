import { describe, expect, it } from 'vitest';
import { redact, REDACTED, redactString } from '../src/lib/redact';

describe('Log-Redaktion (keine Tokens, Cookies, Webhook-URLs)', () => {
  it('ersetzt sensible Schlüssel', () => {
    expect(
      redact({
        headers: {
          Authorization: 'Bearer npm_abc',
          Cookie: '__Host-npm_sid=x',
          'x-origin-verify': 'v',
        },
        uploadTicketId: 'a.b',
        webhookUrl: 'https://discord.com/api/webhooks/1/abc',
        path: '/api/web/v1/jobs/1',
      }),
    ).toEqual({
      headers: { Authorization: REDACTED, Cookie: REDACTED, 'x-origin-verify': REDACTED },
      uploadTicketId: REDACTED,
      webhookUrl: REDACTED,
      path: '/api/web/v1/jobs/1',
    });
  });

  it('ersetzt Webhook-URLs, Bearer-/NINA-Tokens und presigned-Signaturen in freiem Text', () => {
    const text = redactString(
      'post https://discordapp.com/api/webhooks/123/SeCrEt failed; Bearer abc.def; token npm_0123456789abcdef; https://b.s3.amazonaws.com/k?X-Amz-Signature=deadbeef&x=1',
    );
    for (const secret of ['SeCrEt', 'abc.def', 'npm_0123456789abcdef', 'deadbeef'])
      expect(text).not.toContain(secret);
  });

  it('Fehlerobjekte: nur Name und bereinigte Nachricht', () => {
    expect(redact(new Error('Bearer xyz kaputt'))).toEqual({
      name: 'Error',
      message: `Bearer ${REDACTED} kaputt`,
    });
  });
});
