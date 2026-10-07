### OCC-Wiederholung für einzelne Schreibanweisungen (2026-10-07)

- **Prod-Alarm `nina-pm-api-5xx-rate` (15:47 UTC):** `PUT /api/web/v1/me/preferences/ui.theme` antwortete mit 500 wegen eines DSQL-Konflikts `OC000`. Das Speichern der Einstellung war eine einzelne Anweisung ohne `withTx` und wurde deshalb nicht wiederholt.
- **Neue Hilfsfunktion `retryOcc`:** Sie wiederholt bei 40001/OC000/OC001 wie `withTx` (50/150/400 ms + Jitter). 33 Schreibanweisungen außerhalb von `withTx` laufen jetzt darüber, darunter Anmelde-Sessions, Heartbeat-Stand der NINA-Instanzen, Jobs, Favoriten, Kommentare und Reaktionen, „geprüft“, Mandant umbenennen. Ausgenommen sind reine Inserts mit neuer ID.
- **`docs/rules/dsql.md`:** Die Regel gilt jetzt auch für Einzelanweisungen.
