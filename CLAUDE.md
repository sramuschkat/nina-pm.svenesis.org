# Svenesis NINA-PM

Web-App (React/TS) + AWS-Backend (CDK, Lambda/TS, API Gateway, Aurora DSQL, S3) + NINA-Plugin (C#) zur Planung von Astrofotografie-Projekten, die NINA automatisch ausführt. Einzige Umgebung: **prod** unter `https://nina-pm.svenesis.org`.

## So arbeitest du hier
1. Nächstes Arbeitspaket mit Status ☐ in `docs/work-packages/README.md` wählen, dessen Abhängigkeiten ☑ sind (die Tabellenreihenfolge ist nur eine Empfehlung), und dessen Brief `docs/work-packages/AP-xx.md` lesen. Status höchstens auf ◐ setzen; ☑ setzt Sven.
2. **Nur** die im Brief unter „Lesen“ genannten Abschnitte laden (Zeilenbereiche in `docs/concept/INDEX.md`). Die vollständigen Konzepte liegen in `docs/concept/` – nicht komplett einlesen.
3. Menschliche Aufgaben aus `docs/ops/human-tasks.md` prüfen: fehlt eine **Voraussetzung (Start)**, nachfragen statt umgehen; eine offene **Abnahme**-Aufgabe hält nur den Abschluss auf (PR liefern, Status ◐ lassen).
4. Verträge zuerst (`packages/shared/contracts`, Enums/Fehler aus `docs/contracts`), dann Implementierung, dann Tests.
5. Bei Unklarheit in einer Spec: nicht raten – Frage stellen und Spec-Ergänzung vorschlagen. **Vorrang bei Widersprüchen:** Brief > `docs/specs/` und `docs/contracts/` > `docs/rules/` > Technisches Konzept > Fachkonzept.
6. PR mit AP-ID + Anforderungs-IDs; `docs/CHANGELOG.md` ergänzen. Menschliche Freigaben nie selbst abhaken; keine Tags/Releases setzen (macht Sven).

## Karte
| Bereich | Datei |
|---|---|
| Regeln (immer gültig) | `docs/rules/dsql.md`, `engine.md`, `security-auth.md`, `api.md`, `ui.md`, `testing.md` |
| Engine-Specs | `docs/specs/engine/allocation.md` (Algorithmus nach Astro-PM-Plugin, Abweichungen §10), `moon.md`, `sort-chain.md`, `flip-rotation.md`, `transit.md`, `effort.md`, `geometry.md`, `night.md`, `canonical-json.md` |
| Plugin-Ausführung | `docs/specs/nina/execution.md` (Muster nach Astro-PM-Plugin; Neuplanung, Transit, Lease, Offline, Flats, Test-Server) |
| Infrastruktur / IAM | `docs/specs/infra/iam.md` (eine Rolle je Lambda, ressourcengenau; Drosselung, CloudFront-Header). **Was dort nicht steht, wird nicht vergeben** – fehlt ein Recht, Spec ergänzen statt Politik erweitern |
| Oberfläche | `docs/specs/ui/components.md` (Verträge der neun Bausteine, Symbole, Abstände); Arbeitsseiten ohne Breitenobergrenze, Mindestbreite 768 px, **zwei** Themes (`light`/`dark`, kein Rotlicht), Dichte-Schalter `compact`/`normal`/`wide` |
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
| .NET 8 (Plugin-Kern, Jint-Parität, Orakel) | nur mit SDK und NuGet-Zugang | ja (`plugin.yml`, `oracle.yml`) |
| Python/astropy-Fixtures | optional (H-10) | ja (`reference.yml`, gebündelte IERS-Daten) |
| DSQL (Migrationen, OCC) | nein | ja (`dsql-it.yml`, Environment `ci`, H-22) |
| C#-Quellen des Astro-PM-Plugins laden | nur mit GitHub-Zugang | ja (Skript in `oracle.yml`) |
| AWS-Deploy | nein (nie) | ja, nur `deploy-prod.yml` mit Freigabe |

Fehlt lokal ein Werkzeug oder der Netzzugang: **nicht improvisieren**, sondern den PR eröffnen und das Ergebnis des CI-Laufs auswerten (`gh run view --log-failed`). Was ausschließlich im CI läuft, gilt erst mit grünem Lauf als erledigt.

## Befehle
- `pnpm i` · `pnpm build` · `pnpm test` · `pnpm lint` · `pnpm typecheck`
- `pnpm db:up` · `pnpm db:migrate` · `pnpm db:seed`
- `pnpm dev:web` · `pnpm dev:api`
- `pnpm cdk synth` · `pnpm cdk diff` (Deploy nur über `deploy-prod.yml` mit Freigabe)
- `pnpm e2e` · `pnpm fake-plugin` · `pnpm engine:bundle` · `pnpm nina-test-server` · `pnpm test-run:check <ordner>` · `pnpm oracle:run <grid>`
- `dotnet test apps/nina-plugin/NinaPm.Core.Tests` (Linux) · vollständige Lösung auf `windows-latest`

## Harte Regeln (Kurzfassung – Details in `docs/rules/`)
1. Aurora DSQL: keine Trigger/PL/pgSQL/TRUNCATE/TEMP TABLE/ON DELETE-Aktionen/ALTER COLUMN TYPE; Indizes nur `CREATE INDEX ASYNC`; eine DDL je Transaktion; ≤ 3.000 Zeilen je Transaktion; OCC-Retry über `withTx`; Invarianten mit `guard` (`SELECT … FOR UPDATE`). FKs, jsonb, `ADD COLUMN … DEFAULT` sind erlaubt.
2. Datenbankzugriff nur in `packages/db/src/repositories`, jede Abfrage mandantengebunden.
3. Jede Route deklariert eine Berechtigungs-Aktion und hat generierte Rechte-Tests.
4. Engine rein und deterministisch: kein `Date`/`Intl`/`Math.random`/I/O; Trigonometrie nur aus `engine/src/math`; Hashes über `canonicalInputJson`; Soll-Pläne exakt.
5. Anmeldung nur Discord; Geheimnisse nur in SSM; nie in Code, Logs, Chat.
6. Eigenständige Anwendung: keine Laufzeit-Referenzen auf www.svenesis.org; Website, deren Repo und CloudFront-Distribution **nie** ändern.
7. `legacy/` ist schreibgeschützte Kopiervorlage.
8. Farben/Typografie nur über `packages/ui-tokens`; Texte über i18n (DE/EN); Bezeichner Englisch.
9. API unter `/api`, gleicher Origin, CSRF-Header, Problem Details mit Codes aus `errors.json`.
10. Nur prod: kein `cdk deploy` vom Rechner; `AUTH_TEST_MODE` nie im Lambda-Bundle; Migrationen additiv und vor dem Code.
11. Zwei Anwendungs-Lambdas (`api`, `worker`) + `migrate` + `db-bootstrap` (einmalig, Migration 0000) + `ops-cli` (CDK-Hilfs-Lambdas ausgenommen), vier Zeitpläne; Arbeit > ~5 s oder > 1 MB als Job. **Eine eigene Ausführungsrolle je Lambda nach `docs/specs/infra/iam.md`** – was dort nicht steht, wird nicht vergeben.
12. Verträge zuerst.
13. Code aus dem Astro-PM-NINA-Plugin (MIT) darf portiert werden: Herkunft (Datei, Commit `5dd621d`) im Kommentar, Hinweis in `THIRD_PARTY_NOTICES.md`, kein Name/Logo „Astro PM“ in Oberfläche oder Bezeichnern. Dessen Astronomie (`AstroCalculator.cs`) wird **nicht** übernommen.

## Aktueller Stand
Siehe `docs/CHANGELOG.md` und `docs/work-packages/README.md`.
