### Heute Nacht – Rig zuerst, Mond und Dunkelheit, Nacht im Detail, Mond & Planeten (2026-09-27)

Anforderungen: S-02, FA-FOL-06 · Wunsch Sven 27.09.2026 (Vorlage Astro-Tools: Beobachtungsplaner und Astro-Wetter)

- **Rig zuerst:** Oben wählt man das Rig (Auswahlliste wie in der Planung, Rig in der URL `?rig=`); damit steht der Standort fest. Daneben Standort und aktuelle Nacht (weiter vom Server, NT-01). Statt einer Karte je Rig zeigt die Seite nur noch das gewählte Rig.
- **Mond und Dunkelheit** wie im Objektbrowser und in der Sternkarte, direkt unter der Auswahl (`SiteMoonDarkness` nach `pages/planning` verschoben).
- **Plan für diese Nacht:** die bisherige Rig-Karte (Dunkelheit, Mond, Wetter, NINA, Wetterband, Safety-Link, geplante Projekte, „nur heute aus“).
- **Nacht im Detail:** die Stundentabelle aus Astro-Wetter (Bedeckung, Wolkenschichten, ECMWF/NBM, Seeing, Aerosol, Wasserdampf, Staub, Sicht, Regen, Wind, Temperatur, Taupunkt, Feuchte) mit ← → für andere Nächte. `WeatherChart` hat dafür die Variante `detailOnly` (ohne Wochenübersicht und Skala).
- **Mond & Planeten:** Karten mit bester Höhe, Uhrzeit, Richtung und Helligkeit bzw. Beleuchtung; darunter Sichtbarkeitsbalken je Körper mit „jetzt“, „max. Höhe“, „mag · %“. Engine: `sky.nightBodySamples`, `sky.bestBodySample`, `sky.bodyAtSite` (portiert aus dem Beobachtungsplaner; Test gegen dessen Werte für Starfront, 27./28.09.2026). Neuer Baustein `NightBodies` (components.md §2.19), Farben `--npm-body-*`.
- **Entfallen:** „Ungeprüfte Sessions“ und „Offene Warteschlange“ (weiter unter Sessions bzw. Projekte → Warteschlange). Abweichung von FK S-02 auf Wunsch Sven.
- Tests: Engine (Mond & Planeten gegen die Vorlage), Seite (Reihenfolge, Rig aus der URL, keine Sessions/Warteschlange), `WeatherChart` nur Nachtdetail, E2E Rig-Wahl und Abschnitte.
- „Ereignisse der Nacht“ (Überflüge, Meteorströme, Milchstraßenzentrum, Finsternisse, Kometen) folgt in einem eigenen PR.
