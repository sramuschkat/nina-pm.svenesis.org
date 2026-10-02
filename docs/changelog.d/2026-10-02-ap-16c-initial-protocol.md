### AP-16c – Start ohne Session plant `initial`; Protokoll P-05 (Teil-Lauf), Erwartungen P-05/P-25/P-31

- Plugin: Startet die Nachtschleife ohne Session in `ninapm.db` (z. B. nach Benutzer-Stopp), plant sie mit `reason: initial` und legt eine neue Session an – auch wenn für die Nacht noch ein gespeicherter Plan liegt. Vorher `refresh`, bei offenen Blöcken im gespeicherten Plan sogar kein Abruf und Blöcke ohne Session. Spec-Ergänzung `execution.md` §3.2 (Sven, 02.10.2026).
- `test-run:check`: Erwartungen für P-05, P-25 und P-31 (Schritte und Log-Ereignisse aus `plugin-test-protocol.md`).
- `docs/test-runs/2026-10-02/P-05`: Simulator-Lauf mit Szenario `one-night` – Blöcke, Neuplanung alle 5 min und Nachtende mit Ende-Bereich bestanden; Aufnahme-Meldung und Outbox folgen mit AP-16e/g (`result: no_go`, `logCheck` fehlt nur `OUTBOX pending=0`).
