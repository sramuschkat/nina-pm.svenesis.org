### Plugin ↔ Server: kein Datenverlust mehr (Analyse 04.10.2026, Paket 1)

- **Aufnahmen ohne Zuordnung bzw. ohne Pier-Seite:** Der C#-Client des Plugins lässt `blockId`, `projectId`, `panelId`, `exposureLineId` und `pierSide` bei `null` weg. Der Server verlangte sie und lehnte deshalb das ganze Paket mit `422` ab. Jetzt gilt ein fehlendes Feld als `null`. Wirkt sofort, auch mit dem schon installierten Plugin.
- **Session-Anlage mit `5xx`/`408`/`429`:** Das Plugin legt die Session jetzt offline an und meldet sie nach. Vorher lief die Nacht ohne Session, und Aufnahmen gingen verloren.
- **Fehlerpfade:** Das Plugin erkennt das Server-Format `$.captures[3].…`. Bei einer beanstandeten Meldung geht nur diese ins Dead-Letter, nicht das ganze Paket.
- **`rejected_invalid` je Aufnahme** landet im Dead-Letter, statt still als gesendet zu gelten.
- **`403`/`404` ohne Bezug zu einer Meldung** (Origin-Prüfung, Proxy, falsche URL) werden wiederholt, statt die ganze Outbox ins Dead-Letter zu leeren.
- **Späte Aufnahmen:** Ein `ImageSaved` nach dem Sessionende wird der Session der Belichtung gemeldet.
- **`PATCH` auf eine unbekannte Session** antwortet `409 session.unknown` statt `404`, wie bei Aufnahmen und Ereignissen. Eine endgültig abgelehnte Session-Anlage dreht sich nicht mehr im Kreis.
- **Optionsseite:** neuer Knopf *Dead-Letter erneut senden*. Ereignis-Pakete höchstens 200 (Grenze des Servers).
