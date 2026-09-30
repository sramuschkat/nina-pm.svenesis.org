### Fix: Transitsuche hing bei sehr unsicheren Ephemeriden (2026-09-30)

Anforderungen: FA-EXO-05, FA-EXO-12 · transit.md §2 · Alarm `nina-pm-api-5xx-rate` 30.09.2026 06:45 UTC

- **Fehler:** In S-22 blieb „Transits der Nacht werden gerechnet …“ stehen, danach kam „Interner Fehler“. Die API lief in ihr 29-s-Limit, der Anteil der 5xx-Antworten lag bei 4,8 %.
  - Ursache: ExoClock-Planeten mit großer Periodenunsicherheit haben nach vielen Umläufen einen Puffer von Stunden bis Tagen.
  - `predictTransits` prüfte dann jeden 5-Minuten-Abschnitt dieses Fensters, bis die Zwischenspeicher-Map überlief.
  - Außerdem wurde jeder Umlauf der Umgebung zum Kandidaten.
- **Behebung (Engine 0.11.1):**
  - Nutzbare Abschnitte werden nur innerhalb des Nachtfensters (FK 8.1) geprüft. Davor und danach steht die Sonne über der bürgerlichen Dämmerung; die Abschnitte zählen dort als nicht nutzbar.
  - Der Suchbereich der Kandidaten rechnet den Puffer höchstens mit T14. Darüber gilt die Ephemeride ohnehin als „zu alt“ (`stale`, nicht festlegbar).
  - Das angezeigte Fenster bleibt unverändert.
- Voller ExoClock-Katalog (776 Planeten), Texas, Nacht 29./30.09.: 35 ms statt Zeitüberschreitung. Regressionstest mit einem Puffer von rund 30 Tagen.
