/**
 * Prüfungen von `pnpm security:check` (Sicherheitsanalyse 05.10.2026): reine Auswertung der JSON-Antworten der AWS-CLI,
 * damit sie ohne Konto testbar sind. Kein Prüfer gibt geheime Werte aus – nur Namen, Typen und Ja/Nein.
 */

export type Severity = 'hoch' | 'mittel' | 'niedrig' | 'info';

export interface SecurityResult {
  readonly area: string;
  readonly name: string;
  readonly ok: boolean;
  /** Schwere, falls nicht ok. */
  readonly severity: Severity;
  readonly detail: string;
}

const pass = (area: string, name: string, detail = 'ok'): SecurityResult => ({
  area,
  name,
  ok: true,
  severity: 'info',
  detail,
});
const fail = (area: string, name: string, severity: Severity, detail: string): SecurityResult => ({
  area,
  name,
  ok: false,
  severity,
  detail,
});
/** Antwort fehlt (CLI-Fehler, fehlende Rechte): offen, nicht grün. */
const unknown = (area: string, name: string): SecurityResult =>
  fail(area, name, 'mittel', 'keine Antwort der AWS-CLI (Rechte oder Dienst prüfen)');

// ---- Konto ----

export function checkRoot(
  summary: { SummaryMap?: Record<string, number> } | undefined,
): SecurityResult[] {
  const area = 'Konto';
  if (!summary?.SummaryMap) return [unknown(area, 'Root-Konto')];
  const m = summary.SummaryMap;
  return [
    m.AccountMFAEnabled === 1
      ? pass(area, 'Root-Konto mit MFA')
      : fail(area, 'Root-Konto mit MFA', 'hoch', 'Root hat keine MFA'),
    (m.AccountAccessKeysPresent ?? 0) === 0
      ? pass(area, 'Root ohne Zugriffsschlüssel')
      : fail(area, 'Root ohne Zugriffsschlüssel', 'hoch', 'Root hat Zugriffsschlüssel'),
  ];
}

/** Zeilen des IAM-Credential-Reports (CSV, erste Zeile Kopf). */
export function parseCredentialReport(csv: string): Record<string, string>[] {
  const [head, ...rows] = csv.trim().split(/\r?\n/);
  const keys = (head ?? '').split(',');
  return rows.map((r) =>
    Object.fromEntries(r.split(',').map((v, i) => [keys[i] ?? `c${String(i)}`, v])),
  );
}

export function checkIamUsers(
  rows: Record<string, string>[] | undefined,
  nowMs: number,
): SecurityResult[] {
  const area = 'Konto';
  if (!rows) return [unknown(area, 'IAM-Benutzer')];
  const users = rows.filter((r) => r.user !== '<root_account>');
  const noMfa = users
    .filter((r) => r.password_enabled === 'true' && r.mfa_active !== 'true')
    .map((r) => r.user);
  const DAY = 86_400_000;
  const oldKeys: string[] = [];
  for (const r of users)
    for (const k of ['1', '2']) {
      if (r[`access_key_${k}_active`] !== 'true') continue;
      const rotated = Date.parse(r[`access_key_${k}_last_rotated`] ?? '');
      if (!Number.isNaN(rotated) && nowMs - rotated > 90 * DAY)
        oldKeys.push(
          `${r.user ?? '?'} (Schlüssel ${k}, ${String(Math.round((nowMs - rotated) / DAY))} Tage)`,
        );
    }
  return [
    noMfa.length === 0
      ? pass(area, 'IAM-Benutzer mit Konsolenzugang haben MFA', `${String(users.length)} Benutzer`)
      : fail(
          area,
          'IAM-Benutzer mit Konsolenzugang haben MFA',
          'hoch',
          `ohne MFA: ${noMfa.join(', ')}`,
        ),
    oldKeys.length === 0
      ? pass(area, 'Aktive Zugriffsschlüssel jünger als 90 Tage')
      : fail(area, 'Aktive Zugriffsschlüssel jünger als 90 Tage', 'mittel', oldKeys.join(', ')),
  ];
}

interface PublicAccessBlock {
  BlockPublicAcls?: boolean;
  IgnorePublicAcls?: boolean;
  BlockPublicPolicy?: boolean;
  RestrictPublicBuckets?: boolean;
}
const allBlocked = (p: PublicAccessBlock | undefined) =>
  !!p &&
  !!p.BlockPublicAcls &&
  !!p.IgnorePublicAcls &&
  !!p.BlockPublicPolicy &&
  !!p.RestrictPublicBuckets;

export function checkAccountPublicAccess(
  r: { PublicAccessBlockConfiguration?: PublicAccessBlock } | undefined,
): SecurityResult {
  const area = 'Konto';
  if (!r)
    return fail(
      area,
      'S3 Public Access Block (Konto)',
      'mittel',
      'nicht gesetzt oder keine Antwort',
    );
  return allBlocked(r.PublicAccessBlockConfiguration)
    ? pass(area, 'S3 Public Access Block (Konto)')
    : fail(
        area,
        'S3 Public Access Block (Konto)',
        'mittel',
        JSON.stringify(r.PublicAccessBlockConfiguration),
      );
}

export function checkCloudTrail(
  trails: { trailList?: { Name?: string; IsMultiRegionTrail?: boolean }[] } | undefined,
  logging: Record<string, boolean>,
): SecurityResult {
  const area = 'Konto';
  if (!trails?.trailList) return unknown(area, 'CloudTrail');
  const active = trails.trailList.filter((t) => t.IsMultiRegionTrail && t.Name && logging[t.Name]);
  return active.length
    ? pass(area, 'CloudTrail (alle Regionen) protokolliert', active.map((t) => t.Name).join(', '))
    : fail(
        area,
        'CloudTrail (alle Regionen) protokolliert',
        'mittel',
        'kein aktiver Multi-Region-Trail – nur die 90-Tage-Ereignisliste, keine Aufbewahrung, keine Datenereignisse',
      );
}

export function checkGuardDuty(
  detectors: { DetectorIds?: string[] } | undefined,
  region: string,
): SecurityResult {
  const area = 'Konto';
  if (!detectors) return unknown(area, `GuardDuty ${region}`);
  return (detectors.DetectorIds ?? []).length
    ? pass(area, `GuardDuty ${region}`)
    : fail(
        area,
        `GuardDuty ${region}`,
        'niedrig',
        'nicht aktiviert (Erkennung von Angriffen, z. B. gestohlene Schlüssel)',
      );
}

export function checkAccessAnalyzer(
  analyzers: { analyzers?: { arn?: string; type?: string; status?: string }[] } | undefined,
  findings:
    | {
        findings?: {
          resource?: string;
          resourceType?: string;
          isPublic?: boolean;
          status?: string;
        }[];
      }
    | undefined,
): SecurityResult[] {
  const area = 'Konto';
  if (!analyzers) return [unknown(area, 'IAM Access Analyzer')];
  const active = (analyzers.analyzers ?? []).filter((a) => a.status === 'ACTIVE');
  if (!active.length)
    return [
      fail(
        area,
        'IAM Access Analyzer',
        'niedrig',
        'kein Analyzer – meldet öffentliche oder kontofremde Freigaben (S3, IAM-Rollen, KMS, SQS, Lambda) automatisch',
      ),
    ];
  const open = (findings?.findings ?? []).filter((f) => f.status === 'ACTIVE');
  return [
    pass(area, 'IAM Access Analyzer aktiv'),
    open.length === 0
      ? pass(area, 'Keine externen oder öffentlichen Freigaben (Access Analyzer)')
      : fail(
          area,
          'Keine externen oder öffentlichen Freigaben (Access Analyzer)',
          open.some((f) => f.isPublic) ? 'hoch' : 'mittel',
          open
            .map(
              (f) =>
                `${f.resourceType ?? '?'} ${f.resource ?? '?'}${f.isPublic ? ' (öffentlich)' : ''}`,
            )
            .join('; '),
        ),
  ];
}

// ---- S3 ----

interface Statement {
  Effect?: string;
  Principal?: unknown;
  Action?: string | string[];
  Resource?: string | string[];
  Condition?: Record<string, Record<string, unknown>>;
}
export const policyStatements = (policy: string | undefined): Statement[] => {
  if (!policy) return [];
  const p = JSON.parse(policy) as { Statement?: Statement | Statement[] };
  return Array.isArray(p.Statement) ? p.Statement : p.Statement ? [p.Statement] : [];
};
const principalIsAnyone = (p: unknown) =>
  p === '*' || (typeof p === 'object' && p !== null && (p as { AWS?: unknown }).AWS === '*');

export interface BucketFacts {
  readonly name: string;
  readonly publicAccessBlock?: PublicAccessBlock;
  readonly policyIsPublic?: boolean;
  readonly policy?: string;
  readonly aclGrants?: { Grantee?: { URI?: string } }[];
  readonly encrypted?: boolean;
  readonly versioning?: string;
  readonly ownership?: string;
}

export function checkBucket(b: BucketFacts): SecurityResult[] {
  const area = `S3 ${b.name}`;
  const statements = policyStatements(b.policy);
  const sslOnly = statements.some(
    (s) =>
      s.Effect === 'Deny' &&
      principalIsAnyone(s.Principal) &&
      JSON.stringify(s.Condition ?? {}).includes('aws:SecureTransport'),
  );
  const openAllow = statements.filter(
    (s) => s.Effect === 'Allow' && principalIsAnyone(s.Principal) && !s.Condition,
  );
  const publicAcl = (b.aclGrants ?? []).some((g) =>
    /AllUsers|AuthenticatedUsers/.test(g.Grantee?.URI ?? ''),
  );
  return [
    allBlocked(b.publicAccessBlock)
      ? pass(area, 'Public Access Block (alle vier)')
      : fail(
          area,
          'Public Access Block (alle vier)',
          'hoch',
          JSON.stringify(b.publicAccessBlock ?? null),
        ),
    b.policyIsPublic === false && openAllow.length === 0
      ? pass(area, 'Richtlinie nicht öffentlich')
      : fail(
          area,
          'Richtlinie nicht öffentlich',
          'hoch',
          `IsPublic=${String(b.policyIsPublic)}, offene Allow-Anweisungen ${String(openAllow.length)}`,
        ),
    !publicAcl
      ? pass(area, 'ACL ohne AllUsers/AuthenticatedUsers')
      : fail(area, 'ACL ohne AllUsers/AuthenticatedUsers', 'hoch', 'öffentliche ACL-Freigabe'),
    sslOnly
      ? pass(area, 'Nur HTTPS (aws:SecureTransport)')
      : fail(
          area,
          'Nur HTTPS (aws:SecureTransport)',
          'niedrig',
          'keine Deny-Anweisung für unverschlüsselte Zugriffe',
        ),
    b.encrypted
      ? pass(area, 'Verschlüsselung im Ruhezustand')
      : fail(area, 'Verschlüsselung im Ruhezustand', 'mittel', 'keine Standardverschlüsselung'),
    b.ownership === 'BucketOwnerEnforced'
      ? pass(area, 'ACLs abgeschaltet (BucketOwnerEnforced)')
      : fail(
          area,
          'ACLs abgeschaltet (BucketOwnerEnforced)',
          'niedrig',
          b.ownership ?? 'nicht gesetzt',
        ),
  ];
}

// ---- Lambda ----

export interface LambdaFacts {
  readonly name: string;
  readonly hasFunctionUrl: boolean;
  readonly functionUrlAuth?: string;
  readonly resourcePolicy?: string;
  readonly envNames: readonly string[];
  /** Variablen, deren Name nach Geheimnis klingt und deren Wert kein SSM-Pfad/ARN ist (nur Namen). */
  readonly envSecretLiterals: readonly string[];
  readonly runtime?: string;
}

const ALLOWED_INVOKERS = [
  'apigateway.amazonaws.com',
  'events.amazonaws.com',
  'scheduler.amazonaws.com',
  'logs.amazonaws.com',
];

export function checkLambda(l: LambdaFacts): SecurityResult[] {
  const area = `Lambda ${l.name}`;
  const statements = policyStatements(l.resourcePolicy);
  const foreign = statements.filter((s) => {
    const p = s.Principal as { Service?: string; AWS?: string } | string | undefined;
    if (p === '*' || (typeof p === 'object' && p?.AWS === '*')) return true;
    const service = typeof p === 'object' ? p?.Service : undefined;
    if (service && !ALLOWED_INVOKERS.includes(service)) return true;
    // Dienst-Aufrufer nur mit Quelle (SourceArn/SourceAccount), sonst könnte jedes Konto über den Dienst aufrufen.
    return (
      !!service &&
      !JSON.stringify(s.Condition ?? {}).match(
        /AWS:SourceArn|aws:SourceArn|AWS:SourceAccount|aws:SourceAccount/,
      )
    );
  });
  return [
    !l.hasFunctionUrl
      ? pass(area, 'Keine Function URL')
      : l.functionUrlAuth === 'AWS_IAM'
        ? pass(area, 'Function URL nur mit IAM', 'AWS_IAM')
        : fail(
            area,
            'Keine Function URL',
            'hoch',
            `Function URL ohne Anmeldung (${l.functionUrlAuth ?? '?'})`,
          ),
    foreign.length === 0
      ? pass(
          area,
          'Aufruf nur durch eigene Dienste mit Quelle',
          `${String(statements.length)} Anweisungen`,
        )
      : fail(
          area,
          'Aufruf nur durch eigene Dienste mit Quelle',
          'hoch',
          JSON.stringify(foreign.map((s) => s.Principal)),
        ),
    l.envSecretLiterals.length === 0
      ? pass(
          area,
          'Keine Geheimnisse als Umgebungsvariable',
          `${String(l.envNames.length)} Variablen`,
        )
      : fail(
          area,
          'Keine Geheimnisse als Umgebungsvariable',
          'hoch',
          `verdächtig: ${l.envSecretLiterals.join(', ')}`,
        ),
    l.envNames.includes('AUTH_TEST_MODE')
      ? fail(area, 'Kein AUTH_TEST_MODE', 'hoch', 'Testanmeldung in prod möglich')
      : pass(area, 'Kein AUTH_TEST_MODE'),
  ];
}

const SECRET_NAME =
  /(secret|token|password|passwd|webhook|private|apikey|api_key|signing|client_secret)/i;
/** Namen geheim klingender Variablen mit literalem Wert (Wert selbst wird nie zurückgegeben). */
export function secretLiterals(env: Record<string, string>): string[] {
  return Object.entries(env)
    .filter(
      ([k, v]) =>
        SECRET_NAME.test(k) &&
        !/^(\/|arn:|ssm:)/.test(v) &&
        !/_(PARAM|PARAMETER|ARN|NAME|PATH)$/i.test(k),
    )
    .map(([k]) => k);
}

// ---- IAM-Rollen der Lambdas (iam.md, SV-13) ----

export interface RoleFacts {
  readonly role: string;
  readonly attached: readonly string[];
  readonly inline: readonly { name: string; document: { Statement?: Statement | Statement[] } }[];
}

/** Aktionen, die laut AWS nur mit `Resource: *` gehen (keine Ressourcen-Ebene). */
const STAR_OK =
  /^(xray:|logs:CreateLogGroup|cloudwatch:PutMetricData|ec2:(Create|Describe|Delete)NetworkInterface|ssm:DescribeParameters|kms:ListAliases|sts:GetCallerIdentity|tag:GetResources)/;

export function checkRole(r: RoleFacts): SecurityResult[] {
  const area = `IAM ${r.role}`;
  const managed = r.attached.filter((a) => !a.endsWith('/AWSLambdaBasicExecutionRole'));
  const wild: string[] = [];
  for (const p of r.inline) {
    const st = p.document.Statement;
    for (const s of Array.isArray(st) ? st : st ? [st] : []) {
      if (s.Effect !== 'Allow') continue;
      const actions = Array.isArray(s.Action) ? s.Action : [s.Action ?? ''];
      const resources = Array.isArray(s.Resource) ? s.Resource : [s.Resource ?? ''];
      if (actions.some((a) => a === '*' || a.endsWith(':*')))
        wild.push(`${p.name}: Aktion ${actions.join(',')}`);
      else if (resources.includes('*') && !actions.every((a) => STAR_OK.test(a)))
        wild.push(`${p.name}: ${actions.join(',')} auf *`);
    }
  }
  return [
    managed.length === 0
      ? pass(area, 'Nur AWSLambdaBasicExecutionRole als verwaltete Richtlinie')
      : fail(
          area,
          'Nur AWSLambdaBasicExecutionRole als verwaltete Richtlinie',
          'mittel',
          managed.join(', '),
        ),
    wild.length === 0
      ? pass(area, 'Keine *-Aktionen, * nur wo AWS es verlangt')
      : fail(area, 'Keine *-Aktionen, * nur wo AWS es verlangt', 'mittel', wild.join('; ')),
  ];
}

// ---- API Gateway, CloudFront, SSM, Logs ----

export function checkHttpApi(
  api:
    | { DisableExecuteApiEndpoint?: boolean; CorsConfiguration?: { AllowOrigins?: string[] } }
    | undefined,
  directStatus: number | undefined,
): SecurityResult[] {
  const area = 'API Gateway';
  if (!api) return [unknown(area, 'HTTP-API')];
  const origins = api.CorsConfiguration?.AllowOrigins ?? [];
  return [
    api.DisableExecuteApiEndpoint || directStatus === 403
      ? pass(
          area,
          'Direktaufruf der execute-api-Adresse abgewiesen',
          api.DisableExecuteApiEndpoint
            ? 'Endpunkt abgeschaltet'
            : `HTTP ${String(directStatus)} (Origin-Header fehlt)`,
        )
      : fail(
          area,
          'Direktaufruf der execute-api-Adresse abgewiesen',
          'hoch',
          `HTTP ${String(directStatus ?? '?')}`,
        ),
    origins.includes('*')
      ? fail(area, 'CORS ohne *', 'mittel', 'AllowOrigins *')
      : pass(area, 'CORS ohne *', origins.join(', ') || 'kein CORS (gleicher Ursprung)'),
  ];
}

interface Behavior {
  PathPattern?: string;
  ViewerProtocolPolicy?: string;
  ResponseHeadersPolicyId?: string;
}
export function checkDistribution(
  cfg:
    | {
        ViewerCertificate?: { MinimumProtocolVersion?: string };
        DefaultCacheBehavior?: Behavior;
        CacheBehaviors?: { Items?: Behavior[] };
        Origins?: {
          Items?: {
            Id?: string;
            S3OriginConfig?: { OriginAccessIdentity?: string };
            OriginAccessControlId?: string;
            DomainName?: string;
          }[];
        };
        WebACLId?: string;
      }
    | undefined,
): SecurityResult[] {
  const area = 'CloudFront';
  if (!cfg) return [unknown(area, 'Distribution')];
  const behaviors = [cfg.DefaultCacheBehavior ?? {}, ...(cfg.CacheBehaviors?.Items ?? [])];
  const plain = behaviors
    .filter((b) => b.ViewerProtocolPolicy === 'allow-all')
    .map((b) => b.PathPattern ?? 'Standard');
  const noHeaders = behaviors
    .filter((b) => !b.ResponseHeadersPolicyId)
    .map((b) => b.PathPattern ?? 'Standard');
  const s3 = (cfg.Origins?.Items ?? []).filter((o) => /\.s3[.-]/.test(o.DomainName ?? ''));
  const s3Open = s3
    .filter((o) => !o.OriginAccessControlId && !o.S3OriginConfig?.OriginAccessIdentity)
    .map((o) => o.Id);
  const tls = cfg.ViewerCertificate?.MinimumProtocolVersion ?? '';
  return [
    plain.length === 0
      ? pass(area, 'Nur HTTPS (alle Behaviors)')
      : fail(area, 'Nur HTTPS (alle Behaviors)', 'mittel', plain.join(', ')),
    /TLSv1\.2|TLSv1\.3/.test(tls)
      ? pass(area, 'TLS ≥ 1.2', tls)
      : fail(area, 'TLS ≥ 1.2', 'mittel', tls || '?'),
    noHeaders.length === 0
      ? pass(area, 'Sicherheits-Header-Richtlinie an allen Behaviors')
      : fail(
          area,
          'Sicherheits-Header-Richtlinie an allen Behaviors',
          'niedrig',
          noHeaders.join(', '),
        ),
    s3Open.length === 0
      ? pass(area, 'S3-Ursprünge nur über OAC', `${String(s3.length)} S3-Ursprünge`)
      : fail(area, 'S3-Ursprünge nur über OAC', 'hoch', s3Open.join(', ')),
    pass(
      area,
      'WAF',
      cfg.WebACLId
        ? `Web ACL ${cfg.WebACLId}`
        : 'keine (Entscheidung „kein WAF“, Drosselung im API Gateway)',
    ),
  ];
}

/** SSM-Inventar unter `/nina-pm/`: nur die erwarteten Parameter (Altlasten fallen auf), Geheimnisse als SecureString. */
export function checkSsmInventory(
  params: { Parameters?: { Name?: string; Type?: string }[] } | undefined,
  expected: readonly string[],
  secrets: readonly string[],
): SecurityResult[] {
  const area = 'SSM';
  if (!params) return [unknown(area, 'Parameter unter /nina-pm/')];
  const list = params.Parameters ?? [];
  const extra = list.map((p) => p.Name ?? '').filter((n) => !expected.includes(n));
  const plainSecrets = secrets.filter(
    (n) => list.find((p) => p.Name === n)?.Type !== 'SecureString',
  );
  return [
    extra.length === 0
      ? pass(area, 'Nur erwartete Parameter unter /nina-pm/', `${String(list.length)} Parameter`)
      : fail(
          area,
          'Nur erwartete Parameter unter /nina-pm/',
          'niedrig',
          `zusätzlich: ${extra.join(', ')}`,
        ),
    plainSecrets.length === 0
      ? pass(area, 'Geheimnisse als SecureString', secrets.join(', '))
      : fail(
          area,
          'Geheimnisse als SecureString',
          'mittel',
          `nicht SecureString oder fehlt: ${plainSecrets.join(', ')}`,
        ),
  ];
}

/** Altlasten aus früheren Entwürfen und ein GitHub-OIDC-Zugang (GitHub hat keinen AWS-Zugang, CLAUDE.md). */
export function checkLegacyAccess(
  roles: { Roles?: { RoleName?: string }[] } | undefined,
  oidc: { OpenIDConnectProviderList?: { Arn?: string }[] } | undefined,
): SecurityResult[] {
  const area = 'IAM';
  if (!roles || !oidc) return [unknown(area, 'Rollen und OIDC-Provider')];
  const legacy = (roles.Roles ?? [])
    .map((r) => r.RoleName ?? '')
    .filter((n) => /^NinaPm(DbBootstrap|Github|OpsInvoker|SchedulerInvoke)/i.test(n));
  const github = (oidc.OpenIDConnectProviderList ?? []).filter((p) =>
    /token\.actions\.githubusercontent\.com/.test(p.Arn ?? ''),
  );
  return [
    legacy.length === 0
      ? pass(area, 'Keine Altrollen aus früheren Entwürfen')
      : fail(area, 'Keine Altrollen aus früheren Entwürfen', 'mittel', legacy.join(', ')),
    github.length === 0
      ? pass(area, 'Kein GitHub-OIDC-Zugang')
      : fail(
          area,
          'Kein GitHub-OIDC-Zugang',
          'mittel',
          'GitHub-Actions können Rollen übernehmen – laut CLAUDE.md nicht vorgesehen',
        ),
  ];
}

/** Genau eine NINA-PM-API, keine eigenen Domains (sonst ein zweiter Weg am Origin-Schutz vorbei). */
export function checkApiInventory(
  apis: { Items?: { Name?: string; ApiId?: string }[] } | undefined,
  domains: { Items?: { DomainName?: string }[] } | undefined,
  apiId: string,
): SecurityResult {
  const area = 'API Gateway';
  if (!apis) return unknown(area, 'APIs');
  const others = (apis.Items ?? [])
    .filter((a) => /nina-pm/i.test(a.Name ?? '') && a.ApiId !== apiId)
    .map((a) => a.ApiId);
  const custom = (domains?.Items ?? [])
    .filter((d) => /nina-pm/i.test(d.DomainName ?? ''))
    .map((d) => d.DomainName);
  return others.length === 0 && custom.length === 0
    ? pass(area, 'Nur die eine NINA-PM-API, keine eigene Domain', apiId)
    : fail(
        area,
        'Nur die eine NINA-PM-API, keine eigene Domain',
        'mittel',
        [...others, ...custom].join(', '),
      );
}

/** Keine weiteren `svenesis-nina-pm-*`-Buckets, kein CORS am Daten-Bucket. */
export function checkBucketInventory(
  buckets: { Buckets?: { Name?: string }[] } | undefined,
  known: readonly string[],
  dataCors: { CORSRules?: unknown[] } | undefined,
): SecurityResult[] {
  const area = 'S3';
  if (!buckets) return [unknown(area, 'Buckets')];
  const extra = (buckets.Buckets ?? [])
    .map((b) => b.Name ?? '')
    .filter((n) => n.startsWith('svenesis-nina-pm') && !known.includes(n));
  return [
    extra.length === 0
      ? pass(area, 'Keine weiteren NINA-PM-Buckets')
      : fail(area, 'Keine weiteren NINA-PM-Buckets', 'niedrig', extra.join(', ')),
    (dataCors?.CORSRules ?? []).length === 0
      ? pass(area, 'Kein CORS am Daten-Bucket')
      : fail(
          area,
          'Kein CORS am Daten-Bucket',
          'niedrig',
          `${String(dataCors?.CORSRules?.length)} Regeln`,
        ),
  ];
}

/** Zeitpläne der Gruppe `nina-pm`: nur der worker als Ziel. */
export function checkSchedules(
  schedules: { Schedules?: { Name?: string; Target?: { Arn?: string } }[] } | undefined,
  workerArn: string,
): SecurityResult {
  const area = 'EventBridge Scheduler';
  if (!schedules) return unknown(area, 'Zeitpläne');
  const foreign = (schedules.Schedules ?? [])
    .filter((s) => !(s.Target?.Arn ?? '').startsWith(workerArn))
    .map((s) => s.Name);
  return foreign.length === 0
    ? pass(
        area,
        'Zeitpläne rufen nur den worker auf',
        `${String(schedules.Schedules?.length ?? 0)} Zeitpläne`,
      )
    : fail(area, 'Zeitpläne rufen nur den worker auf', 'mittel', foreign.join(', '));
}

export function checkLogRetention(
  groups: { logGroups?: { logGroupName?: string; retentionInDays?: number }[] } | undefined,
): SecurityResult {
  const area = 'CloudWatch Logs';
  if (!groups) return unknown(area, 'Aufbewahrung');
  const forever = (groups.logGroups ?? [])
    .filter((g) => !g.retentionInDays)
    .map((g) => g.logGroupName);
  return forever.length === 0
    ? pass(area, 'Aufbewahrung begrenzt', `${String(groups.logGroups?.length ?? 0)} Gruppen`)
    : fail(area, 'Aufbewahrung begrenzt', 'niedrig', `unbegrenzt: ${forever.join(', ')}`);
}

export function checkQueuePolicy(name: string, policy: string | undefined): SecurityResult {
  const area = `SQS ${name}`;
  const open = policyStatements(policy).filter(
    (s) => s.Effect === 'Allow' && principalIsAnyone(s.Principal),
  );
  return open.length === 0
    ? pass(area, 'Warteschlange nicht öffentlich')
    : fail(
        area,
        'Warteschlange nicht öffentlich',
        'hoch',
        `${String(open.length)} offene Anweisungen`,
      );
}

export function reportMarkdown(
  results: readonly SecurityResult[],
  meta: { at: string; commit: string; account?: string },
): string {
  const bad = results.filter((r) => !r.ok);
  const order: Severity[] = ['hoch', 'mittel', 'niedrig', 'info'];
  bad.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  return [
    '# AWS-Sicherheitsprüfung (nur lesend)',
    '',
    `Lauf ${meta.at}, Commit ${meta.commit}${meta.account ? `, Konto ${meta.account}` : ''}. Erzeugt von \`pnpm security:check\` – nur lesende AWS-Aufrufe, keine geheimen Werte im Protokoll.`,
    '',
    `**${String(results.length - bad.length)} von ${String(results.length)} Punkten grün.**${bad.length ? ` Offen: ${String(bad.filter((b) => b.severity === 'hoch').length)} hoch, ${String(bad.filter((b) => b.severity === 'mittel').length)} mittel, ${String(bad.filter((b) => b.severity === 'niedrig').length)} niedrig.` : ''}`,
    '',
    ...(bad.length
      ? [
          '## Offen',
          '',
          '| Schwere | Bereich | Punkt | Detail |',
          '|---|---|---|---|',
          ...bad.map(
            (r) => `| ${r.severity} | ${r.area} | ${r.name} | ${r.detail.replace(/\|/g, '\\|')} |`,
          ),
          '',
        ]
      : []),
    '## Alle Punkte',
    '',
    '| Bereich | Punkt | Ergebnis | Detail |',
    '|---|---|---|---|',
    ...results.map(
      (r) => `| ${r.area} | ${r.name} | ${r.ok ? '☑' : '☐'} | ${r.detail.replace(/\|/g, '\\|')} |`,
    ),
    '',
  ].join('\n');
}
