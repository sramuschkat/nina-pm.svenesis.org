### Folgeplanung mit Transits, „Plan für diese Nacht“ live, Neuberechnung bei Änderungen (2026-10-07)

Anforderungen: FA-FOL-01…06, FA-SIM-04, FA-EXO-20 (transit.md §9)

- **„Plan für diese Nacht“ (Heute Nacht):** Für die laufende Nacht zeigt der Kasten jetzt die Frames aus dem live gerechneten Plan, also dieselbe Rechnung wie Zeitleiste, Nacht-Simulator und NINA, mit Transits. Vorher kamen sie aus der Prognose vom Mittag: Später freigegebene Projekte (IC 1795) und Exoplaneten (WASP-3b) standen dort mit 0 Frames. Für künftige Nächte bleibt die Prognose die Quelle.
- **Prognose, Mehrnacht-Simulation und Auswirkungsvorschau mit Transits:** Exoplaneten-Projekte plant die Rechnung nur in der Nacht ihres festgelegten Transits, als Transitblock wie `POST /plan`. Vorher plante sie Exoplaneten wie Deep-Sky-Ziele über die ganze Nacht.
- **Neuberechnung bei Änderungen:** Ändert sich ein freigegebenes Projekt, rechnet der Server die Folgeplanung des Standorts gleich neu, statt erst am nächsten Mittag. Das gilt für Freigabe, Speichern, Status, Priorität und Transit festlegen oder aufheben; je Standort läuft höchstens ein offener Lauf.
