# Technisches Konzept – Svenesis NINA-PM

**Architektur, AWS-Infrastruktur (CDK), Datenbank, API, Engine, NINA-Plugin und Frontend**

| | |
|---|---|
| Dokument | Technisches Konzept |
| Version | 1.12 – Entscheidungen vom 17.09.2026: Arbeitsseiten **ohne Breitenobergrenze** (volle Fensterbreite, nur Textseiten auf Lesebreite), **Dichte-Schalter** `compact`/`normal`/`wide` mit eigenen Tokens statt Layout-Umschalter, **Rotlicht-Modus entfällt** (nur `light` und `dark`), **kein AWS WAF** – der Schutz gegen Direktaufrufe und Lastspitzen trägt endgültig über Origin-Verify, Drosselung, reservierte Parallelität und Alarme. Abgestimmt mit Fachkonzept v1.15, Schema v1.11 und `claude-code/`. Vorversionen: 1.11 Sicherheits-Review; 1.10 Review 5; 1.9 Review 4.
| Stand | 17.09.2026 |
| Autor | Sven Ramuschkat (mit Claude) |
| Grundlage | `Fachkonzept_Svenesis-NINA-PM.md` v1.15 (Anforderungs-IDs FA-…, NFA-…, Bildschirme S-…) |
| Anlagen | `schema_aurora_dsql.sql` v1.11 (DDL, 52 Tabellen); Umsetzungspaket `claude-code/` (CLAUDE.md, Regeln, Spezifikationen, Verträge, Soll-Pläne, Arbeitspaket-Briefs, menschliche Aufgaben) |
| Zielgruppe | Umsetzung mit Claude Code |

---

## Inhalt

1. [Leitplanken und Architekturentscheidungen](#1-leitplanken-und-architekturentscheidungen)
2. [Architekturüberblick](#2-architekturüberblick)
3. [Monorepo und Projektstruktur](#3-monorepo-und-projektstruktur)
4. [AWS-Infrastruktur mit CDK](#4-aws-infrastruktur-mit-cdk) (inkl. Domain `nina-pm.svenesis.org` und Einbindung in die Website)
5. [Authentifizierung und Autorisierung (Discord)](#5-authentifizierung-und-autorisierung-discord)
6. [Datenbank (Aurora DSQL)](#6-datenbank-aurora-dsql)
7. [API](#7-api)
8. [Scheduler- und Astronomie-Engine](#8-scheduler--und-astronomie-engine)
9. [Referenzwerte mit Python/astropy](#9-referenzwerte-mit-pythonastropy)
10. [NINA-Plugin](#10-nina-plugin)
11. [Frontend (React + TypeScript)](#11-frontend-react--typescript)
12. [Dateien und S3](#12-dateien-und-s3)
13. [Hintergrund-Jobs](#13-hintergrund-jobs)
14. [Externe Dienste](#14-externe-dienste)
15. [Sicherheit](#15-sicherheit)
16. [Betrieb, Monitoring und Kosten](#16-betrieb-monitoring-und-kosten)
17. [Teststrategie](#17-teststrategie)
18. [CI/CD und Deployment](#18-cicd-und-deployment)
19. [Umsetzungsplan für Claude Code](#19-umsetzungsplan-für-claude-code)
20. [Vorlage CLAUDE.md](#20-vorlage-claudemd)
21. [Offene technische Punkte und Risiken](#21-offene-technische-punkte-und-risiken)

---

## 1. Leitplanken und Architekturentscheidungen

### 1.1 Leitplanken

- **Eigenständige Anwendung:** Svenesis-NINA-PM läuft unter **`https://nina-pm.svenesis.org`** mit eigener Infrastruktur, eigenem Code und eigenen Assets. Die Website www.svenesis.org bindet die Anwendung nur über einen **Menüeintrag „Svenesis-NINA-PM“** ein.
- **Website und Astro-Tools bleiben unverändert:** `astro-tools/astro-weather_{de,en}.html`, `astro-tools/observing-planner_{de,en}.html`, ihre Skripte, Daten und Bilder sowie die CloudFront-Distribution `E2L6Q80SD8XPT0` werden **nicht** angefasst und zur Laufzeit **nicht** referenziert. Sie dienen als **Kopiervorlage**: Code und Daten werden in das NINA-PM-Repository kopiert und dort nach TypeScript portiert (→ 8.4, 11.3, 12).
- **Klein, günstig, serverlos:** wenige Mandanten, geringe Last → keine dauerhaft laufenden Instanzen, kein VPC, kein NAT Gateway. Zielkosten < 15 €/Monat (→ 16.3).
- **Alles als Code:** komplette Infrastruktur per AWS CDK (TypeScript), reproduzierbar deploybar in **eine einzige Umgebung (prod)**, inklusive CloudFront, Zertifikaten und DNS-Einträgen.
- **Eine Sprache:** TypeScript in Frontend, Backend, Engine und Infrastruktur. Ausnahmen: NINA-Plugin (C#, vorgegeben durch NINA) und Python ausschließlich als Offline-Werkzeug für Referenzwerte.
- **Eine Engine:** Astronomie- und Scheduler-Logik existiert genau einmal (TypeScript) und läuft im Browser, in Lambda und – nur für den Offline-Fall – im NINA-Plugin (per Jint). Ist NINA online, plant der **Server** (ADR-16) – Voraussetzung für NFA-03.
- **So einfach wie möglich:** zwei Anwendungs-Lambdas (`api`, `worker`) plus die Betriebs-Lambdas `migrate`, `db-bootstrap` (einmalig, DB-Rollen) und `ops-cli` (CDK-Hilfs-Lambdas wie `BucketDeployment`/Custom Resources ausgenommen), vier Zeitpläne, eine Job-Tabelle; alles, was länger als ~5 s dauert oder größer als 1 MB ist, läuft als Job (ADR-17).
- **Mandantentrennung im Code erzwungen:** Aurora DSQL hat keine Row-Level-Security → zentraler, nicht umgehbarer Mandantenkontext im Datenzugriff (NFA-16).
- **Keine Passwörter:** Anmeldung ausschließlich über Discord-OAuth; eigene, kurzlebige Tokens; kein Cognito.
- **Gestaltung wie svenesis.org:** Farben, Typografie, Kopf- und Fußzeile nach dem Vorbild der Website – als eigene Kopie in der Anwendung, nicht als Laufzeit-Abhängigkeit.

### 1.2 Entscheidungen (ADR-Übersicht)

| ADR | Entscheidung | Begründung | Alternativen |
|---|---|---|---|
| ADR-01 | **AWS** als Plattform, Region **eu-central-1 (Frankfurt)** – Aurora DSQL ist dort seit 23.10.2025 verfügbar | svenesis.org liegt bereits auf AWS, Know-how, DSGVO | Supabase |
| ADR-02 | **AWS CDK v2 (TypeScript)** für die gesamte Infrastruktur | ein Werkzeug, typisiert, gleiche Sprache | Terraform, SAM |
| ADR-03 | **Aurora DSQL** als Datenbank | serverlos, kein VPC, nahezu 0 € bei geringer Last, PostgreSQL-kompatibel | RDS micro (RLS, aber VPC/Kosten), DynamoDB |
| ADR-04 | **API Gateway HTTP API + zwei Lambdas (Node.js LTS, arm64): `api` (alle Routen) und `worker` (Jobs, Zeitpläne)** | günstig, einfach, wenig Infrastruktur und Deploy-Einheiten | je Bereich/Job eigene Lambda, REST API |
| ADR-05 | **Hono** als Router in Lambda, **zod** für Validierung, **OpenAPI** aus zod generiert | leichtgewichtig, typisiert, generierbarer Client für Plugin | Express, Fastify |
| ADR-06 | **Kysely** als typisierter Query-Builder auf `pg` | volle SQL-Kontrolle (DSQL-Regeln), kein ORM-Magie | Drizzle, Prisma |
| ADR-07 | **Discord-OAuth ohne Cognito**, eigene JWT-Access-Tokens + rotierende Refresh-Sitzungen in HttpOnly-Cookies | Vorgabe; kein Passwort-Handling; wenige bewegliche Teile | Cognito mit Discord-Föderation |
| ADR-08 | **React + TypeScript + Vite** im Frontend, CSS Modules + eigene Design-Tokens nach Vorbild svenesis.org | Vorgabe; eigenständig, trotzdem gleiche Anmutung | Tailwind, Vue |
| ADR-09 | **Engine als eigenes Paket ohne Laufzeitabhängigkeiten**, ES2020-Bundle | läuft in Browser, Node und Jint | getrennte C#-Implementierung |
| ADR-10 | **Jint** (JavaScript-Interpreter für .NET) im NINA-Plugin **nur für Offline-Planung** | reine .NET-Bibliothek, kein natives V8; online plant der Server (ADR-16) | ClearScript (V8) |
| ADR-11 | **Python/astropy nur für Referenz-Fixtures**, nicht produktiv | Genauigkeitsnachweis NFA-03/NFA-15 | – |
| ADR-12 | **pnpm-Workspaces-Monorepo** | Typen und Engine gemeinsam versioniert | mehrere Repos |
| ADR-13 | **Planprotokolle als `.json.gz` in S3**, Blöcke/Zusammenfassung als `jsonb` (≤ 1 MiB), Aufnahmen als Einzelzeilen | 3.000-Zeilen-Grenze je Transaktion, 1-MiB-Grenze je Wert, 1-MB-Grenze je API-Anfrage | Protokoll in der DB |
| ADR-14 | **Eigene Subdomain `nina-pm.svenesis.org` mit eigener CloudFront-Distribution** (Web unter `/`, API unter `/api/*`, gleicher Origin) | eigenständig; Website-Distribution bleibt unberührt (dort gilt eine distributionweite 404→`/index.html`-Fehlerseite, die eine API stören würde); Cookies ohne CORS | Pfad `www.svenesis.org/nina-pm/` (per CLI-Skript an die manuelle Distribution anhängen, API auf separater Subdomain) |
| ADR-16 | **Online plant der Server**: das Plugin ruft `POST /nina/v1/plan` auf (Node-Engine), Jint nur, wenn der Server nicht erreichbar ist | ein Rechenweg für Simulator und Nacht, kein Gleitkomma-/Hash-Unterschied Node ↔ .NET, Jint-Leistung unkritisch | Planung immer im Plugin |
| ADR-17 | **Asynchrone Arbeit über Tabelle `job` + Lambda `worker`** (Mehrnacht-Simulation, Auswirkungsvorschau, Aufwand-Kennzeichen, Export/Import, Vorschaubilder, Nachtbericht); **Berichte als Druckansicht im Browser** statt serverseitigem PDF | HTTP-API-Grenzen (30 s, 1 MB), einfache Nachverfolgung, keine PDF-Bibliothek in Lambda | S3-Statusdateien, Step Functions |
| ADR-15 | **Astro-Tools als Kopiervorlage**: Code und Daten werden ins Repo kopiert und nach TypeScript portiert; keine Laufzeit-Referenz auf www.svenesis.org | Website bleibt exakt wie sie ist; NINA-PM kann unabhängig weiterentwickelt werden | gemeinsame Laufzeit-Dateien |

---

## 2. Architekturüberblick

### 2.1 Komponenten

```
 www.svenesis.org (Website, unverändert)          Menü „Astronomie › Svenesis-NINA-PM“ ──link──┐
                                                                                               ▼
                     nina-pm.svenesis.org  (CloudFront, CDK)
 Browser ───HTTPS───▶┌──────────────────────────────────────────────────────────┐
 NINA-Plugin ─HTTPS─▶│  /api/*  → API Gateway HTTP API (kein Cache, X-Origin-Verify)│
                     │  /*      → S3 svenesis-nina-pm-web (SPA, Katalogbilder)  │
                     └───────────────┬──────────────────────────────────────────┘
                                     ▼
                     ┌──────────────────────────────────────────────────────────┐
                     │ API Gateway HTTP API (Throttling)                         │
                     │   ├─ Lambda api     (Hono: /api/auth, /api/web/v1,        │
                     │   │                  /api/system/v1, /api/nina/v1)        │
                     │   └─ legt Jobs an → Lambda worker (async, nur jobId)      │
                     └───────┬───────────────────────────┬──────────────────────┘
                             │ IAM-Auth-Token            │ presigned URLs
                             ▼                           ▼
                     ┌───────────────┐          ┌──────────────────────┐
                     │ Aurora DSQL   │          │ S3 nina-pm-data       │
                     │ eu-central-1  │          │ tenant/<tid>/…        │
                     └───────▲───────┘          └──────────▲───────────┘
                             │                             │
                     ┌───────┴─────────────────────────────┴──────────┐
                     │ EventBridge Scheduler (4 Zeitpläne) → worker   │
                     │ (Jobs, Kataloge, Wetter, Fristen, Berichte)    │
                     └───────┬────────────────────────────────────────┘
                             ▼
      Discord OAuth · Open-Meteo · CDS (HiPS, hips2fits, SIMBAD) · ExoClock · NASA TAP · ExoFOP
```

- **Ein Origin für die Anwendung** (`nina-pm.svenesis.org`): SPA, Web-API und NINA-API über dieselbe, CDK-verwaltete Distribution → Cookies ohne CORS, ein Zertifikat.
- **Kein VPC:** Lambdas sprechen DSQL über den öffentlichen, IAM-authentifizierten Endpunkt und externe Dienste direkt.
- **SSM Parameter Store (SecureString)** für Discord-Client-Secret und JWT-Signaturschlüssel – einmalig per CLI angelegt, CDK referenziert nur (4.1).

### 2.2 Wichtige Abläufe

**Web-Anfrage**

```
Browser ─▶ CloudFront nina-pm.svenesis.org (/api/web/v1/…, Cookies weitergereicht, kein Cache)
        ─▶ API GW ─▶ api Lambda
             1. X-Origin-Verify prüfen (nur über CloudFront erreichbar)
             2. Access-JWT aus Cookie prüfen → AuthContext {identityId, sessionId, memberId, tenantId, role, isOwner, ctx}
                (member_version und auth_session.revoked_at gegen DB, Cache 60 s – 5.5)
             3. CSRF-Header bei schreibenden Methoden prüfen
             4. zod-Validierung
             5. Berechtigung: can(role, action, resource)
             6. Repository (tenant-gebunden) ─▶ DSQL
             7. JSON-Antwort (Problem-Details bei Fehlern)
```

**NINA-Nacht** (Basis-URL `https://nina-pm.svenesis.org/api/nina/v1`)

```
Plugin start ─▶ GET  /bootstrap   (Rig, Standort, Filter, Settings, Zeitzonen-Übergänge, Engine-Version)
             ─▶ GET  /targets     (ETag; auslieferbare Projekte mit Zeilen/Zählern)
             ─▶ POST /plan        (Server plant mit der Node-Engine; offline: Jint aus dem Cache)
             ─▶ POST /sessions    (Lease je Rig; Plan-Dokument, Protokoll per presigned POST nach S3)
             ─▶ vor jedem Block: GET /targets (ETag) → geändert/Verzug > 10 min? → POST /plan {startAtUtc, tonight}
             ─▶ im Block alle 15 min: GET /targets → Fall a/b/c (10.3 Nr. 3)
             ─▶ je gespeicherte Belichtung: Outbox ─▶ POST /sessions/{id}/captures (Batch)
             ─▶ Ereignisse ─▶ POST /sessions/{id}/events (Batch)
             ─▶ alle 60 s  ─▶ POST /heartbeat (verlängert Lease 3 min; leaseLost; offline friert ein)
             ─▶ Ende       ─▶ PATCH /sessions/{id} {status: completed}
Server: Zähler exposure_line/transit_observation/capture_night in derselben Transaktion; Sessionende legt Jobs an (KPIs, Nachtbericht, Aufwand).
```

---

## 3. Monorepo und Projektstruktur

### 3.1 Verzeichnisbaum

```
svenesis-nina-pm/
├─ CLAUDE.md
├─ package.json                 # pnpm workspaces, Skripte (build, test, lint, deploy)
├─ pnpm-workspace.yaml
├─ tsconfig.base.json           # strict, ES2022, moduleResolution bundler
├─ START.md                     # Einstieg Sitzung 1 (aus claude-code/START.md)
├─ .github/workflows/           # ci.yml, deploy-prod.yml, plugin.yml, oracle.yml, nightly.yml, dsql-it.yml
├─ legacy/
│  └─ astro-tools-2026-09-17/   # unveränderte Kopie der Website-Astro-Tools (Kopiervorlage, nicht ausgeliefert)
├─ docs/
│  ├─ CHANGELOG.md
│  ├─ README.md                 # Leseplan, Vorrang: Brief > specs/contracts > rules > TK > FK
│  ├─ concept/                  # Fachkonzept, Technisches Konzept, Schema (Referenz; Quelle sind die Migrationen), INDEX.md
│  ├─ rules/ specs/ contracts/ seed/ ops/ work-packages/ history/   # aus dem Umsetzungspaket claude-code/
│  ├─ api/openapi.yaml          # generiert aus zod, eingecheckt
│  └─ adr/                      # ADR-TEMPLATE.md, ADR-01 … als Einzeldateien
├─ packages/
│  ├─ engine/                   # Astronomie + Scheduler, KEINE Laufzeit-Abhängigkeiten
│  │  ├─ src/
│  │  │  ├─ time/               # JD, ΔT, TT/TDB, UTC, Zeitzonen-Offsets (IANA-Tabellen via Intl im Host)
│  │  │  ├─ coords/             # Präzession, Refraktion, Alt/Az, Sternzeit
│  │  │  ├─ bodies/             # Sonne, Mond (Port astro-core.js), Planeten
│  │  │  ├─ twilight/           # Dämmerungsgrenzen, Dunkelheitsintervalle, Nacht-Schlüssel
│  │  │  ├─ visibility/         # 5-min-Raster, Mindesthöhe, Meridian
│  │  │  ├─ moon/               # Mondvermeidung (Lorentz, Relaxierung, Stufen)
│  │  │  ├─ transit/            # Ephemeride, BJD_TDB ↔ UTC, Fenster, Unsicherheit
│  │  │  ├─ plan/               # Grid-Adapter, Matrix, paint, walk/pick, Blöcke (allocation.md)
│  │  │  ├─ scheduler/          # Strategien, Sortierkette, Overhead, Diagnose
│  │  │  ├─ forecast/           # Mehrnacht, Prognose, Kandidatennächte
│  │  │  ├─ weather/            # Scores (Port astro-weather.js, rendering-frei)
│  │  │  ├─ ranking/            # Zielvorschläge (Port observing-planner.js)
│  │  │  ├─ geometry/           # FOV, Maßstab, Mosaik-Panels
│  │  │  └─ index.ts            # öffentliche API + ENGINE_VERSION
│  │  ├─ test/fixtures/         # von tools/reference erzeugt (astropy)
│  │  └─ build/engine.iife.js   # Bundle für Jint (ES2020)
│  ├─ i18n/                     # DE/EN-Texte, `errors.*` aus errors.json generiert (Grundgerüst AP-05, erweitert AP-06a)
│  ├─ shared/                   # zod-Schemas (Vertragsquelle), DTO-Typen, Berechtigungsmatrix, Fehlercodes, Enums, Konstanten, `buildPlanInput`;
│  │                            # daraus generiert: contracts/*.schema.json (PlanInput, NightPlan, Effort, CaptureBatch, Export)
│  ├─ db/                       # Kysely-Typen, Migrationen, Migration-Runner, Repositories, DSQL-Verbindung
│  ├─ ui-tokens/                # Design-Tokens --npm-* nach Vorbild svenesis.org (Kopie, 11.3)
│  └─ catalog-data/             # Katalog- und Sterndaten (Kopie aus astro-tools/data + dso-catalog.js, CC BY-SA 4.0)
├─ apps/
│  ├─ web/                      # React-SPA (Vite), base '/'
│  ├─ api/                      # Lambda-Handler (ein Paket): api (Hono, alle Routen), worker (Job-Dispatcher), migrate, db-bootstrap, ops-cli; local.ts
│  └─ nina-plugin/              # C#-Lösung (.sln), eigenes Build (dotnet), bindet engine.iife.js ein
├─ infra/                       # CDK-App: bin/app.ts, lib/*-stack.ts, config.ts,
│                               # edge/nina-pm-viewer-request.js
└─ tools/
   ├─ reference/                # Python/astropy → packages/engine/test/fixtures (im CI mit gebündelten IERS-Daten)
   ├─ astropm-oracle/           # .NET 8: C#-Original des Astro-PM-Plugins als Vergleichsorakel (allocation.md §11)
   ├─ nina-test-server/         # lokaler NINA-API-Server mit Plänen relativ zu „jetzt“ (Plugin-Tests tagsüber, execution.md §9)
   ├─ catalog-import/           # packages/catalog-data → dso_object (TS-Skript)
   ├─ catalog/                  # portierte Generatoren (ngc-data, Thumbnails, Sterndaten, Ereignisse)
   ├─ fake-plugin/              # CLI: simuliert eine NINA-Nacht gegen die NINA-API (Tests ohne Plugin)
   ├─ test-run-check/           # prüft docs/test-runs/<datum>/<P-xx>/result.json und das Plugin-Log
   ├─ discord-mock/             # lokaler Webhook-Empfänger für Discord-Tests
   ├─ smoke/                    # Smoke-Prüfung nach jedem prod-Deploy (17): /, /api/health, /api/health/shallow, /catalog/…, Auth-Redirect, CSP (CC5-17)
   └─ astropm-import/           # optional: logbook.db → Mandant (OP-20)
```

### 3.2 Werkzeuge und Konventionen

| Thema | Festlegung |
|---|---|
| Node | aktuelle LTS (22 bzw. 24), identisch lokal, CI und Lambda |
| Paketmanager | pnpm, `workspace:*`-Abhängigkeiten |
| Build | `tsup`/esbuild für Lambda und Engine, Vite für Web |
| Tests | Vitest (Engine, API, DB), Playwright (E2E), xUnit (Plugin) |
| Lint/Format | ESLint (typescript-eslint, strict) + Prettier; eigene Regel: kein Import von `packages/db/src/connection` außerhalb von `packages/db/src/repositories` |
| Namen | Code Englisch (`project`, `exposureLine`), UI-Texte über i18n (DE/EN); DB `snake_case`, TS `camelCase` (Kysely CamelCasePlugin) |
| IDs | einheitlich **UUID v7** (Server und Plugin, zeitlich sortierbar; Server erzeugt sie im Code, `gen_random_uuid()` nur als DB-Standard für Altpfade) |
| Zeit | intern UTC-ISO-Strings bzw. epoch ms; Nacht als `YYYY-MM-DD` (Abend am Standort) |
| Fehler | RFC 9457 Problem Details, stabile Fehlercodes in `shared/errors.ts` |
| Commits | Conventional Commits; jede Änderung mit Anforderungs-ID im PR-Text |

---

## 4. AWS-Infrastruktur mit CDK

### 4.1 Stacks

| Stack | Inhalt | Abhängigkeiten |
|---|---|---|
| `NinaPm-Data` | Aurora-DSQL-Cluster (`aws_dsql.CfnCluster`, Löschschutz aktiv, Tag `purpose=prod`), S3-Bucket `svenesis-nina-pm-data` (privat, SSE-S3, Versionierung, Lifecycle), AWS-Backup-Plan für DSQL (wählt **per Tag** `purpose=prod`, nicht per ARN) in einem **eigenen Vault `nina-pm-prod` mit Vault Lock** (Governance-Modus; Vault-Zugriffspolitik verweigert `backup:DeleteRecoveryPoint` allen außer `NinaPmOpsInvoker`, und `NinaPmDeployBoundary` verweigert der Deploy-Rolle `backup:Delete*` und `backup:DisableVaultLock` – sonst löscht ein fehlgeleiteter Deploy Daten **und** Sicherungen, SEC-20). **Import-Modus (DAT5-16):** Der Kontextwert `dsqlClusterId` (`cdk deploy -c dsqlClusterId=…`) schaltet den Stack auf „vorhandenen Cluster übernehmen“: der `CfnCluster` wird dann **nicht** erzeugt, sondern der Endpunkt aus der übergebenen ID gebildet und in `/nina-pm/dsql-endpoint` geschrieben. Ohne den Kontextwert erzeugt der Stack den Cluster wie bisher. Dieser Schalter ist der Weg, den das Restore-Runbook (6.10) benutzt; ohne ihn müsste nach einem Restore der ganze Datenstack neu gebaut werden | – |
| `NinaPm-Config` | Kundenverwalteter KMS-Schlüssel **`alias/nina-pm-ssm`** für alle SecureString-Parameter unter `/nina-pm/*` (ersetzt `alias/aws/ssm`; die Schlüsselpolitik begrenzt `kms:Decrypt` auf die fünf Lambda-Rollen, sodass ein Lambda-Nachbar im Konto selbst mit `ssm:GetParameter` nicht an die Werte kommt, SEC-6; jährliche Rotation, `kms:ScheduleKeyDeletion` für niemanden). Referenzen auf SSM-SecureString-Parameter `/nina-pm/discord/client-secret`, `/nina-pm/jwt/signing-keys` und `/nina-pm/system/alarm-webhook` (optional) (werden **einmalig per AWS CLI** mit `--key-id alias/nina-pm-ssm` angelegt, da CloudFormation keine SecureString-Parameter erzeugen kann); Origin-Verify als **zwei** SSM-Parameter `/nina-pm/origin-verify` (gültiger Wert) und `/nina-pm/origin-verify-prev` (Vorgänger, während der Rotation; DAT5-10) – die Lambda liest **beide** über den SSM-Cache (60 s) und akzeptiert beide; eine Umgebungsvariable kann das nicht leisten, weil sie nur einen Wert trägt und ein Deploy nötig wäre. CloudFront sendet den Wert aus `/nina-pm/origin-verify` als Origin-Header – kein Geheimnis im engeren Sinn, nur Schutz vor Direktaufrufen; DSQL-Endpunkt als Parameter `/nina-pm/dsql-endpoint` (erleichtert Restore in einen neuen Cluster, 6.10); nicht geheime Parameter (String): `/nina-pm/discord/client-id`, `/nina-pm/bootstrap-super-users` (kommagetrennte Discord-IDs) | – |
| `NinaPm-Bootstrap` | **einmalig manuell** deployt (`cdk deploy NinaPm-Bootstrap` mit Admin-Rechten, menschliche Aufgabe H-04): GitHub-OIDC-Provider, Rolle `NinaPmGithubDeploy` (Vertrauen nur für Repo und Environment `prod`; **Rechte ausschließlich `sts:AssumeRole` auf die vier CDK-Bootstrap-Rollen** plus `cloudformation:DescribeStacks`/`GetTemplate` für den Diff – keine direkten Service-Rechte, SEC-3), die IAM-Politik **`NinaPmDeployBoundary`** (wird bei `cdk bootstrap` als `--cloudformation-execution-policies` gesetzt **statt** des Standards `AdministratorAccess` und verweigert unter anderem jede Änderung an der Website-Distribution `E2L6Q80SD8XPT0`, fremde Route-53-Einträge, `dsql:DeleteCluster`, `backup:Delete*` und Schreibzugriff auf `/nina-pm/bootstrap-super-users`), die Rolle **`NinaPmOpsInvoker`** (nur `lambda:InvokeFunction` auf `ops-cli` und `db-bootstrap`, Annahme **nur mit MFA**, SEC-9) und Rolle `NinaPmGithubCiDsql` (Environment `ci`; nur DSQL-Cluster mit Tag `purpose=ci` anlegen/löschen/verbinden, Region `eu-central-1`, **explizites `Deny` auf `dsql:TagResource`/`UntagResource` fremder Ressourcen und Pflicht-Tag beim Anlegen (`aws:RequestTag/purpose = ci`)** – sonst könnte die Rolle den prod-Cluster taggen und sich verbinden, DAT-16; H-22); danach nutzen alle Workflows diese Rollen | – |
| `NinaPm-Cert` | **us-east-1**: ACM-Zertifikat `nina-pm.svenesis.org`, DNS-Validierung über Route-53-Zone `svenesis.org` | – |
| `NinaPm-Migrate` | Lambda `migrate` + `triggers.Trigger` (läuft bei jedem Deploy **vor** dem neuen Code) mit Rolle `NinaPmMigrate` (**nur** `dsql:DbConnect` → DB-Rolle `app_migrate`); zusätzlich Lambda **`db-bootstrap`** mit Rolle `NinaPmDbBootstrap` (`dsql:DbConnectAdmin`) für **Migration 0000**, **ohne** Trigger und ohne Route – sie wird einmalig per `aws lambda invoke` durch `NinaPmOpsInvoker` gestartet (H-25). Damit trägt keine automatisch laufende Lambda mehr DB-Adminrechte (SEC-1). Rollen und Politiken: `specs/infra/iam.md` §4 | Data, Config |
| `NinaPm-Api` | HTTP API, Lambda `api` (alle Routen inkl. `GET /api/health`) mit eigener Rolle `NinaPmApi`, Log-Gruppe (400 Tage, KMS), Routen-Throttling und **Zugriffsprotokoll** der HTTP API (JSON, IP gekürzt) | Migrate, Config |
| `NinaPm-Jobs` | Lambda `worker` mit eigener Rolle `NinaPmWorker`, vier EventBridge-Scheduler-Zeitpläne in der Gruppe `nina-pm` (13) mit **einer** Aufrufrolle `NinaPmSchedulerInvoke` (`lambda:InvokeFunction` nur auf `worker`, Vertrauensbedingung `aws:SourceArn` auf die vier Zeitpläne – ohne sie wäre die Rolle ein Confused-Deputy-Kandidat, SEC-10), `EventInvokeConfig` (Wiederholungen 0, `onFailure` → SQS `nina-pm-worker-failures` mit SSE-SQS, Aufbewahrung 14 Tage und `enforceSSL`; das nötige `sqs:SendMessage` steht in der **Rolle der `worker`-Lambda**, SEC-8) | Migrate, Config |
| `NinaPm-Web` | S3-Bucket `svenesis-nina-pm-web` (SPA unter `/`, Katalogdaten/-bilder unter `/catalog/`) | – |
| `NinaPm-Edge` | CloudFront-Distribution `nina-pm.svenesis.org` (OAC, Behaviors, CloudFront Function `nina-pm-viewer-request`, Response-Headers-Policy), Route-53-Alias A/AAAA, SSM-Parameter `/nina-pm/web/build-id` mit dem aktuellen `buildId` (DAT5-6); `BucketDeployment` der SPA mit `distribution` (Invalidierung von `/index.html`), **`prune: false`** (alte gehashte Chunks bleiben für offene Tabs). **Keine Lifecycle-Löschung auf `assets/*`** (S3 kennt nur das Erstellungsalter, nicht „abgelöst“ – sonst verschwinden nach 30 Tagen ohne Deploy die aktiven Chunks, DAT-4): Die SPA liegt unter `assets/<buildId>/…`, und der `weekly`-Job löscht alle Build-Präfixe außer den letzten **drei**; `catalog/*` und `downloads/*` werden nie vom Deployment berührt | Cert (`crossRegionReferences`), Api, Web |
| `NinaPm-Ops` | Lambda `ops-cli` (Notfallzugang) mit Rolle `NinaPmOpsCli` und einer ressourcenbasierten Politik, die **nur** `NinaPmOpsInvoker` als Aufrufer zulässt (SEC-9), **CloudTrail `nina-pm-management`** (Verwaltungsereignisse, Ziel `svenesis-nina-pm-data/audit/`, Lebenszyklus 400 Tage; erstes Trail-Exemplar je Konto kostenfrei, SEC-19) mit Metrikfiltern und Alarmen auf `ops-cli`-/`db-bootstrap`-Aufrufe, `PutParameter` unter `/nina-pm/jwt/*` und `dsql:DeleteCluster`, CloudWatch-Alarme, Route-53-Health-Check auf **`https://nina-pm.svenesis.org/api/health/shallow`** (über CloudFront, nicht direkt auf die HTTP API – sonst fehlt `X-Origin-Verify` und der Check schlägt immer fehl; ohne DB-Ping, Intervall 60 s, 3 Regionen ⇒ ~130.000 Aufrufe/Monat, DAT-14/DAT5-9), SNS-Topic (E-Mail), Budget-Alarm | alle |

### 4.2 Wesentliche Ressourcen und Einstellungen

| Ressource | Einstellung |
|---|---|
| Lambda (alle) | arm64, Node LTS, `NODE_OPTIONS=--enable-source-maps`, Powertools Logger/Metrics, Log-Aufbewahrung 90 Tage |
| `api` | 1024 MB, Timeout 29 s, **reservierte Parallelität 20** (begrenzt Kosten und DSQL-Verbindungen – Pool 2 je Container ⇒ höchstens 40 – und verhindert, dass Browser-Last den Nachtbetrieb verdrängt, SEC-15); Rolle `NinaPmApi`; Engine/Plan-Code per Lazy-Import (Kaltstart der CRUD-Pfade klein); SSM-Werte mit **TTL-Cache 5 min** (nicht nur beim Start – sonst kennen warme Container neue Schlüssel nicht, DAT-5) |
| `worker` | 2048 MB, Timeout 15 min, **reservierte Parallelität 5** (Jobs sind idempotent und dürfen nachlaufen); Rolle `NinaPmWorker`; Aufruf asynchron mit `{jobId}` bzw. vom Zeitplan mit `{tick}`; Dispatcher je `job.kind` |
| `migrate` | 512 MB, Timeout 15 min; Rolle `NinaPmMigrate` (**nur** `dsql:DbConnect` → `app_migrate`). Prüft beim Start, ob die DB-Rollen und die beiden `AWS IAM GRANT`s existieren, und bricht sonst mit `db.bootstrap_missing` ab – es legt sie **nie** selbst an (SEC-1) |
| `db-bootstrap` | 512 MB, Timeout 5 min; Rolle `NinaPmDbBootstrap` (`dsql:DbConnectAdmin`). Führt **nur Migration 0000** aus (DB-Rollen `app_rw`, `app_job`, `app_migrate` anlegen, `AWS IAM GRANT`, Schema-Rechte), idempotent. **Kein** CDK-`Trigger`, keine Route, keine Ereignisquelle; Aufruf einmalig per `aws lambda invoke` durch `NinaPmOpsInvoker` (H-25) |
| `ops-cli` | 256 MB, Rolle `NinaPmOpsCli` (DB-Rolle `app_rw`); nur per `aws lambda invoke` (keine Route), Aufrufer laut ressourcenbasierter Politik ausschließlich `NinaPmOpsInvoker` (MFA-Pflicht). Jeder Aufruf schreibt `system_audit` **und** meldet sich per `sns:Publish` am Alarm-Topic (SEC-9) |
| HTTP API | Stage `$default`, Throttling 50 rps / Burst 100; Routen-Drosselung `ANY /api/nina/v1/{proxy+}` 20 rps/Burst 40, **`ANY /api/auth/{proxy+}` 5 rps/Burst 10** (bremst **vor** dem `login_audit`-Zugriff, SEC-24), **`GET /api/health` 1 rps** (macht einen DB-Ping und ist öffentlich, SEC-17), `GET /api/health/shallow` 200 rps, `ANY /api/{proxy+}` → alle auf `api`. Zugriff nur über CloudFront (Header `X-Origin-Verify`, in Lambda-Middleware geprüft). **Eine HTTP API (API Gateway v2) unterstützt keine Ressourcenpolitik und keine WAF-Bindung**, und **AWS WAF wird auch an der CloudFront-Distribution nicht eingesetzt** (entschieden 17.09.2026: ≈ 6 $/Monat gegen ein Budget von 20 €). Der Schutz gegen Direktaufrufe der `execute-api`-Adresse ist damit endgültig vierteilig: Origin-Verify, Drosselung, reservierte Parallelität und Budget-/Throttle-Alarm (SEC-15, `specs/infra/iam.md` §9). Zugriffsprotokoll im JSON-Format mit gekürzter IP |
| DSQL | Single-Region-Cluster; **drei** DB-Rollen: `app_rw` (Lambda `api` und `ops-cli`), **`app_job`** (Lambda `worker`), `app_migrate` (Migration). Mapping per `AWS IAM GRANT`: `app_rw` → `NinaPmApi` **und** `NinaPmOpsCli`, `app_job` → `NinaPmWorker`, `app_migrate` → `NinaPmMigrate` (angelegt in Migration 0000 durch `db-bootstrap`, von `migrate` bei jedem Lauf nur **geprüft**). `api` und `worker` haben damit getrennte Rollen und getrennte Rechte: `worker` kann `auth_session` und `nina_instance` nicht schreiben, `api` keine Kataloge (SEC-4). `dsql:DbConnect` ist in allen Rollen auf den Cluster-ARN begrenzt (SEC-11). Es gibt **keine** Rolle `NinaPmDbAccess` und **keine** DB-Rolle `app_ro` mehr (SEC-12) |
| S3 `data` | Block Public Access, Präfixe `tenant/<tenantId>/results/…`, `…/exports/…`, `…/imports/…`, `…/jobs/…`, `…/plans/…` und `audit/` (CloudTrail); Lifecycle: `exports/`/`imports/` 7 Tage, `jobs/` 2 Tage, `plans/` 400 Tage, `audit/` 400 Tage. Rechte: `api` und `worker` nur `GetObject`/`PutObject` auf `tenant/*` – **kein** `DeleteObject` (das erledigen die Lebenszyklusregeln) und **kein** `ListBucket`, damit Mandantenschlüssel nicht auflistbar sind (SEC-14) |
| S3 `web` | nur über CloudFront (OAC); `index.html` no-cache, gehashte Assets 1 Jahr Cache-Control (keine Lifecycle-Expiration; Aufräumen über den `weekly`-Job, letzte 3 Builds), `/catalog/img/*` und `/catalog/thumbs/*` Cache 30 Tage, `/downloads/*` 1 Tag |
| EventBridge Scheduler | 4 Zeitpläne in UTC (`tick-5min`, `tick-hourly`, `daily`, `weekly`) in der Gruppe `nina-pm` → `worker` über die Rolle `NinaPmSchedulerInvoke`; Jobs sind idempotent |
| IAM | **Eine Ausführungsrolle je Lambda**, ressourcengenau; die vollständigen Politiken (inklusive `lambda:InvokeFunction`, `sqs:SendMessage`, `kms:Decrypt`, Scheduler-Rolle und Deploy-Grenze) stehen verbindlich in **`specs/infra/iam.md`**. Was dort nicht steht, wird nicht vergeben; CDK-Assertions prüfen das (`iam.md` §12) |
| Alarme | → 16.2 |

### 4.3 Domain und CloudFront

#### Adressen

| Anwendung | API | NINA-Plugin-Basis | Discord-Redirect |
|---|---|---|---|
| `https://nina-pm.svenesis.org/` | `https://nina-pm.svenesis.org/api/` | `…/api/nina/v1` | `https://nina-pm.svenesis.org/api/auth/discord/callback` |

Die Route-53-Zone `svenesis.org` liegt im selben Konto; NINA-PM läuft **nur als prod** in diesem Konto (keine dev-/Staging-Umgebung, OT-04). CDK liest die Zone nur (`HostedZone.fromLookup`) und legt ausschließlich Validierungs- und Alias-Einträge für `nina-pm` an. Bestehende Einträge der Website bleiben unberührt.

#### Distribution (vollständig CDK)

| Reihenfolge | Pfadmuster | Origin | Cache-Policy | Origin-Request-Policy | Viewer-Request-Funktion | Response-Headers-Policy | Sonstiges |
|---|---|---|---|---|---|---|---|
| 0 | `/api/*` | HTTP API (`<id>.execute-api.eu-central-1.amazonaws.com`) | *CachingDisabled* | *AllViewerExceptHostHeader* | – | **`npm-api-static`** | alle Methoden; Custom Header `X-Origin-Verify` |
| 1 | `/catalog/*` | S3 `svenesis-nina-pm-web` (OAC) | *CachingOptimized* | – | – | **`npm-api-static`** | Katalog- und Projekt-Vorschaubilder |
| 2 | `/downloads/*` | S3 `svenesis-nina-pm-web` (OAC) | *CachingOptimized* | – | – | **`npm-api-static`** | Beispielsequenzen (FA-NIN-25) |
| Default | `*` | S3 `svenesis-nina-pm-web` (OAC) | *CachingOptimized* | – | `nina-pm-viewer-request` (SPA-Rewrite) | **`npm-html`** | – |

**Jedes** Behavior trägt eine Response-Headers-Policy (SEC-16): `npm-html` mit vollständiger CSP und HSTS für die Anwendung, `npm-api-static` mit HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy` und `Cross-Origin-Resource-Policy` – aber **ohne** CSP – für API, Katalog und Downloads. Vorher galten die Header nur auf dem Default-Behavior; `/downloads/*` (JSON-Beispielsequenzen) und `/api/*` (Problem-Details-JSON) liefen damit ohne `nosniff` und ohne HSTS. Der Wortlaut beider Politiken steht in `specs/infra/iam.md` §10.

- **Keine** distributionweiten Custom Error Responses (API-Fehler müssen unverändert durchkommen); unbekannte SPA-Pfade löst die Funktion auf.
- Preisklasse `PriceClass_100` (Europa/Nordamerika), HTTP/2 und HTTP/3, TLS 1.2+.
- Die Website-Distribution `E2L6Q80SD8XPT0` wird **nicht** verändert; kein Skript, kein Import.

```js
// infra/edge/nina-pm-viewer-request.js (CloudFront Functions Runtime 2.0)
function handler(event) {
  var req = event.request, uri = req.uri;
  if (uri.indexOf('/api/') === 0 || uri.indexOf('/catalog/') === 0 || uri.indexOf('/downloads/') === 0) return req;
  var last = uri.substring(uri.lastIndexOf('/') + 1);
  if (last.indexOf('.') === -1) req.uri = '/index.html';   // Client-Routen der SPA
  return req;
}
```

### 4.4 Umgebung und Konfiguration

Es gibt genau **eine** Umgebung: prod. `infra/config.ts` enthält Account, Region, Domain `nina-pm.svenesis.org`, Hosted Zone, Namen der SSM-Parameter (4.1; die Werte selbst stehen nur in SSM), Log-Aufbewahrung, Löschschutz, Alarm-E-Mail. Deployment ausschließlich über `deploy-prod.yml` mit manueller Freigabe (18); lokal nur `pnpm cdk synth` / `pnpm cdk diff`.

Absicherung ohne Vorab-Umgebung:

- **Lokal statt dev:** Web, API (Hono per Node-Adapter) und PostgreSQL 16 laufen lokal (6.9); dort laufen auch Test-Login und Playwright-E2E (17).
- **Kurzlebiger CI-DSQL-Cluster** für DSQL-spezifische Integrationstests (`dsql-it.yml`, 17): wird je Lauf angelegt und danach gelöscht; enthält nie Echtdaten und ist keine Umgebung mit Anwendung.
- **Test-Mandant in prod:** Der Super User legt einen Mandanten „Test“ an; manuelle Abnahme neuer Funktionen mit echtem Discord-Login und NINA-Simulatorgeräten (eigenes Test-Rig/Token) dort, getrennt von echten Mandanten durch die Mandantenisolation.
- **Vor dem Go-live (AP-17)** ist `nina-pm.svenesis.org` erreichbar, aber nirgends verlinkt; Anmeldung ist nur für Bootstrap-Super-User und Eingeladene möglich (5).

### 4.5 Einbindung in die Website www.svenesis.org

Die Website bleibt ein eigenes Projekt (`Cursor-AI/www.svenesis.org`, eigene `CLAUDE.md`, reines HTML/CSS/JS). Für NINA-PM fallen dort nur diese Änderungen an – in der Verantwortung und nach den Regeln des Website-Projekts:

| Nr. | Änderung | Wann |
|---|---|---|
| W-1 | Menüeintrag **„Svenesis-NINA-PM“** im Dropdown *Astronomie* auf allen Seiten mit Navigation (derzeit 102, beide Sprachen), Ziel `https://nina-pm.svenesis.org/?lang=de` bzw. `?lang=en` | Go-live |
| W-2 | Optional: kurzer Hinweis in der Datenschutzerklärung der Website, dass NINA-PM eine eigene Datenschutzerklärung unter `nina-pm.svenesis.org` hat | Go-live |
| W-3 | Optional: Abschnitt „Svenesis-NINA-PM“ in der `CLAUDE.md` der Website (Subdomain gehört zu einem eigenen Projekt; DNS-Einträge `nina-pm*` werden per CDK verwaltet; Astro-Tools dienen dort als Kopiervorlage und bleiben unverändert) | AP-17 |

**Nicht** geändert werden: Astro-Tools (Seiten, Skripte, Daten, Bilder), `style.css`, `main.js`, `cookie-consent.js`, `setup-www-redirect.sh`, `deploy.sh`, die Distribution `E2L6Q80SD8XPT0`.

---

## 5. Authentifizierung und Autorisierung (Discord)

### 5.1 Discord-Anwendung

- Discord Developer Portal: eine Anwendung „Svenesis NINA-PM“, OAuth2-Redirect-URI
  `https://nina-pm.svenesis.org/api/auth/discord/callback`.
- Scope **`identify`** (liefert `id`, `username`, `global_name`, `avatar`, `mfa_enabled`). `email` nur, wenn später benötigt.
- Vertraulicher Client (Client-Secret nur in SSM). Das Discord-Access-Token wird **nicht gespeichert** und nach dem Abruf von `/users/@me` verworfen.

### 5.2 Anmeldeablauf

```
Browser                      api (/auth)                             Discord
  │ (bei Einladungslink zuerst: POST /api/auth/invitation/claim {token}
  │   → setzt __Host-npm_invite, HttpOnly, 15 min, signiert; Antwort nur {tenantName, role})
  │ GET /api/auth/discord/start?next=/…&mandant=xy
  │───────────────────────────▶│ state = random(32), nonce-Cookie __Host-npm_oauth
  │                            │   (HttpOnly, 10 min, enthält state, next, mandant – signiert);
  │                            │   das Einladungs-Token steht NUR im Cookie, nie in einer URL (DAT5-15)
  │◀── 302 discord.com/oauth2/authorize?client_id…&scope=identify&state…&redirect_uri…
  │──────────────────────────────────────────────────────────────────▶│ Login/Consent
  │◀──────────────────────────────── 302 /api/auth/discord/callback?code&state
  │───────────────────────────▶│ 1. state gegen Cookie prüfen
  │                            │ 2. POST discord.com/api/oauth2/token (code → access_token)
  │                            │ 3. GET  discord.com/api/users/@me
  │                            │ 4. identity upsert (discord_user_id), mfa_enabled aktualisieren;
  │                            │    identity.status = blocked → /kein-zugang + login_audit
  │                            │ 5. Cookie __Host-npm_invite vorhanden? → prüfen (nicht widerrufen, nicht abgelaufen,
  │                            │    used_count < max_uses, ggf. discord_user_id passt, Mandant aktiv),
  │                            │    app_user anlegen, used_count++; Rolle 'owner' → role=admin und
  │                            │    tenant.owner_member_id setzen (nur wenn leer bzw. per Neuzuweisung);
  │                            │    befristete Admin-Einladung → role_expires_at = jetzt + role_duration_hours
  │                            │ 6. aktive Mitgliedschaften aktiver Mandanten + super_user laden
  │                            │    (Bootstrap: Discord-ID in SSM-Liste und noch kein super_user →
  │                            │    anlegen, system_audit actor=bootstrap)
  │                            │    0 → ctx=select, Weiterleitung /kein-zugang
  │                            │    1 (oder mandant passt) → ctx=tenant
  │                            │    >1 → ctx=select, Weiterleitung /mandant-waehlen
  │                            │ 7. auth_session anlegen, Cookies setzen, login_audit
  │◀── 302 next (nur relative Pfade derselben Anwendung zulässig)
```

- **Kontextwechsel:** `POST /api/auth/context {tenantKey | "system"}` prüft Mitgliedschaft bzw. Super-User + `mfa_enabled` (System-Kontext und Owner-Aktionen nur < 12 h nach der Discord-Anmeldung, `auth_session.discord_login_at`), stellt neues Access-Token aus und aktualisiert `auth_session.tenant_id/context`.
- **Admin ohne 2FA** bei aktiver Mandanteneinstellung (FA-LOG-07): Token erhält `role=user` und Claim `mfaRequired=true` → UI-Hinweis. **Ausnahme Owner:** behält Admin-Rechte, nur Owner-exklusive Aktionen sind gesperrt; die Pflicht lässt sich nur aktivieren, wenn der Owner selbst 2FA hat.
- **`mfa_enabled`** ist nur zum Login-Zeitpunkt bekannt. Deshalb gilt der System-Kontext höchstens **12 h** ab Discord-Login (danach neue Anmeldung), Owner-exklusive Aktionen verlangen eine Discord-Anmeldung der letzten 12 h.

### 5.3 Tokens und Cookies

| Cookie | Inhalt | Lebensdauer | Attribute |
|---|---|---|---|
| `__Host-npm_at` | Access-JWT (HS256, `kid`) | 15 min | host-only (`nina-pm.svenesis.org`), HttpOnly, Secure, SameSite=Lax, Path=/ |
| `__Host-npm_rt` | Refresh-Token (256 Bit zufällig, nur Hash in `auth_session`) | 30 Tage rollierend, Inaktivität 8 h (Mandanteneinstellung) | host-only, HttpOnly, Secure, SameSite=Strict, Path=/ |
| `__Host-npm_oauth` | signierter OAuth-Zwischenstand | 10 min | host-only, HttpOnly, Secure, SameSite=Lax, Path=/ |

JWT-Claims:

```json
{ "sub": "<identityId>", "sid": "<authSessionId>", "ctx": "tenant|system|select",
  "tid": "<tenantId>", "mid": "<appUserId>", "role": "admin|user", "own": false, "mver": 1, "su": false,
  "mfa": true, "mfaRequired": false, "ver": 1, "iat": 0, "exp": 0 }
```

- **Refresh:** `POST /api/auth/refresh` rotiert das Refresh-Token (`prev_refresh_hash`, `rotated_at`). **Karenz 60 s:** kommt das vorherige Token innerhalb von 60 s erneut (parallele Anfragen, mehrere Tabs), liefert der Server dieselbe Sitzung mit neuem Access-Token aus, ohne erneut zu rotieren. Erst ein altes Token **außerhalb** der Karenz gilt als Wiederverwendung. Dann wird **nur die betroffene Sitzungsfamilie** widerrufen (`auth_session` dieser Kette), nicht alle Geräte; zusätzlich Eintrag `refresh_reuse_detected` im `login_audit` und eine Benachrichtigung an den Benutzer. Ein altes Token wird außerdem akzeptiert, solange das neue nachweislich **nie benutzt** wurde (`auth_session.new_token_used_at IS NULL`) – so führt eine verlorene Antwort nicht zur Abmeldung (DAT-7). Dazu gehören drei Festlegungen (DAT5-5):
  - **Sitzungsfamilie = die `auth_session`-Zeile.** Es gibt keine `family_id`; die Rotation aktualisiert die bestehende Zeile *in place* (`refresh_hash` neu, alter Wert nach `prev_refresh_hash`, `rotated_at = jetzt`). „Familie widerrufen“ heißt: `revoked_at` auf dieser einen Zeile setzen.
  - **`new_token_used_at` wird bei *jeder* Rotation auf `NULL` gesetzt** und erst beim ersten erfolgreichen Refresh mit dem neuen Token gefüllt. Ohne dieses Zurücksetzen bliebe die Ausnahme nach der zweiten Rotation dauerhaft aktiv.
  - **Zeitgrenze:** Die Ausnahme „neues Token nie benutzt“ gilt nur bis **`rotated_at + 10 min`**. Danach ist ein altes Token immer Wiederverwendung. Ohne diese Grenze wäre ein gestohlenes altes Token bis zum Ablauf der Sitzung (30 Tage) gültig.
- **Frontend-Verhalten:** 401 `auth.token_expired`/`auth.token_stale` → **ein** gemeinsamer Refresh (Single-Flight, tabübergreifend über `navigator.locks`), wartende Anfragen werden danach wiederholt; scheitert Refresh → Anmeldeseite.
- **CSRF (verbindlich, SEC-26):** drei Bedingungen für **alle** nicht-GET-Methoden: (1) SameSite-Cookies, (2) Pflicht-Header `X-NPM-Request: 1` (der Browser kann ihn cross-site nicht ohne CORS-Preflight setzen; CORS ist nicht freigegeben – Web-App und API teilen den Origin), (3) **Herkunftsprüfung**: `Sec-Fetch-Site` muss `same-origin` sein, oder – falls der Header fehlt – `Origin` muss `https://nina-pm.svenesis.org` lauten. Fehlen beide Angaben oder passen sie nicht, antwortet die Middleware `403 auth.origin_invalid`. Ausgenommen sind nur die GET-Routen des Anmeldeablaufs (`/auth/discord/start`, `/auth/discord/callback`), die als Top-Level-Navigation kommen. Die NINA-API (`/nina/v1`, Bearer-Token, kein Cookie) ist von CSRF nicht betroffen und von der Prüfung ausgenommen.
- **Schlüsselrotation (zweiphasig, DAT-5):** `jwt/signing-keys` enthält `{current: kid, keys: {kid: secret}}`. Phase 1: neuen Schlüssel **nur zu `keys`** hinzufügen (alle Container verifizieren ihn nach ≤ 5 min); Phase 2 (nach ≥ 10 min): `current` umstellen; Phase 3 **frühestens 20 min nach Phase 2** (Zugriffstoken-Laufzeit 15 min + SSM-Cache 60 s + Puffer): alten Schlüssel entfernen. Das Rotationsskript wartet die Zeit selbst ab und protokolliert die drei Phasen (DAT5-10).
- **Origin-Verify-Rotation (drei Schritte, DAT5-10):** (1) neuen Wert nach `/nina-pm/origin-verify` schreiben und den alten nach `/nina-pm/origin-verify-prev`; (2) **≥ 2 min warten** (SSM-Cache 60 s + Puffer), dann den CloudFront-Origin-Header auf den neuen Wert umstellen und das Deployment abwarten; (3) `/nina-pm/origin-verify-prev` löschen. Die Lambda akzeptiert in Schritt 1–2 beide Werte; danach nur noch einen.

### 5.4 Super User und Notfallzugang

- **Bootstrap:** `api` liest den SSM-Parameter `/nina-pm/bootstrap-super-users`; beim ersten Login einer gelisteten Discord-ID wird `super_user` angelegt (`created_by = null`, `system_audit.actor = 'bootstrap'`). **Der Parameter ist ein Eskalationspfad** – wer ihn schreiben kann, wird Super User: Schreibzugriff ist deshalb allen Lambda-Rollen **und** der Deploy-Grenze ausdrücklich verweigert, ein CloudTrail-Alarm feuert bei jedem `PutParameter` darauf, und nach dem ersten erfolgreichen Super-User-Login wird der Parameter **auf leer** gesetzt (H-08, Runbook `superuser-emergency.md`, SEC-21).
- **Voraussetzung System-Kontext:** `mfa_enabled = true` (FA-SU-02).
- **Notfallzugang (FA-SU-06, NFA-20):** Lambda `ops-cli`, nur per `aws lambda invoke` durch die Rolle **`NinaPmOpsInvoker`** aufrufbar – deren Annahme verlangt **MFA**, die höchstens 1 h alt sein darf, und die ressourcenbasierte Politik der Lambda lässt genau diesen Principal zu (SEC-9, `specs/infra/iam.md` §5). Befehle: `help`, `create-tenant --key … --name …`, `create-invitation --tenant … --role owner|admin`, `set-owner --tenant … --member …`, `block-identity --discord-id …`, `grant-super-user --discord-id …`, `revoke-sessions --identity …`, `unlock-tenant …`, `seed --tenant test` (Demo-Daten aus `docs/seed/`), `revoke-nina-token --instance …`. Befehl `list-failed-jobs` liest zusätzlich die Warteschlange `nina-pm-worker-failures` (SEC-8). Jeder Aufruf → `system_audit` mit `actor = 'ops_cli'` und IAM-Principal **und** `sns:Publish` am Alarm-Topic („Notfallzugang benutzt: `<befehl>` durch `<principal>`“) – ein Notfallzugang, der still benutzt werden kann, ist keiner.

### 5.5 Autorisierung

- **Berechtigungsmatrix als Code** in `packages/shared/src/permissions.ts` (Quelle: Fachkonzept 6.14):

```ts
export type Action =
  | 'equipment.read' | 'equipment.write'
  | 'project.read' | 'project.create' | 'project.update' | 'project.delete'
  | 'project.submit' | 'project.withdraw' | 'project.rank' | 'queue.read' | 'queue.vote' | 'queue.decide' | 'project.status'
  | 'rig.settings.write' | 'simulation.run' | 'nina.instance.manage'
  | 'session.read' | 'session.correct' | 'session.review' | 'sessionlog.write'
  | 'transit.result.import' | 'project.note.write' | 'project.history.read' | 'nina.instance.read'
  | 'member.manage' | 'member.admin.manage' | 'member.leave' | 'tenant.owner.transfer' | 'tenant.security'
  | 'tenant.settings' | 'tenant.export' | 'tenant.import' | 'system.manage' | 'system.tenant.owner'
  | 'changeRequest.create' | 'changeRequest.update' | 'transit.lock' | 'session.report.resend'
  | 'notification.read' | 'me.preferences' | 'me.favorites' | 'job.read'
  | 'public';                                   // öffentliche Routen (Auth-Start/-Callback, Einladungs-Vorschau, Health)

export function can(ctx: AuthContext, action: Action, res?: ResourceMeta): boolean
// z. B. project.update: admin → true; user → res.createdBy === ctx.memberId
//                        && ['draft','returned'].includes(res.approvalStatus)
// member.manage:        admin → res.targetRole === 'user' && !res.targetIsOwner
// member.admin.manage, tenant.owner.transfer, tenant.security: ctx.isOwner && ctx.mfa
//                        && res?.targetMemberId !== ctx.memberId   (Owner ändert sich nie selbst)
// member.leave:         !ctx.isOwner
// transit.lock:         admin → true; user → res.createdBy === ctx.memberId && res.approvalStatus === 'approved'
//                        && res.openLocks < settings.exoUserMaxOpenLocks (Standard 3)
//                        (vor Freigabe nur Status 'requested'; exoUserLockNeedsAdmin, Standard true → bleibt 'requested' bis Bestätigung)
// changeRequest.update: Antragsteller (status open) oder admin
// session.correct:      admin → true; user → eigenes Objekt && tenant.settings.userCorrections
// Jede Aktion mit Ziel = Owner ist für alle Mandanten-Rollen verboten (nur system.tenant.owner)
```

- Jede Route deklariert ihre Aktion (`route.meta.action`, auch rein persönliche Routen wie Favoriten; öffentliche Routen explizit `public`); Middleware erzwingt `can()` vor dem Handler. Ein Test generiert für **jede Route × {owner, admin, befristeter Admin, user, fremder Mandant, ohne Login}** einen Aufruf (NFA-17).
- Das Frontend nutzt dieselbe Funktion (`useCan(action, res)`) nur zum Ein-/Ausblenden.
- **Statusprüfung:** Access-Token gilt 15 min. Das Token trägt `mver` (= `app_user.member_version`, wird nur bei Rolle, Status, Befristung oder Owner-Wechsel erhöht – nicht bei Namensänderungen) und `sid`. Jede Anfrage vergleicht in **einer** Abfrage `member_version`, Befristung, `auth_session.revoked_at`, `identity.status` (gesperrt → **`403 auth.identity_blocked`**, wie `errors.json`: die Anmeldung ist gültig, der Zugang verweigert; DAT5-8), `tenant.status` (`locked` → `403 tenant.locked`) und im System-Kontext `super_user.status` (Cache 60 s je Lambda-Container; für `member.*`, `tenant.owner.transfer`, `tenant.security` und `queue.decide` ohne Cache). „Überall abmelden“ und `revoke-sessions` wirken damit ebenfalls nach spätestens 60 s. Abweichung oder abgelaufene Befristung → `401 token_stale` → Frontend ruft einmal `refresh` auf und erhält Claims mit der aktuellen Rolle. Damit wirken Herabstufung, Fristablauf und Deaktivierung spätestens nach 60 s.
- **Owner ausstehend (FA-BEN-03):** `tenant.owner_state = 'pending'`, solange die Owner-Einladung offen oder verfallen ist; dann sind `member.admin.manage`, `tenant.owner.transfer` und `tenant.security` für alle Mandanten-Rollen gesperrt, `tick-5min` benachrichtigt den Super User bei Verfall. Annahme der Einladung setzt `owner_state = 'active'`.
- **Owner-Invarianten** (Repository `MemberRepository`, Transaktion mit OCC-Retry und `SELECT … FOR UPDATE` auf der `tenant`-Zeile als Wächter): `tenant.owner_member_id` zeigt immer auf ein aktives Mitglied mit `role='admin'` und `role_expires_at IS NULL`; Rollen-/Statusänderungen am Owner werden abgelehnt (`409 member.owner_protected`); Übertragung setzt `owner_transfer_to`, Annahme tauscht in **einer** Transaktion (neuer Owner: Befristung entfernt; alter Owner bleibt Admin; bei Notfall-Neuzuweisung durch den Super User wird der alte Owner standardmäßig deaktiviert). Tests: Admin versucht Owner herabzustufen/zu deaktivieren/zu entfernen, Admin ernennt Admin, Admin verlängert eigene Befristung, befristeter Admin nach Ablauf, Owner verlässt Mandant – jeweils abgelehnt bzw. korrekt.

### 5.6 NINA-Instanzen

- Token-Format `npm_<base62(32 Bytes)>`, einmalig angezeigt; gespeichert `sha256` + Präfix.
- Header `Authorization: Bearer …`; `api` ermittelt für `/nina/v1` `tenant_id`, `rig_id`; prüft `tenant.status = active` (sonst **`403 tenant.locked`**, gleiche Antwort wie im Web-Kontext, DAT5-22; das Plugin behandelt sie als `blocked{tenant_locked}` und beendet die Nacht geordnet) und `nina_instance.status = active` (sonst `401 nina.token_invalid`); Cache 60 s.
- Rechte: nur Daten des eigenen Rigs lesen, nur Sessions/Aufnahmen/Ereignisse/Heartbeat dieses Rigs schreiben.
- **Lease je Rig (FA-RIG-06, Zeitschwellen FK 8.1, Schema 1.9+ `rig_lease`):** Die Lease steht in der eigenen Tabelle **`rig_lease`** (`rig_id` PK, `active_session_id`, `lease_until`, `offline_until`) – nicht mehr auf der `rig`-Zeile (DAT5-2). `POST /sessions` macht einen **Upsert** auf `rig_lease` in einer Transaktion mit `SELECT … FOR UPDATE` auf **`rig_lease`** (nie auf `rig`) und setzt `active_session_id` und `lease_until = jetzt + 3 min`; jeder Heartbeat (60 s) mit `sessionId` verlängert `lease_until`. Die Zeile wird beim **Anlegen des Rigs** mit `active_session_id = NULL`, `lease_until = NULL`, `offline_until = NULL` erzeugt (DAT5-19); ein fehlender Datensatz (Altbestand, Import) wird beim ersten `POST /sessions` per `INSERT … ON CONFLICT DO NOTHING` nachgelegt. Hält eine **andere** Session eine gültige Lease → `409 session.rig_busy`; das Plugin plant dann nur (Simulation) und zeigt die Warnung. Sessionende oder Lease-Ablauf gibt das Rig frei (`active_session_id = NULL`).
- **Eigene Session fortsetzen:** Dieselbe Instanz mit derselben `sessionId` (nach Neustart persistiert) erhält die Lease auch nach Ablauf zurück, sofern keine andere Session sie inzwischen hält (`PATCH /sessions/{id}` erneuert).
- **Übernahme durch Admin** (`POST /web/v1/rigs/{id}/lease/release`): setzt die Lease zurück; der nächste Heartbeat der alten Instanz erhält `lease.leaseLost = true` → laufende Belichtung zu Ende, keine neuen Blöcke, Ereignis `lease_lost`; weitere Aufnahmen dieser Session werden gespeichert, aber mit Warnung markiert.
- **Offline-Modus (FA-NIN-04, Spalten verbindlich, DAT5-3):** Heartbeat `{state: "offline", offlineUntil?}` setzt `rig_lease.offline_until` (höchstens 14 Tage) und `session.offline_since = jetzt`; bis zum nächsten Online-Heartbeat bleibt die Lease eingefroren (kein Ablauf, keine `stale`-Markierung, keine Alarme). Beim ersten Online-Heartbeat werden `rig_lease.offline_until` und `session.offline_since` auf `NULL` gesetzt (Ereignis `offline_end`).
  - **„nicht offline“ = `session.offline_since IS NULL`.** Genau diese Bedingung steuert die `stale`-Ausnahme im Job `tick-5min` (13) und die Alarme (16.2).
  - **`session.created_offline`** (beim Anlegen gesetzt, danach unverändert) steuert **nur** die Lease-Ausnahme: solche Sessions werden beim Nachmelden **auch ohne Lease** angenommen (`offline: true`, 6.6). Sie verwaisen normal, sobald sie online gemeldet sind – `created_offline` allein verhindert das nicht.
  - Gibt es für die Nacht bereits eine andere Session des Rigs, werden beide gespeichert und der Alarm `rig.busy` ausgelöst.

---

## 6. Datenbank (Aurora DSQL)

*(früher Fachkonzept v0.6, Kap. 15; das Fachkonzept enthält nur noch die fachliche Sicht in Kap. 7)*

Das vollständige DDL steht in **`schema_aurora_dsql.sql`** (52 Tabellen; `schema_migration` legt der Runner zusätzlich an; syntaktisch gegen PostgreSQL 16 geprüft; `CREATE INDEX ASYNC` ist DSQL-spezifisch). Produktiv ist die Quelle der Wahrheit die Migrationsfolge in `packages/db/migrations/`.

### 6.0 DSQL-Fakten (geprüft 17.09.2026)

| Thema | Stand | Folge für NINA-PM |
|---|---|---|
| Fremdschlüssel | seit 27.08.2026 unterstützt (inkl. ON DELETE-Aktionen); nachträglich per `ALTER TABLE ADD CONSTRAINT` nur mit `NOT VALID` + `ALTER TABLE ASYNC … VALIDATE CONSTRAINT` | FKs im Schema; kein ON DELETE (3.000-Zeilen-Grenze); nachträgliche Constraints nur `NOT VALID` |
| `json`/`jsonb` | als Spaltentyp unterstützt, je Wert max. 1 MiB **komprimiert**, nicht indexierbar | kleine Dokumente in `jsonb`; Planprotokolle und Exporte in S3 |
| `ALTER TABLE` | `ADD COLUMN` (mit DEFAULT), `DROP COLUMN`, `SET/DROP DEFAULT`, `DROP NOT NULL`, `RENAME`; **kein** `ALTER COLUMN TYPE`; max. 255 aktive Spalten | Typänderung = neue Spalte + Nachfüllen in Stapeln |
| Nebenläufigkeit | Isolation fest `REPEATABLE READ`, optimistische Konflikterkennung (SQLSTATE `40001`/`OC000`); `SELECT … FOR UPDATE` nimmt gelesene Zeilen in die Konflikterkennung auf; keine pessimistischen Sperren | Invarianten über mehrere Zeilen mit Wächterzeile + `FOR UPDATE` (6.6) |
| Grenzen | max. 3.000 geänderte Zeilen je Transaktion, begrenztes Datenvolumen und Laufzeit je Transaktion (~5 min), 1 DDL je Transaktion, DDL und DML getrennt, Verbindung max. 1 h | Stapel ≤ 2.500 **mit Fortschrittsmarker im Job** (wiederaufsetzbar), Migrationsrunner, Pool `maxLifetime` 50 min |
| Nicht unterstützt | Trigger, PL/pgSQL, TRUNCATE, TEMP TABLE, mehrere Datenbanken, Tablespaces | Logik in der Anwendung |
| Backup | AWS Backup (voll, geplant/on-demand), **kein Point-in-Time-Restore**; Restore erzeugt immer einen **neuen Cluster** | RPO 24 h (plus Nachmelden aus dem Plugin, 6.10) |

Quellen: AWS What's New 27.08.2026 (Foreign Keys); Aurora-DSQL-Doku „Supported data types“, „ALTER TABLE“, „Unsupported features“, „Concurrency control“, „Backup and restore“.

**In AP-S1 zwingend zuerst zu prüfen** (Reihenfolge = Risiko): (1) Fremdschlüssel überhaupt und mit `NOT VALID`; (2) `json`/`jsonb` als **Spaltentyp** (das Schema nutzt ~40 solcher Spalten); (3) `INSERT … ON CONFLICT`; (4) Name der Wartefunktion für `CREATE INDEX ASYNC`; (5) `GRANT`-Syntax für neue Tabellen; (6) tatsächliche Grenzen für Datenvolumen und Laufzeit je Transaktion. **Fallback, falls (1) oder (2) nicht gilt:** FKs weglassen (Integrität im Repository, Abgleich-Job sucht Waisen, OT-18) bzw. `jsonb`-Spalten als `text` mit `::jsonb`-Cast beim Lesen und Validierung über zod – beides ist eine Migration 0000-Variante und ändert die Anwendungslogik nicht.

### 6.1 Leitlinien

| Regel | Umsetzung |
|---|---|
| Mandantentrennung ohne RLS | `tenant_id` in jeder Mandantentabelle; Indizes für Mandantenabfragen beginnen mit `tenant_id` (ausgenommen PK/UNIQUE auf global eindeutigen UUIDs und identitätsbezogene Indizes); Repository-Layer verlangt Mandantenkontext; Tests je Tabelle (NFA-16) |
| Primärschlüssel | `uuid`, im Code als **UUID v7** erzeugt (`gen_random_uuid()` nur DB-Standard); Aufnahmen, Ereignisse, Sessions mit **vom Plugin erzeugter UUID v7** → idempotenter Upload |
| Fremdschlüssel | gesetzt; `ON DELETE`-Aktionen werden von DSQL unterstützt, aber **nicht genutzt** (Löschen in Stapeln im Repository); nachträglich nur `NOT VALID` |
| Keine Trigger / kein PL/pgSQL | Zähler (`acquired_count`, `rejected_count`, `bonus_count`, `bonus_rejected_count`; bei Exoplaneten zusätzlich je `transit_observation`) und Aggregat `capture_night` werden in derselben Transaktion wie die Meldung gepflegt; **`capture_night` hat genau eine Zeile je (Zeile, Nacht)** mit `rejected_individual`, `rejected_correction` und dem wirksamen `rejected_count = max(...)` – Summieren über Quellen ist verboten; nächtlicher Abgleich-Job |
| 3.000-Zeilen-/1-MiB-Grenze | Planprotokoll in S3 (`night_plan.log_s3_key`); Löschen/Import in Stapeln; Aufnahmen in Paketen ≤ 500; `withTx` zählt geänderte Zeilen und bricht in Tests ab 3.000 ab |
| Aufzählungen | `text` + `CHECK` |
| Keine Bilder in der DB | Vorschaubilder, Ergebnisdateien, Lichtkurven in S3 (`thumbnail_s3_key`, `file_s3_key`) |
| Zeit | `timestamptz` (UTC); Nacht als `date` (Abenddatum am Standort) |
| Freitext | Markdown (`*_md`) statt RTF |
| Optimistische Sperre | `version` an Projekt, `settings_version` am Rig |

### 6.2 Tabellengruppen

| Gruppe | Tabellen |
|---|---|
| System (global) | `identity`, `super_user`, `tenant`, `discord_channel` und `discord_delivery` (je Mandant), `system_audit`, `system_setting`, `dso_object`, `exo_catalog_entry`, `weather_cache`, `job` |
| Mandant, Anmeldung, Benutzer | `app_user` (Mitgliedschaft), `invitation`, `auth_session`, `user_preference`, `identity_preference`, `favorite`, `login_audit`, `notification`, `change_log` |
| Ausrüstung | `site`, `site_link`, `telescope`, `camera`, `filter`, `moon_profile`, `exposure_template`, `exposure_template_line`, `rig`, `rig_lease`, `nina_instance` |
| Projekte & Freigabe | `project`, `project_panel`, `exposure_line`, `project_note`, `approval_event`, `change_request`, `queue_vote` |
| Exoplaneten | `exo_project`, `ephemeris`, `transit_observation`, `transit_result` |
| Ausführung & Auswertung | `night_plan`, `session`, `session_event`, `capture`, `capture_night`, `correction`, `flat_combination`, `session_log`, `site_night_stat`, `command` |

**Rechte je Gruppe (verbindlich, SEC-4).** `api` arbeitet als `app_rw`, `worker` als `app_job`. Jede Tabellen-Migration vergibt beide Sätze nach dieser Tabelle (Vorlage am Ende des Schemas, DSQL-Lint prüft die Vollständigkeit):

| Gruppe | `app_rw` (api) | `app_job` (worker) |
|---|---|---|
| System (global) | `SELECT` auf `dso_object`, `exo_catalog_entry`, `weather_cache`; sonst `SELECT,INSERT,UPDATE,DELETE` | `SELECT,INSERT,UPDATE,DELETE` auf `dso_object`, `exo_catalog_entry`, `weather_cache`, `job`, `discord_delivery`, `system_audit`; `SELECT` auf `identity`, `super_user`, `tenant`, `discord_channel`, `system_setting` |
| Mandant, Anmeldung, Benutzer | `SELECT,INSERT,UPDATE,DELETE` | **`SELECT` auf `app_user`, `tenant`; `INSERT` auf `notification`, `change_log`, `login_audit`; `UPDATE` auf `app_user` (Rollenablauf `tick-5min`)** – **kein** Zugriff auf `auth_session`, `invitation`, `user_preference`, `identity_preference`, `favorite` |
| Ausrüstung | `SELECT,INSERT,UPDATE,DELETE` | `SELECT`; `UPDATE` nur auf `rig_lease` (Lease-Ablauf) – **kein** Schreibzugriff auf `nina_instance` (Tokens) |
| Projekte & Freigabe | `SELECT,INSERT,UPDATE,DELETE` | `SELECT`; `UPDATE` auf `project` (Statuswechsel durch Jobs), `exposure_line` (Zähler-Abgleich), `project_note` nein |
| Exoplaneten | `SELECT,INSERT,UPDATE,DELETE` | `SELECT`; `INSERT,UPDATE` auf `ephemeris`, `transit_observation`, `transit_result` (Kataloge, Fristen, Ergebnisimport) |
| Ausführung & Auswertung | `SELECT,INSERT,UPDATE,DELETE` | `SELECT,INSERT,UPDATE,DELETE` (Sessionabschluss, Abgleich, Prognose, Flats) |

Damit kann `worker` weder Sitzungen kapern (`auth_session`) noch NINA-Tokens tauschen (`nina_instance`), und `api` kann keine Kataloge überschreiben. Neue Tabellen ohne Zuordnung lehnt der DSQL-Lint ab.

### 6.3 Wichtige Abfragen (Indizes darauf ausgelegt)

- NINA-Auslieferung: `project (tenant_id, rig_id, status, priority)` → `project_panel` → `exposure_line`. Die Regel steht einmal als `isDeliverable()` in `packages/shared`: `approval_status='approved' ∧ status='active' ∧ deleted_at IS NULL ∧ rig.nina_delivery_enabled ∧ (start_date IS NULL ∨ start_date ≤ Nacht) ∧ (Deep-Sky: aktive, nicht archivierte, nicht für die Nacht abgeschaltete Zeile (`disabled_for_night ≠ Nacht`) mit **Planungsbedarf > 0** (Verbleibend + Überschuss, FK 8.4) **oder** `bonus_enabled` des Rigs (Bonus-Füllung ohne Obergrenze) | Exoplanet: mindestens eine `transit_observation.status='locked'` mit Fensterende in der Zukunft)`. „Soll erreicht“ (Verbleibend = 0) und „fertig“ (Planungsbedarf = 0) berechnet `projectProgress()` in `packages/shared` (FA-PRJ-12). Steigt der Planungsbedarf eines Projekts im Status `ready_to_process` wieder über 0 (Verwerfen), setzt die Anwendung es zurück auf `active` (Mandanteneinstellung `autoReactivateOnRemaining`, Standard an) bzw. erzeugt einen Hinweis. Zulässige Statusübergänge stehen in `contracts/enums.json` `projectStatusTransitions` (sonst `409 project.status_transition_invalid`).
- Warteschlange: `project (tenant_id, approval_status, created_by)` + `change_request (tenant_id, status)`; Stimmen je Gegenstand über den Primärschlüssel von `queue_vote` gezählt (kleine Mengen, keine Zählerspalte → keine OCC-Konflikte beim gleichzeitigen Abstimmen); `mine` über `(tenant_id, voter_id)`.
- „Geändert seit deiner Stimme“: inhaltliche Änderungen an eingereichten Projekten bzw. offenen Änderungsanträgen setzen `content_changed_at` (Feldliste als `CONTENT_FIELDS` in `packages/shared`; Priorität, Notizen, Favoriten zählen nicht). Admin-Änderung → `approval_event(action='edited_by_admin', snapshot = Diff)` + `notification(kind='submission.edited_by_admin')` an den Einreicher. `changedSinceVote = content_changed_at > queue_vote.acknowledged_at`.
- Rang beim Einreicher: Umsortieren schreibt alle offenen Gegenstände eines Users in **einer** Transaktion (`withTx`, bei 40001 Wiederholung); Einreichen setzt `max(rank)+1`, Zurückziehen/Entscheiden verdichtet die Ränge.
- Fortschritt je Nacht: `capture_night (tenant_id, project_id, night)`.
- Session-Detail: `capture (tenant_id, session_id, captured_at)`; Pläne einer Session über `night_plan.session_id` (Revisionen); `session_event (tenant_id, session_id, occurred_at)`.
- Simulator-Historie: `night_plan (tenant_id, rig_id, night, created_at)`.
- Anmeldung: `identity (discord_user_id)`, `app_user (identity_id, status)`, `auth_session (refresh_hash)`.

### 6.4 Abgeleitete Werte (nicht gespeichert)

`accepted = max(0, acquired_count − rejected_count)` (`rejected_count` je Zeile und Nacht = max(Korrektur, einzeln verworfene Nicht-Bonus-Aufnahmen), FK FA-AUS-06) · `remaining = max(0, planned_count − accepted)` · `planning_need = max(0, ⌈planned_count × (1 + overshootPct/100)⌉ − accepted)` · `integration_s = (accepted + bonus_count − bonus_rejected_count) × exposure_s` (Fachkonzept 8.4) · Exoplaneten: dieselben Formeln auf den Zählern der festgelegten `transit_observation` · Bildfeld und Maßstab aus Rig · Transitzeiten aus aktiver `ephemeris`.

### 6.5 Verbindung aus Lambda

```ts
// packages/db/src/connection.ts (nur von Repositories importierbar)
import { DsqlSigner } from '@aws-sdk/dsql-signer';
import pg from 'pg';
import { Kysely, PostgresDialect, CamelCasePlugin } from 'kysely';

const signer = new DsqlSigner({ hostname: process.env.DSQL_ENDPOINT!, region: process.env.AWS_REGION! });
// Pool mit max 2 Verbindungen je Container; Passwort = kurzlebiges IAM-Token (Funktion wird je Verbindungsaufbau aufgerufen)
const pool = new pg.Pool({
  host: process.env.DSQL_ENDPOINT, port: 5432, database: 'postgres',
  user: process.env.DSQL_DB_ROLE!,        // 'app_rw' in api/ops-cli, 'app_job' in worker (SEC-4)
  password: () => signer.getDbConnectAuthToken(), ssl: { rejectUnauthorized: true },
  max: 2, idleTimeoutMillis: 60_000, maxLifetimeSeconds: 50 * 60,   // < 1 h DSQL-Verbindungslimit
});
export const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }), plugins: [new CamelCasePlugin()] });
```

**Bevorzugt** wird der offizielle Aurora-DSQL-Connector für node-postgres (Token-Erneuerung, Pooling), sonst obiger Pool. In beiden Fällen `pool.on('error', …)` registrieren (eingefrorene Container finden geschlossene Verbindungen vor) und den Endpunkt aus dem SSM-Parameter `/nina-pm/dsql-endpoint` beim Start lesen.

### 6.6 Transaktionen, Konflikte, Idempotenz

- **`withTx(ctx, fn, { guard? })`**: kurze Transaktionen; bei OCC-Konflikt (`40001`/`OC000`) bis zu 3 Wiederholungen mit Jitter (50/150/400 ms). Alle schreibenden Use-Cases sind wiederholbar formuliert. `guard` liest Wächterzeilen mit `SELECT … FOR UPDATE`, damit auch nur gelesene Bedingungen Konflikte auslösen – Pflicht für: Owner-Invarianten (`tenant`), Abstimmen vs. Entscheidung (`project`), **Rang beim Einreicher (`app_user`-Zeile des Einreichers** – beim ersten Objekt gibt es noch keine `project`-Zeile, DAT-17), Rollen-Ablauf (`app_user`), Rig-Lease (`rig_lease`), **Zähler je Belichtungszeile (`exposure_line`)**. Zählerpfade schreiben die Wächterzeile immer (`updated_at`), auch wenn sich der Wert nicht ändert – sonst bleibt ein paralleler Abzug unentdeckt (DAT-2). Ein Zeilenzähler bricht in Tests ab 3.000 geänderten Zeilen ab.
- **Aufnahmen-Upload** (≤ 500 je Anfrage):
  0. Session muss existieren, sonst `409 session.unknown` (Plugin sendet die Session erneut, strikte Reihenfolge je Session). Sessions mit `offline: true` werden ohne Lease-Prüfung angelegt (5.6). Jede Meldung trägt `nightPlanId`; **einzige Ausnahme:** eine offline angelegte Session (`created_offline`) darf `nightPlanId = null` melden, solange ihr Offline-Plan noch nicht per `PATCH … {offline: true, offlinePlan}` nachgemeldet ist – beim Nachmelden setzt der Server die neue ID in alle betroffenen `capture`- und `session_event`-Zeilen ein (NIN5-14). Online ohne `nightPlanId` → `rejected_invalid`. Blöcke sind über ihre UUID eindeutig.
  1. `INSERT INTO capture … ON CONFLICT (id) DO NOTHING RETURNING id, frame_type, exposure_line_id, transit_observation_id, project_ids, night, result, is_bonus` (falls `ON CONFLICT` in DSQL nicht verfügbar: vorheriges `SELECT id … WHERE id = ANY($1)` und nur neue einfügen).
  2. Für die tatsächlich neuen Zeilen aggregiert: `UPDATE exposure_line SET acquired_count = acquired_count + n, bonus_count = …`, bei Exoplaneten zusätzlich `transit_observation.acquired_count`, und Upsert `capture_night`. **Sperrreihenfolge (verbindlich, DAT5-20):** Die Wächterzeilen werden **aufsteigend nach `exposure_line_id`** (UUID-Vergleich, ordinal) mit `SELECT … FOR UPDATE` gelesen, danach – falls betroffen – `transit_observation` aufsteigend nach `id`. Ein Paket mit Aufnahmen zu mehreren Zeilen sperrt also immer in derselben Reihenfolge; zwei parallele Pakete können sich damit nicht gegenseitig blockieren (Deadlock statt OCC-Wiederholung).
  3. Commit; Antwort je Meldung mit Status `accepted` | `duplicate` | `archived` (Projekt/Panel/Zeile gelöscht bzw. archiviert – trotzdem gespeichert und gezählt) | `unassigned` (ohne Zuordnung gespeichert, im Session-Detail zur manuellen Zuordnung) | `rejected_invalid` (Validierungsfehler, nicht speicherbar).
  - **Zugehörigkeit prüfen (DAT-3):** Eine Abfrage prüft je Meldung die ganze Kette `exposure_line → project_panel → project → rig` gegen `tenant_id` **und** `rig_id` des Tokens (ebenso `transit_observation` und alle `projectIds`); jede Abweichung → `rejected_invalid`. Alle `UPDATE`s tragen `tenant_id` in der `WHERE`-Klausel.
  - Gezählt werden nur `result = 'saved'` (nur dann ist `fileName` Pflicht); `is_bonus` erhöht `bonus_count`. `frameType = flat`/`dark_flat` zählt nicht in `exposure_line`, sondern in `flat_combination`:
    - **Schlüssel (verbindlich, NIN5-8/DAT5-21):** Session + Filter-Kurzname + `rotator_mech_deg_dg` (**Zehntelgrad als Ganzzahl**, aus dem gemeldeten `rotatorMechDeg`: `roundHalfAwayFromZero(deg · 10)`) + Gain + Offset + Binning + Auslesemodus-Index. Das Plugin friert den Repräsentanten (Median der geclusterten Winkel) bei der ersten Meldung ein und meldet ihn unverändert (`execution.md` §7); dadurch entsteht nach einem Neustart keine zweite Zeile. Der laufend beobachtete Median steht als reine Beobachtung in `median_deg double precision` und ist **nicht** Teil des Schlüssels.
    - `project_ids` = Vereinigung der gemeldeten Ziele.
    - **Sollzahlen (NIN5-9):** `flats_planned`/`dark_flats_planned` aus der **ersten** Meldung der Kombination (Felder `flatsPlanned`/`darkFlatsPlanned`); fehlen sie, gilt die Rig-Einstellung als Rückfall.
    - **`status` (verbindlich, DAT5-7):** Die Zeile entsteht mit der ersten Meldung und erhält `status = 'running'`. Sie wird auf `'done'` gesetzt, sobald `flats_count ≥ flats_planned` **und** `dark_flats_count ≥ dark_flats_planned`; der Job `session_close` setzt jede noch `running`-Zeile der Session auf `'done'` (wenn beide Sollzahlen 0 sind oder erreicht wurden) bzw. auf `'skipped'` (sonst, mit Hinweis im Nachtbericht). `'pending'` gibt es serverseitig nicht – es ist ein Zustand allein in `flat_combination_local` des Plugins. Kombinationen, die das Plugin überspringt (Filter nicht gefunden), meldet es als Ereignis `filter_not_found`; der Server legt dafür **keine** Zeile an. Jede ID in `projectIds` wird gegen Mandant und Rig geprüft (sonst `rejected_invalid`).
  - Lights mit `transitObservationId` einer geteilten Beobachtung (FA-EXO-33: nur bei gleichen Transit-Zeilen, primär = frühestes `locked_at`) zählen an der primären Beobachtung; die übrigen zeigen deren Aufnahmen an (Verweis `transit_observation.primary_observation_id`). Abweichende Zeilen → keine Teilung (`409 transit.share_mismatch` beim Festlegen).
  - Meldungen werden **immer** ins Ledger übernommen, auch zu gelöschten/archivierten Objekten und nach einem Restore (6.10); nur `rejected_invalid` landet im Dead-Letter des Plugins.
  - Späte Meldungen zu einer Session im Status `stale`, `completed` oder `aborted` sowie zu einer Transit-Beobachtung `missed` sind zulässig (`409 session.closed` erst bei Sessions, die länger als 7 Tage abgeschlossen sind): die Session wird neu ausgewertet, `missed` wird zu `observed`. Das Plugin öffnet eine so abgewiesene Session **nicht** wieder, sondern legt das Paket ins Dead-Letter (NIN5-6, `execution.md` §8).
  - **Sessionende mit nicht leerer Outbox (verbindlich, NIN5-7):** `PATCH /sessions/{id} {status: "completed", endedAtUtc, outboxPending}` wird vom Plugin **sofort** am Nachtende gesendet. Der Server setzt `session.status = completed` und `ended_at`, speichert `outbox_pending` und startet die Jobs `session_close` und `session_report` **erst**, wenn `outbox_pending = 0` gemeldet wurde oder 6 h seit `ended_at` vergangen sind (13). Wiederholte `PATCH`es mit kleinerem `outboxPending` sind idempotent. Die Session gilt ab dem ersten `PATCH` **nicht** mehr als verwaist. Trifft nach dem Nachtbericht noch eine Meldung ein, rechnet der Server Zähler und Bericht nach.
- **Nachträgliche Zuordnung (`PATCH /captures/{id}/assign`, DAT5-12):** setzt `exposure_line_id` (und damit `project_id`/`panel_id`) einer Aufnahme mit `assignment = 'unassigned'`. In **einer** Transaktion: Kette `exposure_line → project_panel → project → rig` gegen `tenant_id` prüfen (sonst `409 capture.assign_mismatch`) · `capture` aktualisieren · `exposure_line.acquired_count` (bzw. `bonus_count`) um 1 erhöhen · `capture_night` für (Zeile, Nacht) **anlegen oder erhöhen** – dies ist der einzige Pfad außer dem Aufnahmen-Upload, der eine `capture_night`-Zeile neu erzeugt; `sources` erhält `'nina'` · Wächter `exposure_line` mit `FOR UPDATE`. Rückgängig machen (`assignment = 'unassigned'` setzen) senkt die Zähler in derselben Weise. Nur `result = 'saved'` zählt.
- **Nachrechnen von `integration_s` (verbindlich, DAT5-11):** `exposure_line.integration_s = accepted_count · exposure_s`. Jeder Zählerpfad schreibt das Delta mit (`± n · exposure_s`); wird `exposure_s` einer Zeile **geändert**, rechnet dieselbe Transaktion `integration_s` vollständig neu (`accepted_count · neu`) und schreibt das Delta in die Projekt- und Nachtsummen. Der Abgleich-Job prüft die Identität und protokolliert Abweichungen.
- **Korrekturen** (`correction`) und einzeln verworfene Aufnahmen (`PATCH /captures/{id}`) aktualisieren `rejected_count` und `capture_night` in derselben Transaktion; das Delta für `integration_s` und `capture_night.integration_s` ist `+ (neu_max − alt_max) · (−exposure_s)` (verworfene Aufnahmen zählen nicht in `accepted_count`); je Zeile und Nacht gilt `verworfen = max(Korrektur, einzeln verworfene Nicht-Bonus)`, eine Korrektur unter der Anzahl einzeln verworfener wird mit `409 correction.conflict` abgelehnt.
- **Abgleich-Job** (→ 13) rechnet Zähler aus `capture`/`correction` nach und protokolliert Abweichungen. Zeilen aus **Import oder Seed** (`capture_night.sources` enthält `import`) haben keine `capture`-Zeilen: sie gelten als Basis und werden nur addiert, nie überschrieben (DAT-18); Abweichungen erscheinen als Hinweis, nicht als Korrektur.
- **Löschen:** Projekte, Panels und Zeilen **mit Aufnahmen** werden nur **weich gelöscht** (`deleted_at`, FA-PRJ-06/07/15); ohne Aufnahmen endgültig. Endgültiges Löschen (Projekt ohne Aufnahmen, Mandant) entfernt abhängige Tabellen in Stapeln ≤ 2.500 Zeilen je Transaktion, von Blatt zu Wurzel. Stammdaten mit Verweisen (Standort, Teleskop, Kamera, Filter, Mondprofil, Vorlage, Rig) sind gegen Löschen gesperrt (`409 resource.in_use` mit Liste der Verwender).

### 6.7 Mandanten-Guard

```ts
// packages/db/src/repositories/base.ts
export class TenantRepo {
  constructor(protected readonly ctx: TenantContext) {}          // { tenantId, memberId, role }
  protected scoped<T extends TenantTable>(table: T) {
    return db.selectFrom(table).where(`${table}.tenant_id` as any, '=', this.ctx.tenantId);
  }
  // insert/update/delete setzen bzw. filtern tenant_id immer selbst
}
```

- Handler erhalten **nur** Repositories, nie `db`.
- ESLint-Regel verbietet `db` außerhalb von `repositories/`.
- Test `tenant-isolation.spec.ts`: legt zwei Mandanten mit identischen Daten an und ruft **jede** Repository-Methode mit Mandant A auf Datensätze von B auf → muss leer/NotFound liefern.

### 6.8 Migrationen

- Dateien `packages/db/migrations/NNNN_beschreibung.sql`, **eine DDL-Anweisung je Datei-Abschnitt** (Trenner `-- statement`), jede in eigener Transaktion.
- Runner (`packages/db/src/migrate.ts`) als Lambda `migrate` im Stack `NinaPm-Migrate`, ausgelöst durch CDK `Trigger` **vor** dem Deployment von `NinaPm-Api`/`NinaPm-Jobs` (Expand zuerst); Tabelle `schema_migration (id, checksum, applied_at)` legt der Runner selbst an. `migrate` läuft **ausschließlich** als `app_migrate` und hat nur `dsql:DbConnect`.
- **Migration 0000 ist ausgelagert (verbindlich, SEC-1):** Sie läuft in der eigenen Lambda **`db-bootstrap`** (Rolle `NinaPmDbBootstrap`, `dsql:DbConnectAdmin`, **kein** CDK-`Trigger`, keine Route) und legt die DB-Rollen `app_rw`, `app_job`, `app_migrate`, die drei `AWS IAM GRANT`s und die Schema-Rechte an – idempotent, beliebig oft wiederholbar. Gestartet wird sie einmalig per `aws lambda invoke` durch `NinaPmOpsInvoker` (H-25). Damit trägt keine automatisch bei jedem Deploy laufende Lambda mehr DB-Adminrechte.
- `migrate` **prüft** beim Start nur, ob die drei Rollen und die drei `AWS IAM GRANT`s existieren, und bricht sonst mit `db.bootstrap_missing` und dem Hinweis auf H-25 ab. Es versucht **nie**, Rollen oder Grants anzulegen – dafür hat es keine Rechte. Jede Tabellen-Migration enthält ihre `GRANT`s für `app_rw` **und** `app_job` (Vorlage am Ende des Schemas); den Umfang je Rolle legt die Tabellengruppe fest (6.2).
- `CREATE INDEX ASYNC` liefert eine Job-ID; der Runner wartet auf Abschluss (Systemfunktion zum Warten auf Index-Jobs laut DSQL-Doku) bzw. bricht mit Hinweis ab.
- **DSQL-Lint** in CI: verbietet `TRIGGER`, `FUNCTION … LANGUAGE plpgsql`, `SERIAL`, `TRUNCATE`, `CREATE INDEX` ohne `ASYNC`, `ON DELETE`/`ON UPDATE`-Aktionen, `TEMP TABLE`, `ALTER COLUMN … TYPE`, `ADD CONSTRAINT` ohne `NOT VALID`, `CREATE TABLE` ohne zugehörige `GRANT`s **für beide Anwendungsrollen** (`app_rw` und `app_job`, SEC-4).
- Seeds: Built-in-Mondprofile je neuem Mandant (Use-Case „Mandant anlegen“), Kataloge per Job/Tool.

### 6.9 Lokale Entwicklung

- Docker Compose mit **PostgreSQL 16** als DSQL-Ersatz (Benutzer `app_rw`/`app_job` mit Passwort statt IAM-Token; `CREATE INDEX ASYNC` wird vom Runner lokal zu `CREATE INDEX` umgeschrieben; `default_transaction_isolation = 'repeatable read'` wie DSQL). Lokal führt der Runner Migration 0000 selbst aus (kein `db-bootstrap`, kein IAM) und überspringt `AWS IAM GRANT`; `ALTER TABLE ASYNC … VALIDATE CONSTRAINT` wird zu `ALTER TABLE … VALIDATE CONSTRAINT`; Rollen werden mit Passwort angelegt (`app_rw`/`app_job`/`app_migrate`).
- DSQL-Abweichungen fängt der kurzlebige CI-DSQL-Cluster ab (`dsql-it.yml`: Migrationen + Repository-Tests, bei jedem PR mit Änderungen in `packages/db`, wöchentlich und vor jedem prod-Deploy mit Migrationen, 17/18).
- `AUTH_TEST_MODE=true` ist nur im lokalen API-Prozess zulässig (17).

### 6.10 Datensicherung

- AWS Backup-Plan für den DSQL-Cluster: täglich, Aufbewahrung 35 Tage. **Kein Point-in-Time-Restore** → RPO 24 h.
- **Nachmelden nach Restore:** Das Plugin behält gesendete Meldungen 14 Tage (lokale SQLite) und bietet „erneut hochladen ab Datum“; der idempotente Ingest (6.6) übernimmt nur Fehlendes.
- **Restore-Runbook** (`docs/runbooks/restore.md`, in AP-17 geprobt): Wiederherstellungspunkt wählen → AWS Backup erzeugt neuen Cluster (**neuer ARN!**) → Cluster mit `purpose=prod` taggen → SSM-Parameter `/nina-pm/dsql-endpoint` umstellen → **`cdk deploy` mit der neuen Cluster-ID als Parameter** (`NinaPm-Data` importiert den Cluster statt ihn zu erzeugen; IAM-Policies und Alarme hängen an der Tag-Bedingung `aws:ResourceTag/purpose = prod`, nicht am ARN; Backup-Plan wählt per Tag) → `migrate` ausführen (prüft Grants und Schema) → Lambdas neu starten → Smoke-Tests → Plugins zum Nachmelden auffordern (Banner) → alten Cluster nach 7 Tagen löschen (DAT-15).
- **Zusätzliches On-Demand-Backup vor jedem Deploy mit neuen Migrationen** (`aws backup start-backup-job` im Workflow `deploy-prod.yml`; der Deploy wartet auf `COMPLETED`).
- **Migrationen nur additiv (Expand/Contract):** neue Spalten/Tabellen nullable oder mit Default; Löschen/Umbenennen frühestens ein Release später, wenn kein laufender Code sie mehr nutzt. So bleibt ein Rollback des Codes auf den vorherigen Tag ohne Schema-Rückbau möglich; Datenfehler werden aus dem Backup in einen neuen Cluster wiederhergestellt.
- Mandanten-Export (FA-ADM-04) als Job: JSON in S3 `exports/` (Download-Link 15 min); Import über presigned Upload nach `imports/` und Job in Stapeln.

---

## 7. API

### 7.1 Konventionen

| Thema | Festlegung |
|---|---|
| Basis | `https://nina-pm.svenesis.org/api` |
| Bereiche | `/api/auth/*`, `/api/web/v1/*` (Browser), `/api/nina/v1/*` (Plugin), `/api/system/v1/*` (Super User); Tabellen unten ohne Präfix `/api` |
| Format | JSON, `camelCase`, Zeiten ISO-8601 UTC, Nacht `YYYY-MM-DD` |
| Validierung | zod-Schemas aus `packages/shared`; OpenAPI 3.1 wird daraus generiert (`@hono/zod-openapi`) und eingecheckt. **Strukturgrenzen für Dateien (verbindlich, SEC-27):** hochgeladene JSON-Dateien (Import, Ergebnisse) werden **streamend** geparst (`stream-json`, nie `JSON.parse` auf den ganzen Puffer), maximale Verschachtelungstiefe **32**, höchstens 200.000 Objekte je Datei und 50.000 je Entitätsart, Zeilenlänge ≤ 64 KiB; Überschreitung → Job `failed` mit Grund `validation.failed` und Verweis auf die Stelle. Vor dem Parsen prüft der Job `GetObjectAttributes` (Größe, Content-Type) und löscht den Schlüssel bei Abweichung |
| Fehler | `application/problem+json` mit `type`, `title`, `status`, `code` (z. B. `approval.not_allowed`), `errors[]` bei Validierung |
| Listen | Cursor-Paginierung `?limit=50&cursor=…`, Filter als Query-Parameter |
| Nebenläufigkeit | `ETag`/`If-Match` (Projekt `version`, Rig `settings_version`); 412 bei Konflikt |
| Idempotenz | Zustandsübergänge (Einreichen, Freigeben, Entscheiden) über `If-Match`-Version – Wiederholung liefert `412` bzw. den bereits erreichten Zustand; Anlagen mit clientseitig erzeugter UUID (Einladung, Aufnahmen, Ereignisse, Sessions) |
| Versionierung | `/v1`; Engine-Kompatibilität über Header `X-NPM-Engine-Version` (Plugin) → 409 `engine.incompatible` bei Major-Abweichung |
| Rate-Limits | API GW global (50 rps) und je Route: `/api/nina/v1` 20 rps, **`/api/auth/*` 5 rps**, **`GET /api/health` 1 rps** (4.2). Zweite Stufe in der Anwendung: für Anmelde-Endpunkte und Einladungs-Vorschau Zählung der letzten Fehlversuche aus `login_audit` **je Discord-ID und je gekürzter IP**; für `/nina/v1` Zählung **je NINA-Instanz** (120 Aufrufe/min, sonst `429 auth.rate_limited` mit `Retry-After: 60`, Metrik `NinaThrottled`; SEC-18/SEC-24, `specs/infra/iam.md` §9) |
| Größen | Anfrage ≤ 1 MB (**eigene Vorgabe**, nicht die technische Grenze der HTTP API); größere Daten (Planprotokoll, Import, Ergebnisdateien) nur per **presigned POST** mit `content-length-range` (12, SEC-23); Laufzeit > ~5 s nur als Job (`202 {jobId}`, `GET /web/v1/jobs/{id}`) |

### 7.2 Endpunkte Web (Auszug, vollständig in OpenAPI)

| Bereich | Endpunkte | Aktion(en) |
|---|---|---|
| Auth | `POST /auth/invitation/claim {token}` (legt das Einladungs-Cookie an, DAT5-15; Antwort nur `{tenantName, role}`; Drosselung 10/min je IP), `GET /auth/discord/start`, `GET /auth/discord/callback`, `POST /auth/refresh` (Karenz 5.3), `POST /auth/context`, `POST /auth/logout`, `GET /auth/me`, `GET/DELETE /auth/sessions[/{id}]` | `public` bzw. angemeldet |
| Health | `GET /api/health` (Status, `ENGINE_VERSION`; **der DB-Ping läuft nur**, wenn der Aufruf den Header `X-NPM-Deep` mit einem der beiden Origin-Verify-Werte trägt – sonst antwortet die Route wie `shallow`. Sonst wäre eine unauthentifizierte Route die billigste Verstärkung in die Datenbank hinein, SEC-17; Drosselung 1 rps), `GET /api/health/shallow` (ohne DB, für den Route-53-Health-Check über CloudFront; eigene Route ohne Authentifizierung, 200 rps) | `public` |
| Einladungs-Vorschau | `POST /auth/invitations/preview {token}` (Token im Body, nicht im Pfad – Pfade landen in Zugriffslogs, DAT-20) | – (öffentlich, rate-limitiert) |
| Einladungen | `POST /web/v1/invitations {id, role: user|admin, roleDurationHours?, …}`, `GET /web/v1/invitations`, `DELETE /web/v1/invitations/{id}` | `member.manage` (Rolle user); `member.admin.manage` (Rolle admin, Einladungen des Owners) |
| Mitglieder | `GET /web/v1/members`, `PATCH /web/v1/members/{id} {displayName, status}`, `DELETE /web/v1/members/{id}` (Folgen je Freigabestatus: FA-BEN-11), `POST /web/v1/members/{id}/reassign-objects {toMemberId}` (Objekte eines entfernten Mitglieds übertragen, FA-BEN-11), `DELETE /web/v1/members/{id}/sessions` (nie für den Owner) | `member.manage` (Ziel User) bzw. `member.admin.manage` (Ziel Admin) |
| Rollen & Owner | `PUT /web/v1/members/{id}/role {role, expiresAt?, reason}` (hochstufen, befristen, verlängern, entziehen); `POST /web/v1/me/leave`; `POST /web/v1/tenant/owner-transfer {memberId, confirmTenantKey}`, `POST /web/v1/tenant/owner-transfer/accept`, `DELETE /web/v1/tenant/owner-transfer` | `member.admin.manage`, `member.leave`, `tenant.owner.transfer` |
| Mandant | `GET/PATCH /web/v1/tenant/settings` (ohne Sicherheitsfelder; erlaubte Schlüssel **ausschließlich** aus `contracts/enums.json` `tenantSettingsKeys`, unbekannte Schlüssel → `422 validation.failed`, DAT5-22), `GET /web/v1/audit/logins`, `GET /web/v1/audit/changes` | `tenant.settings` |
| Discord (ausgehend) | `GET/PUT /web/v1/tenant/discord {guildName, guildId?, inviteUrl?}`; `GET/POST /web/v1/tenant/discord/channels {name, webhookUrl, categories[], eventFilter}`, `PATCH/DELETE /web/v1/tenant/discord/channels/{id}` (Webhook-URL nur schreibbar: Prüfung gegen `^https://(discord\.com|discordapp\.com)/api/webhooks/\d+/[\w-]+$`, Ablage als SSM-SecureString, Antwort nur `webhookHint`), `POST /web/v1/tenant/discord/channels/{id}/test` | `tenant.settings` |
| Sicherheit | `GET/PUT /web/v1/tenant/security {mfaRequiredForAdmins, sessionIdleHours, sessionMaxDays}` (2FA-Pflicht nur aktivierbar, wenn der Owner 2FA hat) | `tenant.security` (nur Owner) |
| Ausrüstung | CRUD `/web/v1/sites`, `/site-links`, `/telescopes`, `/cameras`, `/filters`, `/moon-profiles`, `/exposure-templates`, `/rigs` (Löschen gesperrt bei Verwendung → `409 resource.in_use`); `PUT /rigs/{id}/scheduler-settings`; `POST /rigs/{id}/compatibility {projectId}` bzw. Prüfung beim Rig-Wechsel (FA-RIG-12; mit Aufnahmen und geänderter Optik → Warnung `rig.change_has_captures` + Angebot *Duplizieren*) | `equipment.*`, `rig.settings.write` |
| NINA-Instanzen | `GET /web/v1/nina-instances`, `POST /web/v1/nina-instances {rigId, name}` → einmalige Token-Anzeige (AP-14a), `POST /web/v1/nina-instances/{id}/revoke`, `GET /{id}/diagnostics`, `POST /web/v1/rigs/{id}/lease/release` (Session übernehmen, FA-RIG-06), `POST /web/v1/rigs/{id}/commands {command}` (Kommando an das Plugin, Werte aus `ninaCommands`; Antwort mit `commandId`, Zustellung über die Heartbeat-Antwort, 7.6), `GET /web/v1/rigs/{id}/delivery` (An NINA ausgeliefert) | `nina.instance.manage`; Liste/Status lesend `nina.instance.read`; Auslieferung `project.read`; Quittieren Auslesemodus-Abgleich `POST /web/v1/cameras/{id}/nina-report/dismiss` (`equipment.write`) |
| Kataloge | `GET /web/v1/catalog/dso?q=&type=&const=&fitsRig=`, `GET /web/v1/catalog/suggestions?rig=&night=`, `GET /web/v1/exoplanets/transits?rig=&night=&…` | `project.read` |
| Projekte | CRUD `/web/v1/projects`, `/projects/{id}/panels`, `/projects/{id}/lines`, `POST /projects/{id}/apply-template`, `POST /projects/{id}/duplicate`; Löschen von Panels/Zeilen mit Aufnahmen = Archivieren | `project.create`/`project.update`/`project.delete` |
| Projektstatus & Priorität | `PUT /projects/{id}/priority` (Liste je Rig), `PUT /projects/{id}/status` (Übergänge nach `enums.json` `projectStatusTransitions`; Aktivieren prüft Vollständigkeit) | `project.status` (nur Admin) |
| Warteschlange (alle) | `GET /web/v1/queue` (Einträge mit `votes {count, voters[{memberId, displayName, changedSinceVote}], mine, mineChangedSince}`, `submitterRank {rank, of}`, `effort {tag, nights, earliestCompletion, achievablePct, limitingFactor}`, `planSummary [{filterShortName, color, count, exposureS, gain, offset, binning, readoutMode, moonProfile}]` je aktiver Zeile (bei Mosaik `panelCount`, bei Exoplaneten Fenster), `estimatedHours`, Frist, `suggestedPriorityPosition` nur für Admins); `PUT/DELETE /web/v1/queue/{kind}/{id}/vote` (`kind` = `project`/`change-request`; 409 `vote.own_object`, 409 `vote.closed`); `POST /web/v1/queue/{kind}/{id}/vote/acknowledge` (Hinweis „geändert seit deiner Stimme“ quittieren; erfolgt auch beim Öffnen des Objekts); `PUT /web/v1/me/submission-ranking {items:[{kind,id}]}` (vollständige Liste der eigenen offenen Gegenstände, sonst 422) | `queue.read`, `queue.vote`, `project.rank` |
| Freigabe | `POST /projects/{id}/submit`, `/withdraw`, `/approve {rigId, priorityPosition, status, startDate?, dueDate?, comment}` (Rig-Wechsel mit Konfliktliste, FA-RIG-12; gewünschte Transit-Beobachtung `requested` → `locked`), `/return`, `/reject` | `project.submit`, `queue.decide` (nicht für eigene Objekte, FA-FRG-10) |
| Entwürfe & Transit-Bestätigungen | `GET /web/v1/drafts`; `GET /web/v1/transit-observations?status=requested` (offene Bestätigungen, FA-EXO-18); `POST /transit-observations/{id}/confirm` (→ `locked`, `locked_at`), `/decline` (→ `cancelled`) | `queue.decide` |
| Änderungsanträge | `POST/GET /projects/{id}/change-requests`, `PATCH /change-requests/{id}` (Antragsteller solange offen, Admin), `POST /change-requests/{id}/withdraw`, `POST /change-requests/{id}/decide {decision, comment}` (Konflikt, wenn `project.version` ≠ `base_version`: Diff gegen aktuelle Fassung) | `changeRequest.create`, `changeRequest.update`, `queue.decide` |
| Exoplaneten | `POST /projects/{id}/exo/lock {night, epoch}` (vor Freigabe → Status `requested`; nach Freigabe durch Admin → `locked`, durch Ersteller → `requested` bis Bestätigung, wenn `exoUserLockNeedsAdmin` (Standard), höchstens `exoUserMaxOpenLocks` offen, sonst `409 transit.too_many_open`; FA-EXO-18), `DELETE /projects/{id}/exo/lock` (→ `cancelled`), `GET /web/v1/exoplanets/my-observations`, `GET /transit-observations/{id}/captures.csv`, `GET /projects/{id}/exo/upcoming`, `POST /projects/{id}/ephemeris/refresh`, `GET /transit-observations/{id}`, `POST /transit-observations/{id}/results` (nach S3-Upload) | `transit.lock`, `project.update`, `transit.result.import` |
| Simulation | Einzelnacht im Browser (auch mit eigenen Entwürfen des Users, nur lokal); `POST /web/v1/simulations {rigId, night, plan}` speichert einen Plan als `night_plan(origin='web_simulation')`; `POST /web/v1/simulations/multi` → `202 {jobId}` | `simulation.run` |
| Jobs | `GET /web/v1/jobs/{id}` (Status, Fortschritt, Download-Link des Ergebnisses) | `job.read` (Ersteller bzw. Admin) |
| Sessions | `GET /web/v1/sessions?rig=&from=&to=&unreviewed=`, `GET /sessions/{id}` (inkl. Soll/Ist), `GET /sessions/{id}/captures`, `GET /sessions/{id}/events` (Abweichungsgründe, FA-AUS-04), `GET /sessions/{id}/plans` (Planrevisionen der Nacht), `PATCH /captures/{id} {rejected, reason}`, `POST /web/v1/corrections` (Regel max, 6.6), `PUT /sessions/{id}/log`, `POST /sessions/{id}/report/resend` (`session.report.resend`, FA-AUS-21), `GET /sessions/{id}/calibration` (Flats/Dark-Flats je Kombination), `PATCH /captures/{id}/assign {projectId, panelId, exposureLineId}` (nicht zugeordnete Aufnahmen), `POST /sessions/{id}/review` | `session.*`, `sessionlog.write` |
| Verlauf | `GET /web/v1/projects/{id}/history` (Freigabe- und Änderungsverlauf, FA-FRG-12, FA-BER-03), `GET /web/v1/projects/{id}/captures?format=json|csv` (Aufnahmeliste je Projekt, FA-AUS-12), `GET /web/v1/projects/{id}/export` (FA-PRJ-09) | `project.history.read`, `session.read`, `project.read` |
| Notizen | `POST /web/v1/projects/{id}/notes` | `project.note.write` (User: eigene Objekte in jedem Status) |
| Warteschlange | `POST /web/v1/queue/{projectId}/impact` → `202 {jobId}` (Auswirkungsvorschau, FA-FRG-05) | `queue.decide` |
| Mandanten-Export/-Import | `POST /web/v1/tenant/export` → `202 {jobId}`; Import: `POST /web/v1/files/upload-url {purpose:'tenant_import'}` → `POST /web/v1/tenant/import {key}` → `202 {jobId}` | `tenant.export`, `tenant.import` |
| Super-User-Aktionen im Mandanten | `GET /web/v1/audit/system` (FA-SU-09) | `tenant.settings` |
| System (Super User) | `GET/POST/PATCH/DELETE /system/v1/tenants`, `POST /system/v1/tenants/{id}/invitations` (Rolle owner), `PUT /system/v1/tenants/{id}/owner {memberId | invite, reason}` (`system.tenant.owner`, Notfall-Neuzuweisung, benachrichtigt alle Admins), `GET/POST/PATCH /system/v1/super-users`, `GET /system/v1/tenants/{id}/members` (nur Anzeigename, Rolle, Status – für die Owner-Neuzuweisung), `PATCH /system/v1/identities/{id} {status}` (systemweit sperren, FA-LOG-05), `GET /system/v1/audit`, `POST /system/v1/catalogs/{name}/refresh`, `GET/PUT /system/v1/settings/{key}` (u. a. Wartungsbanner in `system_setting`) | `system.manage` |
| Auswertung | `GET /web/v1/tonight?rig=` (Startseite „Heute Nacht“, FA-FOL-06), `GET /web/v1/forecast?rig=` (Restbedarf, Prognose, Kandidatennächte), `GET /web/v1/reports/logbook?from=&to=&site=` (Protokoll-Auswertungen, FA-AUS-16), `GET /web/v1/reports/projects?from=&to=&status=&rig=&type=` (JSON/CSV; PDF über Druckansicht im Browser), `GET /web/v1/stats/clear-nights?site=`, `POST /web/v1/sites/{id}/nights/{night}/unused` (`session.review`) | `project.read`, `session.read`, `session.review` |
| Wetter | `GET /web/v1/weather?site=` | `project.read` |
| Dateien | `POST /web/v1/files/upload-url {purpose, contentType, size}`, `GET /web/v1/files/{key}/download-url` | je Zweck |
| Benachrichtigungen | `GET /web/v1/notifications`, `POST /notifications/read` (R1); `kind` aus `contracts/enums.json` `notificationKinds`. **Systembenachrichtigungen** (Empfänger `notification.recipient_identity_id`, Super User ohne Mitgliedschaft; Arten `owner.reassigned`, `role.*`, `alert.*`, DAT5-13): `GET /system/v1/notifications`, `POST /system/v1/notifications/read` – dieselben Felder, aber über den System-Kontext und ohne `tenant_id`-Filter | `notification.read` bzw. `system.manage` |
| Einstellungen | `GET/PUT /web/v1/me/preferences/{key}`, `PUT/DELETE /web/v1/me/favorites/{projectId}` | `me.preferences`, `me.favorites` |

### 7.3 Endpunkte NINA (`/nina/v1`)

| Methode + Pfad | Zweck | Anforderung |
|---|---|---|
| `GET /bootstrap` | Rig, Standort, Kamera (Gain-/Auslesemodi), Filter-Kurznamen, Scheduler-Settings + `settingsVersion`, Mondprofile, minimale Engine-Version, **Zeitzonen-Übergänge und Nacht-Schlüssel der nächsten 60 Nächte** (für Offline-Planung, OT-11); schreibt `nina_instance.settings_version_fetched/settings_fetched_at` (Übernahmestatus S-40/S-10) | FA-SYN-02, FA-SIM-09 |
| `GET /targets` | auslieferbare Projekte des Rigs (`isDeliverable`, 6.3) inkl. Panels, Zeilen, Zählern, Bedingungen, Exoplaneten-Ephemeride + festgelegtes Ereignis mit Beobachtungs-ID; `ETag` (Abruf vor jedem Block, meist `304`) | FA-SYN-02/03 |
| `POST /plan {night, reason, sessionId?, startAtUtc?, pendingCaptures[], targetsEtag, tonight?}` | **Server plant** mit der Node-Engine (gleiche Eingaben wie der Simulator) und liefert `NightPlan` (`nightPlanId`, `revision`, Blöcke mit UUID, Zeitmarken `darknessEndUtc`/`flatsNotBeforeUtc`/`sessionEndUtc`, 7.6) + `inputHash`; `pendingCaptures` = lokal gezählte, noch nicht bestätigte Lights; `tonight` = Laufzeitzustand der Nacht für faire Neuplanung (`allocation.md` §5.3); neue Revision je Session; speichert `night_plan(origin='server_plan')` | FA-SIM-05, FA-SYN-03 |
| `POST /sessions` | Session anlegen (`id` vom Plugin) mit Rig-Lease (5.6, `409 session.rig_busy`; `offline: true` ohne Lease), Verweis auf den Plan (`nightPlanId` bzw. offline Blöcke + Input-Hash); Antwort enthält presigned **POST** (mit `content-length-range`) für das Planprotokoll (`plans/<id>.json.gz`) | FA-SYN-06, FA-RIG-06 |
| `PATCH /sessions/{id}` | Status/Ende inkl. `outboxPending` (Anzahl noch nicht gesendeter Meldungen dieser Session), `ninaConditions` (Mittel/Min/Max aus NINA-Geräten, FA-AUS-15 b), neuer Plan nach *Zurücksetzen*; Ende gibt die Lease frei und legt Jobs an (KPIs, Nachtbericht, Aufwand) | FA-NIN-13/14, FA-AUS-15/21 |
| `POST /sessions/{id}/captures` | Batch ≤ 500 Aufnahmemeldungen (**Lights, Flats, Dark-Flats**, Feld `frameType`), idempotent; Status je Meldung (6.6); Exoplaneten mit `transitObservationId`; Flats/Dark-Flats aktualisieren `flat_combination` | FA-SYN-04/05, FA-EXO-20, FA-NIN-17 |
| `POST /sessions/{id}/events` | Batch Ereignisse, idempotent | FA-SYN-06 |
| `POST /heartbeat` | Zustand aus `heartbeatStates` (`running`, `idle`, `paused`, `flats`, `offline` + `offlineUntil`, `blocked` + `blockedReason`), Plugin-/Engine-Version, Profil-Standort, gemeldete Kamera-Auslesemodi, Meridian-Flip-Einstellungen aus dem NINA-Profil und ob der Trigger in der Sequenz vorhanden ist, zuletzt gemessener Positionswinkel, Dead-Letter-Anzahl, `ackedCommandIds[]`; verlängert die Lease in `rig_lease` und setzt `session.last_heartbeat_at`; Antwort mit `lease {untilUtc, leaseLost}`, `settingsVersion`, `targetsEtag`, `serverTimeUtc` (Uhrabgleich) und `commands[]` (7.6) | FA-SYN-07, FA-KAM-07, FA-NIN-04, FA-NIN-24, FA-RIG-06/11 |
| `GET /commands` / `POST /commands/{id}/ack` | reserviert (`refresh_targets`, `reset_plan`) | – |

### 7.4 Lang laufende Berechnungen

Alles, was länger als ~5 s dauern kann oder große Daten erzeugt, läuft als **Job**:

1. `api` legt eine Zeile in `job` an (`kind`, kleine `input`-Parameter, optional `dedupe_key`, z. B. `effort:<projectId>`) und ruft `worker` **asynchron nur mit `{jobId}`** auf (`InvocationType: Event`, Wiederholungen 0); Antwort `202 {jobId}`. **Deduplizierung (verbindlich, DAT5-1):** `job.id` bleibt zufällig (`gen_random_uuid()`). Ein zweiter Auslöser wird über die Spalte **`dedupe_active`** verhindert: sie trägt den `dedupe_key`, solange `status IN ('pending','running')`, und wird beim Übergang auf `done`/`failed` auf `NULL` gesetzt; darauf liegt `UNIQUE INDEX ux_job_dedupe_active`. Anlegen mit `INSERT … ON CONFLICT (dedupe_active) DO NOTHING` – ist ein Job mit demselben Schlüssel offen, entsteht kein zweiter; ist keiner offen, läuft der nächste normal an. Damit funktionieren wiederkehrende Schlüssel wie `effort:<projectId>` (täglich) und `discord_post` dauerhaft. `dedupe_key` bleibt zur Diagnose stehen. Die Zustellung je Discord-Kanal ist zusätzlich über `UNIQUE (channel_id, event_key, object_id)` in `discord_delivery` eindeutig (DAT-11).
2. `worker` setzt `running`, führt aus, schreibt große Ergebnisse nach S3 `tenant/<tid>/jobs/<jobId>.json` und setzt `done`/`failed`.
3. Frontend pollt `GET /web/v1/jobs/{id}` (Status, Fortschritt, Download-Link).
4. Der Zeitplan `tick-5min` übernimmt liegengebliebene Jobs (`pending` älter als 2 min oder `running` älter als 20 min; höchstens 3 Versuche, `discord_post` 5) – damit kein Job verloren geht, wenn der asynchrone Aufruf scheitert.

| `job.kind` | Auslöser | Ergebnis |
|---|---|---|
| `multi_sim`, `impact` | Simulator, Warteschlange | Mehrnacht-Simulation, Auswirkungsvorschau (FA-SIM-04, FA-FRG-05) |
| `effort` | Speichern/Einreichen/Freigeben, Sessionende, täglich (dedupliziert je Projekt) | `project.effort_*` (FA-PRJ-23) |
| `session_close` | Sessionende **mit `outbox_pending = 0`** bzw. 6 h nach `ended_at` bzw. `tick-5min` für verwaiste Sessions (6.6, NIN5-7) | KPIs, `site_night_stat`, Transit-Abdeckung, `flat_combination.status` |
| `session_report` | Sessionende (wenn Rig-Schalter aktiv) | Nachtbericht als Discord-Meldung(en) je Kanal mit Kategorie `sessions` (FA-AUS-21) |
| `discord_post` | jedes Ereignis einer Kategorie (7.7) und der Nachtbericht aus `session_report` | Zustellung einer Meldung in einen Kanal; `dedupe_key = <channelId>:<eventKey>:<objektId>` |
| `catalog_refresh` | `POST /system/v1/catalogs/{name}/refresh`, `daily`/`weekly` | Objekt- bzw. Exoplaneten-Katalog importieren (Stapel) |
| `forecast`, `reconcile`, `weather` | Zeitpläne (13) | Prognose, Zähler-Abgleich, Wetter – als Jobs, damit Fehler und Laufzeiten einheitlich sichtbar sind |
| `export`, `import` | Admin | Mandanten-Export/-Import (FA-ADM-04) |
| `thumbnail` | neues/verschobenes Projekt | Vorschaubild `catalog/thumbs/…` |
| `transit_result_parse` | Ergebnis-Upload | HOPS/EXOTIC-Werte (FA-EXO-35) |

Einzelnacht-Simulationen und das Live-Aufwand-Kennzeichen im Editor laufen **im Browser** (Web Worker) mit derselben Engine.

### 7.5 Verträge

**Vertragsquelle sind die zod-Schemas** in `packages/shared/src/contracts/`; OpenAPI (`docs/api/openapi.yaml`) und JSON-Schemas werden daraus generiert, der Plugin-Client (NSwag) liest `openapi.yaml`. `packages/shared/contracts/` enthält die generierten JSON-Schemas mit je mindestens einem Beispiel für `PlanInput`, `NightPlan`, `EffortInput`/`EffortEstimate`, `CaptureBatch` (inkl. Statuswerte), `SessionPatch`, `Heartbeat`, Mandanten-Export. Sie entstehen in AP-05, AP-13b/c/d und AP-14a **vor** der Implementierung, dienen als Testdaten für API, Engine, Fake-Plugin und Plugin und legen Rundungsregeln und Einheiten fest (Zeiten als ganze Sekunden UTC, Winkel in Grad mit 6 Nachkommastellen).

### 7.6 NINA-API: Datenstrukturen

Alle Aufrufe mit `Authorization: Bearer npm_…` (Sync-Token, an genau ein Rig gebunden) und `X-NPM-Plugin-Version`, `X-NPM-Engine-Version`. Zeiten UTC ISO-8601 mit `Z`, Winkel in Grad, IDs UUID (vom Plugin erzeugte als UUID v7). Die Beispiele sind gekürzt und **nur zur Veranschaulichung** (Uhrzeiten/Koordinaten nicht als Test-Orakel verwenden); verbindlich sind die JSON-Schemas in `packages/shared/contracts/nina/` (7.5).

**Koppeln (Ablauf):** Admin legt in S-42 eine NINA-Instanz an und wählt das Rig → Server erzeugt das Token, zeigt es einmal an und speichert nur den Hash → im Plugin Server-URL und Token eintragen → *Verbindung testen* ruft `GET /bootstrap` auf und zeigt Mandant, Rig und Standort-Abgleich (FA-NIN-01/03). Widerrufen des Tokens beendet den Zugriff sofort (`401`).

#### `GET /nina/v1/bootstrap` – Rig und Einstellungen

```json
{
  "apiVersion": "1",
  "server": {
    "timeUtc": "2026-09-17T18:02:11Z",
    "engineVersion": "3.2.0",
    "minPluginVersion": "1.0.0"
  },
  "instance": {
    "id": "7b1e…",
    "name": "Starfront-PC"
  },
  "tenant": {
    "key": "sternwarte-xy",
    "name": "Sternwarte XY",
    "timeZone": "Europe/Berlin"
  },
  "rig": {
    "id": "c0a4…",
    "name": "Starfront – GT81 – Ares-M",
    "settingsVersion": 12,
    "site": {
      "name": "Starfront",
      "latDeg": 31.5471,
      "lonDeg": -99.3823,
      "elevationM": 450,
      "timeZone": "America/Chicago"
    },
    "telescope": {
      "name": "GT81",
      "apertureMm": 81,
      "focalLengthMm": 382,
      "reducerFactor": 1.0
    },
    "camera": {
      "name": "Ares-M Pro",
      "pixelSizeUm": 3.76,
      "widthPx": 6248,
      "heightPx": 4176,
      "defaultGain": 100,
      "defaultOffset": 20,
      "readoutModes": [
        {
          "index": 0,
          "name": "High Gain Mode"
        },
        {
          "index": 1,
          "name": "Low Noise Mode"
        }
      ],
      "binning": [
        1,
        2
      ]
    },
    "rotator": {
      "present": true,
      "defaultRotationDeg": 90,
      "toleranceDeg": 5,
      "skipOnMismatch": false
    },
    "filters": [
      {
        "shortName": "L",
        "name": "Luminance",
        "color": "#c8c8c8"
      },
      {
        "shortName": "Ha",
        "name": "H-alpha 3 nm",
        "color": "#d0342c"
      },
      {
        "shortName": "R",
        "name": "Red",
        "color": "#e53935"
      }
    ],
    "scheduler": {
      "strategy": "proportional",
      "playback": "time_aware",
      "sortChain": [
        "lowest_peak_altitude",
        "setting_soonest",
        "most_remaining",
        "constrained"
      ],
      "bonus": {
        "enabled": false
      },
      "mosaicPanelsIndependent": true,
      "dither": {
        "enabled": true,
        "every": 1
      },
      "filterSwitch": {
        "enabled": true,
        "every": 40,
        "tolerancePct": 50
      },
      "flats": {
        "enabled": true,
        "fullSet": false,
        "count": 20,
        "darkFlats": {
          "enabled": true,
          "count": null
        }
      },
      "meridianFlip": {
        "enabled": true,
        "afterMin": 5,
        "maxAfterMin": 15,
        "pauseBeforeMin": 0,
        "durationS": 240
      },
      "overhead": {
        "slewCenterS": 90,
        "filterChangeS": 10,
        "ditherSettleS": 15,
        "afEveryMin": 60,
        "afDurationS": 120,
        "downloadS": 3
      },
      "overshootPct": 0
    },
    "leaseMinutes": 3
  },
  "moonProfiles": [
    {
      "id": "5d2e…",
      "name": "Streng",
      "separationDeg": 90,
      "widthDays": 8,
      "relax": 0,
      "minAltDeg": -15,
      "maxAltDeg": 5,
      "maxIlluminationPct": 30,
      "moonMustBeDown": false
    }
  ],
  "nights": [
    {
      "night": "2026-09-17",
      "startUtc": "2026-09-17T17:00:00Z",
      "endUtc": "2026-09-18T17:00:00Z"
    }
  ],
  "timeZoneTransitions": [
    {
      "atUtc": "2026-11-01T07:00:00Z",
      "offsetMin": -360
    }
  ]
}
```

Die zod-Schemas trennen die Projekttypen als **Discriminated Union** über `type` (`deep_sky` | `exoplanet`): nur so bleiben Pflichtfelder je Typ (Zeilen mit `order`/`enabled`/`counts` bei Deep-Sky, `transit` bei Exoplaneten) wirklich Pflicht (NIN-20). `readoutModes` sind Objekte `{index, name}`; Zeilen und Einträge tragen Name **und** Index (Plugin löst den Namen gegen die Kameraliste auf, `execution.md` §4.3). `scheduler.flats.darkFlats.count = null` bedeutet „wie Flats“. `leaseMinutes` = 3 (5.6).

#### `GET /nina/v1/targets` – was aufgenommen werden soll

Enthält **keine Uhrzeiten** der Nacht (die liefert der Plan), sondern Ziele, Pläne, Zähler (inkl. `planningNeed`) und Bedingungen. Antwort mit `ETag`; bei `If-None-Match` meist `304`.

```json
{
  "rigId": "c0a4…",
  "generatedAtUtc": "2026-09-17T18:02:12Z",
  "projects": [
    {
      "id": "a91f…",
      "version": 7,
      "type": "deep_sky",
      "name": "NGC 281 Pacman",
      "target": {
        "name": "NGC 281",
        "objectType": "emission_nebula",
        "catalogNames": "Sh2-184"
      },
      "status": "active",
      "priority": 1,
      "startDate": "2026-09-01",
      "dueDate": null,
      "conditions": {
        "minAltitudeDeg": 30,
        "minTimeOnTargetH": 1.0,
        "twilight": "astronomical",
        "moonDefault": {
          "enabled": false
        }
      },
      "mosaic": {
        "rows": 1,
        "columns": 1,
        "overlapPct": 20
      },
      "panels": [
        {
          "id": "p001…",
          "index": 0,
          "label": "Main",
          "raDeg": 13.2046,
          "decDeg": 56.6297,
          "rotationDeg": 90.0,
          "lines": [
            {
              "id": "l001…",
              "order": 0,
              "enabled": true,
              "filter": "Ha",
              "exposureS": 300,
              "gain": 100,
              "offset": 20,
              "binning": 1,
              "readoutMode": "High Gain Mode",
              "moon": {
                "mode": "profile",
                "profileId": "5d2e…"
              },
              "counts": {
                "planned": 40,
                "acquired": 22,
                "rejected": 2,
                "accepted": 20,
                "remaining": 20,
                "planningNeed": 20,
                "bonus": 0,
                "bonusRejected": 0
              },
              "readoutModeIndex": 0
            }
          ]
        }
      ],
      "exoplanet": null
    },
    {
      "id": "e77c…",
      "version": 3,
      "type": "exoplanet",
      "name": "HAT-P-17 b",
      "target": {
        "name": "HAT-P-17",
        "objectType": "exoplanet"
      },
      "status": "active",
      "priority": 2,
      "conditions": {
        "minAltitudeDeg": 30,
        "minTimeOnTargetH": 0,
        "twilight": "nautical"
      },
      "panels": [
        {
          "id": "p9…",
          "index": 0,
          "label": "Main",
          "raDeg": 324.5366,
          "decDeg": 30.4886,
          "rotationDeg": 0,
          "lines": [
            {
              "id": "l9…",
              "filter": "R",
              "exposureS": 60,
              "gain": 100,
              "offset": 20,
              "binning": 1,
              "readoutMode": "High Gain Mode",
              "moon": {
                "mode": "none"
              },
              "readoutModeIndex": 0
            }
          ]
        }
      ],
      "exoplanet": {
        "planet": "HAT-P-17 b",
        "ephemeris": {
          "t0BjdTdb": 2454801.16945,
          "t0SigmaD": 0.0002,
          "periodD": 10.338523,
          "periodSigmaD": 9e-07,
          "durationH": 3.3
        },
        "observation": {
          "id": "o5…",
          "status": "locked",
          "epoch": 812,
          "night": "2026-09-17",
          "ingressUtc": "2026-09-18T03:12:00Z",
          "midUtc": "2026-09-18T04:51:00Z",
          "egressUtc": "2026-09-18T06:30:00Z",
          "windowStartUtc": "2026-09-18T02:08:00Z",
          "windowEndUtc": "2026-09-18T07:34:00Z",
          "allowAutofocus": false,
          "allowRecenter": true,
          "counts": {
            "planned": 312,
            "acquired": 0,
            "rejected": 0
          }
        }
      }
    }
  ],
  "mosaicPanelsIndependent": true
}
```

#### `POST /nina/v1/plan` – Nachtplan vom Server

Anfrage (hier eine Neuplanung vor einem Block):

```json
{
  "night": "2026-09-17",
  "reason": "refresh",
  "startAtUtc": "2026-09-18T07:34:00Z",
  "pendingCaptures": [
    {
      "exposureLineId": "l001…",
      "transitObservationId": null,
      "count": 3
    }
  ],
  "targetsEtag": "\"t-8f3a\"",
  "sessionId": "0192a7c0-0000-7000-8000-000000000a01",
  "tonight": {
    "pastBlocks": [
      {
        "unitId": "e77c…/p0",
        "fromUtc": "2026-09-18T02:05:30Z",
        "toUtc": "2026-09-18T07:34:00Z"
      }
    ],
    "exposedSecByUnit": {
      "e77c…/p0": 18600
    },
    "lastAutofocusUtc": null,
    "filterCycle": [
      {
        "unitId": "e77c…/p0",
        "lineId": "l9…",
        "subsOnLine": 310
      }
    ],
    "flipDoneByPanel": {
      "e77c…/p0": true
    },
    "currentUnitId": "e77c…/p0"
  }
}
```

`reason` = `initial` | `refresh` | `resume` | `reset`; `pendingCaptures` = lokal gezählte, noch nicht bestätigte Lights; `tonight` nur bei Neuplanung (Laufzeitzustand, `allocation.md` §5.3; ohne `tonight` rechnet der Server den Zustand aus den gemeldeten Aufnahmen und Ereignissen der Session).

Antwort (`NightPlan`):

```json
{
  "nightPlanId": "0192a7c0-0000-7000-8000-000000000b01",
  "engineVersion": "3.2.0",
  "inputHash": "sha256:9c1e…",
  "night": "2026-09-17",
  "revision": 1,
  "startAtUtc": "2026-09-18T02:01:58Z",
  "nightWindow": {
    "startUtc": "2026-09-18T00:05:00Z",
    "endUtc": "2026-09-18T12:59:00Z"
  },
  "darkness": {
    "astronomicalStartUtc": "2026-09-18T02:01:58Z",
    "astronomicalEndUtc": "2026-09-18T11:01:56Z"
  },
  "darknessEndUtc": "2026-09-18T11:01:56Z",
  "flatsNotBeforeUtc": "2026-09-18T11:01:56Z",
  "sessionEndUtc": "2026-09-18T12:59:00Z",
  "blocks": [
    {
      "id": "0192a7c0-0000-7000-8000-000000000c01",
      "kind": "transit",
      "projectId": "e77c…",
      "panelId": "p9…",
      "transitObservationId": "o5…",
      "startUtc": "2026-09-18T02:08:00Z",
      "endUtc": "2026-09-18T07:34:00Z",
      "raDeg": 324.5366,
      "decDeg": 30.4886,
      "rotationDeg": 0.0,
      "rotationMode": "rotator",
      "meridianFlip": {
        "waitStartUtc": null,
        "plannedUtc": "2026-09-18T04:32:13Z",
        "durationS": 240,
        "inTransitWindow": true,
        "planned": false
      },
      "entries": [
        {
          "seq": 1,
          "cmd": "slew_center_rotate",
          "atUtc": "2026-09-18T02:05:30Z",
          "durationS": 90
        },
        {
          "seq": 2,
          "cmd": "expose_series",
          "atUtc": "2026-09-18T02:08:00Z",
          "untilUtc": "2026-09-18T07:34:00Z",
          "exposureLineId": "l9…",
          "filter": "R",
          "exposureS": 60,
          "gain": 100,
          "offset": 20,
          "binning": 1,
          "readoutMode": "High Gain Mode",
          "readoutModeIndex": 0
        },
        {
          "seq": 3,
          "cmd": "end",
          "atUtc": "2026-09-18T07:34:00Z"
        }
      ]
    },
    {
      "id": "0192a7c0-0000-7000-8000-000000000c02",
      "kind": "regular",
      "projectId": "a91f…",
      "panelId": "p001…",
      "startUtc": "2026-09-18T07:34:00Z",
      "endUtc": "2026-09-18T09:18:40Z",
      "raDeg": 13.2046,
      "decDeg": 56.6297,
      "rotationDeg": 90.0,
      "rotationMode": "rotator",
      "meridianFlip": {
        "waitStartUtc": "2026-09-18T07:42:43Z",
        "plannedUtc": "2026-09-18T07:46:22Z",
        "durationS": 240,
        "inTransitWindow": false,
        "planned": true
      },
      "entries": [
        {
          "seq": 1,
          "cmd": "slew_center_rotate",
          "atUtc": "2026-09-18T07:34:00Z",
          "durationS": 90
        },
        {
          "seq": 2,
          "cmd": "filter",
          "atUtc": "2026-09-18T07:35:30Z",
          "durationS": 10,
          "filter": "Ha"
        },
        {
          "seq": 3,
          "cmd": "autofocus_hint",
          "atUtc": "2026-09-18T07:35:40Z",
          "durationS": 120
        },
        {
          "seq": 4,
          "cmd": "expose",
          "atUtc": "2026-09-18T07:37:40Z",
          "exposureLineId": "l001…",
          "filter": "Ha",
          "exposureS": 300,
          "gain": 100,
          "offset": 20,
          "binning": 1,
          "readoutMode": "High Gain Mode",
          "readoutModeIndex": 0,
          "bonus": false,
          "lastOfNight": false
        },
        {
          "seq": 5,
          "cmd": "wait",
          "atUtc": "2026-09-18T07:42:43Z",
          "durationS": 219
        },
        {
          "seq": 6,
          "cmd": "meridian_flip",
          "atUtc": "2026-09-18T07:46:22Z",
          "durationS": 240
        },
        {
          "seq": 7,
          "cmd": "slew_center_rotate",
          "atUtc": "2026-09-18T07:50:22Z",
          "durationS": 90
        },
        {
          "seq": 8,
          "cmd": "dither",
          "atUtc": "2026-09-18T07:51:52Z",
          "durationS": 15
        },
        {
          "seq": 9,
          "cmd": "expose",
          "atUtc": "2026-09-18T07:52:07Z",
          "exposureLineId": "l001…",
          "filter": "Ha",
          "exposureS": 300,
          "gain": 100,
          "offset": 20,
          "binning": 1,
          "readoutMode": "High Gain Mode",
          "readoutModeIndex": 0,
          "bonus": false,
          "lastOfNight": false
        },
        {
          "seq": 10,
          "cmd": "dither",
          "atUtc": "2026-09-18T07:57:10Z",
          "durationS": 15
        },
        {
          "seq": 11,
          "cmd": "expose",
          "atUtc": "2026-09-18T07:57:25Z",
          "exposureLineId": "l001…",
          "filter": "Ha",
          "exposureS": 300,
          "gain": 100,
          "offset": 20,
          "binning": 1,
          "readoutMode": "High Gain Mode",
          "readoutModeIndex": 0,
          "bonus": false,
          "lastOfNight": false
        },
        {
          "seq": 12,
          "cmd": "dither",
          "atUtc": "2026-09-18T08:02:28Z",
          "durationS": 15
        },
        {
          "seq": 13,
          "cmd": "expose",
          "atUtc": "2026-09-18T08:02:43Z",
          "exposureLineId": "l001…",
          "filter": "Ha",
          "exposureS": 300,
          "gain": 100,
          "offset": 20,
          "binning": 1,
          "readoutMode": "High Gain Mode",
          "readoutModeIndex": 0,
          "bonus": false,
          "lastOfNight": false
        },
        {
          "seq": 14,
          "cmd": "dither",
          "atUtc": "2026-09-18T08:07:46Z",
          "durationS": 15
        },
        {
          "seq": 15,
          "cmd": "expose",
          "atUtc": "2026-09-18T08:08:01Z",
          "exposureLineId": "l001…",
          "filter": "Ha",
          "exposureS": 300,
          "gain": 100,
          "offset": 20,
          "binning": 1,
          "readoutMode": "High Gain Mode",
          "readoutModeIndex": 0,
          "bonus": false,
          "lastOfNight": false
        },
        {
          "seq": 16,
          "cmd": "dither",
          "atUtc": "2026-09-18T08:13:04Z",
          "durationS": 15
        },
        {
          "seq": 17,
          "cmd": "expose",
          "atUtc": "2026-09-18T08:13:19Z",
          "exposureLineId": "l001…",
          "filter": "Ha",
          "exposureS": 300,
          "gain": 100,
          "offset": 20,
          "binning": 1,
          "readoutMode": "High Gain Mode",
          "readoutModeIndex": 0,
          "bonus": false,
          "lastOfNight": false
        },
        {
          "seq": 18,
          "cmd": "dither",
          "atUtc": "2026-09-18T08:18:22Z",
          "durationS": 15
        },
        {
          "seq": 19,
          "cmd": "expose",
          "atUtc": "2026-09-18T08:18:37Z",
          "exposureLineId": "l001…",
          "filter": "Ha",
          "exposureS": 300,
          "gain": 100,
          "offset": 20,
          "binning": 1,
          "readoutMode": "High Gain Mode",
          "readoutModeIndex": 0,
          "bonus": false,
          "lastOfNight": false
        },
        {
          "seq": 20,
          "cmd": "dither",
          "atUtc": "2026-09-18T08:23:40Z",
          "durationS": 15
        },
        {
          "seq": 21,
          "cmd": "expose",
          "atUtc": "2026-09-18T08:23:55Z",
          "exposureLineId": "l001…",
          "filter": "Ha",
          "exposureS": 300,
          "gain": 100,
          "offset": 20,
          "binning": 1,
          "readoutMode": "High Gain Mode",
          "readoutModeIndex": 0,
          "bonus": false,
          "lastOfNight": false
        },
        {
          "seq": 22,
          "cmd": "dither",
          "atUtc": "2026-09-18T08:28:58Z",
          "durationS": 15
        },
        {
          "seq": 23,
          "cmd": "expose",
          "atUtc": "2026-09-18T08:29:13Z",
          "exposureLineId": "l001…",
          "filter": "Ha",
          "exposureS": 300,
          "gain": 100,
          "offset": 20,
          "binning": 1,
          "readoutMode": "High Gain Mode",
          "readoutModeIndex": 0,
          "bonus": false,
          "lastOfNight": false
        },
        {
          "seq": 24,
          "cmd": "dither",
          "atUtc": "2026-09-18T08:34:16Z",
          "durationS": 15
        },
        {
          "seq": 25,
          "cmd": "expose",
          "atUtc": "2026-09-18T08:34:31Z",
          "exposureLineId": "l001…",
          "filter": "Ha",
          "exposureS": 300,
          "gain": 100,
          "offset": 20,
          "binning": 1,
          "readoutMode": "High Gain Mode",
          "readoutModeIndex": 0,
          "bonus": false,
          "lastOfNight": false
        },
        {
          "seq": 26,
          "cmd": "dither",
          "atUtc": "2026-09-18T08:39:34Z",
          "durationS": 15
        },
        {
          "seq": 27,
          "cmd": "autofocus_hint",
          "atUtc": "2026-09-18T08:39:49Z",
          "durationS": 120
        },
        {
          "seq": 28,
          "cmd": "expose",
          "atUtc": "2026-09-18T08:41:49Z",
          "exposureLineId": "l001…",
          "filter": "Ha",
          "exposureS": 300,
          "gain": 100,
          "offset": 20,
          "binning": 1,
          "readoutMode": "High Gain Mode",
          "readoutModeIndex": 0,
          "bonus": false,
          "lastOfNight": false
        },
        {
          "seq": 29,
          "cmd": "dither",
          "atUtc": "2026-09-18T08:46:52Z",
          "durationS": 15
        },
        {
          "seq": 30,
          "cmd": "expose",
          "atUtc": "2026-09-18T08:47:07Z",
          "exposureLineId": "l001…",
          "filter": "Ha",
          "exposureS": 300,
          "gain": 100,
          "offset": 20,
          "binning": 1,
          "readoutMode": "High Gain Mode",
          "readoutModeIndex": 0,
          "bonus": false,
          "lastOfNight": false
        },
        {
          "seq": 31,
          "cmd": "dither",
          "atUtc": "2026-09-18T08:52:10Z",
          "durationS": 15
        },
        {
          "seq": 32,
          "cmd": "expose",
          "atUtc": "2026-09-18T08:52:25Z",
          "exposureLineId": "l001…",
          "filter": "Ha",
          "exposureS": 300,
          "gain": 100,
          "offset": 20,
          "binning": 1,
          "readoutMode": "High Gain Mode",
          "readoutModeIndex": 0,
          "bonus": false,
          "lastOfNight": false
        },
        {
          "seq": 33,
          "cmd": "dither",
          "atUtc": "2026-09-18T08:57:28Z",
          "durationS": 15
        },
        {
          "seq": 34,
          "cmd": "expose",
          "atUtc": "2026-09-18T08:57:43Z",
          "exposureLineId": "l001…",
          "filter": "Ha",
          "exposureS": 300,
          "gain": 100,
          "offset": 20,
          "binning": 1,
          "readoutMode": "High Gain Mode",
          "readoutModeIndex": 0,
          "bonus": false,
          "lastOfNight": false
        },
        {
          "seq": 35,
          "cmd": "dither",
          "atUtc": "2026-09-18T09:02:46Z",
          "durationS": 15
        },
        {
          "seq": 36,
          "cmd": "expose",
          "atUtc": "2026-09-18T09:03:01Z",
          "exposureLineId": "l001…",
          "filter": "Ha",
          "exposureS": 300,
          "gain": 100,
          "offset": 20,
          "binning": 1,
          "readoutMode": "High Gain Mode",
          "readoutModeIndex": 0,
          "bonus": false,
          "lastOfNight": false
        },
        {
          "seq": 37,
          "cmd": "dither",
          "atUtc": "2026-09-18T09:08:04Z",
          "durationS": 15
        },
        {
          "seq": 38,
          "cmd": "expose",
          "atUtc": "2026-09-18T09:08:19Z",
          "exposureLineId": "l001…",
          "filter": "Ha",
          "exposureS": 300,
          "gain": 100,
          "offset": 20,
          "binning": 1,
          "readoutMode": "High Gain Mode",
          "readoutModeIndex": 0,
          "bonus": false,
          "lastOfNight": false
        },
        {
          "seq": 39,
          "cmd": "dither",
          "atUtc": "2026-09-18T09:13:22Z",
          "durationS": 15
        },
        {
          "seq": 40,
          "cmd": "expose",
          "atUtc": "2026-09-18T09:13:37Z",
          "exposureLineId": "l001…",
          "filter": "Ha",
          "exposureS": 300,
          "gain": 100,
          "offset": 20,
          "binning": 1,
          "readoutMode": "High Gain Mode",
          "readoutModeIndex": 0,
          "bonus": false,
          "lastOfNight": false
        },
        {
          "seq": 41,
          "cmd": "end",
          "atUtc": "2026-09-18T09:18:40Z"
        }
      ]
    }
  ],
  "summary": {
    "targets": 2,
    "plannedFrames": {
      "e77c…": {
        "R": 310
      },
      "a91f…": {
        "Ha": 17
      }
    }
  },
  "diagnostics": [
    {
      "projectId": "e77c…",
      "panelId": "p9…",
      "reason": "flip_in_transit",
      "message": "Meridiandurchgang 04:27:13 UTC liegt im Transitfenster"
    },
    {
      "projectId": "a91f…",
      "panelId": "p001…",
      "lineId": "l001…",
      "reason": "no_need",
      "message": "Planungsbedarf 17 Aufnahmen (20 − 3 gemeldete, noch nicht bestätigte) mit Blockende 09:18:40 UTC erfüllt"
    },
    {
      "projectId": "b22…",
      "reason": "moon_blocked"
    },
    {
      "projectId": "c3d0…",
      "reason": "outranked",
      "message": "Nutzbare Zeit lag vollständig im gesperrten Transitfenster"
    }
  ],
  "warnings": [
    {
      "code": "no_alloc",
      "level": "warn",
      "unitId": "c3d0…/p0",
      "message": "Arbeit und nutzbare Zeit, aber keine Belichtung – das Transitfenster sperrt 02:08–07:34 UTC"
    }
  ]
}
```

`cmd` = `slew_center_rotate` | `slew_center` | `filter` | `expose` | `expose_series` (Transit) | `dither` | `wait` | `meridian_flip` | `autofocus_hint` | `end` (Aktionen: `execution.md` §4.2; `wait`, `meridian_flip`, `autofocus_hint` sind nur Zeitmarken, `end` schließt jeden Block ab). Block-`kind` = `regular` | `transit`; Block-IDs sind UUIDs je Planrevision.

**Drei Zeitmarken (verbindlich, FK 8.1):** `darknessEndUtc` = Ende der astronomischen Dunkelheit (danach keine Belichtung mehr), `flatsNotBeforeUtc` = frühester Flat-Start (Standard = `darknessEndUtc`), `sessionEndUtc` = **Nachtende** = Ende des Nachtfensters (bürgerliche Morgendämmerung + 1 h). Daran hängen Nachtschleife, Stale-Schwelle (+ 2 h), Nachtbericht und Flat-Start; es gilt `darknessEndUtc ≤ flatsNotBeforeUtc ≤ sessionEndUtc`. `nightWindow` liefert beide Grenzen des Rasters.

Die Diagnose läuft über **einen** Kanal: `diagnostics[]` mit `projectId`, optional `panelId` und **optional `lineId`** (zeilenweise Gründe für das Aufwand-Kennzeichen, `effort.md`), `reason` aus `enums.json` `diagnosticReasons` und optionaler Meldung (ein Eintrag je Grund, mehrere Gründe je Projekt möglich). `warnings[]` enthält die Plausibilitätswarnungen (FA-SIM-03) als `{code, level, unitId?, atUtc?, durationS?, message?}` – `code` aus `simulatorWarnings`, `level` aus `warningLevels` (`warn` | `error`), `unitId` in der Schreibweise `"<projectId>[/p<index>]"` (`allocation.md` §5.3).

**Meridian-Flip am Block – eine Struktur (verbindlich):** `meridianFlip: { waitStartUtc: string|null, plannedUtc: string, durationS: number, inTransitWindow: boolean, planned: boolean }`. `durationS` deckt nur den Flip; die anschließende Zentrierung ist ein eigener `slew_center_rotate`/`slew_center`-Eintrag. Transitblöcke enthalten keinen `meridian_flip`-**Eintrag** (`planned: false`); liegt der Meridian im Fenster, steht das als `inTransitWindow: true` am Block und als Diagnose `flip_in_transit`.

**Transitblock (verbindlich, NIN5-5):** `startUtc` ist der **Fensterbeginn** aus `targets` (`windowStartUtc`), nicht der Slew-Beginn. Der Slew-/Zentrier-Vorlauf steht als erster Eintrag mit `atUtc = startUtc − slewCenterS − 60 s` und liegt damit **vor** `startUtc` – der einzige Fall im Plan, in dem ein Eintrag dem Blockbeginn vorausgeht (`transit.md` §3). Das Plugin zieht den Vorlauf nicht erneut ab.

Flats/Dark-Flats stehen nicht im Plan; das Plugin bildet die Kombinationen aus den tatsächlich gespeicherten Lights (FA-NIN-17). Das Beispiel ist **vollständig durchgerechnet** (Standort und Overheads aus dem Bootstrap-Beispiel): bürgerliche Dämmerung 01:04:49 → `nightWindow.start` 00:05, astronomische Dunkelheit 02:01:58–11:01:56, Nachtende 12:59; Transitfenster 02:08–07:34 mit 310 Aufnahmen à 63 s, danach NGC 281 mit 17 Ha-Aufnahmen (Planungsbedarf 20 − 3 gemeldete) bis 09:18:40, Meridian des Panels 07:41:22 → Flip 07:46:22. Die ungenutzte Zeit danach erzeugt kein `idle_gap`, weil keine Einheit mit Restbedarf dann nutzbar ist (`allocation.md` §12). Der Plan zeigt nur zwei Blöcke.

#### `POST /nina/v1/sessions` · `PATCH /nina/v1/sessions/{id}`

```json
{
  "id": "0192a7c0-0000-7000-8000-000000000a01",
  "night": "2026-09-17",
  "nightPlanId": "0192a7c0-0000-7000-8000-000000000b01",
  "startedAtUtc": "2026-09-18T02:01:58Z",
  "offlinePlan": null,
  "offline": false
}
```

Antwort `201` bzw. `409 session.rig_busy`:

```json
{
  "sessionId": "0192a7c0-0000-7000-8000-000000000a01",
  "lease": {
    "untilUtc": "2026-09-18T02:04:58Z"
  },
  "planLogUploadUrl": "https://…"
}
```

```json
{
  "status": "completed",
  "endedAtUtc": "2026-09-18T12:59:00Z",
  "outboxPending": 7,
  "ninaConditions": {
    "sqm": {
      "avg": 21.6,
      "min": 21.3,
      "max": 21.8
    },
    "ambientTempC": {
      "avg": 14.2
    },
    "humidityPct": {
      "avg": 38
    },
    "windMs": {
      "max": 6.1
    }
  }
}
```

#### `POST /nina/v1/sessions/{id}/captures` – Lights, Flats, Dark-Flats

```json
{
  "captures": [
    {
      "id": "0192a8…",
      "frameType": "light",
      "capturedAtUtc": "2026-09-18T08:06:16Z",
      "night": "2026-09-17",
      "blockId": "0192a7c0-0000-7000-8000-000000000c02",
      "projectId": "a91f…",
      "panelId": "p001…",
      "exposureLineId": "l001…",
      "transitObservationId": null,
      "filterShortName": "Ha",
      "filterActual": "Ha 3nm",
      "exposureS": 300,
      "gain": 100,
      "offset": 20,
      "binning": 1,
      "readoutMode": "High Gain Mode",
      "raDeg": 13.2051,
      "decDeg": 56.6301,
      "rotationDeg": 90.4,
      "pierSide": "east",
      "rotatorMechDeg": 270.4,
      "bonus": false,
      "result": "saved",
      "fileName": "NGC 281_Ha_300s_0023.fits",
      "metrics": {
        "hfr": 2.1,
        "stars": 1432,
        "meanAdu": 812,
        "sensorTempC": -10.0,
        "guidingRmsArcsec": 0.62,
        "altitudeDeg": 61.2,
        "airmass": 1.14,
        "focusPosition": 14820
      },
      "nightPlanId": "0192a7c0-0000-7000-8000-000000000b01",
      "readoutModeIndex": 0
    },
    {
      "id": "0192b1…",
      "frameType": "flat",
      "capturedAtUtc": "2026-09-18T11:12:03Z",
      "night": "2026-09-17",
      "projectIds": [
        "a91f…",
        "c3d0…"
      ],
      "filterShortName": "Ha",
      "filterActual": "Ha 3nm",
      "exposureS": 2.4,
      "gain": 100,
      "offset": 20,
      "binning": 1,
      "readoutMode": "High Gain Mode",
      "rotatorMechDeg": 270.4,
      "result": "saved",
      "fileName": "FLAT_NGC 281_Ha_0001.fits",
      "metrics": {
        "meanAdu": 32100
      },
      "nightPlanId": "0192a7c0-0000-7000-8000-000000000b01",
      "readoutModeIndex": 0,
      "flatsPlanned": 20,
      "darkFlatsPlanned": 20
    },
    {
      "id": "0192b9…",
      "frameType": "dark_flat",
      "capturedAtUtc": "2026-09-18T11:19:40Z",
      "night": "2026-09-17",
      "projectIds": [
        "a91f…",
        "c3d0…"
      ],
      "filterShortName": "Ha",
      "filterActual": "Ha 3nm",
      "exposureS": 2.4,
      "gain": 100,
      "offset": 20,
      "binning": 1,
      "readoutMode": "High Gain Mode",
      "rotatorMechDeg": 270.4,
      "result": "saved",
      "fileName": "DARKFLAT_NGC 281_2.4s_0001.fits",
      "nightPlanId": "0192a7c0-0000-7000-8000-000000000b01",
      "readoutModeIndex": 0,
      "flatsPlanned": 20,
      "darkFlatsPlanned": 20
    }
  ]
}
```

Antwort: `{ "results": [ { "id": "0192a8…", "status": "accepted" }, { "id": "0192b1…", "status": "accepted" }, … ] }` (Statuswerte 6.6).

**Pflichtfelder je Typ:** alle Typen `id`, `frameType`, `capturedAtUtc`, `night`, `nightPlanId`, `filterShortName`, `filterActual`, `exposureS`, `gain`, `offset`, `binning`, `readoutMode`, `readoutModeIndex`, `result`; `fileName` **nur bei `result = saved`** (bei `aborted`/`failed` optional). *Light* zusätzlich `blockId` (UUID), `projectId`, `panelId`, `exposureLineId` (oder `assignment: "unassigned"`), `raDeg`/`decDeg` (Soll-Koordinaten des Panels), `rotationDeg` (Positionswinkel des letzten Plate-Solve im Block, sonst Soll), `pierSide` (`east`/`west`, unbekannt `null`), `rotatorMechDeg`, `bonus`; Exoplaneten `transitObservationId`. *Flat* und *Dark-Flat* zusätzlich `rotatorMechDeg`, `projectIds` (alle Ziele der Kombination; das Plugin kopiert die Dateien in deren Ordner, Kopien werden nicht gemeldet) sowie `flatsPlanned`/`darkFlatsPlanned`; *Flat* zusätzlich `metrics.meanAdu`.

- **`nightPlanId` (verbindlich, NIN5-14):** Pflichtfeld. **Einzige Ausnahme:** eine offline angelegte Session darf `null` melden, solange ihr Offline-Plan noch nicht per `PATCH … {offline: true, offlinePlan}` nachgemeldet ist; der Server setzt beim Nachmelden die neue ID ein (6.6). Online gemeldete Aufnahmen ohne `nightPlanId` werden mit `422` abgewiesen.
- **`rotatorMechDeg` je `frameType` (verbindlich, NIN5-8):** bei `light` der **gemessene** mechanische Rotatorwinkel (ohne Rotator `0`), bei `flat`/`dark_flat` der **eingefrorene Repräsentant** der Flat-Kombination (Median in Zehntelgrad, `execution.md` §7). Nur so stimmen Plugin- und Serverschlüssel überein.
- **`flatsPlanned` / `darkFlatsPlanned` (verbindlich, NIN5-9):** Sollzahlen dieser Kombination in dieser Nacht; die **erste** Meldung je Kombination gewinnt, fehlende Felder fallen auf die Rig-Einstellung zurück (6.6). `darkFlatsPlanned = 0`, wenn die Dark-Flat-Gruppe der Nacht schon erledigt ist; bei Auto-Exposure-/Sky-Flat-Boxen dürfen beide fehlen.
- **`metrics`-Schlüssel und ihre Herkunft (NIN5-10):** `hfr` und `stars` aus der **Sterndetektion** des aufbereiteten Bildes, `meanAdu` aus `imageData.Statistics.Mean`, `sensorTempC` aus den Kamera-Metadaten, `guidingRmsArcsec` aus dem Guider, `altitudeDeg`/`airmass` aus der Montierungsposition, `focusPosition` aus dem Fokussierer – alle optional; fehlt ein Wert, bleibt das Feld **weg** (nicht `0`). Darks und Bias werden nicht gemeldet (OP-26).

#### `POST /nina/v1/heartbeat`

```json
{
  "state": "running",
  "sessionId": "0192a7c0-0000-7000-8000-000000000a01",
  "blockId": "0192a7c0-0000-7000-8000-000000000c01",
  "pluginVersion": "1.0.0",
  "engineVersion": "3.2.0",
  "profileLocation": {
    "latDeg": 31.5471,
    "lonDeg": -99.3823
  },
  "cameraReadoutModes": [
    {
      "index": 0,
      "name": "High Gain Mode"
    },
    {
      "index": 1,
      "name": "Low Noise Mode"
    }
  ],
  "meridianFlip": {
    "triggerPresent": true,
    "afterMin": 5,
    "maxAfterMin": 15,
    "pauseBeforeMin": 0
  },
  "lastMeasuredRotationDeg": 90.4,
  "filterWheel": [
    {
      "position": 0,
      "name": "L"
    },
    {
      "position": 1,
      "name": "Ha 3nm"
    },
    {
      "position": 2,
      "name": "Red"
    }
  ],
  "outboxPending": 0,
  "deadLetters": 0,
  "settingsVersion": 12,
  "offlineUntil": null,
  "ackedCommandIds": [
    "0192d0…"
  ]
}
```

Antwort:

```json
{
  "serverTimeUtc": "2026-09-18T02:10:00Z",
  "lease": {
    "untilUtc": "2026-09-18T02:13:00Z",
    "leaseLost": false
  },
  "settingsVersion": 12,
  "targetsEtag": "\"t-8f3a\"",
  "commands": [
    {
      "id": "0192d1…",
      "command": "refresh_targets"
    }
  ]
}
```

`leaseLost = true` → Plugin beendet die laufende Belichtung, startet keine neuen Blöcke (5.6). `state = "offline"` friert Lease und Überwachung ein (`offlineUntil` höchstens 14 Tage). `state` aus `enums.json` `heartbeatStates` (`running`, `idle`, `paused`, `flats`, `offline`, `blocked`); bei `blocked` trägt der Heartbeat zusätzlich `blockedReason` aus `blockedReasons`.

**`commands` (verbindlich, NIN5-14):** Liste von Kommandos, die der Server dem Rig mitgibt – Werte aus `enums.json` `ninaCommands`: `refresh_targets` (sofort `GET /targets` und, falls geändert, neu planen) und `reset_plan` (wie die Benutzeraktion *Zurücksetzen*: Blockindex 0, `reason: reset`, 5-min-Sperre aufheben). Jedes Kommando hat eine `id`; das Plugin führt es **genau einmal** aus und quittiert es im nächsten Heartbeat mit `ackedCommandIds[]`. Der Server entfernt quittierte Kommandos und wiederholt unquittierte höchstens 10 min lang. Kommandos entstehen aus den Web-Aufrufen `POST /web/v1/rigs/{id}/commands` (Rechte 5.5).

#### Weitere Aufrufe

- `POST /nina/v1/sessions/{id}/events` – `{ "events": [ { "id", "occurredAtUtc", "kind", "code?", "nightPlanId?", "blockId?", "projectId?", "durationS?", "message?", "data": {} } ] }` (`code` = maschinenlesbarer Unterfall, z. B. `clock_skew`, `image_not_saved`, `readout_mode_not_found`, `rig_busy`; `message` nur für Menschen), `kind` aus `contracts/enums.json` `sessionEventKinds` (u. a. `plan_built`, `plan_rebuilt`, `block_start`, `block_end`, `block_skipped`, `center_failed`, `safety_pause`, `flip`, `rotation_mismatch`, `transit_start`, `transit_end`, `trigger_suppressed`, `filter_not_found`, `readout_mode_not_found`, `flats_start`, `flats_end`, `lease_conflict`, `lease_lost`, `offline_start`, `offline_end`, `warning`, `error`); Gründe für `block_skipped`/`block_end` aus `blockSkipReasons`/`blockEndReasons`.

### 7.7 Discord-Kanäle je Mandant (ausgehend)

- **Konfiguration:** `tenant.discord_*` (Server) und `discord_channel` (Kanäle mit Kategorien `approvals`, `sessions`, `alerts` und Ereignisfilter). Webhook-URLs liegen ausschließlich als SSM-SecureString unter `/nina-pm/tenants/<tid>/discord/<channelId>` (Schreibrecht nur `api`, Lesen `worker`); die DB enthält nur Name und `webhook_hint`.
- **Ereignisse → Kategorien:**

| Kategorie | Ereignisse (`eventKey`) |
|---|---|
| `approvals` | `submission.new`, `submission.withdrawn`, `approval.approved`, `approval.returned`, `approval.rejected`, `approval.expired`, `deadline.near`, `change_request.new`, `change_request.decided` |
| `sessions` | `session.started`, `session.completed`, `session.stale`, `session.report` (Nachtbericht, FA-AUS-21 – ausschließlich über den Job `session_report`, der je Kanal `discord_post`-Jobs anlegt), `transit.observed`, `transit.missed` |
| `alerts` | `session.no_heartbeat` (> 10 min während *läuft*, nicht im Offline-Modus; Zeitschwellen FK 8.1), `plugin.dead_letters`, `rig.busy`, `nina.settings_mismatch`, `discord.channel_failed` |

- **Zustellung:** Das auslösende Ereignis legt je passendem, aktivem Kanal einen Job `discord_post` an (Deduplizierung über `<channelId>:<eventKey>:<objektId>`) und dazu eine Zeile `discord_delivery` mit `tenant_id`, `status = 'pending'`. Der Job `tick-5min` holt liegengebliebene Zustellungen über den Index `(status, created_at)` (DAT5-4).
- **Erneut senden (FA-AUS-21, DAT5-4):** `POST /web/v1/sessions/{id}/report/resend` (und entsprechend für andere Ereignisse) setzt die bestehende `discord_delivery`-Zeile **explizit zurück** – `status = 'pending'`, `attempts = 0`, `last_error = NULL`, `sent_at = NULL`, `job_id = NULL` – und legt einen neuen `discord_post`-Job an. Der Primärschlüssel `(channel_id, event_key, object_id)` bleibt damit eindeutig und blockiert das erneute Senden nicht. Jeder Reset steht im Änderungsprotokoll. `worker` sendet `POST <webhookUrl>?wait=true` mit `{ "username": "Svenesis NINA-PM", "embeds": [ … ], "allowed_mentions": { "parse": [] } }` (max. 10 Embeds, 6.000 Zeichen; der Nachtbericht wird bei Bedarf auf mehrere Meldungen verteilt). `429` → Wartezeit aus `retry_after` und erneuter Versuch; `5xx`/Netz → bis 5 Versuche mit Backoff; `401`/`404` → Kanal deaktivieren, `last_error` setzen, Benachrichtigung `discord.channel_failed` an die Admins in der App.
- **Inhalte:** Texte über i18n in der Standardsprache des Mandanten, Links auf `https://nina-pm.svenesis.org/…`; keine Dateinamen, Tokens, Standortkoordinaten; Anzeigenamen nur, wenn im Ereignisfilter erlaubt.
- **Eingehend:** nicht vorgesehen (Fachkonzept FA-DIS-06, OP-25); ein späterer Bot bekäme einen eigenen Endpunkt `/api/discord/interactions` mit Signaturprüfung.

---

## 8. Scheduler- und Astronomie-Engine

### 8.1 Grundsätze

- **Reine Funktionen, keine Seiteneffekte:** kein `Date.now()`, kein `Math.random()`, keine I/O, keine Zeitzonen-Abhängigkeit vom Host. Alle Eingaben explizit (inkl. Zeitzonen-Offsets als vorab berechnete Übergangstabelle für die Nacht).
- **Determinismus (NFA-03):** stabile Sortierungen mit vollständigem Tie-Breaker (zuletzt `id`), feste Rasterung (5 min), Zeiten als ganze Sekunden, Vergleichswerte vor Schwellenprüfungen quantisiert (Winkel auf 1e-6°), Zahlen im Output auf definierte Nachkommastellen gerundet.
- **Eigene Mathematik:** Trigonometrie, `exp`, `log`, `pow` kommen aus `packages/engine/src/math`; erlaubt aus `Math` sind nur `abs`, `floor`, `ceil`, `trunc`, `min`, `max`, `sign`, `sqrt` und `PI` (Runden nur über `q(x, inv)`/`roundHalfAwayFromZero` mit ganzzahligem Kehrwert, `canonical-json.md`) (Port von fdlibm in TS; nur `+ − × ÷` und `sqrt` sind in IEEE 754 exakt festgelegt). ESLint verbietet `Math.sin/cos/tan/asin/acos/atan/atan2/exp/log/pow`, `Math.round`, `Date` und `Intl` im Engine-Paket.
- **Kanonisches JSON in der Engine:** `canonicalInputJson(input)` (Regeln: `claude-code/docs/specs/engine/canonical-json.md`) erzeugt die Zeichenkette für alle Hosts; Hosts berechnen nur `sha256` darüber (kein Unterschied zwischen `JSON.stringify` und .NET).
- **Online plant der Server (ADR-16);** Jint wird nur offline genutzt, der Paritätstest Node ↔ Jint läuft trotzdem mit zufällig erzeugten Eingaben (≥ 500 Fälle).
- **Versionierung:** `ENGINE_VERSION` (SemVer). Major = anderes Planungsergebnis bei gleichen Eingaben möglich → Plugin und Server müssen gleiche Major-Version haben.
- **Bundles:** ESM für Web/Node; `engine.iife.js` (ES2020, keine BigInt-/Intl-Abhängigkeiten) für Jint.

### 8.2 Öffentliche Schnittstelle (Auszug)

```ts
export function computeNight(input: NightInput): NightContext;             // Sonne, Mond, Dämmerung, Raster
export function visibility(ctx: NightContext, target: TargetInput): VisibilityGrid;
export function moonSafe(ctx: NightContext, target: TargetInput, profile: MoonProfile): boolean[];
export function planNight(input: PlanInput): NightPlan;                      // Blöcke + Einträge + Zuteilung + Diagnose
export function simulateNights(input: MultiNightInput): MultiNightResult;    // Prognose, Kandidaten
export function transitEvents(eph: Ephemeris, site: Site, fromUtc: number, toUtc: number): TransitEvent[];
export function weatherScores(hourly: WeatherHourly[]): WeatherScores;
export function rankTargets(input: RankInput): RankedTarget[];
export function estimateEffort(input: EffortInput): EffortEstimate;         // Aufwand-Kennzeichen (FK 8.9)
export function canonicalInputJson(input: unknown): string;                // Grundlage für inputHash in allen Hosts
export const ENGINE_VERSION: string;
```

`PlanInput` enthält: Standort (Lat/Lon/Höhe), Nacht, Zeitzonen-Übergänge (vom Server geliefert, inkl. tzdata-Version), Rig-Geometrie, Scheduler-Settings (inkl. Meridian-Flip), Rotator-Angaben (vorhanden, Kamerawinkel, Toleranz), Mondprofile, Projekte (Panels mit **Panel-Koordinaten**, Zeilen mit Restbedarf und Bonus-Spielraum, Bedingungen, Priorität, Startdatum, Zieltermin, Exoplaneten-Ereignis mit `lockedAt`), Overhead-Annahmen, optional `startAtUtc` und `tonight` (Neuplanung während der Nacht: vergangene Blöcke je Einheit, belichtete Sekunden, letzter Autofokus, Filterzyklus, Flip erledigt je Panel, aktuelle Einheit) und **genau ein** Modusfeld `mode: 'productive' | 'compat'` (Kompatibilität nur für das Orakel, `allocation.md` §11.1).

### 8.3 Planungsalgorithmus (verbindlich)

**Grundlage:** Planungs-Engine des Astro-PM-NINA-Plugins (MIT, Commit `5dd621d`, `ScheduleEngine.cs`/`SessionScheduler.cs`), nach TypeScript portiert. Vollständige Rechenvorschrift mit Abweichungen: `claude-code/docs/specs/engine/allocation.md`; Sortierkette: `sort-chain.md`; Analyse: `Analyse_AstroPM_NINA_Plugin_2026-09-17.md`. Kurzfassung:

1. **Nachtkontext:** 5-min-Slots von bürgerlicher Abenddämmerung − 1 h bis Morgendämmerung + 1 h; je Slot Sonne (geometrisch), Mond (topozentrisch, scheinbar), Beleuchtung, Elongation – genaue Astronomie (8.4, Kap. 9).
2. **Profile:** Nutzbarkeit je Einheit (Projekt bzw. Panel bei „Mosaik-Panels getrennt planen“, mit Panel-Koordinaten); ein Slot gilt nur als nutzbar, wenn die Bedingungen **zu Beginn und am Ende** erfüllt sind; Aussortieren bei längstem Lauf < min(Mindestzeit, Restarbeit + Blockfixkosten); Overhead je Belichtung = Download + anteiliges Dither-Settle + anteiliger Filterwechsel + anteiliger Autofokus, Blockfixkosten = Slew + erwarteter Flip (`allocation.md` §2); **Mond-Stufen** nach Mondprofil mit Restriktivität `A·(1+100/(maxIllum+1))`, „Kein Mond“ = ∞; Planungsbedarf inkl. Überschuss %, Download und anteiligem Dither-Settle.
3. **Matrix:** Masken, Restarbeit je Stufe, MinChunk (bei Projektende auf Restarbeit verkleinert, zuzüglich Blockfixkosten `fix` = Slew/Zentrieren + erwarteter Flip; der Autofokus steckt im Overhead je Belichtung), knappes Fenster, Maximalhöhe, Prioritätsindex. Aussortieren mit min(Mindestzeit, Restarbeit + `fix`).
4. **Proportional:** Transitfenster sperren → Vorfilter → exklusive Slots (stufenbewusst) und Anker verlängern → Mond-unten-Zeit für nur-mondlose Arbeit (1a), übrige Mondvermeidungs-Arbeit exklusiv/flexibel (1b), Rest (2) → früh untergehende Ziele reservieren Anteil im Fenster (3a) → Mond-oben-Zeit (3). Jede Verteilung über `fairShare` (Bedarf passt / Mindestzeiten passen / knapp) und `paintChunks`. **Nachtfairness:** Bedarf und Angebot enthalten die heute bereits belichtete Zeit, das Budget ist der Anteil abzüglich des schon Erhaltenen; Mosaik-Panels teilen sich den Bedarf ihres Projekts (Deckel, FK FA-SCH-05). Pass 3 berechnet `accessible` nach 3a neu.
5. **Manuelle Priorität:** je Ziel in Prioritätsreihenfolge nur-mondlose Arbeit auf Mond-unten-Slots, dann chronologisch.
6. **Nacharbeiten:** Mindestzeit erzwingen (verlängern, leihen, freigeben) → Splitter entfernen → Bonus-Füllung (Ein/Aus) → A-B-A defragmentieren → Splitter → freie Slots Nachbarn zuschlagen.
7. **Ablauf:** Uhr über die Slots mit Slew/Zentrieren (auch nach Leerlauf), Filterwechsel, Download, Dither, Autofokus-Hinweis und **Meridian-Flip** (flip-rotation.md, geprüft **vor** der Filterwahl); Blockanfang ohne Arbeit → Slots an Ziel mit Arbeit abgeben (nur, wenn es in allen übertragenen Slots belichten kann; nie Transit/vorgefiltert) oder freigeben; Belichtung nur, wenn Belichtung + Download bis Blockende passen (Kulanz nur für die letzte nutzbare Belichtung der Nacht); `pick` ohne Seiteneffekte. Transitblöcke: `expose_series` bis Fensterende, unabhängig von der Anzahl.
8. **Filterwahl:** Mondfenster-Restzeit (Headroom) → Mond steigend/unten strenge, sinkend entspannte Stufe zuerst → größter Restbedarf; Filterwechsel alle N mit Laufbahn-Toleranz und zeitkritischem Schutz (Zyklus je Zeilen-ID); Mosaik-Panel-Rotation nach Mindestzeit (aktives Panel = Panel der letzten Belichtung). `afEveryMin = 0` bzw. `ditherEvery = 0` = aus.
9. **Ausgabe:** Blöcke, Einträge (7.6), Plausibilitätswarnungen (`idle_gap` … `filter_stuck`) und Diagnose je Projekt.
10. **Abweichungen A-1…A-30** vom Original sind in `allocation.md` §10 verbindlich: genaue Astronomie, Mondformel FK 8.2 (Mond unten ⇔ Höhe ≤ 0), „Kein Mond“ einheitlich, Overheads (Download, Dither, Filterwechsel, Autofokus anteilig; Blockfixkosten im Bedarf), Flip vor der Filterwahl, stufenbewusste Nutzbarkeit, Slotprüfung an beiden Slotgrenzen, hartes Blockende mit Überhang nur bei gleichem Panel, `pick` ohne Seiteneffekte, toter Code entfernt, vollständige Tie-Breaks und ordinale Vergleiche, Nachtfairness mit Restangebot-Runde, quantisierte Budgets, Neuplanung mit `tonight`, Transitfenster mit Unsicherheit und Konfliktregel, `due_soonest`, `accessible` nach 3a, Mosaik-Deckel je Projekt, sicherer Blockanfang-Ersatz, Slew nach Leerlauf, Panel-Koordinaten, PreClaim nach `locked_at`, Transitreihe bis Fensterende, Filterzyklus je Zeile, Stufenmaske über alle Zeilen, Freigabe leerer Blockreste.
11. **Vergleichsorakel:** `tools/astropm-oracle` (.NET 8, C#-Originalquellen am gepinnten Commit mit Minimal-Patch: Logger- und `HorizonProfile`-Stub, Masken-Hook in `IsExposureSetMoonSafe`, stabiler Tie-Break in `PaintChunks`) prüft die TS-Engine im **Kompatibilitätsmodus** (Schalterliste `allocation.md` §11.1: Abweichungen aus, Overheads 0, Original-Tie-Breaks) auf identische Slot-Zuteilung und Belichtungsfolge. Der Adapter Grid → `TargetProfile`/`TimeSlot` und Log → Einträge ist in §11.2 festgelegt (17, 18). Soll-Pläne: Paint-Fälle in AP-13b, Ablauf-Fälle in AP-13d; H-13 (Sichtprüfung durch Sven) ist Merge-Bedingung, keine Startsperre.

**Aufwand-Kennzeichen (`estimateEffort`, FK 8.9, `effort.md`):** ruft `planNight` mit genau einem Projekt für **Stichproben-Nächte** des Zeitraums auf (≤ 180 Nächte, Abstand `stride` = 3 im Server-Job, 5 live im Browser; Nachtkontext je Nacht gecacht; Schritt 1 „beste Nacht“ mit vollem Bedarf, Schritt 2 chronologisch **mit dem jeweils verbleibenden Bedarf**), bis er gedeckt ist; Ergebnis `{tag, nights, earliestCompletion, achievablePct, requiredHours, bestNight, bestNightHoursByStage, limitingFactor, fullyObservable, coveragePct, stride, engineVersion, inputHash, computedAt}` (bei Planungsbedarf 0 liefert die Funktion `null`; die UI zeigt „fertig“, FA-PRJ-12). Das Ergebnis ist eine **Schätzung** unter Idealannahmen (Anzeige „ca. n Nächte“), keine Untergrenze. Laufzeitziel: ≤ 5 s je Projekt im Job (identisch in `effort.md`). Aufrufer: Projekt-Editor im Web-Worker (live, entprellt 500 ms); serverseitig **nur als Job** `effort` (7.4) nach Speichern/Einreichen/Freigeben, Sessionende und täglich – setzt `project.effort_stale`, persistiert in `project.effort_*` nur bei geändertem `effort_input_hash`. Nie synchron in einer API-Anfrage. Der tägliche Lauf berechnet höchstens 200 Projekte je Tag und je Projekt höchstens alle 7 Tage neu (sonst nur bei `effort_stale`).

### 8.4 Übernahme aus den Svenesis-Astro-Tools (Kopiervorlage)

Die Astro-Tools auf www.svenesis.org bleiben **exakt so, wie sie sind**. Für NINA-PM wird ihr Stand einmalig in das Repository kopiert (`legacy/astro-tools-2026-09-17/`, nur lesend, mit Quellenangabe und Commit-Hash bzw. Datum) und daraus **neuer TypeScript-Code** erstellt. Eine spätere Weiterentwicklung der Website wird nicht automatisch übernommen, sondern bei Bedarf bewusst nachgezogen.

| Vorlage (Website) | Neuer Code in NINA-PM | Arbeit |
|---|---|---|
| `astro-tools/js/astro-core.js` | `packages/engine/src/{time,coords,bodies,twilight}` | nach TS portieren; `window.SvAstro` und Passwort-Gate (`PW_SALT`/`PW_HASH`) entfallen; fachlicher Stand bleibt: Mond nach Meeus Kap. 47 (volle Terme, < 0,01° zu JPL Horizons), Nutation (Kap. 22), ΔT 69 s, topozentrische Parallaxe, Auf-/Untergang bei −0,833°, Zeitzonen-Offset je Zeitpunkt aus IANA (`offsetFn`), Nächte Mittag–Mittag mit 23/25 h (`nightKeyOf`) |
| `astro-tools/js/astro-weather.js` (`cloudScore`, `seeingScore`, `transparencyScore`, `overallScore`, `rating`, `nightStats`, Modellwahl, Mehrmodell-Schlüssel) | `packages/engine/src/weather` (Rechnung), `apps/api/src/jobs/weather` (Abruf), `apps/web/src/components/WeatherChart` (Canvas) | Rechenlogik rendering-frei portieren; Abruf serverseitig (Job) statt im Browser; die dokumentierten Regeln (Modell-Erkennung je Stunde, `suffixed || plain`, vorangehende Stunde bei Böen/Niederschlag, `timezone=auto`) übernehmen |
| `astro-tools/js/observing-planner.js` (Bewertung „beste Objekte“, Nacht-Streifen, Höhenkurven, Saisondiagramm `drawSeason()`) | `packages/engine/src/ranking`, `apps/web/src/components/{NightStrip,AltitudeChart,SeasonChart}` | Bewertung parametrisieren (Rig aus Eingabe); Diagramme als React-Canvas-Komponenten |
| `astro-tools/js/sky-events.js` (`nightSummary()`; Satelliten, Ereignisse) | `packages/engine/src/visibility/season.ts`, optional `events/` | `nightSummary()` als Basis des Saisondiagramms (FA-SIC-02); Ereignisse später (K) |
| `astro-tools/js/sky-map.js` + `star-catalog.js` | `apps/web/src/features/planning/skymap/` | als TS-Modul neu aufbauen (Projektion, HEALPix, Präzession als Engine-Funktionen), erweitert um Bildfeld, Rotation, Mosaik (Panel-Geometrie nach `specs/engine/geometry.md`), Projekt-Overlays |
| `astro-tools/js/dso-catalog.js` (168 Objekte) + `astro-tools/data/ngc.json` (13.466 Objekte, CC BY-SA 4.0) | `packages/catalog-data/` (eingecheckte Kopie mit Lizenz) → Import in `dso_object` | Import-Skript `tools/catalog-import`; Quellenangaben (OpenNGC, Sharpless/VizieR, SIMBAD, Caldwell/Wikipedia) im Impressum der App |
| `astro-tools/data/stars-8.bin`, `doubles.json`, `sky-events.json` | `packages/catalog-data/` → ausgeliefert unter `https://nina-pm.svenesis.org/catalog/data/` | Kopie; Generatoren s. u. |
| `astro-tools/img/dso/` (168), `img/ngc/` (13.466, 128 px, ~108 MB), `img/ngc-l/` (1.083, 320 px, ~21 MB) | S3 `svenesis-nina-pm-web/catalog/img/…` | einmalig per `aws s3 sync` aus dem lokalen Website-Ordner kopiert (nicht ins Git); später per eigenem Generator erneuerbar |
| `astro-tools/tools/*.js` (`ngc-data.js`, `ngc-thumbnails.js`, `dso-thumbnails.js`, `star-catalog-data.js`, `sky-events-data.js`, `double-stars-data.js`, `verify-planner.js`) | `tools/catalog/` (TS) und `packages/engine/test/legacy-checks.spec.ts` | Generatoren portieren, damit NINA-PM seine Daten unabhängig erneuern kann; Prüfungen aus `verify-planner.js` als Tests übernehmen |

### 8.5 Transitrechnung

- `T_n = T0 + n·P` (BJD_TDB; **Katalog-Epochen werden beim Import auf BJD_TDB normalisiert** – Offset- und Zeitsystemregeln inkl. Schaltsekunden zur Epoche in `transit.md` §1). Umrechnung: `JD_UTC = BJD_TDB − Rømer(r_earth·ŝ/c) − (TDB−TT) − (TT−UTC)`; iterativ (2 Schritte), Rømer-Maximum 8,46 min (1,01671 AU).
- Erdposition baryzentrisch: heliozentrische Erde (Meeus/VSOP-Kurzform) + Sonnenversatz zum Baryzentrum aus **Jupiter, Saturn, Uranus und Neptun** (2,48 / 1,36 / 0,42 / 0,77 Lichtsekunden) → Genauigkeit < 10 s. Identisch in `transit.md` §1.
- `TT−UTC = 32,184 s + Schaltsekunden` (Tabelle im Paket; seit 2017: 69,184 s) – **nicht zu verwechseln** mit `ΔT = TT−UT1 ≈ 69 s` (8.4), das nur in die Sternzeit eingeht; beide sind derzeit fast gleich, weil `DUT1 ≈ 0`.
- Unsicherheit `σ = |n|·σ_P + σ_T0` (bewusst linear, konservativ); die letzte O−C verschiebt das Fenster mit Vorzeichen, der Puffer bleibt symmetrisch; Fenster laut Fachkonzept Kap. 8.7 und `transit.md` §2. Bei Ultrakurzperioden werden alle Transits der Nacht aufgezählt.

### 8.6 Leistung

- Ziel: Einzelnacht mit 20 Projekten < 300 ms in Node, < 3 s im Browser-Worker; in Jint (nur offline) < 30 s, gemessen im Spike AP-S2a (NFA-05).
- Benchmarks in `packages/engine/bench/`; CI schlägt fehl bei > 50 % Verschlechterung.
- Optimierungen: Mond-/Sonnenposition einmal je Slot vorberechnen, Bitmasken als `Uint8Array`, keine Objekt-Allokation in Schleifen.

---

## 9. Referenzwerte mit Python/astropy

Python läuft **nie produktiv**. Ein Werkzeug erzeugt Referenzdaten, die TypeScript-Tests der Engine prüfen.

### 9.1 Aufbau

```
tools/reference/
├─ pyproject.toml          # astropy, astroplan, jplephem, numpy (Versionen fixiert)
├─ README.md
├─ sites.yaml              # Starfront (TX), VSW Hannover, St. Andreasberg, Gaucín (ES), La Silla (CL, Süd)
├─ targets.yaml            # NGC 281, IC 1805, NGC 6946, M31, zirkumpolar/tief stehende Testziele
├─ transits.yaml           # HAT-P-17b, Qatar-4b, weitere ExoClock-Planeten mit T0/P
├─ gen_sun_moon.py         # Dämmerungszeiten (−6/−12/−18°), Sonnenauf-/-untergang, Mondauf-/-untergang,
│                          # Mond RA/Dec/Alt/Az/Beleuchtung je 30 min für 12 Nächte über das Jahr
├─ gen_targets.py          # Alt/Az der Ziele je 5 min, Meridiandurchgang
├─ gen_transits.py         # Transitmitten/Ingress/Egress BJD_TDB → UTC für definierte Epochen
└─ out → ../../packages/engine/test/fixtures/*.json
```

- Ephemeride `de432s` (jplephem), Zeitskalen über `astropy.time` (inkl. `light_travel_time` für BJD).
- **Festgelegte Modelle der Engine** (Referenz prüft dagegen): Präzession/Nutation nach IAU 1980/Meeus Kap. 21–22 auf das Datum des Slots; Sternzeit **GMST nach IAU 1982** (Meeus 12.4) plus Äquinoktialgleichung → GAST; `UT1 ≈ UTC` (|DUT1| < 0,9 s vernachlässigt); `ΔT = TT − UT1 = 69 s`, gültig für 2026–2030 (Fehler < 0,2 s, Auswirkung < 0,001° in der Position); Refraktion nach Saemundsson aus der geometrischen Höhe (`moon.md`); keine Aberration (max. 20,5″ = 0,0057°, unter allen Toleranzen). **Zwei Sätze:** (a) geometrisch, Refraktion aus; (b) scheinbar mit festen Parametern `pressure = 1010 hPa`, `temperature = 10 °C`, `relative_humidity = 0`, `obswl = 0,55 µm`. Satz (b) wird nur für Höhen ≥ 15° verglichen (ERFA-Refraktion weicht darunter modellabhängig ab); Mondzeiten und -höhen werden **topozentrisch** gerechnet (`get_body('moon', t, location)`).
- Jede Fixture-Datei enthält Metadaten: Werkzeugversionen, Erzeugungsdatum, Parameter.
- Ergänzend werden die bestehenden Prüfungen der Website (`astro-tools/tools/verify-planner.js`: Präzession, Refraktion, Projektion, Sterndaten, Planeten gegen Horizons; USNO-Vergleich von Auf-/Untergang und Dämmerung) für die portierten Funktionen übernommen, damit die Engine mindestens den Genauigkeitsstand der Website hält.
- Aufruf lokal (`uv run gen_all.py`) **oder** im CI-Job `reference` (Python-Container, gepinnte Versionen, **gebündelte IERS-/Schaltsekunden-Tabellen**, kein Netzzugriff zur Laufzeit); das Ergebnis wird eingecheckt und im CI nur auf Unverändertheit geprüft. Claude Code braucht damit kein lokales Python (H-10 optional).

### 9.2 Toleranzen (Tests in `packages/engine/test/reference.spec.ts`)

| Größe | Toleranz | Bezug |
|---|---|---|
| Dämmerungszeiten, Sonnenauf-/-untergang | ± 60 s | NFA-15, Planungsraster 5 min |
| Mondauf-/-untergang (scheinbare Höhe des Mondmittelpunkts = 0°, `moon.md`) | ± 120 s | Mondvermeidung |
| Meridiandurchgang eines Ziels (`tM`, `flip-rotation.md` §1.1) | ± 30 s | Meridian-Flip |
| Mond RA/Dec (topozentrisch, als Winkelabstand gemessen) | ± 0,1° | Mondabstand |
| Mondbeleuchtung | ± 1 % | Profil-Schwelle |
| Zielhöhe | ± 0,05° (geometrisch **und** scheinbar; scheinbar nur ab 15° Höhe, weil die Refraktionsmodelle darunter auseinanderlaufen) | Mindesthöhe (FK 8.1) |
| Transitmitte BJD_TDB → UTC | ± 10 s | NFA-15 (< 1 min) |
| Mondsicherheit je Profil (Stufengrenzen, Relaxierung) | exakt (Tabellenfälle) | Fachkonzept 8.2 |

Zusätzlich **Determinismus-Test**: `planNight` mit festen und ≥ 500 zufällig erzeugten Eingaben in Node und (im Plugin-Test) in Jint → identischer `outputHash`; dazu die Rundungs-Testvektoren aus `canonical-json.md` (`q(x, inv)`/`roundHalfAwayFromZero`, keine Verwendung von `Math.round` und keine Rückmultiplikation mit dem Schritt).

---

## 10. NINA-Plugin

### 10.1 Rahmen

- Basis: offizielles NINA-3-Plugin-Template; Ziel-Framework gemäß NINA 3.x (aktuell .NET 8, `net8.0-windows`).
- **Zweiteilung:** `NinaPm.Core` (`net8.0`, **ohne** NINA-Abhängigkeit: ApiClient, LocalStore (SQLite), Outbox, PlanClient/EngineHost, Neuplanungs-, Lease- und Nacht-Zustandsmaschine, Playback-Logik über Schnittstellen `ISequenceHost`, `ICameraControl`, `IMountControl`, `IFilterWheelControl`, `IRotatorControl`, FilterMatcher, FlatTracker) – vollständig auf Linux testbar durch Claude Code; `NinaPm.Nina` (`net8.0-windows`: Sequenz-Elemente, Mediator-Adapter, WPF-Optionsseite) – dünn, geprüft auf einem Windows-Rechner mit NINA nach `claude-code/docs/ops/plugin-test-protocol.md`. CI: `plugin.yml` läuft auf `windows-latest`, Core-Tests zusätzlich auf Linux.
- **Codebasis Ausführung:** Astro-PM-NINA-Plugin (MIT, Commit `5dd621d`): Container-, Trigger-, Belichtungs-, Flat- und Schleifenmuster werden übernommen bzw. portiert (`claude-code/docs/specs/nina/execution.md`); Copyright-Hinweis in `THIRD_PARTY_NOTICES.md`; kein Name „Astro PM“ in Oberfläche oder Bezeichnern. Target Scheduler (MPL-2.0) nur als Anschauung, kein Code.
- Abhängigkeiten: `Jint` (Engine, nur offline), `Microsoft.Data.Sqlite` (ein lokaler Speicher `ninapm.db`: Cache, Outbox, Sende-Historie, Dead-Letter, Flat-Kombinationen, Laufzustand), `Polly` (Retries), NSwag-generierter API-Client aus `openapi.yaml`.
- **Vorbild Bedienung:** Astro-PM-Plugin 1.6.0 (Screenshots `Nina-Plugin*.jpg`): Optionsseite, Zielbrowser, Simulator im Plugin, Container mit Status-Kopf und aufklappbaren Bereichen, Flat-Handling mit drei Boxen. Das **Datei-Kopieren** geteilter Flats nutzt NINAs Bildspeicher-Muster (Zielname im Pfad) und kopiert nach dem Speichern.
- **Spike AP-S2b** (früh, nur nach AP-01) prüft gezielt die Stellen **ohne** Vorbild im Astro-PM-Plugin mit der aktuellen NINA-Version und den Simulatorgeräten: `ImageSaved`-Zuordnung über `Image.Id` für Lights, Flip-Werte aus dem Profil und Flip-Erkennung über Pier-Seite, Trigger-Filter nach Typ (Autofokus im Transit), eigener Abbruch-Token für Belichtungen, Auslesemodus setzen (P-01…P-03, P-13).
- **Tests tagsüber:** `tools/nina-test-server` liefert Pläne relativ zu „jetzt“ (Blöcke ab `now + 2 min`, Ziel-RA für Flip im Block, Transitfenster ab `now + 10 min`), damit die Protokolle P-01…P-24 ohne passende Nacht laufen (`execution.md` §9).
- Verteilung: ZIP je Release (GitHub Actions) zur manuellen Installation in den NINA-Plugin-Ordner; später Manifest für den NINA-Plugin-Manager (OP-10).

### 10.2 Struktur

```
apps/nina-plugin/
├─ NinaPm.sln
├─ NinaPm/
│  ├─ NinaPmPlugin.cs              # PluginBase, Optionen, Registrierung
│  ├─ Options/                     # WPF-Optionsseite: Einführung, Verbindung (URL, Token, Speichern & Verbinden, Aktualisieren, Status, Offline-/Urlaubsmodus),
│  │                               # Rig-Anzeige, Zielbrowser + „In Framing-Assistent laden“ (IFramingAssistantVM), Simulator (gesperrt außer offline)
│  ├─ Sequencer/
│  │  ├─ NinaPmContainer.cs        # „NINA-PM-Anweisungen“ (SequenceContainer + IDeepSkyObjectContainer, Execute überschrieben, ein Block je Aufruf)
│  │  ├─ Items/                    # interne Elemente: SlewCenterItem, StartGuidingItem, DitherItem, TakeExposureItem (IExposureItem)
│  │  ├─ TriggerWalker.cs           # RunTriggers/RunTriggersAfter auf allen Vorfahren-Containern, Koordinaten-Injektion
│  │  ├─ NightlyLoopCondition.cs      # NINA-PM Nachtschleife
│  │  ├─ WaitForTimeInstruction.cs    # NINA-PM Warten auf Zeit (Uhrzeit/Dämmerung, Versatz, Tageswechsel-Zeit)
│  │  ├─ DailyLoopCondition.cs
│  │  ├─ RefreshTargetsInstruction.cs
│  │  ├─ TriggerSets/              # NINA-PM vor/nach jeder Belichtung, vor/nach Zielwechsel (Container mit freiem Inhalt)
│  │  └─ FlatHandling/             # Boxen Vor Flats (einmal) · Je Kombination (Schleife; setzt Filter/Rotator/Gain/Offset/Binning,
│  │                               # Inhalt z. B. Trained Flat Exposure + Trained Dark Exposure) · Nach Flats (einmal)
│  ├─ Services/
│  │  ├─ ApiClient.cs              # generiert + Auth-Header + Engine-Version-Header
│  │  ├─ LocalStore.cs             # eine SQLite-Datei %LOCALAPPDATA%\NINA\Plugins\Svenesis.NinaPm\ninapm.db: cache, outbox, sent_history,
│  │  │                            # dead_letter, flat_combination_local, state (sessionId, nightPlanId, Blockindex, tonight)
│  │  ├─ Outbox.cs                 # captures/events, FIFO je Session, Fehlerklassen, Dead-Letter, 14 Tage Sende-Historie
│  │  ├─ PlanClient.cs             # POST /plan (online); Fallback EngineHost
│  │  ├─ EngineHost.cs             # Jint (nur offline): lädt engine.iife.js, JSON rein/raus, eigener Thread, Timeout
│  │  ├─ ReplanPolicy.cs           # (Kern) wann neu planen: ETag/settingsVersion/Verzug > 10 min, Fälle a/b/c im Block, tonight
│  │  ├─ PlanExecutor.cs           # Blöcke/Einträge ausführen (Eintrag → Aktion), Playback-Modi, Transit-Serie, Rotation/Flip
│  │  ├─ LeaseStateMachine.cs      # (Kern) none → acquiring → held → lost → reacquiring (Übergänge execution.md §6); Offline-Modus
│  │  ├─ BlockedState.cs           # (Kern) blocked{reason, recoverable}: 60-s-Warten statt Dauerschleife
│  │  ├─ RotationCheck.cs          # eigenes Plate-Solve nach dem Zentrieren (PositionAngle), Winkelprüfung
│  │  ├─ SequenceInspector.cs      # Meridian-Flip: Trigger in der Sequenz vorhanden? Werte aus dem NINA-Profil
│  │  ├─ FilterMatcher.cs          # normalisieren → exakt → eindeutiges Präfix beidseitig (FK 8.6, FA-NIN-27; auch Flats)
│  │  ├─ CaptureReporter.cs        # captureId vor der Belichtung; nach CaptureImage Image.Id → captureId registrieren (vor Enqueue);
│  │  │                            # ImageSaved → saved, 120 s ohne ImageSaved → failed; → Outbox
│  │  ├─ FlatTracker.cs            # Kombinationen aus gespeicherten Lights (Filter, mechanischer Winkel, Gain, Offset, Binning, Auslesemodus),
│  │  │                            # Status + Anzahl je Kombination (Fortsetzen), Primärziel = erstes Ziel, Datei-Kopie, Meldung mit projectIds
│  │  ├─ HeartbeatService.cs       # Hintergrund-Timer 60 s unabhängig von der Sequenz; Zustand, Profil-Standort, Auslesemodi, Filterrad, Lease
│  │  └─ SiteCheck.cs              # Abweichung Profil ↔ Rig-Standort > 10 km; Uhrabweichung zum Server (serverTimeUtc, gemittelt) > 5 s Warnung, > 60 s keine Ausführung (NFA-15)
│  ├─ Resources/engine.iife.js     # beim Build aus packages/engine kopiert (Version geprüft)
│  └─ Samples/                     # Beispielsequenzen (FA-NIN-25): one-night (R1), multi-night und with-flats (R5); ohne Gerätewerte
└─ NinaPm.Tests/                   # xUnit (Linux, Kern): FilterMatcher, Outbox, LocalStore, ReplanPolicy, LeaseStateMachine, Playback, FlatTracker, EngineHost-Parität
```

### 10.3 Ablauf im Container

Verbindlich im Detail: `claude-code/docs/specs/nina/execution.md`. Kurzfassung:

1. **Initialisierung:** Optionen prüfen; `GET /bootstrap` (bei Fehler Cache, bei `401` **kein** Cache und keine Blöcke); Engine-Version und Uhrabweichung prüfen; Outbox senden (Session vor Aufnahmen). Nacht-Schlüssel ausschließlich aus dem Bootstrap, nie aus der lokalen Windows-Zeit.
2. **Plan:** `GET /targets` (ETag) → **online** `POST /plan {reason: initial}` (Server), **offline** `EngineHost.planNight(input)` aus dem Cache; Plan anzeigen; `POST /sessions` mit `nightPlanId` (Lease; bei `409 session.rig_busy` nur Anzeige als Simulation, keine Ausführung). `sessionId`, `nightPlanId`, Blockindex und `tonight` werden in `ninapm.db` persistiert.
3. **Neuplanung mit Hysterese (FA-SYN-03, `execution.md` §3.2):** vor jedem Block nur, wenn das Targets-ETag oder die `settingsVersion` sich geändert hat oder der Block > 10 min hinter dem Plan liegt → `POST /plan {reason: refresh, startAtUtc = max(jetzt, geplanter Blockstart), tonight}`; sonst gilt der Plan unverändert. **Im laufenden Block** alle 15 min `GET /targets`; bei neuem ETag: (a) aktuelles Projekt/Panel/Zeile entfällt → laufende Belichtung zu Ende, Block beenden, neu planen ab jetzt; (b) neuer/geänderter festgelegter Transit, dessen Fenster vor Blockende beginnt → Transit-Unterbrechung (Nr. 8); (c) sonst behält der Block seine Einträge, der neue Plan gilt ab dem nächsten Block. Neuer Blockindex = erster Block mit `endUtc > jetzt`; gleiches Panel ohne Leerlauf → kein erneuter Slew. Ereignis `plan_rebuilt`. Ein leerer Restplan beendet die Nacht erst nach `sessionEndUtc`.
4. **Ausführung je Block (Muster Astro PM, überschriebenes `Execute`, ein Block je Aufruf):** vergangene/leere/nicht machbare Blöcke überspringen (Gründe `blockSkipReasons`) → Container setzt `Target` und injiziert Koordinaten (Zentrieren nach Drift, Trigger-Sets) → *Center and Rotate* bzw. *Center* mit Wiederholungsleiter (FA-NIN-10) → Trigger-Set *vor Zielwechsel* → Guiding → Einträge nach der Tabelle Eintrag → Aktion (`execution.md` §4.2: `wait`, `meridian_flip`, `autofocus_hint` sind nur Zeitmarken, NINAs Trigger entscheiden) → je Belichtung: Filter wechseln (FilterMatcher; nicht gefunden → Zeile überspringen, `filter_not_found`, nie mit falschem Filter), Auslesemodus per Name → Index (`readout_mode_not_found` → überspringen), Dither laut Plan, **Trigger aller Vorfahren-Container** (`RunTriggers`), interne Belichtung (`IExposureItem`, `GetEstimatedDuration`, per `AttachNewParent` am Container, damit NINAs Flip-Trigger die Zielkoordinaten findet), `RunTriggersAfter` → Trigger-Set *nach Zielwechsel*. Eine Belichtung beginnt nur, wenn Belichtung + Download bis Blockende passen.
5. **Meldungen:** Das interne Belichtungselement erzeugt vor der Belichtung die Aufnahme-ID (UUID v7) und kennt Session, Plan, Block, Zeile, Beobachtung und Bonus. Bildpipeline: `CaptureImage` → Eintrag in NINAs **Bildhistorie** (`ImageHistoryVM.Add`, damit „Autofokus nach n Belichtungen“ und HFR-Trigger zählen) → `PrepareImage` → Statistiken → Ziel-Metadaten → `Enqueue`. Nach `CaptureImage` wird `MetaData.Image.Id` (NINA-int) → Aufnahme-ID **vor** `ImageSaveMediator.Enqueue` registriert; `ImageSaved` → `saved` mit Dateiname; ohne `ImageSaved` binnen 120 s → `failed` + Ereignis `warning`; Abbruch → `aborted`. Lokal gezählt (Offline, Flats) wird erst nach `saved`. Nicht zuordenbare Bilder → `unassigned`. Optionale NINA-Statistiken als `metrics`.
6. **Meridian-Flip:** Der Flip läuft über NINAs Meridian-Flip-Trigger. `SequenceInspector` prüft, ob der Trigger vorhanden ist, und liest die Werte aus dem **aktiven NINA-Profil**; Abweichungen zu den Rig-Werten → `flip_settings_mismatch`. **Erkennung:** Pier-Seite **vor** dem Trigger-Lauf merken und direkt **danach** vergleichen (NINAs Flip-Trigger läuft innerhalb von `RunTriggers`; Dauer = Laufzeit dieses Aufrufs; Abweichung zum Plan bis ±1 Belichtung zulässig, darüber Neuplanung). Ohne Pier-Seite dient der Vorzeichenwechsel des Stundenwinkels als Ersatz. Nach dem Flip mit Rotator erneut *Center and Rotate*, ohne Rotator Winkelprüfung modulo 180° (`rotation_mismatch`); Ereignis `flip`; jede Aufnahme meldet `pierSide` und `rotatorMechDeg` (ohne Rotator 0).
7. **Playback:** *zeitgeführt* – nächster Eintrag mit `atUtc ≤ jetzt + Verzug`, wobei der Verzug **alle** Nicht-Belichtungsaktionen kumuliert (Flip, Autofokus, Zentrieren inkl. Wiederholungen, Dither, Download); mehr als 3 übersprungene Belichtungen je Block → Neuplanung; *sequenziell* – strikt nächster Eintrag; beide enden am Blockende (Überhang nur bei gleichem Panel und Filter im Folgeblock).
8. **Transit (`execution.md` §5):** im **selben Container** als Block `kind: transit` (kein eigener Container). Vorlauf: Fensterbeginn aus dem Plan (zusätzlich `targets`, in der letzten Stunde alle 5 min abgerufen); vor jeder Belichtung prüfen, ob sie vor `Fensterbeginn − Slew − 60 s` endet; eine laufende, zu lange Belichtung wird über den **eigenen Abbruch-Token** beendet (`aborted`, OP-12). Filter und Auslesemodus werden **einmal vor der Serie** gesetzt; `expose_series` belichtet bis Fensterende, unabhängig von der Anzahl, ohne Dither und weiteren Filterwechsel. Die Trigger-Filterung läuft über `GetTriggersSnapshot()` je Vorfahren-Container (Typ-Allowlist), weil `RunTriggers` alles-oder-nichts ist: Autofokus-Trigger und *Zentrieren nach Drift* nur wenn erlaubt (FA-EXO-20), Meridian-Flip immer; eigene Trigger-Sets mit Autofokus-Anweisungen werden übersprungen; unterdrückte Trigger → `trigger_suppressed`. Danach `transit_end` und Neuplanung.
9. **Unterbrechung/Neustart:** Plan, Blockindex und `tonight` aus `ninapm.db`; Wiederaufnahme mit derselben Session (`reason: resume`, eigene Lease wird erneuert); neue Nacht → neuer Plan.
10. **Session, Lease, Heartbeat (5.6):** Heartbeat im Hintergrund alle 60 s, auch außerhalb der Sequenz; Zustandsmaschine mit vollständigen Übergängen (`execution.md` §6), inkl. „3 Heartbeats ohne Antwort → Lease verloren“ und Rückkehr nach `reacquiring`; `leaseLost` → Belichtung zu Ende, keine neuen Blöcke; Offline-Modus meldet einmal `state: offline`, friert die Lease ein und wird durch eine Admin-Freigabe beendet. **Gesperrte Zustände** (`blockedReasons`: `lease_lost`, `rig_busy`, `token_invalid`, `engine_incompatible`, `clock_skew`, `plan_failed`, `tenant_locked`) warten 60 s je Aufruf statt sofort zurückzukehren und haben je Grund eine eigene Austrittsregel (`execution.md` §2). Auch nicht behebbare Gründe beenden **zuerst** die laufende Belichtung und den Block (`block_end`) und setzen die Nachtschleife erst im nächsten Aufruf ohne laufenden Block auf falsch (NIN5-2).
11. **Live-Status und Bedienung (FA-NIN-13):** aktueller Befehl, Ziel/Panel, Filter, Belichtungsnummer, Blockliste, Nachtgrafik, Planprotokoll; *Zurücksetzen* und *Block überspringen*; Log-Zeilen im Format `NINA-PM | EVENT key=value …` (FA-NIN-19, maschinell auswertbar für die Testprotokolle); Standortprüfung (FA-NIN-03).
12. **Ende – Flat-Handling (R5, Muster Astro PM mit mechanischem Winkel, `execution.md` §7):** Guiding stoppen, Boxen an einen Container ohne Parent hängen (keine Sequenz-Trigger während der Flats), Fortschritt rekursiv zurücksetzen → Box *Vor Flats* einmal → `FlatTracker` bildet die Kombinationsliste (Filter + **mechanischer** Rotatorwinkel + Gain + Offset + Binning + Auslesemodus; gleiche Kombinationen mehrerer Ziele nur einmal; Winkel **geclustert** mit halber Rotationstoleranz, Repräsentant = Median; bei vollständigem Flat-Satz je Winkel alle Filter; Dark-Flats je (Belichtungszeit, Gain, Offset, Binning, Auslesemodus) **einmal je Nacht**, unabhängig vom Winkel) → je Kombination Rotator auf den Median-Winkel drehen, Filter (FilterMatcher) und Auslesemodus (`SetReadoutModeForNormalImages`) setzen, Kameraparameter in die Kind-Anweisungen der Box *Je Kombination* schreiben (z. B. *Trained Flat Exposure*, danach *Trained Dark Exposure*) und ausführen → Box *Nach Flats* einmal → Dateien geteilter Kombinationen vom Primärziel (erstes Ziel) in die Ordner der übrigen Ziele kopieren (Kopien nicht melden) → jede Aufnahme einmal als `capture` mit `frameType`, `projectIds`, eingefrorenem `rotatorMechDeg` und `flatsPlanned`/`darkFlatsPlanned` melden → `PATCH /sessions/{id} {status: completed, endedAtUtc, outboxPending, ninaConditions}` **sofort**, auch bei nicht leerer Outbox (NIN5-7) → die Nachtschleife bleibt bis `sessionEndUtc` wahr und wird **erst im nächsten Aufruf ohne laufenden Block** falsch (NIN5-12, `execution.md` §2; gleiche Reihenfolge in FA-NIN-06 und P-22). Status und Anzahl je Kombination stehen in `flat_combination_local`; ein Neustart setzt bei der ersten nicht erledigten Kombination mit den **fehlenden** Aufnahmen fort.

**Outbox-Regeln:** FIFO je Session (Session zuerst, dann Aufnahmen/Ereignisse); `2xx` → gesendet (14 Tage Historie); `408/429/5xx`/Netz → Wiederholung mit Backoff; `409 session.unknown` → Session erneut senden; `409 session.rig_busy` beim Nachmelden einer Offline-Session → mit `offline: true` erneut senden (nie Dead-Letter-Schleife); `401` → Senden anhalten, Fehlermeldung; übrige `4xx` → lokaler Dead-Letter (Anzeige im Plugin und Anzahl im Heartbeat), Warteschlange läuft weiter. „Erneut hochladen ab Datum“ sendet die Historie nach einem Server-Restore erneut (idempotent).

### 10.4 Offline

- Cache (in `ninapm.db`) enthält Bootstrap, Targets, letzten Plan; online höchstens 7 Tage alt verwendbar, im Offline-Modus unbegrenzt; Offline-Modus plant ausschließlich daraus (Jint).
- Outbox zählt lokale Aufnahmen gegen den Cache-Restbedarf (Folgenacht korrekt) und lädt nach, sobald online; der Server übernimmt Meldungen auch zu inzwischen gelöschten Objekten (Status `archived`, 6.6).
- Offline-Planung nutzt die im Bootstrap gelieferten Zeitzonen-Übergänge und Nacht-Schlüssel (60 Nächte).
- Einschalten des Offline-Modus (FA-NIN-04) sendet, sofern erreichbar, einen letzten Heartbeat `state: offline` → keine Alarme, Lease eingefroren (5.6); Rückkehr → `offline_end`, Outbox nachsenden.

---

## 11. Frontend (React + TypeScript)

### 11.1 Technologie

| Thema | Wahl |
|---|---|
| Build | Vite, `base: '/'`, Code-Splitting je Bereich (Sternkarte, Simulator, Exoplaneten lazy) |
| UI | React 19, TypeScript strict |
| Routing | React Router (Data Router), Routen nach Bildschirmkonzept S-xx |
| Server-State | TanStack Query (Cache, Retry; 401 → gemeinsamer Single-Flight-Refresh, 5.3) |
| Formulare | react-hook-form + zod-Resolver (Schemas aus `packages/shared`) |
| Tabellen | TanStack Table (Sortierung, Spaltenauswahl, virtuelles Scrollen für Protokolle) |
| Barrierefreie Primitive | Radix UI (Dialog, Menü, Tabs, Tooltip, Select) – ungestylt, mit eigenen CSS Modules |
| Styling | CSS Modules + Design-Tokens `--npm-*` aus `packages/ui-tokens` (Kopie nach Vorbild svenesis.org) |
| i18n | react-i18next, Namespaces je Bereich, DE Standard, EN |
| Diagramme | eigene Canvas-Komponenten (portiert aus den Astro-Tools: Nacht-Streifen, Höhenkurven, Saison, Astro-Wetter), uPlot für einfache Zeitreihen |
| Sternkarte | neues TS-Modul nach Vorlage `sky-map.js` (Kopie, 8.4) mit Layern für Bildfeld, Mosaik, Projekte |
| Engine im Browser | Web Worker + Comlink, gleiche `packages/engine` |
| Datum/Zeit | `Intl` + `@js-temporal/polyfill` bzw. date-fns-tz für Standortzeit-Anzeige |
| Tests | Vitest + Testing Library, Playwright E2E |

### 11.2 Struktur

```
apps/web/src/
├─ app/                 # Router, Providers (Query, i18n, Theme, Auth), Fehlergrenzen
├─ layout/              # SvenesisHeader, SvenesisFooter, AppBar, SideNav, Breadcrumbs
├─ auth/                # Login, Mandantenauswahl, Kein Zugang, Einladung, useAuth, useCan
├─ legal/               # Datenschutz NINA-PM, Quellen & Lizenzen (Katalog, Open-Meteo, CDS, OpenNGC …)
├─ features/
│  ├─ tonight/          # S-02
│  ├─ equipment/        # S-10 … S-15
│  ├─ planning/         # S-20 Sternkarte, S-21 Objektbrowser, S-22 Exoplaneten
│  ├─ projects/         # S-30 … S-34 (Liste, Editor, Meine Objekte, Warteschlange, Entwürfe)
│  ├─ nina/             # S-40 Simulator, S-41 Auslieferung, S-42 Instanzen
│  ├─ weather/          # S-50
│  ├─ evaluation/       # S-60 … S-64
│  ├─ admin/            # S-70 … S-73
│  └─ system/           # S-80 … S-82
├─ components/          # FilterChip, ProgressBar, NightTimeline, SeasonChart, WeatherChart,
│                       # CoordinateInput, RigSelect, StatusBadge, CheckList, DataTable, Card, Note
├─ api/                 # generierter Client (openapi-typescript + fetch-Wrapper mit CSRF-Header)
├─ workers/engine.worker.ts
└─ styles/              # global.css (Reset, Tokens-Import, Themes)
```

### 11.3 Gestaltung nach Vorbild www.svenesis.org

NINA-PM ist eine **eigenständige Anwendung** unter `nina-pm.svenesis.org`. Sie lädt zur Laufzeit **keine** Dateien von www.svenesis.org (kein `style.css`, `main.js`, `cookie-consent.js`), sieht aber aus wie die Website. Vorlage ist der Website-Ordner (`css/style.css`, Seitenvorlage in `CLAUDE.md`, Kopf/Fuß der Astro-Tools-Seiten).

#### Design-Tokens (Kopie in `packages/ui-tokens`)

| Token (NINA-PM) | Wert | Vorbild in `style.css` |
|---|---|---|
| `--npm-primary` | `#1a2a3a` | `--primary` (Kopf, Fuß, H1, Primär-Button) |
| `--npm-primary-light` | `#2c3e50` | `--primary-light` |
| `--npm-accent` | `#3498db` | `--accent` (Links, aktive Umschalter, Hinweis-Randlinie) |
| `--npm-accent-hover` | `#2980b9` | `--accent-hover` |
| `--npm-text` / `--npm-text-light` | `#333` / `#666` | `--text` / `--text-light` |
| `--npm-bg` / `--npm-white` | `#f8f9fa` / `#fff` | `--bg` / `--white` |
| `--npm-border` | `#e0e0e0` | `--border` |
| `--npm-radius` | `8px` | `--radius` |
| `--npm-shadow` | `0 2px 12px rgba(0,0,0,.08)` | `--shadow` |
| `--npm-max-width` | `1100px` | `--max-width` (Textseiten) |
| `--npm-transition` | `.25s ease` | `--transition` |
| `--npm-font` | `-apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` | Body-Schrift |
| Typografie | 16 px Basis; H1 32/700 in Primärfarbe; H2 20/700; H3 16,8/700; Label 12,8 px `#666`; Felder 15,2 px, Padding 7,2/8 px; Buttons Padding 8/12,8 px | gemessen auf *Astro-Wetter* |
| Karten / Hinweise | weiß, Radius 8, Schatten `--npm-shadow`, Innenabstand 32 px; Hinweis: Hintergrund `rgba(26,42,58,.05)`, 4 px Randlinie links in Akzentfarbe | `.card`, `.note` |
| Abstandsskala (UI-4) | `--npm-space-1` 4 px · `-2` 8 px · `-3` 12 px · `-4` 16 px · `-5` 24 px · `-6` 32 px · `-7` 48 px, jeweils mit `--npm-space-scale` des Dichte-Schalters multipliziert (`calc(4px * var(--npm-space-scale))` usw.). Abstände **nur** über diese Tokens, keine freien px-Werte in CSS Modules (ESLint/stylelint-Regel) | aus den gemessenen Werten der Website abgeleitet |
| Symbole (UI-4) | **Lucide** (MIT) als React-Komponenten, Strichstärke 2, Größen 16/20/24 px; **kein Emoji in der Oberfläche** (plattformabhängige Darstellung – die Skizze in FK 14.1 benutzt Emoji nur als Platzhalter). Die Symbolnamen je Navigationspunkt und Aktion stehen in `specs/ui/components.md` §3 | – |
| Breite und Breakpoints | **Arbeitsseiten ohne Obergrenze** (volle Fensterbreite, kein `max-width`, kein zentrierter Container); Textseiten auf `--npm-max-width` (1100 px). Breakpoints steuern nur die **Anordnung**: 768 px (Tablet, ein Spaltenstapel), 1280 px (Laptop, drei Spalten), 1600 px (Desktop, zusätzliche Tabellenspalten und breitere Diagramme) – darüber wächst der Inhalt einfach mit. **Verbindliche Mindestbreite (UI-1):** Arbeitsseiten **768 px**, Textseiten und Kopf/Fuß **600 px** – jeweils ohne horizontales Scrollen; das ist das Abnahmekriterium in `rules/ui.md` und in jedem Brief. 360 px wird **nicht** unterstützt (NFA-01) | – |
| Dichte-Schalter | Drei Stufen `compact` / `normal` / `wide` als `data-density` am `<html>`-Element, umschaltbar in der App-Fußleiste (bei Astro PM heißt das Tablet/Laptop/Desktop). Er ändert **nur** Dichtewerte, nie die Breite: `--npm-row-h` 28/34/40 px · `--npm-font-scale` 0,9/1,0/1,05 · `--npm-space-scale` 0,75/1,0/1,25 (multipliziert die Abstandsskala) · Diagrammhöhe 140/180/240 px. Wahl in `user_preference`, Sofortwert `npm.density` im `localStorage` | Astro-PM-Umschalter, sinngemäß |

Die Werte werden einmalig übernommen und im Kommentar mit Quelle und Datum versehen; spätere Farbänderungen an der Website werden bewusst nachgezogen.

#### Kopf- und Fußzeile

- **`SvenesisHeader`** (React): dunkelblaue Leiste (64 px, Schatten wie Website) mit Logo „Svenesis.org“ (eigene Kopie von `img/logo.svg`) als Link auf `https://www.svenesis.org/`, rechts daneben der Anwendungsname **„NINA-PM“**; Menü mit den Hauptpunkten der Website als externe Links (Startseite, Über mich, Technologien, Finanzen, Astronomie, Blog – Ziele `https://www.svenesis.org/…_de|en.html`), DE/EN-Umschalter der Anwendung. Menüstruktur als Konfiguration `site-nav.ts` (einmalig aus der Website-Vorlage übernommen).
- **App-Leiste** direkt darunter: Mandant (Wechsel), Benachrichtigungen, Theme, Benutzer mit Discord-Avatar.
- **App-Fußleiste** über dem Svenesis-Fuß: **Dichte-Schalter** *kompakt | normal | weit*, Standortzeit, Versionen (App/Engine), Hilfe (Fachkonzept 14.1).
- **`SvenesisFooter`**: Navy, „© 2026 Sven Ramuschkat – Svenesis.org“, Links *Kontakt & Impressum* (Website), *Datenschutz NINA-PM* (eigene Seite der App), *Quellen & Lizenzen* (App).
- **Breadcrumb** wie Website: *Svenesis.org › Astronomie › NINA-PM › …*.

#### Cookies, Speicher, Datenschutz

- NINA-PM setzt nur **technisch notwendige Cookies** (Anmeldung, Host `nina-pm.svenesis.org`) und lädt keine Analyse- oder Werbeskripte → kein Cookie-Banner nötig; Hinweis in der eigenen Datenschutzerklärung.
- Himmelsfotos von CDS (HiPS) werden wie im Beobachtungsplaner erst beim Zoomen geladen, mit Hinweis und Abschalter an der Karte.
- **Eigene Datenschutzerklärung** unter `https://nina-pm.svenesis.org/datenschutz` (DE/EN): Discord (USA), AWS, serverseitige Abrufe (Open-Meteo, CDS, ExoClock, NASA, ExoFOP), CDS-Bildkacheln im Browser, Anmelde-Cookies, Speicherdauer (OT-15).
- Browser-Speicher: eigener Origin, daher unabhängig von den `localStorage`-Regeln der Website. Trotzdem gilt: Einstellungen in `user_preference` (DB, geräteübergreifend); im Browser nur `npm.lang` und flüchtiger UI-Zustand (`sessionStorage`).

#### Arbeitsbereich und Themes

- **Textseiten** (Login, Mandantenauswahl, Einladung, Kein Zugang, Datenschutz, Quellen) im Container `max-width: var(--npm-max-width)` mit Karten und Hinweisboxen – Anmutung wie *Astro-Wetter*. Sie sind die **einzige** Ausnahme von der vollen Fensterbreite.
- **Datenintensive Seiten** (Projektliste, Editor, Simulator, Exoplaneten, Sternkarte, Auswertung) nutzen die **volle Fensterbreite ohne Obergrenze** – kein `max-width`, kein zentrierter Container; die linke App-Navigation ist einklappbar. Der gewonnene Platz geht in mehr Spalten (Tabellen), breitere Diagramme und nebeneinander statt untereinander liegende Bereiche. Nur die Textseiten bleiben auf `--npm-max-width` (1100 px) begrenzt, weil Lesetext bei 2000 px unlesbar wird.
- **Themes (verbindlich, zwei Stück):** `light` (Standard, wie Website) und `dark` (Navy-Basis). Umschaltung über `data-theme` am `<html>`-Element; die Wahl liegt in `user_preference` (geräteübergreifend) mit `npm.theme` im `localStorage` als Sofortwert gegen das Aufblitzen beim Laden. Kopf und Fuß passen sich in beiden Modi an. **Einen Rotlicht-Modus gibt es nicht** (Entscheidung 17.09.2026): der Dunkelmodus genügt am Teleskop, und eine dritte Farbwelt müsste in jedem Bildschirm, jedem Diagramm und jedem Baustein mitgepflegt und geprüft werden.
  - **Prüfung:** ein Komponententest liest je Theme die berechneten Farben der Bausteine aus und vergleicht sie mit der Token-Tabelle.
- **Diagramm-Farbwelt** aus den Astro-Tools: Himmel nach Sonnenhöhe, astronomische Dunkelheit grün, Mond rot, 30°-Linie gestrichelt, Meridian violett.

### 11.4 Auth und Rechte im Frontend

- `AuthProvider` lädt `GET /api/auth/me` (Identität, Kontext, Mitgliedschaften, Rolle, Mandant).
- `RequireAuth`, `RequireContext('tenant'|'system')`, `useCan(action, resource)`; nicht erlaubte Aktionen deaktiviert mit Tooltip.
- Fetch-Wrapper: Basis `/api` (gleicher Origin), `credentials: 'same-origin'`, Header `X-NPM-Request: 1` (die Herkunftsprüfung der API stützt sich zusätzlich auf `Sec-Fetch-Site`, das der Browser selbst setzt, 5.3); bei `401 auth.token_expired`/`auth.token_stale` genau ein gemeinsamer `POST /api/auth/refresh` (tabübergreifend per `navigator.locks`), danach Wiederholung.
- **Neues Deployment:** Tritt beim Nachladen eines Code-Teils ein `ChunkLoadError` auf, lädt die App einmal neu (alte Chunks bleiben ohnehin 30 Tage verfügbar, 4.1).
- **Berichte (FA-AUS-18):** eigene Druckansicht mit Print-CSS (`@media print`, Seitenumbrüche je Projekt); „Als PDF speichern“ über den Druckdialog des Browsers. CSV-Export über die API.

---

## 12. Dateien und S3

| Zweck | Schlüssel | Ablauf |
|---|---|---|
| Vorschaubild Projekt | Katalogobjekt: kopierte Katalogbilder `https://nina-pm.svenesis.org/catalog/img/ngc/<id>.jpg` (128 px), `…/catalog/img/ngc-l/` bzw. `…/catalog/img/dso/` (320 px); freie Koordinaten/Mosaik/Rig-Bildfeld: Web-Bucket `catalog/thumbs/<sha256(ra,dec,fov,rotation,survey)>.jpg` | Job `thumbnail` holt Ausschnitt über CDS hips2fits und speichert JPEG; Himmelsausschnitte sind nicht mandantenbezogen → über CloudFront cachebar, kein presigned GET. **Akzeptiertes Restrisiko (SEC-28):** Die Dateien sind ohne Anmeldung abrufbar; wer Koordinaten und Bildfeld errät, kann daraus schließen, dass **irgendwer** genau diesen Ausschnitt geplant hat (Mandant, Projekt und Person bleiben verborgen). Das steht so in der Datenschutzerklärung. Wer es nicht will, salzt den Schlüssel mit einem serverseitigen Geheimnis (`sha256(secret‖params)`) – der Cache bleibt dabei erhalten |
| Transit-Ergebnis (HOPS/EXOTIC) | `tenant/<tid>/results/<observationId>/<uuid>-<name>` | `POST /files/upload-url` → **presigned POST** (5 min, `conditions: [["content-length-range", 1, 20971520], ["eq", "$Content-Type", …], ["starts-with", "$key", "tenant/<tid>/results/"]]`) → `POST /transit-observations/{id}/results {key}` → Job prüft `GetObjectAttributes` und parst dann |
| Lichtkurven-Grafik | `…/results/<observationId>/<uuid>.png` | wie oben |
| Exporte (Mandant, CSV) | `tenant/<tid>/exports/<uuid>.<ext>` | Job `export`, Download-Link 15 min, Lifecycle 7 Tage |
| Mandanten-Import | `tenant/<tid>/imports/<uuid>.json` | **presigned POST** (`content-length-range` 1 … 52428800) → Job `import` streamend und in Stapeln (Strukturgrenzen 7.1), Lifecycle 7 Tage |
| Planprotokolle | `tenant/<tid>/plans/<nightPlanId>.json.gz` | **presigned POST** (`content-length-range` 1 … 5242880) aus `POST /sessions` bzw. vom Server bei `POST /plan`; Lifecycle 400 Tage |
| Job-Ergebnisse (Mehrnacht, Auswirkungsvorschau) | `tenant/<tid>/jobs/<jobId>.json` | Status in Tabelle `job` (7.4), Ergebnis per presigned GET; Lifecycle 2 Tage |
| Beispielsequenzen | Web-Bucket `downloads/nina-sequences/<pluginVersion>/*.json` | Upload durch `plugin.yml` (OIDC-Rolle), vom SPA-Deployment ausgenommen |

- Upload-URLs prüfen Zweck, Rolle (`can`) und Mandant; Schlüssel werden serverseitig vergeben (keine Pfade vom Client).
- **Warum presigned POST und nicht PUT (verbindlich, SEC-23):** Bei einer vorsignierten **PUT**-URL wirken nur die mitsignierten Header; die Größe ist damit nur erzwingbar, wenn der Client sie vorab nennt. Ein Client könnte sonst beliebig viel in den Bucket schreiben, und erst danach würde eine Lambda die Datei parsen. **presigned POST** trägt die Bedingung `content-length-range` in der Politik und lehnt zu große Uploads direkt in S3 ab. Zusätzlich prüft jeder verarbeitende Job vor dem Parsen `GetObjectAttributes` (Größe, `Content-Type`) und löscht den Schlüssel bei Abweichung, bevor er abbricht.
- Kein öffentlicher Bucket-Zugriff; `web`-Bucket nur via OAC.
- Presigned URLs zeigen auf `https://svenesis-nina-pm-data.s3.eu-central-1.amazonaws.com` → dieser Host steht in der CSP (`img-src`, `connect-src`, 15) und in der CORS-Konfiguration des Daten-Buckets (nur Origin der Anwendung, Methoden GET/PUT).

---

## 13. Hintergrund-Jobs

Eine Lambda **`worker`** mit Dispatcher. Vier Zeitpläne (EventBridge Scheduler, UTC) rufen sie mit `{tick}` auf; ereignisgetriebene Arbeit kommt über die Tabelle `job` (7.4). Alle Aufgaben sind idempotent, arbeiten in Stapeln ≤ 2.500 Zeilen je Transaktion und schreiben Logs/Metriken mit `task`.

| Zeitplan | Aufgaben | Anforderungen |
|---|---|---|
| `tick-5min` | liegengebliebene Jobs übernehmen (7.4) · befristete Admin-Rechte ablaufen lassen (`role='user'`, `member_version`+1, Änderungsprotokoll, Hinweis) und 24 h vorher benachrichtigen · verfallene Owner-Übertragungen zurücksetzen · Exoplaneten-Fristen (Einreichungen verfallen lassen, Beobachtung → `cancelled`; Frist-Hinweise) · `transit_observation` `locked` nach Fensterende → `observed`/`missed` · Rig-Leases in `rig_lease` ablaufen lassen (außer `offline_until` in der Zukunft; abgelaufener Offline-Modus > 14 Tage wird beendet) · **verwaiste Sessions** → `stale` (laufend ohne Heartbeat > 10 min bei `offline_since IS NULL`; bzw. nicht beendet 2 h nach Nachtende; Zeitschwellen FK 8.1, Spalten DAT5-3) · fällige `session_close`/`session_report` starten, wenn `outbox_pending = 0` oder `ended_at + 6 h` erreicht ist + Job `session_close` + Alarm `session.no_heartbeat` · Metrik `StaleRunningSessions` · verfallene Owner-Einladungen → Hinweis an Super User (`owner_state = 'pending'`) · liegengebliebene Discord-Zustellungen (`discord_post`) | FA-BEN-03, FA-BEN-07, FA-BEN-09, FA-FRG-09, FA-EXO-21, FA-RIG-06, FA-SYN-07, FA-AUS-05, FA-FRG-11, FA-DIS-05 |
| `tick-hourly` | Wetter für Standorte aktiver Mandanten → `weather_cache` · fehlende Vorschaubilder → Jobs `thumbnail` | FA-WET-07, FA-AUS-17, FA-PRJ-02 |
| `daily` 03:00 | Aufräumen (abgelaufene Einladungen/Anmeldesitzungen, alte Jobs > 30 Tage, `night_plan(origin='forecast_job')` > 7 Tage, `login_audit` > 12 Monate) · Zähler-Abgleich aus `capture`/`correction` inkl. Suche nach verwaisten Zeilen · Mehrnacht-Prognose je Rig (14 Nächte) → `night_plan(origin='forecast_job')` · Aufwand-Jobs für eingereichte und aktive Projekte (`effort_stale` oder älter als 7 Tage, höchstens 200 je Tag) · ExoClock-Katalog | NFA-07, 6.6, FA-FOL-01…05, FA-PRJ-23, FA-EXO-02/04 |
| `weekly` So 04:30 | NASA Exoplanet Archive (TAP, `pscomppars`) und TESS TOI als Datei-Download, Amateur-Vorfilter, **Zeitsystem je Epoche normalisieren** (`transit.md` §1), Upsert in Stapeln · alte SPA-Build-Präfixe in `assets/` löschen (letzte 3 behalten, DAT-4): der **aktuelle** `buildId` steht im SSM-Parameter `/nina-pm/web/build-id` (beim Deploy von `NinaPm-Edge` geschrieben); der Job liest ihn, ermittelt über `ListObjectsV2` mit Delimiter `/` alle `assets/<buildId>/`-Präfixe, sortiert sie nach dem jüngsten `LastModified` und behält den aktuellen plus die zwei jüngsten übrigen (DAT5-6). Ohne lesbaren Parameter bricht der Job ab, ohne zu löschen · verwaiste CI-DSQL-Cluster (`purpose=ci`) löschen | FA-EXO-02/31, NFA-07 |
| manuell | Objektkatalog aus `packages/catalog-data` → `dso_object` (`POST /system/v1/catalogs/dso/refresh`) | FA-FRM-01 |

- **Ereignisgetrieben statt Abfrage:** Das `PATCH` mit `status: completed` legt die Jobs `session_close`, `session_report` und `effort` an, sie laufen aber **erst** bei `outbox_pending = 0` oder 6 h nach `ended_at` (NIN5-7); bis dahin bleiben sie `pending` und `tick-5min` prüft die Bedingung. Der Nachtbericht wird spätestens `tick-5min` nach `report_due_at` gesendet (Vermerk „vorläufig“); spätere Meldungen lösen eine Nachrechnung aus.
- **Fehlerbehandlung:** `EventInvokeConfig` der `worker`-Lambda mit 0 Wiederholungen und `onFailure` → SQS `worker-failures`; Alarm auf Lambda-`Errors` und Nachrichten in `worker-failures` (16.2). Kataloge behalten bei Abruffehlern den letzten Stand; Alarm erst nach 3 fehlgeschlagenen Tagen.

---

## 14. Externe Dienste

| Dienst | Nutzung | Aufruf | Cache / Limit | Hinweis |
|---|---|---|---|---|
| Discord OAuth2 / API | Anmeldung, Benutzerdaten; ausgehende Webhooks je Mandanten-Kanal (7.7) und System-Alarm-Webhook | `discord.com/oauth2/authorize`, `/api/oauth2/token`, `/api/users/@me` | Rate-Limit-Header beachten | Datenschutzhinweis; Ausfall → FA-LOG-09 |
| Open-Meteo | Wetter (ICON/GFS/HRRR/ECMWF), CAMS-Aerosol | serverseitig (Job) | 60 min je Standort | Lizenz CC BY 4.0; kommerzielle Nutzung erfordert API-Plan (→ OT-05) |
| CDS HiPS | Himmelsfotos in der Sternkarte | direkt aus dem Browser, erst beim Zoomen, mit Hinweis und Abschalter (11.3) | Browser-Cache | Datenschutzhinweis (IP an CDS) |
| CDS hips2fits | Vorschaubilder, Sternfeld Exoplaneten | serverseitig (Job) | S3 | – |
| SIMBAD (TAP/Sesame) | Namensauflösung unbekannter Objekte | serverseitig | Ergebnis in `dso_object` übernehmen | – |
| ExoClock | Katalog | serverseitig (Job) | DB | Nutzungsbedingungen prüfen (OP-13) |
| NASA Exoplanet Archive (TAP) | Katalog | serverseitig (Job) | DB | – |
| ExoFOP (TOI) | Katalog/Links | serverseitig (Job) | DB | – |

Alle ausgehenden Aufrufe über einen gemeinsamen `httpClient` mit Timeout je Quelle (Standard 10 s; NASA TAP 120 s; ExoClock und hips2fits 60 s), Retry (2×, exponentiell), User-Agent `Svenesis-NINA-PM/<version> (+https://nina-pm.svenesis.org)`.

---

## 15. Sicherheit

| Bereich | Maßnahme |
|---|---|
| Transport | nur HTTPS; HSTS über CloudFront-Response-Headers-Policy |
| Header | Zwei Response-Headers-Policies auf **allen vier** CloudFront-Behaviors (4.3, Wortlaut in `specs/infra/iam.md` §10). CSP der Anwendung: `default-src 'self'`; `script-src 'self'`; **`style-src 'self' 'unsafe-inline'`** (Pflicht: Radix UI positioniert Popover, Dialog, Menü und Tooltip über Inline-`style`-Attribute – ohne `'unsafe-inline'` in `style-src` bricht die Oberfläche beim ersten Popover, und zwar erst in prod, SEC-2; für **Skripte** bleibt `'unsafe-inline'` verboten); `img-src 'self' data:` + CDS, Discord-CDN und Daten-Bucket; `connect-src 'self'` + CDS und Daten-Bucket; `worker-src 'self' blob:` (Comlink-Worker); `font-src 'self'`; `object-src 'none'`; **`base-uri 'none'`**, **`form-action 'self'`** (beide erben **nicht** von `default-src` und müssen einzeln dastehen, SEC-25); `frame-src 'none'`; `frame-ancestors 'none'`; `upgrade-insecure-requests`. Dazu HSTS (2 Jahre, `includeSubDomains`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`. Abnahme: Playwright-Test öffnet Radix-Menü und -Dialog hinter den produktiven Headern und prüft die Konsole auf CSP-Verstöße |
| Anmeldung | Discord-OAuth mit `state`, signiertes Zwischen-Cookie, keine Speicherung des Discord-Tokens; Refresh-Rotation mit 60-s-Karenz und Wiederverwendungserkennung; System-Kontext max. 12 h |
| Sitzungen | HttpOnly/Secure/SameSite-Cookies, `__Host-`-Präfix, Inaktivitäts-Timeout, „überall abmelden“ (wirkt über `sid`-Prüfung nach ≤ 60 s) |
| CSRF | SameSite + Pflicht-Header `X-NPM-Request: 1` **und** Prüfung von `Origin` bzw. `Sec-Fetch-Site: same-origin` bei schreibenden Methoden (fehlt beides → `403 auth.origin_invalid`, SEC-26); keine CORS-Freigaben (gleicher Origin) |
| API-Zugriff | nur über CloudFront (`X-Origin-Verify`, in Middleware geprüft), Drosselung global und je Route (`/api/nina/v1`, `/api/auth/*`, `/api/health` getrennt, 4.2) **plus Zählung je NINA-Instanz** (120 Aufrufe/min, sonst `429`; ohne sie teilen sich alle Rigs aller Mandanten die 20 rps, SEC-18), reservierte Parallelität auf `api` und `worker`, Validierung aller Eingaben (zod), Größenlimits (Body 1 MB, Batches 500) und Strukturgrenzen für Uploads (7.1, SEC-27) |
| Mandantentrennung | Repository-Guard, Lint-Regel, Isolationstests (6.7) |
| Berechtigungen | `can()` serverseitig je Route, generierte Rechte-Tests (5.5) |
| Geheimnisse | SSM SecureString mit **kundenverwaltetem Schlüssel `alias/nina-pm-ssm`** (einmalig per CLI angelegt); Lesezugriff **pfadgenau je Rolle** (`specs/infra/iam.md` §2/§3): `worker` erhält **keinen** Zugriff auf `/nina-pm/jwt/signing-keys`, `/nina-pm/discord/client-secret` und `/nina-pm/bootstrap-super-users` – mit dem JWT-Schlüssel könnte die Job-Lambda sonst beliebige Access-Tokens signieren und alle Rollen- und Mandantengrenzen umgehen (SEC-5). `kms:Decrypt` ist in beiden Rollen auf den Schlüssel begrenzt und mit `kms:ViaService = ssm…` bedingt (SEC-6). **Schreibzugriff** (`ssm:PutParameter`, `ssm:DeleteParameter`) nur für `api` und nur auf `/nina-pm/tenants/*/discord/*` (7.7); explizites `Deny` auf Schreibzugriff für `/nina-pm/jwt/*`, `/nina-pm/bootstrap-super-users` und `/nina-pm/origin-verify*` in allen Lambda-Rollen und in `NinaPmDeployBoundary` (SEC-21). Keine Geheimnisse im Frontend-Bundle; der Origin-Verify-Wert ist kein Geheimnis im engeren Sinn (steht in der Distribution-Konfiguration) |
| IAM | **Eine eigene Ausführungsrolle je Lambda**, ressourcengenau, vollständig in **`specs/infra/iam.md`**: `NinaPmApi`, `NinaPmWorker`, `NinaPmMigrate`, `NinaPmDbBootstrap`, `NinaPmOpsCli` plus `NinaPmOpsInvoker` (MFA), `NinaPmSchedulerInvoke`, `NinaPmGithubDeploy`/`NinaPmGithubCiDsql` und die Deploy-Grenze `NinaPmDeployBoundary`. Kernpunkte: `dsql:DbConnect` auf den Cluster-ARN begrenzt und **je Lambda eine eigene DB-Rolle** (`app_rw`/`app_job`/`app_migrate`, SEC-4/SEC-11) · `dsql:DbConnectAdmin` **nur** in der nicht automatisch laufenden Lambda `db-bootstrap` (SEC-1) · `lambda:InvokeFunction` von `api` **nur** auf `worker`, in `worker` ausdrücklich verweigert (SEC-7) · `sqs:SendMessage` nur auf `nina-pm-worker-failures` (SEC-8) · S3 nur `data/tenant/*` (ohne `Delete`/`List`) bzw. Web-Bucket `catalog/thumbs/*` für `worker`, plus `s3:ListBucket` mit Präfixbedingung `assets/` und `s3:DeleteObject` auf `assets/*` für den `weekly`-Aufräumjob (DAT5-6, SEC-14) · `NinaPmGithubDeploy` darf ausschließlich die CDK-Bootstrap-Rollen annehmen, die CloudFormation-Ausführungsrolle läuft mit `NinaPmDeployBoundary` statt `AdministratorAccess` (SEC-3) |
| NINA-Tokens | 256 Bit, gehasht, widerrufbar, an Rig gebunden; Anzeige nur einmal |
| Dateien | presigned URLs mit kurzer Laufzeit, Content-Type/Größe erzwungen, Dateinamen serverseitig |
| Protokollierung | keine Tokens/Cookies in Logs; IP gekürzt; Discord-ID als Pseudonym in Logs |
| Nachvollziehbarkeit | **CloudTrail `nina-pm-management`** für Verwaltungsereignisse (Ziel `data/audit/`, 400 Tage) mit Metrikfiltern und Alarmen auf `ops-cli`-/`db-bootstrap`-Aufrufe, `PutParameter` unter `/nina-pm/jwt/*` und `dsql:DeleteCluster` (SEC-19). Der `system_audit` der Anwendung endet dort, wo AWS-Zugriffe anfangen – der Trail schließt die Lücke. Log-Aufbewahrung `api`/`ops-cli` 400 Tage (passend zu `login_audit` mit 12 Monaten), übrige 90 Tage, alle Log-Gruppen mit `alias/nina-pm-ssm` verschlüsselt (SEC-30) |
| Sicherungen | Eigener Backup-Vault `nina-pm-prod` mit **Vault Lock** (Governance-Modus); `backup:DeleteRecoveryPoint` nur für `NinaPmOpsInvoker`, `backup:Delete*`/`DisableVaultLock` und `dsql:DeleteCluster` in `NinaPmDeployBoundary` verweigert – ein fehlgeleiteter Deploy kann Daten **und** Sicherungen nicht löschen (SEC-20) |
| Notfallzugang | `ops-cli` nur über `NinaPmOpsInvoker` (MFA, höchstens 1 h alt), ressourcenbasierte Politik mit genau diesem Principal; jeder Aufruf schreibt `system_audit` **und** meldet sich per SNS (SEC-9) |
| Abhängigkeiten | Renovate, `pnpm audit`/`npm audit` in CI, `dotnet list package --vulnerable` für das Plugin |
| Altlast Astro PM | Import (OP-20) übernimmt **keine** `RemoteConnections.Password`, Lizenz- oder Sync-Tokens |

---

## 16. Betrieb, Monitoring und Kosten

### 16.1 Logging und Tracing

- Powertools Logger (JSON) mit `requestId`, `tenantId`, `memberId`/`ninaInstanceId`, `route`, `durationMs`.
- Powertools Metrics mit wenigen Dimensionen (keine Mandanten-/Routen-Dimension, Kosten): `ApiErrors`, `CapturesIngested`, `CaptureDuplicates`, `DsqlRetries`, `JobDurationMs`, `JobFailures`, `StaleRunningSessions`, `ReportFailures`. Details stehen in den strukturierten Logs (Logs Insights).
- X-Ray mit Sampling 5 %; lokal nicht benötigt.
- **Log-Aufbewahrung (SEC-30):** `api` und `ops-cli` 400 Tage (passend zu `login_audit` mit 12 Monaten, 13), `worker`, `migrate` und `db-bootstrap` 90 Tage; alle Log-Gruppen mit `alias/nina-pm-ssm` verschlüsselt.
- **CloudTrail `nina-pm-management`** (SEC-19): Verwaltungsereignisse des Kontos nach `svenesis-nina-pm-data/audit/` (400 Tage). Metrikfilter + Alarm auf: `Invoke` von `nina-pm-ops-cli`/`nina-pm-db-bootstrap` · `PutParameter` unter `/nina-pm/jwt/*` oder `/nina-pm/bootstrap-super-users` · `dsql:DeleteCluster`, `backup:DisableVaultLock` (darf nie vorkommen). Zugriffsprotokoll der HTTP API im JSON-Format (`requestId`, `routeKey`, `status`, `integrationLatency`, gekürzte IP) – ohne es lässt sich ein Direktaufruf der `execute-api`-Adresse nicht messen.

### 16.2 Alarme (SNS → E-Mail)

| Alarm | Schwelle |
|---|---|
| API 5xx | > 1 % in 5 min |
| Lambda-Fehler `api` auf `/api/nina/v1` (Log-Metrik) | ≥ 3 in 10 min (nachts kritisch) |
| `worker`-Fehler bzw. Nachrichten in `worker-failures` | > 0 |
| Laufende Session ohne Heartbeat > 10 min bei `session.offline_since IS NULL` (`StaleRunningSessions`, Spalte DAT5-3) | > 0 (Pflicht) |
| Route-53-Health-Check `/api/health/shallow` (über CloudFront) | 3 Fehlschläge in Folge |
| DSQL-Wiederholungen | > 20 in 5 min |
| DSQL-Verbrauch (DPU-Metrik des Clusters) | über Monatsschwelle (Wert nach 4 Wochen Betrieb festlegen) |
| Notfallzugang benutzt (`ops-cli`/`db-bootstrap`, CloudTrail-Metrikfilter) | > 0 (Pflicht, SEC-9/SEC-19) |
| Schreibzugriff auf `/nina-pm/jwt/*` oder `/nina-pm/bootstrap-super-users` | > 0 (darf nie vorkommen) |
| `dsql:DeleteCluster` oder `backup:DisableVaultLock` | > 0 (darf nie vorkommen) |
| Gedrosselte NINA-Instanz (`NinaThrottled`) | > 0 über 15 min (SEC-18) |
| Lambda `Throttles` auf `api` (reservierte Parallelität erschöpft) | > 10 in 5 min (SEC-15) |
| Budget | > 20 €/Monat |

Alarme gehen per E-Mail und optional über einen System-Discord-Webhook (SSM `/nina-pm/system/alarm-webhook`, Zustellung durch `worker`).

### 16.3 Kostenschätzung (geringe Last, eu-central-1, grob)

| Posten | €/Monat |
|---|---|
| Aurora DSQL (Free Tier, danach DPU + Speicher < 1 GB) | 0 – 5 |
| Lambda (`api`, `worker`) + API Gateway (~200.000 Aufrufe/Monat: ~130.000 Route-53-Health-Checks, ~45.000 Plugin-Heartbeats je Rig, Rest Browser und Jobs) | 0 – 2 |
| S3 (inkl. ~130 MB Katalogbilder) + eigene CloudFront-Distribution | < 1 |
| CloudWatch Logs/Metriken/Alarme | 1 – 4 |
| EventBridge Scheduler (4 Zeitpläne) | < 0,5 |
| Route-53-Health-Check | ca. 0,5 – 1 |
| SSM Parameter Store (Standard) | 0 |
| KMS (kundenverwalteter Schlüssel `alias/nina-pm-ssm`) | ~1 |
| CloudTrail (erster Trail, nur Verwaltungsereignisse) + S3-Ablage | 0 – 1 |
| AWS Backup (DSQL) | < 1 |
| **Summe** | **ca. 4 – 14 €** |

Preise für eu-central-1 vor Go-live im AWS Pricing Calculator verifizieren (OT-01).

---

## 17. Teststrategie

| Ebene | Werkzeug | Inhalt | Wann |
|---|---|---|---|
| Engine-Unit | Vitest | Funktionen je Modul, Grenzfälle (Polarnacht, Mitternachtssonne, Zeitumstellung, Mond um Vollmond) | jeder Commit |
| Engine-Referenz | Vitest + Fixtures (Kap. 9); CI-Job `reference` erzeugt die Fixtures mit gebündelten IERS-Daten neu und prüft auf Unverändertheit | Genauigkeit gegen astropy | jeder Commit (Vergleich) / PR mit Änderungen in `tools/reference` (Neuerzeugung) |
| Engine-Determinismus | Vitest + Jint-Test (xUnit) | gleicher `outputHash` Node ↔ Jint für feste und ≥ 500 zufällige Eingaben; Lint gegen `Math.*`-Trigonometrie, `Date`, `Intl` | jeder Commit / Plugin-Build |
| Engine-Vergleich Astro PM | `tools/astropm-oracle` (.NET 8) + Vitest (`oracle.yml`) | TS-Engine im Kompatibilitätsmodus (Schalter §11.1, Adapter §11.2) gegen C#-Original: gleiche `SlotAssignment` und Belichtungsfolge für alle Soll-Plan-Grids und ≥ 500 Zufallsgrids | PR mit Änderungen in `packages/engine`, nightly |
| Engine-Soll-Pläne | Vitest + `contracts/golden-plans/` | Produktivmodus: Paint-Fälle (AP-13b) und Ablauf-Fälle (**AP-13d**) exakt; Eigenschaftstests (keine unsichere Mondbelichtung, Blockende, Fairness nach Neuplanung) | jeder Commit |
| Engine-Benchmark | Vitest bench | Laufzeit-Regression | nightly |
| Repository | Vitest + PostgreSQL 16 (Docker, `repeatable read`) | CRUD, Zähler (inkl. Bonus verworfen, je Transit-Beobachtung), Idempotenz, Stapel-Löschen, 3.000-Zeilen-Zähler, `FOR UPDATE`-Wächter | jeder Commit |
| Mandantenisolation | Vitest | jede Repository-Methode mit fremdem Mandanten | jeder Commit |
| Berechtigungen | Vitest (generiert aus Routen-Metadaten) | Route × {owner, admin, befristeter Admin, abgelaufener Admin, user, fremd, anonym}; Owner-Invarianten (5.5) | jeder Commit |
| API-Vertrag | Schemathesis oder zod-basierte Contract-Tests gegen `openapi.yaml` | Antwortformate, Fehlercodes | jeder Commit |
| DSQL-Integration | Vitest gegen **kurzlebigen CI-DSQL-Cluster** (`dsql-it.yml` im GitHub-Environment `ci` mit eigener OIDC-Rolle, H-22: Cluster per AWS CLI anlegen → Migrationen → Tests → Cluster löschen, auch bei Fehler) | Migrationen inkl. GRANTs, OCC-Retry, `SELECT … FOR UPDATE`, `INSERT … ON CONFLICT`, IAM-Token | PR mit Änderungen in `packages/db`, wöchentlich, vor jedem prod-Deploy mit Migrationen |
| Frontend-Komponenten | Vitest + Testing Library | Formulare, Rechteanzeige, Diagrammberechnungen | jeder Commit |
| Barrierefreiheit | `vitest-axe` (Komponenten) und `@axe-core/playwright` (E2E), CI-Schritt **`pnpm test:a11y`** | jeder Bildschirm und jede wiederverwendbare Komponente ohne Verstöße der Stufen *serious* und *critical*; Tastaturpfad und Fokusreihenfolge. **Kein Lighthouse-Schwellwert** – nicht reproduzierbar in CI (CC5-9) | jeder Commit |
| E2E | Playwright gegen **lokalen Stack** (Vite + API im Node-Adapter + PostgreSQL 16, Test-Login) – lokal und im CI-Job | Kernabläufe AF-01 … AF-14; parallele Refreshes in zwei Tabs sperren nicht; Druckansicht Bericht | jeder PR auf `main` |
| Smoke prod | Skript nach Deploy | `/`, `/api/health` (DB-Ping ab AP-03, `ENGINE_VERSION`) und `/api/health/shallow`, `/catalog/…` erreichbar, Auth-Redirect zu Discord, CSP-Header vorhanden | jeder prod-Deploy |
| Abnahme prod | manuell im Test-Mandanten (4.4) | neue Funktionen mit echtem Discord-Login und NINA-Simulatorgeräten | nach Deploy |
| Fake-Plugin | `tools/fake-plugin` gegen lokalen Stack bzw. Test-Mandant | komplette Nacht: Bootstrap, Plan, Lease, Aufnahmen (inkl. doppelt, offline nachgemeldet, unzugeordnet), Ereignisse, Ende, Nachtbericht | jeder PR (lokal), nach Deploy (Test-Mandant) |
| Plugin-Kern | xUnit (Linux, `NinaPm.Core`) | FilterMatcher (Tabellentests), Outbox-Fehlerklassen, LocalStore, ReplanPolicy (a/b/c, Hysterese), LeaseStateMachine, Playback, FlatTracker (Fortsetzen), Bildzuordnung inkl. Timeout, EngineHost-Parität | jeder Commit mit Änderungen in `apps/nina-plugin` |
| Plugin-Adapter | NINA-Simulator-Geräte + `tools/nina-test-server` (manuell nach `plugin-test-protocol.md`, P-01…P-24, Ergebnis `result.json` maschinell geprüft) | Trigger-Walk (Muster Astro PM), Flip-Erkennung, Transit mit Trigger-Filter und Abbruch, Neuplanung, Offline, Lease, Flats | Plugin-Release bzw. AP-Abnahme |

**Test-Login nur lokal:** Umgebungsvariable `AUTH_TEST_MODE=true` erlaubt `POST /auth/test-login {identityFixture}` ausschließlich im lokalen API-Prozess (`apps/api/src/local.ts`). Die Route wird im Lambda-Bundle nicht registriert (Build-Konstante), eine CDK-Assertion prüft, dass keine Lambda die Variable setzt, und ein Smoke-Test prüft `404` auf `/api/auth/test-login` in prod.

---

## 18. CI/CD und Deployment

| Workflow | Auslöser | Schritte |
|---|---|---|
| `ci.yml` | Pull Request, Push `main` | pnpm install · Lint · Typecheck · Unit/Referenz/Isolation/Rechte-Tests (PostgreSQL-Service) · **`pnpm test:a11y` (axe, CC5-9)** · DSQL-Migration-Lint · OpenAPI-Diff · Web-Build · `cdk synth` + `cdk-nag` + Assertion „kein `AUTH_TEST_MODE`“ · Playwright E2E gegen lokalen Stack · kein Deploy |
| `dsql-it.yml` (Environment `ci`, OIDC-Rolle `NinaPmGithubCiDsql`, H-22) | PR mit Änderungen in `packages/db` · wöchentlich · manuell (auch Spike AP-S1) · Vorbedingung von `deploy-prod.yml`, wenn der Tag neue Migrationen enthält | kurzlebigen DSQL-Cluster anlegen (Tag `purpose=ci`) · Migrationen · Repository-/OCC-Tests · Cluster löschen (`if: always()`); wöchentlicher Aufräumlauf löscht verwaiste `ci`-Cluster |
| `deploy-prod.yml` | Tag `v*` + manuelle Freigabe (GitHub-Environment `prod`) | CI grün auf dem Tag · `dsql-it` grün (bei Migrationen) · `cdk diff` als Artefakt · **Freigabe** · On-Demand-Backup DSQL (bei Migrationen; Laufzeit protokollieren) · `cdk deploy --all` (GitHub OIDC-Rolle; Reihenfolge Data → Config → Migrate [Migration] → Api/Jobs → Web/Edge) · Smoke-Tests prod · Fake-Plugin-Nacht im Test-Mandanten · bei Fehler Alarm + Hinweis auf Rollback |
| `plugin.yml` (`runs-on: windows-latest`; Kern-Tests zusätzlich `ubuntu-latest`) | Tag `plugin-v*` bzw. Änderungen in `apps/nina-plugin`, `packages/engine` oder `tools/nina-test-server` | Engine-Bundle bauen · `dotnet test` (Core + Adapter, inkl. Paritätstest) · `dotnet publish` · ZIP als Release-Artefakt · beim Tag: Beispielsequenzen nach `downloads/nina-sequences/<version>/` (OIDC-Rolle) |
| `oracle.yml` (`ubuntu-latest`, .NET 8 + Node) | PR mit Änderungen in `packages/engine`, nightly | Orakel bauen (Originalquellen des Astro-PM-Plugins, gepinnter Commit, Patch) · Grids erzeugen · Vergleich TS ↔ C# · Abweichungsbericht als Artefakt |
| `reference.yml` (`ubuntu-latest`, Python) | PR mit Änderungen in `tools/reference` · manuell | Fixtures mit astropy erzeugen (gepinnte Versionen, gebündelte IERS-Daten) · Diff zu eingecheckten Fixtures als Artefakt |
| `nightly.yml` | täglich | Engine-Benchmarks · Abhängigkeits-Audit |

- **Eine Umgebung:** nur **prod** (`nina-pm.svenesis.org`) im AWS-Konto der Route-53-Zone `svenesis.org` (OT-04). Kein dev/Staging; Absicherung über lokale Tests, kurzlebigen CI-DSQL-Cluster, manuelle Freigabe, Backup vor Migrationen und Test-Mandant (4.4).
- **Rollback:** `deploy-prod.yml` mit dem vorherigen Tag erneut ausführen (Code, SPA, Infrastruktur). Das Schema bleibt dank Expand/Contract kompatibel (6.10); Migrationen werden nie automatisch zurückgerollt. Datenfehler: Restore-Runbook (6.10).
- **Deploy-Zeitpunkt:** tagsüber, nicht während laufender Aufnahmenächte; das Plugin überbrückt kurze API-Ausfälle ohnehin per Cache/Outbox.
- Kein direktes `cdk deploy` vom Entwicklerrechner (Ausnahme: Erst-Bootstrap `cdk bootstrap` + `NinaPm-Bootstrap` durch Sven, H-04).
- Versionsnummern: Web/API und Plugin getrennt; beide enthalten `ENGINE_VERSION`. **Tags setzt nur Sven** (`v*`, `plugin-v*`); Claude Code bereitet CHANGELOG und Versionsnummern im PR vor. Workflow-Dateien ändert Claude Code über PRs (GitHub-Token mit Scope `workflow`, H-02).

---

## 19. Umsetzungsplan für Claude Code

Die Arbeitspakete sind im Umsetzungspaket **`claude-code/docs/work-packages/`** als einzelne Briefs beschrieben (Ziel, Anforderungen, exakte Leseabschnitte, Lieferumfang, Nicht im Umfang, Bildschirm-Checkliste, automatisierte Abnahme, menschliche Freigabe, Abhängigkeiten, Größe). Diese Übersicht ist daraus erzeugt; bei Abweichungen gilt der Brief. Den Status je Paket pflegt Sven in `work-packages/README.md`; der Einstieg in Sitzung 1 steht in `claude-code/START.md`.

- Reihenfolge innerhalb eines Releases ist verbindlich; ein Paket beginnt erst nach Abnahme seiner Abhängigkeiten und Erledigung der blockierenden menschlichen Aufgaben (`claude-code/docs/ops/human-tasks.md`, H-01…H-26). H-13 (Soll-Pläne) ist Merge-Bedingung von **AP-13b** (Paint) und **AP-13d** (Ablauf), keine Startsperre; H-16 blockiert nicht.
- Spikes (AP-S1, AP-S2a, AP-S2b) liefern Entscheidungen (ADR nach `docs/adr/ADR-TEMPLATE.md`), keinen Produktivcode. AP-S2b läuft früh (nur nach AP-01) und prüft die NINA-Stellen ohne Vorbild; alle Plugin-Pakete brauchen Testläufe mit NINA-Simulatorgeräten und `tools/nina-test-server` (`plugin-test-protocol.md`, P-01…P-24 inkl. P-15b).
- Größen: S ≈ 1 Sitzung · M ≈ 1–2 · L ≈ 2–4 Sitzungen.
- Engine-Kette: AP-13a Orakel/Grid/CI → AP-13b Zuteilung + Paint-Soll-Pläne → AP-13c Ablauf/`planNight` → AP-13d Flip/Transit/Diagnose + Ablauf-Soll-Pläne → AP-13e Aufwand-Kennzeichen → AP-13f Simulator. Plugin-Kette: AP-16a … AP-16h.

### R1 – MVP „Eine Nacht automatisch“

| AP | Inhalt | Größe | Abhängig von | Mensch |
|---|---|---|---|---|
| AP-01 | Monorepo-Gerüst | M | – | H-02, H-03 |
| AP-S2b | Spike NINA-Laufzeit: Stellen ohne Vorbild prüfen (Mensch + Agent) | S | AP-01 | H-14, H-15 |
| AP-02a | CDK-Grundgerüst: Bootstrap, Data, Config, Cert, Web, Edge | M | AP-01 | H-01, H-04, H-06 |
| AP-S1 | Spike Aurora DSQL | S | AP-02a | H-01, H-22 |
| AP-02b | CDK: Api, Jobs, Ops (Lambdas, Rollen, Zeitpläne, Alarme) | M | AP-02a, AP-S1 | H-05, H-06, H-09 |
| AP-03 | Datenbankpaket und Migrationen | L | AP-02b | H-06, H-22, H-25 |
| AP-05 | Shared: Rechte, Fehler, Verträge, Middleware, Job-Infrastruktur | M | AP-03 | – |
| AP-04a | Anmeldung mit Discord und Sitzungen | L | AP-05 | H-05, H-07, H-08 |
| AP-04b | Mandanten, Einladungen, Owner-Invarianten | L | AP-04a | H-08, H-12a |
| AP-06a | Frontend-Shell, Gestaltung, Anmelde-Bildschirme | L | AP-04b | H-16 |
| AP-06b | Benachrichtigungen in der App und Startseite R1 | S | AP-06a | – |
| AP-07a | System-Administration (Super User) | M | AP-06a | – |
| AP-07b | Mitglieder, Einladungen, befristete Admins | M | AP-07a | – |
| AP-07c | Mandanteneinstellungen, Sicherheit, Owner-Übertragung, Protokolle | M | AP-07b | – |
| AP-08a | Engine-Grundlagen: Mathematik, kanonisches JSON, Hash | M | AP-01 | – |
| AP-08b | Engine: Zeit, Sonne, Mond, Koordinaten, Dämmerung (Port astro-core) | L | AP-08a | H-03 |
| AP-08c | Engine-Bundle und Jint-Parität | S | AP-08b | – |
| AP-S2a | Spike Jint-Laufzeit | S | AP-08c | – |
| AP-09a | Ausrüstung: API | L | AP-05, AP-04b | – |
| AP-09b | Stammdaten-Bildschirme S-11 … S-15 | M | AP-09a, AP-06a | – |
| AP-09c | Rig-Bildschirm S-10 | M | AP-09b | – |
| AP-10 | Engine: Sichtbarkeit, Saisonende, Mondvermeidung, Nachtdiagramm | M | AP-08b, AP-06a | – |
| AP-11a | Projekte: API | L | AP-09a | – |
| AP-11b | Projekt-Editor S-31 | L | AP-11a, AP-10 | – |
| AP-11c | Projektliste S-30 | S | AP-11b | – |
| AP-12a | Freigabe-Workflow: API, Stimmen, Rangfolge | L | AP-11a, AP-06b | – |
| AP-12b | Meine Objekte S-32 und Entwürfe S-34 | M | AP-12a, AP-11c | – |
| AP-12c | Warteschlange S-33 | M | AP-12b | – |
| AP-13a | Engine: Vergleichsorakel, Grid-Format, CI | M | AP-10 | – |
| AP-13b | Engine: Zuteilung (`paint`) + Soll-Pläne Paint | L | AP-13a | H-13 |
| AP-13c | Engine: Ablauf (`walk`/`pick`), Blöcke, `planNight` | L | AP-13b | – |
| AP-13d | Engine: Flip, Transit, Diagnose + Soll-Pläne Ablauf | M | AP-13c | H-13 |
| AP-13e | Engine: Aufwand-Kennzeichen + Job + Einfügeposition | M | AP-13d, AP-12c | – |
| AP-13f | Simulator S-40 | L | AP-13d, AP-09c, AP-11a, AP-06a | – |
| AP-14a | NINA-API: Instanz-Token, Bootstrap, Ziele, Plan | M | AP-13c, AP-12a, AP-11a | – |
| AP-14b | NINA-API: Sessions, Lease, Offline, Ingest, Heartbeat | L | AP-14a | – |
| AP-14c | NINA-Instanzen S-42, Auslieferung S-41, Fake-Plugin | M | AP-14b, AP-13f | H-12b, H-24 |
| AP-15 | Sessions und Auswertung R1 | M | AP-14c | – |
| AP-16a | Plugin: Lösung, Core, Kopplung, NINA-Test-Server | M | AP-S2b, AP-14a | H-14, H-15 |
| AP-16b | Plugin Core: Planung, Neuplanung, Offline-Plan | M | AP-16a, AP-S2a, AP-13d | – |
| AP-16c | Plugin Adapter: Container, interne Items, Blockablauf | L | AP-16b, AP-14b | H-14, H-15 |
| AP-16d | Plugin Adapter: Trigger-Walk, Filter und Auslesemodus, Neuplanung im Block | M | AP-16c | H-15 |
| AP-16e | Plugin: Aufnahme-Zuordnung, Heartbeat, Lease | M | AP-16d | H-15 |
| AP-16f | Plugin: Rotator, Flip, Standort- und Sequenzprüfung, Playback-Verzug | M | AP-16e | H-15 |
| AP-16g | Plugin: Outbox, Offline-Modus, Bedienung | M | AP-16f | H-15 |
| AP-16h | Plugin: Live-Status, Zielbrowser, Trigger-Sets, Anweisungskatalog | L | AP-16g | H-12b, H-15 |
| AP-17 | Härtung und Go-live | L | AP-15, AP-16h, AP-07c | H-17, H-18, H-20, H-23, H-26 |

### R2 – Framing und Wetter

| AP | Inhalt | Größe | Abhängig von | Mensch |
|---|---|---|---|---|
| AP-20 | Objektkatalog und Objektbrowser | M | AP-17 | H-11 |
| AP-21 | Sternkarte S-20 | L | AP-20 | – |
| AP-22 | Mosaik-Panels im Editor (aus der Sternkarte) | M | AP-21 | – |
| AP-23 | Astro-Wetter | M | AP-17 | – |
| AP-24 | Saisondiagramm und Wochen-Sichtbarkeit | S | AP-10 | – |
| AP-25 | Vorschaubilder | S | AP-20 | – |

### R3 – Auswertung und Folgeplanung

| AP | Inhalt | Größe | Abhängig von | Mensch |
|---|---|---|---|---|
| AP-30 | Sitzungsprotokoll und Klarnacht-Statistik | M | AP-15 | – |
| AP-31 | Session-KPIs, Abweichungsgründe, Aufnahmen verwerfen | M | AP-30 | – |
| AP-32 | Mehrnacht-Simulation, Auswirkungsvorschau, Änderungsanträge | L | AP-31 | – |
| AP-33 | Folgeplanung S-62 und Prognose | M | AP-32 | – |
| AP-34 | Projektbericht S-63 | S | AP-31 | – |
| AP-35 | „Heute Nacht“ S-02 | S | AP-33 | – |

### R4 – Exoplaneten

| AP | Inhalt | Größe | Abhängig von | Mensch |
|---|---|---|---|---|
| AP-40 | Exoplaneten-Kataloge | M | AP-17 | – |
| AP-41 | Transitrechnung | M | AP-40, AP-08b | – |
| AP-42 | Exoplaneten-Bildschirm S-22 | M | AP-41 | – |
| AP-43 | Exoplaneten-Projekt und Transit-Beobachtungen | L | AP-42, AP-12c | – |
| AP-44 | Scheduler-Reservierung und Plugin-Transitblock | M | AP-43, AP-16h | H-15 |
| AP-45 | Transit-Auswertung und Ergebnisimport | M | AP-44 | H-19 |

### R5 – Komfort

| AP | Inhalt | Größe | Abhängig von | Mensch |
|---|---|---|---|---|
| AP-50 | Flat-Handling im Plugin | L | AP-16h | H-15 |
| AP-52 | Tagesschleife | M | AP-50 | H-15 |
| AP-53 | Simulator im Plugin | M | AP-16h | H-15 |
| AP-54 | Mandanten-Export/-Import | M | AP-17 | – |
| AP-55 | Astro-PM-Import (optional) | M | AP-54 | – |

### R6 – Optional

| AP | Inhalt | Größe | Abhängig von | Mensch |
|---|---|---|---|---|
| AP-60 | Discord-Kanäle und Nachtbericht | M | AP-15 | H-21 |
| AP-61 | Belichtungs-/Sampling-Rechner | S | AP-09b | – |
| AP-62 | Optionale NINA-Metriken | S | AP-16h | – |
| AP-63 | Teilen von Ausrüstung/Projekten | S | AP-54 | – |

---

## 20. CLAUDE.md

Die verbindliche `CLAUDE.md` liegt im Umsetzungspaket unter **`claude-code/CLAUDE.md`** und wird in AP-01 ins Repository-Root übernommen. Sie enthält nur Arbeitsweise, Karte der Dokumente, Befehle und die harten Regeln in Kurzform; Details stehen in `claude-code/docs/rules/*.md`. Die Konzepte werden nicht vollständig geladen, sondern je Arbeitspaket nur die im Brief genannten Abschnitte (Kontextbudget).

Aufbau des Pakets:

```
claude-code/
├─ CLAUDE.md
├─ START.md                Prompt und Ablauf für Sitzung 1 (Paketquelle, legacy-Kopie, Zielrepo)
├─ THIRD_PARTY_NOTICES.md  MIT-Hinweis Astro-PM-NINA-Plugin
└─ docs/
   ├─ README.md            Leseplan, Vorrang bei Widersprüchen: Brief > specs/contracts > rules > TK > FK
   ├─ rules/               dsql, engine, security-auth, api, ui, testing
   ├─ specs/engine/        allocation (nach Astro PM), moon, night, geometry, sort-chain, flip-rotation, transit, effort, canonical-json
   ├─ specs/infra/         iam (Rollen, Least Privilege, API-Gateway-Drosselung, CloudFront-Header)
   ├─ specs/ui/            components (Verträge der wiederverwendbaren Bausteine, Symbole, Abstände)
   ├─ specs/nina/          execution (Plugin-Ausführung nach Astro PM)
   ├─ contracts/           enums.json, errors.json, golden-plans/ (Format, Pflichtfälle; Paint-Pläne in AP-13b, Ablauf-Pläne in **AP-13d**), nina/*.example.json
   ├─ seed/                seed-demo.json
   ├─ ops/                 human-tasks, golive-checklist, plugin-test-protocol, discord-embeds
   ├─ adr/                 ADR-TEMPLATE.md
   ├─ work-packages/       README (mit Statusspalte) + AP-Briefs R1–R6
   ├─ concept/             Kopien Fachkonzept, Technisches Konzept, Schema; INDEX.md (Abschnitt → Zeilen)
   └─ history/             Reviews, Analyse Astro-PM-Plugin, überholte Soll-Pläne v1
```

---

## 21. Offene technische Punkte und Risiken

| Nr. | Thema | Stand / Vorschlag |
|---|---|---|
| OT-01 | Verfügbarkeit von **Aurora DSQL in eu-central-1** | **Erledigt:** in Frankfurt verfügbar (seit 23.10.2025). Offen bleibt nur, die Preise für Frankfurt vor Go-live im AWS Pricing Calculator zu bestätigen (16.3). |
| OT-02 | Verwaltung der CloudFront-Distribution von svenesis.org | **Entfällt:** NINA-PM nutzt eine eigene Distribution; `E2L6Q80SD8XPT0` bleibt unverändert (ADR-14). |
| OT-03 | CSS/HTML von svenesis.org | **Erledigt:** Website-Ordner ausgewertet; Design-Tokens, Kopf/Fuß-Struktur und Astro-Tools werden als Kopie übernommen (8.4, 11.3). |
| OT-04 | Umgebungen und AWS-Konto | **Entschieden:** nur **prod** in einem Konto (das der Route-53-Zone); keine dev-/Staging-Umgebung. Absicherung siehe 4.4 und 18. |
| OT-05 | **Open-Meteo-Lizenz** bei Nutzung durch mehrere Mandanten | nicht kommerziell ok; bei Entgelt API-Plan |
| OT-06 | Unterstützung von `INSERT … ON CONFLICT`, Wartefunktion für `CREATE INDEX ASYNC`, GRANT-Syntax in DSQL | im Spike AP-S1 verifizieren; Fallback beschrieben (6.6/6.8) |
| OT-07 | **Jint-Leistung** für `planNight` bei 20+ Projekten | nur noch für Offline-Planung relevant (ADR-16); Messung im Spike AP-S2a; Fallback ClearScript (V8) |
| OT-08 | Genaue NINA-3-Plugin-APIs (Trigger-Walk und Flip-Koordinaten nach Astro-PM-Muster, Profil-Flip-Werte, Bild-Zuordnung, Abbruch – Muster aus dem Astro-PM-Plugin bekannt, Bestätigung mit aktueller NINA-Version) | Spike AP-S2b (Mensch + Claude Code, Prüfprotokoll) mit dem Astro-PM-Plugin (MIT) als Codebasis |
| OT-09 | Discord-Abhängigkeit (Ausfall, Kontosperre des Betreibers) | Notfallzugang `ops-cli`, mehrere Super User |
| OT-10 | Offizieller DSQL-Connector für node-postgres vs. eigener Token-Pool | Connector bevorzugt; im Spike AP-S1 bestätigen |
| OT-11 | Zeitzonendaten für die Engine (IANA-Übergänge) im Jint-Kontext | **Entschieden:** Server liefert Übergänge und Nacht-Schlüssel der nächsten 60 Nächte im Bootstrap; Browser nutzt `Intl`; .NET-`TimeZoneInfo` wird nicht verwendet |
| OT-12 | DNS von svenesis.org | **Erledigt:** Route 53 im selben Konto → Zertifikate (us-east-1, DNS-Validierung) und Alias-Einträge `nina-pm` per CDK (4.3). |
| OT-13/14 | Skripte bzw. Fehlerseiten der Website-Distribution | **Entfallen** (siehe OT-02). |
| OT-15 | Rechtliche Durchsicht der **eigenen Datenschutzerklärung** von NINA-PM (Discord/USA, AWS, externe Dienste, Anmelde-Cookies) | vor Go-live |
| OT-16 | HOPS-/EXOTIC-Ausgabeformate (Fachkonzept OP-14) | Beispieldateien beschaffen vor AP-45 |
| OT-18 | Fremdschlüssel in DSQL erst seit 27.08.2026 | im Spike AP-S1 mit dem Schema testen; Rückfall: FKs weglassen (Integrität im Repository, Abgleich-Job sucht Waisen) |
| OT-19 | Reviews 17.09.2026 | **Eingearbeitet**: Review 1 in TK 1.3/FK 1.6/Schema 1.3, Review 2 in TK 1.6/FK 1.9/Schema 1.6, Review 3 in TK 1.8/FK 1.11/Schema 1.8 (alle unter `claude-code/docs/history/`) |
| OT-20 | NINA-Simulatoren ohne Simulatoruhr | **Entschieden:** `tools/nina-test-server` erzeugt Pläne relativ zu „jetzt“; Sicherheitsprüfungen nur mit Header `X-NPM-Test: 1` übersprungen (nie in prod). |
| OT-21 | Neuplanung vs. Stabilität des Plans | **Entschieden:** Hysterese (nur bei ETag-/Settings-Änderung oder Verzug > 10 min), Nachtfairness mit `tonight`; Eigenschaftstest „Neuplanung ohne Änderung ändert nichts“. |
| OT-17 | Offene Fachpunkte ohne technische Auswirkung auf R1: OP-10 (Plugin-Veröffentlichung), OP-13 (Katalog-Nutzungsbedingungen), OP-15 (Geräte für Bedingungen), OP-20 (Astro-PM-Import) | vor jeweiligem Release klären |

**Risiken**

| Risiko | Auswirkung | Gegenmaßnahme |
|---|---|---|
| DSQL-Einschränkungen tauchen spät auf | Umbau Datenzugriff | Spike AP-S1 vor dem ersten Schema, CI-DSQL-Cluster bei jeder DB-Änderung, Kysely hält SQL portabel (Ausweichziel Aurora Serverless v2 mit Data API) |
| Engine weicht zwischen Node und Jint ab | Plan in NINA ≠ Simulator | online plant der Server (ADR-16); eigene Mathematik, quantisierte Vergleiche, kanonisches JSON; Paritätstest mit Zufallseingaben |
| NINA-Trigger greifen nicht bzw. Aufnahmen falsch zugeordnet | Montierung läuft an, falsche Zähler | erprobte Muster des Astro-PM-Plugins (Trigger-Walk, Container-Target), Zuordnung `Image.Id` → Aufnahme-ID vor Enqueue mit Timeout, früher Spike AP-S2b für die Stellen ohne Vorbild |
| Planungs-Port weicht unbemerkt vom Original ab | Verteilung anders als erwartet | Orakel im Kompatibilitätsmodus, Soll-Pläne mit Sichtprüfung (H-13), Abweichungen A-1…A-30 nur explizit |
| Massenabmeldung durch Refresh-Wettlauf | Nutzer fliegen täglich raus | Karenz 60 s + Single-Flight (5.3), E2E-Test mit zwei Tabs |
| Abweichung der Gestaltung von der Website nach Website-Änderungen | uneinheitlicher Auftritt | Tokens mit Quelle/Datum dokumentiert; bei Website-Redesign bewusst nachziehen |
| Kopierte Astro-Tools-Logik veraltet gegenüber späteren Website-Korrekturen | Rechenfehler bleiben bestehen | Datum der Kopie in `legacy/`; Referenztests gegen astropy decken Abweichungen unabhängig auf |
| Keine Vorab-Umgebung: Fehler erreichen direkt prod | Ausfall oder Datenfehler für alle Mandanten | lokale E2E, CI-DSQL-Cluster, manuelle Freigabe mit `cdk diff`, Backup vor Migrationen, Expand/Contract, Smoke-Tests, schneller Rollback per vorherigem Tag, Abnahme im Test-Mandanten |
| Plugin-Kompatibilität bei NINA-Updates | Nächte fallen aus | Plugin gegen NINA-Beta testen, Engine-Version-Check, klare Fehlermeldung |
