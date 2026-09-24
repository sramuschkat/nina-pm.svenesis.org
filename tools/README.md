# tools

Hilfswerkzeuge nach TK 3.1.

- `repo-check/` – prüft im Test, dass `legacy/astro-tools-2026-09-21/` und `packages/catalog-data/` unverändert den Prüfsummenlisten entsprechen (AP-01).
- `deploy/` – `pnpm deploy:prod`, lokaler prod-Deploy **nur durch Sven** mit Admin-Profil (AP-02a, H-06). Claude Code führt es nie aus.
- `deploy/src/test-dsql.ts` – `pnpm test:dsql` gegen einen kurzlebigen DSQL-Cluster **nur durch Sven** (H-22): Migrationen und Datenbank-Suites (AP-03, Protokoll `docs/test-runs/<datum>/ap-03/`); mit `--spike` die Prüfpunkte aus `spikes/dsql/` (AP-S1).
- `astropm-oracle/` – Vergleichsorakel: C#-Original des Astro-PM-NINA-Plugins gegen Grids, `pnpm oracle:run`, CI `oracle.yml` (AP-13a).
- `smoke/` – Smoke-Prüfung nach jedem Deploy: Platzhalterseite, SPA-Rewrite, HTTPS-Umleitung, Header-Politiken (AP-02a; Folgepakete erweitern).

Weitere Werkzeuge (`reference/`, `nina-test-server/`, `catalog-import/`, `catalog/`, `fake-plugin/`, `test-run-check/`, `fetch-nina-refs.ps1`, `discord-mock/`, `astropm-import/`) entstehen mit ihren Arbeitspaketen.
