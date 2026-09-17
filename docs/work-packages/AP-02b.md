# AP-02b – CDK: Api, Jobs, Ops (Lambdas, Rollen, Zeitpläne, Alarme)

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-02a, AP-S1 · **Menschliche Aufgaben:** H-05, H-06, H-09

## Ziel
Die beiden Anwendungs-Lambdas, die vier Zeitpläne, das `ops-cli`-Gerüst und die Alarme sind deployt. `/api/health` antwortet über CloudFront (noch ohne Datenbank).

## Anforderungen
TK 4.2, 7.4, 13, 16

## Lesen (nur diese Abschnitte)
- TK 4.1–4.2
- **specs/infra/iam.md §1–§6, §9, §11–§12**
- TK 7.4
- TK 13
- TK 16.1–16.2
- rules/api.md
- rules/security-auth.md (IAM-Grundsatz)
- ops/human-tasks.md H-05 (Parameterliste)
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- Stacks `Api` (HTTP API + Lambda `api` mit Hono, `/api/health` **ohne** DB-Ping: Status, `ENGINE_VERSION`, Build), `Jobs` (Lambda `worker` mit Dispatcher-Gerüst, 4 EventBridge-Zeitpläne in der Gruppe `nina-pm`, `EventInvokeConfig` → SQS `nina-pm-worker-failures` mit SSE-SQS/14 Tagen/`enforceSSL`), `Ops` (SNS-E-Mail, Alarme 16.2, Route-53-Health-Check auf `/api/health/shallow` **über CloudFront**, **CloudTrail `nina-pm-management`** mit Metrikfiltern nach `iam.md` §11)
- **Eine Ausführungsrolle je Lambda genau nach `iam.md` §2–§6** (`NinaPmApi`, `NinaPmWorker`, `NinaPmOpsCli`) samt der dort genannten `Deny`-Anweisungen; Rolle `NinaPmSchedulerInvoke` mit `aws:SourceArn`-Bedingung; ressourcenbasierte Politik auf `ops-cli` mit `NinaPmOpsInvoker` als einzigem Principal
- **Drosselung und Parallelität nach `iam.md` §9:** Routen-Drosselung `/api/nina/v1` 20 rps, `/api/auth/*` 5 rps, `GET /api/health` 1 rps, `/api/health/shallow` 200 rps; reservierte Parallelität `api` 20 und `worker` 5; Zugriffsprotokoll der HTTP API (JSON, IP gekürzt)
- X-Origin-Verify zwischen CloudFront und API, in der Middleware gegen **beide** SSM-Werte geprüft
- Lambda `ops-cli` als Gerüst (Befehle `help`, `list-failed-jobs`) mit SNS-Selbstmeldung
- Smoke-Skript `tools/smoke` in `deploy-prod.yml` (prüft auch, dass ein **Direktaufruf der `execute-api`-Adresse 403** liefert)

## Nicht im Umfang
- Keine fachlichen Routen, keine Migrationen (AP-03)
- `Api`/`Jobs` hängen hier noch **nicht** am Stack `Migrate`; Abhängigkeit und DB-Ping in `/api/health` kommen in AP-03 (CC-7)
- AWS WAF – **entschieden: kein WAF**, weder an der HTTP API (technisch nicht möglich) noch an CloudFront (`iam.md` §9); der Schutz trägt über Origin-Verify, Drosselung, reservierte Parallelität und Alarme

## Automatisierte Abnahme
- [ ] CDK-Assertions: Anwendungs-Lambdas genau `api` und `worker` (+ `ops-cli`; CDK-Hilfs-Lambdas ausgenommen), 4 Zeitpläne, keine Lambda mit `AUTH_TEST_MODE`
- [ ] **Keine `Allow`-Anweisung mit `"Resource": "*"`** in einer der Rollen (Ausnahmen laut `iam.md` §1)
- [ ] `NinaPmApi` hat genau **einen** `lambda:InvokeFunction`-Eintrag und der zeigt auf `nina-pm-worker` (SEC-7)
- [ ] `NinaPmWorker` enthält kein `Allow` auf `/nina-pm/jwt/*`, `discord/client-secret` oder `bootstrap-super-users` und ein `Deny` auf `lambda:InvokeFunction` (SEC-5)
- [ ] `api` und `worker` haben `reservedConcurrentExecutions` gesetzt (SEC-15)
- [ ] Scheduler-Rolle hat die `aws:SourceArn`-Bedingung (SEC-10)
- [ ] Smoke nach Deploy grün (`/api/health`, `/api/health/shallow`, Direktaufruf 403)
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
Deploy freigeben; SNS bestätigen (H-09); `/api/health` liefert 200; Alarm-Probe „Notfallzugang benutzt“ ausgelöst und E-Mail erhalten
