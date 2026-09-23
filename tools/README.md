# tools

Hilfswerkzeuge nach TK 3.1.

- `repo-check/` – prüft im Test, dass `legacy/astro-tools-2026-09-21/` und `packages/catalog-data/` unverändert den Prüfsummenlisten entsprechen (AP-01).
- `deploy/` – `pnpm deploy:prod`, lokaler prod-Deploy **nur durch Sven** mit Admin-Profil (AP-02a, H-06). Claude Code führt es nie aus.
- `deploy/src/test-dsql.ts` – `pnpm test:dsql --spike`, DSQL-Spike gegen einen kurzlebigen Cluster **nur durch Sven** (AP-S1, H-22); Prüfungen in `spikes/dsql/`. Ohne `--spike` folgt mit AP-03.
- `smoke/` – Smoke-Prüfung nach jedem Deploy: Platzhalterseite, SPA-Rewrite, HTTPS-Umleitung, Header-Politiken (AP-02a; Folgepakete erweitern).

Weitere Werkzeuge (`reference/`, `astropm-oracle/`, `nina-test-server/`, `catalog-import/`, `catalog/`, `fake-plugin/`, `test-run-check/`, `fetch-nina-refs.ps1`, `discord-mock/`, `astropm-import/`) entstehen mit ihren Arbeitspaketen.
