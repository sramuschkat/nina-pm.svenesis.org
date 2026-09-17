# Spezifikation: IAM, Least Privilege und Rand-Konfiguration

Verbindlich für AP-02a, AP-02b, AP-03, AP-05, AP-17. Bezug: Technisches Konzept 4.1, 4.2, 4.3, 5.4, 6.5, 7.1, 15, 16; Sicherheits-Review vom 17.09.2026 (SEC-1 … SEC-30).
**Grundsatz:** Jede Lambda hat **ihre eigene** Ausführungsrolle mit **ressourcengenauen** Rechten. Kein `"Resource": "*"` außer bei Aktionen, die es nicht anders können (`ssm:DescribeParameters`, `logs:CreateLogGroup` – beide werden von CDK erzeugt und sind hier nicht aufgeführt). Wo ein Recht nicht in diesem Dokument steht, wird es **nicht** vergeben; fehlt eines, wird es hier ergänzt, nicht im Code erweitert.

Platzhalter: `<acct>` = Konto-ID, `<cid>` = DSQL-Cluster-Identifikator (Stack-Ausgang `NinaPm-Data`), `<ssmKeyId>` = Schlüssel-ID von `alias/nina-pm-ssm`. Region ist überall `eu-central-1`.

## 1. Rollenübersicht

| Rolle | Trägt | DB-Rolle | Angelegt in |
|---|---|---|---|
| `NinaPmApi` | Lambda `api` | `app_rw` | `NinaPm-Api` |
| `NinaPmWorker` | Lambda `worker` | `app_job` | `NinaPm-Jobs` |
| `NinaPmMigrate` | Lambda `migrate` | `app_migrate` | `NinaPm-Migrate` |
| `NinaPmDbBootstrap` | Lambda `db-bootstrap` (einmalig, **kein** Trigger) | `admin` | `NinaPm-Migrate` |
| `NinaPmOpsCli` | Lambda `ops-cli` | `app_rw` | `NinaPm-Ops` |
| `NinaPmOpsInvoker` | Mensch (MFA) → ruft `ops-cli` und `db-bootstrap` | – | `NinaPm-Bootstrap` |
| `NinaPmSchedulerInvoke` | EventBridge Scheduler → `worker` | – | `NinaPm-Jobs` |
| `NinaPmGithubDeploy` | GitHub-OIDC → CDK-Bootstrap-Rollen | – | `NinaPm-Bootstrap` |
| `NinaPmGithubCiDsql` | GitHub-OIDC → CI-DSQL-Cluster (`purpose=ci`) | `admin` (nur CI-Cluster) | `NinaPm-Bootstrap` |
| `NinaPmDeployBoundary` | Politik der CloudFormation-Ausführungsrolle | – | `cdk bootstrap` (H-04) |

**Es gibt keine Rolle `NinaPmDbAccess` und keine DB-Rolle `app_ro`** (Schema 1.11, SEC-4/SEC-12). Wer lesend auf die Datenbank will, nimmt `NinaPmOpsInvoker` → `ops-cli`.

## 2. Ausführungsrolle `NinaPmApi` (Lambda `api`)

```json
{ "Version": "2012-10-17", "Statement": [
  { "Sid": "Dsql", "Effect": "Allow", "Action": "dsql:DbConnect",
    "Resource": "arn:aws:dsql:eu-central-1:<acct>:cluster/<cid>" },

  { "Sid": "SsmRead", "Effect": "Allow", "Action": ["ssm:GetParameter", "ssm:GetParameters"],
    "Resource": [
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/discord/client-id",
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/discord/client-secret",
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/jwt/signing-keys",
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/origin-verify",
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/origin-verify-prev",
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/dsql-endpoint",
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/bootstrap-super-users" ] },

  { "Sid": "SsmTenantWebhooks", "Effect": "Allow",
    "Action": ["ssm:GetParameter", "ssm:PutParameter", "ssm:DeleteParameter"],
    "Resource": "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/tenants/*/discord/*" },

  { "Sid": "Kms", "Effect": "Allow", "Action": ["kms:Decrypt", "kms:Encrypt", "kms:DescribeKey"],
    "Resource": "arn:aws:kms:eu-central-1:<acct>:key/<ssmKeyId>",
    "Condition": { "StringEquals": { "kms:ViaService": "ssm.eu-central-1.amazonaws.com" } } },

  { "Sid": "DataBucket", "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject"],
    "Resource": "arn:aws:s3:::svenesis-nina-pm-data/tenant/*" },

  { "Sid": "InvokeWorkerOnly", "Effect": "Allow", "Action": "lambda:InvokeFunction",
    "Resource": "arn:aws:lambda:eu-central-1:<acct>:function:nina-pm-worker" },

  { "Sid": "NeverWriteTheseSecrets", "Effect": "Deny",
    "Action": ["ssm:PutParameter", "ssm:DeleteParameter"],
    "Resource": [
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/jwt/*",
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/bootstrap-super-users",
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/origin-verify",
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/origin-verify-prev" ] }
]}
```

Bewusst **nicht** enthalten: `s3:DeleteObject` (die Lebenszyklusregeln löschen, 12), `s3:ListBucket` (Mandantenschlüssel sollen nicht auflistbar sein), jeder Zugriff auf den Web-Bucket, `sqs:*`, `lambda:InvokeFunction` auf etwas anderes als `worker` (SEC-7: der Weg zu `ops-cli` wäre sonst offen).

## 3. Ausführungsrolle `NinaPmWorker` (Lambda `worker`)

```json
{ "Version": "2012-10-17", "Statement": [
  { "Sid": "Dsql", "Effect": "Allow", "Action": "dsql:DbConnect",
    "Resource": "arn:aws:dsql:eu-central-1:<acct>:cluster/<cid>" },

  { "Sid": "SsmRead", "Effect": "Allow", "Action": ["ssm:GetParameter", "ssm:GetParameters"],
    "Resource": [
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/dsql-endpoint",
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/system/alarm-webhook",
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/web/build-id" ] },
  { "Sid": "SsmTenantWebhooksRead", "Effect": "Allow", "Action": "ssm:GetParameter",
    "Resource": "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/tenants/*/discord/*" },

  { "Sid": "Kms", "Effect": "Allow", "Action": ["kms:Decrypt", "kms:DescribeKey"],
    "Resource": "arn:aws:kms:eu-central-1:<acct>:key/<ssmKeyId>",
    "Condition": { "StringEquals": { "kms:ViaService": "ssm.eu-central-1.amazonaws.com" } } },

  { "Sid": "DataBucket", "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject"],
    "Resource": "arn:aws:s3:::svenesis-nina-pm-data/tenant/*" },
  { "Sid": "DataBucketHead", "Effect": "Allow", "Action": "s3:GetObjectAttributes",
    "Resource": "arn:aws:s3:::svenesis-nina-pm-data/tenant/*" },

  { "Sid": "WebThumbs", "Effect": "Allow", "Action": "s3:PutObject",
    "Resource": "arn:aws:s3:::svenesis-nina-pm-web/catalog/thumbs/*" },
  { "Sid": "WebAssetsList", "Effect": "Allow", "Action": "s3:ListBucket",
    "Resource": "arn:aws:s3:::svenesis-nina-pm-web",
    "Condition": { "StringLike": { "s3:prefix": "assets/*" } } },
  { "Sid": "WebAssetsDelete", "Effect": "Allow", "Action": "s3:DeleteObject",
    "Resource": "arn:aws:s3:::svenesis-nina-pm-web/assets/*" },

  { "Sid": "OnFailureQueue", "Effect": "Allow", "Action": "sqs:SendMessage",
    "Resource": "arn:aws:sqs:eu-central-1:<acct>:nina-pm-worker-failures" },

  { "Sid": "NoAppSecrets", "Effect": "Deny", "Action": "ssm:*",
    "Resource": [
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/jwt/*",
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/discord/client-secret",
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/bootstrap-super-users" ] },
  { "Sid": "NoInvoke", "Effect": "Deny", "Action": "lambda:InvokeFunction", "Resource": "*" }
]}
```

- Das `Deny` auf `lambda:InvokeFunction` ist Absicht: `worker` ruft nie eine Lambda auf, und ein spätes „nur mal schnell“ soll am Deploy scheitern.
- Das `Deny` auf die Anwendungsgeheimnisse verhindert insbesondere, dass `worker` den JWT-Signierschlüssel liest und sich eigene Access-Tokens ausstellt (SEC-5).
- Der `weekly`-Aufräumjob braucht `ListBucket` nur mit dem Präfix `assets/` – damit sind die Mandantenschlüssel im Daten-Bucket weiterhin nicht auflistbar.
- `s3:GetObjectAttributes` braucht der Ingest der Ergebnisdateien, um Größe und Typ vor dem Parsen zu prüfen (SEC-23).

## 4. `NinaPmMigrate` und `NinaPmDbBootstrap` (SEC-1)

| Rolle | Rechte | Aufruf |
|---|---|---|
| `NinaPmMigrate` | `dsql:DbConnect` auf den Cluster (DB-Rolle `app_migrate`) · `ssm:GetParameter` auf `/nina-pm/dsql-endpoint` · `kms:Decrypt` wie oben | CDK-`triggers.Trigger` bei jedem Deploy, **vor** `NinaPm-Api`/`NinaPm-Jobs` (unverändert) |
| `NinaPmDbBootstrap` | `dsql:DbConnectAdmin` auf den Cluster · `ssm:GetParameter` auf `/nina-pm/dsql-endpoint` · `kms:Decrypt` | **kein** Trigger, keine Route; einmalig `aws lambda invoke` durch `NinaPmOpsInvoker` (menschliche Aufgabe H-25) |

- **Migration 0000** (Rollen `app_rw`, `app_job`, `app_migrate` anlegen, `AWS IAM GRANT` setzen, `GRANT USAGE/CREATE ON SCHEMA`) läuft **ausschließlich** in `db-bootstrap`. Der Lauf ist idempotent (`CREATE ROLE … IF NOT EXISTS`-Ersatz über Existenzprüfung) und darf beliebig oft wiederholt werden.
- **`migrate` prüft beim Start nur**, ob die drei Rollen und die beiden `AWS IAM GRANT`s vorhanden sind. Fehlt etwas: Abbruch mit `db.bootstrap_missing` und der Meldung „`db-bootstrap` einmalig ausführen (H-25)“. `migrate` versucht **nie**, Rollen oder Grants anzulegen – dafür hat es keine Rechte.
- Ressourcenbasierte Politik auf `nina-pm-db-bootstrap`: nur `arn:aws:iam::<acct>:role/NinaPmOpsInvoker` als Principal.
- Neue `GRANT`s je Tabelle (`app_rw`, `app_job`) liegen weiterhin in der jeweiligen Tabellen-Migration und laufen als `app_migrate` – dafür genügt `GRANT … ON <t>` durch den Eigentümer `app_migrate`.

## 5. `NinaPmOpsCli` und `NinaPmOpsInvoker` (SEC-9)

Vertrauensbeziehung von `NinaPmOpsInvoker` – **MFA ist Pflicht**:

```json
{ "Version": "2012-10-17", "Statement": [{
  "Effect": "Allow", "Principal": { "AWS": "arn:aws:iam::<acct>:root" },
  "Action": "sts:AssumeRole",
  "Condition": {
    "Bool": { "aws:MultiFactorAuthPresent": "true" },
    "NumericLessThan": { "aws:MultiFactorAuthAge": "3600" } } }]}
```

Rechte von `NinaPmOpsInvoker` – nur zwei Funktionen, sonst nichts:

```json
{ "Version": "2012-10-17", "Statement": [{
  "Effect": "Allow", "Action": "lambda:InvokeFunction",
  "Resource": [
    "arn:aws:lambda:eu-central-1:<acct>:function:nina-pm-ops-cli",
    "arn:aws:lambda:eu-central-1:<acct>:function:nina-pm-db-bootstrap" ] }]}
```

Ausführungsrolle `NinaPmOpsCli`: `dsql:DbConnect` (DB-Rolle `app_rw`) · `ssm:GetParameter` auf `/nina-pm/dsql-endpoint` · `kms:Decrypt` · `sqs:ReceiveMessage`/`DeleteMessage` auf `nina-pm-worker-failures` (Befehl `list-failed-jobs`, SEC-8) · `sns:Publish` auf das Alarm-Topic. Nichts weiter.

**Selbstmeldung (verbindlich):** Jeder `ops-cli`-Aufruf schreibt `system_audit` mit `actor = 'ops_cli'` **und** dem IAM-Principal aus dem Aufrufkontext **und** sendet `sns:Publish` an das Alarm-Topic („Notfallzugang benutzt: `<befehl>` durch `<principal>`“). Ein Notfallzugang, der still benutzt werden kann, ist keiner. Die ressourcenbasierte Politik auf `nina-pm-ops-cli` lässt nur `NinaPmOpsInvoker` zu.

## 6. `NinaPmSchedulerInvoke` (EventBridge Scheduler, SEC-10)

```json
{ "Version": "2012-10-17", "Statement": [{
  "Effect": "Allow", "Action": "lambda:InvokeFunction",
  "Resource": "arn:aws:lambda:eu-central-1:<acct>:function:nina-pm-worker" }]}
```

Vertrauensbeziehung: Principal `scheduler.amazonaws.com` mit Bedingung

```json
{ "StringEquals": { "aws:SourceAccount": "<acct>" },
  "ArnLike": { "aws:SourceArn": "arn:aws:scheduler:eu-central-1:<acct>:schedule/nina-pm/*" } }
```

Ohne `aws:SourceArn` ist die Rolle ein Confused-Deputy-Kandidat: jeder Zeitplan im Konto könnte sie benutzen. Alle vier Zeitpläne liegen in der Scheduler-Gruppe `nina-pm` und teilen diese eine Rolle.

## 7. Deploy-Rollen (SEC-3, SEC-22)

### 7.1 `NinaPmGithubDeploy`

Vertrauensbeziehung wie bisher (GitHub-OIDC, nur Repo + Environment `prod`). Rechte **ausschließlich**:

```json
{ "Version": "2012-10-17", "Statement": [
  { "Sid": "AssumeCdkRolesOnly", "Effect": "Allow", "Action": "sts:AssumeRole",
    "Resource": "arn:aws:iam::<acct>:role/cdk-*-role-<acct>-eu-central-1",
    "Condition": { "StringEquals": { "iam:ResourceTag/aws-cdk:bootstrap-role":
      ["deploy", "file-publishing", "image-publishing", "lookup"] } } },
  { "Sid": "DiffOnly", "Effect": "Allow",
    "Action": ["cloudformation:DescribeStacks", "cloudformation:GetTemplate"],
    "Resource": "arn:aws:cloudformation:*:<acct>:stack/NinaPm-*/*" }
]}
```

Keine direkten Service-Rechte. Alles Weitere macht die CloudFormation-Ausführungsrolle – und die ist durch 7.2 begrenzt.

### 7.2 `NinaPmDeployBoundary` (Politik der CloudFormation-Ausführungsrolle)

`cdk bootstrap` wird mit `--cloudformation-execution-policies arn:aws:iam::<acct>:policy/NinaPmDeployBoundary` ausgeführt (H-04), **nicht** mit dem Standard `AdministratorAccess`.

**Erlaubt:** `cloudformation:*` · `lambda:*` · `apigateway:*` · `logs:*` · `events:*` · `scheduler:*` · `sqs:*` · `sns:*` · `cloudwatch:*` · `acm:*` · `cloudfront:*` · `route53:*` · `backup:*` · `dsql:*` · `s3:*` (nur `svenesis-nina-pm-*` und der CDK-Assets-Bucket) · `ssm:GetParameter*`, `ssm:PutParameter`, `ssm:AddTagsToResource` (nur `/nina-pm/*`) · `kms:*` (nur `alias/nina-pm-ssm`) · `iam:*` (nur `arn:aws:iam::<acct>:role/NinaPm*` und `policy/NinaPm*`) · `cloudtrail:*` (nur `nina-pm-*`).

**Verweigert – das ist der Kern der Politik:**

```json
{ "Version": "2012-10-17", "Statement": [
  { "Sid": "NeverTouchWebsiteDistribution", "Effect": "Deny",
    "Action": ["cloudfront:UpdateDistribution", "cloudfront:DeleteDistribution",
               "cloudfront:CreateInvalidation", "cloudfront:TagResource",
               "cloudfront:UntagResource"],
    "Resource": "arn:aws:cloudfront::<acct>:distribution/E2L6Q80SD8XPT0" },

  { "Sid": "OnlyNinaPmDnsNames", "Effect": "Deny",
    "Action": "route53:ChangeResourceRecordSets", "Resource": "*",
    "Condition": { "ForAnyValue:StringNotLike": {
      "route53:ChangeResourceRecordSetsNormalizedRecordNames":
        ["nina-pm.svenesis.org", "*.nina-pm.svenesis.org", "_*.nina-pm.svenesis.org"] } } },

  { "Sid": "NoDataDestruction", "Effect": "Deny",
    "Action": ["dsql:DeleteCluster", "backup:DeleteRecoveryPoint", "backup:DeleteBackupVault",
               "backup:DeleteBackupVaultAccessPolicy", "backup:DisableVaultLock",
               "s3:DeleteBucket", "kms:ScheduleKeyDeletion", "kms:DisableKey"],
    "Resource": "*" },

  { "Sid": "NoForeignIam", "Effect": "Deny", "Action": "iam:*",
    "NotResource": ["arn:aws:iam::<acct>:role/NinaPm*", "arn:aws:iam::<acct>:policy/NinaPm*"] },

  { "Sid": "NoWebsiteBuckets", "Effect": "Deny", "Action": "s3:*",
    "Resource": ["arn:aws:s3:::www.svenesis.org", "arn:aws:s3:::www.svenesis.org/*",
                 "arn:aws:s3:::svenesis.org", "arn:aws:s3:::svenesis.org/*"] },

  { "Sid": "NoSuperUserBootstrapWrite", "Effect": "Deny",
    "Action": ["ssm:PutParameter", "ssm:DeleteParameter"],
    "Resource": "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/bootstrap-super-users" }
]}
```

Damit ist die Leitplanke „die Website-Distribution wird nie verändert“ (TK 1.1, 4.5) technisch durchgesetzt statt nur beschrieben. Cluster, Sicherungen und den KMS-Schlüssel löscht nur ein Mensch mit Adminrechten – so wie es das Restore-Runbook ohnehin vorsieht. Der Super-User-Bootstrap-Parameter bleibt dem Deploy entzogen (SEC-21).

### 7.3 `NinaPmGithubCiDsql` (unverändert, hier nur zur Vollständigkeit)

Environment `ci`; `dsql:CreateCluster` nur mit `aws:RequestTag/purpose = ci`, `dsql:DeleteCluster`/`dsql:DbConnectAdmin` nur mit `aws:ResourceTag/purpose = ci`, explizites `Deny` auf `dsql:TagResource`/`dsql:UntagResource` fremder Ressourcen (DAT-16).

## 8. KMS-Schlüssel für Geheimnisse (SEC-6)

Ein kundenverwalteter Schlüssel `alias/nina-pm-ssm` (≈ 1 $/Monat) ersetzt `alias/aws/ssm` für alle SecureString-Parameter unter `/nina-pm/*`. Grund: die Schlüsselpolitik begrenzt den Zugriff **zweiseitig** – ein neuer Lambda-Nachbar im Konto kommt selbst mit `ssm:GetParameter` nicht an die Werte.

Schlüsselpolitik (Auszug): `kms:Decrypt` für `NinaPmApi`, `NinaPmWorker`, `NinaPmMigrate`, `NinaPmDbBootstrap`, `NinaPmOpsCli`; `kms:Encrypt` zusätzlich für `NinaPmApi` (schreibt Mandanten-Webhooks); Verwaltung (`kms:Create*`, `kms:Put*`, `kms:Enable*`) nur für die CloudFormation-Ausführungsrolle; `kms:ScheduleKeyDeletion` für niemanden (7.2). Rotation eingeschaltet (jährlich, automatisch).

Die Rollen-Anweisungen tragen zusätzlich die Bedingung `kms:ViaService = ssm.eu-central-1.amazonaws.com`, damit der Schlüssel nur über Parameter Store und nicht direkt benutzt werden kann.

## 9. API Gateway und Lambda-Parallelität (SEC-15, SEC-17, SEC-18, SEC-24)

| Einstellung | Wert | Begründung |
|---|---|---|
| Stage-Drosselung `$default` | 50 rps / Burst 100 | unverändert |
| Route `ANY /api/nina/v1/{proxy+}` | 20 rps / Burst 40 | unverändert; **zusätzlich** Zählung je `nina_instance` in der Middleware (unten) |
| Route `ANY /api/auth/{proxy+}` | **5 rps / Burst 10** | bremst **vor** dem `login_audit`-Zugriff; die Zählung in der Datenbank bleibt als zweite Stufe |
| Route `GET /api/health` | **1 rps / Burst 2** | die Route macht einen DB-Ping und ist öffentlich |
| Route `GET /api/health/shallow` | 200 rps | Route-53-Check aus drei Regionen im 60-s-Takt |
| Reservierte Parallelität `api` | **20** | begrenzt Kosten, DSQL-Verbindungen (Pool 2 je Container ⇒ höchstens 40) und verhindert, dass Browser-Last den Nachtbetrieb verdrängt |
| Reservierte Parallelität `worker` | **5** | Jobs sind idempotent und dürfen nachlaufen |
| Zugriffsprotokoll HTTP API | JSON mit `requestId`, `routeKey`, `status`, `integrationLatency`, `ip` (auf /24 bzw. /48 gekürzt) | ohne Protokoll ist ein Direktaufruf der `execute-api`-Adresse nicht messbar |

**Ressourcenpolitik und WAF (entschieden, 17.09.2026):** Eine HTTP API (API Gateway v2) unterstützt **keine** Ressourcenpolitik und **keine** WAF-Bindung – niemand soll danach suchen. **AWS WAF wird auch nicht an der CloudFront-Distribution eingesetzt** (Entscheidung gegen ≈ 6 $/Monat bei einem Budget von 20 €/Monat und einer Handvoll bekannter Nutzer). Der Schutz gegen Direktaufrufe und Lastspitzen ist damit **endgültig vierteilig** und muss ohne WAF tragen:

1. `X-Origin-Verify` in der Middleware gegen beide SSM-Werte (TK 5.3) – jeder Aufruf ohne den Header endet mit 403, bevor irgendeine Fachlogik läuft.
2. Drosselung auf Stage- und Routenebene (Tabelle oben), besonders eng für `/api/auth/*` und `/api/health`.
3. **Reservierte Parallelität** auf `api` (20) und `worker` (5) – sie begrenzt Kosten und DSQL-Verbindungen auch dann, wenn die Drosselung umgangen würde.
4. Budget-Alarm bei 20 €/Monat und Alarm auf `Throttles` der `api`-Lambda (TK 16.2) – so fällt ein Dauerangriff innerhalb von Stunden auf, statt erst auf der Monatsrechnung.

Wird die Anwendung später öffentlich verlinkt oder wächst die Nutzerzahl deutlich, ist WAF an der CloudFront-Distribution (ratenbasierte Regel + `AWSManagedRulesCommonRuleSet`) der erste Schritt – bis dahin ist die Frage entschieden und offen bleibt nichts.

**Drosselung je NINA-Instanz (Middleware, SEC-18):** Gleitendes Fenster, **120 Aufrufe je Minute je `nina_instance`** (ein Rig braucht im Normalbetrieb < 10). Überschreitung → `429` mit `Retry-After: 60` und Fehlercode `auth.rate_limited`; Metrik `NinaThrottled`; Alarm, wenn sie über 15 min > 0 ist. Ohne diese Zählung teilen sich alle Rigs aller Mandanten die 20 rps der Route, und ein einzelnes fehlkonfiguriertes Plugin verdirbt die Nacht aller anderen. Die Outbox des Plugins behandelt `429` bereits mit Backoff (`specs/nina/execution.md` §8).

**`GET /api/health` (SEC-17):** Der DB-Ping läuft **nur**, wenn der Aufruf den Header `X-NPM-Deep` mit einem der beiden Origin-Verify-Werte trägt; ohne ihn antwortet die Route wie `/api/health/shallow` (Status + `ENGINE_VERSION`, kein Datenbankzugriff). Der Route-53-Health-Check nutzt ausschließlich `/api/health/shallow` über CloudFront.

## 10. CloudFront: Header-Politiken (SEC-2, SEC-16, SEC-25)

Es gibt **zwei** Response-Headers-Policies, und **jedes** der vier Behaviors trägt eine:

| Behavior | Politik |
|---|---|
| `/api/*` | `npm-api-static` |
| `/catalog/*` | `npm-api-static` |
| `/downloads/*` | `npm-api-static` |
| Default `*` | `npm-html` |

### `npm-html` (nur Default-Behavior)

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https://alasky.cds.unistra.fr https://cdn.discordapp.com
          https://svenesis-nina-pm-data.s3.eu-central-1.amazonaws.com;
  connect-src 'self' https://alasky.cds.unistra.fr
          https://svenesis-nina-pm-data.s3.eu-central-1.amazonaws.com;
  worker-src 'self' blob:;
  font-src 'self';
  object-src 'none';
  base-uri 'none';
  form-action 'self';
  frame-src 'none';
  frame-ancestors 'none';
  upgrade-insecure-requests
Strict-Transport-Security: max-age=63072000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
Cross-Origin-Opener-Policy: same-origin
```

- **`style-src 'self' 'unsafe-inline'` ist Pflicht, nicht Bequemlichkeit (SEC-2):** Radix UI positioniert Popover, Dialog, Menü und Tooltip über Inline-`style`-Attribute. Ohne `'unsafe-inline'` in `style-src` blockiert der Browser genau diese Attribute, und die Oberfläche bricht beim ersten Popover – sichtbar erst in prod, weil lokal keine CloudFront-Header gesetzt werden. Für **Skripte** bleibt `'unsafe-inline'` verboten (Go-live-Checkliste).
- `base-uri` und `form-action` erben **nicht** von `default-src` und müssen deshalb einzeln dastehen.
- `worker-src 'self' blob:` deckt den Comlink-Worker in beiden Vite-Ausgabeformen ab.
- **Abnahme:** ein Playwright-Test startet die gebaute SPA hinter einem Proxy, der genau diese Header setzt, öffnet ein Radix-Menü und ein Dialog und prüft, dass die Browserkonsole keine CSP-Verstöße meldet.

### `npm-api-static` (`/api/*`, `/catalog/*`, `/downloads/*`)

Dieselben Header **ohne** `Content-Security-Policy` (eine CSP auf JSON-Antworten hat keine Wirkung, aber `nosniff` und HSTS sehr wohl), zusätzlich `Cross-Origin-Resource-Policy: same-origin`. Besonders `/downloads/*` liefert JSON-Beispielsequenzen und `/api/*` Problem-Details-JSON – beides sind ohne `nosniff` MIME-Sniffing-Kandidaten.

## 11. Sicherungen und Nachvollziehbarkeit (SEC-19, SEC-20)

- **Backup-Vault `nina-pm-prod`** (eigener Vault, nicht der Standard) mit **Vault Lock im Governance-Modus**: Löschen von Wiederherstellungspunkten ist nur mit `backup:DisableVaultLock` möglich, und dieses Recht hat ausschließlich ein Mensch mit Adminrechten (7.2 verweigert es der Deploy-Rolle). Vault-Zugriffspolitik verweigert `backup:DeleteRecoveryPoint` allen Principalen außer `arn:aws:iam::<acct>:role/NinaPmOpsInvoker`.
- **CloudTrail `nina-pm-management`**: ein Trail für Verwaltungsereignisse (erstes Exemplar je Konto kostenfrei), Ziel `svenesis-nina-pm-data/audit/` mit Lebenszyklus 400 Tage und `s3:PutObject`-Politik nur für `cloudtrail.amazonaws.com`. Ohne Trail endet die Nachvollziehbarkeit genau dort, wo AWS-Zugriffe anfangen – der `system_audit` der Anwendung sieht keinen `ops-cli`-Aufruf von außen und kein `ssm:PutParameter`.
- **Metrikfilter + Alarm** auf dem Trail-Log für: `Invoke` auf `nina-pm-ops-cli` oder `nina-pm-db-bootstrap` · `PutParameter` unter `/nina-pm/jwt/*` oder `/nina-pm/bootstrap-super-users` · `DeleteCluster`/`DisableVaultLock` (darf nie vorkommen).
- **Log-Aufbewahrung:** `api` und `ops-cli` **400 Tage** (passend zu `login_audit` mit 12 Monaten, TK 13), `worker`, `migrate` und `db-bootstrap` 90 Tage. Alle Log-Gruppen mit `alias/nina-pm-ssm` verschlüsselt.

## 12. Pflicht-Tests (CDK-Assertions, AP-02a/AP-02b)

1. Keine Ausführungsrolle enthält eine `Allow`-Anweisung mit `"Resource": "*"` außer den in §1 genannten Ausnahmen (Test über den synthetisierten Template-Baum).
2. `NinaPmApi` hat genau **einen** `lambda:InvokeFunction`-Eintrag und dieser zeigt auf `nina-pm-worker`.
3. `NinaPmWorker` enthält kein `Allow` mit `ssm:`-Zugriff auf `jwt/`, `discord/client-secret` oder `bootstrap-super-users`.
4. `NinaPmMigrate` enthält **kein** `dsql:DbConnectAdmin`; `NinaPmDbBootstrap` hat **keinen** CDK-`Trigger` und keine Ereignisquelle.
5. Jedes der vier CloudFront-Behaviors hat eine Response-Headers-Policy; die Politik des Default-Behaviors enthält `style-src` mit `'unsafe-inline'` und `script-src` **ohne** `'unsafe-inline'`.
6. `api` und `worker` haben `reservedConcurrentExecutions` gesetzt.
7. Die Route-53-Konstrukte legen ausschließlich Einträge mit dem Präfix `nina-pm` an (bestehende Assertion, bleibt).
8. `nina-pm-ops-cli` und `nina-pm-db-bootstrap` haben eine ressourcenbasierte Politik mit genau einem Principal.
