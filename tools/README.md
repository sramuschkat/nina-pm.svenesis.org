# tools

Hilfswerkzeuge nach TK 3.1.

- `repo-check/` – prüft im Test, dass `legacy/astro-tools-2026-09-21/` und `packages/catalog-data/` unverändert den Prüfsummenlisten entsprechen (AP-01).
- `deploy/` – `pnpm deploy:prod`, lokaler prod-Deploy **nur durch Sven** mit Admin-Profil (AP-02a, H-06). Claude Code führt es nie aus.
- `deploy/src/golive-check.ts`, `loadtest.ts`, `alarm-probe.ts` – `pnpm golive:check [--snapshot-website]` (automatisierbare Punkte der Go-live-Checkliste, nur lesend), `pnpm loadtest:prod` (Burst gegen die Drosselung, iam.md §9) und `pnpm alarm:probe` (Alarm-E-Mail, H-23); **nur Sven** mit Admin-Profil, Protokolle unter `docs/test-runs/<Datum>/ap-17/` (AP-17).
- `deploy/src/test-dsql.ts` – `pnpm test:dsql` gegen einen kurzlebigen DSQL-Cluster **nur durch Sven** (H-22): Migrationen und Datenbank-Suites (AP-03, Protokoll `docs/test-runs/<datum>/ap-03/`); mit `--spike` die Prüfpunkte aus `spikes/dsql/` (AP-S1).
- `astropm-oracle/` – Vergleichsorakel: C#-Original des Astro-PM-NINA-Plugins gegen Grids, `pnpm oracle:run`, CI `oracle.yml` (AP-13a).
- `smoke/` – Smoke-Prüfung nach jedem Deploy: Platzhalterseite, SPA-Rewrite, HTTPS-Umleitung, Header-Politiken (AP-02a; Folgepakete erweitern); mit `TEST_RIG_TOKEN` die DB-Erreichbarkeit über den Bootstrap (AP-14c, SV-07).
- `engine-bundle/` – `pnpm engine:bundle` erzeugt `packages/engine/build/engine.iife.js` (ES2020, global `NinaPmEngine`, für Jint im Plugin), `pnpm engine:parity [--count 500] [--seed 1]` die Erwartungsdatei `parity-expected.json` (Hashes aus Node). `apps/nina-plugin/NinaPm.Core.Tests` vergleicht damit Jint gegen Node; CI-Auftrag `engine-parity` in `plugin.yml` (AP-08c).
- `nina-build-check.sh` – NINA-Paketversionen, Plugin-Ausgabe nur mit eigenen DLLs, keine DLL im Git (AP-S2c, ADR-S2c).
- `fake-plugin/` – eine komplette NINA-Nacht gegen `/api/nina/v1` (Bootstrap, ETag, Session, Plan, Aufnahmen mit Duplikaten und unzugeordnet, Neuplanung mit `tonight`, Ereignisse, Lease verloren per Hook, Offline-Nachmeldung, Zählerprüfung): `pnpm fake-plugin [--base-url <url>]` mit `TEST_RIG_TOKEN` aus der Umgebung; lokal als Test in `apps/api/test/nina-instances.test.ts`, nach jedem prod-Deploy im Test-Mandanten (AP-14c, H-24).

Weitere Werkzeuge (`reference/`, `nina-test-server/`, `catalog-import/`, `catalog/`, `test-run-check/`, `discord-mock/`, `astropm-import/`) entstehen mit ihren Arbeitspaketen.
