### Wetter – Rig-Zeit und Zeit des Users in den Stundenzeilen (2026-09-28)

Anforderungen: S-50, S-02, rules/ui.md (Standortzeit mit Kürzel, Gerätezeit als zweite Angabe) · Wunsch Sven 28.09.2026

- **Wettervorhersage:** In der Wochenübersicht und in „Nacht im Detail“ steht unter den Stunden der Standortzeit („Standort CDT“) eine zweite, hellere Stundenzeile in der Zeit des Users („Bei dir MESZ“), sobald die Zonen abweichen. Sonst bleibt es bei einer Zeile.
- **Heute Nacht:** gleiches in „Nachtwetter im Detail“ (dieselbe Komponente).
- `WeatherChart` hat dafür `deviceTimeZone` (ohne Angabe die Zone des Browsers).
