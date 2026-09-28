### Session-Korrektur je Zeile vom Server, Filterrad-Plätze ab 1 (2026-09-28)

Anforderungen: FA-AUS-06, TK 7.5 · Entscheidungen Sven 28.09.2026 (Logik-Prüfung, Punkte 2 und 4)

- **Korrigieren und Verwerfen (`canCorrect`):** Die Session-Detailseite zeigte Usern „Korrigieren“ und „Verwerfen“ bei ihren eigenen Projekten auch dann, wenn der Mandant `userCorrections` abgeschaltet hat; die API antwortete dann mit 403. User dürfen die Mandanteneinstellung nicht lesen. Deshalb liefert `GET /api/sessions/{id}` jetzt je Zeile `canCorrect`: dieselbe Prüfung `session.correct` mit der Einstellung des Mandanten wie bei Korrektur und Verwerfen. Die Seite blendet beide Knöpfe danach ein oder aus.
- **Filterrad-Plätze ab 1:** Heartbeat (`filterWheel[].position`) und Bootstrap (`filters[].position`) verlangen jetzt `position ≥ 1`, wie die Rig-Plätze der Web-App (1–20). Die Umrechnung auf NINAs Zählung ab 0 macht allein der Adapter `NinaPm.Nina` (Spec `execution.md` §4.4). Angepasst sind die NINA-Schemas und Beispiele unter `docs/contracts/nina/` sowie die Testdaten.
- **Tests:** API-Test „Detail: canCorrect je Zeile“ mit drei Fällen: Admin darf; User darf nicht; User darf nach `userCorrections: true`. Web-Test: Ohne Berechtigung fehlen „Korrigieren“ und „Verwerfen“.
