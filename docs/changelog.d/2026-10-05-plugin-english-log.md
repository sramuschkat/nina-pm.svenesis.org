### NINA-Plugin 0.4.1: Codes und Log-Texte englisch

- **Vorlagenprüfung:** Die fünf Codes mit deutschen Wörtern heißen jetzt englisch:
  - `bloecke_missing` → `blocks_container_missing`
  - `ziel_night_loop_missing` → `target_night_loop_missing`
  - `sicherung_missing` → `secure_container_missing`
  - `sicherung_night_loop_missing` → `secure_night_loop_missing`
  - `sicherung_secure_missing` → `secure_park_missing`
- **Log englisch:** Alle Texte, die das Plugin ins NINA-Log schreibt oder als Meldung an den Server schickt, sind englisch, wie NINAs eigenes Log. Das betrifft:
  - Vorlagenprüfung („Sequence template: …“);
  - Hinweise zu Neuplanung, Befehlen, Flats und Outbox;
  - Zeitzonen-, Standort- und Uhrwarnungen;
  - Dead-Letter-Gründe und Fehlermeldungen.
- Der Sequenzbaustein für Belichtungen heißt im NINA-Log jetzt `NINA-PM Exposure`.
- Die Oberfläche des Plugins folgt weiter NINAs Sprache (Deutsch/Englisch), und die Web-Hilfe erklärt die Codes zweisprachig.
- Die Bezeichner im `SequenceInspector` sind englisch.
