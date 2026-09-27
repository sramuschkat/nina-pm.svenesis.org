/** Upload-Tickets (TK 12, SEC-23/56/57): presigned POST mit `eq $key` und `content-length-range`. */
import { S3Client } from '@aws-sdk/client-s3';
import { retentionTaggingXml } from '@nina-pm/shared';
import { describe, expect, it } from 'vitest';
import {
  createUploadTicket,
  safeFileName,
  uploadObjectKey,
  verifyUploadTicket,
  type UploadDeps,
} from '../src/files/upload-ticket';
import { evaluatePostPolicy } from './support/s3-post-policy';

const TENANT = '0190c3f4-0000-7000-8000-00000000000a';
const OTHER_TENANT = '0190c3f4-0000-7000-8000-00000000000b';
const PLAN_A = '0190c3f4-0000-7000-8000-0000000000f1';
const PLAN_B = '0190c3f4-0000-7000-8000-0000000000f2';
const NOW = new Date('2026-09-23T12:00:00Z');
const BUCKET = 'svenesis-nina-pm-data';

let n = 0;
const deps: UploadDeps = {
  // Statische Test-Zugangsdaten: presigned POST signiert lokal, ohne AWS-Aufruf.
  s3: new S3Client({
    region: 'eu-central-1',
    credentials: { accessKeyId: 'AKIDTEST', secretAccessKey: 'test' },
  }),
  bucket: BUCKET,
  secret: () => Promise.resolve('test-cookie-secret-0123456789abcdef'),
  now: () => NOW,
  uuid: () => `0190c3f4-0000-7000-8000-${String(++n).padStart(12, '0')}`,
};

const policyOf = (fields: Record<string, string>) => fields.Policy ?? fields.policy ?? '';

describe('createUploadTicket', () => {
  it('Politik enthält content-length-range, eq $key und eq $Content-Type – nie starts-with', async () => {
    const t = await createUploadTicket(deps, 'plan_log', TENANT, PLAN_A, 5_242_880, [
      'application/gzip',
    ]);
    expect(t.key).toBe(`tenant/${TENANT}/plans/${PLAN_A}.json.gz`);
    expect(t.url).toContain(BUCKET);
    const policy = JSON.parse(Buffer.from(policyOf(t.fields), 'base64').toString('utf8')) as {
      conditions: unknown[];
    };
    expect(policy.conditions).toContainEqual(['content-length-range', 1, 5_242_880]);
    expect(policy.conditions).toContainEqual(['eq', '$key', t.key]);
    expect(policy.conditions).toContainEqual(['eq', '$Content-Type', 'application/gzip']);
    expect(JSON.stringify(policy.conditions)).not.toContain('starts-with');
    expect(
      Date.parse(t.expiresAt) -
        Date.parse((policy as unknown as { expiration: string }).expiration),
    ).toBe(0);
  });

  it('Aufbewahrung (TK 12): befristete Zwecke tragen das Tag, der Client kann es nicht weglassen', async () => {
    const plan = await createUploadTicket(deps, 'plan_log', TENANT, PLAN_A, 1000, [
      'application/gzip',
    ]);
    const xml = retentionTaggingXml(400);
    expect(plan.fields.tagging).toBe(xml);
    const conditions = (
      JSON.parse(Buffer.from(policyOf(plan.fields), 'base64').toString('utf8')) as {
        conditions: unknown[];
      }
    ).conditions;
    expect(conditions).toContainEqual(['eq', '$tagging', xml]);
    const base = { bucket: BUCKET, size: 10, now: NOW };
    expect(evaluatePostPolicy(policyOf(plan.fields), { ...base, form: plan.fields }).ok).toBe(true);
    const withoutTag = Object.fromEntries(
      Object.entries(plan.fields).filter(([k]) => k !== 'tagging'),
    );
    expect(evaluatePostPolicy(policyOf(plan.fields), { ...base, form: withoutTag }).ok).toBe(false);
    expect(
      evaluatePostPolicy(policyOf(plan.fields), {
        ...base,
        form: { ...plan.fields, tagging: retentionTaggingXml(9999) },
      }).ok,
    ).toBe(false);
    const imp = await createUploadTicket(deps, 'tenant_import', TENANT, PLAN_B, 1000, [
      'application/json',
    ]);
    expect(imp.fields.tagging).toBe(retentionTaggingXml(7));
    // Transit-Ergebnisse bleiben unbefristet: kein Tag.
    const res = await createUploadTicket(deps, 'transit_result', TENANT, PLAN_B, 1000, [
      'text/csv',
    ]);
    expect(res.fields.tagging).toBeUndefined();
  });

  it('SEC-56: Ticket für Schlüssel A lässt sich nicht für Schlüssel B im selben Präfix benutzen', async () => {
    const t = await createUploadTicket(deps, 'plan_log', TENANT, PLAN_A, 5_242_880, [
      'application/gzip',
    ]);
    const upload = (key: string) =>
      evaluatePostPolicy(policyOf(t.fields), {
        bucket: BUCKET,
        form: { ...t.fields, key },
        size: 1000,
        now: NOW,
      });
    expect(upload(t.key)).toEqual({ ok: true });
    expect(upload(`tenant/${TENANT}/plans/${PLAN_B}.json.gz`)).toMatchObject({
      ok: false,
      reason: 'eq key',
    });
    expect(upload(`tenant/${TENANT}/plans/${PLAN_A}.json.gz.x`)).toMatchObject({ ok: false });
  });

  it('Upload über der Grenze wird von S3 abgelehnt (content-length-range)', async () => {
    const t = await createUploadTicket(deps, 'tenant_import', TENANT, PLAN_A, 1024, [
      'application/json',
    ]);
    const upload = (size: number) =>
      evaluatePostPolicy(policyOf(t.fields), { bucket: BUCKET, form: t.fields, size, now: NOW });
    expect(upload(1024)).toEqual({ ok: true });
    expect(upload(1025)).toEqual({ ok: false, reason: 'content-length-range' });
    expect(upload(0)).toEqual({ ok: false, reason: 'content-length-range' });
  });

  it('anderer Content-Type, fremdes Feld oder Ablauf → abgelehnt', async () => {
    const t = await createUploadTicket(
      deps,
      'transit_result',
      TENANT,
      PLAN_A,
      1000,
      ['text/csv', 'image/png'],
      {
        contentType: 'text/csv',
        fileName: 'wasp-12 b.csv',
      },
    );
    const base = { bucket: BUCKET, size: 10, now: NOW };
    expect(
      evaluatePostPolicy(policyOf(t.fields), {
        ...base,
        form: { ...t.fields, 'Content-Type': 'text/html' },
      }).ok,
    ).toBe(false);
    expect(
      evaluatePostPolicy(policyOf(t.fields), { ...base, form: { ...t.fields, acl: 'public-read' } })
        .ok,
    ).toBe(false);
    expect(
      evaluatePostPolicy(policyOf(t.fields), {
        ...base,
        form: t.fields,
        now: new Date(Date.parse(t.expiresAt) + 1000),
      }),
    ).toEqual({ ok: false, reason: 'expired' });
    expect(t.key).toMatch(
      new RegExp(`^tenant/${TENANT}/results/${PLAN_A}/[0-9a-f-]{36}-wasp-12_b\\.csv$`),
    );
  });

  it('Grenzen je Zweck: sizeMax und Content-Types nicht über TK 12 hinaus', async () => {
    await expect(
      createUploadTicket(deps, 'plan_log', TENANT, PLAN_A, 5_242_881, ['application/gzip']),
    ).rejects.toThrow();
    await expect(
      createUploadTicket(deps, 'plan_log', TENANT, PLAN_A, 100, ['text/html']),
    ).rejects.toThrow();
    await expect(
      createUploadTicket(deps, 'plan_log', TENANT, PLAN_A, 100, ['application/gzip'], {
        contentType: 'text/plain',
      }),
    ).rejects.toMatchObject({ code: 'file.type_not_allowed' });
  });

  it('Schlüssel nur serverseitig: IDs müssen UUIDs sein, Dateinamen werden bereinigt', () => {
    expect(() => uploadObjectKey('plan_log', TENANT, '../../x', PLAN_B)).toThrow();
    expect(safeFileName('../../etc/passwd')).toBe('etc_passwd');
    expect(safeFileName('')).toBe('upload');
  });
});

describe('verifyUploadTicket (SEC-57)', () => {
  it('liefert den Schlüssel nur für Zweck, Mandant und Objekt des Tickets', async () => {
    const t = await createUploadTicket(deps, 'tenant_import', TENANT, PLAN_A, 1024, [
      'application/json',
    ]);
    await expect(
      verifyUploadTicket(deps, t.uploadTicketId, { purpose: 'tenant_import', tenantId: TENANT }),
    ).resolves.toEqual({
      key: t.key,
      objectId: PLAN_A,
    });
    for (const expected of [
      { purpose: 'tenant_import' as const, tenantId: OTHER_TENANT },
      { purpose: 'plan_log' as const, tenantId: TENANT },
      { purpose: 'tenant_import' as const, tenantId: TENANT, objectId: PLAN_B },
    ]) {
      await expect(verifyUploadTicket(deps, t.uploadTicketId, expected)).rejects.toMatchObject({
        code: 'validation.failed',
      });
    }
  });

  it('verfälschte, fremd signierte oder abgelaufene Tickets → validation.failed', async () => {
    const t = await createUploadTicket(deps, 'tenant_import', TENANT, PLAN_A, 1024, [
      'application/json',
    ]);
    const [body, mac] = t.uploadTicketId.split('.');
    const forged = JSON.parse(Buffer.from(body ?? '', 'base64url').toString()) as Record<
      string,
      unknown
    >;
    forged.t = OTHER_TENANT;
    const forgedId = `${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${mac}`;
    const expect422 = (p: Promise<unknown>) =>
      expect(p).rejects.toMatchObject({ code: 'validation.failed' });
    await expect422(
      verifyUploadTicket(deps, forgedId, { purpose: 'tenant_import', tenantId: OTHER_TENANT }),
    );
    await expect422(
      verifyUploadTicket(
        { ...deps, secret: () => Promise.resolve('anderes-geheimnis') },
        t.uploadTicketId,
        {
          purpose: 'tenant_import',
          tenantId: TENANT,
        },
      ),
    );
    await expect422(
      verifyUploadTicket(
        { ...deps, now: () => new Date(NOW.getTime() + 3601_000) },
        t.uploadTicketId,
        {
          purpose: 'tenant_import',
          tenantId: TENANT,
        },
      ),
    );
    await expect422(
      verifyUploadTicket(deps, 'kaputt', { purpose: 'tenant_import', tenantId: TENANT }),
    );
  });
});
