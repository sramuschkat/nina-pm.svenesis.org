/**
 * `pnpm security:check` (Sicherheitsanalyse 05.10.2026): Auswertung der AWS-Antworten ohne Konto – je Prüfung ein
 * sicherer und ein unsicherer Fall. Kein Prüfer darf geheime Werte ins Ergebnis schreiben.
 */
import { describe, expect, it } from 'vitest';
import {
  checkAccessAnalyzer,
  checkApiInventory,
  checkBucketInventory,
  checkLegacyAccess,
  checkSchedules,
  checkSsmInventory,
  checkBucket,
  checkDistribution,
  checkHttpApi,
  checkIamUsers,
  checkLambda,
  checkRole,
  checkRoot,
  parseCredentialReport,
  reportMarkdown,
  secretLiterals,
} from '../src/security/checks';

const PAB = {
  BlockPublicAcls: true,
  IgnorePublicAcls: true,
  BlockPublicPolicy: true,
  RestrictPublicBuckets: true,
};
const SSL_ONLY = JSON.stringify({
  Statement: [
    {
      Effect: 'Deny',
      Principal: { AWS: '*' },
      Action: 's3:*',
      Condition: { Bool: { 'aws:SecureTransport': 'false' } },
    },
  ],
});

describe('security:check', () => {
  it('Root: MFA an, keine Schlüssel → grün; sonst hoch', () => {
    expect(
      checkRoot({ SummaryMap: { AccountMFAEnabled: 1, AccountAccessKeysPresent: 0 } }).every(
        (r) => r.ok,
      ),
    ).toBe(true);
    const bad = checkRoot({ SummaryMap: { AccountMFAEnabled: 0, AccountAccessKeysPresent: 1 } });
    expect(bad.map((r) => [r.ok, r.severity])).toEqual([
      [false, 'hoch'],
      [false, 'hoch'],
    ]);
  });

  it('IAM-Benutzer: Konsole ohne MFA und alte Schlüssel werden gemeldet', () => {
    const csv = [
      'user,password_enabled,mfa_active,access_key_1_active,access_key_1_last_rotated,access_key_2_active,access_key_2_last_rotated',
      '<root_account>,not_supported,true,false,N/A,false,N/A',
      'sven,true,false,true,2026-01-01T00:00:00+00:00,false,N/A',
      'ci,false,false,true,2026-09-30T00:00:00+00:00,false,N/A',
    ].join('\n');
    const r = checkIamUsers(parseCredentialReport(csv), Date.parse('2026-10-05T00:00:00Z'));
    expect(r[0]?.detail).toContain('sven');
    expect(r[1]?.detail).toContain('sven (Schlüssel 1');
    expect(r[1]?.detail).not.toContain('ci');
  });

  it('Bucket: privat und nur HTTPS → grün; öffentliche Richtlinie und ACL → hoch', () => {
    const ok = checkBucket({
      name: 'b',
      publicAccessBlock: PAB,
      policyIsPublic: false,
      policy: SSL_ONLY,
      aclGrants: [{ Grantee: {} }],
      encrypted: true,
      ownership: 'BucketOwnerEnforced',
    });
    expect(ok.every((r) => r.ok)).toBe(true);
    const bad = checkBucket({
      name: 'b',
      publicAccessBlock: { ...PAB, BlockPublicPolicy: false },
      policyIsPublic: true,
      policy: JSON.stringify({
        Statement: [
          { Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: 'arn:aws:s3:::b/*' },
        ],
      }),
      aclGrants: [{ Grantee: { URI: 'http://acs.amazonaws.com/groups/global/AllUsers' } }],
      encrypted: false,
    });
    expect(bad.filter((r) => !r.ok && r.severity === 'hoch').map((r) => r.name)).toEqual([
      'Public Access Block (alle vier)',
      'Richtlinie nicht öffentlich',
      'ACL ohne AllUsers/AuthenticatedUsers',
    ]);
  });

  it('Lambda: Function URL ohne Anmeldung, fremder Aufrufer ohne Quelle, AUTH_TEST_MODE → hoch', () => {
    const policy = JSON.stringify({
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Service: 'apigateway.amazonaws.com' },
          Action: 'lambda:InvokeFunction',
          Condition: { ArnLike: { 'AWS:SourceArn': 'arn:x' } },
        },
        {
          Effect: 'Allow',
          Principal: { Service: 'events.amazonaws.com' },
          Action: 'lambda:InvokeFunction',
        },
      ],
    });
    const r = checkLambda({
      name: 'nina-pm-api',
      hasFunctionUrl: true,
      functionUrlAuth: 'NONE',
      resourcePolicy: policy,
      envNames: ['AUTH_TEST_MODE', 'ORIGIN_VERIFY_PARAM'],
      envSecretLiterals: [],
    });
    expect(r.filter((x) => !x.ok).map((x) => x.name)).toEqual([
      'Keine Function URL',
      'Aufruf nur durch eigene Dienste mit Quelle',
      'Kein AUTH_TEST_MODE',
    ]);
  });

  it('Geheimnisse als Umgebungsvariable: nur Namen, SSM-Pfade und *_PARAM sind erlaubt', () => {
    expect(
      secretLiterals({
        DISCORD_CLIENT_SECRET: 'abc',
        SESSION_SECRET_PARAM: '/nina-pm/session',
        WEBHOOK_URL: 'https://x',
        LOG_LEVEL: 'info',
      }).sort(),
    ).toEqual(['DISCORD_CLIENT_SECRET', 'WEBHOOK_URL']);
  });

  it('Rolle: verwaltete Richtlinie und s3:* auf * → mittel; logs:CreateLogGroup auf * ist erlaubt', () => {
    const r = checkRole({
      role: 'api',
      attached: [
        'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
        'arn:aws:iam::aws:policy/AmazonS3FullAccess',
      ],
      inline: [
        {
          name: 'p',
          document: {
            Statement: [
              { Effect: 'Allow', Action: 's3:*', Resource: '*' },
              { Effect: 'Allow', Action: ['logs:CreateLogGroup'], Resource: '*' },
            ],
          },
        },
      ],
    });
    expect(r.map((x) => x.ok)).toEqual([false, false]);
    expect(r[0]?.detail).toContain('AmazonS3FullAccess');
    expect(r[1]?.detail).toContain('s3:*');
    expect(r[1]?.detail).not.toContain('logs:CreateLogGroup');
  });

  it('API Gateway: Direktaufruf 403 und CORS ohne * → grün', () => {
    expect(
      checkHttpApi(
        { CorsConfiguration: { AllowOrigins: ['https://nina-pm.svenesis.org'] } },
        403,
      ).every((r) => r.ok),
    ).toBe(true);
    expect(
      checkHttpApi({ CorsConfiguration: { AllowOrigins: ['*'] } }, 200).map((r) => r.ok),
    ).toEqual([false, false]);
  });

  it('CloudFront: allow-all, TLS 1.0 und S3 ohne OAC → offen', () => {
    const r = checkDistribution({
      ViewerCertificate: { MinimumProtocolVersion: 'TLSv1' },
      DefaultCacheBehavior: { ViewerProtocolPolicy: 'allow-all' },
      Origins: { Items: [{ Id: 'web', DomainName: 'b.s3.eu-central-1.amazonaws.com' }] },
    });
    expect(r.filter((x) => !x.ok).map((x) => x.name)).toEqual([
      'Nur HTTPS (alle Behaviors)',
      'TLS ≥ 1.2',
      'Sicherheits-Header-Richtlinie an allen Behaviors',
      'S3-Ursprünge nur über OAC',
    ]);
  });

  it('Access Analyzer: öffentliche Freigabe → hoch', () => {
    const r = checkAccessAnalyzer(
      { analyzers: [{ arn: 'a', status: 'ACTIVE' }] },
      {
        findings: [
          {
            resource: 'arn:aws:s3:::b',
            resourceType: 'AWS::S3::Bucket',
            isPublic: true,
            status: 'ACTIVE',
          },
        ],
      },
    );
    expect(r[1]).toMatchObject({ ok: false, severity: 'hoch' });
  });

  it('Bericht nennt Offenes nach Schwere zuerst', () => {
    const md = reportMarkdown(
      [...checkRoot({ SummaryMap: { AccountMFAEnabled: 0, AccountAccessKeysPresent: 0 } })],
      { at: '2026-10-05T00:00:00Z', commit: 'abc' },
    );
    expect(md).toContain('1 von 2 Punkten grün');
    expect(md).toContain('| hoch | Konto | Root-Konto mit MFA |');
  });

  it('SSM: Altlasten und Geheimnis als String werden gemeldet', () => {
    const r = checkSsmInventory(
      {
        Parameters: [
          { Name: '/nina-pm/oauth/cookie-secret', Type: 'String' },
          { Name: '/nina-pm/origin-verify', Type: 'String' },
          { Name: '/nina-pm/jwt/old', Type: 'SecureString' },
        ],
      },
      ['/nina-pm/oauth/cookie-secret', '/nina-pm/origin-verify'],
      ['/nina-pm/oauth/cookie-secret'],
    );
    expect(r.map((x) => [x.ok, x.detail])).toEqual([
      [false, 'zusätzlich: /nina-pm/jwt/old'],
      [false, 'nicht SecureString oder fehlt: /nina-pm/oauth/cookie-secret'],
    ]);
  });

  it('Altrollen und GitHub-OIDC, weitere APIs, Buckets und Zeitpläne', () => {
    expect(
      checkLegacyAccess(
        { Roles: [{ RoleName: 'NinaPmApi' }, { RoleName: 'NinaPmDbBootstrap' }] },
        {
          OpenIDConnectProviderList: [
            { Arn: 'arn:aws:iam::1:oidc-provider/token.actions.githubusercontent.com' },
          ],
        },
      ).map((x) => x.ok),
    ).toEqual([false, false]);
    expect(
      checkApiInventory(
        {
          Items: [
            { Name: 'nina-pm', ApiId: 'a' },
            { Name: 'nina-pm-old', ApiId: 'b' },
          ],
        },
        { Items: [] },
        'a',
      ).ok,
    ).toBe(false);
    expect(
      checkBucketInventory(
        { Buckets: [{ Name: 'svenesis-nina-pm-web' }, { Name: 'svenesis-nina-pm-tmp' }] },
        ['svenesis-nina-pm-web'],
        { CORSRules: [] },
      ).map((x) => x.ok),
    ).toEqual([false, true]);
    expect(
      checkSchedules(
        {
          Schedules: [
            { Name: 'tick', Target: { Arn: 'arn:w' } },
            { Name: 'x', Target: { Arn: 'arn:other' } },
          ],
        },
        'arn:w',
      ),
    ).toMatchObject({ ok: false, detail: 'x' });
  });
});
