### Simulator im Plugin (AP-53, FA-NIN-18)

- Neuer Bereich **Nacht-Simulator** auf der Optionsseite des Plugins mit der Gliederung von S-40: Infobox mit *Beispielsequenzen herunterladen*, Schritt 1 Strategie & Einstellungen **gesperrt** („Gesteuert von NINA-PM – Änderungen in der Web-App“), Lauf-Leiste mit ◀ Nacht ▶, *Heute Nacht*, *Simulieren*, Kopfzahlen und „Ziele zuletzt abgerufen“, Schritt 2 Zielkarten und nicht zugeteilte Projekte, Schritt 3 Plangrafik und Planprotokoll mit *Protokoll kopieren*.
- **Es rechnet immer der Server:** neue lesende NINA-Route `GET /api/nina/v1/simulation?night=` mit derselben Eingabe wie `POST /plan`, aber ohne Planrevision, Session oder Übernahmestatus. Ohne Verbindung bzw. im Offline-Modus ist der Simulator nicht verfügbar (Entscheidung 01.10.2026: das Plugin plant nie selbst).
- Protokoll, Zielkarten, Blöcke und Filterleiste rechnen Web-Simulator und Plugin-Simulator jetzt mit derselben Funktion (`simulationView` in `packages/shared`).
- Test-Server liefert `GET /simulation` für die Sichtprüfung gegen den Test-Server.
- Während einer Simulation sind ◀, ▶, *Heute Nacht* und *Simulieren* gesperrt; ein zweiter Lauf startet nicht (wie der Simulator des Astro-PM-NINA-Plugins, Wunsch Sven 04.10.2026).
