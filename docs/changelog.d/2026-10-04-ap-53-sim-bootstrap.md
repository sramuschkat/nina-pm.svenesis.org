### AP-53 Simulator lädt die Rig-Einstellungen selbst (Abnahme 04.10.2026)

- **Fehler:** Nach einem NINA-Start ohne laufende Sequenz blieb der Simulator bei „keine Nacht-Tabelle – erst Verbindung testen“ stehen. Er fragte den Server nie, obwohl die Verbindung stand: Die Nacht-Tabelle lädt der Nachtlauf erst mit der Sequenz.
- **Behoben:** Fehlt die Nacht-Tabelle, lädt der Simulator Bootstrap und Ziele selbst und rechnet dann. Im Offline-Modus lädt er nichts. Während des Ladens sind die Lauf-Knöpfe gesperrt.
- **Behoben:** Nach *Refresh* in der Zielliste übernimmt der Simulator den neuen Stand („Ziele zuletzt abgerufen“, Einstellungen, Nächte).
