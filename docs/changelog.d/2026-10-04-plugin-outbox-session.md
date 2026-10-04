### NINA-Plugin 0.4.0: `outboxPending` je Session (Analyse 04.10.2026)

- **Plugin 0.4.0** enthält die Plugin-Seite der Pakete 1, 2, 4 und 5 (#257, #258, #260, #261).
- **Abschluss-`PATCH`:** `outboxPending` zählt nur noch die offenen Meldungen der eigenen Session. Reste einer früheren Session hielten den Abschluss und den Nachtbericht bisher bis zur 6-h-Grenze auf. Heartbeat und Anzeige zählen weiter die ganze Outbox.
