# Svenesis NINA-PM

Web-App (React/TS) + AWS-Backend (CDK, Lambda/TS, API Gateway, Aurora DSQL, S3) + NINA-Plugin (C#) zur Planung von Astrofotografie-Projekten, die NINA automatisch ausführt. Einzige Umgebung: **prod** unter `https://nina-pm.svenesis.org`.

## So arbeitest du hier
1. Nächstes Arbeitspaket mit Status ☐ in `docs/work-packages/README.md` wählen, dessen Abhängigkeiten ☑ sind (die Reihenfolge innerhalb eines Releases ist **verbindlich**, `docs/work-packages/README.md`), und dessen Brief `docs/work-packages/AP-xx.md` lesen. Status höchstens auf ◐ setzen; ☑ nur auf Svens ausdrückliche Abnahme – eingetragen im **nächsten Paket-PR**, kein eigener Status-PR.
2. **Nur** die im Brief unter „Lesen“ genannten Abschnitte laden (Zeilenbereiche in `docs/concept/INDEX.md`). Die vollständigen Konzepte liegen in `docs/concept/` – nicht komplett einlesen.
3. Menschliche Aufgaben aus `docs/ops/human-tasks.md` prüfen: fehlt eine **Voraussetzung (Start)**, nachfragen statt umgehen; eine offene **Abnahme**-Aufgabe hält nur den Abschluss auf (PR liefern, Status ◐ lassen).
4. Verträge zuerst (`packages/shared/contracts`, Enums/Fehler aus `docs/contracts`), dann Implementierung, dann Tests.
5. Bei Unklarheit in einer Spec: nicht raten – Frage stellen und Spec-Ergänzung vorschlagen. **Vorrang bei Widersprüchen:** Brief > `docs/specs/` und `docs/contracts/` > `docs/rules/` > Technisches Konzept > Fachkonzept.
6. PR mit AP-ID + Anforderungs-IDs, Basis immer `main` (auch bei aufeinander aufbauenden Paketen); Changelog-Eintrag als Datei `docs/changelog.d/YYYY-MM-DD-<ap>.md` (nicht `docs/CHANGELOG.md` direkt, `pnpm changelog:collect` sammelt). Sven landet PRs mit `pnpm pr:land <nr…> [--deploy]`. Menschliche Freigaben nie selbst abhaken; keine Tags/Releases setzen (macht Sven).

## Karte
| Bereich | Datei |
|---|---|
| Regeln (immer gültig) | `docs/rules/dsql.md`, `engine.md`, `security-auth.md`, `api.md`, `ui.md`, `testing.md` |
| Engine-Specs | `docs/specs/engine/allocation.md` (Algorithmus nach Astro-PM-Plugin, Abweichungen §10), `moon.md`, `sort-chain.md`, `flip-rotation.md`, `transit.md`, `effort.md`, `geometry.md`, `night.md`, `canonical-json.md` |
| Plugin-Ausführung | `docs/specs/nina/execution.md` (Muster nach Astro-PM-Plugin; Neuplanung, Transit, Lease, Offline, Flats, Test-Server) |
| Infrastruktur / IAM | `docs/specs/infra/iam.md` (eine Rolle je Lambda über **CDK-Grants**, Tabelle Rolle → Ressource → Grant; Drosselung, CloudFront-Header). **Keine `*`-Ressourcen auf DSQL, S3, SSM, Lambda-Invoke; keine Managed Policies an Lambda-Rollen außer `AWSLambdaBasicExecutionRole`** (SV-13) – braucht eine Lambda mehr, Tabelle in `iam.md` im selben PR ergänzen |
| Oberfläche | `docs/specs/ui/components.md` (Verträge der zehn Bausteine, Symbole, Abstände); Arbeitsseiten ohne Breitenobergrenze, Mindestbreite 768 px, **zwei** Themes (`light`/`dark`, kein Rotlicht), Dichte-Schalter `compact`/`normal`/`wide` |
| Plugin-Tests | `docs/ops/plugin-test-protocol.md` (P-01…P-24, `result.json`, Log-Grammatik) |
| Soll-Pläne | `docs/contracts/golden-plans/` (Paint in AP-13b, Ablauf in **AP-13d**; Orakel aus AP-13a) |
| Aufzählungen / Fehlercodes | `docs/contracts/enums.json`, `docs/contracts/errors.json` |
| NINA-API-Beispiele | `docs/contracts/nina/` |
| Seed-Daten | `docs/seed/README.md`, `docs/seed/seed-demo.json` |
| Einstieg / ADR | `START.md` (Sitzung 1), `docs/adr/ADR-TEMPLATE.md` |
| Abschnitt → Zeilen | `docs/concept/INDEX.md` (zum gezielten Laden von FK/TK-Abschnitten) |
| Betrieb | `docs/ops/human-tasks.md`, `golive-checklist.md`, `plugin-test-protocol.md`, `discord-embeds.md` |
| Konzepte (Nachschlagen) | `docs/concept/Fachkonzept_Svenesis-NINA-PM.md` (FA-/NFA-IDs, S-Bildschirme), `docs/concept/Technisches_Konzept_Svenesis-NINA-PM.md`, `docs/concept/schema_aurora_dsql.sql` |

## Umgebung: was läuft lokal, was nur im CI
| Prüfung | lokal | CI |
|---|---|---|
| Lint, Typecheck, Unit-/Engine-Tests | ja | ja |
| PostgreSQL 16 (Repository-Tests, Seed) | nur mit Docker; fehlt Docker, entfällt der lokale Lauf | ja (Service-Container) |
| Playwright-E2E | nur mit installierten Browsern | ja |
| .NET 8: `NinaPm.Core` + `NinaPm.Core.Tests`, Jint-Parität, Orakel | ja, mit SDK und NuGet-Zugang – auch auf macOS und Linux | ja (`plugin.yml`, `oracle.yml`) |
| .NET 8: `NinaPm.Nina`, `NinaPm.Nina.Tests` und `NinaPm.Nina.Ui` **bauen** | ja, gegen die NuGet-Pakete `NINA.*` (TK 10.5, ADR-S2c, keine `-p:`-Schalter nötig) | ja (Auftrag `cross-build`) |
| .NET 8: Adapter-Tests **ausführen** | nein – nur Windows | ja (`plugin.yml` auf `windows-latest`) |
| Plugin **ausführen** (NINA, ASCOM) | nein – Windows-Rechner aus H-14 | nein (manuelle Protokolle, H-15) |
| Python/astropy-Fixtures | optional (H-10) | ja (`reference.yml`, gebündelte IERS-Daten) |
| DSQL (Migrationen, OCC, `pnpm test:dsql`, Spike AP-S1) | nur Sven, lokal mit Admin-Profil gegen einen kurzlebigen Cluster (H-22); Claude Code schreibt Skripte und Tests und wertet das Protokoll aus | nein |
| C#-Quellen des Astro-PM-Plugins laden | nur mit GitHub-Zugang | ja (Skript in `oracle.yml`) |
| AWS-Deploy (`pnpm deploy:prod`) | nur Sven, lokal mit Admin-Profil (H-06); **Claude Code deployt nie** | nein – GitHub hat keinen AWS-Zugang |

Fehlt lokal ein Werkzeug oder der Netzzugang: **nicht improvisieren**, sondern den PR eröffnen und das Ergebnis des CI-Laufs auswerten (`gh run view --log-failed`). Was ausschließlich im CI läuft, gilt erst mit grünem Lauf als erledigt; was nur Sven lokal ausführt (DSQL-Tests, Deploy), erst mit seinem Protokoll.

## Befehle
- `pnpm i` · `pnpm build` · `pnpm test` · `pnpm lint` · `pnpm typecheck`
- `pnpm db:up` · `pnpm db:migrate` · `pnpm db:seed`
- `pnpm dev:web` · `pnpm dev:api`
- `pnpm cdk synth` (ohne AWS-Zugang; Lookup-Werte aus der eingecheckten `cdk.context.json`) · Deploy nur durch Sven mit `pnpm deploy:prod` (H-06)
- `pnpm pr:land <nr…> [--deploy]` (nur Sven: auf CI warten, mergen, optional deployen) · `pnpm changelog:collect`
- `pnpm golive:check` · `pnpm loadtest:prod` · `pnpm alarm:probe` (nur Sven, AWS/prod; Protokolle unter `docs/test-runs/`) · Runbooks in `docs/runbooks/`
- `pnpm e2e` · `pnpm fake-plugin` · `pnpm engine:bundle` · `pnpm nina-test-server` · `pnpm test-run:check <ordner>` · `pnpm oracle:run <grid>`
- `dotnet build apps/nina-plugin/NinaPm.Core` · `dotnet test apps/nina-plugin/NinaPm.Core.Tests` · `dotnet build apps/nina-plugin/NinaPm.Nina` · `dotnet build apps/nina-plugin/NinaPm.Nina.Tests` · `dotnet build apps/nina-plugin/NinaPm.Nina.Ui` · `tools/nina-build-check.sh apps/nina-plugin` (lokal vor jedem Plugin-PR, TK 10.5) · Adapter-Tests ausführen nur auf `windows-latest`

## Harte Regeln (Kurzfassung – Details in `docs/rules/`)
1. Aurora DSQL: keine Trigger/PL/pgSQL/TRUNCATE/TEMP TABLE/ON DELETE-Aktionen/ALTER COLUMN TYPE; Indizes nur `CREATE INDEX ASYNC`; eine DDL je Transaktion; ≤ 3.000 Zeilen je Transaktion; OCC-Retry über `withTx`; Invarianten mit `guard` (`SELECT … FOR UPDATE`). FKs und jsonb sind erlaubt; `ADD COLUMN` nur ohne `DEFAULT`/Constraint (Default danach per `SET DEFAULT`, Bestand in Stapeln nachfüllen, nachträglich kein `NOT NULL`); Warten auf ASYNC-Jobs mit `CALL sys.wait_for_job`; Grenzen 10 MiB und 300 s je Transaktion (ADR-S1).
2. Datenbankzugriff nur in `packages/db/src/repositories`, jede Abfrage mandantengebunden.
3. Jede Route deklariert eine Berechtigungs-Aktion und hat generierte Rechte-Tests.
4. Engine rein und deterministisch: kein `Date`/`Intl`/`Math.random`/I/O; Trigonometrie nur aus `engine/src/math`; Hashes über `canonicalInputJson`; Soll-Pläne exakt.
5. Anmeldung nur Discord; Geheimnisse nur in SSM; nie in Code, Logs, Chat.
6. Eigenständige Anwendung: keine Laufzeit-Referenzen auf www.svenesis.org; Website, deren Repo und CloudFront-Distribution **nie** ändern.
7. `legacy/` ist schreibgeschützte Kopiervorlage.
8. Farben/Typografie nur über `packages/ui-tokens`; Texte über i18n (DE/EN); Bezeichner Englisch.
9. API unter `/api`, gleicher Origin, CSRF-Header, Problem Details mit Codes aus `errors.json`.
10. Nur prod: Claude Code führt nie `cdk deploy`, `pnpm deploy:prod` oder `pnpm test:dsql` aus – das macht Sven lokal; `AUTH_TEST_MODE` nie im Lambda-Bundle; Migrationen additiv und vor dem Code.
11. Zwei Anwendungs-Lambdas (`api`, `worker`) + `migrate` (führt auch Migration 0000 mit Rollen und `AWS IAM GRANT` aus) + `ops-cli` (CDK-Hilfs-Lambdas ausgenommen), vier Zeitpläne; Arbeit > ~5 s oder > 1 MB als Job. **Eine eigene Ausführungsrolle je Lambda über CDK-Grants nach `docs/specs/infra/iam.md`**; keine `*`-Ressourcen auf DSQL/S3/SSM/Invoke, keine Managed Policies außer `AWSLambdaBasicExecutionRole` (SV-13).
12. Verträge zuerst.
13. Plugin-Projektschnitt nach TK 10.1/10.5 einhalten: Logik in `NinaPm.Core` (plattformneutral), NINA-Adapter in `NinaPm.Nina` **ohne eigene XAML-Datei**, XAML nur in `NinaPm.Nina.Ui`, Adapter-Tests in `NinaPm.Nina.Tests`. NINA ausschließlich über `NINA.Plugin` mit `Version="$(NinaVersion)"` und `IncludeAssets="compile"` referenzieren (ADR-S2c), nie mit festem Pfad ins Installationsverzeichnis; `NinaVersion` nur zusammen mit dem NINA-Update auf dem Rig ändern; von NINA mitgebrachte Pakete (`System.ComponentModel.Composition`, `Newtonsoft.Json`, `Microsoft.Xaml.Behaviors.Wpf`) nur mit `ExcludeAssets runtime`; keine DLL committen, `tools/nina-build-check.sh` muss grün sein.
14. Code aus dem Astro-PM-NINA-Plugin (MIT) darf portiert werden: Herkunft (Datei, Commit `5dd621d`) im Kommentar, Hinweis in `THIRD_PARTY_NOTICES.md`, kein Name/Logo „Astro PM“ in Oberfläche oder Bezeichnern. Dessen Astronomie (`AstroCalculator.cs`) wird **nicht** übernommen.

## Aktueller Stand
Siehe `docs/CHANGELOG.md` und `docs/work-packages/README.md`.
