# Spezifikation: IAM, Least Privilege und Rand-Konfiguration

Verbindlich für AP-02a, AP-02b, AP-03, AP-05, AP-17. Bezug: Technisches Konzept 4.1, 4.2, 4.3, 5.4, 6.5, 7.1, 15, 16; Entscheidungsblatt „Security-Vereinfachung“ vom 21.09.2026 (SV-01 … SV-19), das die Fassung nach dem Sicherheits-Review vom 17.09.2026 ablöst.

**Leitlinie (SV, 21.09.2026):** Geschützt wird gegen Angreifer **von außen** (API, Web, Plugin-Schnittstelle). Dafür hat jede Lambda eine **eigene** Ausführungsrolle mit genau den Rechten, die sie braucht – das begrenzt den Schaden, falls eine öffentlich erreichbare Lambda kompromittiert wird. Das **Deployment ist nicht Teil der Sicherheitsarchitektur** (§7); innerhalb der Anwendung gilt Schutz gegen Versehen, nicht gegen böswillige Mitglieder.

**Regel (SV-13):** Rechte werden über **CDK-Grants** vergeben (`grantRead`, `grantPut`, `grantInvoke`, …), nicht über handgeschriebene JSON-Politiken; nur wo es keinen Grant gibt (DSQL), ergänzt ein `PolicyStatement` mit dem ARN aus dem Konstrukt. Verboten sind `*`-Ressourcen auf **DSQL, S3, SSM und `lambda:InvokeFunction`** sowie Managed Policies an den Anwendungsrollen (einzige Ausnahme: die von CDK standardmäßig angehängte `AWSLambdaBasicExecutionRole` für Logs; X-Ray per `tracing: ACTIVE` ist erlaubt). Braucht eine Lambda ein weiteres Recht, wird es in der Tabelle unten ergänzt und im selben PR per Grant vergeben. Keine expliziten `Deny`-Anweisungen in Lambda-Rollen.

Region ist überall `eu-central-1`. `dataBucket` = `svenesis-nina-pm-data`, `webBucket` = `svenesis-nina-pm-web`, Cluster = DSQL-Cluster aus `NinaPm-Data`.

## 1. Rollenübersicht

| Rolle | Trägt | DB-Rolle | Angelegt in |
|---|---|---|---|
| `NinaPmApi` | Lambda `api` | `app_rw` | `NinaPm-Api` |
| `NinaPmWorker` | Lambda `worker` | `app_job` | `NinaPm-Jobs` |
| `NinaPmMigrate` | Lambda `migrate` (CDK-`Trigger` bei jedem Deploy) | `admin` | `NinaPm-Migrate` |
| `NinaPmOpsCli` | Lambda `ops-cli` (nur `aws lambda invoke` mit Admin-Profil) | `app_rw` | `NinaPm-Ops` |
| von CDK erzeugt | EventBridge-Scheduler-Target → `worker` (§6) | – | `NinaPm-Jobs` |

- Die Namen der vier Anwendungsrollen sind fest (`roleName`), weil `AWS IAM GRANT` in Migration 0000 die Rollen-ARNs nennt.
- CDK-Hilfsrollen (Trigger-Provider, `BucketDeployment`, Log-Retention) entstehen automatisch und werden hier nicht aufgeführt.
- **Entfallen (SV-13, E1):** `NinaPmDbBootstrap`, `NinaPmOpsInvoker`, eigene Rolle `NinaPmSchedulerInvoke`, `NinaPmGithubDeploy`, `NinaPmGithubCiDsql`, `NinaPmGithubPlugin`, `NinaPmCloudTrailDelivery`, `NinaPmDeployBoundary`. Es gibt keine DB-Rollen `app_ro` und `app_migrate` (SV-14: `migrate` verbindet als `admin`).

## 2. `NinaPmApi` (Lambda `api`)

| Ressource | CDK-Grant | Zweck |
|---|---|---|
| DSQL-Cluster | `dsql:DbConnect` auf den Cluster-ARN (`PolicyStatement`, DSQL hat keinen Grant) | DB-Rolle `app_rw` |
| `dataBucket`, Präfix `tenant/*` | `dataBucket.grantRead(api, 'tenant/*')` · `dataBucket.grantPut(api, 'tenant/*')` | presigned POST/GET für Uploads und Downloads (TK 12) |
| Lambda `worker` | `worker.grantInvoke(api)` | Jobs asynchron starten – **einziges** Invoke-Recht der `api`, insbesondere keines auf `ops-cli` |
| SSM `/nina-pm/oauth/cookie-secret`, `/nina-pm/discord/client-id`, `/nina-pm/discord/client-secret`, `/nina-pm/origin-verify`, `/nina-pm/web/build-id`, `/nina-pm/dsql-endpoint`, `/nina-pm/bootstrap-super-users` | je Parameter `StringParameter.from…(…).grantRead(api)` | §8 |

Kein Zugriff auf `webBucket`, kein SSM-Schreibrecht (Discord-Webhooks liegen in der Datenbank, SV-10), kein SQS.

**Auflisten (hingenommen):** `grantRead` bzw. `grantReadWrite` (§3) bringen `s3:List*` auf den **ganzen** Daten-Bucket – das Präfix begrenzt nur den Objektzugriff. Nach einer Kompromittierung von `api` oder `worker` sind damit die Objektschlüssel aller Mandanten auflistbar. Das ist bewusst hingenommen, weil `app_rw` die Schlüssel ohnehin aus der Datenbank kennt und Lesen/Schreiben auf `tenant/*` begrenzt bleibt (TK 15.3).

## 3. `NinaPmWorker` (Lambda `worker`)

| Ressource | CDK-Grant | Zweck |
|---|---|---|
| DSQL-Cluster | `dsql:DbConnect` auf den Cluster-ARN (`PolicyStatement`) | DB-Rolle `app_job` |
| `dataBucket`, Präfix `tenant/*` | `dataBucket.grantReadWrite(worker, 'tenant/*')` | Importe und Ergebnisdateien lesen, Berichte schreiben |
| `webBucket`, Präfix `catalog/thumbs/*` | `webBucket.grantReadWrite(worker, 'catalog/thumbs/*')` | Vorschaubilder |
| `webBucket`, Präfix `assets/*` | `webBucket.grantRead(worker, 'assets/*')` · `webBucket.grantDelete(worker, 'assets/*')` | `weekly`-Aufräumjob alter Build-Assets |
| SQS `nina-pm-worker-failures` | entsteht durch `onFailure: new SqsDestination(queue)` (CDK vergibt `sqs:SendMessage`) | fehlgeschlagene asynchrone Aufrufe |
| SSM `/nina-pm/dsql-endpoint`, `/nina-pm/web/build-id`, optional `/nina-pm/system/alarm-webhook` | je Parameter `grantRead(worker)` | §8 |

**`worker` liest keine Auth-Geheimnisse:** kein Grant auf `/nina-pm/oauth/*`, `/nina-pm/discord/client-secret`, `/nina-pm/bootstrap-super-users` (Assertion 3). Kein `lambda:InvokeFunction` (Assertion 2). Grund für die eigene Rolle und die eigene DB-Rolle `app_job`: `worker` verarbeitet fremde Eingaben (Importe, Ergebnisdateien, Katalogabrufe), SV-14.

## 4. `NinaPmMigrate` (Lambda `migrate`)

| Ressource | CDK-Grant | Zweck |
|---|---|---|
| DSQL-Cluster | `dsql:DbConnectAdmin` auf den Cluster-ARN (`PolicyStatement`) | verbindet als `admin` |
| SSM `/nina-pm/dsql-endpoint` | `grantRead(migrate)` | Endpunkt |

- Aufruf ausschließlich als CDK-`triggers.Trigger` bei jedem Deploy, **vor** `NinaPm-Api`/`NinaPm-Jobs`. Keine Route, keine URL.
- `migrate` führt **Migration 0000 selbst und idempotent** aus (SV-13): DB-Rollen `app_rw` und `app_job` anlegen (Existenzprüfung in `pg_roles` statt `IF NOT EXISTS`), `AWS IAM GRANT app_rw` an `NinaPmApi` und `NinaPmOpsCli`, `AWS IAM GRANT app_job` an `NinaPmWorker` (vorher in `sys.iam_pg_role_mappings` prüfen). Kein `GRANT USAGE ON SCHEMA public` (DSQL: `0A000`, nicht nötig; AP-S1). Jede weitere Tabellen-Migration trägt ihre `GRANT`s an `app_rw`/`app_job` selbst (Vorlage am Ende von `schema_aurora_dsql.sql`).
- **Entfallen (SV-13, SV-14):** Lambda `db-bootstrap`, Rolle `NinaPmDbBootstrap`, H-25, Fehlercode `db.bootstrap_missing`, DB-Rolle `app_migrate`.

## 5. `NinaPmOpsCli` (Lambda `ops-cli`)

| Ressource | CDK-Grant | Zweck |
|---|---|---|
| DSQL-Cluster | `dsql:DbConnect` auf den Cluster-ARN (`PolicyStatement`) | DB-Rolle `app_rw` |
| SSM `/nina-pm/dsql-endpoint` | `grantRead(opsCli)` | Endpunkt |
| SQS `nina-pm-worker-failures` | `queue.grantConsumeMessages(opsCli)` | Befehl `list-failed-jobs` |

Aufruf **nur** per `aws lambda invoke --function-name nina-pm-ops-cli` durch Sven mit Admin-Profil; keine Route, keine Function-URL, keine ressourcenbasierte Politik, und **keine** andere Rolle erhält ein Invoke-Recht darauf (Assertion 2). Jeder Befehl schreibt eine Zeile `system_audit` mit Akteur `ops_cli` (SV-11). Befehlsumfang: TK 5 (SV-17). **Entfallen (SV-13):** `NinaPmOpsInvoker`, MFA-Vertrauensbeziehung, SNS-Selbstmeldung.

## 6. Scheduler (EventBridge)

Die vier Zeitpläne (Gruppe `nina-pm`, TK 13) nutzen das CDK-Target `LambdaInvoke` aus `aws-cdk-lib/aws-scheduler-targets` mit `worker` als Ziel. CDK legt die Aufrufrolle samt Vertrauensbeziehung selbst an und gibt ihr `lambda:InvokeFunction` nur auf `worker`; sie wird nicht von Hand nachgebaut (SV-13).

## 7. Deployment

Das Deployment ist **nicht Teil der Sicherheitsarchitektur** (SV-13, E1). Sven deployt lokal mit seinem Admin-Profil: Standard-`cdk bootstrap` in `eu-central-1` und `us-east-1` (ohne eigene Ausführungspolitik, ohne Rechtegrenze, H-04), danach `pnpm deploy:prod` (`cdk diff` → bei Migrationen On-Demand-Backup starten und abwarten → `cdk deploy --all` → Smoke-Test → Fake-Plugin-Nacht mit `TEST_RIG_TOKEN` aus der lokalen Umgebung; H-06, H-24). Die Beispielsequenzen des Plugins gehen mit demselben Deploy über ein zweites `BucketDeployment` nach `webBucket/downloads/nina-sequences/` (`prune: false`). GitHub hat keinen AWS-Zugang (kein OIDC-Provider, keine GitHub-Rollen, keine Deploy-Workflows); `fromLookup` ist erlaubt. **Claude Code deployt nie.**

## 8. Geheimnisse und Parameter (SSM)

SecureStrings verwenden den AWS-verwalteten Schlüssel **`alias/aws/ssm`** (SV-13); die Lambda-Rollen brauchen dafür kein eigenes KMS-Recht. Die Werte legt Sven per AWS-CLI an (H-05); die Lambdas erhalten Parameter**namen** und lesen die Werte zur Laufzeit. Kein Rotationsverfahren – ein Wechsel ist „Wert setzen, deployen“.

| Parameter | Typ | Inhalt | Gelesen von |
|---|---|---|---|
| `/nina-pm/oauth/cookie-secret` | SecureString | 32 Byte zufällig; signiert das OAuth-Zwischencookie `__Host-npm_oauth` (SV-02) | `api` |
| `/nina-pm/discord/client-id` | String | Discord-Client-ID | `api` |
| `/nina-pm/discord/client-secret` | SecureString | Discord-Client-Secret | `api` |
| `/nina-pm/origin-verify` | String | 32 Byte zufällig; **ein** Wert (SV-16) | `api` (Middleware); CloudFront erhält ihn beim Deploy als Origin-Header |
| `/nina-pm/bootstrap-super-users` | String | kommagetrennte Discord-IDs (SV-17, H-08) | `api` |
| `/nina-pm/dsql-endpoint` | String | DSQL-Endpunkt (nach AP-02a aus der Stack-Ausgabe; erleichtert Restore in einen neuen Cluster) | `api`, `worker`, `migrate`, `ops-cli` |
| `/nina-pm/web/build-id` | String | schreibt der Deploy | `api`, `worker` |
| `/nina-pm/system/alarm-webhook` | SecureString, optional | System-Discord-Webhook für Alarme | `worker` |

**Entfallen:** `/nina-pm/jwt/signing-keys` (SV-01, ersetzt durch `oauth/cookie-secret`), `/nina-pm/origin-verify-prev` (SV-16), `/nina-pm/tenants/*/discord/*` (SV-10), der kundenverwaltete Schlüssel `alias/nina-pm-ssm` (SV-13).

## 9. API Gateway und Lambda-Parallelität (SV-06, SV-07)

| Einstellung | Wert | Begründung |
|---|---|---|
| Stage-Drosselung `$default` | 50 rps / Burst 100 | Obergrenze für alles |
| Route `ANY /api/nina/v1/{proxy+}` | 20 rps / Burst 40 | Plugin-Schnittstelle |
| Route `GET /api/auth/discord/{proxy+}` | 5 rps / Burst 10 | Anmeldung (Start und Callback) |
| Routen `POST /api/auth/invitation/claim`, `POST /api/auth/invitations/preview` | je 5 rps / Burst 10 | Einladungen (anonym erreichbar) |
| übrige Auth-Routen (`/auth/me`, `/auth/context`, `/auth/logout`, `/auth/sessions`) | Stage-Drosselung | laufen über `ANY /api/{proxy+}`; eine eigene Auth-Drossel würde normale Seitenaufrufe bremsen |
| Route `GET /api/health` | 5 rps / Burst 10 | **einzige** Health-Route: öffentlich, **ohne** DB-Ping (SV-07), Ziel des Route-53-Health-Checks über CloudFront (braucht ≈ 0,05 rps); überall derselbe Wert (SV-19) |
| Reservierte Parallelität `api` | **20** | begrenzt Kosten und DSQL-Verbindungen (Pool 2 je Container ⇒ höchstens 40) |
| Reservierte Parallelität `worker` | **5** | Jobs sind idempotent und dürfen nachlaufen |
| Zugriffsprotokoll HTTP API | JSON mit `requestId`, `routeKey`, `status`, `integrationLatency`, `ip` (auf /24 bzw. /48 gekürzt) | Nachvollziehbarkeit von Lastspitzen und Direktaufrufen |

- Die reservierte Parallelität (zusammen 25) setzt ein ausreichendes Konto-Kontingent voraus: AWS hält immer 100 Ausführungen unreserviert, das Kontingent muss also ≥ 125 sein – Prüfung und ggf. Erhöhungsantrag in H-01.
- `X-Origin-Verify`: die Middleware vergleicht den Header mit dem **einen** Wert aus `/nina-pm/origin-verify` (SSM-Cache); ohne passenden Header → 403, bevor Fachlogik läuft. Beim Wechsel des Werts sind bis zum Ende des Deploys kurzzeitig 403 möglich (hingenommen, SV-16).
- Überschreitung der Drosselung → `429` vom Gateway, im Client als `auth.rate_limited` behandelt. **Entfallen (SV-06, SV-07):** Drosselung je NINA-Instanz in der Middleware (`NinaThrottled`), zweite Stufe aus der Datenbank, Einladungs-Limit je IP, Mandanten-Jobquote, Header `X-NPM-Deep`. Die DB-Erreichbarkeit prüft der Smoke-Test über eine angemeldete Route.
- Kein AWS WAF (Entscheidung vom 17.09.2026 bleibt); Verfügbarkeit gegen gezielte Überlast von außen ist damit nicht geschützt (keine Drossel je IP) – bewusst hingenommen (TK 15.3). Missbrauchs- und Kostenalarme: Budget 20 €/Monat, `Throttles` der `api`-Lambda, `Count` der HTTP-API-Stage (> 100.000 in 5 min). Der 403-Metrikfilter-Alarm entfällt (SV-15).

## 10. CloudFront: Header-Politiken (SV-16)

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

- **`style-src 'self' 'unsafe-inline'` ist Pflicht:** Radix UI positioniert Popover, Dialog, Menü und Tooltip über Inline-`style`-Attribute; ohne es bricht die Oberfläche beim ersten Popover – sichtbar erst in prod. Für **Skripte** bleibt `'unsafe-inline'` verboten.
- `base-uri` und `form-action` erben **nicht** von `default-src` und müssen einzeln dastehen. `worker-src 'self' blob:` deckt den Comlink-Worker ab.
- **Abnahme:** ein Playwright-Test startet die gebaute SPA hinter einem Proxy, der genau diese Header setzt, öffnet ein Radix-Menü und einen Dialog und prüft, dass die Konsole keine CSP-Verstöße meldet.

### `npm-api-static` (`/api/*`, `/catalog/*`, `/downloads/*`)

Dieselben Header, zusätzlich `Cross-Origin-Resource-Policy: same-origin`, und **mit** eigener CSP:

```
Content-Security-Policy: default-src 'none'; sandbox; frame-ancestors 'none'; base-uri 'none'
```

`/catalog/*` und `/downloads/*` liegen auf demselben Origin wie die Anwendung und sind beschreibbar (`worker` legt Vorschaubilder ab); ein dort abgelegtes HTML-Dokument bleibt durch `default-src 'none'; sandbox` wirkungslos. Der `Content-Disposition`-Zwang entfällt (SV-16). Buckets: Block Public Access, Versionierung, Zugriff auf den Web-Bucket nur über CloudFront mit OAC (bleibt).

## 11. Sicherungen und Logs (SV-15)

- **AWS Backup:** Plan täglich, Aufbewahrung **35 Tage**, **Standard-Vault** (keine Vault-Zugriffspolitik, kein Vault Lock). Alarm nur auf `NumberOfBackupJobsFailed > 0`. Vor jedem Deploy mit Migrationen startet `pnpm deploy:prod` ein On-Demand-Backup und wartet auf dessen Abschluss. Restore über den ARN des Wiederherstellungspunkts (Runbook `restore.md`); die Restore-Probe H-20 läuft einmal.
- **Löschschutz:** DSQL-Cluster mit Löschschutz und `RemovalPolicy.RETAIN`; Daten-Bucket mit `RemovalPolicy.RETAIN` (Assertion 10).
- **Logs:** Aufbewahrung **90 Tage** für alle Log-Gruppen (Lambdas und HTTP-API-Zugriffsprotokoll), Verschlüsselung mit dem Standard von CloudWatch Logs.
- **Kein eigener CloudTrail-Trail** (SV-15): Trail, Zustellrolle, Log-Gruppe, Bucket-Präfix `audit/` sowie alle CloudTrail-Metrikfilter und -Alarme entfallen. Für Rückfragen genügt die kostenlose CloudTrail-Event-history (90 Tage).

## 12. Pflicht-Tests (CDK-Assertions, AP-02a/AP-02b)

1. Die vier Anwendungsrollen (`NinaPmApi`, `NinaPmWorker`, `NinaPmMigrate`, `NinaPmOpsCli`) enthalten nur die Rechte aus §2–§5: keine `Allow`-Anweisung mit `"Resource": "*"` für `dsql:`, `s3:`, `ssm:` oder `lambda:InvokeFunction`; keine Managed Policy außer `AWSLambdaBasicExecutionRole`.
2. `NinaPmApi` hat genau **einen** `lambda:InvokeFunction`-Eintrag, und dieser zeigt auf `nina-pm-worker`; keine Rolle hat ein Invoke-Recht auf `nina-pm-ops-cli`; `NinaPmWorker` hat kein `lambda:InvokeFunction`.
3. `NinaPmWorker` hat keinen SSM-Lesezugriff auf `/nina-pm/oauth/*`, `/nina-pm/discord/client-secret` oder `/nina-pm/bootstrap-super-users`.
4. `dsql:DbConnectAdmin` steht **nur** in `NinaPmMigrate`.
5. Beide Projekt-Buckets haben `BlockPublicAcls`, `BlockPublicPolicy`, `IgnorePublicAcls`, `RestrictPublicBuckets` auf `true` und Versionierung eingeschaltet; der Web-Bucket ist nur über CloudFront mit OAC lesbar.
6. Jedes der vier CloudFront-Behaviors hat eine Response-Headers-Policy; `npm-html` enthält `style-src` mit `'unsafe-inline'` und `script-src` **ohne** `'unsafe-inline'`; `npm-api-static` enthält eine CSP mit `default-src 'none'`.
7. Website-Schutz: die Route-53-Konstrukte legen ausschließlich Einträge mit dem Präfix `nina-pm` an; das Template referenziert die Website-Distribution `E2L6Q80SD8XPT0` nicht.
8. Drosselung von Stage und Routen nach §9 gesetzt; `api` und `worker` haben `reservedConcurrentExecutions` 20 bzw. 5.
9. Keine Lambda setzt die Umgebungsvariable `AUTH_TEST_MODE`.
10. Der DSQL-Cluster hat Löschschutz und `DeletionPolicy: Retain`; der Daten-Bucket hat `DeletionPolicy: Retain`.
