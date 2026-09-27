import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { resources, synth } from './synth';

// CDK-Assertions nach specs/infra/iam.md §12. In AP-02a grün: Nr. 5, 6, 7, 10 und der Backup-Plan.
// Nr. 1–4, 8, 9 folgen mit den Lambdas in AP-02b und AP-03.
const { data, config: configTemplate, cert, web, edge, jobs, api, ops } = synth();
const all = { data, config: configTemplate, cert, web, edge, jobs, api, ops };

type Csp = Record<string, string[]>;
function parseCsp(csp: string): Csp {
  return Object.fromEntries(
    csp
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name, ...values]) => [name as string, values]),
  );
}

function headerPolicies() {
  const policies = resources(edge, 'AWS::CloudFront::ResponseHeadersPolicy').map(([id, r]) => {
    const cfg = r.Properties.ResponseHeadersPolicyConfig as {
      Name: string;
      SecurityHeadersConfig: {
        ContentSecurityPolicy: { ContentSecurityPolicy: string };
        StrictTransportSecurity: { AccessControlMaxAgeSec: number; IncludeSubdomains: boolean };
        ContentTypeOptions: { Override: boolean };
        ReferrerPolicy: { ReferrerPolicy: string };
      };
      CustomHeadersConfig?: { Items: { Header: string; Value: string }[] };
    };
    return { id, ...cfg };
  });
  const byName = (name: string) => {
    const policy = policies.find((p) => p.Name === name);
    if (!policy) throw new Error(`Response-Headers-Policy ${name} fehlt`);
    return policy;
  };
  return { policies, html: byName('npm-html'), apiStatic: byName('npm-api-static') };
}

function distributionConfig() {
  const [[, dist] = []] = resources(edge, 'AWS::CloudFront::Distribution');
  if (!dist) throw new Error('Distribution fehlt');
  return dist.Properties.DistributionConfig as {
    Aliases: string[];
    DefaultCacheBehavior: { ResponseHeadersPolicyId?: unknown };
    CacheBehaviors: { PathPattern: string; ResponseHeadersPolicyId?: unknown }[];
    Origins: {
      OriginAccessControlId?: unknown;
      S3OriginConfig?: { OriginAccessIdentity?: string };
    }[];
    CustomErrorResponses?: unknown;
    PriceClass: string;
    HttpVersion: string;
    ViewerCertificate: { MinimumProtocolVersion: string };
  };
}

const refId = (value: unknown) => (value as { Ref?: string } | undefined)?.Ref;

describe('Assertion 5: Buckets', () => {
  const buckets = [...resources(data, 'AWS::S3::Bucket'), ...resources(web, 'AWS::S3::Bucket')];

  it('beide Projekt-Buckets existieren', () => {
    expect(buckets.map(([, b]) => b.Properties.BucketName).sort()).toEqual(
      [config.buckets.data, config.buckets.web].sort(),
    );
  });

  it.each(buckets.map(([, b]) => [b.Properties.BucketName as string, b] as const))(
    '%s: Block Public Access vollständig und Versionierung an',
    (_name, bucket) => {
      expect(bucket.Properties.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
      expect(bucket.Properties.VersioningConfiguration).toEqual({ Status: 'Enabled' });
    },
  );

  it('Web-Bucket ist nur über CloudFront mit OAC lesbar', () => {
    const cfg = distributionConfig();
    const s3Origins = cfg.Origins.filter((o) => o.S3OriginConfig);
    expect(s3Origins).toHaveLength(1);
    for (const origin of s3Origins) {
      expect(origin.OriginAccessControlId).toBeDefined();
      expect(origin.S3OriginConfig?.OriginAccessIdentity ?? '').toBe('');
    }
    const [[, oac] = []] = resources(edge, 'AWS::CloudFront::OriginAccessControl');
    expect(oac?.Properties.OriginAccessControlConfig).toMatchObject({
      OriginAccessControlOriginType: 's3',
      SigningBehavior: 'always',
      SigningProtocol: 'sigv4',
    });

    const policies = resources(edge, 'AWS::S3::BucketPolicy');
    expect(policies).toHaveLength(1);
    const statements = (
      policies[0]?.[1].Properties.PolicyDocument as {
        Statement: { Effect: string; Principal: unknown; Action: unknown; Condition?: unknown }[];
      }
    ).Statement;
    const allows = statements.filter((s) => s.Effect === 'Allow');
    expect(allows).toHaveLength(1);
    expect(allows[0]).toMatchObject({
      Principal: { Service: 'cloudfront.amazonaws.com' },
      Action: 's3:GetObject',
      Condition: { StringEquals: { 'AWS:SourceArn': expect.anything() } },
    });
    expect(resources(web, 'AWS::S3::BucketPolicy')).toHaveLength(0);
  });
});

describe('Assertion 6: Response-Headers-Policies', () => {
  const { policies, html, apiStatic } = headerPolicies();
  const cfg = distributionConfig();

  it('alle vier Behaviors tragen eine Response-Headers-Policy', () => {
    expect(cfg.CacheBehaviors.map((b) => b.PathPattern)).toEqual([
      '/api/*',
      '/catalog/*',
      '/downloads/*',
    ]);
    expect(refId(cfg.DefaultCacheBehavior.ResponseHeadersPolicyId)).toBe(html.id);
    for (const behavior of cfg.CacheBehaviors) {
      expect(refId(behavior.ResponseHeadersPolicyId), behavior.PathPattern).toBe(apiStatic.id);
    }
    expect(policies).toHaveLength(2);
  });

  it("npm-html: style-src mit 'unsafe-inline', script-src ohne 'unsafe-inline'", () => {
    const csp = parseCsp(html.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy);
    expect(csp['style-src']).toContain("'unsafe-inline'");
    expect(csp['script-src']).toEqual(["'self'"]);
    expect(csp['default-src']).toEqual(["'self'"]);
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['base-uri']).toEqual(["'none'"]);
    expect(csp['form-action']).toEqual(["'self'"]);
    expect(csp['frame-ancestors']).toEqual(["'none'"]);
  });

  it("npm-api-static: harte CSP mit default-src 'none'", () => {
    const csp = parseCsp(
      apiStatic.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy,
    );
    expect(csp['default-src']).toEqual(["'none'"]);
    expect(csp).toHaveProperty('sandbox');
    expect(csp['frame-ancestors']).toEqual(["'none'"]);
    expect(csp['base-uri']).toEqual(["'none'"]);
  });

  it.each([
    ['npm-html', html],
    ['npm-api-static', apiStatic],
  ])('%s: HSTS 2 Jahre, nosniff, Referrer-, Permissions- und Opener-Policy', (_name, policy) => {
    const sec = policy.SecurityHeadersConfig;
    expect(sec.StrictTransportSecurity).toMatchObject({
      AccessControlMaxAgeSec: 63072000,
      IncludeSubdomains: true,
    });
    expect(sec.ContentTypeOptions.Override).toBe(true);
    expect(sec.ReferrerPolicy.ReferrerPolicy).toBe('strict-origin-when-cross-origin');
    const custom = Object.fromEntries(
      (policy.CustomHeadersConfig?.Items ?? []).map((h) => [h.Header, h.Value]),
    );
    expect(custom['Permissions-Policy']).toBe(
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    );
    expect(custom['Cross-Origin-Opener-Policy']).toBe('same-origin');
  });

  it('npm-api-static setzt zusätzlich Cross-Origin-Resource-Policy', () => {
    const custom = Object.fromEntries(
      (apiStatic.CustomHeadersConfig?.Items ?? []).map((h) => [h.Header, h.Value]),
    );
    expect(custom['Cross-Origin-Resource-Policy']).toBe('same-origin');
  });

  it('Distribution nach TK 4.3: Domain, keine Custom Error Responses, PriceClass_100, HTTP/3, TLS 1.2', () => {
    expect(cfg.Aliases).toEqual(['nina-pm.svenesis.org']);
    expect(cfg.CustomErrorResponses).toBeUndefined();
    expect(cfg.PriceClass).toBe('PriceClass_100');
    expect(cfg.HttpVersion).toBe('http2and3');
    expect(cfg.ViewerCertificate.MinimumProtocolVersion).toBe('TLSv1.2_2021');
  });
});

describe('Assertion 7: Website-Schutz', () => {
  it('Route-53-Einträge nur mit dem Präfix nina-pm', () => {
    const names = Object.values(all).flatMap((t) =>
      resources(t, 'AWS::Route53::RecordSet').map(([, r]) => r.Properties.Name as string),
    );
    expect(names.length).toBeGreaterThan(0);
    // Fest verdrahtet, nicht aus config: die Assertion soll auch eine falsche Konfiguration fangen.
    for (const name of names) expect(name, name).toMatch(/^nina-pm\./);
  });

  it('keine Hosted Zone angelegt oder verändert', () => {
    for (const t of Object.values(all)) {
      expect(resources(t, 'AWS::Route53::HostedZone')).toHaveLength(0);
    }
  });

  it('kein Template referenziert die Website-Distribution E2L6Q80SD8XPT0', () => {
    for (const [name, t] of Object.entries(all)) {
      expect(JSON.stringify(t.toJSON()), name).not.toContain('E2L6Q80SD8XPT0');
    }
  });
});

describe('Assertion 10: Löschschutz', () => {
  it('DSQL-Cluster mit Löschschutz, DeletionPolicy Retain und Tag purpose=prod', () => {
    const clusters = resources(data, 'AWS::DSQL::Cluster');
    expect(clusters).toHaveLength(1);
    const [, cluster] = clusters[0] ?? [];
    expect(cluster?.Properties.DeletionProtectionEnabled).toBe(true);
    expect(cluster?.DeletionPolicy).toBe('Retain');
    expect(cluster?.UpdateReplacePolicy).toBe('Retain');
    expect(cluster?.Properties.Tags).toContainEqual({ Key: 'purpose', Value: 'prod' });
  });

  it('Daten-Bucket mit DeletionPolicy Retain', () => {
    const [[, bucket] = []] = resources(data, 'AWS::S3::Bucket');
    expect(bucket?.Properties.BucketName).toBe(config.buckets.data);
    expect(bucket?.DeletionPolicy).toBe('Retain');
  });

  it('Daten-Bucket: Aufbewahrung über Tags, alte Versionen 30 Tage, abgebrochene Uploads 1 Tag (TK 12)', () => {
    const [[, bucket] = []] = resources(data, 'AWS::S3::Bucket');
    const rules = (
      bucket?.Properties.LifecycleConfiguration as { Rules: Record<string, unknown>[] } | undefined
    )?.Rules;
    expect(rules).toContainEqual({
      Id: 'noncurrent-versions-and-uploads',
      Status: 'Enabled',
      NoncurrentVersionExpiration: { NoncurrentDays: 30 },
      ExpiredObjectDeleteMarker: true,
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
    });
    for (const days of [2, 7, 400])
      expect(rules).toContainEqual({
        Id: `retention-${String(days)}d`,
        Status: 'Enabled',
        ExpirationInDays: days,
        TagFilters: [{ Key: 'npm-retention', Value: `${String(days)}d` }],
      });
    expect(rules).toHaveLength(4);
  });
});

describe('Backup-Plan (iam.md §11)', () => {
  it('täglich, 35 Tage, Standard-Vault', () => {
    const [[, plan] = []] = resources(data, 'AWS::Backup::BackupPlan');
    const rules = (plan?.Properties.BackupPlan as { BackupPlanRule: Record<string, unknown>[] })
      .BackupPlanRule;
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      TargetBackupVault: 'Default',
      Lifecycle: { DeleteAfterDays: 35 },
      ScheduleExpression: expect.stringMatching(/^cron\(\d+ \d+ \* \* \? \*\)$/),
    });
    expect(resources(data, 'AWS::Backup::BackupVault')).toHaveLength(0);
  });

  it('Auswahl über den Cluster-ARN', () => {
    const [[clusterId] = []] = resources(data, 'AWS::DSQL::Cluster');
    const [[, selection] = []] = resources(data, 'AWS::Backup::BackupSelection');
    expect((selection?.Properties.BackupSelection as { Resources: unknown[] }).Resources).toEqual([
      { 'Fn::GetAtt': [clusterId, 'ResourceArn'] },
    ]);
  });
});

describe('Import-Modus (-c dsqlClusterId=…)', () => {
  const imported = synth({ dsqlClusterId: 'abc123restored' });

  it('legt keinen Cluster an und sichert den übergebenen Cluster', () => {
    expect(resources(imported.data, 'AWS::DSQL::Cluster')).toHaveLength(0);
    const [[, selection] = []] = resources(imported.data, 'AWS::Backup::BackupSelection');
    const [arn] = (selection?.Properties.BackupSelection as { Resources: unknown[] }).Resources;
    expect(JSON.stringify(arn)).toContain(':cluster/abc123restored');
  });

  it('gibt den Endpunkt des übergebenen Clusters aus', () => {
    imported.data.hasOutput('DsqlEndpoint', { Value: 'abc123restored.dsql.eu-central-1.on.aws' });
  });
});

describe('Config und Edge', () => {
  it('Config legt keine Parameter an und erzeugt keine CloudFormation-Parameter', () => {
    expect(resources(configTemplate, 'AWS::SSM::Parameter')).toHaveLength(0);
    const params = Object.keys(configTemplate.toJSON().Parameters ?? {}).filter(
      (p) => p !== 'BootstrapVersion',
    );
    expect(params).toEqual([]);
  });

  it('Edge schreibt /nina-pm/web/build-id', () => {
    edge.hasResourceProperties('AWS::SSM::Parameter', {
      Name: config.ssm.webBuildId,
      Type: 'String',
    });
  });

  it('Zertifikat in us-east-1 für die Domain, DNS-validiert', () => {
    expect(synth().stacks.cert.region).toBe('us-east-1');
    cert.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: config.domainName,
      ValidationMethod: 'DNS',
    });
  });

  it('keine Lambda setzt AUTH_TEST_MODE (Vorgriff auf Assertion 9)', () => {
    for (const t of Object.values(all)) {
      for (const [, fn] of resources(t, 'AWS::Lambda::Function')) {
        expect(JSON.stringify(fn.Properties.Environment ?? {})).not.toContain('AUTH_TEST_MODE');
      }
    }
  });
});
