/**
 * Konfiguration der einzigen Umgebung prod (TK 4.4). Enthält nur Namen und nicht geheime Werte;
 * die Werte der Parameter stehen ausschließlich in SSM (H-05, specs/infra/iam.md §8).
 */
export const config = {
  /** AWS-Konto mit der Route-53-Zone svenesis.org (H-01). */
  account: '509219055019',
  region: 'eu-central-1',
  /** CloudFront-Zertifikate müssen in us-east-1 liegen. */
  certRegion: 'us-east-1',
  zoneName: 'svenesis.org',
  /** Einziger Name, unter dem CDK Einträge in der Zone anlegt (Website-Schutz, Assertion 7). */
  recordName: 'nina-pm',
  domainName: 'nina-pm.svenesis.org',
  buckets: {
    data: 'svenesis-nina-pm-data',
    web: 'svenesis-nina-pm-web',
  },
  backup: {
    /** AWS-Backup-Standard-Vault (SV-15), täglich, 35 Tage. */
    vaultName: 'Default',
    retentionDays: 35,
  },
  logRetentionDays: 90,
  /** SSM-Parameternamen (iam.md §8). */
  ssm: {
    cookieSecret: '/nina-pm/oauth/cookie-secret',
    discordClientId: '/nina-pm/discord/client-id',
    discordClientSecret: '/nina-pm/discord/client-secret',
    originVerify: '/nina-pm/origin-verify',
    bootstrapSuperUsers: '/nina-pm/bootstrap-super-users',
    dsqlEndpoint: '/nina-pm/dsql-endpoint',
    webBuildId: '/nina-pm/web/build-id',
    alarmWebhook: '/nina-pm/system/alarm-webhook',
  },
} as const;

export const env = { account: config.account, region: config.region } as const;
export const certEnv = { account: config.account, region: config.certRegion } as const;
