# Technisches Konzept – Svenesis NINA-PM

**Architektur, AWS-Infrastruktur (CDK), Datenbank, API, Engine, NINA-Plugin und Frontend**

| | |
|---|---|
| Dokument | Technisches Konzept |
| Version | 1.22 – DSQL-Spike AP-S1 23.09.2026 (ADR-S1, angenommen): `ADD COLUMN` nur ohne DEFAULT/Constraint, kein `SET NOT NULL`, Wartefunktion `CALL sys.wait_for_job`, kein `GRANT USAGE ON SCHEMA public`, Grenzen 10 MiB und 300 s je Transaktion (6.0, 6.8) · **1.21** – Release-Reihenfolge 23.09.2026: NINA-Plugin als eigener Block **RP** direkt vor R4 (Kap. 19; AP-S2b, AP-S2c, AP-08c, AP-S2a, AP-16a–h), AP-17 ohne AP-16h · **1.20** – Übernahme des aktualisierten Website-Codes 23.09.2026 (WS-01…WS-31, WS-E1…E4): **Wetterbewertung exakt 1:1 aus dem neuen `weather-core.js`** (WS-E1) – `cloudScore` auf die **Gesamtbedeckung** `cloud_cover`, die Schichtgewichtung `cloudEff` entfällt, kein Regen-Riegel: **Niederschlag geht in keine Bewertung ein** (Regenmenge und Regenwahrscheinlichkeit bleiben Anzeige und Speicherung) · neue Engine-Funktion **`windShear`** sowie `jetKmh` = max(w250; 1,3·w500) und `shearKmh` mit druckabhängiger Untergrenze (500/700/850 hPa) · `seeingScore` mit **normierten Gewichten** über die vorhandenen Terme statt Nullen für fehlende Werte (bewusste Abweichung WS-04a, Kennzeichen „Seeing unvollständig“) · **Transparenz ohne Aerosol = `null`** mit Kennzeichen `aerosolMissing` (WS-E2); der bisherige aerosolfreie Schätzzweig entfällt · `overallScore` quadriert den Wolkenterm und verteilt das Gewicht fehlender Anteile um; **Klassengrenzen 0,25 / 0,45 / 0,65 / 0,85** statt 85/70/50/25 und deutsche Namen · Rundung erst unmittelbar vor Vergleich und Ausgabe (`q(x, 1e3)`, WS-08) · **Nacht-Mittel über die exakte astronomische Dunkelheit** mit `coveredSec` und Abdeckung, dazu ein **bestes Fenster** (längster Lauf ≥ 0,65, Rückfall ≥ 0,45, Mindestdauer 1800 s) mit mondfreiem Anteil (WS-09/WS-10) · **`WeatherHourly` vollständig neu** (26 Rohfelder, abgeleitet `jetKmh`/`shearKmh`, Herkunft `modelId`/`cloudSrc`/`nest`/`aerosolMissing`); Intervallwerte (Böen, Niederschlag, Regenwahrscheinlichkeit) werden dem Stempel **`t + 1 h`** entnommen (WS-12) · **drei HTTP-Abrufe je Standort und Lauf** (Hauptmodell, Air-Quality, Modellvergleich) mit `past_days=1`, `forecast_days=7`, `wind_speed_unit=kmh`, `dust` und `timezone=UTC` (AST-D25 bleibt) · Nest-Erkennung je Stunde mit Latch und `NEST_MAX_H = 30 h` in Nordamerika, danach das feine Modell für Wolken und Sicht, `weatherCode` neu abgeleitet (WS-14/WS-15) · Job `weather` mit drei Aufrufen, Budget und neuen `model_set`-Schlüsseln (WS-16) · **8.4 neu geordnet:** `weather-core.js` als eigene Kopiervorlage (WS-19), Liste „in der Vorlage falsch – nicht übernehmen“ mit Datei:Zeile und Fehlerbetrag (WS-20: geozentrischer Mondabstand, Mondhöhe ohne Refraktion, „Mond unten“ bei −0,833°, abgeschnittene Refraktion, 60-s-Raster der Dämmerung, **fehlendes ΔT**, toter `OBL`-Vorgabewert, `Intl`, `Math.round`, Passwort-Gate, verdrahtete −18°/30°), Absatz „keine Vorlage, Neubau“ (WS-21) und Zeile „nicht übernommen: `weather-history.js`“ (WS-E3) · **Objektkatalog aus OpenNGC** (WS-E4/WS-25…WS-27): der Website-Auszug liefert nur Namen, Vorschaubilder und Wikipedia-Titel, neue Spezifikation `specs/catalog/dso-import.md`, `enums.json` mit `dsoObjectTypes`, Objektzahl überall aus der OpenNGC-Version · **9.2 neu:** Positivliste und Negativliste der Prüfungen aus `verify-planner.js` (WS-22/WS-23) statt der pauschalen Übernahme, Sondertoleranz ± 5 s für die Nachtfenster-Beispiele (WS-28) und die Klarstellung, dass „mittlerer Ort + GMST“ und „α_app + GAST“ gleichwertig sind, die **Präzession** aber entscheidend ist (WS-24) · bekannte Einschränkung: eine Regennacht wird in der Mehrnacht-Prognose allein über die Bewölkung bewertet (FA-WET-09/FA-FOL-03). **Nachtrag nach Gegenprüfung:** `WeatherScoreInput` trägt `darkWindows` für mehrere Nächte und `WeatherNight` ist als Typ definiert, `moonAltDeg` und `seeingIncomplete` (jeder fehlende Seeing-Eingang, ohne Score kein Kennzeichen) sind als Felder benannt, die Mondhöhe im besten Fenster ist ausdrücklich die **geometrische** topozentrische mit Schwelle −0,833° (bitgleich zur Vorlage; die Planung bleibt bei `moon.md`), Rundung einheitlich „ungerundet rechnen und speichern, `q(x, 1e3)` erst vor Vergleich, `outputHash` und Ausgabe“, in 8.4 eine Abweichung in der Bewertung und drei in der Anzeigeauswertung mit dem nachgerechneten Beleg 0,820 gegen 0,600, getrennte Bildpfade `catalog/img/` (kopiert) und `catalog/thumbs/` (selbst erzeugt), die Katalogzahl eindeutig als 13.957 Zeilen `NGC.csv` + `n_addendum`, in 9.2 die Nachtfenster-Abstände aus den exakten Werten (11,4 / 51,4 / 14,7 / 21,9 s) und in 14 der Vorhersagehorizont ohne die Klammer „optional 14–16 Tage“ (8.2, 8.4, 9.2, 13, 14). Vorversionen: 1.19 – Nachtablauf-Prüfung 21.09.2026 (NT-01…NT-48, NT-E1…E4): **`currentNight(site, now)`** als eine Funktion in `packages/shared` und `NinaPm.Core`, der Server prüft `night` bei `POST /plan` und `POST /sessions` (`422 nina.night_invalid`) · Nacht-Tabelle `nights[]` ab der **laufenden** Nacht mit `noonStartUtc`/`noonEndUtc`, dazu `tzdataVersion` und `timeZoneTransitions` (Bootstrap und neuer `GET /web/v1/sites/{id}/nights`); `Intl` im Browser nur zur Anzeige, Datumslogik mit Temporal, Nachtereignisse in Standortzeit mit Kürzel · Plugin-Zeittypen (`DateTimeOffset` UTC, `IClock`, BannedApiAnalyzers), eine Uhrquelle `serverTimeUtc`, SiteCheck-Warnung `pc_timezone_differs` · `darknessEndUtc` = **spätester** Aufwärtsdurchgang der aktiven Grenzen (null-Regeln), Nachtende und Nachtende-Kulanz neu, kein Wiederöffnen mit `running` · Lease-Zustand **`unreachable`**, FIFO-Barriere für Offline-Pläne, `pendingCaptures` als Liste, `targets`-ETag ohne Zähler · Benutzer-Stopp → `aborted`, Safety über „Loop While Safe“, Enums `blockEndReasons`/`heartbeatStates` · **Filterzuordnung je Rig** einmal bestätigt (`PUT /web/v1/rigs/{id}/filter-wheel`, `ninaFilterName` in `targets`, Laufzeit-Heuristik `FilterMatcher` entfällt, NT-E1) · Kühlung nur warnen (NT-E2) · Zeilen mit Aufnahmen gesperrt (`409 line.locked_by_captures`, `POST …/lines/{lineId}/duplicate`, `settings_deviation`, `integration_s` = Σ `exposure_s`, NT-E3) · Rotation modulo 180°, kein Nachrotieren nach dem Flip (NT-E4) · Flip aktiv über die eigene Trigger-Iteration (ohne Dither), untere Kulmination, Flip-Lücke im Transit, Pierseite · NINA-Einstellungen im Heartbeat mit `alert.nina_settings_mismatch`, Dither-Trigger immer unterdrückt, erster Autofokus · `exposureMidUtc`, Gain/Offset nullable, Auslesemodus-Regel, Trained-/Himmelsflats (`flats.source`, `flatsNotAfterUtc`), `photometric_band` · standortbezogene Jobs je `(site, night)` aus `tick-hourly`, `report_due_at` aus `session_end_utc` · Sequenzvorlage als Prüfliste, automatischer Start, Tests mit Chicago-DST-Nächten und Playwright-`timezoneId`. Nachtrag nach Gegenprüfung: Nacht-Tabelle ab der Mittagsnacht mit `nightWindowEndUtc` je Zeile, `currentNight` nur aus der Tabelle (7.3, 7.6, 8) · Sicherungscontainer an *NINA-PM Nachtschleife* mit *NINA-PM Warten bis sicher oder Nachtende*, Nachtende ohne Wiederaufnahme, Vorlage ohne Safety und Reihenfolge Warten → Entparken (10.3) · Trigger nur über die eigene Iteration (`TriggerWalker`), Flip nach NINAs frühester Flipzeit und Zentrieren nach jedem Flip, `RangeType = QUARTER` → `rotator_range_quarter`, *Autofokus nach Zeit* im Heartbeat (`afEveryMin = 0` ohne Trigger), `ninaSettingsMismatchCodes` (7.6, 10.3) · `block.twilightEndUtc` für die Nachtende-Kulanz, eine Definition von `inTransitWindow`/Lücke, Flip im Transit-Vorlauf (7.6) · Heartbeat holt die Lease zurück, `rig_lease.released_session_id`, nur `stale → running` (5.6, 6.6) · Warncodes bereinigt (`readout_mode_not_found` ist Ereignisart). Vorversionen: 1.18 – Sicherheits-Vereinfachung 21.09.2026 (SV-01…SV-19, E1–E4): **serverseitige Sitzung** `__Host-npm_sid` (nur SHA-256 in `auth_session`, 14 Tage Inaktivität/30 Tage höchstens, je Anfrage frisch aus der DB) statt JWT + Refresh-Rotation – Signaturschlüssel, Schlüsselwechsel, Karenz, Mitglieds-Versionszähler, Status-Cache und Single-Flight im Frontend entfallen · OAuth mit **PKCE**, Cookie-Schlüssel `/nina-pm/oauth/cookie-secret` · 2FA als feste Regel für Owner/Admin, Sicherheitseinstellungen des Mandanten und `/tenant/security` entfallen · CSRF nur SameSite=Lax + `X-NPM-Request` · Markdown ohne rohes HTML · Drosselung nur am Gateway, Job-Grenze 3 je Mitglied · `/api/health` ohne DB-Ping · Plugin-Token ohne Ablauf, Widerruf sofort · Uploads mit `JSON.parse` + zod, `eq $key` überall · Discord-Webhook-URL in der DB · `login_audit` entfällt · **Rollen Owner/Admin/User ohne befristete Admins**, Owner-Übertragung sofort · Papierkorb für Projekte und Baustein `ConfirmDialog` · eine Rolle je Lambda über **CDK-Grants**, `migrate` mit DSQL-Admin führt Migration 0000 selbst aus (`db-bootstrap`, `app_migrate` entfallen) · kein Bootstrap-Stack, keine GitHub-OIDC-Rollen, keine Deploy-Grenze, kein KMS-Schlüssel, kein CloudTrail-Trail, Standard-Backup-Vault, Logs 90 Tage · **GitHub ohne AWS-Zugang**, Deploy lokal per `pnpm deploy:prod`, DSQL-Tests lokal per `pnpm test:dsql` · Kapitel 15 neu gegliedert (Bedrohung von außen, Schutz gegen Versehen, bewusst nicht vorgesehen). Nachtrag nach Gegenprüfung: Mandanten-Export ohne Webhook-URLs, Token-Hashes, Sitzungen und Einladungen, Import mit deaktivierten Kanälen, Host-Prüfung vor jedem Discord-Versand ohne Weiterleitungen (6.10, 7.7) · CSRF-Geltungsbereich einheitlich (5.3) · Auth-Drossel nur auf Discord-Anmeldung und Einladungsrouten, **eine** Health-Route `GET /api/health` (4.2, 7.1) · Owner-Einladung bei vorhandenem Owner abgelehnt, Owner-/Admin-Einladungen einmalig, `next`-Prüfung, Einladungs-Token 256 Bit (5.2) · `500 internal.error` ohne Details (7.1) · `reason` beim Rollenwechsel optional in `change_log` · `last_login_at` im Mandanten · `INSERT`-Rechte von `app_job` für den Import (6.2) · Panels/Zeilen nicht einzeln wiederherstellbar (6.6) · 15.3 um Überlast, `s3:List*` und 2FA-Stand ergänzt; Assertions nur noch in `iam.md` §12. 1.17 – Astronomie-Durchgang 18.09.2026 (95 Befunde; **Nachtrag desselben Tages nach Gegenprüfung** (Details im Astronomie-Review, Abschnitt „Nachtrag"): `darkness` im NINA-Vertrag trägt jetzt **alle drei Dämmerungsstufen** einzeln und nullable, `darknessEndUtc` ist die tiefste aktive Grenze und nullable – der Vertrag legte sie bisher fest auf −18° und widersprach damit AST-N1; Restriktivität als neue Abweichung **A-31** (`allocation.md` trug im Text weiter die abgelöste Formel); Einheitenwechsel beim Exoplaneten-Import überall durchgezogen – `min_aperture_mm` statt Zoll (AST-D13) und `distance_pc` statt Lichtjahre (AST-D14) im Schema und in `transit.md` §2, und die Portierungszeile zu `astro-weather.js` verlangte weiterhin `timezone=auto`, das 20.1 verbietet – die Ausnahme steht dort nun ausdrücklich, AST-D25): **ΔT geht nicht in die Sternzeit** (0,2883° Stundenwinkelfehler, AST-G02) · Transitmitte-Toleranz von ±10 s auf **±1 s**, Modellgenauigkeit ≤ 0,1 s statt „< 10 s" · Mondauf-/-untergang ±120 s → **±30 s** plus Direkttest, neue Toleranzzeile **Mondhöhe** · Mondbeleuchtung ausdrücklich **geozentrisch** · Sonne verbindlich nach Meeus Kap. 25 mit Schiefe und Aberration (war ganz unspezifiziert) · `de432s.bsp` im Repository statt Nachladen · Luftmasse als reine Anzeige mit Kasten & Young statt `sec z` · Open-Meteo **Air-Quality-API als eigene Quelle** mit eigenem Horizont, Abruf mit `timezone=UTC` · hips2fits-Aufruf und Cache-Schlüssel festgeschrieben · **J2000 im NINA-Vertrag** (präzessierte Werte blieben sonst 20′ daneben) · neue Spezifikation `specs/engine/weather.md`. Vorversion 1.16 – Sicherheits-Durchgang 18.09.2026, **SEC-31…SEC-59** vollständig eingearbeitet: `NinaPmDeployBoundary` trägt sich jetzt selbst (kein Selbst-Überschreiben, keine Rolle ohne Grenze, kein DSQL-Admin, kein Geheimnis-Zugriff, kein Aufruf des Notfallpfads, kein Abschalten von Trail und Sicherung, keine Bucket-Umkonfiguration) · OIDC-Vertrauen ausgeschrieben mit `aud` und `StringEquals` auf `:sub`, `lookup`-Rolle entfällt · eigene Rolle `NinaPmGithubPlugin` · harte CSP auf `npm-api-static` gegen gespeichertes XSS über `/catalog/*` und `/downloads/*` · `/api/health/shallow` von 200 auf 5 rps, Alarme auf Aufrufzahl und 403-Quote · Sicherheitsschlüssel des Mandanten in eigener Liste `tenantSecurityKeys` · eigene Aktion `tenant.owner.accept` · Einladungsroute nach Zielrolle getrennt · Super-User-Einladungen an eine Discord-ID gebunden und nicht selbst einlösbar · presigned POST mit `eq $key`, Downloads nur über Zweck und ID · Session-Routen je Rig gefiltert · Ereignis-Pakete begrenzt · Quoten für benutzerausgelöste Jobs · Sync-Token mit Ablauf und DPAPI-Ablage · Audit-Tabellen nur anfügbar · 16 statt 9 CDK-Assertions. Vorversion 1.15 – Logik-Durchgang 18.09.2026 (19 Befunde): `integration_s` nur auf `capture_night` gespeichert, mit Bonus-Termen (DAT5-11) · Aufräumen von Sitzungen, Einladungen und Audit an die passende DB-Rolle (6.2/13) · vorläufiger Nachtbericht vom 6-h-Tor ausgenommen (13) · `worker` darf Zustellfelder von `discord_channel` schreiben · Löschen fehlerhafter Uploads eng gewährt (12) · fehlende `nightPlanId` je Meldung mit `rejected_invalid`, nicht `422` (6.6) · `flats_taken`/`dark_flats_taken` · Prognose idempotent · zwei fehlende Indizes · Austritt aus dem Offline-Modus über den ersten Online-Heartbeat (10.3) · `offline`/`offlinePlan` im PATCH-Vertrag · Aktionen für Einladungs-Vorschau und Datei-Routen · Super-User-Invariante (5.5) · harter Blockschluss und Plate-Solve-Rückfall beim Flip an `execution.md` angeglichen (10.3). Vorversion 1.14 – Entscheidung vom 18.09.2026: **Vault Lock entfällt** – der Schutz der Sicherungen trägt allein über den eigenen Vault `nina-pm-prod`, seine Zugriffspolitik und die Deny-Anweisungen in `NinaPmDeployBoundary` (neu: auch `backup:PutBackupVaultAccessPolicy`, sonst könnte die Deploy-Rolle die schützende Politik ersetzen). **CloudTrail bleibt** und liefert jetzt an **zwei Ziele** (S3 *und* CloudWatch-Logs) – Metrikfilter liegen auf Log-Gruppen, ein Trail mit S3 als einzigem Ziel kann keine Alarme haben; die Alarme auf `bootstrap-super-users`, `/nina-pm/jwt/*`, `ops-cli` und `dsql:DeleteCluster` hätten sonst nie gefeuert. Vorversionen: 1.13 – NINA-Plugin: Aufteilung in **fünf Projekte** (`NinaPm.Core`, `NinaPm.Core.Tests`, `NinaPm.Nina` ohne eigene XAML-Datei, `NinaPm.Nina.Tests`, `NinaPm.Nina.Ui` mit XAML), **Referenz-Assemblies unter `refs/`** statt fester Pfade ins NINA-Installationsverzeichnis, `EnableWindowsTargeting` und `PlatformTarget` in `Directory.Build.props` – damit sind Kern **und Adapter** ohne Windows baubar (neuer Abschnitt 10.5, Nachweis in AP-S2c, Bereitstellung in H-14); `plugin.yml` sichert den windowsfreien Weg in einem eigenen `ubuntu-latest`-Auftrag. Vorversionen: 1.12 – Entscheidungen vom 17.09.2026: Arbeitsseiten **ohne Breitenobergrenze** (volle Fensterbreite, nur Textseiten auf Lesebreite), **Dichte-Schalter** `compact`/`normal`/`wide` mit eigenen Tokens statt Layout-Umschalter, **Rotlicht-Modus entfällt** (nur `light` und `dark`), **kein AWS WAF** – der Schutz gegen Direktaufrufe und Lastspitzen trägt endgültig über Origin-Verify, Drosselung, reservierte Parallelität und Alarme. Abgestimmt mit Fachkonzept v1.15, Schema v1.11 und `claude-code/`. Vorversionen: 1.11 Sicherheits-Review; 1.10 Review 5; 1.9 Review 4.
| Stand | 23.09.2026 |
| Autor | Sven Ramuschkat (mit Claude) |
| Grundlage | `Fachkonzept_Svenesis-NINA-PM.md` v1.15 (Anforderungs-IDs FA-…, NFA-…, Bildschirme S-…) |
| Anlagen | `schema_aurora_dsql.sql` v1.19 (DDL, 52 Tabellen); Umsetzungspaket `claude-code/` (CLAUDE.md, Regeln, Spezifikationen, Verträge, Soll-Pläne, Arbeitspaket-Briefs, menschliche Aufgaben) |
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
- **So einfach wie möglich:** zwei Anwendungs-Lambdas (`api`, `worker`) plus die Betriebs-Lambdas `migrate` (legt bei jedem Deploy auch DB-Rollen und Grants idempotent an, SV-13) und `ops-cli` (CDK-Hilfs-Lambdas wie `BucketDeployment`/Custom Resources ausgenommen), vier Zeitpläne, eine Job-Tabelle; alles, was länger als ~5 s dauert oder größer als 1 MB ist, läuft als Job (ADR-17).
- **Mandantentrennung im Code erzwungen:** Aurora DSQL hat keine Row-Level-Security → zentraler, nicht umgehbarer Mandantenkontext im Datenzugriff (NFA-16).
- **Keine Passwörter:** Anmeldung ausschließlich über Discord-OAuth; eigene serverseitige Sitzungen (zufällige Sitzungs-ID im HttpOnly-Cookie, SV-01); kein Cognito, kein JWT.
- **Sicherheit mit Augenmaß (SV, 21.09.2026):** Geschützt wird gegen Angreifer **von außen** (API, Web, Plugin-Schnittstelle); das Deployment ist **nicht** Teil der Sicherheitsarchitektur (Sven deployt lokal mit Admin-Profil); innerhalb der Anwendung gilt **Schutz gegen Versehen**, nicht gegen böswillige Mitglieder (→ 15).
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
| ADR-07 | **Discord-OAuth ohne Cognito**, eigene **serverseitige Sitzungen**: zufällige Sitzungs-ID im HttpOnly-Cookie `__Host-npm_sid`, in `auth_session` nur als SHA-256-Hash; jede Anfrage liest Sitzung, Rolle und Status frisch aus der DB (SV-01) | Vorgabe; kein Passwort-Handling; Logout, Sperre und Rollenwechsel wirken sofort; keine Schlüsselrotation, kein Refresh-Wettlauf | Cognito mit Discord-Föderation; JWT + rotierende Refresh-Tokens (bis TK 1.17) |
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
- **SSM Parameter Store (SecureString, Standardschlüssel `alias/aws/ssm`)** für Discord-Client-Secret und den Signaturschlüssel des OAuth-Cookies (`/nina-pm/oauth/cookie-secret`, SV-02) – einmalig per CLI angelegt, CDK referenziert nur (4.1).

### 2.2 Wichtige Abläufe

**Web-Anfrage**

```
Browser ─▶ CloudFront nina-pm.svenesis.org (/api/web/v1/…, Cookies weitergereicht, kein Cache)
        ─▶ API GW ─▶ api Lambda
             1. X-Origin-Verify prüfen (nur über CloudFront erreichbar)
             2. Sitzungs-Cookie __Host-npm_sid → SHA-256 → eine indizierte Abfrage liest Sitzung + Mitgliedschaft
                + identity.status/mfa_enabled + tenant.status (kein Cache, 5.3/5.5) → AuthContext {identityId, sessionId, memberId,
                tenantId, role, isOwner, mfa, ctx}
             3. CSRF-Header X-NPM-Request bei jeder nicht-GET-Methode prüfen (außer /nina/v1, 5.3)
             4. zod-Validierung
             5. Berechtigung: can(role, action, resource)
             6. Repository (tenant-gebunden) ─▶ DSQL
             7. JSON-Antwort (Problem-Details bei Fehlern)
```

**NINA-Nacht** (Basis-URL `https://nina-pm.svenesis.org/api/nina/v1`)

```
Plugin start ─▶ GET  /bootstrap   (Rig, Standort, Filterrad-Zuordnung, Settings, Nacht-Tabelle + Zeitzonen-Übergänge,
                                   serverTimeUtc, Engine-Version); Nacht = currentNight(site, now) (NT-01)
             ─▶ GET  /targets     (ETag; auslieferbare Projekte mit Zeilen/Zählern)
             ─▶ POST /plan        (Server plant mit der Node-Engine; offline: Jint aus dem Cache)
             ─▶ POST /sessions    (Lease je Rig; Plan-Dokument, Protokoll per presigned POST nach S3)
             ─▶ vor jedem Block: GET /targets (ETag) → geändert/Verzug > 10 min? → POST /plan {startAtUtc, tonight}
             ─▶ im Block alle 15 min: GET /targets → Fall a/b/c (10.3 Nr. 3)
             ─▶ je gespeicherte Belichtung: Outbox ─▶ POST /sessions/{id}/captures (Batch)
             ─▶ Ereignisse ─▶ POST /sessions/{id}/events (Batch)
             ─▶ alle 60 s  ─▶ POST /heartbeat (verlängert Lease 3 min; leaseLost; offline friert ein; NINA-Einstellungen)
             ─▶ Ende       ─▶ PATCH /sessions/{id} {status: completed} (Schleifenende) bzw. {status: aborted} (Benutzer-Stopp)
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
├─ .github/workflows/           # ci.yml, plugin.yml, oracle.yml, reference.yml, nightly.yml – ohne AWS-Zugang (E1, 18)
├─ legacy/
│  └─ astro-tools-2026-09-21/   # unveränderte Kopie der Website-Astro-Tools (Kopiervorlage, nicht ausgeliefert)
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
│  │  │  ├─ time/               # JD, ΔT, TT/TDB, UTC, Zeitzonen-Offsets (Übergangstabelle vom Server, NT-02; kein Intl)
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
│  ├─ shared/                   # zod-Schemas (Vertragsquelle), DTO-Typen, Berechtigungsmatrix, Fehlercodes, Enums, Konstanten, `buildPlanInput`, `currentNight` (NT-01);
│  │                            # daraus generiert: contracts/*.schema.json (PlanInput, NightPlan, Effort, CaptureBatch, Export)
│  ├─ db/                       # Kysely-Typen, Migrationen, Migration-Runner, Repositories, DSQL-Verbindung
│  ├─ ui-tokens/                # Design-Tokens --npm-* nach Vorbild svenesis.org (Kopie, 11.3)
│  └─ catalog-data/             # Katalog- und Sterndaten (Kopie aus astro-tools/data + dso-catalog.js, CC BY-SA 4.0)
├─ apps/
│  ├─ web/                      # React-SPA (Vite), base '/'
│  ├─ api/                      # Lambda-Handler (ein Paket): api (Hono, alle Routen), worker (Job-Dispatcher), migrate, ops-cli; local.ts
│  └─ nina-plugin/              # C#-Lösung (.sln): Core (net8.0) · Adapter (net8.0-windows, ohne XAML) · Ui (WPF) ·
│                               # NINA über NuGet NINA.* (10.5, ADR-S2c), bindet engine.iife.js ein
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
   ├─ nina-build-check.sh       # NINA.*-Pakete in NinaVersion, Plugin-Ausgabe nur mit eigenen DLLs, keine DLL im Git (10.5)
   ├─ engine-bundle/            # pnpm engine:bundle → engine.iife.js, pnpm engine:parity → Hash-Erwartung für Jint (AP-08c)
   ├─ discord-mock/             # lokaler Webhook-Empfänger für Discord-Tests
   ├─ deploy/                   # lokale Skripte mit Svens Admin-Profil (E1, 18): deploy-prod.ts (`pnpm deploy:prod`),
   │                            # test-dsql.ts (`pnpm test:dsql`, kurzlebiger Cluster, auch Spike AP-S1); Claude Code führt sie nie aus
   ├─ smoke/                    # Smoke-Prüfung nach jedem prod-Deploy (17): /, /api/health, /catalog/…, Auth-Redirect, CSP (CC5-17)
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
| Zeit | intern UTC-ISO-Strings bzw. epoch ms; Nacht als `YYYY-MM-DD` (Abend am Standort). **Aktuelle Nacht** nur über `currentNight(site, now)` (NT-01): Nacht mit `noonStartUtc ≤ now < noonEndUtc` (fehlt sie und ist `now < nights[0].noonStartUtc`, gilt `nights[0]`); ist deren `nightWindowEndUtc ≤ now` (Spalte der Nacht-Tabelle), gilt die folgende Nacht – nur aus der Tabelle gerechnet, gleiche Testvektoren in TS (`packages/shared`) und C# (`NinaPm.Core`), gilt für „Heute Nacht“, Plugin-Start und Jobs. **Datumsfelder mit Standortbezug** (`start_date`, `due_date`, `request_period_*`, Bericht-/Logbuch-`from`/`to`) sind Nacht-Schlüssel, ohne Standortbezug gilt die Mandantenzeit (NT-04); im Browser nie `new Date('YYYY-MM-DD')` (11.1) |
| Fehler | RFC 9457 Problem Details, stabile Fehlercodes in `shared/errors.ts` |
| Commits | Conventional Commits; jede Änderung mit Anforderungs-ID im PR-Text |

---

## 4. AWS-Infrastruktur mit CDK

### 4.1 Stacks

| Stack | Inhalt | Abhängigkeiten |
|---|---|---|
| `NinaPm-Data` | Aurora-DSQL-Cluster (`aws_dsql.CfnCluster`, **Löschschutz aktiv** und `RemovalPolicy.RETAIN`, Tag `purpose=prod`), S3-Bucket `svenesis-nina-pm-data` (privat, SSE-S3, Versionierung, Lifecycle, `RemovalPolicy.RETAIN`), **AWS-Backup-Plan** für DSQL: täglich, Aufbewahrung 35 Tage, **Standard-Vault** (`Default`), Auswahl **per Cluster-ARN** (nach einem Restore stellt der Import-Modus den neuen ARN ein), Alarm nur auf `NumberOfBackupJobsFailed > 0` (16.2). Eigener Vault, Vault-Zugriffspolitik und Deny-Anweisungen gegen die Deploy-Rolle entfallen (SV-15) – vor versehentlichem Löschen schützen Löschschutz und `RETAIN`, vor Datenfehlern die Sicherungen. **Import-Modus (DAT5-16):** Der Kontextwert `dsqlClusterId` (`cdk deploy -c dsqlClusterId=…`) schaltet den Stack auf „vorhandenen Cluster übernehmen“: der `CfnCluster` wird dann **nicht** erzeugt, sondern der Endpunkt aus der übergebenen ID gebildet und in `/nina-pm/dsql-endpoint` geschrieben. Ohne den Kontextwert erzeugt der Stack den Cluster wie bisher. Dieser Schalter ist der Weg, den das Restore-Runbook (6.10) benutzt; ohne ihn müsste nach einem Restore der ganze Datenstack neu gebaut werden | – |
| `NinaPm-Config` | Referenzen auf die SSM-SecureString-Parameter `/nina-pm/discord/client-secret`, **`/nina-pm/oauth/cookie-secret`** (Signaturschlüssel des OAuth-Zwischen-Cookies, SV-02; ersetzt `jwt/signing-keys`, ohne Rotationsverfahren) und `/nina-pm/system/alarm-webhook` (optional) – werden **einmalig per AWS CLI** mit dem Standardschlüssel `alias/aws/ssm` angelegt (H-05), da CloudFormation keine SecureString-Parameter erzeugen kann; kein kundenverwalteter KMS-Schlüssel (SV-13). **Origin-Verify als ein Wert** in `/nina-pm/origin-verify` (String): CloudFront sendet ihn als Origin-Header, die Lambda liest ihn über den SSM-Cache und vergleicht; ein Wechsel ist „neuen Wert schreiben + `pnpm deploy:prod`“, eine kurze Phase mit `403` wird in Kauf genommen (kein Vorgängerwert, keine Rotationsprozedur, SV-16). Der Wert ist kein Geheimnis im engeren Sinn, nur Schutz vor Direktaufrufen. DSQL-Endpunkt als Parameter `/nina-pm/dsql-endpoint` (erleichtert Restore in einen neuen Cluster, 6.10); nicht geheime Parameter (String): `/nina-pm/discord/client-id`, `/nina-pm/bootstrap-super-users` (kommagetrennte Discord-IDs, 5.4) | – |
| `NinaPm-Bootstrap` | **entfällt (E1/SV-13, 21.09.2026).** Kein GitHub-OIDC-Provider, keine GitHub-Rollen, keine Deploy-Grenze, keine Aufrufrolle für den Notfallzugang. Die Erst-Einrichtung ist der **Standard-`cdk bootstrap`** (ohne `--cloudformation-execution-policies`, ohne Grenze) mit Svens Admin-Profil (H-04) | – |
| `NinaPm-Cert` | **us-east-1**: ACM-Zertifikat `nina-pm.svenesis.org`, DNS-Validierung über Route-53-Zone `svenesis.org` | – |
| `NinaPm-Migrate` | Lambda `migrate` + `triggers.Trigger` (läuft bei jedem Deploy **vor** dem neuen Code) mit Rolle `NinaPmMigrate` (`dsql:DbConnectAdmin` auf den Cluster-ARN). `migrate` verbindet als DSQL-Admin und führt **Migration 0000** (DB-Rollen `app_rw`/`app_job`, `AWS IAM GRANT`s, Schema-Rechte) idempotent **selbst** aus, danach alle offenen Migrationen (6.8). Eine eigene `db-bootstrap`-Lambda und die DB-Rolle `app_migrate` gibt es nicht mehr (SV-13/SV-14). Rollen: `specs/infra/iam.md` | Data, Config |
| `NinaPm-Api` | HTTP API, Lambda `api` (alle Routen inkl. `GET /api/health`) mit eigener Rolle `NinaPmApi`, Log-Gruppe (90 Tage), Routen-Throttling und **Zugriffsprotokoll** der HTTP API (JSON, IP gekürzt) | Migrate, Config |
| `NinaPm-Jobs` | Lambda `worker` mit eigener Rolle `NinaPmWorker`, vier EventBridge-Scheduler-Zeitpläne in der Gruppe `nina-pm` (13) über das CDK-Ziel **`LambdaInvoke`** (die Aufrufrolle legt CDK selbst an; keine eigene Scheduler-Rolle, SV-13), `EventInvokeConfig` (Wiederholungen 0, `onFailure` → SQS `nina-pm-worker-failures` mit SSE-SQS, Aufbewahrung 14 Tage und `enforceSSL`; `sqs:SendMessage` per `queue.grantSendMessages(worker)`) | Migrate, Config |
| `NinaPm-Web` | S3-Bucket `svenesis-nina-pm-web` (SPA unter `/`, Katalogdaten/-bilder unter `/catalog/`) | – |
| `NinaPm-Edge` | CloudFront-Distribution `nina-pm.svenesis.org` (OAC, Behaviors, CloudFront Function `nina-pm-viewer-request`, Response-Headers-Policy), Route-53-Alias A/AAAA, SSM-Parameter `/nina-pm/web/build-id` mit dem aktuellen `buildId` (DAT5-6); `BucketDeployment` der SPA mit `distribution` (Invalidierung von `/index.html`), **`prune: false`** (alte gehashte Chunks bleiben für offene Tabs); **zweites `BucketDeployment`** für die Beispielsequenzen des Plugins nach `downloads/nina-sequences/<pluginVersion>/` (ebenfalls `prune: false`), das mit dem lokalen Deploy läuft (E1, 12). **Keine Lifecycle-Löschung auf `assets/*`** (S3 kennt nur das Erstellungsalter, nicht „abgelöst“ – sonst verschwinden nach 30 Tagen ohne Deploy die aktiven Chunks, DAT-4): Die SPA liegt unter `assets/<buildId>/…`, und der `weekly`-Job löscht alle Build-Präfixe außer den letzten **drei**; `catalog/*` wird nie vom Deployment berührt, unter `downloads/*` schreibt nur das zweite `BucketDeployment` (ohne zu löschen) | Cert (`crossRegionReferences`), Api, Web |
| `NinaPm-Ops` | Lambda `ops-cli` (Notfallzugang, 5.4) mit Rolle `NinaPmOpsCli` – **keine** Route, keine Funktions-URL, keine ressourcenbasierte Politik: aufrufbar ist sie nur per `aws lambda invoke` mit Svens Admin-Profil, und keine andere Lambda erhält ein Invoke-Recht darauf (SV-13). CloudWatch-Alarme (16.2), Route-53-Health-Check auf **`https://nina-pm.svenesis.org/api/health`** (einzige Health-Route; über CloudFront, nicht direkt auf die HTTP API – sonst fehlt `X-Origin-Verify` und der Check schlägt immer fehl; ohne DB-Ping, drei Regionen ⇒ ~130.000 Aufrufe/Monat, DAT-14/DAT5-9), SNS-Topic (E-Mail) für die Alarme, Budget-Alarm. **Kein CloudTrail-Trail** (SV-15; die kostenlose CloudTrail-Ereignishistorie der letzten 90 Tage genügt für Rückfragen) | alle |

### 4.2 Wesentliche Ressourcen und Einstellungen

| Ressource | Einstellung |
|---|---|
| Lambda (alle) | arm64, Node LTS, `NODE_OPTIONS=--enable-source-maps`, Powertools Logger/Metrics, Log-Aufbewahrung 90 Tage |
| `api` | 1024 MB, Timeout 29 s, **reservierte Parallelität 20** (begrenzt Kosten und DSQL-Verbindungen – Pool 2 je Container ⇒ höchstens 40 – und verhindert, dass Browser-Last den Nachtbetrieb verdrängt, SEC-15); Rolle `NinaPmApi`; Engine/Plan-Code per Lazy-Import (Kaltstart der CRUD-Pfade klein); SSM-Werte mit **TTL-Cache 5 min** (nicht nur beim Start – sonst kennen warme Container einen neuen Origin-Verify-Wert oder eine geänderte Super-User-Liste nicht, DAT-5) |
| `worker` | 2048 MB, Timeout 15 min, **reservierte Parallelität 5** (Jobs sind idempotent und dürfen nachlaufen); Rolle `NinaPmWorker`; Aufruf asynchron mit `{jobId}` bzw. vom Zeitplan mit `{tick}`; Dispatcher je `job.kind` |
| `migrate` | 512 MB, Timeout 15 min; Rolle `NinaPmMigrate` (`dsql:DbConnectAdmin` auf den Cluster-ARN). Verbindet als DSQL-Admin, führt Migration 0000 (Rollen, Grants) idempotent und danach alle offenen Migrationen aus (6.8, SV-13/SV-14) |
| `db-bootstrap` | **entfällt (SV-13, 21.09.2026)** – Migration 0000 läuft in `migrate` |
| `ops-cli` | 256 MB, Rolle `NinaPmOpsCli` (`dsql:DbConnect` → DB-Rolle `app_rw`); nur per `aws lambda invoke` mit Svens Admin-Profil (keine Route, keine URL, keine ressourcenbasierte Politik, kein Invoke-Recht für andere Lambdas). Jeder Aufruf schreibt `system_audit` (Akteur `ops_cli`, 5.4) |
| HTTP API | Stage `$default`, Throttling 50 rps / Burst 100; Routen-Drosselung `ANY /api/nina/v1/{proxy+}` 20 rps/Burst 40, **`GET /api/auth/discord/{proxy+}`, `POST /api/auth/invitation/claim` und `POST /api/auth/invitations/preview` je 5 rps/Burst 10** (Anmeldung und Einladungen; `/auth/me`, `/auth/context`, `/auth/logout` und `/auth/sessions` laufen unter der Stage-Drosselung), **`GET /api/health` 5 rps/Burst 10** (einzige Health-Route, ohne DB, Ziel des Route-53-Checks, der ≈ 0,05 rps braucht; einheitlich mit `iam.md`, SV-19), `ANY /api/{proxy+}` → alle auf `api`. Zugriff nur über CloudFront (Header `X-Origin-Verify`, in Lambda-Middleware geprüft). **Eine HTTP API (API Gateway v2) unterstützt keine Ressourcenpolitik und keine WAF-Bindung**, und **AWS WAF wird auch an der CloudFront-Distribution nicht eingesetzt** (entschieden 17.09.2026: ≈ 6 $/Monat gegen ein Budget von 20 €). Der Schutz gegen Direktaufrufe der `execute-api`-Adresse ist damit: Origin-Verify, Drosselung, reservierte Parallelität und Budget-/Throttle-Alarm (`specs/infra/iam.md`). Die Drosselung wirkt **nur** am Gateway; eine zweite Stufe in der Anwendung gibt es nicht (SV-06). Zugriffsprotokoll im JSON-Format mit gekürzter IP |
| DSQL | Single-Region-Cluster (Löschschutz, `RETAIN`); **zwei** Anwendungs-DB-Rollen: `app_rw` (Lambda `api` und `ops-cli`) und **`app_job`** (Lambda `worker`) – getrennt, weil `worker` fremde Eingaben verarbeitet (Importe, Kataloge, Ergebnisdateien) und damit weder Sitzungen noch NINA-Tokens erreichen soll (SV-14). Mapping per `AWS IAM GRANT` – **drei** Grants: `app_rw` → `NinaPmApi`, `app_rw` → `NinaPmOpsCli`, `app_job` → `NinaPmWorker`; angelegt in Migration 0000 durch `migrate`, das selbst als DSQL-Admin verbindet (keine DB-Rolle `app_migrate`, kein `db-bootstrap`, SV-13/SV-14). `dsql:DbConnect` bzw. `DbConnectAdmin` ist in allen Rollen auf den Cluster-ARN begrenzt. Es gibt **keine** Rolle `NinaPmDbAccess` und **keine** DB-Rolle `app_ro` |
| S3 `data` | Block Public Access, Versionierung, `RETAIN`; Präfixe `tenant/<tenantId>/results/…`, `…/exports/…`, `…/imports/…`, `…/jobs/…`, `…/plans/…`; Lifecycle: `exports/`/`imports/` 7 Tage, `jobs/` 2 Tage, `plans/` 400 Tage (Aufbewahrung der Planprotokolle, fachlich) – umgesetzt über das Objekt-Tag `npm-retention=<Tage>d` (beim Schreiben bzw. per `eq $tagging` im presigned POST gesetzt; ein Präfixfilter je Kategorie geht nicht, weil der Schlüssel mit der Mandanten-ID beginnt), dazu alte Versionen und Löschmarker nach 30 Tagen und abgebrochene Uploads nach 1 Tag; `results/` bleibt unbefristet. Mandanten-Löschen (FA-MAN-03) entfernt jede Version und jeden Löschmarker unter `tenant/<id>/`. Rechte per CDK-Grant: `api` `grantRead` + `grantPut` auf `tenant/*` (kein Löschen – das erledigen die Lebenszyklusregeln), `worker` `grantReadWrite` auf `tenant/*` (SV-13) |
| S3 `web` | nur über CloudFront (OAC); `index.html` no-cache, gehashte Assets 1 Jahr Cache-Control (keine Lifecycle-Expiration; Aufräumen über den `weekly`-Job, letzte 3 Builds), `/catalog/img/*` und `/catalog/thumbs/*` Cache 30 Tage, `/downloads/*` 1 Tag |
| EventBridge Scheduler | 4 Zeitpläne in UTC (`tick-5min`, `tick-hourly`, `daily`, `weekly`) in der Gruppe `nina-pm` → `worker` über das CDK-Ziel `LambdaInvoke` (Aufrufrolle von CDK erzeugt); Jobs sind idempotent |
| IAM | **Eine Ausführungsrolle je Lambda** (`NinaPmApi`, `NinaPmWorker`, `NinaPmMigrate`, `NinaPmOpsCli`), vergeben **über CDK-Grants** statt handgeschriebener JSON-Politiken (SV-13); die Zuordnung steht in **`specs/infra/iam.md`**. Regel: **keine `*`-Ressourcen** auf DSQL, S3, SSM und Lambda-Invoke, **keine Managed Policies** an Lambda-Rollen außer `AWSLambdaBasicExecutionRole` (X-Ray per `tracing: ACTIVE` ist erlaubt). CDK-Assertions prüfen das (`iam.md` §12, 18) |
| Alarme | → 16.2 |

### 4.3 Domain und CloudFront

#### Adressen

| Anwendung | API | NINA-Plugin-Basis | Discord-Redirect |
|---|---|---|---|
| `https://nina-pm.svenesis.org/` | `https://nina-pm.svenesis.org/api/` | `…/api/nina/v1` | `https://nina-pm.svenesis.org/api/auth/discord/callback` |

Die Route-53-Zone `svenesis.org` liegt im selben Konto; NINA-PM läuft **nur als prod** in diesem Konto (keine dev-/Staging-Umgebung, OT-04). CDK liest die Zone nur (`HostedZone.fromLookup` ist erlaubt, SV-19) und legt ausschließlich Validierungs- und Alias-Einträge für `nina-pm` an. Bestehende Einträge der Website bleiben unberührt.

#### Distribution (vollständig CDK)

| Reihenfolge | Pfadmuster | Origin | Cache-Policy | Origin-Request-Policy | Viewer-Request-Funktion | Response-Headers-Policy | Sonstiges |
|---|---|---|---|---|---|---|---|
| 0 | `/api/*` | HTTP API (`<id>.execute-api.eu-central-1.amazonaws.com`) | *CachingDisabled* | *AllViewerExceptHostHeader* | – | **`npm-api-static`** | alle Methoden; Custom Header `X-Origin-Verify` |
| 1 | `/catalog/*` | S3 `svenesis-nina-pm-web` (OAC) | *CachingOptimized* | – | – | **`npm-api-static`** | Katalog- und Projekt-Vorschaubilder |
| 2 | `/downloads/*` | S3 `svenesis-nina-pm-web` (OAC) | *CachingOptimized* | – | – | **`npm-api-static`** | Beispielsequenzen (FA-NIN-25) |
| Default | `*` | S3 `svenesis-nina-pm-web` (OAC) | *CachingOptimized* | – | `nina-pm-viewer-request` (SPA-Rewrite) | **`npm-html`** | – |

**Jedes** Behavior trägt eine Response-Headers-Policy (SEC-16): `npm-html` mit vollständiger CSP und HSTS für die Anwendung, `npm-api-static` mit HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Resource-Policy` **und einer harten CSP** (`default-src 'none'; sandbox; frame-ancestors 'none'; base-uri 'none'`) für API, Katalog und Downloads – `/catalog/*` und `/downloads/*` liegen auf demselben Origin wie die Anwendung, ein dort abgelegtes HTML-Objekt liefe sonst als Seite der Anwendung (SV-16). Ein erzwungenes `Content-Disposition` gibt es nicht. Vorher galten die Header nur auf dem Default-Behavior; `/downloads/*` (JSON-Beispielsequenzen) und `/api/*` (Problem-Details-JSON) liefen damit ohne `nosniff` und ohne HSTS. Der Wortlaut beider Politiken steht in `specs/infra/iam.md` §10.

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

Es gibt genau **eine** Umgebung: prod. `infra/config.ts` enthält Account, Region, Domain `nina-pm.svenesis.org`, Hosted Zone, Namen der SSM-Parameter (4.1; die Werte selbst stehen nur in SSM), Log-Aufbewahrung, Löschschutz, Alarm-E-Mail. Deployment ausschließlich **lokal durch Sven** mit `pnpm deploy:prod` und seinem Admin-Profil (E1, 18); GitHub hat keinen AWS-Zugang. Claude Code nutzt lokal höchstens `pnpm cdk synth` und deployt nie.

Absicherung ohne Vorab-Umgebung:

- **Lokal statt dev:** Web, API (Hono per Node-Adapter) und PostgreSQL 16 laufen lokal (6.9); dort laufen auch Test-Login und Playwright-E2E (17).
- **Kurzlebiger Test-DSQL-Cluster** für DSQL-spezifische Integrationstests (`pnpm test:dsql`, 17): läuft **lokal auf Svens Rechner** mit Admin-Profil, legt den Cluster (Tag `purpose=ci`) je Lauf an und löscht ihn im `finally`; enthält nie Echtdaten und ist keine Umgebung mit Anwendung (E1).
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
  `https://nina-pm.svenesis.org/api/auth/discord/callback` – **kein** `localhost`-Redirect an der produktiven Anwendung; lokal gilt der Test-Login (17).
- Scope **`identify`** (liefert `id`, `username`, `global_name`, `avatar`, `mfa_enabled`). `email` nur, wenn später benötigt.
- Vertraulicher Client (Client-Secret nur in SSM). Das Discord-Access-Token wird **nicht gespeichert** und nach dem Abruf von `/users/@me` verworfen.

### 5.2 Anmeldeablauf

```
Browser                      api (/auth)                             Discord
  │ (bei Einladungslink zuerst: POST /api/auth/invitation/claim {token}
  │   → setzt __Host-npm_invite, HttpOnly, 15 min, signiert; Antwort nur {tenantName, role})
  │ GET /api/auth/discord/start?next=/…&mandant=xy
  │───────────────────────────▶│ state = random(32), code_verifier = random(32) (PKCE, SV-02);
  │                            │   Cookie __Host-npm_oauth (HttpOnly, 10 min, enthält state, code_verifier,
  │                            │   next, mandant – signiert mit /nina-pm/oauth/cookie-secret);
  │                            │   das Einladungs-Token steht NUR im Cookie, nie in einer URL (DAT5-15)
  │◀── 302 discord.com/oauth2/authorize?client_id…&scope=identify&state…&redirect_uri…
  │        &code_challenge=BASE64URL(SHA-256(code_verifier))&code_challenge_method=S256
  │──────────────────────────────────────────────────────────────────▶│ Login/Consent
  │◀──────────────────────────────── 302 /api/auth/discord/callback?code&state
  │───────────────────────────▶│ 1. Cookie-Signatur prüfen, state gegen Cookie prüfen
  │                            │ 2. POST discord.com/api/oauth2/token (code + code_verifier → access_token)
  │                            │ 3. GET  discord.com/api/users/@me
  │                            │ 4. identity upsert (discord_user_id), mfa_enabled und last_login_at aktualisieren;
  │                            │    identity.status = blocked → /kein-zugang
  │                            │ 5. Cookie __Host-npm_invite vorhanden? → prüfen (nicht widerrufen, nicht abgelaufen,
  │                            │    used_count < max_uses, ggf. discord_user_id passt, Mandant aktiv),
  │                            │    app_user anlegen, used_count++; Rolle 'owner' → role=admin und
  │                            │    tenant.owner_member_id setzen (nur wenn leer; Mandant hat schon einen
  │                            │    Owner → 404 invitation.invalid, Einladung bleibt unverbraucht)
  │                            │ 6. aktive Mitgliedschaften aktiver Mandanten + super_user laden
  │                            │    (Bootstrap: Discord-ID in SSM-Liste und noch kein super_user →
  │                            │    anlegen, system_audit Aktion super_user.bootstrap, 5.4)
  │                            │    0 → ctx=select, Weiterleitung /kein-zugang
  │                            │    1 (oder mandant passt) → ctx=tenant
  │                            │    >1 → ctx=select, Weiterleitung /mandant-waehlen
  │                            │ 7. sid = random(32); auth_session anlegen (session_hash = SHA-256(sid)),
  │                            │    Cookie __Host-npm_sid setzen, __Host-npm_oauth/__Host-npm_invite löschen
  │◀── 302 next (nur relative Pfade derselben Anwendung zulässig)
```

- **Einladungs-Token:** 256 Bit zufällig (base64url), nur SHA-256 gespeichert (`invitation.token_hash`); der Klartext steht nur im Link und im Cookie `__Host-npm_invite`.
- **Owner-Einladung (FA-BEN-03, FA-SU-05):** Hat der Mandant bereits einen Owner, lehnen `POST /auth/invitation/claim` und das Einlösen im Callback (Schritt 5) eine Einladung mit Rolle `owner` mit `404 invitation.invalid` ab. Einen Owner neu zuweisen kann nur der Super User über `PUT /system/v1/tenants/{id}/owner` (5.5). Owner- und Admin-Einladungen gelten für genau **eine** Nutzung (Schema: `CHECK (role = 'user' OR max_uses = 1)`); nur User-Einladungen dürfen mehrfach nutzbar sein.
- **`next`:** nur ein relativer Pfad derselben Anwendung, der `^/(?![/\\])` erfüllt – `//host/…` und `/\host/…` (von Browsern als fremder Host gelesen) werden verworfen, dann gilt `/`.
- **Kontextwechsel:** `POST /api/auth/context {tenantKey | "system"}` prüft Mitgliedschaft bzw. Super-User + `identity.mfa_enabled` und schreibt `tenant_id`/`context` in **dieselbe** Sitzungszeile (kein neues Cookie, kein Token, SV-01). Beim Wechsel in einen Mandanten setzt er `app_user.last_login_at` (letzte Anmeldung im Mandanten, FA-SU-03); ebenso der Callback, wenn er den Mandanten direkt wählt (Schritt 6).
- **2FA-Regel (fest, SV-03, FA-LOG-07):** Owner- und Admin-Rechte wirken nur, wenn das Discord-Konto 2FA hat (`identity.mfa_enabled`, Stand der letzten Anmeldung). Ohne 2FA behandelt die Middleware das Mitglied wie einen User (`ctx.role = 'user'`, `ctx.mfaRequired = true`); `GET /auth/me` meldet das, die Oberfläche zeigt den Hinweis `auth.mfa_required`. Die gespeicherte Rolle bleibt unverändert – nach der nächsten Anmeldung mit 2FA wirken die Rechte wieder. Das gilt ohne Ausnahme auch für den Owner. Es gibt **keinen** Mandantenschalter (`mfaRequiredForAdmins` entfällt). Der System-Kontext verlangt ebenfalls 2FA (5.4).
- **`mfa_enabled`** ist nur zum Anmeldezeitpunkt bekannt; es gilt der Stand der letzten Discord-Anmeldung. Eine zusätzliche Zeitgrenze für System-Kontext oder Owner-Aktionen gibt es nicht mehr (SV-01).

### 5.3 Sitzungen und Cookies

| Cookie | Inhalt | Lebensdauer | Attribute |
|---|---|---|---|
| `__Host-npm_sid` | Sitzungs-ID, 256 Bit zufällig (base64url); in `auth_session` nur als SHA-256 (`session_hash`) | gleitend **14 Tage Inaktivität**, höchstens **30 Tage** ab Anmeldung (feste Konstanten) | host-only (`nina-pm.svenesis.org`), HttpOnly, Secure, SameSite=Lax, Path=/ |
| `__Host-npm_oauth` | signierter OAuth-Zwischenstand (`state`, PKCE-`code_verifier`, `next`, `mandant`) | 10 min | host-only, HttpOnly, Secure, SameSite=Lax, Path=/ |
| `__Host-npm_invite` | signiertes Einladungs-Token (5.2, DAT5-15) | 15 min | host-only, HttpOnly, Secure, SameSite=Lax, Path=/ |

Signiert werden `__Host-npm_oauth` und `__Host-npm_invite` mit HMAC-SHA-256 und dem Wert aus `/nina-pm/oauth/cookie-secret` (SV-02); ein Wechsel des Werts macht nur laufende Anmeldungen ungültig und braucht kein Rotationsverfahren.

```ts
// packages/shared/src/auth.ts – Ergebnis der Sitzungsprüfung je Anfrage (kein Token, kein Cache)
export interface AuthContext {
  identityId: string; sessionId: string; ctx: 'tenant' | 'system' | 'select';
  tenantId: string | null; memberId: string | null;
  role: 'admin' | 'user' | null;   // wirksame Rolle: ohne 2FA 'user' (SV-03)
  isOwner: boolean; isSuperUser: boolean; mfa: boolean; mfaRequired: boolean;
}
```

- **Prüfung je Anfrage (SV-01):** Die Middleware bildet SHA-256 des Cookie-Werts und liest in **einer** indizierten Abfrage (`auth_session.session_hash` ist `UNIQUE`) die Sitzung, die Mitgliedschaft im Sitzungsmandanten (Rolle, Status, Owner), `identity.status`, `identity.mfa_enabled`, `tenant.status` und im System-Kontext `super_user.status`. **Kein Cache.** Ergebnis: keine oder abgelaufene Sitzung → `401 auth.unauthenticated`; Identität gesperrt → `403 auth.identity_blocked`; Mandant gesperrt → `403 tenant.locked`; Mitgliedschaft nicht mehr aktiv → Kontext `select`. Rollenwechsel, Deaktivierung, Sperre und Widerruf wirken damit **ab der nächsten Anfrage**.
- **Ablauf:** Konstanten `SESSION_IDLE_DAYS = 14` und `SESSION_MAX_DAYS = 30` in `packages/shared`. Eine Sitzung gilt, solange `last_seen_at > jetzt − 14 Tage` und `expires_at > jetzt` (`expires_at = created_at + 30 Tage`, nie verlängert). `last_seen_at` wird höchstens einmal je 5 min geschrieben; ein OCC-Konflikt bei diesem Schreiben wird ignoriert (die Anfrage selbst scheitert daran nicht). Nach Ablauf meldet sich der Benutzer neu über Discord an.
- **Abmelden und Widerrufen:** `POST /auth/logout` löscht die Sitzungszeile und das Cookie; `DELETE /auth/sessions/{id}` bzw. „überall abmelden“ löscht Zeilen der eigenen Identität, `DELETE /web/v1/members/{id}/sessions` und `ops-cli revoke-sessions` die einer anderen. Die Wirkung ist **sofort**, weil jede Anfrage die Zeile liest.
- **Aufräumen:** Bei jeder Anmeldung löscht `api` bis zu 500 abgelaufene Zeilen (Index auf `expires_at`, dazu Leerlauf über `last_seen_at`); `worker` erhält keinen Zugriff auf `auth_session` (6.2).
- **Sitzungsliste statt Anmeldeprotokoll (SV-11):** `GET /auth/sessions` zeigt die eigenen Sitzungen (Gerät aus `user_agent`, gekürzte IP, `created_at`, `last_seen_at`); zusammen mit `identity.last_login_at` ersetzt das das frühere `login_audit`.
- **Frontend-Verhalten:** Es gibt **keinen** Refresh-Aufruf. `401 auth.unauthenticated` → Anmeldeseite mit `next` = aktueller Pfad (11.4).
- **CSRF (verbindlich, SV-04):** **jede nicht-GET-Methode** unter `/api/auth`, `/api/web/v1` und `/api/system/v1` – auch anonyme wie `POST /auth/invitation/claim` und `POST /auth/invitations/preview` – verlangt zwei Bedingungen: (1) `SameSite=Lax` am Sitzungs-Cookie, (2) Pflicht-Header `X-NPM-Request: 1` – der Browser kann ihn cross-site nicht ohne CORS-Preflight setzen, und CORS ist für die API nicht freigegeben (Web-App und API teilen den Origin). Fehlt der Header, antwortet die Middleware `403 auth.csrf_missing`. Die GET-Routen des Anmeldeablaufs (`/auth/discord/start`, `/auth/discord/callback`) kommen als Top-Level-Navigation und sind als GET ohnehin nicht betroffen. Ausgenommen ist nur die NINA-API (`/api/nina/v1`, Bearer-Token, kein Cookie). Eine zusätzliche Herkunftsprüfung über `Origin`/Fetch-Metadata-Header gibt es nicht.
- **Origin-Verify:** ein Wert in `/nina-pm/origin-verify`; Wechsel per neuem Wert und Deploy, ohne Vorgängerwert (4.1, SV-16).
- **Entfallen (SV-01, 21.09.2026):** Access-JWT und seine Signaturschlüssel samt Schlüsselwechsel, Refresh-Token mit Rotation, Karenz, Wiederverwendungserkennung und Sitzungsfamilie, Mitglieds-Versionszähler, Status-Cache und gemeinsamer Refresh im Frontend.

### 5.4 Super User und Notfallzugang

- **Bootstrap (SV-17):** `api` liest den SSM-Parameter `/nina-pm/bootstrap-super-users`; beim ersten Login einer gelisteten Discord-ID mit 2FA wird `super_user` angelegt (`created_by = null`, `system_audit` mit Aktion `super_user.bootstrap`). Der Parameter bleibt einfach stehen – wer ihn schreiben kann, hat ohnehin Admin-Rechte im AWS-Konto (Leitlinie 2, 15); keine Sonderrechte, kein Alarm, kein Leeren nach dem ersten Login.
- **Voraussetzung System-Kontext:** `mfa_enabled = true` (FA-SU-02).
- **Keine fachlichen Aktionen im Mandanten (E3):** Im System-Kontext erlaubt `can()` nur `system.*`; Mandantendaten sieht der Super User nur über die Routen von S-80 … S-82 (Mandanten, Mitgliederliste mit Anzeigename/Rolle/Status für die Owner-Neuzuweisung, Protokolle). Sonderregeln für Owner-Einladungen aus dem System-Kontext gibt es nicht (7.2).
- **Notfallzugang (FA-SU-06, NFA-20):** Lambda `ops-cli`, nur per `aws lambda invoke` mit Svens Admin-Profil aufrufbar (keine Route, keine URL, keine Aufrufrolle; SV-13). Befehle (SV-17): `help`, `create-tenant --key … --name …`, `create-invitation --tenant … --role owner|admin`, `set-owner --tenant … --member …`, `grant-super-user --discord-id …`, `block-identity --discord-id …`, `revoke-sessions --identity …`, `seed --tenant test` (Demo-Daten aus `docs/seed/`), `list-failed-jobs` (liest zusätzlich die Warteschlange `nina-pm-worker-failures`), `export-setup` (nur lesen, nur Test-Mandant: Aufbau und Mengen der Auswertungsdaten als JSON, lokal `pnpm demo:export`), `demo-evaluation` (nur Test-Mandant: Auswertungsdaten löschen und 90 Nächte passende Demodaten erzeugen, in Schritten `plan`/`clear`/`projects`/`nights`/`finish`; lokal `pnpm demo:evaluation [--dry-run]` mit Rückfrage). Jeder Aufruf schreibt `system_audit` mit Akteur `ops_cli`, Befehl und Ziel.

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
  | 'member.manage' | 'member.admin.manage' | 'member.leave' | 'tenant.owner.transfer'
  | 'tenant.settings' | 'tenant.export' | 'tenant.import' | 'system.manage' | 'system.tenant.owner'
  | 'changeRequest.create' | 'changeRequest.update' | 'transit.lock' | 'session.report.resend'
  | 'notification.read' | 'me.preferences' | 'me.favorites' | 'job.read'
  | 'public';                                   // öffentliche Routen (Auth-Start/-Callback, Einladungs-Vorschau, Health)

export function can(ctx: AuthContext, action: Action, res?: ResourceMeta): boolean
// z. B. project.update: admin → true; user → res.createdBy === ctx.memberId
//                        && ['draft','returned'].includes(res.approvalStatus)
// member.manage:        admin → res.targetRole === 'user' && !res.targetIsOwner
// member.admin.manage, tenant.owner.transfer: ctx.isOwner && ctx.mfa
//                        && res?.targetMemberId !== ctx.memberId   (Owner ändert sich nie selbst)
// ohne 2FA ist ctx.role = 'user' und ctx.mfa = false (SV-03) – Admin- und Owner-Aktionen scheitern damit von selbst
// project.status (auch Wiederherstellen aus dem Papierkorb, E4): admin
// member.leave:         !ctx.isOwner
// transit.lock:         admin → true; user → res.createdBy === ctx.memberId && res.approvalStatus === 'approved'
//                        && res.openLocks < settings.exoUserMaxOpenLocks (Standard 3)
//                        (vor Freigabe nur Status 'requested'; exoUserLockNeedsAdmin, Standard true → bleibt 'requested' bis Bestätigung)
// changeRequest.update: Antragsteller (status open) oder admin
// session.correct:      admin → true; user → eigenes Objekt && tenant.settings.userCorrections
// Jede Aktion mit Ziel = Owner ist für alle Mandanten-Rollen verboten (nur system.tenant.owner)
```

- Jede Route deklariert ihre Aktion (`route.meta.action`, auch rein persönliche Routen wie Favoriten; öffentliche Routen explizit `public`); Middleware erzwingt `can()` vor dem Handler. Ein Test generiert für **jede Route × {Owner, Admin, User, fremder Mandant, anonym, Super User im System-Kontext}** einen Aufruf, dazu „Admin ohne 2FA“ (muss sich wie User verhalten, SV-03) (NFA-17, 17).
- Das Frontend nutzt dieselbe Funktion (`useCan(action, res)`) nur zum Ein-/Ausblenden.
- **Statusprüfung (SV-01):** Jede Anfrage liest Sitzung, Mitgliedschaft (Rolle, Status, Owner), `identity.status`, `identity.mfa_enabled`, `tenant.status` und im System-Kontext `super_user.status` in **einer** Abfrage ohne Cache (5.3); gesperrte Identität → **`403 auth.identity_blocked`** (die Anmeldung ist gültig, der Zugang verweigert; DAT5-8), gesperrter Mandant → `403 tenant.locked`. Herabstufung, Deaktivierung, „überall abmelden“ und `revoke-sessions` wirken damit ab der nächsten Anfrage; einen Versionszähler an der Mitgliedschaft und eine Nachfrist gibt es nicht.
- **Mandant ohne Owner (FA-BEN-03, E2):** Bis die Owner-Einladung angenommen ist, ist `tenant.owner_member_id` leer; Owner-Aktionen (`member.admin.manage`, `tenant.owner.transfer`) stehen dann niemandem im Mandanten zu. Verfällt die Einladung, erstellt der Super User in S-80 eine neue oder weist einen Owner zu. Einen eigenen Owner-Zustand und einen Hinweis-Job gibt es nicht.
- **Owner-Invarianten** (Repository `MemberRepository`, Transaktion mit OCC-Retry und `SELECT … FOR UPDATE` auf der `tenant`-Zeile als Wächter): `tenant.owner_member_id` zeigt immer auf ein aktives Mitglied mit `role='admin'`; Rollen-/Statusänderungen am Owner und sein Entfernen werden abgelehnt (`409 member.owner_protected`), der Owner kann nicht austreten, solange er Owner ist (`409 member.owner_cannot_leave`), und niemand ändert die eigene Rolle (`409 member.cannot_change_self`). Nur der Owner ernennt und entzieht Admins (E2). **Owner-Übertragung (E2, FA-BEN-09):** Der Owner wählt ein aktives Mitglied mit Rolle Admin und bestätigt im `ConfirmDialog` (11.2); `POST /web/v1/tenant/owner-transfer {memberId}` setzt in **einer** Transaktion `tenant.owner_member_id` sofort auf das Ziel – ohne Annahme durch den Empfänger, ohne Frist, ohne Widerruf. Der alte Owner bleibt Admin; Änderungsprotokoll und `notification(owner.reassigned)` an alle Admins. Ziel kein aktiver Admin → `422 owner_transfer.target_invalid`. **Notfall-Neuzuweisung** durch den Super User (`PUT /system/v1/tenants/{id}/owner`, S-80) – der **einzige** Weg, einen vorhandenen Owner zu ersetzen (eine Owner-Einladung wird bei vorhandenem Owner abgelehnt, 5.2): gleiche Transaktion, der alte Owner wird standardmäßig deaktiviert; mit `invite` statt `memberId` leert dieselbe Transaktion `tenant.owner_member_id` und legt die Owner-Einladung an (bis zur Annahme „Owner ausstehend“). `notification(owner.reassigned)` geht an alle Admins einschließlich des bisherigen Owners. Tests: Admin versucht Owner herabzustufen/zu deaktivieren/zu entfernen, Admin ernennt Admin, Owner überträgt an einen User bzw. an ein deaktiviertes Mitglied, Owner ändert die eigene Rolle, Owner verlässt Mandant – jeweils abgelehnt bzw. korrekt.

- **Super-User-Invariante (FA-SU-06):** Es muss immer mindestens **ein aktiver** Super User bleiben. `DELETE` und `PATCH {status:'inactive'}` auf `/system/v1/super-users/{id}` laufen in einer Transaktion mit `SELECT … FOR UPDATE` über die aktiven Zeilen von `super_user` und werden mit `409 super_user.last_protected` abgelehnt, wenn es die letzte wäre – gleiche Bauart wie die Owner-Invarianten, gleicher Test (letzten Super User entfernen bzw. deaktivieren → 409). Ohne diese Sperre wäre das Konto nur noch über den Notfallzugang (`ops-cli`, 5.4) erreichbar.

### 5.6 NINA-Instanzen

- Token-Format `npm_<base62(32 Bytes)>` (256 Bit), einmalig angezeigt; gespeichert nur `sha256` + Präfix; an genau ein Rig gebunden; nie geloggt (SV-08).
- **Gültigkeit und Ablage (verbindlich, SV-08):** Das Token gilt, **bis es widerrufen wird** – kein Ablaufdatum, keine Verlängerung, kein automatischer Widerruf. `nina_instance.last_seen_at` zeigt in S-42 die letzte Nutzung; ungenutzte Instanzen widerrufen Admins selbst. Das Plugin legt das Token **verschlüsselt** ab (`ProtectedData`/DPAPI, Geltungsbereich `CurrentUser`) und schreibt es nie in Logs, Diagnoseausgaben oder Fehlermeldungen (`execution.md` §8).
- Header `Authorization: Bearer …`; `api` sucht bei **jeder** Anfrage den Hash über den eindeutigen Index `nina_instance.token_hash` (kein Cache) und ermittelt `tenant_id`, `rig_id`; geprüft werden `nina_instance.status = active` (sonst `401 nina.token_invalid`) und `tenant.status = active` (sonst **`403 tenant.locked`**, gleiche Antwort wie im Web-Kontext, DAT5-22; das Plugin behandelt sie als `blocked{tenant_locked}` und beendet die Nacht geordnet). Ein Widerruf wirkt damit **sofort**. `last_seen_at` wird höchstens einmal je 5 min geschrieben. **Aufruf-Ringpuffer (FA-ADM-06, Entscheidung 25.09.2026):** `nina_instance.last_calls = {calls[≤ 20], errors[≤ 20]}`, je Eintrag `{atUtc, method, route, status, code, durationMs}` (Route als Muster, ohne Token und Inhalte), neueste zuerst; erfolgreiche Heartbeats stehen nicht in `calls` (sie zeigen `last_seen_at`/`last_state`), jede Antwort ≥ 400 – auch mit widerrufenem Token – in `errors`. Geschrieben nach der Antwort in einer Transaktion mit `FOR UPDATE`; ein Fehler dabei ändert die Antwort nie.
- Rechte: nur Daten des eigenen Rigs lesen, nur Sessions/Aufnahmen/Ereignisse/Heartbeat dieses Rigs schreiben.
- **Zugehörigkeitsprüfung je Pfadparameter (verbindlich, SEC-53):** Jede `/nina/v1`-Route mit `{sessionId}` filtert zusätzlich `session.tenant_id = token.tenant_id AND session.rig_id = token.rig_id`; trifft das nicht zu, antwortet sie **`404`** (nicht `409` – eine Existenzaussage über fremde Sessions wäre schon zu viel). Die Idempotenz von `POST /sessions` gilt nur für das Paar `(id, rig_id)`. Ohne diese Regel könnte ein Rig-Token mit `PATCH /sessions/{fremde-id} {status:"completed"}` die laufende Nacht eines anderen Rigs beenden (Lease frei, `session_close` und Nachtbericht starten) und über den idempotenten `POST` das Planprotokoll-Ticket der fremden Session erhalten. Isolationstest „Token Rig A auf Session Rig B" je Route.
- **Lease je Rig (FA-RIG-06, Zeitschwellen FK 8.1, Schema 1.9+ `rig_lease`):** Die Lease steht in der eigenen Tabelle **`rig_lease`** (`rig_id` PK, `active_session_id`, `lease_until`, `offline_until`, `released_session_id` – M5) – nicht mehr auf der `rig`-Zeile (DAT5-2). `POST /sessions` macht einen **Upsert** auf `rig_lease` in einer Transaktion mit `SELECT … FOR UPDATE` auf **`rig_lease`** (nie auf `rig`) und setzt `active_session_id` und `lease_until = jetzt + 3 min`; jeder Heartbeat (60 s) mit `sessionId` verlängert `lease_until`. Die Zeile wird beim **Anlegen des Rigs** mit `active_session_id = NULL`, `lease_until = NULL`, `offline_until = NULL` erzeugt (DAT5-19); ein fehlender Datensatz (Altbestand, Import) wird beim ersten `POST /sessions` per `INSERT … ON CONFLICT DO NOTHING` nachgelegt. Hält eine **andere** Session eine gültige Lease → `409 session.rig_busy`; das Plugin plant dann nur (Simulation) und zeigt die Warnung. Sessionende oder Lease-Ablauf gibt das Rig frei (`active_session_id = NULL`).
- **Eigene Session fortsetzen:** Dieselbe Instanz mit derselben `sessionId` (nach Neustart persistiert) erhält die Lease auch nach Ablauf zurück, sofern keine andere Session sie inzwischen hält (`PATCH /sessions/{id}` erneuert). **Auch jeder Heartbeat mit `sessionId` holt sie zurück (M5):** ist `rig_lease.active_session_id IS NULL OR = sessionId`, die Session nicht durch eine Admin-Freigabe ausgeschlossen (`rig_lease.released_session_id IS DISTINCT FROM sessionId`) und ihr Status `running` oder `stale`, setzt der Heartbeat `active_session_id = sessionId`, `lease_until = jetzt + 3 min` (bei `stale` zusätzlich `status = running`, M6) und antwortet `leaseLost: false` – etwa nach einem Netzausfall (`unreachable`), in dem die Lease verfallen ist, ohne dass jemand übernommen hat (P-09 → `held`). Sonst `leaseLost: true`.
- **Übernahme durch Admin** (`POST /web/v1/rigs/{id}/lease/release`): setzt die Lease zurück (`active_session_id = NULL`, `lease_until = NULL`) und merkt die bisherige Session in `rig_lease.released_session_id`, damit deren Heartbeats sie nicht nach M5 zurückholen (ein neues `POST /sessions` setzt die Spalte wieder auf `NULL`); der nächste Heartbeat der alten Instanz erhält `lease.leaseLost = true` → laufende Belichtung zu Ende, keine neuen Blöcke, Ereignis `lease_lost`; weitere Aufnahmen dieser Session werden gespeichert, aber mit Warnung markiert. **`lost` nur bei einer Serverantwort** (`leaseLost: true` bzw. `409 session.rig_busy`); bleiben drei Heartbeats **ohne** Antwort (Netzfehler, Timeout), wechselt das Plugin in den Zustand **`unreachable`** und führt die Blöcke weiter aus (NT-14, 10.3 Nr. 10). Einen Fehlercode `session.lease_lost` gibt es nicht (L5); der Lease-Verlust erscheint ausschließlich als `lease.leaseLost: true` in der Heartbeat- bzw. `PATCH`-Antwort, Aufnahme- und Ereignispakete scheitern nie an der Lease.
- **Offline-Modus (FA-NIN-04, Spalten verbindlich, DAT5-3):** Heartbeat `{state: "offline", offlineUntil?}` setzt `rig_lease.offline_until` (höchstens 14 Tage) und `session.offline_since = jetzt`; bis zum nächsten Online-Heartbeat bleibt die Lease eingefroren (kein Ablauf, keine `stale`-Markierung, keine Alarme). Beim ersten Online-Heartbeat werden `rig_lease.offline_until` und `session.offline_since` auf `NULL` gesetzt (Ereignis `offline_end`).
  - **„nicht offline“ = `session.offline_since IS NULL`.** Genau diese Bedingung steuert die `stale`-Ausnahme im Job `tick-5min` (13) und die Alarme (16.2).
  - **`session.created_offline`** (beim Anlegen gesetzt, danach unverändert) steuert **nur** die Lease-Ausnahme: solche Sessions werden beim Nachmelden **auch ohne Lease** angenommen (`offline: true`, 6.6). Sie verwaisen normal, sobald sie online gemeldet sind – `created_offline` allein verhindert das nicht.
  - Gibt es für die Nacht bereits eine andere Session des Rigs, werden beide gespeichert und der Alarm `rig.busy` ausgelöst.

---

## 6. Datenbank (Aurora DSQL)

*(früher Fachkonzept v0.6, Kap. 15; das Fachkonzept enthält nur noch die fachliche Sicht in Kap. 7)*

Das vollständige DDL steht in **`schema_aurora_dsql.sql`** (52 Tabellen; `schema_migration` legt der Runner zusätzlich an; syntaktisch gegen PostgreSQL 16 geprüft; `CREATE INDEX ASYNC` ist DSQL-spezifisch). Produktiv ist die Quelle der Wahrheit die Migrationsfolge in `packages/db/migrations/`.

### 6.0 DSQL-Fakten (geprüft 17.09.2026, im Spike AP-S1 am 23.09.2026 nachgewiesen)

| Thema | Stand | Folge für NINA-PM |
|---|---|---|
| Fremdschlüssel | seit 27.08.2026 unterstützt (inkl. ON DELETE-Aktionen); nachträglich per `ALTER TABLE ADD CONSTRAINT` nur mit `NOT VALID` + `ALTER TABLE ASYNC … VALIDATE CONSTRAINT` | FKs im Schema; kein ON DELETE (3.000-Zeilen-Grenze); nachträgliche Constraints nur `NOT VALID` |
| `json`/`jsonb` | als Spaltentyp unterstützt, je Wert max. 1 MiB **komprimiert**, nicht indexierbar | kleine Dokumente in `jsonb`; Planprotokolle und Exporte in S3 |
| `ALTER TABLE` | `ADD COLUMN` **nur ohne** `DEFAULT`/`NOT NULL`/`CHECK` (sonst `0A000`), `DROP COLUMN`, `SET/DROP DEFAULT`, `DROP NOT NULL`, `RENAME`; **kein** `SET NOT NULL`, **kein** `ALTER COLUMN TYPE`; max. 255 aktive Spalten (AP-S1) | Neue Spalte: ohne Default anlegen → `SET DEFAULT` → Bestand in Stapeln nachfüllen; nachträglich hinzugefügte Spalten bleiben nullbar, die Pflicht sichert zod; `NOT NULL`/`DEFAULT`/`CHECK` nur beim `CREATE TABLE`. Typänderung = neue Spalte + Nachfüllen in Stapeln |
| Nebenläufigkeit | Isolation fest `REPEATABLE READ`, optimistische Konflikterkennung (SQLSTATE `40001`/`OC000`); `SELECT … FOR UPDATE` nimmt gelesene Zeilen in die Konflikterkennung auf; keine pessimistischen Sperren | Invarianten über mehrere Zeilen mit Wächterzeile + `FOR UPDATE` (6.6) |
| Grenzen | max. 3.000 geänderte Zeilen je Transaktion (Abbruch `54000` schon beim Statement), **10 MiB** Datenvolumen und **300 s** Laufzeit je Transaktion (Abbruch `54000` beim Commit), 1 DDL je Transaktion, DDL und DML getrennt, Verbindung max. 1 h (AP-S1) | Stapel ≤ 2.500 **mit Fortschrittsmarker im Job** (wiederaufsetzbar), Migrationsrunner, Pool `maxLifetime` 50 min |
| Nicht unterstützt | Trigger, PL/pgSQL, TRUNCATE, TEMP TABLE, mehrere Datenbanken, Tablespaces | Logik in der Anwendung |
| Backup | AWS Backup (voll, geplant/on-demand), **kein Point-in-Time-Restore**; Restore erzeugt immer einen **neuen Cluster** | RPO 24 h (plus Nachmelden aus dem Plugin, 6.10) |

Quellen: AWS What's New 27.08.2026 (Foreign Keys); Aurora-DSQL-Doku „Supported data types“, „ALTER TABLE“, „Unsupported features“, „Concurrency control“, „Backup and restore“.

**Geprüft im Spike AP-S1 (23.09.2026, `docs/adr/ADR-S1-dsql.md`):** Fremdschlüssel inkl. `NOT VALID` + `ALTER TABLE ASYNC … VALIDATE CONSTRAINT`, `jsonb` als Spaltentyp (Grenze 1 MiB komprimiert, nicht indexierbar), `INSERT … ON CONFLICT` (`DO NOTHING`/`DO UPDATE`), `SELECT … FOR UPDATE` als Wächter (Konflikt `40001`), `AWS IAM GRANT` mit getrennten DB-Rollen und der offizielle Node-Connector sind bestätigt; die früheren Rückfälle (FKs weglassen, `jsonb` als `text`) entfallen. Abweichend von der Doku: `ADD COLUMN` mit `DEFAULT`/`NOT NULL` und `SET NOT NULL` gehen nicht (Zeile `ALTER TABLE`), `GRANT USAGE ON SCHEMA public` geht nicht und ist nicht nötig (6.8), die Wartefunktion ist die Prozedur `sys.wait_for_job` (Aufruf mit `CALL`, 6.8).

### 6.1 Leitlinien

| Regel | Umsetzung |
|---|---|
| Mandantentrennung ohne RLS | `tenant_id` in jeder Mandantentabelle; Indizes für Mandantenabfragen beginnen mit `tenant_id` (ausgenommen PK/UNIQUE auf global eindeutigen UUIDs, identitätsbezogene Indizes und **mandantenübergreifende Job-Indizes**, die im Schema mit `Job-Index` kommentiert sind – sie bedienen die Sweeps aus 13, die über alle Mandanten laufen); Repository-Layer verlangt Mandantenkontext; Tests je Tabelle (NFA-16) |
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
| Mandant, Anmeldung, Benutzer | `app_user` (Mitgliedschaft), `invitation`, `auth_session`, `user_preference`, `identity_preference`, `favorite`, `notification`, `change_log` (`login_audit` entfällt, SV-11) |
| Ausrüstung | `site`, `site_link`, `telescope`, `camera`, `filter`, `moon_profile`, `exposure_template`, `exposure_template_line`, `rig`, `rig_lease`, `nina_instance` |
| Projekte & Freigabe | `project`, `project_panel`, `exposure_line`, `project_note`, `approval_event`, `change_request`, `queue_vote` |
| Exoplaneten | `exo_project`, `ephemeris`, `transit_observation`, `transit_result` |
| Ausführung & Auswertung | `night_plan`, `session`, `session_event`, `capture`, `capture_night`, `correction`, `flat_combination`, `session_log`, `site_night_stat`, `command` |

**Rechte je Gruppe (verbindlich, SEC-4/SV-14).** `api` arbeitet als `app_rw`, `worker` als `app_job` – die Trennung bleibt, weil `worker` fremde Eingaben verarbeitet (Importe, Kataloge, Ergebnisdateien). `migrate` verbindet als DSQL-Admin und braucht keine eigene DB-Rolle. Jede Tabellen-Migration vergibt beide Sätze nach dieser Tabelle (Vorlage am Ende des Schemas, DSQL-Lint prüft die Vollständigkeit):

| Gruppe | `app_rw` (api) | `app_job` (worker) |
|---|---|---|
| System (global) | `SELECT` auf `dso_object`, `exo_catalog_entry`, `weather_cache`; sonst `SELECT,INSERT,UPDATE,DELETE` (auch `system_audit` – eine einfache Tabelle, kein manipulationssicherer Nachweis, SV-11) | `SELECT,INSERT,UPDATE,DELETE` auf `dso_object`, `exo_catalog_entry`, `weather_cache`, `job`, `discord_delivery`, `system_audit`; `SELECT` auf `identity`, `super_user`, `tenant`, `system_setting`; `SELECT`, `INSERT` (Mandanten-Import: Kanäle ohne URL und deaktiviert, 6.10) und `UPDATE` auf `discord_channel` – `UPDATE` nur die Zustellfelder `enabled`, `last_delivery_at`, `last_error`, `last_error_at` (7.7: bei `401`/`404` Kanal deaktivieren) |
| Mandant, Anmeldung, Benutzer | `SELECT,INSERT,UPDATE,DELETE` | **`SELECT` auf `app_user`, `tenant`; `INSERT` auf `notification`, `change_log`; `SELECT,DELETE` auf `invitation`** (Aufräumen im `daily`-Lauf – Einladungen liegen nur als Hash vor und lassen sich ohne den Discord-Anmeldeweg in `api` nicht einlösen) – **kein** Zugriff auf `auth_session`, `user_preference`, `identity_preference`, `favorite`; abgelaufene `auth_session`-Zeilen räumt **`api`** bei jeder Anmeldung mit weg (5.3; `worker` sieht keine Sitzungs-Hashes) |
| Ausrüstung | `SELECT,INSERT,UPDATE,DELETE` | `SELECT`; `INSERT` auf alle Tabellen der Gruppe außer `nina_instance` (Mandanten-Import, 6.10); `UPDATE` nur auf `rig_lease` (Lease-Ablauf) und die Spalte `rig.updated_at` (nur für den Wächter `SELECT … FOR UPDATE` der Prognose, Migration 0008 – der worker ändert keine Rigs) – **kein** Schreibzugriff auf `nina_instance` (Tokens) |
| Projekte & Freigabe | `SELECT,INSERT,UPDATE,DELETE` | `SELECT`; `INSERT` auf alle Tabellen der Gruppe (Mandanten-Import, 6.10); `UPDATE` auf `project` (Statuswechsel durch Jobs), `exposure_line` (Zähler-Abgleich) und die Spalte `change_request.submitter_rank` (gemeinsame Rangfolge beim Verfall einer Einreichung, Migration 0009 – Inhalt und Status eines Antrags ändert der worker nicht), `project_note` nein |
| Exoplaneten | `SELECT,INSERT,UPDATE,DELETE` | `SELECT`; `INSERT` auf `exo_project` (Mandanten-Import, 6.10); `INSERT,UPDATE` auf `ephemeris`, `transit_observation`, `transit_result` (Kataloge, Fristen, Ergebnisimport) |
| Ausführung & Auswertung | `SELECT,INSERT,UPDATE,DELETE` | `SELECT,INSERT,UPDATE,DELETE` (Sessionabschluss, Abgleich, Prognose, Flats) |

Damit kann `worker` weder Sitzungen kapern (`auth_session`) noch NINA-Tokens tauschen (`nina_instance`), und `api` kann keine Kataloge überschreiben. Der **Mandanten-Import** (Job `import`) läuft in `worker` als `app_job` und kommt mit den `INSERT`-Rechten dieser Tabelle aus; `identity`, `super_user`, `app_user`, `invitation`, `auth_session` und `nina_instance` schreibt er nie (6.10). Neue Tabellen ohne Zuordnung lehnt der DSQL-Lint ab.

### 6.3 Wichtige Abfragen (Indizes darauf ausgelegt)

- NINA-Auslieferung: `project (tenant_id, rig_id, status, priority)` → `project_panel` → `exposure_line`. Die Regel steht einmal als `isDeliverable()` in `packages/shared`: `approval_status='approved' ∧ status='active' ∧ deleted_at IS NULL ∧ rig.nina_delivery_enabled ∧ (start_date IS NULL ∨ start_date ≤ Nacht) ∧ (Deep-Sky: aktive, nicht archivierte, nicht für die Nacht abgeschaltete Zeile (`disabled_for_night ≠ Nacht`) mit **Planungsbedarf > 0** (Verbleibend + Überschuss, FK 8.4) **oder** `bonus_enabled` des Rigs (Bonus-Füllung ohne Obergrenze) | Exoplanet: mindestens eine `transit_observation.status='locked'` mit Fensterende in der Zukunft)`. „Soll erreicht“ (Verbleibend = 0) und „fertig“ (Planungsbedarf = 0) berechnet `projectProgress()` in `packages/shared` (FA-PRJ-12). Steigt der Planungsbedarf eines Projekts im Status `ready_to_process` wieder über 0 (Verwerfen), setzt die Anwendung es zurück auf `active` (Mandanteneinstellung `autoReactivateOnRemaining`, Standard an) bzw. erzeugt einen Hinweis. Zulässige Statusübergänge stehen in `contracts/enums.json` `projectStatusTransitions` (sonst `409 project.status_transition_invalid`).
- Warteschlange: `project (tenant_id, approval_status, created_by)` + `change_request (tenant_id, status)`; Stimmen je Gegenstand über den Primärschlüssel von `queue_vote` gezählt (kleine Mengen, keine Zählerspalte → keine OCC-Konflikte beim gleichzeitigen Abstimmen); `mine` über `(tenant_id, voter_id)`.
- „Geändert seit deiner Stimme“: inhaltliche Änderungen an eingereichten Projekten bzw. offenen Änderungsanträgen setzen `content_changed_at` (Feldliste als `CONTENT_FIELDS` in `packages/shared`; Priorität, Notizen, Favoriten zählen nicht). Admin-Änderung → `approval_event(action='edited_by_admin', snapshot = Diff)` + `notification(kind='submission.edited_by_admin')` an den Einreicher. `changedSinceVote = content_changed_at > queue_vote.acknowledged_at`.
- Rang beim Einreicher: Umsortieren schreibt alle offenen Gegenstände eines Users in **einer** Transaktion (`withTx`, bei 40001 Wiederholung); Einreichen setzt `max(rank)+1`, Zurückziehen/Entscheiden verdichtet die Ränge.
- Fortschritt je Nacht: `capture_night (tenant_id, project_id, night)`.
- Session-Detail: `capture (tenant_id, session_id, captured_at)`; Pläne einer Session über `night_plan (tenant_id, session_id, revision)` (Revisionen); `session_event (tenant_id, session_id, occurred_at)`.
- Simulator-Historie: `night_plan (tenant_id, rig_id, night, created_at)`.
- Anmeldung: `identity (discord_user_id)`, `app_user (identity_id, status)`, `auth_session (session_hash)` je Web-Anfrage, `nina_instance (token_hash)` je Plugin-Anfrage (5.3/5.6).

### 6.4 Abgeleitete Werte (nicht gespeichert)

`accepted = max(0, acquired_count − rejected_count)` (`rejected_count` je Zeile und Nacht = max(Korrektur, einzeln verworfene Nicht-Bonus-Aufnahmen), FK FA-AUS-06) · `remaining = max(0, planned_count − accepted)` · `planning_need = max(0, ⌈planned_count × (1 + overshootPct/100)⌉ − accepted)` · `integration_s` = Σ `capture.exposure_s` der akzeptierten Aufnahmen (gemeldete Belichtungszeit, nicht verworfen, einschließlich Bonus; NT-E3 – nicht mehr Anzahl × Zeilen-Belichtung), je Zeile als Summe über `capture_night.integration_s` gelesen (Fachkonzept 8.4) · Exoplaneten: dieselben Formeln auf den Zählern der festgelegten `transit_observation` · Bildfeld und Maßstab aus Rig · Transitzeiten aus aktiver `ephemeris`.

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
  user: process.env.DSQL_DB_ROLE!,        // 'app_rw' in api/ops-cli, 'app_job' in worker (SEC-4); migrate: 'admin' mit getDbConnectAdminAuthToken()
  password: () => signer.getDbConnectAuthToken(), ssl: { rejectUnauthorized: true },
  max: 2, idleTimeoutMillis: 60_000, maxLifetimeSeconds: 50 * 60,   // < 1 h DSQL-Verbindungslimit
});
export const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }), plugins: [new CamelCasePlugin()] });
```

**Bevorzugt** wird der offizielle Aurora-DSQL-Connector für node-postgres (Token-Erneuerung, Pooling), sonst obiger Pool. In beiden Fällen `pool.on('error', …)` registrieren (eingefrorene Container finden geschlossene Verbindungen vor) und den Endpunkt aus dem SSM-Parameter `/nina-pm/dsql-endpoint` beim Start lesen.

### 6.6 Transaktionen, Konflikte, Idempotenz

- **`withTx(ctx, fn, { guard? })`**: kurze Transaktionen; bei OCC-Konflikt (`40001`/`OC000`) bis zu 3 Wiederholungen mit Jitter (50/150/400 ms). Alle schreibenden Use-Cases sind wiederholbar formuliert. `guard` liest Wächterzeilen mit `SELECT … FOR UPDATE`, damit auch nur gelesene Bedingungen Konflikte auslösen – Pflicht für: Owner-Invarianten (`tenant`), Abstimmen vs. Entscheidung (`project`), **Rang beim Einreicher (`app_user`-Zeile des Einreichers** – beim ersten Objekt gibt es noch keine `project`-Zeile, DAT-17), Rig-Lease (`rig_lease`), **Zähler je Belichtungszeile (`exposure_line`)**. Zählerpfade schreiben die Wächterzeile immer (`updated_at`), auch wenn sich der Wert nicht ändert – sonst bleibt ein paralleler Abzug unentdeckt (DAT-2). Ein Zeilenzähler bricht in Tests ab 3.000 geänderten Zeilen ab.
- **Aufnahmen-Upload** (≤ 500 je Anfrage):
  0. Session muss existieren, sonst `409 session.unknown` (Plugin sendet die Session erneut, strikte Reihenfolge je Session). Sessions mit `offline: true` werden ohne Lease-Prüfung angelegt (5.6). Jede Meldung trägt die `nightPlanId` des **ausgeführten** Plans – auch eines lokal mit Jint erzeugten Plans, dessen ID das Plugin vergibt; die Outbox sendet `PATCH … {offline: true, offlinePlan}` **vor** den ersten Meldungen dieses Plans (FIFO-Barriere, NT-14), sodass der Server die ID kennt. Fehlt sie bei einer Online-Session, wird **diese Meldung** mit `rejected_invalid` beantwortet (kein `422` für das ganze Paket – ein Paket muss teilweise verarbeitbar bleiben, 7.6). **Einzige Ausnahme:** eine offline angelegte Session (`created_offline`) darf `nightPlanId = null` melden, solange ihr Offline-Plan noch nicht per `PATCH … {offline: true, offlinePlan}` nachgemeldet ist – beim Nachmelden setzt der Server die neue ID in alle betroffenen `capture`- und `session_event`-Zeilen ein (NIN5-14). Online ohne `nightPlanId` → `rejected_invalid`. Blöcke sind über ihre UUID eindeutig.
  1. `INSERT INTO capture … ON CONFLICT (id) DO NOTHING RETURNING id, frame_type, exposure_line_id, transit_observation_id, project_ids, night, result, is_bonus` (falls `ON CONFLICT` in DSQL nicht verfügbar: vorheriges `SELECT id … WHERE id = ANY($1)` und nur neue einfügen).
  2. Für die tatsächlich neuen Zeilen aggregiert: `UPDATE exposure_line SET acquired_count = acquired_count + n, bonus_count = …`, bei Exoplaneten zusätzlich `transit_observation.acquired_count`, und Upsert `capture_night`. **Sperrreihenfolge (verbindlich, DAT5-20):** Die Wächterzeilen werden **aufsteigend nach `exposure_line_id`** (UUID-Vergleich, ordinal) mit `SELECT … FOR UPDATE` gelesen, danach – falls betroffen – `transit_observation` aufsteigend nach `id`. Ein Paket mit Aufnahmen zu mehreren Zeilen sperrt also immer in derselben Reihenfolge; zwei parallele Pakete können sich damit nicht gegenseitig blockieren (Deadlock statt OCC-Wiederholung).
  3. Commit; Antwort je Meldung mit Status `accepted` | `duplicate` | `archived` (Projekt/Panel/Zeile gelöscht bzw. archiviert – trotzdem gespeichert und gezählt) | `unassigned` (ohne Zuordnung gespeichert, im Session-Detail zur manuellen Zuordnung) | `rejected_invalid` (Validierungsfehler, nicht speicherbar).
  - **Zugehörigkeit prüfen (DAT-3):** Eine Abfrage prüft je Meldung die ganze Kette `exposure_line → project_panel → project → rig` gegen `tenant_id` **und** `rig_id` des Tokens (ebenso `transit_observation` und alle `projectIds`); jede Abweichung → `rejected_invalid`. Alle `UPDATE`s tragen `tenant_id` in der `WHERE`-Klausel.
  - **Abweichende Einstellungen (NT-E3):** Weicht eine Light-Meldung in Filter, Belichtungszeit, Binning, Gain oder Offset von ihrer Zeile ab, wird sie trotzdem gespeichert und gezählt, mit `capture.settings_deviation = true` (Anzeige im Session-Detail); `integration_s` rechnet mit der gemeldeten `exposureS`. `temperatureDeviation` (NT-E2) landet in `capture.temperature_deviation`, `exposureMidUtc` (NT-10) in `capture.exposure_mid_utc`.
  - Gezählt werden nur `result = 'saved'` (nur dann ist `fileName` Pflicht); `is_bonus` erhöht `bonus_count`. `frameType = flat`/`dark_flat` zählt nicht in `exposure_line`, sondern in `flat_combination`:
    - **Schlüssel (verbindlich, NIN5-8/DAT5-21):** Session + Filter-Kurzname + `rotator_mech_deg_dg` (**Zehntelgrad als Ganzzahl**, aus dem gemeldeten `rotatorMechDeg`: `roundHalfAwayFromZero(deg · 10)`) + Gain + Offset (`null` = NINA-Standard, im Schlüssel als `-1` gespeichert, NT-38) + Binning + Auslesemodus-Index. Das Plugin friert den Repräsentanten (Median der geclusterten Winkel) bei der ersten Meldung ein und meldet ihn unverändert (`execution.md` §7); dadurch entsteht nach einem Neustart keine zweite Zeile. Der laufend beobachtete Median steht als reine Beobachtung in `median_deg double precision` und ist **nicht** Teil des Schlüssels.
    - `project_ids` = Vereinigung der gemeldeten Ziele.
    - **Sollzahlen (NIN5-9):** `flats_planned`/`dark_flats_planned` aus der **ersten** Meldung der Kombination (Felder `flatsPlanned`/`darkFlatsPlanned`); fehlen sie, gilt die Rig-Einstellung als Rückfall.
    - **`status` (verbindlich, DAT5-7):** Die Zeile entsteht mit der ersten Meldung und erhält `status = 'running'`. Sie wird auf `'done'` gesetzt, sobald `flats_taken ≥ flats_planned` **und** `dark_flats_taken ≥ dark_flats_planned`; der Job `session_close` setzt jede noch `running`-Zeile der Session auf `'done'` (wenn beide Sollzahlen 0 sind oder erreicht wurden) bzw. auf `'skipped'` (sonst, mit Hinweis im Nachtbericht). `'pending'` gibt es serverseitig nicht – es ist ein Zustand allein in `flat_combination_local` des Plugins. Kombinationen, die das Plugin überspringt (Filter nicht gefunden, Trained-Flat-Position geändert, Himmelsflats nach `flatsNotAfterUtc`), meldet es als Ereignis `filter_not_found` bzw. `warning` (`trained_flat_position_changed`) oder in `flats_end` als `skipped`; der Server legt dafür **keine** Zeile an. Jede ID in `projectIds` wird gegen Mandant und Rig geprüft (sonst `rejected_invalid`).
  - Lights mit `transitObservationId` einer geteilten Beobachtung (FA-EXO-33: nur bei gleichen Transit-Zeilen, primär = frühestes `locked_at`) zählen an der primären Beobachtung; die übrigen zeigen deren Aufnahmen an (Verweis `transit_observation.primary_observation_id`). Abweichende Zeilen → keine Teilung (`409 transit.share_mismatch` beim Festlegen).
  - Meldungen werden **immer** ins Ledger übernommen, auch zu gelöschten/archivierten Objekten und nach einem Restore (6.10); nur `rejected_invalid` landet im Dead-Letter des Plugins.
  - Späte Meldungen zu einer Session im Status `stale`, `completed` oder `aborted` sowie zu einer Transit-Beobachtung `missed` sind zulässig (`409 session.closed` erst bei Sessions, die länger als 7 Tage abgeschlossen sind): die Session wird neu ausgewertet, `missed` wird zu `observed`. Das Plugin öffnet eine so abgewiesene Session **nicht** wieder, sondern legt das Paket ins Dead-Letter (NIN5-6, `execution.md` §8).
  - **Sessionende mit nicht leerer Outbox (verbindlich, NIN5-7):** `PATCH /sessions/{id} {status: "completed", endedAtUtc, outboxPending}` wird vom Plugin **sofort** am Ende der Nachtschleife gesendet (NT-11; ein Benutzer-Stopp sendet `{status: "aborted"}`, NT-15). Der Server setzt `session.status = completed` und `ended_at`, speichert `outbox_pending` und startet die Jobs `session_close` und `session_report` **erst**, wenn `outbox_pending = 0` gemeldet wurde oder 6 h seit `ended_at` vergangen sind (13). Wiederholte `PATCH`es mit kleinerem `outboxPending` sind idempotent. Die Session gilt ab dem ersten `PATCH` **nicht** mehr als verwaist. Trifft nach dem Nachtbericht noch eine Meldung ein, rechnet der Server Zähler und Bericht nach.
- **Nachträgliche Zuordnung (`PATCH /captures/{id}/assign`, DAT5-12):** setzt `exposure_line_id` (und damit `project_id`/`panel_id`) einer Aufnahme mit `assignment = 'unassigned'`. In **einer** Transaktion: Kette `exposure_line → project_panel → project → rig` gegen `tenant_id` prüfen (sonst `409 capture.assign_mismatch`) · `capture` aktualisieren · `exposure_line.acquired_count` (bzw. `bonus_count`) um 1 erhöhen · `capture_night` für (Zeile, Nacht) **anlegen oder erhöhen** – dies ist der einzige Pfad außer dem Aufnahmen-Upload, der eine `capture_night`-Zeile neu erzeugt; `sources` erhält `'nina'` · Wächter `exposure_line` mit `FOR UPDATE`. Rückgängig machen (`assignment = 'unassigned'` setzen) senkt die Zähler in derselben Weise. Nur `result = 'saved'` zählt.
- **`integration_s` (verbindlich, DAT5-11, NT-E3):** Auf `exposure_line` wird die Integrationszeit **nicht gespeichert**, sondern bei jeder Abfrage als Summe der `capture_night.integration_s` der Zeile gelesen (6.4). `capture_night.integration_s` = Σ `capture.exposure_s` der akzeptierten Aufnahmen (gemeldete Belichtungszeit, nicht Anzahl × Zeilen-Belichtung); jeder Zählerpfad schreibt das Delta mit der Belichtungszeit der betroffenen Aufnahmen. Eine Neuberechnung bei geänderter `exposure_s` entfällt: Hat eine Zeile Aufnahmen, sind Filter, Belichtungszeit, Gain, Offset, Binning und Auslesemodus gesperrt (`409 line.locked_by_captures`, 7.2); änderbar bleiben Anzahl geplant, Mondprofil und aktiv, sonst *Duplizieren*. Der Abgleich-Job prüft die Identität zwischen `capture_night.integration_s` und der aus `capture` gerechneten Summe und protokolliert Abweichungen.
- **Korrekturen** (`correction`) und einzeln verworfene Aufnahmen (`PATCH /captures/{id}`) aktualisieren `rejected_count` und `capture_night` in derselben Transaktion; das Delta für `integration_s` und `capture_night.integration_s` ist `+ (neu_max − alt_max) · (−exposure_s)` – bei einzeln verworfenen Aufnahmen deren gemeldete `exposure_s`, bei einer Korrektur als Anzahl die `exposure_s` der (gesperrten) Zeile (NT-E3) – (verworfene Aufnahmen zählen nicht in `accepted_count`); Korrektur und Verwerfen setzen `project.effort_stale`. Aufnahmen gelten ohne Bestätigung als akzeptiert; es gibt nur das Verwerfen, keine Freigabe (NT-48); je Zeile und Nacht gilt `verworfen = max(Korrektur, einzeln verworfene Nicht-Bonus)`, eine Korrektur unter der Anzahl einzeln verworfener wird mit `409 correction.conflict` abgelehnt.
- **Abgleich-Job** (→ 13) rechnet Zähler aus `capture`/`correction` nach und protokolliert Abweichungen. Zeilen aus **Import oder Seed** (`capture_night.sources` enthält `import`) haben keine `capture`-Zeilen: sie gelten als Basis und werden nur addiert, nie überschrieben (DAT-18); Abweichungen erscheinen als Hinweis, nicht als Korrektur.
- **Löschen und Papierkorb (E4, FA-PRJ-06/07/15):** **Projekte** werden **immer** weich gelöscht (`deleted_at`), auch ohne Aufnahmen; sie erscheinen danach nur in der Ansicht „Gelöscht“ (Admin/Owner, `GET /web/v1/projects?deleted=true`) und lassen sich dort mit *Wiederherstellen* (`POST /web/v1/projects/{id}/restore`, Aktion `project.status`) zurückholen. **Es gibt kein automatisches Endlöschen.** **Panels und Zeilen** werden weich gelöscht, wenn Aufnahmen daran hängen, sonst endgültig. Weich gelöschte Panels und Zeilen sind ausgeblendet und **nicht einzeln wiederherstellbar**; sie bleiben nur erhalten, damit später eintreffende Aufnahmemeldungen zugeordnet werden können. Wiederherstellen gibt es nur auf Projektebene – das Versehen deckt der Papierkorb für Projekte ab. Weich gelöschte Objekte werden nicht ausgeliefert (`isDeliverable`, 6.3), Aufnahmen dazu werden weiter angenommen (Status `archived`). Endgültiges Löschen (Panel/Zeile ohne Aufnahmen, Mandant) entfernt abhängige Tabellen in Stapeln ≤ 2.500 Zeilen je Transaktion, von Blatt zu Wurzel. Stammdaten mit Verweisen (Standort, Teleskop, Kamera, Filter, Mondprofil, Vorlage, Rig) sind gegen Löschen gesperrt (`409 resource.in_use` mit Liste der Verwender; Projekte im Papierkorb zählen als Verwender). Jede Löschaktion in der Oberfläche läuft über den `ConfirmDialog` (11.2).

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
- Runner (`packages/db/src/migrate.ts`) als Lambda `migrate` im Stack `NinaPm-Migrate`, ausgelöst durch CDK `Trigger` **vor** dem Deployment von `NinaPm-Api`/`NinaPm-Jobs` (Expand zuerst); Tabelle `schema_migration (id, checksum, applied_at)` legt der Runner selbst an. `migrate` verbindet als DSQL-Admin (`dsql:DbConnectAdmin` auf den Cluster-ARN, SV-13).
- **Migration 0000 läuft in `migrate` (verbindlich, SV-13/SV-14):** Sie legt die DB-Rollen `app_rw` und `app_job`, die drei `AWS IAM GRANT`s (`app_rw` → `NinaPmApi`, `app_rw` → `NinaPmOpsCli`, `app_job` → `NinaPmWorker`) an – idempotent (vor `CREATE ROLE` in `pg_roles` prüfen, sonst `42710`; vor `AWS IAM GRANT` in `sys.iam_pg_role_mappings`), bei jedem Lauf wiederholbar. Ein `GRANT USAGE ON SCHEMA public` entfällt: DSQL lehnt ihn ab (`0A000`), und die Rollen erreichen das Schema auch ohne ihn (AP-S1). Eine eigene `db-bootstrap`-Lambda, eine DB-Rolle `app_migrate` und eine menschliche Aufgabe für diesen Schritt gibt es nicht mehr.
- Jede Tabellen-Migration enthält ihre `GRANT`s für `app_rw` **und** `app_job` (Vorlage am Ende des Schemas); den Umfang je Rolle legt die Tabellengruppe fest (6.2).
- `CREATE INDEX ASYNC` und `ALTER TABLE ASYNC … VALIDATE CONSTRAINT` liefern eine Job-ID; der Runner wartet mit **`CALL sys.wait_for_job('<job_id>')`** (Prozedur, per `SELECT` → `42809`; Status in `sys.jobs`) auf den Abschluss bzw. bricht mit Hinweis ab (AP-S1).
- **Neue Spalten** in Folge-Migrationen: `ADD COLUMN` ohne `DEFAULT` und ohne Constraint → eigene Migration `ALTER COLUMN … SET DEFAULT` → Bestand in Stapeln ≤ 2.500 nachfüllen (Job mit Fortschrittsmarker); nachträglich kein `NOT NULL` (AP-S1).
- **DSQL-Lint** in CI: verbietet `TRIGGER`, `FUNCTION … LANGUAGE plpgsql`, `SERIAL`, `TRUNCATE`, `CREATE INDEX` ohne `ASYNC`, `ON DELETE`/`ON UPDATE`-Aktionen, `TEMP TABLE`, `ALTER COLUMN … TYPE`, `ALTER COLUMN … SET NOT NULL`, `ADD COLUMN` mit `DEFAULT`/`NOT NULL`/`CHECK`, `GRANT … ON SCHEMA`, `ADD CONSTRAINT` ohne `NOT VALID`, `CREATE TABLE` ohne zugehörige `GRANT`s **für beide Anwendungsrollen** (`app_rw` und `app_job`, SEC-4/SV-14).
- Seeds: Built-in-Mondprofile je neuem Mandant (Use-Case „Mandant anlegen“), Kataloge per Job/Tool.

### 6.9 Lokale Entwicklung

- Docker Compose mit **PostgreSQL 16** als DSQL-Ersatz (Benutzer `app_rw`/`app_job` mit Passwort statt IAM-Token; `CREATE INDEX ASYNC` wird vom Runner lokal zu `CREATE INDEX` umgeschrieben; `default_transaction_isolation = 'repeatable read'` wie DSQL). Lokal führt der Runner Migration 0000 wie in prod aus, überspringt aber `AWS IAM GRANT`; `ALTER TABLE ASYNC … VALIDATE CONSTRAINT` wird zu `ALTER TABLE … VALIDATE CONSTRAINT`; Rollen werden mit Passwort angelegt (`app_rw`/`app_job`), der Runner selbst verbindet als Superuser des Containers.
- DSQL-Abweichungen fängt der kurzlebige Test-DSQL-Cluster ab (`pnpm test:dsql`: Migrationen + Repository-Tests; **lokal durch Sven** mit Admin-Profil vor jedem Merge mit Änderungen in `packages/db` und vor jedem prod-Deploy mit Migrationen, E1, 17/18).
- `AUTH_TEST_MODE=true` ist nur im lokalen API-Prozess zulässig (17).

### 6.10 Datensicherung

- AWS Backup-Plan für den DSQL-Cluster: täglich, Aufbewahrung 35 Tage, **Standard-Vault**, Auswahl per Cluster-ARN; Alarm nur auf `NumberOfBackupJobsFailed > 0` (SV-15). **Kein Point-in-Time-Restore** → RPO 24 h. Der Cluster hat Löschschutz und `RemovalPolicy.RETAIN`, ebenso der Daten-Bucket.
- **Nachmelden nach Restore:** Das Plugin behält gesendete Meldungen 14 Tage (lokale SQLite) und bietet „erneut hochladen ab Datum“; der idempotente Ingest (6.6) übernimmt nur Fehlendes.
- **Restore-Runbook** (`docs/runbooks/restore.md`, einmal in AP-17 geprobt, H-20): Wiederherstellungspunkt wählen → AWS Backup erzeugt neuen Cluster (**neuer ARN!**) → SSM-Parameter `/nina-pm/dsql-endpoint` umstellen → **`pnpm deploy:prod -c dsqlClusterId=<neue ID>`** (`NinaPm-Data` importiert den Cluster statt ihn zu erzeugen; IAM-Grants, Backup-Auswahl und Alarme hängen am **ARN** und werden dabei auf den neuen Cluster umgestellt, SV-19) → `migrate` läuft mit (legt Rollen und Grants idempotent an, prüft das Schema) → Smoke-Tests → Plugins zum Nachmelden auffordern (Banner) → alten Cluster nach 7 Tagen löschen (Löschschutz vorher bewusst abschalten, DAT-15). Für die Probe genügt ein Restore in einen zweiten Cluster mit anschließendem Lesetest und Löschen; eine eigene Probe-Umgebung gibt es nicht.
- **Zusätzliches On-Demand-Backup vor jedem Deploy mit neuen Migrationen** (`aws backup start-backup-job` im lokalen Skript `pnpm deploy:prod`; der Deploy wartet auf `COMPLETED`, 18).
- **Migrationen nur additiv (Expand/Contract):** neue Spalten/Tabellen nullable oder mit Default; Löschen/Umbenennen frühestens ein Release später, wenn kein laufender Code sie mehr nutzt. So bleibt ein Rollback des Codes auf den vorherigen Tag ohne Schema-Rückbau möglich; Datenfehler werden aus dem Backup in einen neuen Cluster wiederhergestellt.
- Mandanten-Export (FA-ADM-04) als Job: JSON in S3 `exports/` (Download-Link 15 min); Import über presigned Upload nach `imports/` und Job `import` in `worker` (DB-Rolle `app_job`, Rechte 6.2) in Stapeln. **Der Export enthält keine Zugangsdaten:** ohne `discord_channel.webhook_url`, ohne alle `*token_hash`-Spalten (u. a. `nina_instance.token_hash`, `invitation.token_hash`) und ohne die Tabellen `auth_session` und `invitation`. **Der Import** legt Discord-Kanäle ohne URL und deaktiviert an (der Admin trägt die Webhook-URL in S-71 neu ein, 7.7) und legt Tokens, NINA-Instanzen, Sitzungen und Einladungen nie an; ebenso keine Identitäten und Mitgliedschaften – Verweise auf Mitglieder bildet er über die Discord-ID auf vorhandene Mitglieder des Zielmandanten ab, sonst auf den importierenden Admin.

---

## 7. API

### 7.1 Konventionen

| Thema | Festlegung |
|---|---|
| Basis | `https://nina-pm.svenesis.org/api` |
| Bereiche | `/api/auth/*`, `/api/web/v1/*` (Browser), `/api/nina/v1/*` (Plugin), `/api/system/v1/*` (Super User); Tabellen unten ohne Präfix `/api` |
| Format | JSON, `camelCase`, Zeiten ISO-8601 UTC, Nacht `YYYY-MM-DD` |
| Validierung | zod-Schemas aus `packages/shared`; OpenAPI 3.1 wird daraus generiert (`@hono/zod-openapi`) und eingecheckt. **Hochgeladene JSON-Dateien (Import, Ergebnisse, SV-09):** `JSON.parse` in `try/catch`, danach zod mit `.max()`-Grenzen je Liste und Zeichenkette (u. a. höchstens 50.000 Einträge je Entitätsart, Zeichenketten ≤ 64 KiB); die Dateigröße erzwingt bereits S3 über `content-length-range` (12). Fehler → Job `failed` mit Grund `validation.failed` und Verweis auf die Stelle. Der Job löscht nichts; Uploads räumen die S3-Lebenszyklusregeln |
| Fehler | `application/problem+json` mit `type`, `title`, `status`, `code` (z. B. `approval.not_allowed`), `errors[]` bei Validierung. Unerwartete Fehler → `500 internal.error` nur mit `requestId`; keine Stacktraces, SQL-/AWS-Fehlertexte oder Schlüssel in Antworten; Details nur im Log |
| Listen | Cursor-Paginierung `?limit=50&cursor=…`, Filter als Query-Parameter |
| Nebenläufigkeit | `ETag`/`If-Match` (Projekt `version`, Rig `settings_version`, Änderungsantrag `version` (FA-FRG-08: Antragsteller und Admin bearbeiten denselben offenen Antrag)); 412 bei Konflikt |
| Idempotenz | Zustandsübergänge (Einreichen, Freigeben, Entscheiden) über `If-Match`-Version – Wiederholung liefert `412` bzw. den bereits erreichten Zustand; Anlagen mit clientseitig erzeugter UUID (Einladung, Aufnahmen, Ereignisse, Sessions) |
| Versionierung | `/v1`; Engine-Kompatibilität über Header `X-NPM-Engine-Version` (Plugin) → 409 `engine.incompatible` bei Major-Abweichung |
| Rate-Limits | nur am API Gateway (SV-06): global 50 rps/Burst 100 und je Route `/api/nina/v1` 20 rps, **`GET /api/auth/discord/{proxy+}` und die Einladungsrouten `POST /api/auth/invitation/claim`, `POST /api/auth/invitations/preview` je 5 rps/Burst 10** (`/auth/me`, `/auth/context`, `/auth/logout`, `/auth/sessions` unter der Stage-Drosselung), **`GET /api/health` 5 rps/Burst 10** (4.2); Überschreitung → `429` des Gateways, in der Oberfläche als `auth.rate_limited` angezeigt. Dazu reservierte Parallelität `api` 20/`worker` 5. **Keine** zweite Stufe in der Anwendung (keine Zählung je NINA-Instanz, je IP oder je Discord-ID); für Jobs gelten nur die Grenzen aus 13 |
| Größen | Anfrage ≤ 1 MB (**eigene Vorgabe**, nicht die technische Grenze der HTTP API); größere Daten (Planprotokoll, Import, Ergebnisdateien) nur per **presigned POST** mit `content-length-range` (12, SEC-23); Laufzeit > ~5 s nur als Job (`202 {jobId}`, `GET /web/v1/jobs/{id}`) |

### 7.2 Endpunkte Web (Auszug, vollständig in OpenAPI)

| Bereich | Endpunkte | Aktion(en) |
|---|---|---|
| Auth | `POST /auth/invitation/claim {token}` (legt das Einladungs-Cookie an, DAT5-15; Antwort nur `{tenantName, role}`; eigene Gateway-Route mit 5 rps, 4.2), `GET /auth/discord/start`, `GET /auth/discord/callback`, `POST /auth/context` (setzt `app_user.last_login_at`, 5.2), `POST /auth/logout`, `GET /auth/me` (Identität, Kontext, Mitgliedschaften, wirksame Rolle, `mfaRequired`), `GET/DELETE /auth/sessions[/{id}]` (Sitzungsliste mit Gerät, gekürzter IP, `createdAt`, `lastSeenAt`, 5.3). **Kein** `POST /auth/refresh` (SV-01) | `public` bzw. angemeldet |
| Health | `GET /api/health` – die **einzige** Health-Route (Status, `ENGINE_VERSION`, Build; **ohne** Datenbankzugriff, gedrosselt 5 rps/Burst 10, SV-07; Ziel des Route-53-Health-Checks über CloudFront). Die DB-Erreichbarkeit prüft der Smoke-Test nach dem Deploy über eine angemeldete Route (17) | `public` |
| Einladungs-Vorschau | `POST /auth/invitations/preview {token}` (Token im Body, nicht im Pfad – Pfade landen in Zugriffslogs, DAT-20) | `public` (ausdrücklich, rate-limitiert) |
| Einladungen | **zwei Routen (SEC-50, E2):** `POST /web/v1/invitations {id, …}` legt fest `role: "user"` an (Admin oder Owner), `POST /web/v1/invitations/admin {id, …}` die Admin-Einladung (nur Owner). Eine Route, deren nötige Berechtigung vom **Rumpffeld** `role` abhängt, ist mit `route.meta.action` (5.5) nicht abbildbar – ein gewöhnlicher Admin könnte sonst mit `{role:"admin"}` FA-BEN-08 umgehen. Befristete Admin-Einladungen gibt es nicht mehr. `GET /web/v1/invitations`, `DELETE /web/v1/invitations/{id}` | `member.manage` (Nutzer-Route); `member.admin.manage` (Admin-Route, Einladungen des Owners) |
| Mitglieder | `GET /web/v1/members`, `PATCH /web/v1/members/{id} {displayName, status}`, `DELETE /web/v1/members/{id}` (Folgen je Freigabestatus: FA-BEN-11), `POST /web/v1/members/{id}/reassign-objects {toMemberId}` (Objekte eines entfernten Mitglieds übertragen, FA-BEN-11), `DELETE /web/v1/members/{id}/sessions` (nie für den Owner) | `member.manage` (Ziel User) bzw. `member.admin.manage` (Ziel Admin) |
| Rollen & Owner | `PUT /web/v1/members/{id}/role {role, reason?}` (Admin ernennen oder entziehen, nur Owner, E2; `reason` ist optional und wird mit dem Rollenwechsel in `change_log` gespeichert – `entity = 'app_user'`, `diff.reason`; „vergeben von“ ist `change_log.user_id`); `POST /web/v1/me/leave` (nicht für den Owner, `409 member.owner_cannot_leave`); `POST /web/v1/tenant/owner-transfer {memberId}` – Übertragung **sofort** an ein aktives Mitglied mit Rolle Admin nach `ConfirmDialog`, ohne Annahme durch den Empfänger, ohne Frist und ohne Widerruf; Ziel ungültig → `422 owner_transfer.target_invalid` (5.5) | `member.admin.manage`, `member.leave`, `tenant.owner.transfer` |
| Mandant | `GET/PATCH /web/v1/tenant/settings` (erlaubte Schlüssel **ausschließlich** aus `contracts/enums.json` `tenantSettingsKeys`, unbekannte Schlüssel → `422 validation.failed`, DAT5-22). Sicherheitsschlüssel gibt es nicht mehr: 2FA-Pflicht und Sitzungsdauer sind feste Regeln (SV-01/SV-03). `GET /web/v1/audit/changes` (Änderungsprotokoll aus `change_log`) | `tenant.settings` |
| Discord (ausgehend) | `GET/PUT /web/v1/tenant/discord {guildName, guildId?, inviteUrl?}`; `GET/POST /web/v1/tenant/discord/channels {name, webhookUrl, categories[], eventFilter}`, `PATCH/DELETE /web/v1/tenant/discord/channels/{id}` (Webhook-URL nur schreibbar: Prüfung gegen `^https://(discord\.com|discordapp\.com)/api/webhooks/\d+/[\w-]+$` (SSRF-Schutz), Ablage in `discord_channel.webhook_url`, nie ausgeliefert, Antwort nur `webhookHint` mit den letzten 4 Zeichen, SV-10), `POST /web/v1/tenant/discord/channels/{id}/test` | `tenant.settings` |
| Sicherheit | **entfällt (SV-03, 21.09.2026)** – keine Route `/web/v1/tenant/security`, keine Aktion `tenant.security` | – |
| Ausrüstung | CRUD `/web/v1/sites`, `/site-links`, `/telescopes`, `/cameras`, `/filters`, `/moon-profiles`, `/exposure-templates`, `/rigs` (Löschen gesperrt bei Verwendung → `409 resource.in_use`); `PUT /rigs/{id}/scheduler-settings`; `POST /rigs/{id}/compatibility {projectId}` bzw. Prüfung beim Rig-Wechsel (FA-RIG-12; mit Aufnahmen und geänderter Optik → Warnung `rig.change_has_captures` + Angebot *Duplizieren*). **Filterradbelegung (NT-E1, FA-RIG-14):** `GET /web/v1/rigs/{id}/filter-wheel` liefert je Platz den Web-Filter, den bestätigten `ninaFilterName` mit `ninaConfirmedAt`/`ninaConfirmedBy` (Schema `rig.filter_wheel`), das zuletzt im Heartbeat gemeldete NINA-Filterrad (`[{position, name, focusOffset}]`) und einen Vorschlag; `PUT /web/v1/rigs/{id}/filter-wheel {slots:[{position, filterId, ninaFilterName}]}` bestätigt die Zuordnung (setzt `nina_confirmed_at`, erhöht `settings_version`). Vorschlag: exakt nach Normalisierung (Kleinbuchstaben, ohne Leer-/Sonderzeichen), sonst Präfix **nur in einer Richtung** – der NINA-Name beginnt mit dem Web-Kurznamen und das nächste Zeichen ist kein Buchstabe („Ha“ → „Ha 3nm“, nie „LPro“ → „L“, „HaOIII“ → „Ha“, „Rc“ → „R“). Meldet der Heartbeat an einem bestätigten Platz einen anderen Namen, gilt dieser Platz als unbestätigt (Alarm `alert.nina_settings_mismatch`, Code `filter_wheel_changed`). OSC ohne Filterrad: keine Zuordnung nötig. **Kamera:** `cooling_setpoint_c` (nullable) und `cooling_tolerance_c` (Standard 1) im Kamera-Stamm (NT-E2); Gain/Offset überall nullable, `null` = NINA-Standard (NT-38). **Rig:** `flats_source` = `panel` \| `sky` (NT-40). **Nacht-Tabelle (NT-02):** `GET /web/v1/sites/{id}/nights?from=&count=` (`count` ≤ 400) liefert `{currentNight, tzdataVersion, timeZoneTransitions[{atUtc, utcOffsetMinutes}], nights[{night, noonStartUtc, noonEndUtc, nightWindowEndUtc}]}` in derselben Struktur wie der Bootstrap (ab `from`, ohne `from` ab der Mittagsnacht; jede Zeile mit `nightWindowEndUtc`, H1); der Browser rechnet Engine-Läufe (Simulator, Aufwand live) damit, nie mit `Intl` | `equipment.*`, `rig.settings.write` (Filterradbelegung: Admin/Owner); Nacht-Tabelle `project.read` |
| NINA-Instanzen | `GET /web/v1/nina-instances`, `POST /web/v1/nina-instances {rigId, name}` → einmalige Token-Anzeige (AP-14a), `POST /web/v1/nina-instances/{id}/revoke`, `DELETE /web/v1/nina-instances/{id}` (nur ohne Sessions und Kommandos, sonst `409 resource.in_use`), `GET /{id}/diagnostics` (Ringpuffer `last_calls`, 5.6), `POST /web/v1/rigs/{id}/lease/release` (Session übernehmen, FA-RIG-06), `POST /web/v1/rigs/{id}/commands {command}` (Kommando an das Plugin, Werte aus `ninaCommands`; Antwort mit `commandId`, Zustellung über die Heartbeat-Antwort, 7.6), `GET /web/v1/rigs/{id}/delivery` (An NINA ausgeliefert) | `nina.instance.manage`; Liste/Status lesend `nina.instance.read`; Auslieferung `project.read`; Quittieren Auslesemodus-Abgleich `POST /web/v1/cameras/{id}/nina-report/dismiss` (`equipment.write`) |
| Kataloge | `GET /web/v1/catalog/dso?q=&type=&const=&fitsRig=`, `GET /web/v1/catalog/suggestions?rigId=&night=`, `GET /web/v1/exoplanets/transits?rigId=&night=&…` | `project.read` |
| Projekte | CRUD `/web/v1/projects`, `/projects/{id}/panels`, `/projects/{id}/lines`, `POST /projects/{id}/apply-template`, `POST /projects/{id}/duplicate`, `POST /web/v1/projects/{id}/lines/{lineId}/duplicate {deactivateSource?}` (neue Zeile mit Zähler 0, die alte optional deaktivieren, NT-E3); **Zeilen mit Aufnahmen:** Änderungen an Filter, Belichtungszeit, Gain, Offset, Binning oder Auslesemodus → `409 line.locked_by_captures` (änderbar bleiben Anzahl geplant, Mondprofil, aktiv); Löschen von Projekten immer weich, von Panels/Zeilen mit Aufnahmen weich (ausgeblendet, nicht einzeln wiederherstellbar, 6.6, E4); Papierkorb: `GET /web/v1/projects?deleted=true`, `POST /web/v1/projects/{id}/restore` | `project.create`/`project.update`/`project.delete`; Papierkorb `project.status` (Admin/Owner) |
| Projektstatus & Priorität | `PUT /projects/{id}/priority` (Liste je Rig), `PUT /projects/{id}/status` (Übergänge nach `enums.json` `projectStatusTransitions`; Aktivieren prüft Vollständigkeit) | `project.status` (nur Admin) |
| Warteschlange (alle) | `GET /web/v1/queue` (Einträge mit `votes {count, voters[{memberId, displayName, changedSinceVote}], mine, mineChangedSince}`, `submitterRank {rank, of}`, `effort {tag, nights, earliestCompletion, achievablePct, limitingFactor}`, `planSummary [{filterShortName, color, count, exposureS, gain, offset, binning, readoutMode, moonProfile}]` je aktiver Zeile (bei Mosaik `panelCount`, bei Exoplaneten Fenster), `estimatedHours`, Frist, `suggestedPriorityPosition` nur für Admins); `PUT/DELETE /web/v1/queue/{kind}/{id}/vote` (`kind` = `project`/`change-request`; 409 `vote.own_object`, 409 `vote.closed`); `POST /web/v1/queue/{kind}/{id}/vote/acknowledge` (Hinweis „geändert seit deiner Stimme“ quittieren; erfolgt auch beim Öffnen des Objekts); `PUT /web/v1/me/submission-ranking {items:[{kind,id}]}` (vollständige Liste der eigenen offenen Gegenstände, sonst 422) | `queue.read`, `queue.vote`, `project.rank` |
| Freigabe | `POST /projects/{id}/submit`, `/withdraw`, `/approve {rigId, priorityPosition, status, startDate?, dueDate?, comment}` (Rig-Wechsel mit Konfliktliste, FA-RIG-12; gewünschte Transit-Beobachtung `requested` → `locked`), `/return`, `/reject` | `project.submit`, `queue.decide` (nicht für eigene Objekte, FA-FRG-10) |
| Entwürfe & Transit-Bestätigungen | `GET /web/v1/drafts`; `GET /web/v1/transit-observations?status=requested` (offene Bestätigungen, FA-EXO-18); `POST /transit-observations/{id}/confirm` (→ `locked`, `locked_at`), `/decline` (→ `cancelled`) | `queue.decide` |
| Änderungsanträge | `POST/GET /projects/{id}/change-requests`, `PATCH /change-requests/{id}` (Antragsteller solange offen, Admin), `POST /change-requests/{id}/withdraw`, `POST /change-requests/{id}/decide {decision, comment}` (Konflikt, wenn `project.version` ≠ `base_version`: Diff gegen aktuelle Fassung) | `changeRequest.create`, `changeRequest.update`, `queue.decide` |
| Exoplaneten | `POST /projects/{id}/exo/lock {night, epoch}` (vor Freigabe → Status `requested`; nach Freigabe durch Admin → `locked`, durch Ersteller → `requested` bis Bestätigung, wenn `exoUserLockNeedsAdmin` (Standard), höchstens `exoUserMaxOpenLocks` offen, sonst `409 transit.too_many_open`; FA-EXO-18), `DELETE /projects/{id}/exo/lock` (→ `cancelled`), `GET /web/v1/exoplanets/my-observations`, `GET /transit-observations/{id}/captures.csv`, `GET /projects/{id}/exo/upcoming`, `POST /projects/{id}/ephemeris/refresh`, `GET /transit-observations/{id}`, `POST /transit-observations/{id}/results` (nach S3-Upload) | `transit.lock`, `project.update`, `transit.result.import` |
| Simulation | Einzelnacht im Browser (auch mit eigenen Entwürfen des Users, nur lokal); `POST /web/v1/simulations {rigId, night, plan}` speichert einen Plan als `night_plan(origin='web_simulation')`; `POST /web/v1/simulations/multi` → `202 {jobId}` | `simulation.run` |
| Jobs | `GET /web/v1/jobs/{id}` (Status, Fortschritt, Download-Link des Ergebnisses) | `job.read` (Ersteller bzw. Admin) |
| Sessions | `GET /web/v1/sessions?rigId=&from=&to=&unreviewed=`, `GET /sessions/{id}` (inkl. Soll/Ist), `GET /sessions/{id}/captures` (mit `temperatureDeviation`, `settingsDeviation`, `exposureMidUtc`; Anzeige im Session-Detail, NT-E2/NT-E3), `GET /sessions/{id}/events` (Abweichungsgründe, FA-AUS-04), `GET /sessions/{id}/plans` (Planrevisionen der Nacht), `PATCH /captures/{id} {rejected, reason}`, `POST /web/v1/corrections` (Regel max, 6.6), `PUT /sessions/{id}/log`, `POST /sessions/{id}/report/resend` (`session.report.resend`, FA-AUS-21), `GET /sessions/{id}/calibration` (Flats/Dark-Flats je Kombination), `PATCH /captures/{id}/assign {projectId, panelId, exposureLineId}` (nicht zugeordnete Aufnahmen), `POST /sessions/{id}/review` | `session.*`, `sessionlog.write` |
| Verlauf | `GET /web/v1/projects/{id}/history` (Freigabe- und Änderungsverlauf, FA-FRG-12, FA-BER-03), `GET /web/v1/projects/{id}/captures?format=json|csv` (Aufnahmeliste je Projekt, FA-AUS-12), `GET /web/v1/projects/{id}/export` (FA-PRJ-09) | `project.history.read`, `session.read`, `project.read` |
| Notizen | `POST /web/v1/projects/{id}/notes` | `project.note.write` (User: eigene Objekte in jedem Status) |
| Warteschlange | `POST /web/v1/queue/{projectId}/impact` → `202 {jobId}` (Auswirkungsvorschau, FA-FRG-05) | `queue.decide` |
| Mandanten-Export/-Import | `POST /web/v1/tenant/export` → `202 {jobId}`; Import: `POST /web/v1/files/upload-url {purpose:'tenant_import'}` → `POST /web/v1/tenant/import {uploadTicketId}` (kein Schlüssel, 12) → `202 {jobId}` | `tenant.export`, `tenant.import` |
| Super-User-Aktionen im Mandanten | `GET /web/v1/audit/system` (FA-SU-09) | `tenant.settings` |
| System (Super User) | `GET/POST/PATCH/DELETE /system/v1/tenants`, `POST /system/v1/tenants/{id}/invitations` (Rolle owner; optional an eine Discord-User-ID gebunden wie jede Einladung – Sonderregeln gegen den Super User gibt es nicht, E3), `PUT /system/v1/tenants/{id}/owner {memberId | invite, reason}` (`system.tenant.owner`, Notfall-Neuzuweisung, einziger Weg bei vorhandenem Owner, benachrichtigt alle Admins einschließlich des bisherigen Owners, 5.5), `GET/POST/PATCH /system/v1/super-users`, `GET /system/v1/tenants/{id}/members` (nur Anzeigename, Rolle, Status – für die Owner-Neuzuweisung), `PATCH /system/v1/identities/{id} {status}` (systemweit sperren, FA-LOG-05), `GET /system/v1/audit`, `POST /system/v1/catalogs/{name}/refresh`, `GET/PUT /system/v1/settings/{key}` (u. a. Wartungsbanner in `system_setting`) | `system.manage` |
| Auswertung | `GET /web/v1/tonight?rigId=` (Startseite „Heute Nacht“, FA-FOL-06; Nacht = `currentNight` des Rig-Standorts, NT-01), `GET /web/v1/forecast?rigId=` (Restbedarf, Prognose, Kandidatennächte), `GET /web/v1/reports/logbook?from=&to=&site=` (Protokoll-Auswertungen, FA-AUS-16), `GET /web/v1/reports/projects?from=&to=&status=&rigId=&type=` (JSON/CSV; PDF über Druckansicht im Browser), `GET /web/v1/stats/clear-nights?site=`, `POST /web/v1/sites/{id}/nights/{night}/unused` (`session.review`); `from`/`to` mit Standortbezug sind Nacht-Schlüssel (NT-04) | `project.read`, `session.read`, `session.review` |
| Wetter | `GET /web/v1/weather?site=` | `project.read` |
| Dateien | `POST /web/v1/files/upload-url {purpose, contentType, size}`, `GET /web/v1/files/download-url {purpose, id}` (**kein** Schlüssel vom Client – der Server bildet ihn aus Zweck und Objekt-ID, 12) | feste Aktion je `purpose`: `transit.result.manage` (`transit_result`), `tenant.import` (`tenant_import`), `tenant.export` (`export`), `session.read` (`plan_log`), `queue.read` (`job_result`) |
| Benachrichtigungen | `GET /web/v1/notifications`, `POST /notifications/read` (R1); `kind` aus `contracts/enums.json` `notificationKinds`. **Systembenachrichtigungen** (Empfänger `notification.recipient_identity_id`, Super User ohne Mitgliedschaft; Arten `owner.reassigned`, `alert.*`, DAT5-13): `GET /system/v1/notifications`, `POST /system/v1/notifications/read` – dieselben Felder, aber über den System-Kontext und ohne `tenant_id`-Filter | `notification.read` bzw. `system.manage` |
| Einstellungen | `GET/PUT /web/v1/me/preferences/{key}`, `PUT/DELETE /web/v1/me/favorites/{projectId}` | `me.preferences`, `me.favorites` |

### 7.3 Endpunkte NINA (`/nina/v1`)

| Methode + Pfad | Zweck | Anforderung |
|---|---|---|
| `GET /bootstrap` | Rig, Standort, Kamera (Gain-/Auslesemodi, `setpointC`/`toleranceC`, NT-E2), Filter-Kurznamen mit bestätigter Filterradbelegung (`position`, `ninaFilterName`, NT-E1), Scheduler-Settings + `settingsVersion` (inkl. `flats.source`, NT-40), Mondprofile, minimale Engine-Version, `serverTimeUtc` (NT-05), **Nacht-Tabelle `nights[]` ab der Mittagsnacht** (Nacht, deren Mittag-bis-Mittag-Intervall `serverTimeUtc` enthält; 60 Nächte, `{night, noonStartUtc, noonEndUtc, nightWindowEndUtc}`) mit `tzdataVersion` und `timeZoneTransitions[{atUtc, utcOffsetMinutes}]` (maßgeblich; für `currentNight` und Offline-Planung, NT-02, OT-11); schreibt `nina_instance.settings_version_fetched/settings_fetched_at` (Übernahmestatus S-40/S-10) | FA-SYN-02, FA-SIM-09 |
| `GET /targets` | auslieferbare Projekte des Rigs (`isDeliverable`, 6.3) inkl. Panels, Zeilen, Zählern, Bedingungen, Exoplaneten-Ephemeride + festgelegtes Ereignis mit Beobachtungs-ID; je Zeile `ninaFilterName` (`null` = nicht zugeordnet, NT-E1); `ETag` = Hash über Projekt-`version`s, `settingsVersion`, Korrekturen/Verwerfungen, Transit-Festlegungen und Filterzuordnungen – **ohne** Zähler aus Aufnahmemeldungen (NT-19; Abruf vor jedem Block, meist `304`) | FA-SYN-02/03 |
| `POST /plan {night, reason, sessionId?, startAtUtc?, pendingCaptures[], targetsEtag, tonight?}` | **Server plant** mit der Node-Engine (gleiche Eingaben wie der Simulator) und liefert `NightPlan` (`nightPlanId`, `revision`, Blöcke mit UUID, Zeitmarken `darknessEndUtc`/`flatsNotBeforeUtc`/`sessionEndUtc`, 7.6) + `inputHash`; `night` muss die aktuelle oder die folgende Nacht nach `currentNight` sein, sonst `422 nina.night_invalid` (NT-01); ungültige Engine-Eingabe → `422 engine.input_invalid`; `pendingCaptures` = `[{exposureLineId, transitObservationId?, captureIds}]` der noch nicht mit `2xx` quittierten Meldungen (NT-20); `tonight` = Laufzeitzustand der Nacht für faire Neuplanung (`allocation.md` §5.3); neue Revision je Session; speichert `night_plan(origin='server_plan')` | FA-SIM-05, FA-SYN-03 |
| `POST /sessions` | Session anlegen (`id` vom Plugin) mit Rig-Lease (5.6, `409 session.rig_busy`; `offline: true` ohne Lease; `night` außerhalb aktueller/folgender Nacht → `422 nina.night_invalid`, NT-01), Verweis auf den Plan (`nightPlanId` bzw. offline Blöcke + Input-Hash); Antwort enthält presigned **POST** (mit `content-length-range`) für das Planprotokoll (`plans/<id>.json.gz`) | FA-SYN-06, FA-RIG-06 |

**Koordinaten im Plan-Vertrag (verbindlich, AST-G12):** `blocks[].raDeg`/`decDeg` und `project_panel.ra_deg`/`dec_deg` sind **J2000/ICRS** – das ist, was NINAs `Center`/`CenterAndRotate` und jeder Plate-Solver erwarten. Die auf das Datum präzessierten Werte (`α_app`, `δ_app`) bleiben **engine-intern** und dienen nur `tM` und den Höhen (`flip-rotation.md` §1.1). Würde man die präzessierten Werte ausliefern, zielte NINA 2026 um **0,333° = 20′** in Rektaszension daneben und das Plate-Solve zentrierte sauber auf die falsche Stelle. Im Plugin entsteht daraus `new Coordinates(Angle.ByDegree(raDeg), Angle.ByDegree(decDeg), Epoch.J2000)` für Ziel, Slew und Metadaten – RA in **Grad**; das Original nutzt `Angle.ByHours` und wird darin nicht übernommen (NT-28, Unit-Test).

| Methode + Pfad | Zweck | Anforderung |
|---|---|---|
| `PATCH /sessions/{id}` | Status/Ende inkl. `outboxPending` (`completed` am Ende der Nachtschleife, `aborted` beim Benutzer-Stopp, NT-11/NT-15; kein Wiederöffnen mit `running`), dazu optional `offline: true` und `offlinePlan` zum Nachmelden des offline erzeugten Plans (NIN5-14, 6.6) (Anzahl noch nicht gesendeter Meldungen dieser Session), `ninaConditions` (Mittel/Min/Max aus NINA-Geräten, FA-AUS-15 b), neuer Plan nach *Zurücksetzen*; Ende gibt die Lease frei und legt Jobs an (KPIs, Nachtbericht, Aufwand) | FA-NIN-13/14, FA-AUS-15/21 |
| `POST /sessions/{id}/events` | Batch **≤ 200** Ereignisse (SEC-52), `message` ≤ 2 KiB, `data` ≤ 8 KiB und Tiefe ≤ 8; Überschreitung → `413` (das Plugin halbiert) bzw. `422` (Dead-Letter). Ohne Grenze überschreitet ein Paket die 3.000-Zeilen-Grenze von DSQL, antwortet `5xx`, und die Outbox wiederholt `5xx` **unbegrenzt** mit Backoff – das Paket kommt nie an und erzeugt dauerhaft Last | idempotent |
| `POST /sessions/{id}/captures` | Batch ≤ 500 Aufnahmemeldungen (**Lights, Flats, Dark-Flats**, Feld `frameType`), idempotent; Status je Meldung (6.6); Exoplaneten mit `transitObservationId`; Flats/Dark-Flats aktualisieren `flat_combination` | FA-SYN-04/05, FA-EXO-20, FA-NIN-17 |
| `POST /sessions/{id}/events` | Batch Ereignisse, idempotent | FA-SYN-06 |
| `POST /heartbeat` | Zustand aus `heartbeatStates` (`running`, `idle` – auch Warten auf Blockstart und leerer Plan –, `paused` – Safety –, `flats`, `offline` + `offlineUntil`, `blocked` + `blockedReason`; NT-17), Plugin-/Engine-Version, Profil-Standort, gemeldete Kamera-Auslesemodi, **NINA-Einstellungen** (Meridian-Flip, Rotator, Plate-Solve-Toleranz, Montierung, vorhandene Trigger, Kamera-Kühlung, Filterrad; NT-22, NT-E1, NT-E2) und ob der Flip-Trigger in der Sequenz vorhanden ist, zuletzt gemessener Positionswinkel, Dead-Letter-Anzahl, `ackedCommandIds[]`; verlängert die Lease in `rig_lease` bzw. holt sie zurück, wenn `active_session_id IS NULL OR = sessionId` und die Session nicht freigegeben wurde (M5, 5.6), und setzt `session.last_heartbeat_at` (`stale → running`, M6); Antwort mit `lease {untilUtc, leaseLost}`, `settingsVersion`, `targetsEtag`, `serverTimeUtc` (Uhrabgleich) und `commands[]` (7.6) | FA-SYN-07, FA-KAM-07, FA-NIN-04, FA-NIN-24, FA-RIG-06/11 |
| `GET /commands` / `POST /commands/{id}/ack` | reserviert (`refresh_targets`, `reset_plan`) | – |

### 7.4 Lang laufende Berechnungen

Alles, was länger als ~5 s dauern kann oder große Daten erzeugt, läuft als **Job**:

1. `api` legt eine Zeile in `job` an (`kind`, kleine `input`-Parameter, `dedupe_key` – **Pflicht auch für `multi_sim` (`multi_sim:<rigId>:<nightFrom>`) und `impact` (`impact:<queueItemId>`)**, SEC-51) und ruft `worker` **asynchron nur mit `{jobId}`** auf (`InvocationType: Event`, Wiederholungen 0); Antwort `202 {jobId}`. **Deduplizierung (verbindlich, DAT5-1):** `job.id` bleibt zufällig (`gen_random_uuid()`). Ein zweiter Auslöser wird über die Spalte **`dedupe_active`** verhindert: sie trägt den `dedupe_key`, solange `status IN ('pending','running')`, und wird beim Übergang auf `done`/`failed` auf `NULL` gesetzt; darauf liegt `UNIQUE INDEX ux_job_dedupe_active`. Anlegen mit `INSERT … ON CONFLICT (dedupe_active) DO NOTHING` – ist ein Job mit demselben Schlüssel offen, entsteht kein zweiter; ist keiner offen, läuft der nächste normal an. Damit funktionieren wiederkehrende Schlüssel wie `effort:<projectId>` (täglich) und `discord_post` dauerhaft. `dedupe_key` bleibt zur Diagnose stehen. Die Zustellung je Discord-Kanal ist zusätzlich über `UNIQUE (channel_id, event_key, object_id)` in `discord_delivery` eindeutig (DAT-11).
2. `worker` setzt `running`, führt aus, schreibt große Ergebnisse nach S3 `tenant/<tid>/jobs/<jobId>.json` und setzt `done`/`failed`.
3. Frontend pollt `GET /web/v1/jobs/{id}` (Status, Fortschritt, Download-Link).
4. Der Zeitplan `tick-5min` übernimmt liegengebliebene Jobs (`pending` älter als 2 min oder `running` älter als 20 min; höchstens 3 Versuche, `discord_post` 5) – damit kein Job verloren geht, wenn der asynchrone Aufruf scheitert.

> **Spec-Ergänzung (freigegeben von Sven am 28.09.2026):** Der Schlüssel `multi_sim:<rigId>:<nightFrom>` aus Punkt 1 lässt das auslösende Mitglied und die Optionen weg – ein zweiter Auslöser mit anderen `nights`, `weather` oder `includeOwnDrafts` (der Worker rechnet dann mit den Entwürfen von `job.created_by`) bekäme den offenen Job eines anderen Mitglieds bzw. einer anderen Einstellung. Verbindlich ist daher **`multi_sim:<rigId>:<nightFrom>:<memberId>:<optionsHash>`**; `optionsHash` = FNV-1a (32 Bit, 8 Hex-Zeichen) über die kanonische JSON-Liste aller übrigen Eingabefelder (Schlüssel sortiert, nach zod-Standardwerten), sodass neue ergebnisrelevante Optionen automatisch eingehen (`dedupeKeys.multiSim` in `packages/shared/src/contracts/jobs.ts`). Die Obergrenze von 3 offenen Jobs je Mitglied bleibt unverändert.

| `job.kind` | Auslöser | Ergebnis |
|---|---|---|
| `multi_sim`, `impact` | Simulator, Warteschlange | Mehrnacht-Simulation, Auswirkungsvorschau (FA-SIM-04, FA-FRG-05) |
| `effort` | Speichern/Einreichen/Freigeben, Sessionende, Korrektur/Verwerfen, einmal je Standortnacht aus `tick-hourly` (dedupliziert je Projekt, NT-08/NT-48) | `project.effort_*` (FA-PRJ-23) |
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
  "serverTimeUtc": "2026-09-17T18:02:11Z",
  "server": {
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
      ],
      "setpointC": -10,
      "toleranceC": 1
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
        "color": "#c8c8c8",
        "position": 0,
        "ninaFilterName": "L"
      },
      {
        "shortName": "Ha",
        "name": "H-alpha 3 nm",
        "color": "#d0342c",
        "position": 1,
        "ninaFilterName": "Ha 3nm"
      },
      {
        "shortName": "R",
        "name": "Red",
        "color": "#e53935",
        "position": 2,
        "ninaFilterName": "Red"
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
        "source": "panel",
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
  "tzdataVersion": "2026a",
  "nights": [
    {
      "night": "2026-09-17",
      "noonStartUtc": "2026-09-17T17:00:00Z",
      "noonEndUtc": "2026-09-18T17:00:00Z",
      "nightWindowEndUtc": "2026-09-18T13:00:00Z"
    },
    {
      "night": "2026-09-18",
      "noonStartUtc": "2026-09-18T17:00:00Z",
      "noonEndUtc": "2026-09-19T17:00:00Z",
      "nightWindowEndUtc": "2026-09-19T13:00:00Z"
    },
    {
      "night": "2026-09-19",
      "noonStartUtc": "2026-09-19T17:00:00Z",
      "noonEndUtc": "2026-09-20T17:00:00Z",
      "nightWindowEndUtc": "2026-09-20T13:05:00Z"
    }
  ],
  "timeZoneTransitions": [
    {
      "atUtc": "2026-03-08T08:00:00Z",
      "utcOffsetMinutes": -300
    },
    {
      "atUtc": "2026-11-01T07:00:00Z",
      "utcOffsetMinutes": -360
    }
  ]
}
```

**Zeit, Filterrad, Kamera und Flats im Bootstrap (verbindlich, NT-02/NT-05/NT-E1/NT-E2/NT-38/NT-40):** `serverTimeUtc` ist die **einzige** Uhrquelle des Plugins (ebenso in der Heartbeat-Antwort; Abweichung > 60 s blockiert weiterhin, offline keine Prüfung, nur ein Hinweis). `nights[]` beginnt mit der **Mittagsnacht** (Mittag-bis-Mittag-Intervall enthält `serverTimeUtc`; nach dem Nachtfensterende ist `currentNight` schon `nights[1]`) und trägt je Nacht `{night, noonStartUtc, noonEndUtc, nightWindowEndUtc}` (`nightWindowEndUtc` = Nachtfensterende nach `night.md` §3, vom Server gerechnet – `currentNight` rechnet nur aus der Tabelle); maßgeblich für Offsets ist allein die oberste Ebene `tzdataVersion` + `timeZoneTransitions[{atUtc, utcOffsetMinutes}]` (ein Offset-Feld je Nacht gibt es nicht). Daraus rechnet das Plugin `currentNight` (NT-01), *Warten auf Zeit* und das Enddatum der Tagesschleife in **Standortzeit** (NT-06). Filter tragen `position` und den bestätigten `ninaFilterName` (`null` = nicht zugeordnet). `camera.setpointC` (nullable) und `camera.toleranceC` (Standard 1) steuern die Kühlungswarnung; `defaultGain`/`defaultOffset` sind nullable (`null` = NINA-Standard `-1`). `scheduler.flats.source` = `panel` (wie bisher) oder `sky` (Himmelsflats, Zeitmarken im Plan).

Die zod-Schemas trennen die Projekttypen als **Discriminated Union** über `type` (`deep_sky` | `exoplanet`): nur so bleiben Pflichtfelder je Typ (Zeilen mit `order`/`enabled`/`counts` bei Deep-Sky, `transit` bei Exoplaneten) wirklich Pflicht (NIN-20). `readoutModes` sind Objekte `{index, name}`; Zeilen und Einträge tragen Name **und** Index (Plugin löst den Namen gegen die Kameraliste auf, `execution.md` §4.3). `scheduler.flats.darkFlats.count = null` bedeutet „wie Flats“. `leaseMinutes` = 3 (5.6).

#### `GET /nina/v1/targets` – was aufgenommen werden soll

Enthält **keine Uhrzeiten** der Nacht (die liefert der Plan), sondern Ziele, Pläne, Zähler (inkl. `planningNeed`) und Bedingungen. Antwort mit `ETag`; bei `If-None-Match` meist `304`. Je Belichtungszeile liefert `targets` den `ninaFilterName` der bestätigten Filterradbelegung (`null` = nicht zugeordnet): Das Plugin belichtet **nur** über diesen Namen mit exaktem Vergleich gegen das NINA-Profil, fehlt er → Aufnahme überspringen (`filter_not_found`); die Engine plant nicht zugeordnete Zeilen nicht ein (NT-E1). `gain`/`offset` sind nullable (NT-38). Das `ETag` enthält keine Zähler aus Aufnahmemeldungen (7.3, NT-19) – während der Nacht rechnet der Server die offenen Meldungen über `pendingCaptures` ab.

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
              "ninaFilterName": "Ha 3nm",
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
                "acquired": 25,
                "rejected": 2,
                "accepted": 23,
                "remaining": 17,
                "planningNeed": 17,
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
              "ninaFilterName": "Red",
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
            "planned": 310,
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
  "startAtUtc": "2026-09-18T07:35:00Z",
  "pendingCaptures": [
    {
      "exposureLineId": "l9…",
      "transitObservationId": "o5…",
      "captureIds": [
        "0192b7a1…",
        "0192b7a2…",
        "0192b7a3…"
      ]
    }
  ],
  "targetsEtag": "\"t-9b41\"",
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
      "e77c…/p0": 18300
    },
    "lastAutofocusUtc": "2026-09-18T01:12:30Z",
    "filterCycle": [
      {
        "unitId": "e77c…/p0",
        "lineId": "l9…",
        "subsOnLine": 305
      }
    ],
    "flipDoneByPanel": {
      "e77c…/p0": true
    },
    "currentUnitId": "e77c…/p0"
  }
}
```

`reason` = `initial` | `refresh` | `resume` | `reset`; `pendingCaptures` = `[{exposureLineId, transitObservationId?, captureIds:[…]}]` der noch nicht mit `2xx` quittierten Meldungen – der Server zieht nur IDs ab, die noch nicht in `capture` stehen, Dead-Letter-Aufnahmen zählen nicht (NT-20); `night` = aktuelle oder folgende Nacht nach `currentNight`, sonst `422 nina.night_invalid` (NT-01); `tonight` bei Neuplanung (Laufzeitzustand, `allocation.md` §5.3) – bei `reason: initial` ist nur `tonight.lastAutofocusUtc` zulässig (Autofokus im Start-Bereich aus NINAs AF-Historie, M7); ohne `tonight` rechnet der Server den Zustand aus den gemeldeten Aufnahmen und Ereignissen der Session).

Antwort (`NightPlan`):

```json
{
  "nightPlanId": "0192a7c0-0000-7000-8000-000000000b01",
  "engineVersion": "3.2.0",
  "inputHash": "sha256:9c1e…",
  "night": "2026-09-17",
  "revision": 1,
  "startAtUtc": "2026-09-18T00:00:00Z",
  "nightWindow": {
    "startUtc": "2026-09-18T00:00:00Z",
    "endUtc": "2026-09-18T13:00:00Z"
  },
  "darkness": {
    "civilStartUtc": "2026-09-18T01:04:49Z",
    "civilEndUtc": "2026-09-18T11:59:08Z",
    "nauticalStartUtc": "2026-09-18T01:33:13Z",
    "nauticalEndUtc": "2026-09-18T11:30:42Z",
    "astronomicalStartUtc": "2026-09-18T02:01:58Z",
    "astronomicalEndUtc": "2026-09-18T11:01:56Z"
  },
  "darknessEndUtc": "2026-09-18T11:30:42Z",
  "flatsNotBeforeUtc": "2026-09-18T11:30:42Z",
  "flatsNotAfterUtc": null,
  "sessionEndUtc": "2026-09-18T13:00:00Z",
  "blocks": [
    {
      "id": "0192a7c0-0000-7000-8000-000000000c01",
      "kind": "transit",
      "projectId": "e77c…",
      "panelId": "p9…",
      "transitObservationId": "o5…",
      "startUtc": "2026-09-18T02:08:00Z",
      "endUtc": "2026-09-18T07:34:00Z",
      "twilightEndUtc": "2026-09-18T11:30:42Z",
      "raDeg": 324.5366,
      "decDeg": 30.4886,
      "rotationDeg": 0.0,
      "rotationMode": "rotator",
      "meridianFlip": {
        "waitStartUtc": null,
        "plannedUtc": "2026-09-18T04:33:23Z",
        "durationS": 240,
        "inTransitWindow": true,
        "planned": false,
        "gapStartUtc": "2026-09-18T04:33:57Z",
        "gapDurationS": 330
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
      "startUtc": "2026-09-18T07:35:00Z",
      "endUtc": "2026-09-18T09:20:01Z",
      "twilightEndUtc": "2026-09-18T11:01:56Z",
      "raDeg": 13.2046,
      "decDeg": 56.6297,
      "rotationDeg": 90.0,
      "rotationMode": "rotator",
      "meridianFlip": {
        "waitStartUtc": null,
        "plannedUtc": "2026-09-18T07:47:55Z",
        "durationS": 240,
        "inTransitWindow": false,
        "planned": true,
        "gapStartUtc": null,
        "gapDurationS": null
      },
      "entries": [
        {
          "seq": 1,
          "cmd": "slew_center_rotate",
          "atUtc": "2026-09-18T07:35:00Z",
          "durationS": 330
        },
        {
          "seq": 2,
          "cmd": "autofocus_hint",
          "atUtc": "2026-09-18T07:40:30Z",
          "durationS": 120
        },
        {
          "seq": 3,
          "cmd": "filter",
          "atUtc": "2026-09-18T07:42:30Z",
          "durationS": 10,
          "filter": "Ha"
        },
        {
          "seq": 4,
          "cmd": "expose",
          "atUtc": "2026-09-18T07:42:40Z",
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
          "cmd": "dither",
          "atUtc": "2026-09-18T07:47:43Z",
          "durationS": 15
        },
        {
          "seq": 6,
          "cmd": "meridian_flip",
          "atUtc": "2026-09-18T07:47:58Z",
          "durationS": 240
        },
        {
          "seq": 7,
          "cmd": "slew_center",
          "atUtc": "2026-09-18T07:51:58Z",
          "durationS": 90
        },
        {
          "seq": 8,
          "cmd": "expose",
          "atUtc": "2026-09-18T07:53:28Z",
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
          "seq": 9,
          "cmd": "dither",
          "atUtc": "2026-09-18T07:58:31Z",
          "durationS": 15
        },
        {
          "seq": 10,
          "cmd": "expose",
          "atUtc": "2026-09-18T07:58:46Z",
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
          "seq": 11,
          "cmd": "dither",
          "atUtc": "2026-09-18T08:03:49Z",
          "durationS": 15
        },
        {
          "seq": 12,
          "cmd": "expose",
          "atUtc": "2026-09-18T08:04:04Z",
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
          "seq": 13,
          "cmd": "dither",
          "atUtc": "2026-09-18T08:09:07Z",
          "durationS": 15
        },
        {
          "seq": 14,
          "cmd": "expose",
          "atUtc": "2026-09-18T08:09:22Z",
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
          "seq": 15,
          "cmd": "dither",
          "atUtc": "2026-09-18T08:14:25Z",
          "durationS": 15
        },
        {
          "seq": 16,
          "cmd": "expose",
          "atUtc": "2026-09-18T08:14:40Z",
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
          "seq": 17,
          "cmd": "dither",
          "atUtc": "2026-09-18T08:19:43Z",
          "durationS": 15
        },
        {
          "seq": 18,
          "cmd": "expose",
          "atUtc": "2026-09-18T08:19:58Z",
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
          "seq": 19,
          "cmd": "dither",
          "atUtc": "2026-09-18T08:25:01Z",
          "durationS": 15
        },
        {
          "seq": 20,
          "cmd": "expose",
          "atUtc": "2026-09-18T08:25:16Z",
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
          "seq": 21,
          "cmd": "dither",
          "atUtc": "2026-09-18T08:30:19Z",
          "durationS": 15
        },
        {
          "seq": 22,
          "cmd": "expose",
          "atUtc": "2026-09-18T08:30:34Z",
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
          "seq": 23,
          "cmd": "dither",
          "atUtc": "2026-09-18T08:35:37Z",
          "durationS": 15
        },
        {
          "seq": 24,
          "cmd": "expose",
          "atUtc": "2026-09-18T08:35:52Z",
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
          "seq": 25,
          "cmd": "dither",
          "atUtc": "2026-09-18T08:40:55Z",
          "durationS": 15
        },
        {
          "seq": 26,
          "cmd": "expose",
          "atUtc": "2026-09-18T08:41:10Z",
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
          "seq": 27,
          "cmd": "dither",
          "atUtc": "2026-09-18T08:46:13Z",
          "durationS": 15
        },
        {
          "seq": 28,
          "cmd": "autofocus_hint",
          "atUtc": "2026-09-18T08:46:28Z",
          "durationS": 120
        },
        {
          "seq": 29,
          "cmd": "expose",
          "atUtc": "2026-09-18T08:48:28Z",
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
          "seq": 30,
          "cmd": "dither",
          "atUtc": "2026-09-18T08:53:31Z",
          "durationS": 15
        },
        {
          "seq": 31,
          "cmd": "expose",
          "atUtc": "2026-09-18T08:53:46Z",
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
          "seq": 32,
          "cmd": "dither",
          "atUtc": "2026-09-18T08:58:49Z",
          "durationS": 15
        },
        {
          "seq": 33,
          "cmd": "expose",
          "atUtc": "2026-09-18T08:59:04Z",
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
          "seq": 34,
          "cmd": "dither",
          "atUtc": "2026-09-18T09:04:07Z",
          "durationS": 15
        },
        {
          "seq": 35,
          "cmd": "expose",
          "atUtc": "2026-09-18T09:04:22Z",
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
          "seq": 36,
          "cmd": "dither",
          "atUtc": "2026-09-18T09:09:25Z",
          "durationS": 15
        },
        {
          "seq": 37,
          "cmd": "expose",
          "atUtc": "2026-09-18T09:09:40Z",
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
          "seq": 38,
          "cmd": "dither",
          "atUtc": "2026-09-18T09:14:43Z",
          "durationS": 15
        },
        {
          "seq": 39,
          "cmd": "expose",
          "atUtc": "2026-09-18T09:14:58Z",
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
          "seq": 40,
          "cmd": "end",
          "atUtc": "2026-09-18T09:20:01Z"
        }
      ]
    }
  ],
  "summary": {
    "targets": 2,
    "plannedFrames": {
      "e77c…": {
        "R": 305
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
      "message": "Meridiandurchgang im Transitfenster – Flip unvermeidlich, erwartete Lücke 330 s (Flip 240 s + Zentrieren 90 s): 305 statt 310 Aufnahmen"
    },
    {
      "projectId": "a91f…",
      "panelId": "p001…",
      "lineId": "l001…",
      "reason": "no_need",
      "message": "Planungsbedarf 17 Aufnahmen im Block erfüllt"
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
      "message": "Arbeit und nutzbare Zeit, aber keine Belichtung – die nutzbare Zeit liegt im gesperrten Transitfenster"
    }
  ]
}
```

`cmd` = `slew_center_rotate` | `slew_center` | `filter` | `expose` | `expose_series` (Transit) | `dither` | `wait` | `meridian_flip` | `autofocus_hint` | `end` (Aktionen: `execution.md` §4.2; `wait` und `autofocus_hint` sind Zeitmarken – `wait` endet spätestens beim folgenden `meridian_flip`, ein `autofocus_hint`, bei dem NINA keinen Autofokus auslöst, erhöht den Verzug nicht (NT-24); bei `meridian_flip` wartet das Plugin ab `atUtc`, bis NINAs früheste Flip-Zeit erreicht ist (höchstens bis `limitEnd`, M3), und ruft dann die Trigger aller Vorfahren über die eigene Iteration auf (`GetTriggersSnapshot` + Filter, Dither unterdrückt, M1) – NINA flippt (NT-21); `end` schließt jeden Block ab). Block-`kind` = `regular` | `transit`; Block-IDs sind UUIDs je Planrevision.

**Zeitmarken (verbindlich, FK 8.1):** `darknessEndUtc` = **spätester** Aufwärtsdurchgang der Dämmerungsgrenzen, die aktive Projekte dieser Nacht nutzen (NT-12; je Block gilt ohnehin die eigene Grenze aus `darkness`) – die frühere Regel „tiefste Grenze“ schnitt nautische Projekte ab. Existiert keine dieser Grenzen in der Nacht, ist er `null` (`night.md` §3, AST-N1); `darkness` liefert dazu alle drei Stufen einzeln, jede nullable. `flatsNotBeforeUtc` = frühester Flat-Start (Standard = `darknessEndUtc`, bei `null` = `nightWindow.endUtc − 1 h`; bei `flats.source = sky` Sonne −8° am Morgen; ohne −8°/−2°-Durchgang Rückfall wie `panel`, L12), **`flatsNotAfterUtc`** = spätester Flat-Start bei Himmelsflats (Sonne −2°, sonst bzw. ohne Durchgang `null`; Kombinationen danach → `skipped`, NT-40), `sessionEndUtc` = **Nachtende** = Ende des Nachtfensters (bürgerliche Morgendämmerung + 1 h). Die Nachtschleife endet, sobald `now ≥ (darknessEndUtc ?? sessionEndUtc)` und keine Flats ausstehen, spätestens bei `sessionEndUtc`; ein leerer Plan nach `darknessEndUtc` ist **kein** `plan_failed` (NT-11). Die Invariante `darknessEndUtc ≤ flatsNotBeforeUtc ≤ sessionEndUtc` gilt nur für Werte ungleich `null`. Stale-Schwelle (+ 2 h) und Nachtbericht hängen an `sessionEndUtc` der **letzten** Planrevision, gespeichert als `session.session_end_utc` (13, NT-09). `nightWindow` liefert beide Grenzen des Rasters – Beginn auf 5 min **ab**-, Ende **auf**gerundet (NT-07). **Je Block** trägt `twilightEndUtc` den Aufwärtsdurchgang der **eigenen** Dämmerungsgrenze des Blockprojekts (durchgehend dunkel → `nightWindow.endUtc`, nicht erreicht → `null`); die Nachtende-Kulanz eines `lastOfNight`-Eintrags endet bei `min(darknessEndUtc, block.twilightEndUtc)` (`null`-Werte zählen nicht, beide `null` → `blockEnd`) – Engine und Plugin prüfen gleich (M4, `allocation.md` §8.1, `execution.md` §4.2).

Die Diagnose läuft über **einen** Kanal: `diagnostics[]` mit `projectId`, optional `panelId` und **optional `lineId`** (zeilenweise Gründe für das Aufwand-Kennzeichen, `effort.md`), `reason` aus `enums.json` `diagnosticReasons` und optionaler Meldung (ein Eintrag je Grund, mehrere Gründe je Projekt möglich). `warnings[]` enthält die Plausibilitätswarnungen (FA-SIM-03) als `{code, level, unitId?, atUtc?, durationS?, message?}` – `code` aus `simulatorWarnings`, `level` aus `warningLevels` (`warn` | `error`), `unitId` in der Schreibweise `"<projectId>[/p<index>]"` (`allocation.md` §5.3).

**Meridian-Flip am Block – eine Struktur (verbindlich):** `meridianFlip: { waitStartUtc: string|null, plannedUtc: string, durationS: number, inTransitWindow: boolean, planned: boolean, gapStartUtc: string|null, gapDurationS: number|null }`. `durationS` deckt nur den Flip; die anschließende Zentrierung ist ein eigener `slew_center_rotate`/`slew_center`-Eintrag. Transitblöcke enthalten keinen `meridian_flip`-**Eintrag** (`planned: false`). **Eine Definition (M8):** `inTransitWindow = true`, wenn `tM` im Transitfenster liegt; liegt `tM + afterMin` im Fenster, ist der Flip unvermeidlich – NINA flippt nie vorher (NT-25) – und `gapStartUtc`/`gapDurationS` weisen die erwartete Lücke aus (Beginn, Dauer einschließlich Zentrieren), sonst sind beide `null`; liegt `tM + afterMin` im Vorlauf vor dem Fensterbeginn, steht der Flip als Eintrag im Vorlauf (`planned: true`, L1, `transit.md` §3), und die Diagnose `flip_in_transit` nennt zusätzlich „AF nach Flip aktiv“, wenn NINAs `AutoFocusAfterFlip` gesetzt ist. **Flip-Kandidaten:** der obere Meridiandurchgang und – wenn die Höhe dort ≥ Mindesthöhe ist – die untere Kulmination (LHA = 180°), weil NINA auch dort flippt (`MeridianFlip.cs`, `% 12`; NT-26); `tM` immer mit α_app (NT-34). **Pierseite:** vor dem Flip `west`, danach `east` (ASCOM-Pointing-State `pierWest`/`pierEast`, Zuordnung in `execution.md`, NT-34). Wechselt die erwartete Pierseite zwischen aufeinanderfolgenden Blöcken (Mosaik), rechnet die Engine die Flip-Dauer zusätzlich zum Slew ein; die Panelreihenfolge bevorzugt nach einem Flip Panels, deren `tM` schon überschritten ist (NT-27).

**Transitblock (verbindlich, NIN5-5):** `startUtc` ist der **Fensterbeginn** aus `targets` (`windowStartUtc`), nicht der Slew-Beginn. Der Slew-/Zentrier-Vorlauf steht als erster Eintrag mit `atUtc = startUtc − slewCenterS − 60 s` und liegt damit **vor** `startUtc` – der einzige Fall im Plan, in dem ein Eintrag dem Blockbeginn vorausgeht (`transit.md` §3). Das Plugin zieht den Vorlauf nicht erneut ab. `preClaimTransits` sperrt zusätzlich jeden Slot, der `[Fensterbeginn − slewCenterS − 60 s, Fensterbeginn)` schneidet; als „geplanter Blockstart“ eines Transitblocks (Verzug, Neuplanung) gilt `min(atUtc)` seiner Einträge (NT-25).

Flats/Dark-Flats stehen nicht im Plan; das Plugin bildet die Kombinationen aus den tatsächlich gespeicherten Lights (FA-NIN-17). Das Beispiel ist aus Standort und Overheads des Bootstrap-Beispiels gerechnet; die maßgeblichen Zahlen stehen mit Herleitung in `contracts/nina/README.md` und werden hier bewusst nicht wiederholt (NT-34). Eckwerte: `nightWindow` **00:00:00Z – 13:00:00Z** (Rundung nach NT-07, nicht 00:05/12:59); die Meridiandurchgänge sind mit der **scheinbaren** Rektaszension gerechnet – `tM` des Transitziels **04:28:23Z**, des NGC-281-Panels **07:42:55Z** (die J2000-RA ergab fälschlich 04:27:13/07:41:22, NT-34). Der Transitblock enthält deshalb eine unvermeidliche Flip-Lücke (`inTransitWindow: true`, NT-25), der NGC-281-Block einen `meridian_flip`-Eintrag nach der Regel `limitEnd = tM + maxAfterMin` ohne `wait`, mit Dither nach der Belichtung vor dem Flip. Die ungenutzte Zeit danach erzeugt kein `idle_gap`, weil keine Einheit mit Restbedarf dann nutzbar ist (`allocation.md` §12). Der Plan zeigt nur zwei Blöcke.

#### `POST /nina/v1/sessions` · `PATCH /nina/v1/sessions/{id}`

```json
{
  "id": "0192a7c0-0000-7000-8000-000000000a01",
  "night": "2026-09-17",
  "nightPlanId": "0192a7c0-0000-7000-8000-000000000b01",
  "startedAtUtc": "2026-09-18T01:13:10Z",
  "offlinePlan": null,
  "offline": false
}
```

Antwort `201` bzw. `409 session.rig_busy`:

```json
{
  "sessionId": "0192a7c0-0000-7000-8000-000000000a01",
  "lease": {
    "untilUtc": "2026-09-18T01:16:10Z"
  },
  "planLogUploadUrl": "https://…"
}
```

```json
{
  "status": "completed",
  "endedAtUtc": "2026-09-18T11:42:30Z",
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

**Session-Regeln (verbindlich):** `night` muss die aktuelle oder die folgende Nacht nach `currentNight` sein, sonst `422 nina.night_invalid` (NT-01); `startedAtUtc` liegt nach `plan_built` (Plan vor Session, NT-47). Der Server speichert je Session das maßgebliche `session_end_utc` der **letzten** Planrevision (Verwaist-Regel, Nachtbericht, NT-09). `PATCH {status: "completed"}` sendet das Plugin erst am Ende der Nachtschleife (NT-11); eine abgeschlossene Session wird **nicht** mit `running` wieder geöffnet. `PATCH {status: "running", resumedAtUtc}` dient nur der Wiederaufnahme einer nicht abgeschlossenen Session nach einem Neustart – `startedAtUtc` bleibt unverändert (NT-47). **Statusübergänge (M6):** `running → completed | aborted | stale` und als einziger Rückweg `stale → running` (Heartbeat oder `PATCH running` derselben Session); `completed` und `aborted` sind **endgültig** – ein `PATCH {status: "running"}` darauf antwortet `409 session.closed`. Stoppt der Benutzer die Sequenz, folgt `PATCH {status: "aborted"}`, danach Heartbeats ohne `sessionId` (NT-15). Einen offline erzeugten Plan meldet `PATCH {offline: true, offlinePlan}` **vor** den ersten Aufnahmen dieses Plans (FIFO-Barriere der Outbox, NT-14).

#### `POST /nina/v1/sessions/{id}/captures` – Lights, Flats, Dark-Flats

```json
{
  "captures": [
    {
      "id": "0192a8…",
      "frameType": "light",
      "capturedAtUtc": "2026-09-18T08:04:04Z",
      "exposureMidUtc": "2026-09-18T08:06:34Z",
      "night": "2026-09-17",
      "blockId": "0192a7c0-0000-7000-8000-000000000c11",
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
      "raDeg": 13.2046,
      "decDeg": 56.6297,
      "rotationDeg": 270.4,
      "pierSide": "east",
      "rotatorMechDeg": 270.4,
      "bonus": false,
      "temperatureDeviation": false,
      "result": "saved",
      "fileName": "NGC 281_Ha_300s_0023.fits",
      "metrics": {
        "hfr": 2.1,
        "stars": 1432,
        "meanAdu": 812,
        "sensorTempC": -10.0,
        "setPointC": -10.0,
        "guidingRmsArcsec": 0.62,
        "altitudeDeg": 61.2,
        "airmass": 1.14,
        "focusPosition": 14820
      },
      "nightPlanId": "0192a7c0-0000-7000-8000-000000000b02",
      "readoutModeIndex": 0
    },
    {
      "id": "0192b1…",
      "frameType": "flat",
      "capturedAtUtc": "2026-09-18T11:31:35Z",
      "exposureMidUtc": "2026-09-18T11:31:36.200Z",
      "night": "2026-09-17",
      "projectIds": [
        "a91f…"
      ],
      "filterShortName": "Ha",
      "filterActual": "Ha 3nm",
      "exposureS": 2.4,
      "gain": 100,
      "offset": 20,
      "binning": 1,
      "readoutMode": "High Gain Mode",
      "rotatorMechDeg": 270.4,
      "temperatureDeviation": false,
      "result": "saved",
      "fileName": "FLAT_NGC 281_Ha_0001.fits",
      "metrics": {
        "meanAdu": 32100,
        "sensorTempC": -10.0,
        "setPointC": -10.0
      },
      "nightPlanId": "0192a7c0-0000-7000-8000-000000000b03",
      "readoutModeIndex": 0,
      "flatsPlanned": 20,
      "darkFlatsPlanned": 20
    },
    {
      "id": "0192b9…",
      "frameType": "dark_flat",
      "capturedAtUtc": "2026-09-18T11:37:10Z",
      "exposureMidUtc": "2026-09-18T11:37:11.200Z",
      "night": "2026-09-17",
      "projectIds": [
        "a91f…"
      ],
      "filterShortName": "Ha",
      "filterActual": "Ha 3nm",
      "exposureS": 2.4,
      "gain": 100,
      "offset": 20,
      "binning": 1,
      "readoutMode": "High Gain Mode",
      "rotatorMechDeg": 270.4,
      "temperatureDeviation": false,
      "result": "saved",
      "fileName": "DARKFLAT_NGC 281_2.4s_0001.fits",
      "metrics": {
        "sensorTempC": -10.0,
        "setPointC": -10.0
      },
      "nightPlanId": "0192a7c0-0000-7000-8000-000000000b03",
      "readoutModeIndex": 0,
      "flatsPlanned": 20,
      "darkFlatsPlanned": 20
    }
  ]
}
```

Antwort: `{ "results": [ { "id": "0192a8…", "status": "accepted" }, { "id": "0192b1…", "status": "accepted" }, … ] }` (Statuswerte 6.6).

**Pflichtfelder je Typ:** alle Typen `id`, `frameType`, `capturedAtUtc` (= `MetaData.Image.ExposureStart`, UTC), `exposureMidUtc` (= `ExposureMidPoint`; Grundlage der BJD_TDB-Rechnung FA-EXO-29, NT-10), `night`, `nightPlanId`, `filterShortName`, `filterActual`, `exposureS`, `gain`, `offset` (beide nullable, NT-38), `binning`, `readoutMode`, `readoutModeIndex`, `result`, `temperatureDeviation` (NT-E2); `fileName` **nur bei `result = saved`** (bei `aborted`/`failed` optional). *Light* zusätzlich `blockId` (UUID), `projectId`, `panelId`, `exposureLineId` (oder `assignment: "unassigned"`), `raDeg`/`decDeg` (Soll-Koordinaten des Panels), `rotationDeg` (Positionswinkel des letzten Plate-Solve im Block, sonst Soll), `pierSide` (`east`/`west`, unbekannt `null`), `rotatorMechDeg`, `bonus`; Exoplaneten `transitObservationId`. *Flat* und *Dark-Flat* zusätzlich `rotatorMechDeg`, `projectIds` (alle Ziele der Kombination; das Plugin kopiert die Dateien in deren Ordner, Kopien werden nicht gemeldet) sowie `flatsPlanned`/`darkFlatsPlanned` (beide **optional** – Rückfall auf die Rig-Einstellung, Regel unten); *Flat* zusätzlich `metrics.meanAdu`.

- **`nightPlanId` (verbindlich, NIN5-14):** Pflichtfeld. **Einzige Ausnahme:** eine offline angelegte Session darf `null` melden, solange ihr Offline-Plan noch nicht per `PATCH … {offline: true, offlinePlan}` nachgemeldet ist; der Server setzt beim Nachmelden die neue ID ein (6.6). Online gemeldete Aufnahmen ohne `nightPlanId` erhalten je Meldung `rejected_invalid` (kein `422` für das ganze Paket, 6.6). Aufnahmen eines lokal (Jint) erzeugten Plans tragen dessen vom Plugin vergebene ID; die Outbox sendet den Plan vorher per `PATCH` (FIFO-Barriere, NT-14). Nach einer Neuplanung tragen Lights die `nightPlanId`/`blockId` des jeweils **ausgeführten** Plans (nach `resume` eine neue ID, NT-18/NT-47).
- **`rotatorMechDeg` je `frameType` (verbindlich, NIN5-8):** bei `light` der **gemessene** mechanische Rotatorwinkel (ohne Rotator `0`), bei `flat`/`dark_flat` der **eingefrorene Repräsentant** der Flat-Kombination (Median in Zehntelgrad, `execution.md` §7). Nur so stimmen Plugin- und Serverschlüssel überein.
- **`flatsPlanned` / `darkFlatsPlanned` (verbindlich, NIN5-9):** Sollzahlen dieser Kombination in dieser Nacht; die **erste** Meldung je Kombination gewinnt, fehlende Felder fallen auf die Rig-Einstellung zurück (6.6). `darkFlatsPlanned = 0`, wenn die Dark-Flat-Gruppe der Nacht schon erledigt ist; bei Auto-Exposure-/Sky-Flat-Boxen dürfen beide fehlen.
- **`metrics`-Schlüssel und ihre Herkunft (NIN5-10):** `hfr` und `stars` aus der **Sterndetektion** des aufbereiteten Bildes, `meanAdu` aus `imageData.Statistics.Mean`, `sensorTempC` und `setPointC` aus den Kamera-Metadaten (**Pflicht, wenn die Kamera sie liefert**, NT-E2), `guidingRmsArcsec` aus dem Guider, `altitudeDeg`/`airmass` aus der Montierungsposition – **`airmass` ist ein Wert des Treibers, Formel und Höhenbasis unbestimmt, reine Anzeige, geht in keine Planungsregel ein** (die Nutzbarkeit rechnet ausschließlich über die Zielhöhe); Plausibilitätsgrenze beim Ingest `1 ≤ airmass ≤ 40` (Kasten & Young 1989 liefert am Horizont 37,9). Eine eigene Anzeige rechnet **Kasten & Young aus der scheinbaren Höhe**, nicht `sec z` – das weicht bei 10° um 3,1 %, bei 5° um 11,3 % ab (AST-G14) –, `focusPosition` aus dem Fokussierer – alle übrigen optional; fehlt ein Wert, bleibt das Feld **weg** (nicht `0`). Darks und Bias werden nicht gemeldet (OP-26).
- **Kühlung (NT-E2):** Das Plugin prüft vor Blockstart und je Belichtung `CoolerOn` und `|Temperatur − setpointC| ≤ toleranceC`; bei Abweichung wird **weiter belichtet**, die Aufnahme mit `temperatureDeviation: true` gemeldet und höchstens einmal je Block ein `warning` mit Code `camera_temperature` gesendet. Ohne `setpointC` entfällt die Prüfung.
- **Abweichende Einstellungen (NT-E3):** Weicht eine Light-Meldung in Filter, Belichtungszeit, Binning, Gain oder Offset von der Zeile ab, speichert und zählt der Server sie mit `settings_deviation = true` (6.6).

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
    "useSideOfPier": true,
    "recenter": false,
    "autoFocusAfterFlip": false,
    "settleTimeS": 30,
    "pauseBeforeMin": 0,
    "afterMin": 5,
    "maxAfterMin": 15
  },
  "rotator": {
    "connected": true,
    "rangeType": "FULL",
    "rangeStartMechanicalDeg": 0,
    "reverse": false
  },
  "plateSolve": {
    "rotationToleranceDeg": 1.0
  },
  "mount": {
    "equatorialSystem": "JNOW",
    "siteLatDeg": 31.5471,
    "siteLonDeg": -99.3823,
    "siderealTimeDeltaS": 0.4
  },
  "sequenceTriggers": {
    "autofocus": [
      "AutofocusAfterTimeTrigger",
      "AutofocusAfterHFRIncreaseTrigger"
    ],
    "autofocusAfterTimeMin": 60,
    "dither": []
  },
  "camera": {
    "temperatureC": -10.1,
    "setPointC": -10.0,
    "coolerOn": true,
    "coolerPowerPct": 38
  },
  "lastMeasuredRotationDeg": 0.3,
  "filterWheel": [
    {
      "position": 0,
      "name": "L",
      "focusOffset": 0
    },
    {
      "position": 1,
      "name": "Ha 3nm",
      "focusOffset": 35
    },
    {
      "position": 2,
      "name": "Red",
      "focusOffset": 12
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

`leaseLost = true` → Plugin beendet die laufende Belichtung, startet keine neuen Blöcke (5.6). Bleiben drei Heartbeats **ohne** Serverantwort (Netzfehler, Timeout), gilt die Lease nicht als verloren: Zustand `unreachable`, die Blöcke laufen weiter, der nächste Planbedarf wird mit Jint aus dem Cache gedeckt (NT-14). `state = "offline"` friert Lease und Überwachung ein (`offlineUntil` höchstens 14 Tage). `state` aus `enums.json` `heartbeatStates` (`running`, `idle`, `paused`, `flats`, `offline`, `blocked`); bei `blocked` trägt der Heartbeat zusätzlich `blockedReason` aus `blockedReasons`. Warten auf den Blockstart und ein leerer Plan melden `idle`, eine Safety-Unterbrechung `paused` (NT-17, NT-16).

**NINA-Einstellungen im Heartbeat (verbindlich, NT-22):** Der Heartbeat meldet `MeridianFlipSettings` (`UseSideOfPier`, `Recenter`, `AutoFocusAfterFlip`, `SettleTime`, `PauseTimeBeforeMeridian`, `MinutesAfterMeridian`, `MaxMinutesAfterMeridian`), `RotatorSettings` (`RangeType`, `RangeStartMechanicalPosition`, `Reverse`), `PlateSolveSettings.RotationTolerance`, die Montierung (`EquatorialSystem`, `SiteLatitude`/`SiteLongitude`, |LST der Montierung − berechnete LST|), die vorhandenen Trigger (Autofokus-Trigger-Typen, `Amount` von *Autofokus nach Zeit* als `autofocusAfterTimeMin`, Dither-Trigger), die Kamera `{temperatureC, setPointC, coolerOn, coolerPowerPct}` (NT-E2) und das NINA-Filterrad `[{position, name, focusOffset}]` (NT-E1). **Vorgaben:** NINA-*Recenter* nach dem Flip **aus** (das Plugin zentriert bzw. prüft den Winkel), kein NINA-Dither-Trigger, Montierung J2000 oder JNow (B1950/J2050 → Warnung), Montierungsstandort = Rig-Standort (Länge Ost positiv; LST-Abweichung > 1 min → `mount_site_mismatch`), `RotatorSettings.RangeType` = `FULL` oder `HALF` (`QUARTER` legt den Winkel in einen 90°-Bereich und fährt ggf. PA + 90° an → `rotator_range_quarter`, M2; „PA oder PA + 180°“ gilt nur für `FULL`/`HALF`), *Autofokus nach Zeit* mit `Amount = afEveryMin` (M7: fehlt der Trigger, übergibt der Server der Engine `afEveryMin = 0` und meldet `af_time_trigger_missing`; abweichender `Amount` → `af_time_mismatch`). Abweichungen meldet der Server als Alarm **`alert.nina_settings_mismatch`** mit Code-Liste (der bisherige Alarm, erweitert; Discord-Ereignis `nina.settings_mismatch`, 7.7; Codes: `enums.json` `ninaSettingsMismatchCodes`), u. a. `filter_wheel_changed` (gemeldeter Name ≠ bestätigte Zuordnung → Platz unbestätigt, NT-E1), `mount_site_mismatch`, `nina_dither_trigger_present`, `rotator_range_quarter`. Mit `Recenter = true` ohne Rotator entfällt das eigene Zentrieren nach dem Flip (nur Winkelprüfung). Die Antwort trägt `serverTimeUtc`, dieselbe Uhrquelle wie der Bootstrap (NT-05).

**`commands` (verbindlich, NIN5-14):** Liste von Kommandos, die der Server dem Rig mitgibt – Werte aus `enums.json` `ninaCommands`: `refresh_targets` (sofort `GET /targets` und, falls geändert, neu planen) und `reset_plan` (wie die Benutzeraktion *Zurücksetzen*: Blockindex 0, `reason: reset`, 5-min-Sperre aufheben). Jedes Kommando hat eine `id`; das Plugin führt es **genau einmal** aus und quittiert es im nächsten Heartbeat mit `ackedCommandIds[]`. Der Server entfernt quittierte Kommandos und wiederholt unquittierte höchstens 10 min lang. Kommandos entstehen aus den Web-Aufrufen `POST /web/v1/rigs/{id}/commands` (Rechte 5.5).

#### Weitere Aufrufe

- `POST /nina/v1/sessions/{id}/events` – `{ "events": [ { "id", "occurredAtUtc", "kind", "code?", "nightPlanId?", "blockId?", "projectId?", "durationS?", "message?", "data": {} } ] }` (`code` = maschinenlesbarer Unterfall, z. B. `clock_skew`, `image_not_saved`, `camera_temperature`, `rig_busy`; `message` nur für Menschen und **ohne feste Uhrzeiten** – Zeiten stehen nur in `…Utc`-Feldern, NT-03), `kind` aus `contracts/enums.json` `sessionEventKinds` (u. a. `plan_built`, `plan_rebuilt`, `block_start`, `block_end`, `block_skipped`, `center_failed`, `safety_pause`, `safety_resume`, `flip`, `rotation_mismatch`, `transit_start`, `transit_end`, `trigger_suppressed`, `filter_not_found`, `readout_mode_not_found`, `flats_start`, `flats_end`, `lease_conflict`, `lease_lost`, `offline_start`, `offline_end`, `warning`, `error`); Gründe für `block_skipped`/`block_end` aus `blockSkipReasons`/`blockEndReasons` – `blockEndReasons` enthalten `interrupted` (Safety/Unterbrechung) und `replanned`, nicht mehr `flats`; `blockSkipReasons` (u. a. `user_skip`, `rotation_mismatch`, `filter_not_found`, `lease_lost`) beschreibt `execution.md` §4.1 vollständig (NT-17). **Plugin-Warncodes** (Ereignis `warning`, Feld `code`, Enum `pluginWarningCodes` in `enums.json`): `camera_temperature`, `nina_dither_trigger_present`, `rotator_unavailable`, `trained_flat_position_changed`, `flat_exposure_off`, `filter_wheel_changed`, `mount_site_mismatch`, `pc_timezone_differs`, `optics_mirrored`, `image_not_saved`, `rotator_range_quarter` (M2), `safety_monitor_not_connected` (H2), `sequence_template_deviation` (H3). `readout_mode_not_found` ist **kein** Warncode, sondern eine eigene Ereignisart (`sessionEventKinds`, L13).

### 7.7 Discord-Kanäle je Mandant (ausgehend)

- **Konfiguration:** `tenant.discord_*` (Server) und `discord_channel` (Kanäle mit Kategorien `approvals`, `sessions`, `alerts` und Ereignisfilter). Webhook-URLs liegen in `discord_channel.webhook_url` (SV-10): sie werden nie an den Browser ausgeliefert und nie geloggt; die Oberfläche zeigt nur `webhook_hint` (letzte 4 Zeichen). Beim Speichern prüft `api` den Host gegen `discord.com`/`discordapp.com` (SSRF), `worker` liest die URL zum Senden. Kein SSM-Parameter je Kanal, kein SSM-Schreibrecht für `api`.
- **Export/Import:** Der Mandanten-Export schreibt `webhook_url` nie mit; importierte Kanäle kommen **ohne URL und deaktiviert** an, bis ein Admin die URL in S-71 neu einträgt (6.10).
- **Prüfung vor jedem Senden:** Der Job `discord_post` (`worker`) prüft vor **jedem** Senden erneut `https` und den Host `discord.com`/`discordapp.com` – die Prüfung beim Speichern allein genügt nicht, falls die Zeile auf anderem Weg (Import, Datenkorrektur) geschrieben wurde – und folgt **keinen Weiterleitungen** (`fetch(url, { redirect: 'manual' })`; eine `3xx`-Antwort gilt als Fehler). Fehlt die URL oder scheitert die Prüfung, wird nicht gesendet, `last_error` gesetzt und der Kanal deaktiviert.
- **Ereignisse → Kategorien:**

| Kategorie | Ereignisse (`eventKey`) |
|---|---|
| `approvals` | `submission.new`, `submission.withdrawn`, `approval.approved`, `approval.returned`, `approval.rejected`, `approval.expired`, `deadline.near`, `change_request.new`, `change_request.decided` |
| `sessions` | `session.started`, `session.completed`, `session.stale`, `session.report` (Nachtbericht, FA-AUS-21 – ausschließlich über den Job `session_report`, der je Kanal `discord_post`-Jobs anlegt), `transit.observed`, `transit.missed` |
| `alerts` | `session.no_heartbeat` (> 10 min während *läuft*, nicht im Offline-Modus; Zeitschwellen FK 8.1), `plugin.dead_letters`, `rig.busy`, `nina.settings_mismatch` (mit Code-Liste, 7.6, NT-22), `discord.channel_failed` |

- **Zustellung:** Das auslösende Ereignis legt je passendem, aktivem Kanal einen Job `discord_post` an (Deduplizierung über `<channelId>:<eventKey>:<objektId>`) und dazu eine Zeile `discord_delivery` mit `tenant_id`, `status = 'pending'`. Der Job `tick-5min` holt liegengebliebene Zustellungen über den Index `(status, created_at)` (DAT5-4).
- **Erneut senden (FA-AUS-21, DAT5-4):** `POST /web/v1/sessions/{id}/report/resend` (und entsprechend für andere Ereignisse) setzt die bestehende `discord_delivery`-Zeile **explizit zurück** – `status = 'pending'`, `attempts = 0`, `last_error = NULL`, `sent_at = NULL`, `job_id = NULL` – und legt einen neuen `discord_post`-Job an. Der Primärschlüssel `(channel_id, event_key, object_id)` bleibt damit eindeutig und blockiert das erneute Senden nicht. Jeder Reset steht im Änderungsprotokoll. `worker` sendet `POST <webhookUrl>?wait=true` mit `{ "username": "Svenesis NINA-PM", "embeds": [ … ], "allowed_mentions": { "parse": [] } }` (max. 10 Embeds, 6.000 Zeichen; der Nachtbericht wird bei Bedarf auf mehrere Meldungen verteilt). `429` → Wartezeit aus `retry_after` und erneuter Versuch; `5xx`/Netz → bis 5 Versuche mit Backoff; `401`/`404` → Kanal deaktivieren, `last_error` setzen, Benachrichtigung `discord.channel_failed` an die Admins in der App.
- **Inhalte:** Zeitangaben als Discord-Zeitstempel `<t:unix:t>` (Ortszeit des Lesers) **plus** Standortzeit mit Kürzel (NT-03); Texte über i18n in der Standardsprache des Mandanten, Links auf `https://nina-pm.svenesis.org/…`; keine Dateinamen, Tokens, Standortkoordinaten; Anzeigenamen nur, wenn im Ereignisfilter erlaubt.
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
export function windShear(s1Kmh: number|null, dir1Deg: number|null,       // Vektordifferenz zweier Winde, km/h (WS-02)
                          s2Kmh: number|null, dir2Deg: number|null): number | null;
export function weatherScores(input: WeatherScoreInput): WeatherScores;   // Spec: specs/engine/weather.md (AST-D24, WS-11)
export function rankTargets(input: RankInput): RankedTarget[];
export function estimateEffort(input: EffortInput): EffortEstimate;         // Aufwand-Kennzeichen (FK 8.9)
export function canonicalInputJson(input: unknown): string;                // Grundlage für inputHash in allen Hosts
export const ENGINE_VERSION: string;
```

`PlanInput` enthält: Standort (Lat/Lon/Höhe), Nacht, Zeitzonen-Übergänge (vom Server geliefert, inkl. tzdata-Version), Rig-Geometrie, Scheduler-Settings (inkl. Meridian-Flip), Rotator-Angaben (vorhanden, Kamerawinkel, Toleranz), Mondprofile, Projekte (Panels mit **Panel-Koordinaten**, Zeilen mit Restbedarf, Bonus-Spielraum und bestätigtem `ninaFilterName` – nicht zugeordnete Zeilen plant die Engine nicht ein, Diagnose `filter_not_found` mit `lineId` (NT-E1) –, Bedingungen, Priorität, Startdatum, Zieltermin, Exoplaneten-Ereignis mit `lockedAt`), Overhead-Annahmen, optional `startAtUtc` und `tonight` (Neuplanung während der Nacht: vergangene Blöcke je Einheit, belichtete Sekunden, letzter Autofokus, Filterzyklus, Flip erledigt je Panel, aktuelle Einheit) und **genau ein** Modusfeld `mode: 'productive' | 'compat'` (Kompatibilität nur für das Orakel, `allocation.md` §11.1).

**Wetter-Verträge (WS-11, verbindlich; Rechenvorschrift `specs/engine/weather.md`).**
```ts
type WeatherScoreInput = {
  hourly: WeatherHourly[];                                             // durchgehende Stundenreihe des Abrufs
  darkWindows: { night: string; fromUtc: number; toUtc: number }[];    // je Nacht ein Fenster, Unix-Sekunden
};
```
Ein Aufruf deckt **mehrere Nächte** ab: `darkWindows` trägt je Nacht den Schlüssel aus `night.md` §1 und die exakten −18°-Durchgänge aus `night.md` §2 (FA-WET-04). Die Grenzen kommen aus `computeNight` und werden **nicht** in der Wetterfunktion gerechnet; Nächte ohne Dunkelheit (Polartag) fehlen in der Liste. Der Name `darkWindows` ist derselbe wie im Baustein-Vertrag `WeatherChart` (`specs/ui/components.md` §2.5; dort ISO-Zeitstempel für die Anzeige, hier Unix-Sekunden für die Rechnung). Jeder Eintrag ergibt genau eine Zeile `WeatherNight` im Ergebnis.

`WeatherHourly` je Stunde (`tUtc` = Beginn der Stunde, alle Zahlen `number|null`):

- **Bewölkung:** `cloudTotalPct` (aus `cloud_cover`, **Grundlage der Bewertung**), `cloudLowPct`, `cloudMidPct`, `cloudHighPct` (nur Anzeige – die Schichtgewichtung 1 / 0,8 / 0,5 des früheren `cloudEff` entfällt, WS-01).
- **Luft am Boden:** `tempC`, `dewPointC`, `humidityPct`, `surfacePressureHPa`, `visibilityM` (ohne Wirkung auf die Bewertung, dient Anzeige und Modell-Erkennung).
- **Wind:** `wind10Kmh`, `gust10Kmh`, `windDir10Deg`, `wind250Kmh`/`windDir250Deg`, `wind500Kmh`/`windDir500Deg`, `wind700Kmh`/`windDir700Deg`, `wind850Kmh`/`windDir850Deg`.
- **Niederschlag und Code:** `precipMm`, `precipProbPct`, `weatherCode`.
- **Luftchemie und Wasserdampf:** `aod` (CAMS, dimensionslos), `dustUgM3`, `pwvMm` (aus dem Modellvergleichs-Abruf, 14).
- **Abgeleitet in der Engine:** `jetKmh` = `max(w250, 1,3·w500)` (`null`, wenn beide fehlen; fehlt einer, zählt er als 0 – die **einzige** Stelle, an der ein `null` durch 0 ersetzt wird, 1:1 aus der Vorlage), `shearKmh` = `windShear(250 hPa, low)` mit der Untergrenze `low` nach Bodendruck: `surfacePressureHPa < 750 → 500 hPa`, `< 900 → 700 hPa`, sonst `850 hPa` (WS-03), und **`moonAltDeg`** – die **geometrische topozentrische** Mondhöhe in Grad zum Stundenmittelpunkt `tUnix + 1800`, Grundlage von `moonFreeSec` (unten) und ohne Wirkung auf eine Bewertung.
- **Herkunft je Stunde:** `modelId` (`d2|eu|global|dini|hrrr|gem|gfs`), `cloudSrc` (`dini|gem|null`), `nest` (bool, WS-14), `aerosolMissing` (bool, WS-E2), `seeingIncomplete` (bool, WS-04a) mit
  `seeingIncomplete = jetKmh != null and (wind250Kmh == null or wind500Kmh == null or shearKmh == null or wind10Kmh == null)`
  – also **jeder** fehlende Eingangswert des Seeings, auch einer der beiden Höhenwinde, weil `jetKmh` ihn als 0 einsetzt. **Ohne Score kein Kennzeichen:** `jetKmh == null` ergibt `seeingScore = null` und `seeingIncomplete = false`.

**Intervallwerte (WS-12):** `gust10Kmh`, `precipMm` und `precipProbPct` beschreiben die **vorangehende** Stunde und werden deshalb dem Zeitstempel **`t + 1 h`** der Quellreihe entnommen, damit sie zur Spalte `t … t + 1 h` gehören. Die frühere Formulierung „Wert der vorangehenden Stunde“ war um eine Stunde versetzt.

`WeatherScores` je Stunde (`cloudScore`, `seeingScore`, `transparencyScore`, `overallScore`, `ratingIndex`) und je Nacht (`nightMean`, `bestWindow`). **Alle Scores liegen in 0…1 und sind `null`-fähig** – `null` bedeutet „keine Aussage“, nie „durchschnittlich“:

- `cloudScore(cloudTotalPct)` = `clamp(1 − cloudTotalPct/100, 0, 1)` (WS-01).
- `seeingScore({jetKmh, shearKmh, wind10Kmh})`: `jetKmh == null → null`; sonst `penalty` aus den drei Termen `0,45·clamp((jet−20)/110,0,1)`, `0,35·clamp((shear−20)/100,0,1)`, `0,20·clamp((w10−8)/25,0,1)` und `score = clamp(1 − penalty, 0, 1)` (WS-04). **Abweichung von der Vorlage (WS-04a):** fehlende Terme werden **nicht** als 0 gewertet, sondern die Gewichte über die vorhandenen Terme normiert (`penalty = Σ wᵢ·termᵢ / Σ wᵢ`), und die Stunde trägt das Kennzeichen „Seeing unvollständig“; die Vorlage ließ einen Datenausfall wie ruhige Luft aussehen (nachgerechnet **0,820 gegen 0,600** – `weather.md` §4, Kontrollwert 4: `jetKmh = 64`, Scherung und Bodenwind fehlen).
- `transparencyScore(aod, humidityPct, pwvMm)`: `aod == null → null` (**kein** aerosolfreier Schätzzweig, WS-E2); sonst `s = clamp(1 − (aod − 0,05)/0,45, 0, 1)`, danach `if (rh > 80) s *= clamp(1 − (rh−80)/40, 0,5, 1)` und `if (pwv != null) s *= clamp(1 − (pwv−25)/150, 0,85, 1)` (WS-05).
- `overallScore(c, se, tr)`: `c == null → null`; sonst `sum = 0,7`, `weight = 0,7`, ein vorhandenes `se` bzw. `tr` addiert `0,15·wert` auf `sum` und `0,15` auf `weight`; Ergebnis `clamp(c² · sum/weight, 0, 1)` (WS-06). Der Wolkenterm ist damit quadriert, und ein fehlender Anteil gibt sein Gewicht ab, statt als Mittelwert zu zählen.
- `ratingIndex(s)`: Schnitte **0,25 / 0,45 / 0,65 / 0,85** → fünf Klassen *Sehr schlecht / Schlecht / Mittel / Gut / Ausgezeichnet* (FK FA-WET-03, WS-07). Die früheren Grenzen 85/70/50/25 und die englischen Namen entfallen.
- `nightMean` (WS-09): gewichtetes Mittel von `overallScore` über die **astronomische Dunkelheit** – Gewicht je Stunde = Sekunden Überlappung mit dem `darkWindows`-Eintrag dieser Nacht (`[fromUtc, toUtc]`). Ergebnis je Nacht `{nightMean, coveredSec, darknessSec, coverage}` mit `darknessSec = toUtc − fromUtc` und `coverage = coveredSec / darknessSec`; Stunden ohne `overallScore` zählen nicht in den Mittelwert und senken die Abdeckung. Der frühere Bezug auf das Nachtfenster aus `night.md` §3 entfällt – maßgeblich ist die Dunkelheit, nicht das Planungsfenster.
- `bestWindow` (WS-10, neu): längster zusammenhängender Lauf mit `overallScore ≥ 0,65`, Rückfall `≥ 0,45` (dann `fair: true`), Mindestdauer **1800 s**, sonst `null`; Ergebnis `{fromUtc, toUtc, sec, meanScore, moonFreeSec, fair}`. `moonFreeSec` zählt die Sekunden mit **`moonAltDeg < −0,833°`**, wobei `moonAltDeg` die **geometrische** topozentrische Mondhöhe ist (Parallaxe gerechnet, **ohne Refraktion**, wie `astro-core.js:138`). Höhe **und** Schwelle sind damit **bitgleich zur Vorlage** (WS-E1), obwohl −0,833° die Sonnenkonvention ist und der Mond damit erst **0,259° tiefer** als nach `moon.md` als „unten“ gilt (−0,833° statt −0,574° geometrisch), `moonFreeSec` also eher zu klein ausfällt – zulässig, weil es **nur eine Anzeige** ist. Für **jede Planungsentscheidung** gilt dagegen unverändert `moon.md`: **scheinbare** topozentrische Mitte ≤ 0° (geometrisch −0,574°). Die beiden Größen sind nicht austauschbar; `moonAltDeg` darf in keinem Planungspfad auftauchen.
- **`WeatherNight`** ist die Zeile je Nacht aus `payload.nights[]` (`weather.md` §3.4) und damit der Typ, den auch der Baustein `WeatherChart` erwartet (`specs/ui/components.md` §2.5):
  `WeatherNight = { night: string, nightMean: number|null, coveredSec: number, darknessSec: number, coverage: number|null, bestWindow: BestWindow|null, aerosolMissing: boolean, seeingIncomplete: boolean }`.

**Rundung und Determinismus (WS-08):** Einheitlich gilt: **ungerundet rechnen und speichern**; `q(x, 1e3)` (drei Dezimalstellen) kommt erst **unmittelbar vor Vergleich, `outputHash` und Ausgabe**. Das betrifft die Stunden-Scores, `nightMean`, `coverage` und `meanScore` gleichermaßen, auch dann, wenn der Wert aus `weather_cache.payload` gelesen wird – dort stehen die **ungerundeten** `double`. So bleibt die Jint-Parität gewahrt, ohne die Formeln zu verändern; zwischenzeitliches Runden ist verboten, weil sonst zweimal gerundet würde. `1e3` steht dafür in der Liste der erlaubten `inv`-Werte in `specs/engine/canonical-json.md`.

**Folge aus WS-E1 (bekannte Einschränkung, ausdrücklich dokumentiert):** Website und NINA-PM sollen identische Zahlen liefern, deshalb wird die Bewertung exakt 1:1 aus `weather-core.js` übernommen – **ohne Regen-Riegel**. **Niederschlag geht damit in keine Bewertung ein**: eine Regennacht wird allein über die Bewölkung bewertet, und weil Regen fast immer mit hoher Bedeckung einhergeht, fällt sie über `cloudScore` ab – aber nicht wegen des Regens. Regenmenge (`precipMm`) und Regenwahrscheinlichkeit (`precipProbPct`) werden weiter abgerufen, gespeichert und angezeigt. Für die **Mehrnacht-Prognose** (FA-FOL-01…05) heißt das: eine als „gut“ bewertete Nacht kann trotzdem Regen führen; der Hinweis dafür ist die Anzeige, nicht der Score (FK FA-WET-09/FA-FOL-03, `weather.md` §2).

### 8.3 Planungsalgorithmus (verbindlich)

**Grundlage:** Planungs-Engine des Astro-PM-NINA-Plugins (MIT, Commit `5dd621d`, `ScheduleEngine.cs`/`SessionScheduler.cs`), nach TypeScript portiert. Vollständige Rechenvorschrift mit Abweichungen: `claude-code/docs/specs/engine/allocation.md`; Sortierkette: `sort-chain.md`; Analyse: `Analyse_AstroPM_NINA_Plugin_2026-09-17.md`. Kurzfassung:

1. **Nachtkontext:** 5-min-Slots von bürgerlicher Abenddämmerung − 1 h bis Morgendämmerung + 1 h (Beginn auf 5 min **ab**-, Ende **auf**gerundet, NT-07); je Slot Sonne (geometrisch), Mond (topozentrisch, scheinbar), Beleuchtung, Elongation – genaue Astronomie (8.4, Kap. 9).
2. **Profile:** Nutzbarkeit je Einheit (Projekt bzw. Panel bei „Mosaik-Panels getrennt planen“, mit Panel-Koordinaten); ein Slot gilt nur als nutzbar, wenn die Bedingungen **zu Beginn und am Ende** erfüllt sind; Aussortieren bei längstem Lauf < min(Mindestzeit, Restarbeit + Blockfixkosten); Overhead je Belichtung = Download + anteiliges Dither-Settle + anteiliger Filterwechsel + anteiliger Autofokus, Blockfixkosten = Slew + erwarteter Flip (`allocation.md` §2); **Mond-Stufen** nach Mondprofil mit Restriktivität `A·(1+100/(maxIllum+1))`, „Kein Mond“ = ∞; Planungsbedarf inkl. Überschuss %, Download und anteiligem Dither-Settle.
3. **Matrix:** Masken, Restarbeit je Stufe, MinChunk (bei Projektende auf Restarbeit verkleinert, zuzüglich Blockfixkosten `fix` = Slew/Zentrieren + erwarteter Flip; der Autofokus steckt im Overhead je Belichtung), knappes Fenster, Maximalhöhe, Prioritätsindex. Aussortieren mit min(Mindestzeit, Restarbeit + `fix`).
4. **Proportional:** Transitfenster sperren (zusätzlich jeder Slot, der den Vorlauf `[Fensterbeginn − slewCenterS − 60 s, Fensterbeginn)` schneidet, NT-25) → Vorfilter → exklusive Slots (stufenbewusst) und Anker verlängern → Mond-unten-Zeit für nur-mondlose Arbeit (1a), übrige Mondvermeidungs-Arbeit exklusiv/flexibel (1b), Rest (2) → früh untergehende Ziele reservieren Anteil im Fenster (3a) → Mond-oben-Zeit (3). Jede Verteilung über `fairShare` (Bedarf passt / Mindestzeiten passen / knapp) und `paintChunks`. **Nachtfairness:** Bedarf und Angebot enthalten die heute bereits belichtete Zeit, das Budget ist der Anteil abzüglich des schon Erhaltenen; Mosaik-Panels teilen sich den Bedarf ihres Projekts (Deckel, FK FA-SCH-05). Pass 3 berechnet `accessible` nach 3a neu.
5. **Manuelle Priorität:** je Ziel in Prioritätsreihenfolge nur-mondlose Arbeit auf Mond-unten-Slots, dann chronologisch.
6. **Nacharbeiten:** Mindestzeit erzwingen (verlängern, leihen, freigeben) → Splitter entfernen → Bonus-Füllung (Ein/Aus) → A-B-A defragmentieren → Splitter → freie Slots Nachbarn zuschlagen.
7. **Ablauf:** Uhr über die Slots mit Slew/Zentrieren (auch nach Leerlauf), Filterwechsel, Download, Dither, Autofokus-Hinweis und **Meridian-Flip** (flip-rotation.md, geprüft **vor** der Filterwahl; Kandidaten oberer Durchgang und – bei Höhe ≥ Mindesthöhe – untere Kulmination, NT-26; wechselt die erwartete Pierseite zwischen aufeinanderfolgenden Blöcken, kommt die Flip-Dauer zum Slew hinzu, NT-27); Blockanfang ohne Arbeit → Slots an Ziel mit Arbeit abgeben (nur, wenn es in allen übertragenen Slots belichten kann; nie Transit/vorgefiltert) oder freigeben; Belichtung nur, wenn Belichtung + Download bis Blockende passen (Nachtende-Kulanz `lastOfNight` nur, wenn `now + exposureS + downloadS ≤ darknessEndUtc` – bei `null` ≤ `blockEnd` –, sonst `block_end` Grund `night_end`, NT-13); `pick` ohne Seiteneffekte. Transitblöcke: `expose_series` bis Fensterende, unabhängig von der Anzahl.
8. **Filterwahl:** Mondfenster-Restzeit (Headroom) → Mond steigend/unten strenge, sinkend entspannte Stufe zuerst → größter Restbedarf; Filterwechsel alle N mit Laufbahn-Toleranz und zeitkritischem Schutz (Zyklus je Zeilen-ID); Mosaik-Panel-Rotation nach Mindestzeit (aktives Panel = Panel der letzten Belichtung; nach einem Flip bevorzugt Panels, deren `tM` schon überschritten ist, NT-27). `afEveryMin = 0` bzw. `ditherEvery = 0` = aus.
9. **Ausgabe:** Blöcke, Einträge (7.6), Plausibilitätswarnungen (`idle_gap` … `filter_stuck`) und Diagnose je Projekt. Winkel werden nach dem Runden normalisiert (`x ≥ 360 → x − 360`, `−0 → 0`, NT-31); bei `fixed_camera` ist `block.rotationDeg` der Kamerawinkel `rig.default_rotation_deg`, bei Mosaik ohne Rotator gilt `pa₀ := rig.default_rotation_deg` und das Framing sperrt die Rotation auf den Kamerawinkel (NT-30).
10. **Abweichungen A-1…A-31** vom Original sind in `allocation.md` §10 verbindlich: genaue Astronomie, Mondformel FK 8.2 (Mond unten ⇔ Höhe ≤ 0), „Kein Mond“ einheitlich, Overheads (Download, Dither, Filterwechsel, Autofokus anteilig; Blockfixkosten im Bedarf), Flip vor der Filterwahl, stufenbewusste Nutzbarkeit, Slotprüfung an beiden Slotgrenzen, harter Blockschluss, nur Nachtende-Kulanz A-24 (A-30-Überhang entfällt, NT-18), `pick` ohne Seiteneffekte, toter Code entfernt, vollständige Tie-Breaks und ordinale Vergleiche, Nachtfairness mit Restangebot-Runde, quantisierte Budgets, Neuplanung mit `tonight`, Transitfenster mit Unsicherheit und Konfliktregel, `due_soonest`, `accessible` nach 3a, Mosaik-Deckel je Projekt, sicherer Blockanfang-Ersatz, Slew nach Leerlauf, Panel-Koordinaten, PreClaim nach `locked_at`, Transitreihe bis Fensterende, Filterzyklus je Zeile, Stufenmaske über alle Zeilen, Freigabe leerer Blockreste.
11. **Vergleichsorakel:** `tools/astropm-oracle` (.NET 8, C#-Originalquellen am gepinnten Commit mit Minimal-Patch: Logger- und `HorizonProfile`-Stub, Masken-Hook in `IsExposureSetMoonSafe`, stabiler Tie-Break in `PaintChunks`) prüft die TS-Engine im **Kompatibilitätsmodus** (Schalterliste `allocation.md` §11.1: Abweichungen aus, Overheads 0, Original-Tie-Breaks) auf identische Slot-Zuteilung und Belichtungsfolge. Der Adapter Grid → `TargetProfile`/`TimeSlot` und Log → Einträge ist in §11.2 festgelegt (17, 18). Soll-Pläne: Paint-Fälle in AP-13b, Ablauf-Fälle in AP-13d; H-13 (Sichtprüfung durch Sven) ist Merge-Bedingung, keine Startsperre.

**Aufwand-Kennzeichen (`estimateEffort`, FK 8.9, `effort.md`):** ruft `planNight` mit genau einem Projekt für **Stichproben-Nächte** des Zeitraums auf (≤ 180 Nächte, Abstand `stride` = 3 im Server-Job, 5 live im Browser; Nachtkontext je Nacht gecacht; Schritt 1 „beste Nacht“ mit vollem Bedarf, Schritt 2 chronologisch **mit dem jeweils verbleibenden Bedarf**), bis er gedeckt ist; Ergebnis `{tag, nights, earliestCompletion, achievablePct, requiredHours, bestNight, bestNightHoursByStage, limitingFactor, fullyObservable, coveragePct, stride, engineVersion, inputHash, computedAt}` (bei Planungsbedarf 0 liefert die Funktion `null`; die UI zeigt „fertig“, FA-PRJ-12). Das Ergebnis ist eine **Schätzung** unter Idealannahmen (Anzeige „ca. n Nächte“), keine Untergrenze. Laufzeitziel: ≤ 5 s je Projekt im Job (identisch in `effort.md`). Aufrufer: Projekt-Editor im Web-Worker (live, entprellt 500 ms); serverseitig **nur als Job** `effort` (7.4) nach Speichern/Einreichen/Freigeben, Sessionende, Korrektur/Verwerfen (NT-48) und einmal je Standortnacht aus `tick-hourly` (13, NT-08) – setzt `project.effort_stale`, persistiert in `project.effort_*` nur bei geändertem `effort_input_hash`. Nie synchron in einer API-Anfrage. Der tägliche Lauf berechnet höchstens 200 Projekte je Tag und je Projekt höchstens alle 7 Tage neu (sonst nur bei `effort_stale`).

### 8.4 Übernahme aus den Svenesis-Astro-Tools (Kopiervorlage)

Die Astro-Tools auf www.svenesis.org bleiben **exakt so, wie sie sind**. Für NINA-PM wird ihr Stand einmalig in das Repository kopiert (`legacy/astro-tools-2026-09-21/`, nur lesend, mit Quellenangabe und Commit-Hash bzw. Datum) und daraus **neuer TypeScript-Code** erstellt. Eine spätere Weiterentwicklung der Website wird nicht automatisch übernommen, sondern bei Bedarf bewusst nachgezogen.

**Stand der Vorlage: 21.09.2026, nachgezogen am 23.09.2026 (WS-01…WS-31, WS-E1…E4).** Neu bzw. geändert gegenüber dem früheren Stand vom 17.09.2026: `js/weather-core.js` (neu – die gesamte Wetterbewertung liegt jetzt dort), `js/astro-weather.js` (neue Modellkette, neue Variablen, dritter Abruf), `js/weather-history.js` (neu, wird **nicht** übernommen, WS-E3) und `tools/verify-planner.js` (127 Prüfungen). `astro-core.js`, `observing-planner.js`, `dso-catalog.js` und `sky-events.js` sind unverändert. Die Tabelle nennt drei Arten von Zeilen: **Kopiervorlage** (portieren), **nicht übernommen** (bewusst Website-Funktion) und – in den Absätzen unter der Tabelle – **in der Vorlage falsch** bzw. **keine Vorlage, Neubau**.

| Vorlage (Website) | Neuer Code in NINA-PM | Arbeit |
|---|---|---|
| `astro-tools/js/astro-core.js` | `packages/engine/src/{time,coords,bodies,twilight}` | nach TS portieren. **Sonne verbindlich nach Meeus Kap. 25 (Kurzreihe), Genauigkeit 0,01° in der Länge**; mittlere Schiefe der Ekliptik nach Meeus 22.2 (ε₀(2026,5) = 23,43585°); die Sonnen-Aberration ist ein nahezu konstanter Versatz von **−0,00569°** und wird mitgerechnet. Bislang war für die Sonne – die Grundlage des gesamten Nachtfensters – weder Algorithmus noch Genauigkeit noch die Schiefe festgelegt, während der Mond exakt spezifiziert war (AST-N12); `window.SvAstro` und Passwort-Gate (`PW_SALT`/`PW_HASH`) entfallen; fachlicher Stand bleibt: Mond nach Meeus Kap. 47 (volle Terme, < 0,01° zu JPL Horizons), Nutation (Kap. 22), topozentrische Parallaxe, Nächte Mittag–Mittag mit 23/25 h (`nightKeyOf`). **ΔT ist beim Port nachzutragen** (WS-20): die Vorlage rechnet die Ephemeridenargumente ohne ΔT (`astro-core.js:52/87`); nur der Test `verify-planner.js:437` addiert es. Richtig ist **TT = UT + ΔT (69 s)** in Sonne, Mond, Präzession und Nutation – **nicht** in die Sternzeit (8.5, AST-G02). Die frühere Formulierung „ΔT 69 s als übernommener Stand“ war falsch. Auf-/Untergang, Refraktion, Zeitzonen und Rundung dieser Datei sind **nicht** übernehmbar (Absatz „in der Vorlage falsch“) |
| **`astro-tools/js/weather-core.js`** (neu; `cloudScore`, `windShear`, `seeingScore`, `transparencyScore`, `overallScore`, `RATING_CUTS`, `ratingIndex`) | `packages/engine/src/weather` (Rechnung) | **Kopiervorlage der Bewertung** – die gesamte Wetterbewertung liegt jetzt hier, nicht mehr in `astro-weather.js` (WS-19; Leseliste in AP-08b entsprechend). **Exakt 1:1 portieren** (WS-E1), Wertebereich 0…1, `null` = keine Aussage; Formeln und Feldliste in 8.2 und `specs/engine/weather.md`. Farbrampen, Ampelstops, Tintenschwelle und `wxSymbol` derselben Datei sind **nur Anzeige** und gehören nach `specs/ui/components.md` (WS-17). **Genau eine bewusste Abweichung in der Bewertung (§2.3): `seeingScore` normiert die Gewichte über die vorhandenen Terme (WS-04a).** Dazu **drei** bewusste Abweichungen in der **Anzeigeauswertung** (`weather.md` §3.3): `moonFreeSec` zählt nur den mondfreien Anteil des **gemeldeten** Fensters (die Vorlage summiert über alle qualifizierten Stunden, auch aus verworfenen Läufen) · der Rückfall auf die 0,45-Stufe greift auch bei einem **zu kurzen** 0,65-Fenster (die Vorlage nur, wenn die 0,65-Suche gar nichts findet) · die Höhenkonvention des Mondes ist ausdrücklich die **geometrische** topozentrische Höhe mit Schwelle −0,833°, also bitgleich zur Vorlage, während jede **Planung** die scheinbare Mitte ≤ 0° aus `moon.md` benutzt |
| `astro-tools/js/astro-weather.js` (Abruf, Modellkette, Nest-Erkennung, `nightStats`, bestes Fenster, Anzeige) | `apps/api/src/jobs/weather` (Abruf), `packages/engine/src/weather` (Nacht-Mittel, bestes Fenster), `apps/web/src/components/WeatherChart` (Canvas) | Vorlage für **Abruf und Modellkette**, nicht mehr für die Bewertung. Übernehmen: **drei HTTP-Aufrufe je Standort und Lauf** (Hauptmodell `dwd-icon` in Europa / `gfs` sonst, Air-Quality, Modellvergleich – Variablenlisten in 14, WS-13), den Suffix-Vorrang (suffigiertes Feld vor einfachem Feld, `suffixed` oder-sonst `plain`), **Nest-Erkennung je Stunde** mit Latch und `NEST_MAX_H = 30 h` in Nordamerika bzw. unbegrenzt in Europa (WS-14), das feine Modell für Wolkenzeilen und Sicht nach dem Nest, `ncep_nbm_conus` für Sicht und Regenwahrscheinlichkeit, **`weatherCode` neu ableiten** bei feinerer Bedeckung und Code ≤ 3 (`< 12,5 → 0`, `< 37,5 → 1`, `< 75 → 2`, sonst `3`, WS-15), Intervallwerte vom Stempel `t + 1 h` (WS-12), Nacht-Mittel über die exakte Dunkelheit mit Abdeckung (WS-09) und bestes Fenster (WS-10). Abruf serverseitig (Job) statt im Browser. **Eine Regel wird bewusst nicht übernommen:** der Abruf läuft mit `timezone=UTC&timeformat=unixtime`, nicht mit `timezone=auto` des Originals – die Nacht- und Stundenzuordnung liegt serverseitig in der Zeitzonentabelle (AST-D25, TK 14) |
| `astro-tools/js/observing-planner.js` (Bewertung „beste Objekte“, Nacht-Streifen, Höhenkurven, Saisondiagramm `drawSeason()`) | `packages/engine/src/ranking`, `apps/web/src/components/{NightStrip,AltitudeChart,SeasonChart}` | Bewertung parametrisieren (Rig aus Eingabe); Diagramme als React-Canvas-Komponenten |
| `astro-tools/js/sky-events.js` (`nightSummary()`; Satelliten, Ereignisse) | `packages/engine/src/visibility/season.ts`, optional `events/` | `nightSummary()` als Basis des Saisondiagramms (FA-SIC-02); Ereignisse später (K) |
| `astro-tools/js/sky-map.js` + `star-catalog.js` | `apps/web/src/features/planning/skymap/` | als TS-Modul neu aufbauen (Projektion, HEALPix, Präzession als Engine-Funktionen), erweitert um Bildfeld, Rotation, Mosaik (Panel-Geometrie nach `specs/engine/geometry.md`), Projekt-Overlays |
| **Quelle der Objektdaten: OpenNGC `NGC.csv`** (**13.969 Zeilen**) **+ `addendum.csv`** (**64 Zeilen**, Version v20260501, beim Import gezählt) – zusammen `13.969 + 64`, CC BY-SA 4.0, Version und Abrufdatum festgehalten; Feldabbildung in `specs/catalog/dso-import.md` – *nicht* der Website-Auszug); dazu `astro-tools/js/dso-catalog.js` (168 Objekte) + `astro-tools/data/ngc.json` | `packages/catalog-data/` (eingecheckte Kopie mit Lizenz) → Import in `dso_object` | **WS-E4/WS-25:** `mag_v`, `mag_b`, `surf_br_mag_arcsec2`, Größen (`MajAx`/`MinAx`), `position_angle_deg` (`PosAng`, Konvention **`[0, 180)`**, `PosAng mod 180`) und `object_type` kommen **aus OpenNGC**; der Website-Auszug liefert nur **zusätzliche Namen/Aliase, Vorschaubilder und Wikipedia-Titel**. Seine Helligkeiten sind **gerundete Richtwerte ohne Bandangabe** und werden **nicht** nach `mag_v` übernommen. Vollständige Feldabbildung, Zeilenformat des Auszugs, Dublettenregel und der Umgang mit `Dup`/`NonEx` in der neuen Spezifikation **`docs/specs/catalog/dso-import.md`** (verbindlich für AP-20); Typvokabular in `enums.json` als `dsoObjectTypes` mit Abbildung auf die Anzeigegruppen (WS-26). **Objektzahl (WS-27, eindeutig):** **13.969 ist die Zeilenzahl von `NGC.csv`** (v20260501), nicht die Gesamtzahl – die 64 Zeilen von `addendum.csv` kommen hinzu, die Gesamtzahl der Quellzeilen ist **`13.969 + 64`** (13.632 Zeilen in `dso_object`). Beide Zahlen werden beim Import aus den Dateien gezählt (T-KAT-10) und immer mit Versionsangabe geschrieben; die früheren, unterschiedlichen Angaben „13.466“ (TK) und „~13.600“ (FK/Schema) entfallen – TK, FK und Schema-Kommentar nennen dieselben Zahlen in derselben Form. In `dso_object` landen weniger Zeilen, weil `Dup` und `NonEx` keine eigene Zeile bekommen. Import-Skript `tools/catalog-import`; Quellenangaben (OpenNGC, Sharpless/VizieR, SIMBAD, Caldwell/Wikipedia) im Impressum der App |
| `astro-tools/data/stars-8.bin`, `doubles.json`, `sky-events.json` | `packages/catalog-data/` → ausgeliefert unter `https://nina-pm.svenesis.org/catalog/data/` | Kopie; Generatoren s. u. |
| `astro-tools/img/dso/` (168), `img/ngc/` (ein Bild je NGC-Objekt, 128 px, ~108 MB), `img/ngc-l/` (1.083, 320 px, ~21 MB) | S3 **`svenesis-nina-pm-web/catalog/img/…`** | einmalig per `aws s3 sync` aus dem lokalen Website-Ordner kopiert (nicht ins Git). **Bildpfade sind nach Herkunft getrennt:** `catalog/img/…` trägt ausschließlich diese **kopierten** Katalogbilder, `catalog/thumbs/…` ausschließlich die von NINA-PM **selbst erzeugten** Vorschauen des Jobs `thumbnail` (AP-25, `specs/catalog/dso-import.md` §2/T-KAT-12) – so überschreibt ein eigener Lauf nie eine Kopie |
| `astro-tools/tools/*.js` (`ngc-data.js`, `ngc-thumbnails.js`, `dso-thumbnails.js`, `star-catalog-data.js`, `sky-events-data.js`, `double-stars-data.js`, `verify-planner.js`) | `tools/catalog/` (TS) und `packages/engine/test/legacy-checks.spec.ts` | Generatoren portieren, damit NINA-PM seine Daten unabhängig erneuern kann. Von `verify-planner.js` (127 Prüfungen) werden **nicht alle** Prüfungen übernommen: maßgeblich sind die **Positivliste (WS-22)** und die **Negativliste (WS-23)** in 9.2 – jede übernommene Prüfung mit Fundstelle und Toleranz, jede abgelehnte mit Begründung |
| **nicht übernommen: `astro-tools/js/weather-history.js` (WS-E3)** | – | Die Vorhersagegüte der Website (Abgleich alter Läufe gegen Messungen) bleibt eine **Website-Funktion**: sie braucht `previous-runs-api.open-meteo.com` und `mesonet.agron.iastate.edu`, also zwei zusätzliche externe Quellen mit eigener Historie, und trägt zur Planung einer Nacht nichts bei – bewusste Entscheidung, **kein offener Punkt**, damit niemand später danach sucht |

**In der Vorlage falsch – nicht übernehmen (WS-20).** Die Website rechnet für ihren Zweck gut genug; für die Planung einer Nacht sind die folgenden Stellen **nachweislich zu grob oder schlicht falsch**. Sie sind einzeln nachgerechnet und werden beim Port **ersetzt**, nicht kopiert – jede Zeile nennt Datei:Zeile, den Fehlerbetrag und die verbindliche Quelle:

| Vorlage (Datei:Zeile) | Was dort falsch ist | Fehlerbetrag | Verbindlich statt dessen |
|---|---|---|---|
| `observing-planner.js:1465` | Mondabstand **geozentrisch** und mit `acos` gerechnet | **1,003°** | `moon.md`: topozentrisch, unrefraktiert, mit `atan2` |
| `astro-core.js:138` | Mondhöhe **ohne Refraktion** | bis **0,647°** (= `R(−1°)` = 38,795′) | scheinbare Höhe (geometrisch + Saemundsson) |
| `astro-core.js:362`, `sky-events.js:691` | „Mond unten“ bei **−0,833° geometrisch** (Sonnenkonvention) | Versatz **0,259°** | scheinbare Mitte ≤ 0° (= −0,574° geometrisch), FK 8.2 |
| `astro-core.js:305-309` | Refraktion unter −1°/−2° ausgeblendet (0 statt Wert) | Sprung um **38,795′** | konstant `R(−1°)` = 38,795′ unterhalb der Grenze |
| `astro-core.js:344-373` | Dämmerung nur für −18°, **60-s-Raster**, Mitternachts-Heuristik | A Coruña, Nacht 2026-07-01: Fenstermitte 22:00:00Z liegt **36,7 min vor** dem Beginn der Dunkelheit (22:36:41Z) | Transit/Antitransit + Bisektion (1 s) **je Grenze**, `night.md` |
| `astro-core.js:52/87` | **kein ΔT** in den Ephemeridenargumenten (nur `verify-planner.js:437` addiert es im Test) | Mondposition **0,016°** (in `verify-planner.js:441` beziffert) | TT = UT + 69 s in Sonne, Mond, Präzession, Nutation – nicht in die Sternzeit (8.5) |
| `astro-core.js:14` | toter Vorgabewert `OBL = 23.4397°` | **13,9″** | nie verwenden; maßgeblich ist `nu.eps` (Nutation, Meeus 22) |
| `astro-core.js:380-395`, `observing-planner.js:350` | Zeitzonen über **`Intl`** im Rechenpfad | bis **1 h** (Host-tzdata weicht vom Serverstand ab; Regeländerungen und historische Zonen) | Übergangstabelle vom Server (`night.md` §1, NT-02); `Intl` ist im Engine-Paket per ESLint verboten (8.1) |
| `astro-core.js:401/403` | nicht existierende Ortszeit (DST-Sprung) ergibt **stillschweigend eine 0-h-Nacht** und einen gebrochenen Schlüssel-Rundlauf | `Pacific/Apia`, Schlüssel 2011-12-30: Nachtlänge 0 h | Eingabefehler sichtbar machen: `422 validation.failed` |
| `Math.round` (`astro-core.js:331/391/399`, 51× im Planer) | JavaScript-`Math.round` rundet −0,5 auf −0 (halb **aufwärts**, nicht halb weg von der Null) und ist nicht portabel nach .NET | **halber Schritt** an jeder Rasterkante bei negativen Werten (`Math.round(−0,5) = −0` statt −1) | `q(x, inv)` / `roundHalfAwayFromZero` (`canonical-json.md`), `Math.round` per ESLint verboten (8.1) |
| `astro-core.js:438-445` | clientseitiges **Passwort-Gate** (`PW_SALT`/`PW_HASH`) | kein Schutz (Hash liegt im Quelltext) | entfällt vollständig; Zugang über Discord-Anmeldung und Rechte je Route (5) |
| `sky-events.js:689/694` | verdrahtete **−18°** und **30°** | ganze Klasse falscher Nutzbarkeit | Dämmerungsgrenze je Projekt, `minAlt` je Projekt/Rig, „Mond unten“ nach `allocation.md` |

**Keine Vorlage – Neubau (WS-21).** Für diese Teile gibt es im Website-Code **nichts** zu portieren; sie entstehen allein aus den Spezifikationen. Wer dort nach einer Vorlage sucht, verliert Zeit:

- **Bildfeld, Mosaik und Panel-PA** – `specs/engine/geometry.md`. Der Website-Code kennt weder Bildfeld noch Panelzerlegung noch Positionswinkel eines Panels.
- **Aufwandsschätzung** (`estimateEffort`) – `specs/engine/effort.md`. Das Ähnlichste ist `SvSkyMap.usableHours`: eine **linke Riemannsumme** mit festem 30°-Tor, ohne Bedarf, Overheads, Mondprofile und Filter – als Vorlage untauglich (deshalb auch auf der Negativliste, WS-23).
- **Saisonende** nach FK 8.1 – die Website zeichnet nur Monatsbalken (`drawSeason()`), kein Datum, ab dem ein Projekt in dieser Saison nicht mehr zu schaffen ist.
- **Dämmerung je Grenze** (−6°/−12°/−18°, nullable, Polarnacht) – `specs/engine/night.md`; die Vorlage kennt nur −18° (siehe oben).

### 8.5 Transitrechnung

- `T_n = T0 + n·P` (BJD_TDB; **Katalog-Epochen werden beim Import auf BJD_TDB normalisiert** – Offset- und Zeitsystemregeln inkl. Schaltsekunden zur Epoche in `transit.md` §1). Umrechnung: `JD_UTC = BJD_TDB − Rømer(r_earth·ŝ/c) − (TDB−TT) − (TT−UTC)`; iterativ (2 Schritte), Rømer-Maximum 8,46 min (1,01671 AU).
- Erdposition baryzentrisch: heliozentrische Erde (Meeus/VSOP-Kurzform) + Sonnenversatz zum Baryzentrum aus **Jupiter, Saturn, Uranus und Neptun** (2,48 / **1,36** / 0,42 / 0,77 Lichtsekunden; dieselben Zahlen in `transit.md` §1) → **Genauigkeit ≤ 0,1 s** (Fehlerbudget: Erdreihe 10 ms, innere Planeten 3 ms, topozentrischer Term 21 ms, EMB → Erdmittelpunkt 16 ms, TDB−TT 1,7 ms, Shapiro 0,02 ms; die früheren „< 10 s" verbrauchten das gesamte Testbudget der ±10-s-Toleranz, AST-T15/D17).
- `TT−UTC = 32,184 s + Schaltsekunden` (Tabelle im Paket; seit 2017: 69,184 s) – **nicht zu verwechseln** mit `ΔT = TT−UT1 ≈ 69 s` (8.4), das in die **Ephemeridenargumente** eingeht (Sonne, Mond, Präzession, Nutation), **nicht** in die Sternzeit: GMST/GAST sind Funktionen allein von **UT1** (≈ UTC, |DUT1| < 0,9 s ⇒ 0,0038° Stundenwinkel). Wer ΔT in die Sternzeit steckt, erhält 69 s · 15,0410686 °/h / 3600 = **0,2883°** Stundenwinkelfehler und 69 s Versatz in `tM` – über der `tM`-Toleranz von ±30 s (AST-G02), das nur in die Sternzeit eingeht; beide sind derzeit fast gleich, weil `DUT1 ≈ 0`.
- Unsicherheit `σ = |n|·σ_P + σ_T0` (bewusst linear, konservativ); die letzte O−C verschiebt das Fenster mit Vorzeichen, der Puffer bleibt symmetrisch; Fenster laut Fachkonzept Kap. 8.7 und `transit.md` §2. Bei Ultrakurzperioden werden alle Transits der Nacht aufgezählt.
- **Transit-Filter (FA-EXO-08, NT-41):** Die Filterempfehlung wird über `filter.photometric_band` (`U`, `B`, `V`, `Rc`, `Ic`, `g`, `r`, `i`, `z`, `clear`, `lum`, `none`) auf einen Filter der **bestätigten** Filterradbelegung abgebildet: gleiches Band → sonst Breitband-Rot (für Rc/Ic) bzw. Grün (für V) mit Hinweis *Ersatzfilter* → sonst Luminanz/Clear; ohne Treffer ist das Projekt nicht festlegbar.

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

- Ephemeride `de432s` (jplephem), Zeitskalen über `astropy.time` (inkl. `light_travel_time(kind='barycentric')` für BJD – **nicht** „barycorr", das ist kein astropy-Bestandteil, AST-T16).
- **`de432s.bsp` liegt im Repository** (`tools/reference/kernels/`, Prüfsumme und Lizenzhinweis) und wird über `solar_system_ephemeris.set('<pfad>/de432s.bsp')` **aus der Datei** geladen; `astropy.utils.iers.conf.auto_download = False`. Sonst lädt astropy den ≈ 10 MB großen SPK-Kernel beim ersten Lauf nach und der Job „kein Netzzugriff" scheitert im frischen Container (AST-T11). Die verwendete Schaltsekundentabelle und ihr **Ablaufdatum** gehen in die Fixture-Metadaten.
- **Mondauf-/-untergangszeiten der Fixtures** werden aus der **geometrischen** Höhe plus Saemundsson bestimmt – genau wie die Engine –, **nicht** aus astropys `AltAz`-Refraktion; sonst ist der Test ein Modellvergleich (ERFA gegen Saemundsson) statt eines Implementierungstests, und die 15°-Ausnahme kann für Mondzeiten (0°) gar nicht greifen (AST-D30).
- **Festgelegte Modelle der Engine** (Referenz prüft dagegen): Präzession/Nutation nach IAU 1980/Meeus Kap. 21–22 auf das Datum des Slots; Sternzeit **GMST nach IAU 1982** (Meeus 12.4) plus Äquinoktialgleichung → GAST; `UT1 ≈ UTC` (|DUT1| < 0,9 s vernachlässigt); `ΔT = TT − UT1 = 69 s`, gültig für 2026–2030 (Fehler < 0,2 s, Auswirkung < 0,001° in der Position); Refraktion nach Saemundsson aus der geometrischen Höhe (`moon.md`); keine Aberration (max. 20,5″ = 0,0057°, unter allen Toleranzen). **Zwei Sätze:** (a) geometrisch, Refraktion aus; (b) scheinbar mit festen Parametern `pressure = 1010 hPa`, `temperature = 10 °C`, `relative_humidity = 0`, `obswl = 0,55 µm`. Satz (b) wird nur für Höhen ≥ 15° verglichen (ERFA-Refraktion weicht darunter modellabhängig ab); Mondzeiten und -höhen werden **topozentrisch** gerechnet (`get_body('moon', t, location)`).
- **Zweite Referenznacht für die Nachtfenster-Rundung (WS-28):** Starfront `2026-09-15` (00:05:00Z – 13:00:00Z, **155 Slots**; Dämmerungszeiten 2 min 28 s bzw. 2 min 5 s von der 5-min-Marke entfernt) gehört neben der Nacht `2026-09-17` in `gen_sun_moon.py` und die Fixture-Liste – sie fängt Rundungsfehler, die an der knappen Nacht 17.09. durch die Toleranz fallen (`night.md` §4).
- Jede Fixture-Datei enthält Metadaten: Werkzeugversionen, Erzeugungsdatum, Parameter.
- Ergänzend kommen **ausgewählte** Prüfungen aus `astro-tools/tools/verify-planner.js` (127 Prüfungen) als Tests hinzu, damit die Engine mindestens den Genauigkeitsstand der Website hält. Die frühere pauschale Zusage „Prüfungen der Website übernehmen“ gilt **nicht mehr**: ein Teil der Prüfungen schreibt genau das fest, was NINA-PM bewusst anders macht (8.4, WS-20), und ein weiterer Teil prüft Website-Eigenschaften ohne Gegenstück. Verbindlich sind deshalb die **Positivliste (WS-22)** und die **Negativliste (WS-23)** in 9.2 – jede übernommene Prüfung mit Fundstelle und Toleranz, jede abgelehnte mit Begründung. Dieselben Listen stehen in AP-08b.
- Aufruf lokal (`uv run gen_all.py`) **oder** im CI-Job `reference` (Python-Container, gepinnte Versionen, **gebündelte IERS-/Schaltsekunden-Tabellen**, kein Netzzugriff zur Laufzeit); das Ergebnis wird eingecheckt und im CI nur auf Unverändertheit geprüft. Claude Code braucht damit kein lokales Python (H-10 optional).

### 9.2 Toleranzen (Tests in `packages/engine/test/reference.spec.ts`)

| Größe | Toleranz | Bezug |
|---|---|---|
| Dämmerungszeiten, Sonnenauf-/-untergang | ± 60 s | NFA-15, Planungsraster 5 min |
| Mondauf-/-untergang (scheinbare Höhe des Mondmittelpunkts = 0°, `moon.md`) | **± 30 s** plus Direkttest `|h_app(Mittelpunkt)| ≤ 0,01°` zur berechneten Zeit | Mondvermeidung. ±120 s ließen genau den Fehler durch, gegen den die Toleranz geschrieben ist: die Verwechslung Oberrand/Mittelpunkt kostet bis 0,26° ≈ **1,7–3 min** (`moon.md` §1), erreichbar sind ≈ 5 s (AST-D18) |
| Mondhöhe (scheinbar, topozentrisch) | ± 0,05° | `moonAlt` steuert die Stufen 1/2, das Relaxierungsband und über `MoonDown` die Passstruktur – bisher ohne eigene Toleranzzeile (AST-M5) |
| Meridiandurchgang eines Ziels (`tM`, `flip-rotation.md` §1.1) | ± 30 s | Meridian-Flip |
| Mond RA/Dec (topozentrisch, als Winkelabstand gemessen) | ± 0,1° | Mondabstand |
| Mondbeleuchtung (**geozentrische** Elongation wie `moon.md` §1) | ± 1 % | Profil-Schwelle. Der Referenzgenerator muss sie **geozentrisch** erzeugen: topozentrisch gerechnet weicht der beleuchtete Anteil um bis zu **0,73 Prozentpunkte** ab und verbraucht damit 73 % der Toleranz allein durch den Definitionsunterschied (AST-M5) |
| Zielhöhe | ± 0,05° (geometrisch **und** scheinbar; scheinbar nur ab 15° Höhe, weil die Refraktionsmodelle darunter auseinanderlaufen) | Mindesthöhe (FK 8.1) |
| Transitmitte BJD_TDB → UTC | **± 1 s** (Ziel ± 0,2 s) | NFA-15 (< 1 min). ±10 s wären zu grob: eine HJD/BJD-Verwechslung (≤ 4,6 s) und ein falscher Bezugsrahmen der Zielrichtung (≤ 3,2 s) fielen damit nicht durch, obwohl das Modell ≤ 0,1 s kann (AST-T8) |
| Mondsicherheit je Profil (Stufengrenzen, Relaxierung) | exakt (Tabellenfälle) | Fachkonzept 8.2 |

Zusätzlich **Determinismus-Test**: `planNight` mit festen und ≥ 500 zufällig erzeugten Eingaben in Node und (im Plugin-Test) in Jint → identischer `outputHash`; dazu die Rundungs-Testvektoren aus `canonical-json.md` (`q(x, inv)`/`roundHalfAwayFromZero`, keine Verwendung von `Math.round` und keine Rückmultiplikation mit dem Schritt).

**Sonderregel für die Nachtfenster-Beispiele (WS-28).** Für die Beispielwerte des Nachtfensters in `specs/engine/night.md` gilt **± 5 s** statt der allgemeinen ± 60 s der ersten Tabellenzeile. Grund: das Fenster wird auf 5 min ab- bzw. aufgerundet (NT-07), und mehrere Beispielzeiten liegen dicht an einer 5-min-Grenze – Starfront 2026-09-17 Beginn **11,4 s**, Nacht 18.09. Ende **14,7 s**, Nacht 19.09. Ende **21,9 s**, Ende 17.09. **51,4 s**. Die **Referenzzeiten** stehen auf ganze Sekunden **gerundet** (Toleranz ±1 s), die **Abstände** sind dagegen aus den **exakten** Werten gerechnet (01:04:48,6Z / 11:59:08,6Z / 11:59:45,3Z / 12:00:21,9Z) – deshalb mit einer Nachkommastelle. Mit ± 60 s dürfte ein konformer Port legal **155 statt 156 Slots** bzw. **13:00:00Z statt 13:05:00Z** liefern, und der Test wäre wertlos. `night.md` schreibt deshalb je Tabellenzeile den Abstand zur 5-min-Grenze mit und ergänzt **eine zweite Beispielnacht**, deren Dämmerungszeiten ≥ 2 min von der Grenze entfernt liegen.

**Klarstellung zum Meridiandurchgang (WS-24).** Für `tM` sind „mittlerer Ort + GMST“ und „α_app + GAST“ **auf die Sekunde gleichwertig** (nachgewiesen an HAT-P-17, Starfront, 18.09.2026: beide 04:28:23Z) – die Äquinoktialgleichung kürzt sich heraus. Entscheidend ist allein die **Präzession**: mit der J2000-Rektaszension ergibt sich 04:27:13Z und damit **70 s** Fehler, weit über der Toleranz von ± 30 s. Ein Satz dazu steht in `flip-rotation.md` §1.1. Als **erlaubte** Alternative zur Newton-Iteration gilt die geschlossene Form `t = t_start + ((360° − LHA(t_start)) mod 360°)/15,0410686 °/h` (untere Kulmination mit Zielwert 180°); sie liefert per Konstruktion die erste Kulmination im Fenster.

**Positivliste: Prüfungen aus `verify-planner.js`, die übernommen werden (WS-22).** Fundstellen im Stand vom 21.09.2026; sie gehen in `packages/engine/test/legacy-checks.spec.ts` bzw. in die Importtests von AP-20:

| Fundstelle | Prüfung | Toleranz |
|---|---|---|
| `:419` | **Meeus 47.a** (Mond): 1992-04-12 0h TD → α = 134,688470°, δ = 13,768368°, Δ = 368.409,7 km | ± 0,0006° in α/δ, ± 1 km in Δ |
| `:423` | **Meeus 22.a** (Nutation und Schiefe): 1987-04-10 0h TD → Δψ = −3,788″, Δε = +9,443″, ε₀ = 23°26′27,407″ | ± 0,5″ / ± 0,1″ / ± 0,05″ |
| `:428-441` | Mondposition gegen **JPL Horizons**, 10 Termine 20.09.–17.10.2026 | ± 0,01°. **Mit ΔT** – der Test prüft damit den Produktivpfad nach WS-20, nicht den Website-Pfad ohne ΔT |
| `:96-99` | **Präzession**: Rundlauf J2000 → Datum → J2000 über Zufallspunkte; der Pol bleibt endlich (δ = 89,85°) | < 1e-4″ |
| `:247-261` | Neu- und Vollmonde gegen **USNO**, 10 Termine 2026 | ± 30 min – Grobtest für `d` und `illum` (die genauere Lunationssuche der Website wird bewusst nicht übernommen, WS-30/AST-M9) |
| `:472` | Dunkelheit am Pol: −85°, 29.05.–04.06.2026, kürzeste Spanne | > 900 min – Regression für den Polarnacht-Zweig |
| `:194-203`, `:320-385` | Katalog-Wohlgeformtheit: Koordinatenbereiche, Typmengen, Dubletten, Aliasziele, Vollständigkeit Messier/NGC/IC/Caldwell/Sharpless | exakt – als **Importtests AP-20** gegen `dso_object` (Quelle OpenNGC, 8.4/WS-25) |
| `:637-648` | **Wetter-Scores**: `cloudScore(0/50/100) = 1/0,5/0`, `overallScore` quadriert den Wolkenterm (`overallScore(0,5, null, null) = 0,25`) und gibt das Gewicht eines fehlenden Anteils ab (`overallScore(1, 0, 0) = 0,7`), Klassenschnitte genau bei 0,25/0,45/0,65/0,85 | < 1e-12 bzw. exakt (`weather.md` §4 e) |

**Negativliste: Prüfungen, die bewusst nicht übernommen werden (WS-23).** Jede mit Begründung, damit sie nicht „aus Vollständigkeit“ wieder eingebaut wird:

| Fundstelle | Warum nicht |
|---|---|
| `:110` | Schreibt fest, dass es **unter dem Horizont keine Refraktion** gibt. Das widerspricht `moon.md` und WS-20 (`astro-core.js:305-309`); konform wäre `refract(−5°) = −4,3534°`. Der Test würde den korrigierten Port durchfallen lassen |
| `:105` | Schreibt **Bennett** zu, was die **Saemundsson-Umkehrung** ist (34,43′ statt 34,48′). Der Zahlenwert gehört zum anderen Modell; NINA-PM rechnet Saemundsson aus der geometrischen Höhe |
| `:476` | Rundlaufbereich der Refraktion **unterhalb −1°** – prüft genau den abgeschnittenen Zweig, den WS-20 ersetzt |
| `:391` | `usableHours` – linke Riemannsumme mit festem 30°-Tor; NINA-PM hat dafür `estimateEffort` mit ganz anderer Rechenvorschrift (`effort.md`, WS-21) |
| `:393` | Festes Rig-Bildfeld **1,69°** – in NINA-PM kommt das Bildfeld je Rig aus der Geometrie (`geometry.md`) |
| Struktur- und Datei-Prüfungen | Seitenstruktur und Skriptreihenfolge, `?v=`-Versionen, Bildbestände, HEALPix, Kartenprojektion, Sternbinärdatei, Doppelsterne und TLE-Alter – Eigenschaften der Website (statische Seiten, Sternkarte, Satellitenteil), zu denen NINA-PM entweder kein Gegenstück hat oder eine eigene, anders gebaute Umsetzung (11, `geometry.md`) |

---

## 10. NINA-Plugin

### 10.1 Rahmen

- Basis: offizielles NINA-3-Plugin-Template; Ziel-Framework gemäß NINA 3.x (aktuell .NET 8, `net8.0-windows`).
- **Fünf Projekte** in `NinaPm.sln`, geschnitten danach, wie viel ohne Windows gebaut und geprüft werden kann (Einzelheiten und Tabelle in 10.5): `NinaPm.Core` (`net8.0`, **ohne** NINA-Abhängigkeit: ApiClient, LocalStore (SQLite), Outbox, PlanClient/EngineHost, Neuplanungs-, Lease- und Nacht-Zustandsmaschine, Playback-Logik über die Schnittstellen `ISequenceHost`, `ICameraControl`, `IMountControl`, `IFilterWheelControl`, `IRotatorControl`, `IClock`, `currentNight`, FilterResolver (nur bestätigte Filterzuordnung, NT-E1), FlatTracker, Zuordnungslogik der Aufnahmen) und `NinaPm.Core.Tests` – beide plattformneutral, von Claude Code auf Linux **und macOS** baubar und testbar; `NinaPm.Nina` (`net8.0-windows` mit `UseWPF`, aber **ohne eigene XAML-Datei**: Plugin-Manifest, Sequenz-Elemente, Bedingungen, Trigger-Walk, Mediator- und Profil-Zugriff, Plate-Solve, MEF-Export) – dünn und dank der NuGet-Pakete `NINA.*` (10.5) ebenfalls ohne Windows **kompilierbar**; `NinaPm.Nina.Tests` (`net8.0-windows`: Adapter-Tests gegen NINA-Attrappen – baut ohne Windows, **läuft** nur auf Windows); `NinaPm.Nina.Ui` (`net8.0-windows` mit WPF **und** XAML: Optionsseite, Zielbrowser, Live-Status, Simulatorpanel, Nachtgrafik) – laut AP-S2c ebenfalls ohne Windows baubar. Der Schnitt zwischen Adapter und Ansichten ist Absicht: im Adapter entstehen die Typ- und API-Fehler, und genau der bleibt ohne Windows kompilierbar; reines XAML-Markup bringt vom Compiler kaum Nutzen. Die **Laufzeit** wird in jedem Fall auf einem Windows-Rechner mit NINA nach `claude-code/docs/ops/plugin-test-protocol.md` geprüft. CI: `plugin.yml` baut und testet die vollständige Lösung auf `windows-latest`, die Kern-Tests zusätzlich auf `ubuntu-latest` und sichert den windowsfreien Weg in einem eigenen Auftrag (18, 10.5).
- **Codebasis Ausführung:** Astro-PM-NINA-Plugin (MIT, Commit `5dd621d`): Container-, Trigger-, Belichtungs-, Flat- und Schleifenmuster werden übernommen bzw. portiert (`claude-code/docs/specs/nina/execution.md`); Copyright-Hinweis in `THIRD_PARTY_NOTICES.md`; kein Name „Astro PM“ in Oberfläche oder Bezeichnern. Target Scheduler (MPL-2.0) nur als Anschauung, kein Code.
- Abhängigkeiten: `Jint` (Engine, nur offline), `Microsoft.Data.Sqlite` (ein lokaler Speicher `ninapm.db`: Cache, Outbox, Sende-Historie, Dead-Letter, Flat-Kombinationen, Laufzustand), `Polly` (Retries), NSwag-generierter API-Client aus `openapi.yaml`.
- **Zeittypen (verbindlich, NT-05):** Zeitpunkte als `DateTimeOffset` in UTC, `night` als `string`/`DateOnly`, die Uhr als injiziertes `IClock`; `Microsoft.CodeAnalysis.BannedApiAnalyzers` verbietet `DateTime.Now`, `DateTime.Today`, `TimeZoneInfo.Local` und `ToLocalTime` in `NinaPm.Core` und `NinaPm.Nina` (einzige Ausnahme: der SiteCheck-Hinweis). NSwag bildet `format: date` auf `string` ab; Newtonsoft mit `DateTimeZoneHandling.Utc`, Ausgabe mit `Z`; `ninapm.db` speichert Zeitpunkte als ISO-UTC-Strings. Uhrabgleich nur gegen `serverTimeUtc` (Bootstrap und Heartbeat-Antwort): > 60 s blockiert, offline keine Prüfung, nur ein Hinweis. **PC-Zeitzone (NT-06):** Sie muss nicht die Standortzeit sein; der SiteCheck warnt (`pc_timezone_differs`), wenn der Offset von `TimeZoneInfo.Local` vom Standort-Offset abweicht – NINA nutzt die PC-Zone für DATE-LOC, Dateinamen- und Ordner-Platzhalter und die eingebauten Zeit-Anweisungen. Die Meldung nennt die Folge (L3): `$$DATEMINUS12$$` (NINAs Standard-Datumsordner) und `$$DATE$$` wechseln nach der PC-Zone, bei Starfront mit PC-Zone `Europe/Berlin` also um 05:00 CDT – eine Nacht verteilt sich auf zwei Datumsordner; **Empfehlung: PC-Zone = Standortzone.** *Warten auf Zeit* und das Enddatum der Tagesschleife (FA-NIN-26) gelten in **Standortzeit** (aus `timeZoneTransitions`), das Enddatum ist der letzte Nacht-Schlüssel einschließlich; bei der Zeitumstellung gilt eine mehrdeutige Uhrzeit in ihrer ersten Instanz, eine nicht existierende wird um die Lücke nach vorn verschoben (L2).
- **Vorbild Bedienung:** Astro-PM-Plugin 1.6.0 (Screenshots `Nina-Plugin*.jpg`): Optionsseite, Zielbrowser, Simulator im Plugin, Container mit Status-Kopf und aufklappbaren Bereichen, Flat-Handling mit drei Boxen. Das **Datei-Kopieren** geteilter Flats nutzt NINAs Bildspeicher-Muster (Zielname im Pfad) und kopiert nach dem Speichern.
- **Spike AP-S2b** (früh, nur nach AP-01) prüft gezielt die Stellen **ohne** Vorbild im Astro-PM-Plugin mit der aktuellen NINA-Version und den Simulatorgeräten: `ImageSaved`-Zuordnung über `Image.Id` für Lights, Flip-Werte aus dem Profil und Flip-Erkennung über Pier-Seite, Trigger-Filter nach Typ (Autofokus im Transit), eigener Abbruch-Token für Belichtungen, Auslesemodus setzen (P-01…P-03, P-13), dazu die genauen Schalter der NINA-Kommandozeile für den automatischen Start (NT-45).
- **Tests tagsüber:** `tools/nina-test-server` liefert Pläne relativ zu „jetzt“ (Blöcke ab `now + 2 min`, Ziel-RA für Flip im Block als `RA_J2000 = LST + n min − (α_app − α_J2000)` (NT-35), Transitfenster ab `now + 10 min`), damit die Protokolle P-01…P-24 ohne passende Nacht laufen (`execution.md` §9).
- Verteilung: ZIP je Release (GitHub Actions) zur manuellen Installation in den NINA-Plugin-Ordner; später Manifest für den NINA-Plugin-Manager (OP-10).

### 10.2 Struktur

```
apps/nina-plugin/
├─ NinaPm.sln
├─ Directory.Build.props              # gemeinsame Eigenschaften: NinaVersion (NuGet NINA.*), EnableWindowsTargeting (10.5)
├─ Directory.Build.targets            # vom Ziel-Framework abhängig: PlatformTarget x64, NoWarn NU1701 (10.5)
├─ NinaPm.Core/                       # net8.0, plattformneutral – Logik ohne NINA-Bezug
│  ├─ Abstractions/                   # ISequenceHost, ICameraControl, IMountControl, IFilterWheelControl, IRotatorControl
│  ├─ ApiClient.cs                    # generiert (NSwag) + Auth-Header + Engine-Version-Header
│  ├─ LocalStore.cs                   # eine SQLite-Datei %LOCALAPPDATA%\NINA\Plugins\Svenesis.NinaPm\ninapm.db: cache, outbox, sent_history,
│  │                                  # dead_letter, flat_combination_local, state (sessionId, nightPlanId, Blockindex, tonight)
│  ├─ Outbox.cs                       # captures/events, FIFO je Session, Fehlerklassen, Dead-Letter, 14 Tage Sende-Historie
│  ├─ PlanClient.cs                   # POST /plan (online); Fallback EngineHost
│  ├─ EngineHost.cs                   # Jint (nur offline): lädt engine.iife.js einmal je Plugin-Lauf, JSON rein/raus, eigener Thread (ADR-S2a)
│  ├─ ReplanPolicy.cs                 # wann neu planen: ETag/settingsVersion/Verzug > 10 min, Fälle a/b/c im Block, tonight
│  ├─ PlanExecutor.cs                 # Blöcke/Einträge ausführen (Eintrag → Aktion) über die Abstraktionen, Playback-Modi, Transit-Serie
│  ├─ LeaseStateMachine.cs            # none → acquiring → held ⇄ unreachable; held → lost → reacquiring (execution.md §6, NT-14); Offline-Modus
│  ├─ BlockedState.cs                 # blocked{reason, recoverable}: 60-s-Warten statt Dauerschleife
│  ├─ FilterResolver.cs               # nur bestätigter ninaFilterName aus targets, exakter Vergleich mit dem NINA-Profil,
│  │                                  # sonst filter_not_found (NT-E1; auch Flats) – die Laufzeit-Heuristik FilterMatcher entfällt
│  ├─ CaptureReporter.cs              # Aufnahme-ID (UUID v7) vor der Belichtung, Zuordnungstabelle Bild-Id → Aufnahme-ID,
│  │                                  # 120-s-Timeout → failed, Abbruch → aborted, Meldungen in die Outbox
│  ├─ FlatTracker.cs                  # Kombinationen aus gespeicherten Lights (Filter, mechanischer Winkel, Gain, Offset, Binning, Auslesemodus),
│  │                                  # Status + Anzahl je Kombination (Fortsetzen), Primärziel = erstes Ziel, Datei-Kopie, Meldung mit projectIds
│  ├─ HeartbeatService.cs             # Hintergrund-Timer 60 s unabhängig von der Sequenz; Zustand, Lease, Dead-Letter-Anzahl
│  ├─ SiteCheck.cs                    # Abweichung Profil ↔ Rig-Standort > 10 km; Uhrabweichung zum Server (serverTimeUtc, gemittelt)
│  │                                  # > 5 s Warnung, > 60 s keine Ausführung (NFA-15); PC-Zeitzone ≠ Standort → pc_timezone_differs (NT-06)
│  ├─ Time/                           # IClock, NightCalendar.CurrentNight (Testvektoren wie packages/shared, NT-01/NT-05)
│  └─ Resources/engine.iife.js        # beim Build aus packages/engine kopiert (Version geprüft)
├─ NinaPm.Core.Tests/                 # xUnit auf Linux, macOS und Windows, gegen Attrappen der Abstraktionen: FilterResolver, currentNight, Outbox,
│                                     # LocalStore, ReplanPolicy, LeaseStateMachine, Playback, FlatTracker, Bildzuordnung, EngineHost-Parität
├─ NinaPm.Nina/                       # net8.0-windows ohne eigenes XAML – Adapter, ohne Windows kompilierbar (10.5)
│  ├─ NinaPmPlugin.cs                 # PluginBase, Optionen, Registrierung (MEF)
│  ├─ Sequencer/
│  │  ├─ NinaPmContainer.cs           # „NINA-PM-Anweisungen“ (SequenceContainer + IDeepSkyObjectContainer, Execute überschrieben, ein Block je Aufruf)
│  │  ├─ Items/                       # interne Elemente: SlewCenterItem, StartGuidingItem, DitherItem, TakeExposureItem (IExposureItem)
│  │  ├─ TriggerWalker.cs             # Trigger aller Vorfahren über die eigene Iteration (GetTriggersSnapshot + Filter, Dither unterdrückt; nie RunTriggers, M1), Koordinaten-Injektion
│  │  ├─ NightlyLoopCondition.cs      # NINA-PM Nachtschleife
│  │  ├─ WaitForTimeInstruction.cs    # NINA-PM Warten auf Zeit (Uhrzeit/Dämmerung, Versatz, Tageswechsel-Zeit; Standortzeit, NT-06)
│  │  ├─ DailyLoopCondition.cs        # Enddatum = letzter Nacht-Schlüssel einschließlich (NT-06)
│  │  ├─ RefreshTargetsInstruction.cs
│  │  ├─ TriggerSets/                 # NINA-PM vor/nach jeder Belichtung, vor/nach Zielwechsel (Container mit freiem Inhalt)
│  │  └─ FlatHandling/                # Boxen Vor Flats (einmal) · Je Kombination (Schleife; setzt Filter/Rotator/Gain/Offset/Binning,
│  │                                  # Inhalt z. B. Trained Flat Exposure + Trained Dark Exposure) · Nach Flats (einmal)
│  ├─ Adapters/                       # Umsetzung der Core-Abstraktionen auf NINAs Mediatoren (Kamera, Montierung, Filterrad, Rotator, Guider)
│  ├─ ImageSavedHook.cs               # ein globaler ImageSaved-Handler, Image.Id → Aufnahme-ID vor Enqueue, Eintrag in NINAs Bildhistorie (NIN5-11)
│  ├─ RotationCheck.cs                # eigenes Plate-Solve nach dem Zentrieren (PositionAngle), Winkelprüfung modulo 180° (NT-E4); WCS Flipped → optics_mirrored (NT-33)
│  ├─ SequenceInspector.cs            # Sequenzvorlage prüfen (NT-44), vorhandene Trigger (Flip, AF, Dither), NINA-Einstellungen für den Heartbeat (NT-22)
│  └─ Samples/                        # Beispielsequenzen (FA-NIN-25): one-night (R1), multi-night und with-flats (R5); ohne Gerätewerte; nach der Sequenzvorlage (NT-44)
├─ NinaPm.Nina.Tests/                 # net8.0-windows: Adapter-Tests gegen NINA-Attrappen (Trigger-Walk, Container, blocked-Warten)
│                                     # – baut ohne Windows, läuft nur auf Windows
└─ NinaPm.Nina.Ui/                    # net8.0-windows mit WPF und XAML – ohne Windows baubar (AP-S2c), läuft nur auf Windows
   ├─ Options/                        # Optionsseite: Einführung, Verbindung (URL, Token, Speichern & Verbinden, Aktualisieren, Status,
   │                                  # Offline-/Urlaubsmodus), Rig-Anzeige, Zielbrowser + „In Framing-Assistent laden“ (IFramingAssistantVM; Panel (i, j) ↔ NINA-Panelnummer, Panel 1 = oben links = Nordost, NT-32),
   │                                  # Simulator (gesperrt außer offline)
   ├─ Views/                          # Live-Status mit Blockliste, Nachtgrafik, Planprotokoll, Reiter Flats
   └─ Assets/                         # Symbole, Wörterbücher
```

### 10.3 Ablauf im Container

Verbindlich im Detail: `claude-code/docs/specs/nina/execution.md`. Kurzfassung:

1. **Initialisierung:** Optionen prüfen; `GET /bootstrap` (bei Fehler Cache, bei `401` **kein** Cache und keine Blöcke); Engine-Version und Uhrabweichung gegen `serverTimeUtc` prüfen (offline keine Prüfung, nur Hinweis; NT-05); Outbox senden (Session vor Aufnahmen). Die Nacht bestimmt ausschließlich `currentNight(site, now)` aus der Nacht-Tabelle des Bootstraps, nie die lokale Windows-Zeit (NT-01): Ein Start zu jeder Tageszeit wartet auf die richtige Nacht – z. B. Starfront, 18.09. 09:00 MESZ (02:00 CDT) → Nacht 2026-09-17; 16:00 MESZ (09:00 CDT) → 2026-09-18, das Plugin wartet auf den ersten Block (Heartbeat `idle`).
2. **Plan:** `GET /targets` (ETag) → **online** `POST /plan {reason: initial}` (Server), **offline** `EngineHost.planNight(input)` aus dem Cache; Plan anzeigen; `POST /sessions` mit `nightPlanId` (Lease; bei `409 session.rig_busy` nur Anzeige als Simulation, keine Ausführung). `sessionId`, `nightPlanId`, Blockindex und `tonight` werden in `ninapm.db` persistiert.
3. **Neuplanung mit Hysterese (FA-SYN-03, `execution.md` §3.2):** vor jedem Block nur, wenn das Targets-ETag oder die `settingsVersion` sich geändert hat oder der Block > 10 min hinter dem Plan liegt → `POST /plan {reason: refresh, startAtUtc = max(jetzt, geplanter Blockstart), tonight}` (geplanter Blockstart eines Transitblocks = `min(atUtc)`, NT-25); sonst gilt der Plan unverändert. **Im laufenden Block** alle 15 min `GET /targets`; bei neuem ETag: (a) aktuelles Projekt/Panel/Zeile entfällt → laufende Belichtung zu Ende, Block beenden, neu planen ab jetzt; (b) neuer/geänderter festgelegter Transit, dessen Fenster vor Blockende beginnt → Transit-Unterbrechung (Nr. 8); (c) sonst behält der Block seine Einträge, der neue Plan gilt ab dem nächsten Block. Neuer Blockindex = erster Block des **neuen** Plans mit `endUtc > jetzt` (NT-18); gleiches Panel ohne Leerlauf → kein erneuter Slew. Ereignis `plan_rebuilt`. Die Nachtschleife endet, sobald `now ≥ (darknessEndUtc ?? sessionEndUtc)` gilt und keine Flats ausstehen, spätestens bei `sessionEndUtc`; danach sofort der Ende-Bereich der Sequenz (Guiding stoppen, parken, aufwärmen). Ein leerer Plan nach `darknessEndUtc` ist **kein** `plan_failed`; Warten auf den Blockstart und ein leerer Plan melden im Heartbeat `idle` (NT-11, NT-17).
4. **Ausführung je Block (Muster Astro PM, überschriebenes `Execute`, ein Block je Aufruf):** vergangene/leere/nicht machbare Blöcke überspringen (Gründe `blockSkipReasons`) → Container setzt `Target` und injiziert Koordinaten (Zentrieren nach Drift, Trigger-Sets) → *Center and Rotate* (`CenterAndRotate.PositionAngle = PA`; NINA wählt bei `RotatorSettings.RangeType` `FULL`/`HALF` PA oder PA + 180°, NT-E4; `QUARTER` → `rotator_range_quarter`, M2) bzw. *Center* mit Wiederholungsleiter (FA-NIN-10); ist ein Rotator angelegt, aber nicht verbunden → *Center* + Winkelprüfung wie ohne Rotator + `warning` `rotator_unavailable` (NT-29); der Slew entfällt nur, wenn seit dem letzten Zentrieren weder geparkt noch unterbrochen wurde (`AtPark = false`, Abstand < 1′, NT-16); Kühlung prüfen (Abweichung → weiter belichten, `camera_temperature`, NT-E2) → Trigger-Set *vor Zielwechsel* → Guiding → Einträge nach der Tabelle Eintrag → Aktion (`execution.md` §4.2: `wait` und `autofocus_hint` sind Zeitmarken, NINAs Trigger entscheiden; `meridian_flip` löst das Plugin aktiv aus, Nr. 6) → je Belichtung: Filter wechseln (nur über den bestätigten `ninaFilterName`, exakter Vergleich mit dem NINA-Profil; fehlt er → Aufnahme überspringen, `filter_not_found`, nie mit falschem Filter, NT-E1), Auslesemodus per Name → Index (nicht gefunden → Belichtung überspringen, `readout_mode_not_found`, außer die Kamera meldet genau einen Modus; `SetReadoutModeForNormalImages` wirkt dauerhaft, NT-37), Gain/Offset `null` → NINA-Standard `-1` (NT-38), Dither laut Plan, **Trigger aller Vorfahren-Container** über die eigene Iteration (`GetTriggersSnapshot` + Filter, nie `RunTriggers`, M1; Trigger, deren Typname `dither` enthält, werden **immer** unterdrückt – das Dithern steuert allein der Plan, Warnung `nina_dither_trigger_present` beim Planaufbau, NT-23), interne Belichtung (`IExposureItem`, `GetEstimatedDuration`, per `AttachNewParent` am Container, damit NINAs Flip-Trigger die Zielkoordinaten findet), Nach-Trigger ebenso über die eigene Iteration → Trigger-Set *nach Zielwechsel*. Eine Belichtung beginnt nur, wenn Belichtung + Download bis Blockende passen; die Nachtende-Kulanz gilt nur nach NT-13 (8.3 Nr. 7).
5. **Meldungen:** Das interne Belichtungselement erzeugt vor der Belichtung die Aufnahme-ID (UUID v7) und kennt Session, Plan, Block, Zeile, Beobachtung und Bonus. Bildpipeline: `CaptureImage` → Eintrag in NINAs **Bildhistorie** (`ImageHistoryVM.Add`, damit „Autofokus nach n Belichtungen“ und HFR-Trigger zählen) → `PrepareImage` → Statistiken → Ziel-Metadaten → `Enqueue`. Nach `CaptureImage` wird `MetaData.Image.Id` (NINA-int) → Aufnahme-ID **vor** `ImageSaveMediator.Enqueue` registriert; `ImageSaved` → `saved` mit Dateiname; ohne `ImageSaved` binnen 120 s → `failed` + Ereignis `warning`; Abbruch → `aborted`. Lokal gezählt (Offline, Flats) wird erst nach `saved`. Nicht zuordenbare Bilder → `unassigned`. Optionale NINA-Statistiken als `metrics`. `capturedAtUtc` = `MetaData.Image.ExposureStart` (UTC), `exposureMidUtc` = `ExposureMidPoint` (NT-10).
6. **Meridian-Flip:** Der Flip läuft über NINAs Meridian-Flip-Trigger, den das Plugin **aktiv** auslöst: beim Plan-Eintrag `meridian_flip` wartet es ab `atUtc`, bis NINAs früheste Flip-Zeit erreicht ist (`minimumTimeRemaining ≤ 0` aus `TelescopeInfo.TimeToMeridianFlip`, höchstens bis `limitEnd = tM + maxAfterMin`, M3), und ruft dann die Trigger aller Vorfahren über die eigene Iteration auf (`GetTriggersSnapshot` + Filter, Dither unterdrückt, M1); NINA flippt, weil die früheste Flip-Zeit erreicht ist (NT-21) – unabhängig von `UseSideOfPier`, das nur vor der frühesten Flip-Zeit wirkt (L8). `SequenceInspector` prüft, ob der Trigger vorhanden ist, und liest die Werte aus dem **aktiven NINA-Profil**; sie gehen mit dem Heartbeat an den Server, Abweichungen zu Vorgaben und Rig-Werten → Warnung und Alarm `alert.nina_settings_mismatch` mit Code-Liste (bisher `flip_settings_mismatch`, 7.6, NT-22). **Erkennung:** Pier-Seite **vor** dem Trigger-Lauf merken und direkt **danach** vergleichen (vor dem Flip `west`, danach `east` als ASCOM-Pointing-State, NT-34; Abweichung zum Plan bis ±1 Belichtung zulässig, darüber Neuplanung). Gemeldete Flip-Dauer = `now − max(tTriggerStart, tM + afterMin)` (NT-21). Ohne Pier-Seite dient **nicht** der Vorzeichenwechsel des Stundenwinkels als Ersatz (der wechselt am Meridian immer, auch ohne Flip), sondern ein Plate-Solve-Vergleich: Δ Positionswinkel ∈ [150°, 210°] **und** Laufzeit des Trigger-Aufrufs ≥ 0,5 · `flip_duration_s` (NIN5-1, `execution.md` §4.5). Trifft nur eines zu, wird `flip_undetected` gemeldet und der Flip gilt als nicht erfolgt. **Nach jedem erkannten Flip** – geplant oder ungeplant (Pierseite gewechselt) – zentriert das Plugin selbst vor der nächsten Belichtung (NINA-*Recenter* aus, M3); mit Rotator wird **nicht** nachrotiert – NINA dreht nach dem Flip nicht, der mechanische Winkel bleibt, der Himmels-PA ändert sich um 180°, und der Vergleich `r = |ist − soll| mod 180; Δ = min(r, 180 − r) ≤ Toleranz` bleibt erfüllt; der Flip erzeugt deshalb auch keine zweite Flat-Kombination (NT-E4). Mit `Recenter = true` ohne Rotator entfällt das eigene Zentrieren (nur Winkelprüfung, NT-22). Winkelabweichung → `rotation_mismatch`; Ereignis `flip`; jede Aufnahme meldet `pierSide` und `rotatorMechDeg` (ohne Rotator 0).
7. **Playback:** *zeitgeführt* – nächster Eintrag mit `atUtc ≤ jetzt + Verzug`, wobei der Verzug **alle** Nicht-Belichtungsaktionen kumuliert (Flip, Autofokus, Zentrieren inkl. Wiederholungen, Dither, Download) und den Startverzug (`tatsächlicher Start − geplanter Start`, NT-21); `wait` endet spätestens beim folgenden `meridian_flip`; mehr als 3 übersprungene Belichtungen je Block → Neuplanung; *sequenziell* – strikt nächster Eintrag; beide enden am Blockende – **harter Blockschluss, kein Überhang** in den Folgeblock (A-30 entfällt, `execution.md` §4.2, `allocation.md` §8.1); einzige Ausnahme ist die Nachtende-Kulanz (`lastOfNight`).
8. **Transit (`execution.md` §5):** im **selben Container** als Block `kind: transit` (kein eigener Container). Vorlauf: Fensterbeginn aus dem Plan (zusätzlich `targets`, in der letzten Stunde alle 5 min abgerufen); vor jeder Belichtung prüfen, ob sie vor `Fensterbeginn − Slew − 60 s` endet; eine laufende, zu lange Belichtung wird über den **eigenen Abbruch-Token** beendet (`aborted`, OP-12). Filter (Transit-Filter über `photometric_band`, 8.5, NT-41) und Auslesemodus werden **einmal vor der Serie** gesetzt; `expose_series` belichtet bis Fensterende, unabhängig von der Anzahl, ohne Dither und weiteren Filterwechsel. Die Trigger-Filterung läuft über `GetTriggersSnapshot()` je Vorfahren-Container (Typ-Allowlist), weil `RunTriggers` alles-oder-nichts ist: Autofokus-Trigger und *Zentrieren nach Drift* nur wenn erlaubt (FA-EXO-20), Dither-Trigger nie (NT-23), Meridian-Flip immer – liegt `tM + afterMin` im Fenster, entsteht die im Plan ausgewiesene Lücke (NT-25); eigene Trigger-Sets mit Autofokus-Anweisungen werden übersprungen; unterdrückte Trigger → `trigger_suppressed`. Danach `transit_end` und Neuplanung.
9. **Unterbrechung/Neustart:** Nach einem Neustart `sessionId` und `tonight` aus `ninapm.db`; Wiederaufnahme mit derselben Session (`reason: resume`, eigene Lease wird erneuert, `PATCH {status: "running", resumedAtUtc}`); der Blockindex kommt aus dem **neuen** Plan, dessen `nightPlanId` ab dann in allen Meldungen steht (NT-18); neue Nacht → neuer Plan. **Safety (NT-16, `execution.md` §4.6):** Die Beispielsequenz nutzt NINAs *Loop While Safe* (`SafetyMonitorCondition`) statt eines Parallel-Containers. Unterbrechung (Interrupt, `IsSafe = false`) → laufende Aufnahme `aborted`, `block_end` Grund `interrupted`, Ereignis `safety_pause`, Heartbeat `paused`; beim nächsten Start `reason: resume` und Ereignis `safety_resume`. Die 5-min-Sperre gegen Endlosschleifen gilt nur nach einem **Benutzerabbruch**, nicht nach einem Interrupt. **Frist statt endlosem Warten (H2):** Der Sicherungscontainer hängt zusätzlich an *NINA-PM Nachtschleife* und wartet mit der Plugin-Anweisung *NINA-PM Warten bis sicher oder Nachtende* (nicht mit NINAs *Wait until Safe*, das keine Frist kennt) höchstens bis `darknessEndUtc ?? sessionEndUtc`; bleibt es bis dahin unsicher, schließt die Anweisung die Nacht ohne Wiederaufnahme ab (Flats nur, falls sicher; `PATCH completed`; Nachtschleife falsch → Ende-Bereich). Ohne verbundenen Safety-Monitor gilt die Vorlage ohne Safety-Schleife; enthält die Sequenz trotzdem Safety-Bedingungen, meldet der `SequenceInspector` `safety_monitor_not_connected`. **Benutzer-Stopp (NT-15):** Stoppt der Benutzer die Sequenz, sendet das Plugin `PATCH {status: "aborted"}` und danach Heartbeats ohne `sessionId`.
10. **Session, Lease, Heartbeat (5.6):** Heartbeat im Hintergrund alle 60 s, auch außerhalb der Sequenz; Zustandsmaschine mit vollständigen Übergängen (`execution.md` §6), inkl. „3 Heartbeats ohne Antwort → `unreachable`“ (Blöcke laufen weiter, nächster Planbedarf per Jint aus dem Cache, FA-NIN-15, P-09; NT-14) und Rückkehr nach `reacquiring`; `lost` nur bei einer Serverantwort `leaseLost: true` bzw. `409 session.rig_busy` → Belichtung zu Ende, keine neuen Blöcke; Offline-Modus meldet einmal `state: offline`, friert die Lease ein und endet mit dem **ersten Online-Heartbeat** (`offline_end`) bzw. spätestens mit dem Ablauf von `offline_until` (14 Tage, 13) – eine Admin-Freigabe ist dafür nicht nötig; der Admin kann die Lease lediglich vorzeitig freigeben (5.5). **Gesperrte Zustände** (`blockedReasons`: `lease_lost`, `rig_busy`, `token_invalid`, `engine_incompatible`, `clock_skew`, `plan_failed`, `tenant_locked`) warten 60 s je Aufruf statt sofort zurückzukehren und haben je Grund eine eigene Austrittsregel (`execution.md` §2). Auch nicht behebbare Gründe beenden **zuerst** die laufende Belichtung und den Block (`block_end`) und setzen die Nachtschleife erst im nächsten Aufruf ohne laufenden Block auf falsch (NIN5-2).
11. **Live-Status und Bedienung (FA-NIN-13):** aktueller Befehl, Ziel/Panel, Filter, Belichtungsnummer, Blockliste, Nachtgrafik, Planprotokoll; *Zurücksetzen* und *Block überspringen*; Log-Zeilen im Format `NINA-PM | EVENT key=value …` (FA-NIN-19, maschinell auswertbar für die Testprotokolle); Standortprüfung (FA-NIN-03).
12. **Ende – Flat-Handling (R5, Muster Astro PM mit mechanischem Winkel, `execution.md` §7):** **Panelflats** (`flats.source = panel`) ab `flatsNotBeforeUtc`; **Himmelsflats** (`sky`, NT-40) zwischen `flatsNotBeforeUtc` (Sonne −8°) und `flatsNotAfterUtc` (Sonne −2°), Reihenfolge Schmalband → Breitband → L, ohne zu parken, Kombinationen nach `flatsNotAfterUtc` → `skipped`. Guiding stoppen, Boxen an einen Container ohne Parent hängen (keine Sequenz-Trigger während der Flats), Fortschritt rekursiv zurücksetzen → Box *Vor Flats* einmal → `FlatTracker` bildet die Kombinationsliste (Filter + **mechanischer** Rotatorwinkel + Gain + Offset + Binning + Auslesemodus; gleiche Kombinationen mehrerer Ziele nur einmal; Winkel **geclustert** mit halber Rotationstoleranz, Repräsentant = Median; bei vollständigem Flat-Satz je Winkel alle Filter; Dark-Flats je (Belichtungszeit, Gain, Offset, Binning, Auslesemodus) **einmal je Nacht**, unabhängig vom Winkel) → je Kombination Rotator auf den Median-Winkel drehen, Filter (bestätigter `ninaFilterName`, NT-E1) und Auslesemodus (`SetReadoutModeForNormalImages`) setzen, Kameraparameter in die Kind-Anweisungen der Box *Je Kombination* schreiben (z. B. *Trained Flat Exposure*, danach *Trained Dark Exposure*) und ausführen (Trained Flats: je Filtername die Position des letzten Flat-Laufs merken, geändert → Kombination überspringen + `warning` `trained_flat_position_changed`; erste Flat-Aufnahme mit `meanAdu` außerhalb 20–80 % des Vollausschlags → `warning` `flat_exposure_off`; NINA unterscheidet beim Trained Flat den Auslesemodus nicht; `KeepPanelClosed` an Trained Flat/Dark Flat in der Beispielsequenz; NT-39) → Box *Nach Flats* einmal → Dateien geteilter Kombinationen vom Primärziel (erstes Ziel) in die Ordner der übrigen Ziele kopieren (Kopien nicht melden) → jede Aufnahme einmal als `capture` mit `frameType`, `projectIds`, eingefrorenem `rotatorMechDeg` und `flatsPlanned`/`darkFlatsPlanned` melden → sobald `now ≥ (darknessEndUtc ?? sessionEndUtc)` gilt und keine Flats ausstehen (spätestens bei `sessionEndUtc`), sendet das Plugin am Schleifenende `PATCH /sessions/{id} {status: completed, endedAtUtc, outboxPending, ninaConditions}` **sofort**, auch bei nicht leerer Outbox (NIN5-7), und die Nachtschleife wird **im nächsten Aufruf ohne laufenden Block** falsch (NT-11) → Ende-Bereich der Sequenz: Guiding stoppen, parken, aufwärmen (NIN5-12, `execution.md` §2; gleiche Reihenfolge in FA-NIN-06 und P-22). Ein Wiederöffnen mit `running` gibt es nicht. Status und Anzahl je Kombination stehen in `flat_combination_local`; ein Neustart setzt bei der ersten nicht erledigten Kombination mit den **fehlenden** Aufnahmen fort.

**Outbox-Regeln:** FIFO je Session (Session zuerst, dann Aufnahmen/Ereignisse; ein offline erzeugter Plan per `PATCH {offline: true, offlinePlan}` **vor** den ersten Meldungen dieses Plans – FIFO-Barriere, NT-14); `2xx` → gesendet (14 Tage Historie); `408/429/5xx`/Netz → Wiederholung mit Backoff; `409 session.unknown` → Session erneut senden; `409 session.rig_busy` beim Nachmelden einer Offline-Session → mit `offline: true` erneut senden (nie Dead-Letter-Schleife); `401` → Senden anhalten, Fehlermeldung; übrige `4xx` → lokaler Dead-Letter (Anzeige im Plugin und Anzahl im Heartbeat), Warteschlange läuft weiter. „Erneut hochladen ab Datum“ sendet die Historie nach einem Server-Restore erneut (idempotent). Noch nicht mit `2xx` quittierte Meldungen gehen als `pendingCaptures` `[{exposureLineId, transitObservationId?, captureIds}]` in `POST /plan` ein; Dead-Letter-Aufnahmen zählen nicht (NT-20).

**Sequenzvorlage (verbindlich, NT-44; Liste in `execution.md` §1, Prüfpunkt im `SequenceInspector`, AP-16h):** *Start:* Warten auf Sonnenhöhe (−6°; in R1, bis *NINA-PM Warten auf Zeit* in R5 kommt), **danach** Unpark (H3), Cool Camera, **Autofokus einmal je Nacht vor dem ersten Ziel** (NT-24; `tonight.lastAutofocusUtc` aus NINAs AF-Historie). *Ziel:* Container mit den Bedingungen *NINA-PM Nachtschleife* und *Loop While Safe*, Trigger *Meridian Flip*, *Autofokus nach Zeit* mit `Amount = afEveryMin` (M7), Autofokus nach HFR/Temperatur (optional), *Center after Drift* (optional), *Restore Guiding*, **kein** Dither-Trigger; danach ein Container mit *Loop While Unsafe* **und** *NINA-PM Nachtschleife* (Stop Guiding, Park, *NINA-PM Warten bis sicher oder Nachtende*, Unpark; H2); beides in einer äußeren Schleife mit *NINA-PM Nachtschleife*. *Ende:* Stop Guiding, Park, Warm Camera. Die Beispielsequenzen unter `downloads/nina-sequences/` folgen dieser Liste (dazu „Eine Nacht ohne Safety“ ohne Safety-Bedingungen, H2; „Mehrere Nächte“ wartet ebenfalls vor dem Entparken, H3); Abweichungen in Inhalt **und Reihenfolge** meldet der `SequenceInspector` beim Planaufbau (`sequence_template_deviation`).

**Automatischer Start (NT-45):** Die Windows-Aufgabenplanung startet NINA über die Kommandozeile mit Profil, Sequenzdatei und „Sequenz starten“ (die genauen Schalter prüft AP-S2b). Weil die Nacht über `currentNight` bestimmt wird (NT-01), darf der Start zu jeder Tageszeit erfolgen – auch vor oder nach dem lokalen Mittag des Standorts; das Plugin wartet auf die richtige Nacht und den ersten Block.

### 10.4 Offline

- Cache (in `ninapm.db`) enthält Bootstrap, Targets, letzten Plan; online höchstens 7 Tage alt verwendbar, im Offline-Modus unbegrenzt; Offline-Modus plant ausschließlich daraus (Jint).
- **Jint-Laufzeit (Spec-Ergänzung ADR-S2a, angenommen von Sven am 28.09.2026):** `EngineHost` hält **eine** Engine je Plugin-Lauf auf einem **eigenen Hintergrund-Thread** mit Warteschlange (Jint ist nicht threadsicher). Das Bundle wird beim Plugin-Start geladen und wiederverwendet. Optionen je Aufruf: `Strict()`, `LimitRecursion(64)`, `TimeoutInterval(60 s)`, `CancellationToken` verknüpft mit Sequenz-Stopp und Plugin-Ende; **kein** `LimitMemory`, weil es die Allokation misst, nicht die Belegung. Zeitüberschreitung → Plan nicht gebaut (`blocked { plan_failed }`, 5-min-Sperre, `execution.md` §2). Bis **90 Einheiten** (Richtwert 30 × 3 × 5) plant das Plugin offline ohne Einschränkung, darüber meldet es beim Planaufbau einmal `warning` Code `offline_plan_large`. Messwerte: Richtwert 2,2 s (M4) bzw. 6,2 s (x64-CI).
- Outbox zählt lokale Aufnahmen gegen den Cache-Restbedarf (Folgenacht korrekt) und lädt nach, sobald online; der Server übernimmt Meldungen auch zu inzwischen gelöschten Objekten (Status `archived`, 6.6).
- Offline-Planung nutzt die im Bootstrap gelieferte Nacht-Tabelle (60 Nächte ab der Mittagsnacht, je Zeile mit `nightWindowEndUtc`) mit `tzdataVersion` und `timeZoneTransitions`; `currentNight` rechnet das Plugin daraus (NT-01/NT-02). Offline gibt es keinen Uhrabgleich, nur einen Hinweis (NT-05). Auch im Zustand `unreachable` (drei Heartbeats ohne Antwort, NT-14) wird der nächste Plan mit Jint aus dem Cache gerechnet; seine Meldungen tragen die vom Plugin vergebene `nightPlanId`.
- Einschalten des Offline-Modus (FA-NIN-04) sendet, sofern erreichbar, einen letzten Heartbeat `state: offline` → keine Alarme, Lease eingefroren (5.6); Rückkehr → `offline_end`, Outbox nachsenden.

### 10.5 NINA-Assemblies, Build und Entwicklung ohne Windows

> **Spec-Ergänzung (ADR-S2c, 28.09.2026):** Übersetzt wird gegen die NuGet-Pakete `NINA.*` statt gegen Referenz-Assemblies aus der NINA-Installation. `refs/` und `tools/fetch-nina-refs.ps1` entfallen. Grund: `NINA.Plugin` 3.2.0.9001 zieht alle fünf Adapter-Assemblies als eigene Pakete nach. Belege und Alternativen: `docs/adr/ADR-S2c-build.md`.

**Ausgangslage.** Das NINA-3-Plugin-Template – und damit auch das Astro-PM-Plugin – bindet einen Teil der NINA-Assemblies als direkte `Reference` mit `HintPath` in das **Installationsverzeichnis** von NINA ein:

```xml
<Reference Include="NINA.Sequencer">
  <HintPath>$(ProgramFiles)\N.I.N.A. - Nighttime Imaging 'N' Astronomy\NINA.Sequencer.dll</HintPath>
  <Private>false</Private>
</Reference>
```

Ohne Windows scheitert ein solcher Build zweistufig. Zuerst scheitert er mit `NETSDK1100` am Windows-Ziel-Framework; das behebt `EnableWindowsTargeting`. Danach scheitert er an den `HintPath`s selbst, weil `$(ProgramFiles)` dort leer ist (`MSB3245` je Referenz, in der Folge `CS0246` für jeden NINA-Typ). Dieses Muster übernehmen wir deshalb nicht. Seit NINA 3.2 ist es auch nicht mehr nötig: Das Paket `NINA.Plugin` hängt von `NINA.Sequencer`, `NINA.Equipment`, `NINA.WPF.Base`, `NINA.PlateSolving`, `NINA.Image`, `NINA.Core`, `NINA.Profile` und `NINA.Astrometry` in derselben Version ab (Lizenz MPL-2.0).

**NuGet-Pakete `NINA.*`.** Die Version steht an einer Stelle, in `apps/nina-plugin/Directory.Build.props`. Eigenschaften, die vom Ziel-Framework abhängen, stehen in `Directory.Build.targets`. Die Props-Datei wird vor dem Projekt gelesen, dort ist `$(TargetFramework)` noch leer. Eine Bedingung darauf greift in der Props-Datei nie, `PlatformTarget` bliebe `AnyCPU` (ADR-S2c).

```xml
<!-- Directory.Build.props -->
<Project>
  <PropertyGroup>
    <!-- muss zur installierten NINA passen (Rig, Windows-Rechner aus H-14) -->
    <NinaVersion>3.2.0.9001</NinaVersion>
    <EnableWindowsTargeting>true</EnableWindowsTargeting>
  </PropertyGroup>
</Project>

<!-- Directory.Build.targets -->
<Project>
  <PropertyGroup Condition="'$(TargetFramework)' == 'net8.0-windows'">
    <PlatformTarget>x64</PlatformTarget>
    <NoWarn>$(NoWarn);NU1701</NoWarn>
  </PropertyGroup>
</Project>
```

Gesetzt wird `PlatformTarget`, **nicht** `<Platforms>`: `Platforms` ist nur die Auswahlliste für Projektmappen-Konfigurationen und ändert den Standardwert `AnyCPU` nicht. Damit braucht kein Build-Aufruf ein zusätzliches `-p:Platform=x64` oder `-p:EnableWindowsTargeting=true`. `NU1701` betrifft zwei .NET-Framework-Pakete aus NINAs eigenem Baum (`ToastNotifications`, `VVVV.FreeImage`); gegen sie wird weder übersetzt noch werden sie ausgeliefert.

- Jedes Projekt mit NINA-Bezug bindet `<PackageReference Include="NINA.Plugin" Version="$(NinaVersion)" IncludeAssets="compile" />` ein. `IncludeAssets="compile"` statt `ExcludeAssets="runtime"`: Sonst landet WebView2 über `build`-Targets trotzdem in der Ausgabe. Übersetzt wird dagegen, ausgeliefert nichts davon, denn NINA lädt seine eigenen Assemblies.
- **Dieselbe Regel für Pakete, die NINA schon mitbringt:** `System.ComponentModel.Composition`, `Newtonsoft.Json` und in `NinaPm.Nina.Ui` `Microsoft.Xaml.Behaviors.Wpf` (MIT, früher die sechste Datei aus `refs/`) nur mit `ExcludeAssets runtime`, in der Version, die NINA mitliefert. Der NSwag-Client zieht Newtonsoft mit, und zwei Versionen im selben Prozess sind eine klassische Ladefehlerquelle. Eigene Abhängigkeiten – `Jint`, `Microsoft.Data.Sqlite`, `Polly` – werden dagegen mitgeliefert.
- **Version prüfen:** `tools/nina-build-check.sh <ordner>` stellt nach dem Build drei Dinge sicher:
  - alle `NINA.*`-Pakete sind in `NinaVersion` aufgelöst (ausgenommen `NINA.Accord.*`, NINAs Accord-Abspaltung mit eigener Nummer);
  - die Ausgabe enthält nur eigene DLLs und die mit `--allow` genannten Abhängigkeiten;
  - keine DLL liegt im Git.
  
  Das Skript läuft lokal und im CI (`cross-build`, 18). Die Plugin-Assembly trägt `MinimumApplicationVersion = $(NinaVersion)` als `AssemblyMetadata`, damit NINA sie nicht in einer älteren Version lädt.
- **NINA-Update:** `NinaVersion` nur zusammen mit dem Update auf dem Rig anheben. Einmal je Version prüft Sven auf dem Windows-Rechner, dass die Dateiversion von `NINA.Sequencer.dll` der Installation `NinaVersion` entspricht (H-14). H-15 hält die NINA-Version in jedem Protokoll fest.

**Ausgabeverzeichnis der Plugin-Projekte.** `NinaPm.Nina` und `NinaPm.Nina.Ui` setzen – wie das Original – `AppendTargetFrameworkToOutputPath`, `AppendRuntimeIdentifierToOutputPath`, `GenerateDependencyFile` und `GenerateRuntimeConfigurationFiles` auf `false`; sonst landen die Dateien in einem Unterordner `net8.0-windows\` und NINA findet das Plugin nicht. Diese vier Eigenschaften gehören **in die beiden Projektdateien, nicht** in `Directory.Build.props`: die Testprojekte brauchen `deps.json` und `runtimeconfig.json` für den Test-Host. Die `Debug`-Ausgabe zeigt nur auf Windows in den Plugin-Ordner:

```xml
<PropertyGroup Condition="'$(Configuration)' == 'Debug' and '$(OS)' == 'Windows_NT'">
  <OutputPath>$(LOCALAPPDATA)\NINA\Plugins\3.0.0\Svenesis.NinaPm\</OutputPath>
</PropertyGroup>
```

**Bauen und Testen ohne Windows.**

| Projekt | Ziel-Framework | `dotnet build` ohne Windows | `dotnet test` ohne Windows |
|---|---|---|---|
| `NinaPm.Core` | `net8.0` | ja | – |
| `NinaPm.Core.Tests` | `net8.0` | ja | **ja** – die inhaltliche Prüfung |
| `NinaPm.Nina` | `net8.0-windows` | **ja** (NuGet `NINA.*`) | – |
| `NinaPm.Nina.Tests` | `net8.0-windows` | **ja** (NuGet `NINA.*`) | nein – `net8.0-windows` läuft nur auf Windows |
| `NinaPm.Nina.Ui` | `net8.0-windows` mit XAML | **ja** – der Markup-Compiler trägt ohne Windows (ADR-S2c) | nein |

```bash
dotnet build apps/nina-plugin/NinaPm.Core
dotnet test  apps/nina-plugin/NinaPm.Core.Tests
dotnet build apps/nina-plugin/NinaPm.Nina
dotnet build apps/nina-plugin/NinaPm.Nina.Tests
dotnet build apps/nina-plugin/NinaPm.Nina.Ui
tools/nina-build-check.sh apps/nina-plugin
```

Das ist die lokale Abnahme vor jedem Plugin-PR. Sie besteht aus vier Compiler-Gegenlesungen, einer inhaltlichen Prüfung und der Paket- und Ausgabeprüfung. Zusätzliche `-p:`-Schalter braucht keiner der Befehle, weil `Directory.Build.props` und `Directory.Build.targets` `EnableWindowsTargeting` und `PlatformTarget` setzen. Nur Windows kann die Adapter-Tests ausführen.

**WPF im Adapter.** `NinaPm.Nina` setzt `UseWPF=true`, hat aber **keine eigene XAML-Datei**. Das ist der geplante Weg, nicht die Rückfallebene: `NINA.WPF.Base` trägt die Mediator-Schnittstellen, und sobald deren Signaturen WPF-Typen verwenden, braucht ein Adapter ohne WPF-Referenzen sie trotzdem – der Fehler wäre dann `CS0012` (Typ in nicht referenzierter Assembly). Mit `EnableWindowsTargeting` kommt das Referenzpaket `Microsoft.WindowsDesktop.App` über NuGet, und ohne XAML-Datei läuft der Markup-Compiler gar nicht – genau der ist die unsichere Stelle ohne Windows. **AP-S2c** hat drei Fragen geklärt, alle mit Ja (ADR-S2c): (1) Der Adapter baut mit `UseWPF=true` und ohne XAML ohne Windows. (2) Er baut sogar ohne `UseWPF`; wir bleiben trotzdem bei `UseWPF=true`, wie das NINA-Template. (3) Der Markup-Compiler trägt ohne Windows, `NinaPm.Nina.Ui` wird lokal mitgebaut.

**Was ohne Windows nicht geht.** Ausführen. NINA und ASCOM sind Windows-Programme; kein Schalter des SDK ändert das. Die Protokolle P-01…P-24 laufen auf dem Rechner aus H-14 gegen `tools/nina-test-server`; die Ergebnisse (`result.json`, `nina.log`, Screenshots) liegen in `docs/test-runs/<JJJJ-MM-TT>/<P-xx>/` und werden mit `pnpm test-run:check <ordner>` ausgewertet – das wieder auf dem Entwicklungsrechner.

**Arbeitsablauf.** Auf dem Entwicklungsrechner (macOS oder Linux): Kern schreiben und testen, Adapter, Adapter-Tests und Ansichten schreiben und **kompilieren**, `tools/nina-test-server` (Node) betreiben, Engine-Bundle und Jint-Parität prüfen. Sind die Befehle oben grün, geht der PR heraus; `plugin.yml` baut auf `windows-latest` die vollständige Lösung samt Ansichten, führt die Adapter-Tests aus und legt die ZIP ab. Die ZIP wird auf dem Rechner aus H-14 in `%LOCALAPPDATA%\NINA\Plugins\3.0.0\Svenesis.NinaPm\` entpackt und nach `plugin-test-protocol.md` geprüft. Für eine schnelle Runde kann dieser Rechner auch selbst bauen – `dotnet build -c Debug` legt die Dateien dort direkt ab.

**Anforderungen an den Windows-Rechner (H-14).** Erste Wahl ist der Observatoriums-PC, weil dort NINA, ASCOM und die Treiber schon liegen. Sonst genügt ein einfacher x64-Rechner nur für NINA und die Simulatorgeräte. Eine Windows-11-ARM-Maschine auf Apple Silicon funktioniert für die Protokolle, führt NINA und die ASCOM-Simulatoren aber unter x64-Emulation aus; **Zeitmessungen** (Flip-Dauer, Settle, `flip_duration_s`) sind dort nicht aussagekräftig und werden nur auf x64-Hardware abgenommen.

---

## 11. Frontend (React + TypeScript)

### 11.1 Technologie

| Thema | Wahl |
|---|---|
| Build | Vite, `base: '/'`, Code-Splitting je Bereich (Sternkarte, Simulator, Exoplaneten lazy) |
| UI | React 19, TypeScript strict |
| Routing | React Router (Data Router), Routen nach Bildschirmkonzept S-xx |
| Server-State | TanStack Query (Cache, Retry; `401` → Anmeldeseite, kein Refresh, 5.3) |
| Markdown (`*_md`) | **`react-markdown` ohne rohes HTML** (`skipHtml`, kein `rehype-raw`); `dangerouslySetInnerHTML` ist im ganzen Frontend verboten (ESLint-Regel, `rules/ui.md`, SV-05) |
| Formulare | react-hook-form + zod-Resolver (Schemas aus `packages/shared`) |
| Tabellen | TanStack Table (Sortierung, Spaltenauswahl, virtuelles Scrollen für Protokolle) |
| Barrierefreie Primitive | Radix UI (Dialog, Menü, Tabs, Tooltip, Select) – ungestylt, mit eigenen CSS Modules |
| Styling | CSS Modules + Design-Tokens `--npm-*` aus `packages/ui-tokens` (Kopie nach Vorbild svenesis.org) |
| i18n | react-i18next, Namespaces je Bereich, DE Standard, EN |
| Diagramme | eigene Canvas-Komponenten (portiert aus den Astro-Tools: Nacht-Streifen, Höhenkurven, Saison, Astro-Wetter), uPlot für einfache Zeitreihen |
| Sternkarte | neues TS-Modul nach Vorlage `sky-map.js` (Kopie, 8.4) mit Layern für Bildfeld, Mosaik, Projekte |
| Engine im Browser | Web Worker + Comlink, gleiche `packages/engine` |
| Datum/Zeit | **Datumslogik** mit `@js-temporal/polyfill` (Temporal), nie `new Date('YYYY-MM-DD')`, kein date-fns-tz; Nacht-Schlüssel, `currentNight` und Offsets für Engine-Läufe aus `GET /web/v1/sites/{id}/nights` (NT-02, NT-04). **Anzeige** mit `Intl`: Nachtereignisse immer in **Standortzeit mit Kürzel** (`de-DE` mit `timeZoneName: 'short'`; liefert das `GMT±x`, dann `en-US` → „CDT“; sonst `UTC±h`); Fristen ohne Standortbezug in Mandantenzeit, Standortzeit im Tooltip; Doppeldatum-Regel wie FK (NT-03) |
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
│                       # CoordinateInput, RigSelect, StatusBadge, CheckList, DataTable, Card, Note,
│                       # ConfirmDialog (E4), Markdown (react-markdown ohne HTML, SV-05), SiteTime (Standortzeit mit Kürzel, NT-03)
├─ api/                 # generierter Client (openapi-typescript + fetch-Wrapper mit CSRF-Header)
├─ workers/engine.worker.ts
└─ styles/              # global.css (Reset, Tokens-Import, Themes)
```

- **`ConfirmDialog` (E4, Vertrag in `specs/ui/components.md`):** Radix-Dialog mit Titel, den Folgen in **einem** Satz, einem Aktionsknopf mit Verb („Projekt löschen“, „Admin-Rechte entziehen“, „Owner übertragen“, „Ablehnen“, „Token widerrufen“, „Sitzungen beenden“) und *Abbrechen*, das beim Öffnen den Fokus hat. Pflicht für: Löschen, Rechte entziehen, Owner übertragen, Ablehnen, Token widerrufen, Sitzungen beenden. Eine Namenseingabe verlangt der Dialog **nur** beim Löschen eines Mandanten (S-80). Er ist Schutz gegen Versehen, keine Sicherheitsprüfung – die Rechte prüft allein der Server.
- **Filterradbelegung (NT-E1, S-10):** je Platz Web-Filter, zuletzt gemeldeter NINA-Name, Vorschlag und Status *bestätigt*/*unbestätigt*; *Bestätigen* ruft `PUT /web/v1/rigs/{id}/filter-wheel` (Admin/Owner). Nicht zugeordnete Zeilen zeigen im Editor und in der Auslieferung (S-41) den Hinweis „nicht zugeordnet – wird nicht geplant“.
- **Papierkorb (E4):** Die Projektliste (S-30) hat für Admins und Owner die Ansicht „Gelöscht“ mit *Wiederherstellen* (6.6); gelöschte Projekte verschwinden aus allen übrigen Listen.

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
- Fetch-Wrapper: Basis `/api` (gleicher Origin), `credentials: 'same-origin'`, Header `X-NPM-Request: 1` auf allen schreibenden Aufrufen (CSRF, 5.3). **Kein Refresh:** Die Sitzung liegt serverseitig; bei `401 auth.unauthenticated` leitet der Wrapper einmal auf die Anmeldeseite mit `next` = aktueller Pfad, ohne Wiederholung und ohne tabübergreifende Abstimmung (SV-01). `403 auth.identity_blocked` → *Kein Zugang*; `mfaRequired` aus `GET /auth/me` → Hinweisband „Admin-Rechte nur mit Discord-2FA“ (SV-03).
- **Neues Deployment:** Tritt beim Nachladen eines Code-Teils ein `ChunkLoadError` auf, lädt die App einmal neu (alte Chunks bleiben ohnehin 30 Tage verfügbar, 4.1).
- **Berichte (FA-AUS-18):** eigene Druckansicht mit Print-CSS (`@media print`, Seitenumbrüche je Projekt); „Als PDF speichern“ über den Druckdialog des Browsers. CSV-Export über die API.

---

## 12. Dateien und S3

| Zweck | Schlüssel | Ablauf |
|---|---|---|
| Vorschaubild Projekt | Katalogobjekt: kopierte Katalogbilder `https://nina-pm.svenesis.org/catalog/img/ngc/<id>.jpg` (128 px), `…/catalog/img/ngc-l/` bzw. `…/catalog/img/dso/` (320 px); freie Koordinaten/Mosaik/Rig-Bildfeld: Web-Bucket `catalog/thumbs/<sha256(ra,dec,fov,rotation,survey)>.jpg` | Job `thumbnail` holt Ausschnitt über CDS hips2fits und speichert JPEG. **Aufruf verbindlich (AST-D26):** `ra`, `dec`, `fov` und `rotation_angle` in **Dezimalgrad** – `fov` ist die Kantenlänge des Ausschnitts, das Bildfeld liegt in `geometry.md` §1 in **Grad**, in `dso_object` aber in **Bogenminuten** (Faktor 60) –, dazu `coordsys=icrs`, feste `projection` und eine HiPS-ID je Survey; die Drehrichtung von `rotation_angle` gegenüber dem Kamera-PA aus `flip-rotation.md` §3 bestätigt der Spike AP-21. Der **Cache-Schlüssel** wird über die kanonische Zahlform gebildet (`q(x,1e6)`, feste Feldreihenfolge, fester Trenner) und liegt als Testvektor im Paket – ohne diese Festlegung erzeugen identische Ausschnitte unterschiedliche `sha256`-Schlüssel (Cache-Miss, doppelte CDS-Last, S3-Kosten); Himmelsausschnitte sind nicht mandantenbezogen → über CloudFront cachebar, kein presigned GET. **Akzeptiertes Restrisiko (SEC-28):** Die Dateien sind ohne Anmeldung abrufbar; wer Koordinaten und Bildfeld errät, kann daraus schließen, dass **irgendwer** genau diesen Ausschnitt geplant hat (Mandant, Projekt und Person bleiben verborgen). Das steht so in der Datenschutzerklärung. Wer es nicht will, salzt den Schlüssel mit einem serverseitigen Geheimnis (`sha256(secret‖params)`) – der Cache bleibt dabei erhalten **Akzeptiertes Restrisiko (SEC-28):** der Schlüssel ist aus den Parametern ableitbar – ein Treffer verrät, dass irgendwer diesen Ausschnitt geplant hat; so in der Datenschutzerklärung genannt (AP-17). |
| Transit-Ergebnis (HOPS/EXOTIC) | `tenant/<tid>/results/<observationId>/<uuid>-<name>` | `POST /files/upload-url` → **presigned POST** (5 min, `conditions: [["content-length-range", 1, 20971520], ["eq", "$Content-Type", …], ["eq", "$key", "tenant/<tid>/results/<observationId>/<uuid>-<name>"]]`) → `POST /transit-observations/{id}/results {uploadTicketId}` → Job `transit_result_parse` parst (7.1) |
| Lichtkurven-Grafik | `…/results/<observationId>/<uuid>.png` | wie oben |
| Exporte (Mandant, CSV) | `tenant/<tid>/exports/<uuid>.<ext>` | Job `export`, Download-Link 15 min, Lifecycle 7 Tage |
| Mandanten-Import | `tenant/<tid>/imports/<uuid>.json` | **presigned POST** (`content-length-range` 1 … 52428800) → Job `import` (`JSON.parse` + zod mit Grenzen, 7.1) schreibt in Stapeln, Lifecycle 7 Tage |
| Planprotokolle | `tenant/<tid>/plans/<nightPlanId>.json.gz` | **presigned POST** (`content-length-range` 1 … 5242880) aus `POST /sessions` bzw. vom Server bei `POST /plan`; Lifecycle 400 Tage |
| Job-Ergebnisse (Mehrnacht, Auswirkungsvorschau) | `tenant/<tid>/jobs/<jobId>.json` | Status in Tabelle `job` (7.4), Ergebnis per presigned GET; Lifecycle 2 Tage |
| Beispielsequenzen | Web-Bucket `downloads/nina-sequences/<pluginVersion>/*.json` | zweites `BucketDeployment` im lokalen Deploy (`prune: false`, 4.1, E1); das SPA-Deployment berührt den Pfad nicht |

- Upload-URLs prüfen Zweck, Rolle (`can`) und Mandant; Schlüssel werden serverseitig vergeben (keine Pfade vom Client).
- **`eq` statt `starts-with` (verbindlich, SEC-56, SV-09):** `createUploadTicket` erhält den **fertigen** Schlüssel und signiert `["eq", "$key", "<schlüssel>"]` – bei **allen** Zwecken, auch Import und Planprotokoll. Eine Präfix-Bedingung erlaubte es, mit einem gültigen Ticket innerhalb der 5 Minuten beliebige Schlüssel des Präfixes zu überschreiben, etwa das Planprotokoll eines anderen Rigs.
- **Download nur über Zweck und Objekt-ID:** `GET /web/v1/files/download-url {purpose, id}` bildet den Schlüssel serverseitig; ebenso nehmen `POST /web/v1/tenant/import` und `POST /web/v1/transit-observations/{id}/results` **keinen** Schlüssel mehr vom Client, sondern die `uploadTicketId` des zuvor ausgestellten Tickets (SEC-57). Sonst nennt ein Admin von Mandant B einen Schlüssel unter `tenant/<tid-A>/…` und erhält eine presigned GET darauf bzw. importiert fremde Mandantendaten in den eigenen Mandanten.
- **Warum presigned POST und nicht PUT (verbindlich, SEC-23):** Bei einer vorsignierten **PUT**-URL wirken nur die mitsignierten Header; die Größe ist damit nur erzwingbar, wenn der Client sie vorab nennt. **presigned POST** trägt die Bedingung `content-length-range` in der Politik und lehnt zu große Uploads direkt in S3 ab. Eine zusätzliche Größenprüfung oder ein Löschschritt im Job entfällt (SV-09); abgebrochene oder ungültige Uploads räumen die Lebenszyklusregeln (`imports/` 7 Tage).
- Kein öffentlicher Bucket-Zugriff; `web`-Bucket nur via OAC.
- Presigned URLs zeigen auf `https://svenesis-nina-pm-data.s3.eu-central-1.amazonaws.com` → dieser Host steht in der CSP (`img-src`, `connect-src`, 15) und in der CORS-Konfiguration des Daten-Buckets: `AllowedOrigins: ["https://nina-pm.svenesis.org"]`, `AllowedMethods: ["GET","POST"]`, `AllowedHeaders: ["content-type"]`, `ExposeHeaders: ["ETag"]`, `MaxAge: 300`. **`POST`, nicht `PUT`** – seit SEC-23 laufen alle Uploads als presigned POST; mit `PUT` lehnt der Browser sie ab, und der naheliegende Schnellschuss wäre `*`, womit eine fremde Seite eine abgefangene presigned URL benutzen und die Antwort auslesen könnte (SEC-58).

---

## 13. Hintergrund-Jobs

Eine Lambda **`worker`** mit Dispatcher. Vier Zeitpläne (EventBridge Scheduler, UTC) rufen sie mit `{tick}` auf; ereignisgetriebene Arbeit kommt über die Tabelle `job` (7.4). Alle Aufgaben sind idempotent, arbeiten in Stapeln ≤ 2.500 Zeilen je Transaktion und schreiben Logs/Metriken mit `task`.

| Zeitplan | Aufgaben | Anforderungen |
|---|---|---|
| `tick-5min` | liegengebliebene Jobs übernehmen (7.4) · Exoplaneten-Fristen (Einreichungen verfallen lassen, Beobachtung → `cancelled`; Frist-Hinweise) · `transit_observation` `locked` nach Fensterende → `observed`/`missed` · Rig-Leases in `rig_lease` ablaufen lassen (außer `offline_until` in der Zukunft; abgelaufener Offline-Modus > 14 Tage wird beendet) · **verwaiste Sessions** → `stale` (laufend ohne Heartbeat > 10 min bei `offline_since IS NULL`; bzw. nicht beendet 2 h nach `session.session_end_utc` = `sessionEndUtc` der letzten Planrevision, NT-09; Zeitschwellen FK 8.1, Spalten DAT5-3) · fällige `session_close`/`session_report` starten, wenn `outbox_pending = 0` oder `ended_at + 6 h` erreicht ist + Job `session_close` + Alarm `session.no_heartbeat` · Metrik `StaleRunningSessions` · liegengebliebene Discord-Zustellungen (`discord_post`) · Job **`weather`** je Standort aktiver Mandanten → `weather_cache`, **je Ort höchstens alle 15 min** (drei HTTP-Aufrufe je Standort und Lauf, WS-13; Einzelheiten unten; Spec-Ergänzung 29.09.2026, Entscheidung Sven: bisher stündlich aus `tick-hourly`). *(Ablauf-Jobs für befristete Admins, Owner-Übertragungen und NINA-Tokens gibt es nicht mehr, E2/SV-08.)* | FA-FRG-09, FA-EXO-21, FA-RIG-06, FA-SYN-07, FA-AUS-05, FA-FRG-11, FA-DIS-05 |
| `tick-hourly` | fehlende Vorschaubilder → Jobs `thumbnail` · **standortbezogene Nachtaufgaben (NT-08)** einmal je `(site, night)` nach dem lokalen Mittag des Standorts, idempotent über `dedupe_key` `<task>:<siteId>:<night>`, „ab heute“ = `currentNight`: Zähler-Abgleich aus `capture`/`correction` inkl. Suche nach verwaisten Zeilen (überspringt Rigs mit laufender Session) · Mehrnacht-Prognose je Rig (**14 Nächte** – unabhängig vom Wetterhorizont; die Wetterbewertung reicht nur über die **7** Vorhersagetage, darüber hinaus trägt die Klarnacht-Quote des Standorts, FA-AUS-17/FA-FOL-02/03) → `night_plan(origin='forecast_job')` – **idempotent**: der Job löscht zuerst die Prognosezeilen des Rigs (`origin='forecast_job'`) und schreibt sie dann neu, sonst verdoppelt jede Wiederaufnahme (7.4, bis 3 Versuche) 14 Zeilen je Rig · Aufwand-Jobs für eingereichte und aktive Projekte des Standorts (`effort_stale` oder älter als 7 Tage, höchstens 200 je Tag) | FA-WET-07, FA-AUS-17, FA-PRJ-02, NFA-07, 6.6, FA-FOL-01…05, FA-PRJ-23 |
| `daily` 03:00 | Aufräumen (abgelaufene Einladungen, alte Jobs > 30 Tage, `night_plan(origin='forecast_job')` > 7 Tage) · ExoClock-Katalog. Zähler-Abgleich, Mehrnacht-Prognose und Aufwand laufen seit NT-08 standortbezogen aus `tick-hourly` – ein fester UTC-Zeitpunkt trifft je Standort eine andere Nachtphase (03:00 UTC ist in Texas 22:00 CDT, mitten in der Nacht) | NFA-07, FA-EXO-02/04 |
| `weekly` So 04:30 | NASA Exoplanet Archive (TAP, `pscomppars`) und TESS TOI als Datei-Download, Amateur-Vorfilter, **Zeitsystem je Epoche normalisieren** (`transit.md` §1), Upsert in Stapeln · alte SPA-Build-Präfixe in `assets/` löschen (letzte 3 behalten, DAT-4): der **aktuelle** `buildId` steht im SSM-Parameter `/nina-pm/web/build-id` (beim Deploy von `NinaPm-Edge` geschrieben); der Job liest ihn, ermittelt über `ListObjectsV2` mit Delimiter `/` alle `assets/<buildId>/`-Präfixe, sortiert sie nach dem jüngsten `LastModified` und behält den aktuellen plus die zwei jüngsten übrigen (DAT5-6). Ohne lesbaren Parameter bricht der Job ab, ohne zu löschen | FA-EXO-02/31, NFA-07 |
| manuell | Objektkatalog aus `packages/catalog-data` → `dso_object` und Exoplaneten-Kataloge jederzeit neu laden (`POST /system/v1/catalogs/{catalog}/refresh`, `catalog` ∈ `dso`/`exoclock`/`nasa`/`toi`; Job `catalog_refresh` mit `input.catalog`, `dedupe_key` `catalog_refresh:<catalog>`; Spec-Ergänzung AP-40) | FA-FRM-01, FA-EXO-04 |

- **Job `weather` (WS-13/WS-16):** Je Standort und Lauf **drei** Aufrufe in einem `Promise.all` – (1) Hauptmodell (`api.open-meteo.com/v1/dwd-icon` in Europa, sonst `/v1/gfs`), (2) `air-quality-api.open-meteo.com/v1/air-quality`, (3) Modellvergleich `api.open-meteo.com/v1/forecast&models=…`. Nur Aufruf (1) ist **Pflicht**: schlägt er fehl, endet der Job ohne Schreiben und der letzte Stand im Cache bleibt gültig. Aufruf (2) darf ausfallen (`aod = null`, `aerosolMissing = true` für alle Stunden, WS-E2), Aufruf (3) ebenfalls (`pwvMm = null`, keine Vergleichszeilen, kein Nest). Variablenlisten und Parameter in 14.
  - **Budget und Rate-Limit (Spec-Ergänzung 29.09.2026, Entscheidung Sven):** ein Lauf je Standort **höchstens alle 15 min** aus `tick-5min` (Prüfung gegen den Zeitstempel der Cache-Zeile mit 14 min Mindestabstand, deshalb ist ein wiederaufgenommener Job ein No-op). Grund: HRRR (Nordamerika) rechnet stündlich neu, ein neuer Lauf ist so nach höchstens 15 statt 60 min sichtbar; bei ICON-D2, GFS, ECMWF und CAMS bringt der kürzere Takt kaum etwas. Die Aufrufe eines Laufs zählen als **drei** gegen das Open-Meteo-Kontingent, also `12 × Standorte` je Stunde. Zeitlimit 10 s je Aufruf, 2 Wiederholungen exponentiell (gemeinsamer `httpClient`, 14); `429`/`5xx` des Hauptaufrufs beenden den Lauf **ohne** Wiederholung innerhalb derselben Viertelstunde. Die Standorte eines Laufs werden der Reihe nach abgearbeitet, damit nicht alle Aufrufe gleichzeitig starten; nach **3 min** Laufzeit startet kein neuer Ort mehr, damit der Lauf vor dem nächsten Tick endet. Der Job ist idempotent über `dedupe_key` `weather:<siteId>:<Viertelstunde>` (`YYYY-MM-DDTHH:MM`, UTC).
  - **`weather_cache.model_set`** ist der Schlüssel, mit dem eine Zeile ihre Modellkette ausweist; er gehört zum Cache-Schlüssel, damit ein Ketten-Wechsel nicht stillschweigend alte Zahlen weiterbenutzt. Beispiele: **`icon-d2+harmonie+icon+ecmwf+gem+cams`** (Europa) und **`hrrr+gem+gfs+ecmwf+nbm+cams`** (Nordamerika); fällt der Aerosol-Abruf aus, entfällt `+cams`. Struktur der Tabelle bleibt unverändert (`payload jsonb`, **keine neuen Spalten**); der Aufbau von `payload` ist in `specs/engine/weather.md` §3.4 benannt: je Stunde die Rohwerte (WS-11), die abgeleiteten `jetKmh`, `shearKmh` und **`moonAltDeg`**, die Herkunft `modelId`, `cloudSrc`, `nest`, `aerosolMissing` und **`seeingIncomplete`**, dazu `cloudScore`, `seeingScore`, `transparencyScore`, `overallScore` und **`ratingIndex`**; je Nacht `night`, `nightMean`, `coveredSec`, **`darknessSec`**, `coverage`, das beste Fenster und dieselben beiden Kennzeichen. Die Scores stehen **ungerundet** im `payload` (WS-08).
- **Grenzen für benutzerausgelöste Jobs (verbindlich, SV-06):** `multi_sim` und `impact` werden von jedem angemeldeten User ausgelöst (FK 6.14) und laufen in der `worker`-Lambda mit reservierter Parallelität 5. Deshalb: `nights ≤ 14` im zod-Schema · Deduplizierung über `dedupe_active` (7.4) · höchstens **3** offene Jobs je Mitglied über alle benutzerausgelösten Arten, sonst `429 auth.rate_limited` · der Dispatcher bevorzugt Jobs aus den Zeitplänen vor benutzerausgelösten (eigener Vorrang je `kind`). Eine Quote je Mandant gibt es nicht.
- **Ereignisgetrieben statt Abfrage:** Das `PATCH` mit `status: completed` legt die Jobs `session_close`, `session_report` und `effort` an, sie laufen aber **erst** bei `outbox_pending = 0` oder 6 h nach `ended_at` (NIN5-7); bis dahin bleiben sie `pending` und `tick-5min` prüft die Bedingung. **Ausnahme `session_report`:** Er ist vom 6-h-Tor ausgenommen und wird frühestens bei `max(ended_at, darknessEndUtc ?? sessionEndUtc)` der letzten Planrevision und spätestens `tick-5min` nach `report_due_at` (= `sessionEndUtc` der letzten Planrevision + 2 h, gespeichert als `session.session_end_utc`; FA-AUS-21, NT-09) mit dem damaligen Stand und dem Vermerk „vorläufig“ gesendet – sonst könnte die Frist gerade in dem Fall nie eingehalten werden, für den sie gedacht ist (nicht leere Outbox). Spätere Meldungen lösen eine Nachrechnung und eine aktualisierte Fassung aus.
- **Fehlerbehandlung:** `EventInvokeConfig` der `worker`-Lambda mit 0 Wiederholungen und `onFailure` → SQS `worker-failures`; Alarm auf Lambda-`Errors` und Nachrichten in `worker-failures` (16.2). Kataloge behalten bei Abruffehlern den letzten Stand; Alarm erst nach 3 fehlgeschlagenen Tagen. Exoplaneten-Kataloge (AP-40) ersetzen den Stand außerdem nicht, wenn die Antwort weniger als 80 % der gespeicherten Zeilen liefert oder mehr als 1 % der CSV-Zeilen unvollständig sind (abgeschnittener Download); der Job endet dann mit `catalog.source_failed`, sichtbar in S-82. Der Vorfilter (FA-EXO-31) steht in `system_setting.exoPrefilter` (Vorgabe ≤ 14 mag, ≥ 3 mmag, Dec −90…90°).

---

## 14. Externe Dienste

| Dienst | Nutzung | Aufruf | Cache / Limit | Hinweis |
|---|---|---|---|---|
| Discord OAuth2 / API | Anmeldung, Benutzerdaten; ausgehende Webhooks je Mandanten-Kanal (7.7) und System-Alarm-Webhook | `discord.com/oauth2/authorize`, `/api/oauth2/token`, `/api/users/@me` | Rate-Limit-Header beachten | Datenschutzhinweis; Ausfall → FA-LOG-09 |
| Open-Meteo Wetter-API – **Abruf 1 von 3: Hauptmodell** | Seamless-Reihe je Standort: `api.open-meteo.com/v1/dwd-icon` innerhalb Europas (Rechteck `lat 29,5…70,5`, `lon −23,5…62,5`), sonst `api.open-meteo.com/v1/gfs` (Open-Meteo füllt darin über Nordamerika HRRR) | serverseitig (Job `weather`, 13) | 15 min je Standort (seit 29.09.2026, vorher 60 min) | **Pflichtabruf.** Parameter: `latitude`, `longitude`, `forecast_days=7`, **`past_days=1`** (damit eine schon laufende Nacht vollständig ist – ohne das beginnt die Reihe erst zur aktuellen Stunde und das Nacht-Mittel ruht auf den Reststunden), `timeformat=unixtime`, **`wind_speed_unit=kmh`**, **`timezone=UTC`** – nie `timezone=auto` (AST-D25; die Website nutzt `auto`, NINA-PM bewusst nicht: die Nacht- und Stundenzuordnung liegt in der Zeitzonentabelle des Servers). `hourly` = `cloud_cover`, `cloud_cover_low`, `cloud_cover_mid`, `cloud_cover_high`, `temperature_2m`, `dew_point_2m`, `relative_humidity_2m`, `wind_speed_10m`, `wind_gusts_10m`, `wind_direction_10m`, `wind_speed_250hPa`, `wind_direction_250hPa`, `wind_speed_500hPa`, `wind_direction_500hPa`, `wind_speed_700hPa`, `wind_direction_700hPa`, `wind_speed_850hPa`, `wind_direction_850hPa`, `surface_pressure`, `visibility`, `precipitation`, `precipitation_probability`, `weather_code` (WS-11/WS-13). **Ausfall:** der Lauf endet ohne Schreiben, der letzte Cache-Stand bleibt gültig |
| Open-Meteo **Air-Quality-API** – **Abruf 2 von 3** (eigener Endpunkt `air-quality-api.open-meteo.com/v1/air-quality`) | CAMS: `aerosol_optical_depth` (dimensionslos, 550 nm) für die Transparenz und `dust` (µg/m³, nur Anzeige) | serverseitig (Job `weather`) | 15 min je Standort (seit 29.09.2026, vorher 60 min); **eigener Horizont**: CAMS Europa 4 Tage, global 5 Tage – kürzer als die 7 Tage der Wettermodelle (`forecast_days=7`, Abruf 1) | Gleiche Parameter wie Abruf 1 (`past_days=1`, `forecast_days=7`, `timeformat=unixtime`, `timezone=UTC`), `hourly=aerosol_optical_depth,dust`. **Ausfall oder Horizontende (ab Tag 5):** `aod = null` und **`aerosolMissing = true`** für die betroffenen Stunden → `transparencyScore = null`, `overallScore` verteilt das Gewicht um (WS-E2, 8.2). Es gibt **keinen** aerosolfreien Schätzzweig mehr; die Stunde bzw. Nacht trägt in UI, Nachtübersicht und Mehrnacht-Prognose das Kennzeichen *ohne Aerosol – Bewertung optimistisch*. `weather_cache.model_set` führt die Aerosolquelle als `+cams` mit (AST-D23, WS-16). Lizenz CC BY 4.0; kommerzielle Nutzung erfordert API-Plan (→ OT-05) |
| Open-Meteo Wetter-API – **Abruf 3 von 3: Modellvergleich** (`api.open-meteo.com/v1/forecast` mit `&models=…`) | Zweitmeinung und Nest-Erkennung: `ecmwf_ifs`, das feine Modell (`dmi_harmonie_arome_europe` in Europa, sonst `cmc_gem_seamless`), ein drittes (Europa `cmc_gem_seamless`, sonst `ncep_nbm_conus`) und das Nest-Modell (Europa `icon_d2`, sonst `ncep_hrrr_conus` plus `ncep_nbm_conus`) | serverseitig (Job `weather`) | 15 min je Standort (seit 29.09.2026, vorher 60 min) | Gleiche Parameter wie Abruf 1; `hourly` = `cloud_cover`, `cloud_cover_low`, `cloud_cover_mid`, `cloud_cover_high`, `total_column_integrated_water_vapour` (→ `pwvMm`), `temperature_2m`, `visibility`, `precipitation_probability`. Feldnamen tragen je Modell ein Suffix; **Suffix-Vorrang: suffigiertes Feld vor einfachem Feld** (`suffixed` oder-sonst `plain`, WS-13). Daraus entstehen `nest`, `cloudSrc`, `modelId` und der neu abgeleitete `weatherCode` (WS-14/WS-15). **Ausfall erlaubt:** `pwvMm = null`, **keine Vergleichszeilen**, keine Nest-Stunden – die Bewertung läuft allein auf dem Hauptmodell weiter |
| CDS HiPS | Himmelsfotos in der Sternkarte | direkt aus dem Browser, erst beim Zoomen, mit Hinweis und Abschalter (11.3) | Browser-Cache | Datenschutzhinweis (IP an CDS) |
| CDS hips2fits | Vorschaubilder, Sternfeld Exoplaneten | serverseitig (Job) | S3 | – |
| SIMBAD (TAP/Sesame) | Namensauflösung unbekannter Objekte | serverseitig | Ergebnis in `dso_object` übernehmen | – |
| ExoClock | Katalog | serverseitig (Job) | DB | Nutzungsbedingungen prüfen (OP-13) |
| NASA Exoplanet Archive (TAP) | Katalog | serverseitig (Job) | DB | – |
| ExoFOP (TOI) | Katalog/Links | serverseitig (Job) | DB | – |

Alle ausgehenden Aufrufe über einen gemeinsamen `httpClient` mit Timeout je Quelle (Standard 10 s; NASA TAP 120 s; ExoClock und hips2fits 60 s), Retry (2×, exponentiell), User-Agent `Svenesis-NINA-PM/<version> (+https://nina-pm.svenesis.org)`.

---

## 15. Sicherheit

**Leitlinie (Sicherheits-Vereinfachung 21.09.2026, SV-01…SV-19, E1–E4):**

1. Angreifer **von außen** (über API, Web, Plugin-Schnittstelle) bekommen keinen Zugriff auf die Anwendung, ihre Daten oder AWS-Ressourcen. Dafür sorgen saubere Anmeldung, serverseitige Rechteprüfung je Route, Mandantentrennung, Eingabevalidierung, Web-Header gegen XSS und Clickjacking, CSRF-Schutz, gehashte Plugin-Tokens, Drosselung am API Gateway und je Lambda eine Ausführungsrolle **nur mit den Rechten, die sie braucht** – das begrenzt den Schaden, falls eine öffentlich erreichbare Lambda kompromittiert wird.
2. Das **Deployment ist nicht Teil der Sicherheitsarchitektur:** Sven deployt lokal per AWS-CLI/CDK mit Admin-Profil (18). Es gibt keinen Schutz gegen Insider mit AWS-Zugang, keine Deploy-Härtung und keine manipulationssicheren Audit-Spuren.
3. Innerhalb der Anwendung gilt **Schutz gegen Versehen**, nicht gegen böswillige Mitglieder (15.2).

### 15.1 Bedrohung von außen → Maßnahme

| Bedrohung von außen | Maßnahme |
|---|---|
| Mitlesen oder Verändern im Transport | nur HTTPS (TLS 1.2+), HSTS 2 Jahre mit `includeSubDomains` über die Response-Headers-Policies |
| Fremde Anmeldung, Übernahme einer Sitzung | Discord-OAuth mit `state` **und PKCE (S256)** im signierten Zwischen-Cookie, `next` nur als relativer Pfad, Discord-Token wird nicht gespeichert (5.2, SV-02) · Sitzungs-ID mit 256 Bit, in der DB nur als SHA-256, Cookie `__Host-npm_sid` HttpOnly/Secure/SameSite=Lax, Ablauf 14 Tage Inaktivität bzw. 30 Tage, Abmelden und Widerruf wirken sofort (5.3, SV-01) · Owner- und Admin-Rechte sowie der System-Kontext nur mit Discord-2FA (SV-03) |
| Zugriff auf fremde Daten, Rechteausweitung über die API | `can()` serverseitig vor jedem Handler, jede Route mit deklarierter Aktion, generierte Rechte-Tests (5.5, 17) · Mandanten-Guard im Repository, Lint-Regel, Isolationstests (6.7) · NINA-Token nur für das eigene Rig, Rig-Filter je Pfadparameter mit `404` (5.6, SEC-53) · Dateien nur über Zweck und Objekt-ID, Schlüssel immer serverseitig (12) |
| XSS, Clickjacking | CSP der Anwendung (`npm-html`): `default-src 'self'`; `script-src 'self'` (kein `'unsafe-inline'` für Skripte); `style-src 'self' 'unsafe-inline'` (Pflicht für Radix UI, SEC-2); `img-src 'self' data:` + CDS, Discord-CDN und Daten-Bucket; `connect-src 'self'` + CDS und Daten-Bucket; `worker-src 'self' blob:`; `font-src 'self'`; `object-src 'none'`; `base-uri 'none'`; `form-action 'self'` (SEC-25); `frame-src 'none'`; `frame-ancestors 'none'`; `upgrade-insecure-requests`; dazu `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` · harte CSP `npm-api-static` auf `/api/*`, `/catalog/*`, `/downloads/*` (4.3, SV-16) · Markdown nur über `react-markdown` ohne rohes HTML, kein `dangerouslySetInnerHTML` (11.1, SV-05) · Abnahme: Playwright-Test öffnet Radix-Menü und -Dialog hinter den produktiven Headern und prüft die Konsole auf CSP-Verstöße |
| CSRF | `SameSite=Lax` + Pflicht-Header `X-NPM-Request: 1` auf jeder nicht-GET-Methode unter `/api/auth`, `/api/web/v1`, `/api/system/v1` – auch anonymen wie `POST /auth/invitation/claim` und `/auth/invitations/preview` (`403 auth.csrf_missing`); ausgenommen nur `/api/nina/v1`; keine CORS-Freigabe der API (5.3, SV-04) |
| Gestohlenes oder mitgelesenes Plugin-Token | 256 Bit, nur SHA-256 + Präfix gespeichert, einmal angezeigt, an ein Rig gebunden, jederzeit widerrufbar mit sofortiger Wirkung, im Plugin per DPAPI abgelegt, nie geloggt (5.6, SV-08) |
| Manipulierte Eingaben und Dateien | zod für jede Anfrage, Body ≤ 1 MB, Pakete ≤ 500 Aufnahmen bzw. ≤ 200 Ereignisse (7.3) · Uploads nur per presigned POST mit `content-length-range` und `eq $key`, CORS des Daten-Buckets nur für den eigenen Origin · Importe mit `JSON.parse` + zod-Grenzen (7.1, 12, SV-09) |
| SSRF und Spam über Discord-Webhooks | Webhook-URL nur mit Host `discord.com`/`discordapp.com`, nie ausgeliefert, `allowed_mentions: {parse: []}` (7.7, SV-10) |
| Direktaufrufe und Last | Zugriff nur über CloudFront (`X-Origin-Verify`, ein Wert, SV-16) · Drosselung am API Gateway global und je Route – 5 rps/Burst 10 auf `GET /api/auth/discord/{proxy+}`, den Einladungsrouten und `GET /api/health`, die übrigen Auth-Routen unter der Stage-Drosselung (4.2, SV-06) · reservierte Parallelität `api` 20/`worker` 5 · Budget- und `Throttles`-Alarme (16.2) · **kein WAF** (Entscheidung 17.09.2026) |
| Kompromittierte öffentlich erreichbare Lambda | eine Ausführungsrolle je Lambda über CDK-Grants (SV-13): `api` → `dsql:DbConnect`, Objektzugriff (lesen/schreiben) im Daten-Bucket nur `tenant/*` (`s3:List*` gilt durch die Grants für den ganzen Bucket, 15.3), `api` ruft nur `worker` auf, SSM-Lesen nur `/nina-pm/oauth/*`, `/nina-pm/discord/*`, `/nina-pm/origin-verify`, `/nina-pm/web/*`, `/nina-pm/dsql-endpoint`, `/nina-pm/bootstrap-super-users` · `worker` → `dsql:DbConnect`, Daten-Bucket `tenant/*`, Web-Bucket `catalog/thumbs/*` und `assets/*`, SSM **ohne** OAuth-Secret, Discord-Client-Secret und Super-User-Liste · `migrate` → `dsql:DbConnectAdmin` · `ops-cli` → `dsql:DbConnect`, von keiner Lambda aufrufbar · keine `*`-Ressourcen auf DSQL, S3, SSM, Lambda-Invoke, keine Managed Policies außer `AWSLambdaBasicExecutionRole` (X-Ray per `tracing: ACTIVE` erlaubt) · getrennte DB-Rollen `app_rw`/`app_job`, `worker` erreicht weder `auth_session` noch `nina_instance` (6.2, SV-14) · CDK-Assertions (18) |
| Abfluss von Geheimnissen | SSM SecureString mit Standardschlüssel `alias/aws/ssm`, pfadgenaues Lesen je Rolle; keine Geheimnisse im Frontend-Bundle; keine Tokens, Cookies oder Webhook-URLs in Logs, IP gekürzt, Discord-ID als Pseudonym |
| Verwundbare Abhängigkeiten | Renovate, `pnpm audit` in CI, `dotnet list package --vulnerable` für das Plugin |
| Altlast Astro PM | Import (OP-20) übernimmt **keine** `RemoteConnections.Password`, Lizenz- oder Sync-Tokens |

### 15.2 Schutz gegen Versehen

Innerhalb eines Mandanten schützt die Anwendung vor Fehlbedienung, nicht vor böswilligen Mitgliedern: Rechte je Rolle **Owner, Admin, User** (nur der Owner verwaltet Admins, der Owner ist gegen Herabstufen, Deaktivieren, Entfernen und Austreten geschützt, niemand ändert die eigene Rolle, 5.5, E2) · User bearbeiten nur eigene Objekte in den dafür vorgesehenen Status · **Vier-Augen-Regel:** ein Admin gibt eigene Objekte nicht frei (`approval.own_object`, FA-FRG-10, SV-12) · **`ConfirmDialog`** vor Löschen, Rechte entziehen, Owner übertragen, Ablehnen, Token widerrufen und Sitzungen beenden; Namenseingabe nur beim Löschen eines Mandanten (11.2, E4) · **Papierkorb** für Projekte ohne automatisches Endlöschen (6.6, E4) · Stammdaten mit Verwendern sind gesperrt (`409 resource.in_use`) · gleichzeitige Bearbeitung endet mit `412` statt stillem Überschreiben (7.1) · einfaches Änderungsprotokoll (`change_log`, `approval_event`, `system_audit`, SV-11) · Löschschutz und `RETAIN` am DSQL-Cluster und Daten-Bucket, tägliche Sicherung mit 35 Tagen Aufbewahrung (6.10, SV-15) · Test-Login nur im lokalen Prozess (17).

### 15.3 Bewusst nicht vorgesehen

- Schutz gegen Insider mit AWS-Zugang und gegen böswillige Owner/Admins im eigenen Mandanten.
- Deploy-Härtung: keine Permissions Boundary, keine OIDC-Rollen für GitHub, kein MFA-geschützter Aufrufpfad für `ops-cli`, keine IAM-Diffs als Go-live-Artefakt, kein cdk-nag (E1, SV-13).
- Manipulationssichere Audit-Spuren: kein eigener CloudTrail-Trail mit Metrikfiltern, kein geschützter Backup-Vault, `system_audit` ist eine gewöhnliche Tabelle; die kostenlose CloudTrail-Ereignishistorie (90 Tage) genügt für Rückfragen (SV-11, SV-15).
- Kundenverwalteter KMS-Schlüssel, Schlüsselrotation für Cookies oder Origin-Verify (ein Wechsel ist ein neuer Wert plus Deploy, SV-02/SV-16).
- Anwendungsseitige Drosselung und Fehlversuchszählung (Sitzungs-IDs und Tokens mit 256 Bit sind nicht erratbar; das Gateway begrenzt die Last, SV-06); ein Anmeldeprotokoll (SV-11).
- Ablaufdaten für Plugin-Tokens, befristete Admin-Rechte, Annahmefristen bei der Owner-Übertragung (SV-08, E2).
- Sonderregeln gegen den Super User im Mandanten über `can()` hinaus (E3).
- AWS WAF (Entscheidung 17.09.2026). Verfügbarkeit gegen gezielte Überlast von außen ist nicht geschützt (kein WAF, keine Drossel je IP) – bewusst hingenommen.
- Auflisten im Daten-Bucket: `grantRead`/`grantReadWrite` bringen `s3:List*` auf den **ganzen** Daten-Bucket. Nach einer Kompromittierung von `api` oder `worker` sind die Objektschlüssel aller Mandanten auflistbar – bewusst hingenommen, weil `app_rw` die Schlüssel ohnehin aus der Datenbank kennt und der Objektzugriff (lesen/schreiben) auf `tenant/*` begrenzt ist.
- Laufende Aktualisierung der 2FA: `identity.mfa_enabled` wird nur bei der Discord-Anmeldung aktualisiert. Schaltet jemand 2FA bei Discord ab, wirken Owner- und Admin-Rechte bis zum Ende der Sitzung (höchstens 30 Tage) weiter – hingenommen.

---

## 16. Betrieb, Monitoring und Kosten

### 16.1 Logging und Tracing

- Powertools Logger (JSON) mit `requestId`, `tenantId`, `memberId`/`ninaInstanceId`, `route`, `durationMs`.
- Powertools Metrics mit wenigen Dimensionen (keine Mandanten-/Routen-Dimension, Kosten): `ApiErrors`, `CapturesIngested`, `CaptureDuplicates`, `DsqlRetries`, `JobDurationMs`, `JobFailures`, `StaleRunningSessions`, `ReportFailures`. Details stehen in den strukturierten Logs (Logs Insights).
- X-Ray mit Sampling 5 %; lokal nicht benötigt.
- **Log-Aufbewahrung (SV-15):** **90 Tage** für alle Log-Gruppen (`api`, `worker`, `migrate`, `ops-cli`, Zugriffsprotokoll der HTTP API); Verschlüsselung mit dem Standard von CloudWatch Logs, kein eigener KMS-Schlüssel.
- **Kein eigener CloudTrail-Trail (SV-15):** Trail, Zustellrolle, Log-Gruppe, Bucket-Präfix `audit/` und die zugehörigen Metrikfilter und Alarme entfallen; für Rückfragen genügt die kostenlose CloudTrail-Ereignishistorie der letzten 90 Tage. **Zugriffsprotokoll der HTTP API** im JSON-Format (`requestId`, `routeKey`, `status`, `integrationLatency`, gekürzte IP) bleibt – ohne es lässt sich ein Direktaufruf der `execute-api`-Adresse nicht messen.

### 16.2 Alarme (SNS → E-Mail)

| Alarm | Schwelle |
|---|---|
| API 5xx | > 1 % in 5 min |
| Lambda-Fehler `api` auf `/api/nina/v1` (Log-Metrik) | ≥ 3 in 10 min (nachts kritisch) |
| `worker`-Fehler bzw. Nachrichten in `worker-failures` | > 0 |
| Laufende Session ohne Heartbeat > 10 min bei `session.offline_since IS NULL` (`StaleRunningSessions`, Spalte DAT5-3) | > 0 (Pflicht) |
| Route-53-Health-Check `/api/health` (über CloudFront) | 3 Fehlschläge in Folge |
| DSQL-Wiederholungen | > 20 in 5 min |
| DSQL-Verbrauch (DPU-Metrik des Clusters) | über Monatsschwelle (Wert nach 4 Wochen Betrieb festlegen) |
| AWS Backup: `NumberOfBackupJobsFailed` | > 0 (SV-15) |
| Lambda `Throttles` auf `api` (reservierte Parallelität erschöpft) | > 10 in 5 min (SEC-15) |
| Aufrufzahl der HTTP-API-Stage (`Count`) | > 100.000 in 5 min (Missbrauch/Kosten, Wert wie `iam.md`) |
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
| AWS Backup (DSQL) | < 1 |
| **Summe** | **ca. 3 – 12 €** |

Preise für eu-central-1 vor Go-live im AWS Pricing Calculator verifizieren (OT-01).

---

## 17. Teststrategie

| Ebene | Werkzeug | Inhalt | Wann |
|---|---|---|---|
| Engine-Unit | Vitest | Funktionen je Modul, Grenzfälle (Polarnacht, Mitternachtssonne, Zeitumstellung, Mond um Vollmond); Nächte `America/Chicago` 2026-10-31 (25 h, 17:00Z → 18:00Z) und 2026-03-07 (23 h, 18:00Z → 17:00Z) nach `night.md`; `currentNight` mit denselben Testvektoren in TS und C# (NT-01, NT-46) | jeder Commit |
| Engine-Referenz | Vitest + Fixtures (Kap. 9); CI-Job `reference` erzeugt die Fixtures mit gebündelten IERS-Daten neu und prüft auf Unverändertheit | Genauigkeit gegen astropy | jeder Commit (Vergleich) / PR mit Änderungen in `tools/reference` (Neuerzeugung) |
| Engine-Determinismus | Vitest + Jint-Test (xUnit) | gleicher `outputHash` Node ↔ Jint für feste und ≥ 500 zufällige Eingaben; Lint gegen `Math.*`-Trigonometrie, `Date`, `Intl` | jeder Commit / Plugin-Build |
| Engine-Vergleich Astro PM | `tools/astropm-oracle` (.NET 8) + Vitest (`oracle.yml`) | TS-Engine im Kompatibilitätsmodus (Schalter §11.1, Adapter §11.2) gegen C#-Original: gleiche `SlotAssignment` und Belichtungsfolge für alle Soll-Plan-Grids und ≥ 500 Zufallsgrids | PR mit Änderungen in `packages/engine`, nightly |
| Engine-Soll-Pläne | Vitest + `contracts/golden-plans/` | Produktivmodus: Paint-Fälle (AP-13b) und Ablauf-Fälle (**AP-13d**) exakt; Eigenschaftstests (keine unsichere Mondbelichtung, Blockende, Fairness nach Neuplanung) | jeder Commit |
| Engine-Benchmark | Vitest bench | Laufzeit-Regression | nightly |
| Repository | Vitest + PostgreSQL 16 (Docker, `repeatable read`) | CRUD, Zähler (inkl. Bonus verworfen, je Transit-Beobachtung), Idempotenz, Stapel-Löschen, 3.000-Zeilen-Zähler, `FOR UPDATE`-Wächter | jeder Commit |
| Mandantenisolation | Vitest | jede Repository-Methode mit fremdem Mandanten | jeder Commit |
| Berechtigungen | Vitest (generiert aus Routen-Metadaten) | Route × {Owner, Admin, User, fremder Mandant, anonym, Super User im System-Kontext} plus „Admin ohne 2FA“ (= User, SV-03); Owner-Invarianten und Owner-Übertragung (5.5); Sitzung: Logout, Widerruf und Rollenwechsel wirken ab der nächsten Anfrage, Ablauf nach 14/30 Tagen (5.3); CSRF-Header fehlt → `403 auth.csrf_missing` | jeder Commit |
| API-Vertrag | Schemathesis oder zod-basierte Contract-Tests gegen `openapi.yaml` | Antwortformate, Fehlercodes | jeder Commit |
| DSQL-Integration | Vitest gegen **kurzlebigen Test-DSQL-Cluster**, Skript `pnpm test:dsql` (`tools/deploy/test-dsql.ts`): **lokal auf Svens Rechner** mit Admin-Profil – Cluster per AWS SDK anlegen (Tag `purpose=ci`) → Migrationen inkl. 0000 → Tests → Cluster im `finally` löschen; Claude Code schreibt Skript und Tests, Sven führt aus und legt das Protokoll unter `docs/test-runs/` ab (H-22, E1). Derselbe Weg dient dem Spike AP-S1 | Migrationen inkl. GRANTs, OCC-Retry, `SELECT … FOR UPDATE`, `INSERT … ON CONFLICT`, IAM-Token | bei Änderungen in `packages/db` vor dem Merge, vor jedem prod-Deploy mit Migrationen |
| Frontend-Komponenten | Vitest + Testing Library | Formulare, Rechteanzeige, Diagrammberechnungen | jeder Commit |
| Barrierefreiheit | `vitest-axe` (Komponenten) und `@axe-core/playwright` (E2E), CI-Schritt **`pnpm test:a11y`** | jeder Bildschirm und jede wiederverwendbare Komponente ohne Verstöße der Stufen *serious* und *critical*; Tastaturpfad und Fokusreihenfolge. **Kein Lighthouse-Schwellwert** – nicht reproduzierbar in CI (CC5-9) | jeder Commit |
| E2E | Playwright gegen **lokalen Stack** (Vite + API im Node-Adapter + PostgreSQL 16, Test-Login) – lokal und im CI-Job | Kernabläufe AF-01 … AF-14; Browser-Zeitzone Europe/Berlin (Playwright `timezoneId`) mit Standort Chicago: Nacht-Schlüssel, „Heute Nacht“, Datumsfelder und Zeitanzeige mit Kürzel (NT-46); Abmelden in einem Tab wirkt im zweiten mit der nächsten Anfrage; `ConfirmDialog` und Papierkorb (Löschen → Wiederherstellen); Druckansicht Bericht | jeder PR auf `main` |
| Smoke prod | `tools/smoke`, Teil von `pnpm deploy:prod` | `/`, `/api/health` (`ENGINE_VERSION`), `/catalog/…` erreichbar, Auth-Redirect zu Discord, CSP-Header vorhanden; **DB-Erreichbarkeit** über eine angemeldete Route mit dem Test-Rig-Token (`GET /api/nina/v1/bootstrap`, SV-07) | jeder prod-Deploy |
| Abnahme prod | manuell im Test-Mandanten (4.4) | neue Funktionen mit echtem Discord-Login und NINA-Simulatorgeräten | nach Deploy |
| Fake-Plugin | `tools/fake-plugin` gegen lokalen Stack bzw. Test-Mandant | komplette Nacht: Bootstrap, Plan, Lease, Aufnahmen (inkl. doppelt, offline nachgemeldet, unzugeordnet), Ereignisse, Ende, Nachtbericht | jeder PR (lokal), nach Deploy (Test-Mandant) |
| Plugin-Kern | xUnit (`NinaPm.Core.Tests`; im CI Linux und Windows, lokal zusätzlich macOS) | FilterResolver (nur bestätigte Zuordnung, NT-E1), `currentNight` (Testvektoren, NT-01), `Coordinates` mit `Angle.ByDegree` (NT-28), BannedApiAnalyzers (NT-05), Outbox-Fehlerklassen, LocalStore, ReplanPolicy (a/b/c, Hysterese), LeaseStateMachine, Playback, FlatTracker (Fortsetzen), Bildzuordnung inkl. Timeout, EngineHost-Parität | jeder Commit mit Änderungen in `apps/nina-plugin` |
| Plugin-Adapter (Build) | `dotnet build` von `NinaPm.Nina`, `NinaPm.Nina.Tests` und `NinaPm.Nina.Ui` gegen die NuGet-Pakete `NINA.*`, danach `tools/nina-build-check.sh` – auf `ubuntu-latest` im CI und auf dem Entwicklungsrechner (10.5) | der Adapter übersetzt korrekt gegen die NINA-Assemblies; hält den windowsfreien Arbeitsablauf offen | jeder Commit mit Änderungen in `apps/nina-plugin` |
| Plugin-Adapter (Einheiten) | xUnit (`NinaPm.Nina.Tests`, NINA-Attrappen) – nur `windows-latest` | Trigger-Walk, Container mit einem Block je Aufruf, `blocked`-Warten, Koordinaten-Injektion | jeder Commit mit Änderungen in `apps/nina-plugin` |
| Plugin-Adapter (Laufzeit) | NINA-Simulator-Geräte + `tools/nina-test-server` (manuell nach `plugin-test-protocol.md`, P-01…P-24, Ergebnis `result.json` maschinell geprüft) | Trigger-Walk (Muster Astro PM), Flip-Erkennung, Transit mit Trigger-Filter und Abbruch, Neuplanung, Offline, Lease, Flats; ergänzt um NT-46: Safety-Unterbrechung/Wiederaufnahme, Mosaik-Panelwechsel am Meridian, Flip im Transitfenster mit AF/Recenter, globaler Dither-Trigger, Start um 16:00 MESZ (vor/nach lokalem Mittag), Online → Offline mit `nightPlanId`, Nachtende ohne Flats (Parkzeit ≤ `darknessEndUtc` + wenige min), Filterrad umgesteckt, Trained-Flat-Position geändert, Temperaturabweichung, gemischtes Binning bei Flats, Windows-Zone ≠ Standortzone, Uhrabweichung > 60 s; P-09 nach NT-14, P-22 (R1) ohne R5-Flats | Plugin-Release bzw. AP-Abnahme |

**Test-Login nur lokal:** Umgebungsvariable `AUTH_TEST_MODE=true` erlaubt `POST /auth/test-login {identityFixture}` ausschließlich im lokalen API-Prozess (`apps/api/src/local.ts`). Die Route wird im Lambda-Bundle nicht registriert (Build-Konstante), eine CDK-Assertion prüft, dass keine Lambda die Variable setzt (18), und ein Smoke-Test prüft `404` auf `/api/auth/test-login` in prod.

---

## 18. CI/CD und Deployment

**Grundsatz (E1, 21.09.2026):** GitHub hat **keinen AWS-Zugang** – kein OIDC-Provider, keine GitHub-Rollen in AWS, keine GitHub-Environments. GitHub Actions prüfen und bauen nur; deployt wird **lokal durch Sven** mit seinem Admin-Profil. **Claude Code deployt nie** und führt keine Skripte mit AWS-Zugang aus; es schreibt sie und bereitet PRs vor.

| Workflow | Auslöser | Schritte |
|---|---|---|
| `ci.yml` | Pull Request, Push `main` | pnpm install · Lint · Typecheck · Unit/Referenz/Isolation/Rechte-Tests · Integrationstests gegen **PostgreSQL 16 als Service-Container** · **`pnpm test:a11y` (axe, CC5-9)** · DSQL-Migration-Lint · OpenAPI-Diff · Web-Build · `cdk synth` (ohne AWS-Zugang; Lookup-Werte wie `HostedZone.fromLookup` aus dem eingecheckten `cdk.context.json`) + CDK-Assertions (unten) · Playwright E2E gegen lokalen Stack · kein Deploy |
| `plugin.yml` (Auftrag `build` auf `windows-latest`, `cross-build` auf `ubuntu-latest`) | Tag `plugin-v*` bzw. Änderungen in `apps/nina-plugin`, `packages/engine` oder `tools/nina-test-server` | **`build`:** Engine-Bundle bauen · `dotnet test` (`NinaPm.Core.Tests` inkl. Jint-Parität und `NinaPm.Nina.Tests`) · `dotnet publish` der vollständigen Lösung inkl. `NinaPm.Nina.Ui` · beim Tag: ZIP und Beispielsequenzen als **GitHub-Release-Asset** (nach S3 kommen die Beispielsequenzen mit dem nächsten lokalen Deploy, 4.1) · **`cross-build`:** `NinaPm.Core`, `NinaPm.Nina`, `NinaPm.Nina.Tests` und `NinaPm.Nina.Ui` gegen die NuGet-Pakete `NINA.*` bauen (ohne zusätzliche `-p:`-Schalter, `Directory.Build.props`/`.targets` genügen), `NinaPm.Core.Tests` ausführen und `tools/nina-build-check.sh` laufen lassen. Der Auftrag sichert die Entwicklung ohne Windows (10.5); bricht er, ist der lokale Arbeitsablauf kaputt (Spec-Ergänzung ADR-S2c, 28.09.2026: kein Auftrag `refs` mehr) |
| `oracle.yml` (`ubuntu-latest`, .NET 8 + Node) | PR mit Änderungen in `packages/engine`, nightly | Orakel bauen (Originalquellen des Astro-PM-Plugins, gepinnter Commit, Patch) · Grids erzeugen · Vergleich TS ↔ C# · Abweichungsbericht als Artefakt |
| `reference.yml` (`ubuntu-latest`, Python) | PR mit Änderungen in `tools/reference` · manuell | Fixtures mit astropy erzeugen (gepinnte Versionen, gebündelte IERS-Daten) · Diff zu eingecheckten Fixtures als Artefakt |
| `nightly.yml` | täglich | Engine-Benchmarks · Abhängigkeits-Audit |

**Lokale Skripte mit AWS-Zugang** (`tools/deploy/`, nur Sven, Admin-Profil):

| Skript | Ablauf |
|---|---|
| `pnpm deploy:prod` | Vorbedingung: CI auf dem Commit grün, Arbeitsbaum sauber, bei neuen Migrationen `pnpm test:dsql` grün · `cdk diff` anzeigen und bestätigen lassen · **bei neuen Migrationen:** On-Demand-Backup des DSQL-Clusters starten (`aws backup start-backup-job`) und auf `COMPLETED` warten · `cdk deploy --all` (Reihenfolge Data → Config → Migrate [Migration] → Api/Jobs → Web/Edge; `BucketDeployment`s für SPA und Beispielsequenzen) · Smoke-Test (17) · Fake-Plugin-Nacht im Test-Mandanten mit `TEST_RIG_TOKEN` aus der lokalen Umgebung (H-24; **Pflicht** – fehlt die Variable, bricht das Skript schon bei den Vorbedingungen ab, 25.09.2026) · bei Fehler Hinweis auf Rollback |
| `pnpm test:dsql` | kurzlebigen DSQL-Cluster anlegen (Tag `purpose=ci`, `eu-central-1`) · Migrationen · Repository-/OCC-Tests · Cluster im `finally` löschen (auch bei Fehler; ein verwaister Cluster ist damit ausgeschlossen, einen Aufräumjob gibt es nicht) · Protokoll nach `docs/test-runs/` (H-22). Mit `--spike` für AP-S1 |

**CDK-Assertions (SV-18), in `ci.yml`:** verbindlich ist die Liste in `specs/infra/iam.md` §12 Nr. 1–10; sie wird hier nicht wiederholt. cdk-nag wird nicht eingesetzt.

- **Eine Umgebung:** nur **prod** (`nina-pm.svenesis.org`) im AWS-Konto der Route-53-Zone `svenesis.org` (OT-04). Kein dev/Staging; Absicherung über lokale Tests, lokal ausgeführte DSQL-Tests, `cdk diff` vor jedem Deploy, Backup vor Migrationen und Test-Mandant (4.4).
- **Erst-Einrichtung:** Standard-`cdk bootstrap` mit Svens Admin-Profil (H-04), SSM-Parameter per CLI (H-05); kein eigener Bootstrap-Stack.
- **Rollback:** den vorherigen Tag auschecken und `pnpm deploy:prod` erneut ausführen (Code, SPA, Infrastruktur). Das Schema bleibt dank Expand/Contract kompatibel (6.10); Migrationen werden nie automatisch zurückgerollt. Datenfehler: Restore-Runbook (6.10).
- **Deploy-Zeitpunkt:** tagsüber, nicht während laufender Aufnahmenächte; das Plugin überbrückt kurze API-Ausfälle ohnehin per Cache/Outbox.
- Versionsnummern: Web/API und Plugin getrennt; beide enthalten `ENGINE_VERSION`. **Tags setzt nur Sven** (`v*`, `plugin-v*`); Claude Code bereitet CHANGELOG und Versionsnummern im PR vor. Workflow-Dateien ändert Claude Code über PRs (GitHub-Token mit Scope `workflow`, H-02).

---

## 19. Umsetzungsplan für Claude Code

Die Arbeitspakete sind im Umsetzungspaket **`claude-code/docs/work-packages/`** als einzelne Briefs beschrieben (Ziel, Anforderungen, exakte Leseabschnitte, Lieferumfang, Nicht im Umfang, Bildschirm-Checkliste, automatisierte Abnahme, menschliche Freigabe, Abhängigkeiten, Größe). Diese Übersicht ist daraus erzeugt; bei Abweichungen gilt der Brief. Den Status je Paket pflegt Sven in `work-packages/README.md`; der Einstieg in Sitzung 1 steht in `claude-code/START.md`.

- Reihenfolge innerhalb eines Releases ist verbindlich; ein Paket beginnt erst nach Abnahme seiner Abhängigkeiten und Erledigung der blockierenden menschlichen Aufgaben (`claude-code/docs/ops/human-tasks.md`, H-01…H-24; H-25…H-27 entfallen mit der Sicherheits-Vereinfachung). H-13 (Soll-Pläne) ist Merge-Bedingung von **AP-13b** (Paint) und **AP-13d** (Ablauf), keine Startsperre; H-16 blockiert nicht.
- Spikes (AP-S1, AP-S2a, AP-S2b) liefern Entscheidungen (ADR nach `docs/adr/ADR-TEMPLATE.md`), keinen Produktivcode. AP-S2b läuft zu Beginn des Plugin-Blocks RP (direkt vor R4) und prüft die NINA-Stellen ohne Vorbild; alle Plugin-Pakete brauchen Testläufe mit NINA-Simulatorgeräten und `tools/nina-test-server` (`plugin-test-protocol.md`, P-01…P-24 inkl. P-15b).
- Größen: S ≈ 1 Sitzung · M ≈ 1–2 · L ≈ 2–4 Sitzungen.
- Engine-Kette: AP-13a Orakel/Grid/CI → AP-13b Zuteilung + Paint-Soll-Pläne → AP-13c Ablauf/`planNight` → AP-13d Flip/Transit/Diagnose + Ablauf-Soll-Pläne → AP-13e Aufwand-Kennzeichen → AP-13f Simulator. Plugin-Kette: AP-16a … AP-16h.

### R1 – MVP Planung

| AP | Inhalt | Größe | Abhängig von | Mensch |
|---|---|---|---|---|
| AP-01 | Monorepo-Gerüst | M | – | H-02, H-03 |
| AP-02a | CDK-Grundgerüst: Data, Config, Cert, Web, Edge | M | AP-01 | H-01, H-04, H-06 |
| AP-S1 | Spike Aurora DSQL | S | AP-02a | H-01, H-22 |
| AP-02b | CDK: Api, Jobs, Ops (Lambdas, Rollen, Zeitpläne, Alarme) | M | AP-02a, AP-S1 | H-05, H-06, H-09 |
| AP-03 | Datenbankpaket und Migrationen | L | AP-02b | H-06, H-22 |
| AP-05 | Shared: Rechte, Fehler, Verträge, Middleware, Job-Infrastruktur | M | AP-03 | – |
| AP-04a | Anmeldung mit Discord und Sitzungen | L | AP-05 | H-05, H-07, H-08 |
| AP-04b | Mandanten, Einladungen, Owner-Invarianten | L | AP-04a | H-08, H-12a |
| AP-06a | Frontend-Shell, Gestaltung, Anmelde-Bildschirme | L | AP-04b | H-16 |
| AP-06b | Benachrichtigungen in der App und Startseite R1 | S | AP-06a | – |
| AP-07a | System-Administration (Super User) | M | AP-06a | – |
| AP-07b | Mitglieder, Einladungen, Admin-Rechte (Owner) | M | AP-07a | – |
| AP-07c | Mandanteneinstellungen, Owner-Übertragung, Protokolle | M | AP-07b | – |
| AP-08a | Engine-Grundlagen: Mathematik, kanonisches JSON, Hash | M | AP-01 | – |
| AP-08b | Engine: Zeit, Sonne, Mond, Koordinaten, Dämmerung (Port astro-core) | L | AP-08a | H-03 |
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
| AP-17 | Härtung und Go-live | L | AP-15, AP-07c | H-17, H-18, H-20, H-23 |

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

### RP – NINA-Plugin „Eine Nacht automatisch“ (direkt vor R4)

Entscheidung 23.09.2026: R1 geht ohne Plugin live; NINA-API (AP-14a–c) und Fake-Plugin bleiben in R1. RP liefert den Plugin-Umfang, den Fachkonzept und `specs/nina/execution.md` mit „R1“ kennzeichnen; H-14 wird erst hier gebraucht. Die Plugin-Nacht P-05 ist Abnahme von AP-16h.

| AP | Inhalt | Größe | Abhängig von | Mensch |
|---|---|---|---|---|
| AP-S2b | Spike NINA-Laufzeit: Stellen ohne Vorbild prüfen (Mensch + Agent) | S | AP-01 | H-14, H-15 |
| AP-S2c | Spike Build: Adapter ohne Windows bauen (Mensch + Agent) | S | AP-01 | H-14 |
| AP-08c | Engine-Bundle und Jint-Parität | S | AP-08b, AP-S2c | – |
| AP-S2a | Spike Jint-Laufzeit | S | AP-08c | – |
| AP-16a | Plugin: Lösung, Core, Kopplung, NINA-Test-Server | M | AP-S2b, AP-S2c, AP-08c, AP-14a | H-14, H-15 |
| AP-16b | Plugin Core: Planung, Neuplanung, Offline-Plan | M | AP-16a, AP-S2a, AP-13d | H-15 |
| AP-16c | Plugin Adapter: Container, interne Items, Blockablauf | L | AP-16b, AP-14b | H-14, H-15 |
| AP-16d | Plugin Adapter: Trigger-Walk, Filter und Auslesemodus, Neuplanung im Block | M | AP-16c | H-15 |
| AP-16e | Plugin: Aufnahme-Zuordnung, Heartbeat, Lease | M | AP-16d | H-15 |
| AP-16f | Plugin: Rotator, Flip, Standort- und Sequenzprüfung, Playback-Verzug | M | AP-16e | H-15 |
| AP-16g | Plugin: Outbox, Offline-Modus, Bedienung | M | AP-16f | H-15 |
| AP-16h | Plugin: Live-Status, Zielbrowser, Trigger-Sets, Anweisungskatalog | L | AP-16g | H-12b, H-15 |

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
   ├─ specs/engine/        allocation (nach Astro PM), moon, night, geometry, sort-chain, flip-rotation, transit, effort, weather, canonical-json
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
| OT-06 | Unterstützung von `INSERT … ON CONFLICT`, Wartefunktion für `CREATE INDEX ASYNC`, GRANT-Syntax in DSQL | **erledigt** im Spike AP-S1 (ADR-S1, 23.09.2026): `ON CONFLICT` verfügbar, `CALL sys.wait_for_job`, `GRANT` je Tabelle ohne `GRANT USAGE ON SCHEMA` (6.0, 6.8) |
| OT-07 | **Jint-Leistung** für `planNight` bei 20+ Projekten | nur noch für Offline-Planung relevant (ADR-16); Messung im Spike AP-S2a; Fallback ClearScript (V8) |
| OT-08 | Genaue NINA-3-Plugin-APIs (Trigger-Walk und Flip-Koordinaten nach Astro-PM-Muster, Profil-Flip-Werte, Bild-Zuordnung, Abbruch – Muster aus dem Astro-PM-Plugin bekannt, Bestätigung mit aktueller NINA-Version) | Spike AP-S2b (Mensch + Claude Code, Prüfprotokoll) mit dem Astro-PM-Plugin (MIT) als Codebasis |
| OT-09 | Discord-Abhängigkeit (Ausfall, Kontosperre des Betreibers) | Notfallzugang `ops-cli`, mehrere Super User |
| OT-10 | Offizieller DSQL-Connector für node-postgres vs. eigener Token-Pool | Connector bevorzugt; im Spike AP-S1 bestätigen |
| OT-11 | Zeitzonendaten für die Engine (IANA-Übergänge) im Jint-Kontext und im Browser | **Entschieden (NT-02):** Der Server liefert die Nacht-Tabelle ab der Mittagsnacht (`nights[]` mit `noonStartUtc`/`noonEndUtc`/`nightWindowEndUtc`), `tzdataVersion` und `timeZoneTransitions` – im Bootstrap (60 Nächte) und für den Browser über `GET /web/v1/sites/{id}/nights` (≤ 400 Nächte, mit `currentNight`); Engine-Läufe im Browser rechnen damit, `Intl` dient **nur der Anzeige**; .NET-`TimeZoneInfo` wird nur für den SiteCheck-Hinweis `pc_timezone_differs` verwendet (NT-06) |
| OT-12 | DNS von svenesis.org | **Erledigt:** Route 53 im selben Konto → Zertifikate (us-east-1, DNS-Validierung) und Alias-Einträge `nina-pm` per CDK (4.3). |
| OT-13/14 | Skripte bzw. Fehlerseiten der Website-Distribution | **Entfallen** (siehe OT-02). |
| OT-15 | Rechtliche Durchsicht der **eigenen Datenschutzerklärung** von NINA-PM (Discord/USA, AWS, externe Dienste, Anmelde-Cookies) | vor Go-live |
| OT-16 | HOPS-/EXOTIC-Ausgabeformate (Fachkonzept OP-14) | Beispieldateien beschaffen vor AP-45 |
| OT-18 | Fremdschlüssel in DSQL erst seit 27.08.2026 | im Spike AP-S1 mit dem Schema testen; Rückfall: FKs weglassen (Integrität im Repository, Abgleich-Job sucht Waisen) |
| OT-19 | Reviews 17.09.2026 | **Eingearbeitet**: Review 1 in TK 1.3/FK 1.6/Schema 1.3, Review 2 in TK 1.6/FK 1.9/Schema 1.6, Review 3 in TK 1.8/FK 1.11/Schema 1.8 (alle unter `claude-code/docs/history/`) |
| OT-20 | NINA-Simulatoren ohne Simulatoruhr | **Entschieden:** `tools/nina-test-server` erzeugt Pläne relativ zu „jetzt“; Sicherheitsprüfungen nur mit Header `X-NPM-Test: 1` übersprungen (nie in prod). |
| OT-21 | Neuplanung vs. Stabilität des Plans | **Entschieden:** Hysterese (nur bei ETag-/Settings-Änderung oder Verzug > 10 min), Nachtfairness mit `tonight`; Eigenschaftstest „Neuplanung ohne Änderung ändert nichts“. |
| OT-22 | NINA-Kommandozeile für den automatischen Start (Profil, Sequenzdatei, Sequenz starten; NT-45) | offen: genaue Schalter im Spike AP-S2b prüfen; Zusammenspiel mit `currentNight` ist festgelegt (10.3) |
| OT-17 | Offene Fachpunkte ohne technische Auswirkung auf R1: OP-10 (Plugin-Veröffentlichung), OP-13 (Katalog-Nutzungsbedingungen), OP-15 (Geräte für Bedingungen), OP-20 (Astro-PM-Import) | vor jeweiligem Release klären |

**Risiken**

| Risiko | Auswirkung | Gegenmaßnahme |
|---|---|---|
| DSQL-Einschränkungen tauchen spät auf | Umbau Datenzugriff | Spike AP-S1 vor dem ersten Schema, lokale DSQL-Tests (`pnpm test:dsql`) bei jeder DB-Änderung, Kysely hält SQL portabel (Ausweichziel Aurora Serverless v2 mit Data API) |
| Engine weicht zwischen Node und Jint ab | Plan in NINA ≠ Simulator | online plant der Server (ADR-16); eigene Mathematik, quantisierte Vergleiche, kanonisches JSON; Paritätstest mit Zufallseingaben |
| NINA-Trigger greifen nicht bzw. Aufnahmen falsch zugeordnet | Montierung läuft an, falsche Zähler | erprobte Muster des Astro-PM-Plugins (Trigger-Walk, Container-Target), Zuordnung `Image.Id` → Aufnahme-ID vor Enqueue mit Timeout, früher Spike AP-S2b für die Stellen ohne Vorbild |
| Planungs-Port weicht unbemerkt vom Original ab | Verteilung anders als erwartet | Orakel im Kompatibilitätsmodus, Soll-Pläne mit Sichtprüfung (H-13), Abweichungen A-1…A-31 nur explizit |
| Sitzungsprüfung liest je Anfrage aus DSQL (SV-01) | höhere Latenz und DPU-Verbrauch | eine indizierte Abfrage über `session_hash`, `last_seen_at` höchstens alle 5 min geschrieben; DPU-Alarm (16.2); bei Bedarf später ein kurzer Cache – ausdrücklich erst nach Messung |
| Fehlbedienung beim lokalen Deploy mit Admin-Profil (keine technische Schutzschicht, E1) | Daten- oder Konfigurationsverlust | `cdk diff` vor jedem Deploy, Löschschutz und `RETAIN` an DSQL-Cluster und Daten-Bucket, tägliche Sicherung (35 Tage) und On-Demand-Backup vor Migrationen, Website-Schutz-Assertions; Claude Code deployt nie |
| Abweichung der Gestaltung von der Website nach Website-Änderungen | uneinheitlicher Auftritt | Tokens mit Quelle/Datum dokumentiert; bei Website-Redesign bewusst nachziehen |
| Kopierte Astro-Tools-Logik veraltet gegenüber späteren Website-Korrekturen | Rechenfehler bleiben bestehen | Datum der Kopie in `legacy/`; Referenztests gegen astropy decken Abweichungen unabhängig auf; das Nachziehen läuft als bewusster Durchgang mit eigener Befundliste (letzter Stand 21.09.2026, nachgezogen 23.09.2026 – WS-01…WS-31, 8.4) |
| **Niederschlag geht in keine Wetterbewertung ein** (bewusste Entscheidung WS-E1: identische Zahlen wie die Website, kein Regen-Riegel) | Eine Nacht kann als *Gut* bewertet sein und dennoch Regen führen; in der **Mehrnacht-Prognose** wird eine Regennacht allein über die Bewölkung bewertet | Anerkannte Einschränkung, nicht zu „reparieren“, solange WS-E1 gilt. Abgesichert über die Anzeige: `precipMm` und `precipProbPct` werden abgerufen, gespeichert und je Stunde angezeigt (`components.md`, WS-17), die Nachtübersicht nennt sie neben dem Score (FK FA-WET-09/FA-FOL-03, `weather.md` §2, TK 8.2). Praktisch fällt eine Regennacht über `cloudScore` fast immer ab – aber eben wegen der Wolken, nicht wegen des Regens |
| Keine Vorab-Umgebung: Fehler erreichen direkt prod | Ausfall oder Datenfehler für alle Mandanten | lokale E2E, lokale DSQL-Tests, `cdk diff` vor jedem Deploy, Backup vor Migrationen, Expand/Contract, Smoke-Tests, schneller Rollback per vorherigem Tag, Abnahme im Test-Mandanten |
| Plugin-Kompatibilität bei NINA-Updates | Nächte fallen aus | Plugin gegen NINA-Beta testen, Engine-Version-Check, klare Fehlermeldung |
