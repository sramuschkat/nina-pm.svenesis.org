### Performance Paket C: klare Nächte, Startseite, Nacht-Detail, Simulator-Eingabe (2026-10-10)

Basis: AWS-Logs vom 10.10.2026. Der Abruf der klaren Nächte (`/sites/{id}/clear-nights`, Standort-Statistik) hatte p95 3,5 s; `/simulations/input` lag bei p50 382 ms.

- **Klare Nächte:** Standort, Nachtstatistik, Sessions, Vorhersagen und die Lights für „Klar laut Bildern“ laden gleichzeitig statt nacheinander. Lights und Verworfene je Session kommen aus **einer** gruppierten Abfrage statt zwei Unterabfragen je Session.
- **Startseite „Heute“:** „Zu tun → ungeprüft“ fragt die neue Route `GET /sessions/unreviewed` ab. Bisher rief sie die Nächte-Zusammenfassung **ohne Zeitraum** auf und las dabei alle Aufnahmen des Mandanten.
- **Nacht-Detail (S-61):** Einstellungen, Rig mit Optik, Bezugswerte und Bewertungsbasis laden gleichzeitig.
- **`/simulations/input`:**
  - Rig-Daten und NINA-Instanzen laden gleichzeitig; die doppelte Rig-Prüfung entfällt.
  - Ist und Pläne der Nacht laden, während die Plan-Eingabe entsteht.
- Antworten unverändert; neuer Vertrag `NightSessionUnreviewed`. Keine Migration, keine IAM-Änderung.
- AP-69 ☑ 10.10.2026 (Abnahme Sven nach dem Deploy).
