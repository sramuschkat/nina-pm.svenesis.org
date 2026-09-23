# Changelog

Änderungen je Arbeitspaket, neueste oben. Versionen und Tags setzt Sven (`v*`, `plugin-v*`).

## [Unveröffentlicht]

### AP-05 – Shared: Rechte, Fehler, Verträge, Middleware, Job-Infrastruktur (2026-09-23)

Anforderungen: FK 6.14, TK 5.3 (CSRF), 5.5, 7.1, 7.4, 7.5, 12, 13; SV-03, SV-04, SV-06, SV-09, SV-16; SEC-23, SEC-51, SEC-56, SEC-57; DAT5-1; NT-01.

- Verträge: `errors.json` mit `titleEn` für alle 63 Codes; `enums.json` um `jobKinds: noop` sowie `uploadPurposes` (`transit_result`, `tenant_import`, `plan_log`) und `downloadPurposes` (`job_result`, `export`) ergänzt (additiv, Master-Paket nachgezogen).
- `packages/shared`: `errors.ts`/`enums.ts` generiert (`pnpm contracts:generate`), `ProblemError`, `AuthContext` und Sitzungskonstanten, `permissions.ts` mit `can()` nach TK 5.5/FK 6.14 (Owner-Regeln, Admin ohne 2FA = User, System-Kontext nur `system.*`), `currentNight` mit gemeinsamen Testvektoren `contracts/test-vectors/current-night.json` (auch für `NinaPm.Core.Tests`, AP-16b), zod-Basisschemas (Nacht-Tabelle, Jobs mit `nights ≤ 14`, Dateien, Problem Details), Parser für hochgeladenes JSON (`JSON.parse` + `.max()`-Grenzen → `validation.failed`).
- `packages/i18n`: `errors.*` DE/EN aus `errors.json` generiert.
- `apps/api`: Middleware-Kette Request-ID → Origin-Verify → Logging mit Redaktion → CSRF (`X-NPM-Request: 1`, `/api/nina/v1` ausgenommen) → Sitzung (Stub bis AP-04a: anonym) → `authorize(action)` je Route; Problem Details aus `errors.json`, Validierung → `422 validation.failed` mit `errors[]`, unerwartete Fehler → `500 internal.error` nur mit `requestId`.
- Routen-Registry mit `meta.action` (`x-npm-action` in OpenAPI); OpenAPI 3.1 generiert und eingecheckt (`docs/api/openapi.yaml`, `pnpm --filter @nina-pm/api openapi:generate`, Diff-Test); Rechte-Testgenerator Route × {Owner, Admin, Admin ohne 2FA, User, fremder Mandant, anonym, Super User}.
- Routen `GET /api/web/v1/jobs/{id}` (`job.read`) und `GET /api/web/v1/files/download-url` (feste Aktion je Zweck, Schlüssel serverseitig).
- Upload-Helfer `createUploadTicket`: presigned POST mit `content-length-range`, `eq $Content-Type` und `eq $key` (nie `starts-with`), `uploadTicketId` HMAC-signiert (Schlüssel aus `/nina-pm/oauth/cookie-secret` abgeleitet) mit `verifyUploadTicket`; Tests mit Nachbildung der S3-Politikprüfung statt MinIO.
- Jobs: `JobRepository` (Dedupe über `dedupe_active` mit `ON CONFLICT DO NOTHING`, höchstens 3 offene `multi_sim`/`impact` je Mitglied mit Wächter auf `app_user` → `429 auth.rate_limited`), `JobQueue` für den `worker`, `enqueueJob` (async Invoke nur mit `{jobId}`), Dispatcher mit Registry und Beispiel-Job `noop`, `tick-5min` übernimmt liegengebliebene Jobs (Zeitplan-Jobs zuerst, 3 Versuche, `discord_post` 5). Suite D-07 für PostgreSQL (CI) und `pnpm test:dsql`.

### AP-03 abgenommen (2026-09-23)

- Deploy mit Migration durch Sven: On-Demand-Backup vor dem Deploy, `nina-pm-migrate` legte Migration 0000 (zwei Rollen, drei `AWS IAM GRANT`s) und 194 Anweisungen an, Smoke grün. Die erste Migration lief rund 13 min (Grenze 15 min); Folgemigrationen sind klein, ein Abbruch würde beim nächsten Deploy fortgesetzt.
- CDK: `addStackDependency` statt des veralteten `addDependency`.

### AP-03 – Datenbankpaket und Migrationen (2026-09-23)

Anforderungen: TK 6.1–6.9, NFA Mandantenisolation, `iam.md` §4, §12 Nr. 4, TK 17, TK 18, ADR-S1.

- `packages/db`: Verbindung über den DSQL-Connector bzw. PostgreSQL (Repeatable Read), `withTx` mit OCC-Wiederholung, Wächtern in fester Reihenfolge und Zeilenzähler (≤ 3.000), Mandanten-Guard (`TenantRepo`) mit Beispiel `TenantRepository`.
- Migrationen 0001–0005 aus dem Schema (51 Tabellen, 50 Indizes), je Tabelle beide GRANT-Sätze nach TK 6.2 (`src/grants.ts`); Runner mit Buchführung je Anweisung und `CALL sys.wait_for_job`; Migration 0000 (Rollen, `AWS IAM GRANT`, idempotent, ohne `GRANT USAGE ON SCHEMA`).
- DSQL-Lint (`pnpm db:lint`, Teil von `pnpm lint`) mit allen Verboten aus TK 6.8/ADR-S1 und GRANT-Prüfung je neue Tabelle.
- Prüf-Suites D-01…D-06 (Idempotenz, Rechte-Matrix, SEC-4, OCC-Wiederholung, 3.000 Zeilen, Isolation mit Gegenprobe) für CI (PostgreSQL-16-Service) und `pnpm test:dsql` (DSQL, H-22).
- `NinaPm-Migrate`: Lambda `nina-pm-migrate` mit Rolle `NinaPmMigrate` als CDK-Trigger vor Api und Jobs; `DSQL_DB_ROLE` je Lambda; Assertion 4.
- `pnpm db:up/db:migrate/db:seed`, `docker-compose.yml`; Seed für Mandanten, Identitäten, Super User und Mitgliedschaften.
- `pnpm deploy:prod`: bei neuen Migrationen grünes `test:dsql`-Protokoll für den Stand verlangt, On-Demand-Backup vor dem Deploy.
- `pnpm test:dsql` durch Sven (H-22, 23.09.2026) grün gegen DSQL: 194 Anweisungen idempotent, 412 Rechte wie TK 6.2 (inkl. Spaltenrechte), SEC-4, OCC-Wiederholung, 3.000-Zeilen-Grenze (54000), Isolation; Protokoll `docs/test-runs/2026-09-23/ap-03/`.

### AP-02b – Alarme erreichen SNS (2026-09-23)

- Nach dem ersten Deploy meldete CloudWatch „Failed to execute action“ für das Topic `nina-pm-alarms`. Die eigene Topic-Richtlinie (Freigabe für Budgets) ersetzte die Standardrichtlinie, und die TLS-Deny-Regel aus `enforceSSL` blockierte zusätzlich. Die Richtlinie erlaubt jetzt `cloudwatch.amazonaws.com` ausdrücklich (auf das Konto begrenzt); `enforceSSL` am Topic entfällt. Assertion ergänzt.

### AP-02b – CDK: Api, Jobs, Ops (2026-09-23)

Anforderungen: TK 4.1, 4.2, 7.4, 13, 16.1, 16.2; `specs/infra/iam.md` §1–§3, §5, §6, §8, §9, §11, §12; `rules/api.md`.

- `apps/api`: Hono-App mit `GET /api/health` ohne DB-Ping (Status, `ENGINE_VERSION`, Build), Origin-Verify-Middleware (SSM-Cache 5 min, Vergleich in konstanter Zeit, sonst `403 permission.denied`), Problem Details aus `errors.json`; Worker-Dispatcher für `{tick}` und `{jobId}`; `ops-cli` mit `help` und `list-failed-jobs`.
- `NinaPm-Jobs`: `nina-pm-worker` (2048 MB, 15 min, reserviert 5), SQS `nina-pm-worker-failures` (SSE-SQS, 14 Tage, nur TLS), `EventInvokeConfig` ohne Wiederholung mit `onFailure`, vier Zeitpläne über `LambdaInvoke`.
- `NinaPm-Api`: HTTP API, `nina-pm-api` (1024 MB, 29 s, reserviert 20), Drosselung Stage 50/100, Routen nach `iam.md` §9, Zugriffsprotokoll als JSON **ohne IP** (API Gateway kann sie nicht kürzen; Entscheidung Sven).
- `NinaPm-Ops`: `nina-pm-ops-cli` (nur `aws lambda invoke`), SNS `nina-pm-alarms` mit E-Mail, neun Alarme nach TK 16.2, Route-53-Health-Check auf `/api/health` über CloudFront **ohne Alarm** (Metriken nur in us-east-1; Entscheidung Sven), Budget 20 USD.
- Je Lambda eine Rolle mit festem Namen über CDK-Grants genau nach `iam.md` §2, §3, §5; nur `AWSLambdaBasicExecutionRole`; X-Ray aktiv; alle Log-Gruppen 90 Tage (auch die Hilfs-Lambda der Platzhalterseite).
- `NinaPm-Edge`: `/api/*` an die HTTP API mit `X-Origin-Verify` aus `/nina-pm/origin-verify`, alle Methoden, ohne Cache.
- CDK-Assertions Nr. 1, 2, 3, 8, 9 und die Rechte-Tabellen als Tests; zwei Fehler dabei gefunden und behoben (Leserecht der API auf den Alarm-Webhook, Groß-/Kleinschreibung der Routen-Drosselung).
- `pnpm deploy:prod` prüft `/nina-pm/origin-verify` vorab; Smoke prüft `/api/health` und den Direktaufruf der execute-api-Adresse (403).

### ADR-S1 in Konzepte und Regeln übernommen (2026-09-23)

Entscheidung Sven. Technisches Konzept 1.22, Schema 1.19 (nur GRANT-Vorlage und Hinweise), `docs/concept/INDEX.md` neu erzeugt.

- `CLAUDE.md` Regel 1, TK 6.0, `rules/dsql.md`: `ADD COLUMN` nur ohne `DEFAULT`/Constraint, danach `SET DEFAULT` und Nachfüllen in Stapeln; kein `SET NOT NULL`; Grenzen 10 MiB und 300 s je Transaktion.
- TK 6.8, `rules/dsql.md`, Schema: Warten auf ASYNC-Jobs mit `CALL sys.wait_for_job('<job_id>')`; DSQL-Lint um die neuen Verbote erweitert.
- TK 6.8, `specs/infra/iam.md`, GRANT-Vorlage: Migration 0000 ohne `GRANT USAGE ON SCHEMA public`, Idempotenz über `pg_roles` und `sys.iam_pg_role_mappings`.
- TK OT-06 als erledigt markiert. Gleiche Änderungen im Master (Projektordner, `claude-code/`, `claude-code.zip`), dort zusätzlich `docs/adr/ADR-S1-dsql.md`.

### AP-S1 – Spike Aurora DSQL, Prüfskript (2026-09-23)

Anforderungen: TK 6.0, TK 6.5, 6.6, 6.8, TK 17, TK 18, `rules/dsql.md`.

- `pnpm test:dsql --spike` (`tools/deploy/src/test-dsql.ts`): kurzlebiger DSQL-Cluster mit Tag `purpose=ci`, Löschen im `finally` auch bei Fehler und Ctrl-C, Warnung vor übrig gebliebenen Test-Clustern; nur Sven führt es aus (H-22).
- `spikes/dsql`: zehn Prüfpunkte in der Reihenfolge aus TK 6.0 (Fremdschlüssel, `jsonb`, `ADD COLUMN DEFAULT`, `FOR UPDATE`, `ON CONFLICT`, Wartefunktion für `CREATE INDEX ASYNC`, `AWS IAM GRANT`, Node-Connector und Latenz, Grenzen je Transaktion, Nicht-Unterstütztes); Protokoll je Schritt mit Befehl, Ergebnis und Dauer nach `docs/test-runs/<datum>/ap-s1/`.
- Tests mit gemocktem AWS SDK (Tag, Löschen im `finally`) und einer gefälschten Datenbank für alle Prüfpunkte.
- Zwei Läufe durch Sven (H-22): Fremdschlüssel, `jsonb`, `FOR UPDATE`, `ON CONFLICT`, `AWS IAM GRANT`, Connector und Grenzen bestätigt (3.000 Zeilen, 10 MiB, 300 s). Abweichungen: `ADD COLUMN … DEFAULT` und `SET NOT NULL` nicht unterstützt, `GRANT USAGE ON SCHEMA public` nicht unterstützt (und nicht nötig), `sys.wait_for_job` ist eine Prozedur (`CALL`).
- `docs/adr/ADR-S1-dsql.md` angenommen (Go durch Sven), mit Ergebnissen und Änderungsvorschlägen für `CLAUDE.md`, TK 6.0/6.8, `rules/dsql.md` und die GRANT-Vorlage.

### Deploy: Vorprüfung Backup-Vault (2026-09-23)

- Erster `pnpm deploy:prod` scheiterte am Backup-Plan, weil der AWS-Backup-Standard-Vault `Default` im Konto fehlte. `pnpm deploy:prod` prüft ihn jetzt vorab und nennt den Befehl zum Anlegen; H-04 um diesen einmaligen Schritt ergänzt.
- `cdk diff` im Deploy-Skript ohne das unbekannte `--all`.

### AP-02a – CDK-Grundgerüst: Data, Config, Cert, Web, Edge (2026-09-23)

Anforderungen: TK 4.1–4.5, ADR-14, NFA Betrieb, TK 15.1, TK 18, `specs/infra/iam.md` §7, §8, §10–§12.

- CDK-App `infra/` mit den Stacks `NinaPm-Data`, `NinaPm-Config`, `NinaPm-Cert` (us-east-1), `NinaPm-Web` und `NinaPm-Edge`; Konto und Hosted Zone aus H-01 in `config.ts` und `cdk.context.json`.
- Data: DSQL-Cluster mit Löschschutz und `RETAIN`, Tag `purpose=prod`, Import-Modus `-c dsqlClusterId=…`; Daten-Bucket mit Block Public Access, Versionierung, TLS-Pflicht und `RETAIN`; AWS-Backup-Plan täglich, 35 Tage, Standard-Vault, Auswahl per Cluster-ARN.
- Edge: CloudFront mit OAC, vier Behaviors mit `npm-html` bzw. `npm-api-static` nach `iam.md` §10, Viewer-Request-Funktion nach TK 4.3, Alias A/AAAA `nina-pm`, `/nina-pm/web/build-id`, Platzhalterseite.
- CDK-Assertions Nr. 5, 6, 7, 10 und Backup-Plan als Tests in `infra/test/`; `cdk synth` ohne AWS-Zugang im CI.
- `pnpm deploy:prod` im Grundzug (`tools/deploy`, nur Sven) und Smoke-Prüfung (`tools/smoke`).

### Release-Reihenfolge: NINA-Plugin als Block RP direkt vor R4 (2026-09-23)

Entscheidung Sven. Fachkonzept 1.21 (Kap. 11), Technisches Konzept 1.21 (Kap. 19), `docs/concept/INDEX.md` neu erzeugt.

- AP-S2b, AP-S2c, AP-08c, AP-S2a und AP-16a–h bilden den neuen Block **RP** zwischen R3 und R4 (`docs/work-packages/README.md`, Briefe mit `Release: RP`).
- R1 heißt „MVP Planung“ und geht ohne Plugin live. NINA-API (AP-14a–c) und Fake-Plugin bleiben in R1. AP-17 hängt nicht mehr von AP-16h ab.
- Die Plugin-Nacht P-05 wandert aus der Go-live-Checkliste in die menschliche Freigabe von AP-16h.
- H-14 wird erst für RP gebraucht (`docs/ops/human-tasks.md`, `START.md`).
- Wo FA-NIN-* oder `specs/nina/execution.md` „R1“ nennen, ist der Plugin-Umfang von RP gemeint.

### AP-01 – Monorepo-Gerüst (2026-09-23)

Anforderungen: NFA Wartbarkeit, TK 3.1, TK 3.2, TK 18 (`ci.yml`), FK 9, `rules/testing.md`.

- pnpm-Workspace nach TK 3.1: `apps/web` (Vite, React), `apps/api` (tsup, je ein Bundle für `api`, `worker`, `migrate`, `ops-cli`), `packages/{shared,db,engine,i18n,ui-tokens,catalog-data}`, `infra`, `tools/repo-check`; `apps/nina-plugin` als Platzhalter für AP-S2c.
- TypeScript strict (`tsconfig.base.json`, ES2022, `moduleResolution bundler`), ESLint (typescript-eslint strict), Prettier, Vitest. TypeScript 6.0, weil typescript-eslint TypeScript 7 noch nicht unterstützt.
- Engine-Regel in ESLint als Allowlist nach `rules/engine.md`: nur `Math.abs/floor/ceil/trunc/min/max/sign/sqrt/PI`; verboten sind jedes andere `Math`-Member, `**`, `toFixed`/`toPrecision`/`toString(radix)`, BigInt, `Date`, `Intl`, Timer, `process`, `fetch` und nicht-relative Importe. Test `packages/engine/test/lint-rules.test.ts`.
- ESLint-Regel nach TK 3.2: `packages/db/src/connection` nur aus `packages/db/src/repositories` importierbar. Test `packages/db/test/lint-rules.test.ts`.
- `packages/catalog-data`: Kopie von `data/` und `js/dso-catalog.js` aus `legacy/astro-tools-2026-09-21/` (H-03), schreibgeschützt, README mit Herkunft, Datum und Lizenzen.
- `tools/repo-check`: Prüfsummen-Test, der Änderungen an `legacy/astro-tools-2026-09-21/` und `packages/catalog-data/` im CI erkennt.
- `.github/workflows/ci.yml` (install, lint, typecheck, test, build) und gitleaks.
- `THIRD_PARTY_NOTICES.md` um OpenNGC (CC BY-SA 4.0), d3-celestial (BSD 3-Clause) und die Datenquellen der Katalogdaten ergänzt.
- `docs/CHANGELOG.md` angelegt.
