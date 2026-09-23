# AP-02b – CDK: Api, Jobs, Ops (Lambdas, Rollen, Zeitpläne, Alarme)

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-02a, AP-S1 · **Menschliche Aufgaben:** H-05, H-06, H-09

## Ziel
Die beiden Anwendungs-Lambdas mit je eigener Rolle, die vier Zeitpläne, das `ops-cli`-Gerüst und die Alarme sind deployt. `/api/health` antwortet über CloudFront (ohne Datenbankzugriff).

## Anforderungen
TK 4.2, 7.4, 13, 16

## Lesen (nur diese Abschnitte)
- TK 4.1–4.2
- **specs/infra/iam.md §1–§3, §5, §6, §8, §9, §11, §12**
- TK 7.4
- TK 13
- TK 16.1–16.2
- rules/api.md
- rules/security-auth.md (AWS-Rechte)
- ops/human-tasks.md H-05 (Parameterliste)
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- Stacks `Api` (HTTP API + Lambda `api` mit Hono, **eine** Health-Route `GET /api/health` **ohne** DB-Ping: Status, `ENGINE_VERSION`, Build, SV-07), `Jobs` (Lambda `worker` mit Dispatcher-Gerüst, 4 EventBridge-Zeitpläne in der Gruppe `nina-pm` über das CDK-Ziel `LambdaInvoke`, `EventInvokeConfig` → SQS `nina-pm-worker-failures` mit SSE-SQS/14 Tagen/`enforceSSL`), `Ops` (Lambda `ops-cli`, SNS-E-Mail-Topic, Alarme nach TK 16.2, Route-53-Health-Check auf `/api/health` **über CloudFront**, Budget-Alarm)
- **Eine Ausführungsrolle je Lambda über CDK-Grants genau nach `iam.md` §2, §3, §5 und §6** (`NinaPmApi`, `NinaPmWorker`, `NinaPmOpsCli` mit festem `roleName`, weil Migration 0000 sie nennt): Grants statt handgeschriebener Politiken, ein `PolicyStatement` nur für `dsql:DbConnect` auf den Cluster-ARN, keine `Deny`-Anweisungen, keine Managed Policies außer `AWSLambdaBasicExecutionRole`, X-Ray per `tracing: ACTIVE` (SV-13); die Scheduler-Aufrufrolle erzeugt CDK selbst
- **Drosselung und Parallelität nach `iam.md` §9:** Stage 50 rps/Burst 100, `/api/nina/v1` 20 rps, 5 rps/Burst 10 nur auf `GET /api/auth/discord/{proxy+}`, `POST /api/auth/invitation/claim` und `POST /api/auth/invitations/preview` (`/auth/me`, `/auth/context`, `/auth/logout`, `/auth/sessions` unter der Stage-Drosselung), `GET /api/health` 5 rps/Burst 10; reservierte Parallelität `api` 20 und `worker` 5 (Kontingent aus H-01); Zugriffsprotokoll der HTTP API (JSON, IP gekürzt); Log-Aufbewahrung **90 Tage** für alle Log-Gruppen (SV-15)
- Alarme nach TK 16.2, darunter `Throttles` auf `api`, Stage-`Count` > 100.000 in 5 min, Budget 20 €/Monat und AWS Backup `NumberOfBackupJobsFailed > 0` (SV-15)
- `X-Origin-Verify`: CloudFront sendet den **einen** Wert aus `/nina-pm/origin-verify`, die Middleware vergleicht ihn (SSM-Cache, TTL 5 min) und antwortet sonst 403 (SV-16)
- Lambda `ops-cli` als Gerüst (Befehle `help`, `list-failed-jobs`), aufrufbar **nur** per `aws lambda invoke` mit Svens Admin-Profil – keine Route, keine Function-URL, keine ressourcenbasierte Politik
- Smoke-Skript `tools/smoke` als Schritt von `pnpm deploy:prod` (prüft `/api/health` und dass ein **Direktaufruf der `execute-api`-Adresse 403** liefert)

## Nicht im Umfang
- Keine fachlichen Routen, keine Migrationen (AP-03)
- `Api`/`Jobs` hängen hier noch **nicht** am Stack `Migrate`; die Abhängigkeit kommt in AP-03 (CC-7). `/api/health` bleibt dauerhaft ohne DB-Ping (SV-07)
- AWS WAF – **entschieden: kein WAF** (`iam.md` §9); der Schutz trägt über Origin-Verify, Drosselung, reservierte Parallelität und Alarme
- Drosselung in der Anwendung (SV-06)

## Automatisierte Abnahme
- [ ] CDK-Assertion 1 (`iam.md` §12): keine `Allow`-Anweisung mit `"Resource": "*"` für `dsql:`, `s3:`, `ssm:` oder `lambda:InvokeFunction`; keine Managed Policy außer `AWSLambdaBasicExecutionRole`
- [ ] Assertion 2: `NinaPmApi` hat genau **einen** `lambda:InvokeFunction`-Eintrag auf `nina-pm-worker`; keine Rolle hat ein Invoke-Recht auf `nina-pm-ops-cli`; `NinaPmWorker` hat keines
- [ ] Assertion 3: `NinaPmWorker` liest weder `/nina-pm/oauth/*` noch `/nina-pm/discord/client-secret` noch `/nina-pm/bootstrap-super-users`
- [ ] Assertion 8: Stage- und Routen-Drosselung nach `iam.md` §9, `reservedConcurrentExecutions` 20 bzw. 5 (SEC-15)
- [ ] Assertion 9: keine Lambda mit `AUTH_TEST_MODE`; 4 Zeitpläne
- [ ] Routen-Drosselung: 5 rps/Burst 10 auf `GET /api/auth/discord/{proxy+}` und den beiden Einladungsrouten, **keine** eigene Route für `/api/auth/{proxy+}`; nur eine Health-Route `GET /api/health`
- [ ] Smoke nach Deploy grün (`/api/health`, Direktaufruf 403)
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
Deploy lokal (H-06); SNS bestätigen (H-09); `/api/health` liefert 200; ein Alarm testweise ausgelöst und E-Mail erhalten
