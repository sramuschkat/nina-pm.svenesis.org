# Runbook: Rollback eines Deploys (TK 18, H-23)

**Wann:** Ein Deploy verursacht Fehler (Smoke-Test rot, Fake-Plugin-Nacht rot, Fehler in der Anwendung). Datenfehler → [restore.md](restore.md).

**Grundsatz:** Migrationen sind nur additiv (Expand/Contract, TK 6.10) und werden **nie** zurückgerollt. Der vorherige Code läuft deshalb auf dem neueren Schema.

## Ablauf (Sven, lokal, Admin-Profil)

1. Letzten funktionierenden Tag bestimmen (`git tag --list 'v*' --sort=-creatordate | head`).
2. Arbeitsbaum sauber, dann den Tag auschecken:
   ```
   git checkout <vorheriger Tag>
   ```
3. Deployen – das Skript prüft die CI des Commits, zeigt `cdk diff` und fragt nach:
   ```
   pnpm deploy:prod
   ```
   Smoke-Test und Fake-Plugin-Nacht müssen grün sein.
4. Zurück auf `main`: `git checkout main`. Den Fehler per PR beheben; danach normal deployen.

## Rollback-Probe (einmal vor Go-live, H-23)

1. Aktuellen Tag `vX` gesetzt und deployt.
2. Vorherigen Tag `vW` wie oben deployen, Smoke grün.
3. Wieder `vX` auschecken und deployen, Smoke grün.
4. Zeiten und Ausgaben in `docs/test-runs/<Datum>/ap-17/rollback-probe.md` festhalten.

**Hinweis:** Tags setzt nur Sven (`v*` für Web/API, `plugin-v*` für das Plugin).
