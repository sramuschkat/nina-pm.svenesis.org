# Changelog

Änderungen je Arbeitspaket, neueste oben. Versionen und Tags setzt Sven (`v*`, `plugin-v*`).

## [Unveröffentlicht]

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
