### Simulator in der laufenden Nacht ab jetzt, Schieber heißt „Zeitpunkt“ (2026-10-06)

Anforderungen: FA-SIM-05, FA-NIN-18 (Rig-Test Starfront 06.10.2026)

- Web-Simulator und Plugin-Simulator (`GET /nina/v1/simulation`): Läuft die gewählte Nacht schon (aktuelle Nacht, jetzt im Nachtfenster), rechnen sie ab jetzt – wie `POST /plan` mitten in der Nacht. Vorher zeigte die Vorschau die Blöcke in der schon vergangenen Dämmerung, während die Rig dieselben Aufnahmen gerade machte.
- Web: Kopfzeile „Nacht läuft – Plan ab …“ und eine eigene Uhrzeit-Marke; die rote Linie des Schiebers heißt jetzt „Zeitpunkt“ statt „Uhrzeit“ (Legende ebenso). Vergangene und künftige Nächte rechnen weiter ab der Dämmerung.
