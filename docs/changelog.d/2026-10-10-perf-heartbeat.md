### Performance: Heartbeat und Projektliste mit gesammelten Abfragen (2026-10-10)

Basis: AWS-Logs vom 10.10.2026: `POST /api/nina/v1/heartbeat` 1.430 Aufrufe/Tag, p50 378 ms, p95 1,2 s.

- **Projektliste in zwei Runden statt fünf Abfragen je Projekt:** Panels, Zeilen, Aufnahmen, Favoriten, Rigs und Katalognamen werden für alle Projekte mit je einer Abfrage geladen. Das wirkt überall, wo die Liste geladen wird: Heartbeat, `/targets`, Plan, „Heute Nacht“, Projektübersicht, „An NINA ausgeliefert“.
- **Heartbeat:**
  - Unabhängige Schritte laufen gleichzeitig: Standort, Lease und Optik, danach Meldungen, Instanzzustand, Befehle und ETag.
  - Die zweite Rig-Abfrage entfällt; der Einstellungsstand kommt aus derselben Rig-Zeile wie der ETag.
  - Die Filterrad- und Auslesemodus-Meldungen laufen weiter vorher, weil das Filterrad in den ETag eingeht.
- **`/targets`:** Ausschüsse und Flat-Bestand werden gleichzeitig gelesen.
- ETag und Antworten sind unverändert (Test: Heartbeat-ETag gleich `GET /targets`, auch nach Änderungen). Keine Migration, keine Vertrags- oder IAM-Änderung.
