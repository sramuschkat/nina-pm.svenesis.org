### Plugin: Rig mit Teleskop und Kamera, Standort aus NINA-PM übernehmen (FA-NIN-03)

- **Optionsseite:** Unter *Verbindung* stehen jetzt Rig · Standort, Teleskop und Kamera aus den Rig-Einstellungen, wie in der Rig-Zeile des Astro-PM-Plugins. Sie erscheinen auch ohne Verbindungstest, sobald das Plugin die Einstellungen geladen hat. Eine Rig-Auswahl gibt es nicht, weil das Sync-Token das Rig festlegt.
- **Standortprüfung:** Liegt der Standort des NINA-Profils mehr als 10 km vom Rig-Standort entfernt, warnt das Plugin auch beim Planaufbau (`WARNING code=profile_site_mismatch`, höchstens alle 12 h), nicht mehr nur beim Verbindungstest.
- **Knopf *Standort aus NINA-PM übernehmen*:** Er erscheint nur bei Abweichung und schreibt Breite, Länge und Höhe des Rigs ins aktive NINA-Profil. Das geschieht nur nach Rückfrage, nie automatisch.
