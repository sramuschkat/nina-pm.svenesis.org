### Nacht-Simulator: Exoplaneten mit festgelegtem Transit (2026-10-06)

Anforderungen: FA-SIM-05, FA-EXO-20 (transit.md §9, AP-44)

- Der Web-Simulator plant festgelegte Transits der gewählten Nacht jetzt wie `POST /plan` ein: Transitblock mit Zielkarte und Serie in der Plangrafik. Vorher ließ er Exoplaneten-Projekte ganz weg und zeigte einen anderen Plan als NINA. Am 06.10.2026 stand WASP-3b in „An NINA ausgeliefert“ und im Plugin-Simulator, im Web-Simulator aber nicht.
- Neue Route `GET /api/web/v1/simulations/transits?rigId=…&night=…` (Aktion `simulation.run`). Sie nutzt dieselbe Auswahl wie die Auslieferung an NINA: primäre festgelegte Beobachtung, Fensterende nach jetzt, aktive Transit-Zeile, je Projekt die früheste.
- Exoplaneten-Projekte ohne festgelegten Transit in dieser Nacht stehen unter „nicht zugeteilt“ mit dem Grund „kein festgelegter Transit in dieser Nacht“. Auch mit eigenen Entwürfen werden sie nie wie Deep-Sky-Ziele geplant.
