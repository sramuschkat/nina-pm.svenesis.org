### Plugin ↔ Server: Session-Jobs und Einstellungs-Alarme (Analyse 04.10.2026, Paket 4)

- **Keine Job-Flut nach dem Sessionende:** Ein Heartbeat belebt eine verwaiste Session nach Sessionende + 2 h nicht mehr. Bisher pendelte sie dann zwischen *verwaist* und *läuft*, z. B. wenn NINA am Morgen neu gestartet wurde, die Sequenz aber nicht. `tick-5min` legte dabei alle 5 min neue Abschluss-, Bericht- und Aufwand-Jobs an.
- **Nachtbericht verwaister Sessions:**
  - Er läuft frühestens 1 h nach dem Verwaisen.
  - Kommt das Plugin zurück, wird ein noch nicht gelaufener Bericht zurückgezogen. Der richtige folgt mit dem Abschluss.
  - Vorher ging er zu früh hinaus, und der richtige konnte nie mehr gesendet werden.
- **Offline-Modus:** Offline-Sessions werden nach dem Sessionende nicht mehr *verwaist* (keine Alarme), erst nach mehr als 14 Tagen. Die Markierung prüft ihre Schwellen auch beim Schreiben, damit ein gleichzeitiger Heartbeat gewinnt.
- **Abbruch mit offenen Meldungen:** Das Plugin meldet nach einem Benutzer-Stopp den Stand bis 0 nach, wie beim Abschluss. Vorher liefen Abschluss und Bericht erst nach 6 h. Im Offline-Modus wartet der Abschluss in der Outbox, statt den Server aufzurufen.
- **Keine Fehlalarme nach dem NINA-Start:** Solange kein NINA-PM-Container gelaufen ist, meldet das Plugin die Trigger als unbekannt. Es gibt dann weder „Flip-Trigger fehlt“ noch „Autofokus-Trigger fehlt“, und der erste Plan rechnet mit dem Autofokus-Intervall des Rigs statt ohne Autofokus. `af_time_trigger_missing` kommt nur noch bei einem Intervall > 0, `af_time_mismatch` erst ab 0,5 min Abweichung (wie die Spec).
