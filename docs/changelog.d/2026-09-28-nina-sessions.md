### NINA-API: Sessions, Lease und Sessionende korrigiert (2026-09-28)

Anforderungen: FA-NIN-04, FA-RIG-06, NT-01, NT-14, NT-E1, M5, M6, NIN5-7, TK 5.6, 6.6, 13

- **Offline-Sessions nach Nachtende:** `POST /nina/v1/sessions` beantwortet eine bekannte `id` jetzt vor der Nachtprüfung mit `200`, und eine mit `offline: true` gemeldete Session darf eine vergangene Nacht tragen (Ende höchstens 21 Tage zurück). Vorher lehnte der Server Offline-Sessions nach dem Nachtfenster mit `422 nina.night_invalid` ab, die gepufferten Aufnahmen gingen verloren.
- **Admin-Freigabe gilt je Session:** Eine freigegebene Session erhält die Lease auf keinem Weg zurück (Heartbeat, `PATCH running`, Offline-Plan-Nachmeldung), auch nachdem eine Ersatz-Session übernommen und wieder beendet hat. Vorher vergaß `rig_lease` den Ausschluss beim nächsten Lease-Erwerb – zwei Rechner konnten am selben Rig aufnehmen.
- **`offline_until` nur durch den Halter:** Heartbeats einer anderen Instanz frieren die Lease nicht mehr ein und tauen das Einfrieren des Halters nicht mehr auf.
- **Filterrad aus dem Heartbeat:** Die von NINA gemeldete Belegung wird jetzt auch in prod gespeichert (Ansicht „NINA-Meldung vom …“ in S-10); unveränderte Meldungen höchstens stündlich, damit der Heartbeat nicht mit Rig-Änderungen kollidiert. Ein in der Meldung fehlender Platz gilt wie beim Alarm nicht als geändert.
- **Sessionende nach kurzer Heartbeat-Lücke:** Kehrt eine verwaiste Session zurück, wird der beim Verwaisen angelegte `session_close` neu scharf geschaltet – das echte Ende schließt die Session erneut (Flats, Klarnacht-Statistik, Aufwand). `PATCH` einer abgeschlossenen Session legt `session_close`/`session_report` nur noch beim Ende bzw. beim Leeren der Outbox an, nicht bei jedem Aufruf.
- Spec-Ergänzungen (Vorschlag, Freigabe Sven) in `docs/specs/engine/night.md` §1.1 und `docs/specs/nina/execution.md` §6/§8. Keine Migration.
