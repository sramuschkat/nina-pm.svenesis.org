### Heute Nacht: Nachtwahl mit Mondkalender (2026-09-30)

Anforderungen: S-02, FA-FOL-06, NT-01 · Wunsch Sven 30.09.2026 („Datumsauswahl mit Mondkalender; erstmal max. 7 Tage, weil das Wetter so weit reicht“)

- **Mondkalender** über den Kennzahlen: die laufende Nacht und die folgenden sechs (so weit reicht das Astro-Wetter, FA-WET-01).
  - Je Nacht: Wochentag und Doppeldatum, Mondphase, Beleuchtung, dunkle Stunden ohne Mond, Wetterbewertung bzw. „keine Vorhersage“.
  - Ein Klick wählt die Nacht; sie steht in der Adresse (`?nacht=`).
- **Gewählte künftige Nacht:** Kennzahlen, Zeitleiste (Himmel, Wetter, Mond, Plan-Simulation), Nachtwetter im Detail, Mond & Planeten und Ereignisse beziehen sich auf diese Nacht.
  - Die Einschätzung zeigt den Dunkelzeitraum statt des Countdowns.
  - Hinweis „Plan aus dem heutigen Projektstand“; NINA-Status und „nur heute aus“ nur für die laufende Nacht.
- **API:**
  - `GET /api/web/v1/tonight?night=` erlaubt die laufende Nacht bis +6, außerhalb `422 validation.failed`;
  - `TonightRig.currentNight` und `calendar[]` mit Beleuchtung, Zu-/Abnahme, Dunkel- und mondfreien Stunden (10-min-Raster, Mond unter −0,833°) und Wetterbewertung.
- **Tests:**
  - API: 7 Nächte, gewählte Nacht, außerhalb 422;
  - Web: Leiste, Auswahl mit Adresse, Hinweise für künftige Nächte, zurück zur laufenden Nacht.
