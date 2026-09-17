# Sicherheits-Review – Svenesis NINA-PM

Grundlage: Fachkonzept 1.13, Technisches Konzept 1.10, Schema 1.10, Paket `claude-code/` (Stand 17.09.2026).
Schwerpunkt laut Auftrag: **Anwendung, API und AWS-Umsetzung mit Least Privilege für API Gateway und Lambda**; zusätzlich die Frage, wo das UI-Layout beschrieben ist (Abschnitt F).

Prüfweise: jede Aussage ist am Dokument belegt (Kapitelangabe). Wo ich eine Lücke behaupte, habe ich vorher über alle Dateien (ohne `history/` und `concept/`) gegengesucht – die Suchbegriffe stehen jeweils dabei.

**Status: vollständig eingearbeitet** (17.09.2026) → Fachkonzept 1.14 · Technisches Konzept 1.11 · Schema 1.11 · zwei neue Specs · Paket über den Generator neu erzeugt.

>**Nachtrag (Entscheidungen vom 17.09.2026, FK 1.15 / TK 1.12):** Drei Punkte dieses Reviews sind bewusst **anders** entschieden worden, als hier vorgeschlagen:
> - **UI-1** ist übererfüllt: die Arbeitsseiten nutzen jetzt **immer die volle Fensterbreite** (die bisherige Obergrenze von 1800 px ist weg); Mindestbreite bleibt 768 px. Der Layout-Umschalter Tablet/Laptop/Desktop wurde zum **Dichte-Schalter** `compact`/`normal`/`wide` mit eigenen Tokens.
> - **UI-2** entfällt: Es gibt **keinen Rotlicht-Modus**. Nur `light` und `dark`; der Dunkelmodus genügt am Teleskop, und eine dritte Farbwelt müsste in jedem Bildschirm, jedem Diagramm und jedem Baustein mitgepflegt werden.
> - **SEC-15**: **Kein AWS WAF**, auch nicht an der CloudFront-Distribution (≈ 6 $/Monat gegen 20 € Budget). Der Schutz gegen Direktaufrufe und Lastspitzen trägt endgültig über Origin-Verify, Drosselung, reservierte Parallelität und den Budget-/Throttle-Alarm; AP-17 prüft das mit einem Lasttest statt mit einer offenen ADR-Frage.
>
> **Einarbeitung – was entstanden ist.** Neue verbindliche Spezifikationen: **`specs/infra/iam.md`** (eine Rolle je Lambda mit fertigen Politiken, KMS-Schlüssel, API-Gateway-Drosselung, beide CloudFront-Header-Politiken, acht CDK-Assertions) und **`specs/ui/components.md`** (Verträge der neun Bausteine mit Zuständen, Mindestgrößen, Grenzfällen und Symbolsatz). Kernänderungen: `migrate` verliert `dsql:DbConnectAdmin` an die einmalig aufgerufene Lambda `db-bootstrap` (neue Aufgabe H-25) · getrennte DB-Rollen `app_rw`/`app_job` mit Rechten je Tabellengruppe (TK 6.2) · pfadgenauer SSM-Zugriff mit eigenem KMS-Schlüssel · `lambda:InvokeFunction`, `sqs:SendMessage` und die Scheduler-Rolle festgeschrieben · `NinaPmDeployBoundary` statt `AdministratorAccess` mit technischem Schutz der Website-Distribution (H-04 neu gefasst) · vollständige CSP inklusive `style-src 'unsafe-inline'` und Header-Politiken auf allen vier Behaviors · Drosselung für `/api/auth/*`, `/api/health` und je NINA-Instanz plus reservierte Parallelität · Herkunftsprüfung gegen CSRF · presigned **POST** mit Größengrenze und Strukturgrenzen für JSON · CloudTrail mit Alarmen und Backup-Vault mit Vault Lock · Mindestbreite 768 px und Rotlicht-Modus als Abnahmekriterium in allen Briefs · Anordnungsskizzen für S-31, S-40 und S-61.

## Gesamturteil

- **Die Anwendungssicherheit ist überdurchschnittlich gut durchdacht.** Discord-OAuth mit `state` im signierten Cookie, `__Host-`-Cookies, rotierende Refresh-Tokens mit Karenz und Wiederverwendungserkennung, CSRF über SameSite + Pflicht-Header ohne CORS, Rechtematrix als Code mit generierten Tests je Route × Rolle, Mandanten-Guard mit Lint-Regel und Isolationstest, NINA-Token nur als Hash, Einladungs-Token weder im Pfad noch in der Query – das ist vollständig und an den richtigen Stellen begründet.
- **Die AWS-Seite ist dagegen nur zur Hälfte beschrieben.** Was dasteht, ist richtig; es fehlt aber die halbe Rechteliste: **kein einziges Mal** werden `lambda:InvokeFunction`, `sqs:SendMessage`, `kms:Decrypt`, die Rolle für den EventBridge Scheduler oder die Berechtigungspolitik der GitHub-Deploy-Rolle genannt (geprüft per Volltextsuche). Claude Code wird diese Rechte beim Bauen selbst erfinden – und im Zweifel zu weit fassen.
- **Zwei echte Least-Privilege-Verstöße** stehen ausdrücklich im Dokument: `migrate` hält bei **jedem** Deploy `dsql:DbConnectAdmin` (DB-Vollzugriff), und `api` und `worker` teilen **eine** Rolle mit **einer** DB-Rolle `app_rw`. Beides ist mit vertretbarem Aufwand auflösbar.
- **Ein funktionaler Fehler in der CSP**: `default-src 'self'` ohne `style-src` blockiert Inline-`style`-Attribute. Radix UI (TK 11.1) positioniert Dialoge, Menüs und Tooltips genau darüber – die Oberfläche bricht beim ersten Popover.
- **Die Sicherheitsheader greifen nur auf einem von vier CloudFront-Behaviors.** Die Response-Headers-Policy steht in der Tabelle 4.3 nur in der Zeile *Default*; `/api/*`, `/catalog/*` und `/downloads/*` liefern damit kein HSTS und kein `nosniff`.
- **Umfang:** 35 Befunde – 3 Blocker, 9 hohe, 15 mittlere, 8 niedrige (SEC-1…30 und UI-1…5). Keiner betrifft die Fachlogik – es sind Infrastruktur- und Header-Themen, die vor AP-02a/AP-02b in das Konzept gehören, damit sie nicht später nachgezogen werden müssen.

---

## A. Blocker (vor AP-02a/AP-02b beheben)

| # | Befund | Fix |
|---|---|---|
| **SEC-1** | **`migrate` hat dauerhaft DB-Adminrechte.** TK 4.1: „Admin-Rolle nur für `migrate` (`dsql:DbConnectAdmin`)“, TK 4.2: „Migration 0000 als DB-Rolle `admin` … danach als `app_migrate`“; die Lambda läuft laut TK 4.1 („`triggers.Trigger` … läuft **bei jedem Deploy** vor dem neuen Code“) und TK 6.8 automatisch bei **jedem** Release. Damit trägt eine Lambda, die bei jedem Release automatisch startet, den DSQL-Superuser. Eine kompromittierte Abhängigkeit im `migrate`-Bundle (oder ein manipulierter Migrationsschritt) bedeutet vollständigen Datenbankzugriff inklusive Rollen- und GRANT-Änderung. `DbConnectAdmin` wird nur **einmal** gebraucht – für Migration 0000. | `migrate` erhält **nur** `dsql:DbConnect` (→ `app_migrate`). Migration 0000 wandert in eine eigene Lambda `db-bootstrap` mit der Rolle `NinaPmDbBootstrap` (`dsql:DbConnectAdmin`), die **kein** CDK-`Trigger` automatisch aufruft: sie läuft einmalig per `aws lambda invoke` als neue menschliche Aufgabe (analog H-04). Der Migrationsrunner prüft beim Start nur noch, **ob** die Rollen existieren, und bricht mit klarer Meldung ab, wenn nicht. |
| **SEC-2** | **CSP blockiert die eigene Oberfläche.** TK 15 setzt `default-src 'self'` und definiert `img-src` und `connect-src`, aber **kein `style-src`** (Volltextsuche: `style-src` kommt in keinem Dokument vor). Ohne `style-src` erbt der Browser `default-src 'self'` – und das verbietet Inline-`style`-**Attribute**. TK 11.1 baut die Oberfläche auf **Radix UI**, das Popover, Dialog, Menü und Tooltip über `style="transform: translate(...)"` positioniert. Ergebnis: Menüs und Dialoge erscheinen an der falschen Stelle oder gar nicht, und zwar erst in prod (lokal ohne CloudFront-Header). Die Go-live-Checkliste verlangt „CSP ohne `unsafe-inline` **für Skripte**“ – für Stile ist `unsafe-inline` also zulässig, nur nicht festgeschrieben. | CSP vollständig festschreiben (Abschnitt E.8 dieses Reviews hat den Vorschlag): `style-src 'self' 'unsafe-inline'`, dazu `script-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `worker-src 'self' blob:`, `frame-ancestors 'none'`. Zusätzlich ein E2E-Test, der Radix-Popover in einem Build mit produktiven Headern öffnet. |
| **SEC-3** | **Berechtigungspolitik der GitHub-Deploy-Rolle ist nicht beschrieben.** TK 4.1 nennt für `NinaPmGithubDeploy` nur die **Vertrauensbeziehung** („Vertrauen nur für Repo und Environment `prod`“). Was die Rolle **darf**, steht nirgends (Volltextsuche `NinaPmGithubDeploy`: ein Treffer). `cdk bootstrap` legt die CloudFormation-Ausführungsrolle standardmäßig mit **`AdministratorAccess`** an; wer den `prod`-Workflow auslösen kann, hat damit Kontoadmin – im **selben Konto**, in dem die Website-Distribution `E2L6Q80SD8XPT0` liegt, die laut Leitplanke nie verändert werden darf. | Zwei Festlegungen in TK 4.1: (1) `NinaPmGithubDeploy` darf **ausschließlich** `sts:AssumeRole` auf die vier CDK-Bootstrap-Rollen des Kontos (`deploy`, `file-publishing`, `image-publishing`, `lookup`) plus `cloudformation:DescribeStacks` für den Diff – keine direkten Service-Rechte. (2) `cdk bootstrap` wird mit `--cloudformation-execution-policies` auf eine **eigene** Policy `NinaPmDeployBoundary` gesetzt (Vorschlag in Abschnitt E.7), die die benutzten Dienste erlaubt und Website-Distribution, fremde Route-53-Einträge, `dsql:DeleteCluster` und `backup:Delete*` ausdrücklich verweigert. Als menschliche Aufgabe an H-04 anhängen. |

---

## B. AWS Least Privilege – Lambda (hoch/mittel)

Alle Befunde dieses Abschnitts wurden per Volltextsuche über TK, FK, Schema, `rules/*`, `ops/*` und alle 74 Briefs geprüft (ohne `history/` und `concept/`).

| # | Befund | Fix |
|---|---|---|
| SEC-4 (hoch) | **`api` und `worker` teilen eine IAM-Rolle und eine DB-Rolle.** TK 4.1/4.2/15: „gemeinsame IAM-Rolle `NinaPmDbAccess` … von `api` und `worker` übernommen“, „Mapping der **einen** IAM-Rolle `NinaPmDbAccess` → `app_rw`“. Damit darf die Job-Lambda alles, was die API-Lambda darf, und umgekehrt: `worker` kann `auth_session` und `nina_instance` schreiben (Sitzungen kapern, Tokens tauschen), `api` kann Kataloge überschreiben. Die Begründung „eine Rolle“ ist Bequemlichkeit beim `AWS IAM GRANT`, kein technischer Zwang – `AWS IAM GRANT` lässt sich für zwei Rollen genauso idempotent ausführen. | Zwei IAM-Rollen `NinaPmApi` und `NinaPmWorker`, zwei DB-Rollen `app_rw` (api) und `app_job` (worker), GRANTs je Tabelle getrennt (Vorlage am Schema-Ende erweitern). Der DSQL-Lint in CI prüft, dass jede neue Tabelle **beide** GRANT-Sätze hat. Wo der Aufwand nicht gewollt ist, mindestens die IAM-Rollen trennen (S3/SSM/KMS/Invoke unterscheiden sich ohnehin) und die gemeinsame DB-Rolle als bewusste Ausnahme in TK 15 begründen. |
| SEC-5 (hoch) | **`ssm:GetParameter` ist für `api` und `worker` gleich weit.** TK 15: „Lesezugriff für `api`/`worker`“ – ohne Pfadliste. `worker` braucht weder `/nina-pm/jwt/signing-keys` noch `/nina-pm/discord/client-secret` noch `/nina-pm/bootstrap-super-users`; mit Lesezugriff auf den JWT-Schlüssel kann die Job-Lambda beliebige Access-Tokens **signieren** – Rollen- und Mandantengrenzen sind damit für sie bedeutungslos. | Pfadgenaue Listen je Rolle (Abschnitt E.1/E.2). `worker`: nur `/nina-pm/dsql-endpoint`, `/nina-pm/system/alarm-webhook`, `/nina-pm/web/build-id`, `/nina-pm/tenants/*/discord/*`. `api`: alles außer `/nina-pm/web/build-id`. Zusätzlich in beiden Rollen ein explizites `Deny` auf `ssm:PutParameter`/`DeleteParameter` für `/nina-pm/jwt/*` und `/nina-pm/bootstrap-super-users`. |
| SEC-6 (hoch) | **`kms:Decrypt` fehlt vollständig.** Volltextsuche `kms`: zwei Treffer, beide beschreibend („KMS-verschlüsselt“, „AWS-verwalteter Schlüssel“) – keine IAM-Aktion. `ssm:GetParameter` mit `WithDecryption=true` auf einen SecureString scheitert ohne `kms:Decrypt` auf dem Schlüssel; die Schlüsselpolitik von `alias/aws/ssm` erlaubt es dem Konto, aber die **Rollenpolitik** muss es trotzdem enthalten. Claude Code wird das beim ersten Fehlschlag reparieren – erfahrungsgemäß mit `"Resource": "*"`. | `kms:Decrypt` (und für `api` zusätzlich `kms:Encrypt`, weil es SecureStrings schreibt) mit Bedingung `kms:ViaService = ssm.eu-central-1.amazonaws.com` in beide Rollen. **Empfehlung:** einen kundenverwalteten Schlüssel `alias/nina-pm-ssm` anlegen (1 $/Monat) und dessen **Schlüsselpolitik** auf genau `NinaPmApi` und `NinaPmWorker` begrenzen – dann ist die Rechtevergabe zweiseitig und ein neuer Lambda-Nachbar im Konto kommt nicht an die Geheimnisse. |
| SEC-7 (hoch) | **`lambda:InvokeFunction` fehlt.** TK 7.4: „`api` … ruft `worker` **asynchron nur mit `{jobId}`** auf (`InvocationType: Event`, Wiederholungen 0)“. Volltextsuche `InvokeFunction`: **kein Treffer**. Ohne Festlegung wird das Recht typischerweise als `lambda:InvokeFunction` auf `*` gesetzt; dann kann `api` jede Lambda im Konto aufrufen – auch `ops-cli` (Mandanten anlegen, Super User ernennen, Identitäten sperren). Das ist der kürzeste Weg von einem API-Bug zur vollständigen Übernahme der Anwendung. | In `NinaPmApi` genau eine Anweisung: `lambda:InvokeFunction` auf den ARN der `worker`-Funktion. Zusätzlich eine **ressourcenbasierte Politik** auf `ops-cli`, die nur `NinaPmOpsInvoker` als Principal zulässt (SEC-9), damit ein zu weites Identitätsrecht dort nicht greift. |
| SEC-8 (mittel) | **`sqs:SendMessage` für das `onFailure`-Ziel fehlt.** TK 4.1/13: `EventInvokeConfig` mit `onFailure` → SQS `worker-failures`. Volltextsuche `sqs:` und `SendMessage`: **kein Treffer**. Das Recht muss in der **Ausführungsrolle der `worker`-Lambda** stehen, sonst verschwinden fehlgeschlagene Jobs still – und der Alarm „Nachrichten in `worker-failures` > 0“ (16.2) feuert nie. Ebenfalls offen: Verschlüsselung und Aufbewahrung der Queue und **wer sie liest**. | `sqs:SendMessage` auf den Queue-ARN in `NinaPmWorker`. Queue mit SSE-SQS, `MessageRetentionPeriod` 14 Tage, `enforceSSL` (Deny ohne `aws:SecureTransport`) in der Queue-Politik. Ein neues Runbook oder ein `ops-cli`-Befehl `list-failed-jobs` liest sie; sonst ist die Queue ein Datengrab. |
| SEC-9 (hoch) | **Wer `ops-cli` aufrufen darf, ist nicht festgelegt.** TK 4.2: „nur per `aws lambda invoke` (keine Route)“, TK 5.4 listet die Befehle: `create-tenant`, `grant-super-user`, `block-identity`, `revoke-sessions`, `unlock-tenant`, `revoke-nina-token`. Es fehlt: die IAM-Rolle des Aufrufers, eine MFA-Bedingung und die DB-Rolle, mit der `ops-cli` selbst arbeitet (Volltextsuche: die Lambda hat keine zugeordnete DB-Rolle). Faktisch kann heute jeder Principal mit `lambda:*` im Konto Super User werden, ohne dass jemand eine Anmeldung sieht. | Rolle `NinaPmOpsInvoker`: nur `lambda:InvokeFunction` auf `ops-cli`, Vertrauensbeziehung mit `"aws:MultiFactorAuthPresent": "true"` und `sts:AssumeRole`-Dauer 1 h. Ressourcenbasierte Politik auf `ops-cli` mit genau diesem Principal. Ausführungsrolle `NinaPmOpsCli` mit `dsql:DbConnect` (DB-Rolle `app_rw`) und `ssm:GetParameter` auf `/nina-pm/dsql-endpoint`. In TK 5.4 ergänzen, dass jeder Aufruf zusätzlich zum `system_audit` eine SNS-Benachrichtigung auslöst – ein Notfallzugang, der still benutzt werden kann, ist keiner. |
| SEC-10 (mittel) | **Rolle für den EventBridge Scheduler fehlt.** TK 4.1/4.2/13: vier Zeitpläne rufen `worker`. Volltextsuche `Scheduler-Rolle`/`scheduler.*Rolle`: **kein Treffer**. EventBridge Scheduler braucht eine eigene Rolle mit `lambda:InvokeFunction`; ohne Festlegung entsteht eine Rolle je Zeitplan mit Wildcard-Ziel. | Eine Rolle `NinaPmSchedulerInvoke`, Vertrauensbeziehung `scheduler.amazonaws.com` mit `aws:SourceArn` der vier Zeitplan-ARNs (verhindert Confused Deputy), Recht `lambda:InvokeFunction` nur auf `worker`. |
| SEC-11 (mittel) | **`dsql:DbConnect` ist nicht auf den Cluster begrenzt.** TK 4.1/15 nennen die Aktion ohne Ressource. Mit `"Resource": "*"` könnte die Rolle sich auch mit einem CI-Cluster oder einem künftigen zweiten Cluster verbinden – und der CI-Cluster wird von einer Rolle angelegt, die absichtlich nichts mit prod zu tun haben soll (DAT-16). | `"Resource": "arn:aws:dsql:eu-central-1:<account>:cluster/<clusterId>"` in allen vier DB-Rollen; der Cluster-Identifikator kommt aus dem Stack-Ausgang bzw. dem Kontextwert `dsqlClusterId` (4.1). |
| SEC-12 (mittel) | **`app_ro` ist eine verwaiste Rolle.** TK 4.2 legt sie an („`app_ro` (Ops)“) und jede Tabellen-Migration vergibt `GRANT SELECT … TO app_ro` (Schema-Vorlage Z. 1099), aber **keine** IAM-Rolle ist ihr zugeordnet (Volltextsuche `app_ro`: sieben Treffer – TK 4.2 zweimal, 6.8, 6.9, Schema-Vorlage dreimal –, alle beschreibend, kein `AWS IAM GRANT app_ro`). Eine Login-Rolle ohne Zuordnung ist Angriffsfläche ohne Nutzen. | Entweder streichen (dann auch aus der GRANT-Vorlage) oder einer neuen Rolle `NinaPmDbReader` zuordnen, die nur mit MFA annehmbar ist und für Ad-hoc-Analysen gedacht ist – dann in TK 4.2 und im Runbook `superuser-emergency.md` erwähnen. |
| SEC-13 (mittel) | **`NinaPmMigrate` steht nur im Schema.** Die GRANT-Vorlage (Schema Z. 1095) enthält `AWS IAM GRANT app_migrate TO 'arn:…:role/NinaPmMigrate'`; TK 4.1 spricht nur von einer „Admin-Rolle nur für `migrate`“ ohne Namen. Zwei Dokumente, zwei Modelle. | TK 4.1 auf die drei bzw. vier Rollennamen festschreiben (`NinaPmApi`, `NinaPmWorker`, `NinaPmMigrate`, `NinaPmDbBootstrap`) und die Schema-Vorlage entsprechend erweitern. |
| SEC-14 (niedrig) | **S3-Rechte sind knapp, aber unvollständig beschrieben.** TK 15: „S3 nur `data/tenant/*` bzw. Web-Bucket `catalog/thumbs/*` für `worker`“. Offen bleibt, welche **Aktionen** (`api` braucht `PutObject`/`GetObject` zum Vorsignieren, aber **kein** `DeleteObject`; `worker` braucht `PutObject` auf `catalog/thumbs/*`), und `s3:ListBucket` ohne Präfixbedingung würde alle Mandantenschlüssel offenlegen. | Aktionen und `s3:prefix`-Bedingungen ausschreiben (Abschnitt E.1/E.2). Kein `DeleteObject` für `api`; für `worker` `DeleteObject` nur auf `assets/*`. Lebenszyklusregeln übernehmen das Löschen der Mandantendateien – dafür braucht niemand ein Recht. |

---

## C. AWS Least Privilege – API Gateway und Rand (hoch/mittel)

| # | Befund | Fix |
|---|---|---|
| SEC-15 (hoch) | **Die HTTP API ist öffentlich erreichbar; `X-Origin-Verify` wird erst *in* der Lambda geprüft.** TK 4.2/15: „Zugriff nur über CloudFront (Header `X-Origin-Verify`, **in Lambda-Middleware** geprüft)“. Jeder Aufruf der `execute-api`-Adresse startet also einen Lambda-Container, auch wenn er sofort mit 403 endet. Das ist Kosten- und Verfügbarkeitsrisiko in einem Projekt mit 20-€-Budget. Verstärkend: `api` hat laut TK 4.2 **„keine reservierte Parallelität“** – ein Lastspitzenangriff kann das Kontolimit ausschöpfen und damit auch `worker` (Nachtbetrieb!) lahmlegen, und je Container hält der Pool bis zu zwei DSQL-Verbindungen (TK 6.5). | Drei Maßnahmen, die alle ohne neue Dienste gehen: (1) **Reservierte Parallelität** für `api` (Vorschlag 20) und `worker` (5) – begrenzt Kosten, Verbindungen und schützt den Nachtbetrieb. (2) **Routen-Drosselung für `/api/auth/*`** (Vorschlag 5 rps / Burst 10) neben den bestehenden 50 rps global und 20 rps für `/api/nina/v1`. (3) Die `execute-api`-Adresse **nicht** dokumentieren und im Smoke-Test prüfen, dass ein Direktaufruf 403 liefert. Erst wenn das nicht reicht: AWS WAF **an der CloudFront-Distribution** (eine ratenbasierte Regel; eine HTTP API kann keine WAF und keine Ressourcenpolitik tragen – das ist bewusst festzuhalten, damit niemand danach sucht) mit Kostenhinweis ≈ 6 $/Monat gegen das Budget in 16.3. |
| SEC-16 (hoch) | **Sicherheitsheader nur auf einem Behavior.** Tabelle TK 4.3 führt die Response-Headers-Policy ausschließlich in der Zeile *Default*. `/api/*`, `/catalog/*` und `/downloads/*` liefern damit **kein** HSTS, **kein** `X-Content-Type-Options: nosniff` und keine `Referrer-Policy`. Besonders `/downloads/*` (JSON-Beispielsequenzen) und `/api/*` (Problem-Details-JSON) sind ohne `nosniff` MIME-Sniffing-Kandidaten. | Response-Headers-Policy auf **alle vier** Behaviors. Zwei Politiken sind sinnvoll: `npm-html` (volle CSP + HSTS, Default-Behavior) und `npm-api-static` (HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Resource-Policy: same-origin`, **ohne** CSP) für `/api/*`, `/catalog/*`, `/downloads/*`. Punkt in die Go-live-Checkliste. |
| SEC-17 (mittel) | **`/api/health` macht einen DB-Ping und ist `public`.** TK 7.2: „`GET /api/health` (Status, `ENGINE_VERSION`, DB-Ping)“ mit Aktion `public`. Damit ist eine unauthentifizierte Route vorhanden, die je Aufruf die Datenbank belastet – die billigste Verstärkung, die das System anbietet. Der Route-53-Check nutzt inzwischen korrekt `/api/health/shallow` (4.1, 16.2), aber die Go-live-Checkliste nennt weiterhin „Route-53-Health-Check `/api/health` grün“. | `/api/health` auf den DB-Ping **nur mit** Header `X-NPM-Deep: <Wert aus /nina-pm/origin-verify>` oder nur im System-Kontext; ohne den Nachweis antwortet es wie `shallow`. Eigene Drosselung 1 rps. Checklistenzeile auf `/api/health/shallow` korrigieren. |
| SEC-18 (mittel) | **`/api/nina/v1` wird global gedrosselt, nicht je Token.** TK 7.1: „Rate-Limits API GW global und je Route (`/api/nina/v1` getrennt)“. Die 20 rps gelten für **alle** Rigs aller Mandanten zusammen. Ein fehlkonfiguriertes oder übernommenes Plugin kann damit die Nacht aller anderen Rigs verderben, und die Aufnahme-Meldungen (Batches bis 500) landen im Backoff. | Zusätzlich eine Zählung je `nina_instance` in der Middleware (gleitendes Fenster, z. B. 120 Aufrufe/min; bei Überschreitung `429` mit `Retry-After`). Die Outbox des Plugins behandelt `429` schon korrekt (execution.md §8). Metrik `NinaThrottled` und Alarm, damit ein Dauerläufer auffällt. |
| SEC-19 (mittel) | **Kein CloudTrail festgelegt.** Volltextsuche `CloudTrail`, `GuardDuty`: **kein Treffer**. Ohne Trail lässt sich nach einem Vorfall nicht rekonstruieren, wer `ops-cli` aufgerufen, einen SSM-Parameter geschrieben oder einen Cluster gelöscht hat – der `system_audit` in der Anwendung endet genau dort, wo AWS-Zugriffe anfangen. Ein Trail für Verwaltungsereignisse ist im ersten Exemplar kostenfrei. | Einen Organisations-/Kontotrail mit S3-Ziel im Daten-Bucket (`audit/`, Lebenszyklus 400 Tage) in `NinaPm-Ops` anlegen und in TK 15/16.1 aufnehmen. Optional CloudWatch-Metrikfilter + Alarm auf `ops-cli`-Aufrufe und `ssm:PutParameter` unter `/nina-pm/jwt/*`. |
| SEC-20 (mittel) | **Sicherungen sind löschbar.** TK 6.10: AWS Backup täglich, 35 Tage, Cluster mit Löschschutz. Die CloudFormation-Ausführungsrolle (SEC-3) darf heute aber `dsql:DeleteCluster` und `backup:DeleteRecoveryPoint` – ein einziger fehlgeleiteter Deploy oder ein kompromittierter Workflow löscht Daten **und** Sicherungen. | Eigener Backup-Vault `nina-pm-prod` mit **Vault Lock** (Governance-Modus genügt: nur ein Principal mit `backup:DisableVaultLock`) und einer Vault-Zugriffspolitik, die `backup:DeleteRecoveryPoint` allen außer einer benannten Rolle verweigert. In `NinaPmDeployBoundary` (Abschnitt E.7) `dsql:DeleteCluster` und `backup:Delete*` explizit verweigern. |
| SEC-21 (niedrig) | **`/nina-pm/bootstrap-super-users` ist ein Eskalationspfad.** TK 5.4: `api` liest den Parameter, beim ersten Login einer gelisteten Discord-ID entsteht ein Super User. Wer den Parameter schreiben kann, wird Super User – ohne Einladung, ohne Spur in der Anwendung außer `system_audit.actor = 'bootstrap'`. | Explizites `Deny` auf `ssm:PutParameter` für diesen Pfad in allen Lambda-Rollen und in `NinaPmDeployBoundary`; in H-05/H-08 ergänzen, dass der Parameter nach dem ersten erfolgreichen Super-User-Login **auf leer** gesetzt wird (der Bootstrap bleibt damit eine einmalige Aktion) und der Vorgang im Runbook `superuser-emergency.md` steht. |
| SEC-22 (niedrig) | **Ein Konto für Website und NINA-PM, ohne Trennlinie.** TK 4.3/4.5: gleiche Route-53-Zone, gleiches Konto, Website-Distribution „nie ändern“ – durchgesetzt nur durch CDK-Assertions im eigenen Repo. Ein Fehler im Website-Deploy-Pfad (anderes Projekt, andere Regeln) kann NINA-PM erreichen und umgekehrt. | In `NinaPmDeployBoundary` ausdrücklich verweigern: alle `cloudfront:*Distribution*`-Aktionen auf `E2L6Q80SD8XPT0`, `route53:ChangeResourceRecordSets` ohne Bedingung `route53:ChangeResourceRecordSetsNormalizedRecordNames` mit Präfix `nina-pm`, und `s3:*` auf die Website-Buckets. Das ist die technische Fassung der Leitplanke, die bisher nur Text ist. |

---

## D. Anwendung und API (hoch/mittel)

| # | Befund | Fix |
|---|---|---|
| SEC-23 (hoch) | **Presigned PUT kann die Größe nicht erzwingen.** TK 12: „presigned PUT (5 min, Content-Type/Größe fix, max. 20 MB)“ bzw. 50 MB für Importe. Bei einem vorsignierten **PUT** wirken nur die mitsignierten Header; `Content-Length` ist nur erzwingbar, wenn der Client die Größe vorher nennt und der Server genau diesen Wert signiert. Ein Client kann sonst beliebig viel hochladen – in einen Bucket ohne Größenbegrenzung, danach parst eine Lambda die Datei. | Eine der beiden Varianten festschreiben: (a) **presigned POST** mit `conditions: [["content-length-range", 1, 20971520], ["eq", "$Content-Type", …]]` – erzwingt Größe und Typ serverseitig; oder (b) presigned PUT, bei dem der Client die Größe im Antrag nennt, der Server sie als `Content-Length` mitsigniert **und** der Folgeaufruf (`POST /transit-observations/{id}/results`) vor dem Parsen `HeadObject` prüft (Größe, `Content-Type`) und bei Abweichung den Schlüssel löscht. Variante (a) ist die klarere. |
| SEC-24 (mittel) | **`/api/auth/*` wird erst nach dem Datenbankzugriff gebremst.** TK 7.1: „für Anmelde-Endpunkte und Einladungs-Vorschau Zählung der letzten Fehlversuche aus `login_audit`“. Die Zählung braucht selbst eine Abfrage – ein Flood erzeugt also genau die Last, die er verhindern soll. | Routen-Drosselung am API Gateway vorschalten (SEC-15) und die `login_audit`-Zählung als zweite Stufe behalten. Zusätzlich die Fehlversuche nach Discord-ID **und** gekürzter IP zählen (heute nicht festgelegt, welche Dimension). |
| SEC-25 (mittel) | **CSP unvollständig neben `style-src`.** Es fehlen `script-src`, `object-src`, `base-uri`, `form-action`, `frame-src`, `worker-src` (Volltextsuche `script-src`: kein Treffer). `default-src 'self'` deckt das meiste ab, aber `base-uri` und `form-action` erbt es **nicht** – ein injizierter `<base>` oder ein umgelenktes Formular bleibt möglich. Der Comlink-Worker (TK 11.1) braucht `worker-src`; bei einem Vite-Build mit Inline-Worker auch `blob:`. | Vollständige CSP in TK 15 aufnehmen (Abschnitt E.8). |
| SEC-26 (mittel) | **Origin-Prüfung steht nur in den Regeln, nicht im Konzept.** `rules/security-auth.md`: „CSRF: Header `X-NPM-Request: 1` bei schreibenden Methoden **+ Origin-Prüfung**“. TK 5.3/15 nennen nur SameSite + Pflicht-Header. Zwei Quellen, zwei Umfänge – Claude Code folgt dem Brief, und der verweist auf TK. | TK 5.3 ergänzen: schreibende Anfragen verlangen zusätzlich `Origin` bzw. `Sec-Fetch-Site: same-origin`; fehlt beides → `403 auth.origin_invalid` (der Code existiert in `errors.json`). |
| SEC-27 (mittel) | **Import und Ergebnisdateien: nur Größengrenzen, keine Strukturgrenzen.** TK 12: Import bis 50 MB JSON, Job parst „in Stapeln“; Transit-Ergebnisse (HOPS/EXOTIC) werden von einer Lambda geparst. 50 MB JSON mit 10.000 Verschachtelungsebenen oder 2 Mio. Objekten legt den Parser lahm (15-min-Timeout, 2 GB Speicher) – ein authentifizierter Benutzer genügt. | Grenzen festschreiben: maximale Verschachtelungstiefe (z. B. 32), maximale Anzahl Objekte je Entität, streamendes Parsen (`stream-json`) statt `JSON.parse`, harte Obergrenze je Entität im zod-Schema; bei Überschreitung Job `failed` mit Grund. Für HOPS/EXOTIC zusätzlich: nur Textformate, keine `eval`-artige Auswertung, Zeilenlänge begrenzt. |
| SEC-28 (niedrig) | **Öffentliche Vorschaubilder sind ein Existenz-Orakel.** TK 12: `catalog/thumbs/<sha256(ra,dec,fov,rotation,survey)>.jpg` ist ohne Anmeldung über CloudFront abrufbar – „Himmelsausschnitte sind nicht mandantenbezogen“. Das stimmt inhaltlich; trotzdem verrät ein Treffer, dass **irgendwer** genau diese Koordinaten mit genau diesem Bildfeld geplant hat. Wer Koordinaten und Rig-Geometrie kennt, kann das bestätigen. | Als **akzeptiertes Restrisiko** in TK 12 und in die Datenschutzerklärung aufnehmen (eine Zeile). Wer es nicht will: Präfix mit einem serverseitigen Geheimnis salzen (`sha256(secret‖params)`) – dann ist der Schlüssel nicht mehr erratbar, der Cache bleibt erhalten. |
| SEC-29 (niedrig) | **Discord als einziger Identitätsanbieter, 2FA nur optional.** TK 5.2: `mfa_enabled` ist nur zum Anmeldezeitpunkt bekannt; der System-Kontext und Owner-Aktionen verlangen 2FA, normale Admins nur bei gesetzter Mandanteneinstellung `mfaRequiredForAdmins`. Eine Übernahme des Discord-Kontos eines Admins genügt damit für Schreibzugriff auf alle Projekte des Mandanten. | `mfaRequiredForAdmins` **standardmäßig `true`** (Änderung in FK 6.13/Schema-Kommentar) und beim Anlegen eines Mandanten im Owner-Onboarding sichtbar machen. Die Ausnahme für den Owner bleibt wie beschrieben. |
| SEC-30 (niedrig) | **Protokollaufbewahrung 90 Tage gegen Audit 12 Monate.** TK 4.2: Log-Aufbewahrung 90 Tage; TK 13: `login_audit` wird erst nach 12 Monaten gelöscht. Nach einem Vorfall, der älter als drei Monate ist, gibt es die Anwendungsspur, aber nicht mehr die technische. CloudWatch-Log-Gruppen sind außerdem nicht KMS-verschlüsselt (nicht erwähnt). | Log-Gruppen von `api` und `ops-cli` auf 400 Tage (Kosten gering bei dieser Last), `worker` bei 90 Tagen belassen; KMS-Verschlüsselung der Log-Gruppen mit dem Schlüssel aus SEC-6 erwähnen oder bewusst ablehnen. |

**Anwendungsseitig bestätigt (geprüft, kein Handlungsbedarf):** `__Host-`-Cookies mit HttpOnly/Secure und passendem SameSite je Zweck · Refresh-Rotation mit 60-s-Karenz, Zeitgrenze 10 min und Familienwiderruf · `state` im signierten Zwischen-Cookie, Discord-Access-Token wird nicht gespeichert · `next` nur relative Pfade (kein Open Redirect) · Einladungs-Token weder im Pfad noch in der Query (`POST /auth/invitations/preview`, Token im Body, DAT-20; Einladungs-Cookie statt `?invite=`, DAT5-15) · NINA-Token 256 Bit, nur `sha256` + Präfix gespeichert, an ein Rig gebunden, widerrufbar (unsalted ist bei 256 Bit Entropie korrekt) · Rechtematrix als Code mit generiertem Test je Route × Rolle · Mandanten-Guard im Repository mit Lint-Regel und Isolationstest · `AUTH_TEST_MODE` per CDK-Assertion und Smoke-Test ausgeschlossen · Webhook-URLs nur in SSM, Antwort nur `webhookHint`, Zielprüfung per Regex auf Discord-Hosts (kein SSRF-Primitiv) · Logs ohne Tokens/Cookies, IP gekürzt, Discord-ID als Pseudonym · keine CORS-Freigabe, gleicher Origin · Import aus Astro PM übernimmt keine Passwörter oder Lizenz-Tokens.

---

## E. Vorschläge als fertige Politiken

Diese Abschnitte sind als Ersatz für TK 4.2 („Wesentliche Ressourcen“) und TK 15 („IAM“, „Geheimnisse“) gedacht. Platzhalter: `<acct>` = Konto-ID, `<cid>` = DSQL-Cluster-Identifikator.

### E.1 `NinaPmApi` (Ausführungsrolle Lambda `api`)

```json
{ "Version": "2012-10-17", "Statement": [
  { "Sid": "Dsql", "Effect": "Allow", "Action": "dsql:DbConnect",
    "Resource": "arn:aws:dsql:eu-central-1:<acct>:cluster/<cid>" },

  { "Sid": "SsmRead", "Effect": "Allow", "Action": ["ssm:GetParameter","ssm:GetParameters"],
    "Resource": [
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/discord/client-id",
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/discord/client-secret",
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/jwt/signing-keys",
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/origin-verify",
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/origin-verify-prev",
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/dsql-endpoint",
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/bootstrap-super-users" ] },

  { "Sid": "SsmTenantWebhooks", "Effect": "Allow",
    "Action": ["ssm:GetParameter","ssm:PutParameter","ssm:DeleteParameter"],
    "Resource": "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/tenants/*/discord/*" },

  { "Sid": "Kms", "Effect": "Allow", "Action": ["kms:Decrypt","kms:Encrypt","kms:DescribeKey"],
    "Resource": "arn:aws:kms:eu-central-1:<acct>:key/<ssmKeyId>",
    "Condition": { "StringEquals": { "kms:ViaService": "ssm.eu-central-1.amazonaws.com" } } },

  { "Sid": "DataBucket", "Effect": "Allow", "Action": ["s3:GetObject","s3:PutObject"],
    "Resource": "arn:aws:s3:::svenesis-nina-pm-data/tenant/*" },

  { "Sid": "InvokeWorkerOnly", "Effect": "Allow", "Action": "lambda:InvokeFunction",
    "Resource": "arn:aws:lambda:eu-central-1:<acct>:function:nina-pm-worker" },

  { "Sid": "NeverTouchTheseSecrets", "Effect": "Deny",
    "Action": ["ssm:PutParameter","ssm:DeleteParameter"],
    "Resource": [
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/jwt/*",
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/bootstrap-super-users",
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/origin-verify*" ] }
]}
```

Kein `s3:DeleteObject` (Lebenszyklus löscht), kein `s3:ListBucket`, kein Zugriff auf den Web-Bucket, keine `sqs`-Rechte.

### E.2 `NinaPmWorker` (Ausführungsrolle Lambda `worker`)

```json
{ "Version": "2012-10-17", "Statement": [
  { "Sid": "Dsql", "Effect": "Allow", "Action": "dsql:DbConnect",
    "Resource": "arn:aws:dsql:eu-central-1:<acct>:cluster/<cid>" },

  { "Sid": "SsmRead", "Effect": "Allow", "Action": ["ssm:GetParameter","ssm:GetParameters"],
    "Resource": [
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/dsql-endpoint",
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/system/alarm-webhook",
      "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/web/build-id" ] },
  { "Sid": "SsmTenantWebhooksRead", "Effect": "Allow", "Action": "ssm:GetParameter",
    "Resource": "arn:aws:ssm:eu-central-1:<acct>:parameter/nina-pm/tenants/*/discord/*" },

  { "Sid": "Kms", "Effect": "Allow", "Action": ["kms:Decrypt","kms:DescribeKey"],
    "Resource": "arn:aws:kms:eu-central-1:<acct>:key/<ssmKeyId>",
    "Condition": { "StringEquals": { "kms:ViaService": "ssm.eu-central-1.amazonaws.com" } } },

  { "Sid": "DataBucket", "Effect": "Allow", "Action": ["s3:GetObject","s3:PutObject"],
    "Resource": "arn:aws:s3:::svenesis-nina-pm-data/tenant/*" },

  { "Sid": "WebThumbs", "Effect": "Allow", "Action": "s3:PutObject",
    "Resource": "arn:aws:s3:::svenesis-nina-pm-web/catalog/thumbs/*" },
  { "Sid": "WebAssetsCleanupList", "Effect": "Allow", "Action": "s3:ListBucket",
    "Resource": "arn:aws:s3:::svenesis-nina-pm-web",
    "Condition": { "StringLike": { "s3:prefix": "assets/*" } } },
  { "Sid": "WebAssetsCleanupDelete", "Effect": "Allow", "Action": "s3:DeleteObject",
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

Das `Deny` auf `lambda:InvokeFunction` ist bewusst: `worker` ruft nie eine Lambda auf, und ein späteres „nur mal schnell“ soll auffallen.

### E.3 `NinaPmMigrate` und `NinaPmDbBootstrap`

| Rolle | Rechte | Aufruf |
|---|---|---|
| `NinaPmMigrate` | `dsql:DbConnect` auf den Cluster (→ DB-Rolle `app_migrate`), `ssm:GetParameter` auf `/nina-pm/dsql-endpoint`, `kms:Decrypt` wie oben | CDK-`Trigger` bei jedem Deploy (unverändert) |
| `NinaPmDbBootstrap` | `dsql:DbConnectAdmin` auf den Cluster, `ssm:GetParameter` auf `/nina-pm/dsql-endpoint` | **kein** Trigger; einmalig `aws lambda invoke` (neue menschliche Aufgabe) |

Ressourcenbasierte Politik auf `nina-pm-db-bootstrap`: nur `NinaPmOpsInvoker` als Principal. Der Migrationsrunner prüft beim Start, ob `app_rw`, `app_job`, `app_migrate` existieren, und bricht sonst mit „Bootstrap fehlt“ ab.

### E.4 `NinaPmOpsCli` und `NinaPmOpsInvoker`

```json
// Vertrauensbeziehung von NinaPmOpsInvoker
{ "Version": "2012-10-17", "Statement": [{
  "Effect": "Allow", "Principal": { "AWS": "arn:aws:iam::<acct>:root" },
  "Action": "sts:AssumeRole",
  "Condition": { "Bool": { "aws:MultiFactorAuthPresent": "true" },
                 "NumericLessThan": { "aws:MultiFactorAuthAge": "3600" } } }]}
```

```json
// Rechte von NinaPmOpsInvoker
{ "Version": "2012-10-17", "Statement": [{
  "Effect": "Allow", "Action": "lambda:InvokeFunction",
  "Resource": [ "arn:aws:lambda:eu-central-1:<acct>:function:nina-pm-ops-cli",
                "arn:aws:lambda:eu-central-1:<acct>:function:nina-pm-db-bootstrap" ] }]}
```

Ausführungsrolle `NinaPmOpsCli`: `dsql:DbConnect` (DB-Rolle `app_rw`), `ssm:GetParameter` auf `/nina-pm/dsql-endpoint`, `kms:Decrypt`, `sns:Publish` auf das Alarm-Topic (jeder Notfallzugriff meldet sich selbst). Nichts weiter.

### E.5 `NinaPmSchedulerInvoke` (EventBridge Scheduler)

```json
{ "Version": "2012-10-17", "Statement": [{
  "Effect": "Allow", "Action": "lambda:InvokeFunction",
  "Resource": "arn:aws:lambda:eu-central-1:<acct>:function:nina-pm-worker" }]}
```

Vertrauensbeziehung: Principal `scheduler.amazonaws.com`, Bedingung `"aws:SourceArn"` auf die vier Zeitplan-ARNs (`…:schedule/nina-pm/tick-5min` usw.) – ohne diese Bedingung ist die Rolle ein Confused-Deputy-Kandidat.

### E.6 API Gateway (HTTP API)

| Einstellung | Wert | Begründung |
|---|---|---|
| Stage-Drosselung | 50 rps / Burst 100 | wie bisher |
| Route `ANY /api/nina/v1/{proxy+}` | 20 rps / Burst 40 | wie bisher; **zusätzlich** Zählung je `nina_instance` in der Middleware (SEC-18) |
| Route `ANY /api/auth/{proxy+}` | **5 rps / Burst 10** | neu (SEC-24): bremst vor dem DB-Zugriff |
| Route `GET /api/health` | **1 rps / Burst 2** | neu (SEC-17) |
| Reservierte Parallelität `api` | **20** | neu (SEC-15): Kosten, DSQL-Verbindungen, Schutz des Nachtbetriebs |
| Reservierte Parallelität `worker` | **5** | neu; Jobs sind idempotent und dürfen nachlaufen |
| Ressourcenpolitik | **nicht möglich** | HTTP APIs (API Gateway v2) unterstützen keine Ressourcenpolitik und keine WAF-Bindung – ausdrücklich im Konzept festhalten, damit später nicht danach gesucht wird. Ersatz: `X-Origin-Verify` in der Middleware (vorhanden) + Drosselung + reservierte Parallelität; WAF nur an der CloudFront-Distribution, mit Kostenhinweis. |
| Zugriffsprotokoll | JSON-Format mit `requestId`, `routeKey`, `status`, `ip` (gekürzt) | bisher nicht festgelegt; nötig, um SEC-15 überhaupt zu messen |

### E.7 `NinaPmDeployBoundary` (CloudFormation-Ausführungspolitik, SEC-3)

Erlauben: `cloudformation:*`, `s3:*` (nur auf `svenesis-nina-pm-*` und den CDK-Assets-Bucket), `lambda:*`, `apigateway:*`, `logs:*`, `events:*`, `scheduler:*`, `sqs:*`, `sns:*`, `cloudwatch:*`, `dsql:*` (ohne Delete, s. u.), `ssm:GetParameter*`/`PutParameter` (nur `/nina-pm/*`), `iam:*` (nur auf `arn:aws:iam::<acct>:role/NinaPm*`), `acm:*`, `cloudfront:*`, `route53:*`, `backup:*` (ohne Delete), `kms:*` (nur auf den eigenen Schlüssel).

Explizit verweigern – das ist der Kern:

```json
{ "Version": "2012-10-17", "Statement": [
  { "Sid": "NeverTouchWebsiteDistribution", "Effect": "Deny",
    "Action": ["cloudfront:UpdateDistribution","cloudfront:DeleteDistribution",
               "cloudfront:CreateInvalidation","cloudfront:TagResource"],
    "Resource": "arn:aws:cloudfront::<acct>:distribution/E2L6Q80SD8XPT0" },

  { "Sid": "OnlyNinaPmDnsNames", "Effect": "Deny",
    "Action": "route53:ChangeResourceRecordSets",
    "Resource": "*",
    "Condition": { "ForAnyValue:StringNotLike": {
      "route53:ChangeResourceRecordSetsNormalizedRecordNames":
        ["nina-pm.svenesis.org","*.nina-pm.svenesis.org","_*.nina-pm.svenesis.org"] } } },

  { "Sid": "NoDataDestruction", "Effect": "Deny",
    "Action": ["dsql:DeleteCluster","backup:DeleteRecoveryPoint","backup:DeleteBackupVault",
               "backup:DisableVaultLock","s3:DeleteBucket"],
    "Resource": "*" },

  { "Sid": "NoForeignRoles", "Effect": "Deny",
    "Action": ["iam:*"], "NotResource": "arn:aws:iam::<acct>:role/NinaPm*" }
]}
```

Cluster oder Vault löschen ist damit nur noch manuell mit Adminrechten möglich – genau wie das Restore-Runbook es ohnehin beschreibt.

### E.8 Vollständige CSP und Header (SEC-2, SEC-16, SEC-25)

```
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
```

`'unsafe-inline'` steht **nur** in `style-src` (Radix-Positionierung) – für Skripte bleibt es verboten, wie die Go-live-Checkliste verlangt. Zwei Response-Headers-Policies: `npm-html` (obige CSP + HSTS 2 Jahre inkl. `includeSubDomains`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`) für das Default-Behavior; `npm-api-static` (alles außer CSP, zusätzlich `Cross-Origin-Resource-Policy: same-origin`) für `/api/*`, `/catalog/*`, `/downloads/*`.

---

## F. UI-Layout: wo es beschrieben ist

**Ja, das Layout ist beschrieben – an vier Stellen, mit unterschiedlicher Tiefe.**

| Ort | Inhalt | Tiefe |
|---|---|---|
| **FK 14.1 Rahmen (Shell)** | ASCII-Skizze des Gesamtlayouts (Svenesis-Kopf → App-Leiste → Navigation links + Brotkrumen + Kontext-Aktionen → Arbeitsbereich → Fußzeile), dazu die Regeln für Navigation, Kopf/Fuß, Kontext-Aktionen, Erscheinungsbild und Rollenverhalten | einzige echte Layout-Zeichnung |
| **FK 14.2 Navigationsstruktur** | Tabelle aller neun Navigationsbereiche mit Einträgen und Sichtbarkeit je Rolle (Admin/User), inklusive der gegenüber Astro PM entfallenen Punkte | vollständig |
| **FK 14.3 Bildschirme im Detail** | **32 Bildschirme S-01 … S-82**, jeder mit Kopfbereich, Feldern, Abschnitten, Aktionen und Anforderungs-IDs (Beispiel S-40: Kopf, Schritt 1 Strategie, Übernahmestatus, Datumszeile, Schritt 2 Zielkarten, Schritt 3 Plan, Mehrnacht-Reiter) | feldgenau, aber **in Prosa, ohne Wireframe** |
| **FK 14.4 Wiederverwendbare Bausteine** | neun UI-Komponenten (Filter-Chip, Fortschrittsbalken, Nacht-Zeitleiste, Saisondiagramm, Astro-Wetter-Grafik, Koordinaten-Eingabe, Rig-Auswahl, Status-Kennzeichen, Prüfliste) mit Einsatzorten | Liste, keine Props/Zustände |
| **TK 11.1–11.4** | Technologiewahl (React 19, Radix, CSS Modules, TanStack), Ordnerstruktur `apps/web/src/`, **Design-Tokens mit Zahlenwerten** (Farben, Typografie 16/32/20/16,8 px, Karten-Radius 8, Schatten, Breakpoints 768/1280/1600), Kopf-/Fußzeile, Themes hell/dunkel/rot, Diagramm-Farbwelt, Druckansicht, Auth/Rechte im Frontend | die eigentliche Gestaltungsvorgabe |
| **`rules/ui.md`** + Brief-Checklisten | harte Regeln (i18n, Zeitzonen, `useCan` nur zum Ausblenden, Lade-/Leer-/Fehlerzustand je Seite) und je Bildschirm-Brief eine Checkliste „jedes Feld und jede Aktion aus FK 14.3 vorhanden“ | Abnahmekriterien |

**Was fehlt bzw. sich widerspricht:**

| # | Befund | Fix |
|---|---|---|
| UI-1 (hoch) | **Widerspruch bei der Mindestbreite.** `rules/ui.md`: „responsive bis **360 px**“, und **31 Brief-Checklisten** fordern „Breite 360 px ohne horizontales Scrollen“ (26 Bildschirm- und 5 Komponenten-Briefs). FK NFA-01 sagt dagegen „Desktop, Laptop und **Tablet** … keine mobile App“, und TK 11.3 nennt als Breakpoints 768/1280/1600 px, „600 px **nur** für Kopf/Fuß und Textseiten (keine mobile Unterstützung der Arbeitsseiten, NFA-01)“. Claude Code wird nach den Briefs arbeiten und alle 26 Arbeitsseiten auf 360 px optimieren – Aufwand für eine Breite, die das Fachkonzept ausdrücklich nicht verlangt. | Einheitlich auf NFA-01 ziehen: `rules/ui.md` und die Checkliste im Generator auf „**768 px** ohne horizontales Scrollen (Arbeitsseiten); Textseiten und Kopf/Fuß bis 600 px“ ändern. |
| UI-2 (mittel) | **Der Rotlicht-Modus hat kein Abnahmekriterium.** TK 11.3 nennt drei Themes mit Bezeichnern (`light`, `dark`, `red`), FK NFA-10 verlangt Dunkel- **und** Rotlicht-Modus; `rules/ui.md` und alle 31 Brief-Checklisten prüfen dagegen nur „Hell/Dunkel“ (Volltextsuche „Rotlicht“ in `work-packages/`, `rules/`, `ops/`: kein Treffer). Ein Rotlicht-Modus, der nirgends geprüft wird, entsteht nicht – und für ein Sternwarten-Werkzeug ist er die praktisch wichtigste Darstellung. | Checkliste im Generator auf „Hell/Dunkel/**Rotlicht**“ erweitern; für den Rotlicht-Modus eine eigene Token-Tabelle in TK 11.3 (nur Rottöne, keine blauen Akzente, Diagramm-Farbwelt angepasst) und einen Komponententest, der die berechneten Farben gegen die Tokens prüft. |
| UI-3 (mittel) | **Keine Komponentenverträge.** FK 14.4 listet neun Bausteine mit Einsatzorten, aber ohne Props, Zustände, Größen oder Verhalten bei Überlauf. Fünf Pakete (AP-10, AP-13e, AP-06b, AP-24, AP-25) liefern Komponenten; ihre Checkliste verweist nur auf „FK 14.4 (wiederverwendbare Bausteine) bzw. die genannte Anforderung“. Zwei Pakete werden dieselbe Nacht-Zeitleiste unterschiedlich bauen. | Eine Datei `claude-code/docs/specs/ui/components.md` mit je Baustein: Props (typisiert), Zustände (leer/laden/Fehler/deaktiviert), Mindest-/Maximalgrößen, Tastaturverhalten, Verhalten bei Überlauf. Das ist der fehlende Vertrag zwischen den fünf Paketen – sonst wird er implizit durch das erste Paket gesetzt. |
| UI-4 (niedrig) | **Kein Raster und kein Icon-Satz.** TK 11.3 legt Farben, Schriftgrößen, Radius und Schatten fest, aber keine Abstandsskala (4/8/12/16/24/32?) und keine Icon-Quelle – die Skizze in FK 14.1 nutzt Emoji (🔔, ☀/🌙/🔴). | Abstandsskala als Tokens (`--npm-space-1…6`) und eine Icon-Entscheidung (Vorschlag: Lucide, MIT, als React-Komponenten – kein Emoji in der Oberfläche, weil es plattformabhängig aussieht) in TK 11.3 nachtragen. |
| UI-5 (niedrig) | **Keine Wireframes je Bildschirm.** Nur FK 14.1 hat eine Zeichnung; die 32 Bildschirme sind Prosa. Für die datenintensiven Seiten (S-31 Editor, S-40 Simulator, S-61 Session-Detail) heißt das: die Anordnung entscheidet Claude Code. | Für genau diese drei Bildschirme eine ASCII-Skizze wie in 14.1 ergänzen (eine halbe Seite je Bildschirm). Für die übrigen genügt die Prosa – die Brief-Checkliste „jedes Feld aus FK 14.3“ ist dort ausreichend. |

**Bestätigt:** Die Gestaltungsvorgabe selbst (Farben, Typografie, Karten, Hinweisboxen, Kopf/Fuß, Breakpoints, Diagramm-Farbwelt) ist mit Zahlenwerten und Quellenangabe aus `www.svenesis.org` übernommen – das ist präziser als in den meisten Konzepten und reicht für eine konsistente Umsetzung aus.

---

## G. Empfohlene Reihenfolge

1. **SEC-2** (CSP) und **SEC-16** (Header auf allen Behaviors) – betrifft AP-02a/AP-06a und fällt sonst erst in prod auf.
2. **SEC-1** (Migrate-Adminrechte) und **SEC-3** (Deploy-Rolle) – betrifft AP-02a und die menschlichen Aufgaben H-04/H-05.
3. **SEC-4 bis SEC-14** als ein Block: die Politiken aus Abschnitt E.1–E.5 in TK 4.2/15 aufnehmen, dazu die Rollennamen in der Schema-GRANT-Vorlage.
4. **SEC-15, SEC-17, SEC-18, SEC-24** (Drosselung, Parallelität, Health) – eine Tabelle in TK 4.2, Abschnitt E.6.
5. **SEC-23** (presigned POST) – betrifft AP-14b und die Verträge.
6. **UI-1** und **UI-2** im Generator, **UI-3** als neue Spec – vor AP-06a.
7. Der Rest (SEC-19 bis SEC-22, SEC-25 bis SEC-30, UI-4/UI-5) kann bis AP-17 mitlaufen, gehört aber in die Go-live-Checkliste.

## Antwort auf die Fragen

- **Ist die Anwendung sicher?** Die Anwendungsschicht ja – Anmeldung, Sitzungen, CSRF, Rechte und Mandantentrennung sind vollständig und mit Tests hinterlegt. Ich habe dort keinen Entwurfsfehler gefunden, nur Feinschliff (SEC-23 bis SEC-30).
- **Ist die API sicher?** Im Kern ja (zod überall, Fehlercodes aus einer Quelle, Größen- und Laufzeitgrenzen, ETag/If-Match, Idempotenz). Die Lücken sind Verfügbarkeit statt Vertraulichkeit: Drosselung je Token fehlt, `/api/auth/*` und `/api/health` sind zu billig aufzurufen.
- **Least Privilege bei API Gateway und Lambda?** **Noch nicht.** Zwei ausdrückliche Verstöße (SEC-1 Adminrechte bei jedem Deploy, SEC-4 geteilte Rolle) und fünf Rechte, die überhaupt nicht festgelegt sind (Invoke, SQS, KMS, Scheduler, Deploy-Politik). Mit den Politiken in Abschnitt E ist es in einem Durchgang erledigt – wichtig ist, dass es **vor** AP-02a im Konzept steht, weil Claude Code sonst eigene, weitere Rechte erfindet.
- **Ist das UI-Layout beschrieben?** Ja: FK 14.1–14.4 (Shell-Skizze, Navigation, 32 Bildschirme feldgenau, Bausteine) und TK 11.1–11.4 (Technik, Tokens mit Zahlenwerten, Kopf/Fuß, Themes). Es fehlen Wireframes für die drei komplexesten Bildschirme, Komponentenverträge und eine Abstandsskala; und die Mindestbreite widerspricht sich zwischen Briefs (360 px) und Fachkonzept (Tablet aufwärts).
