### Plugin ↔ Server: Nachtablauf sicher (Analyse 04.10.2026, Paket 2)

- **Nachtende ohne Lease:** Wurde die Lease im Web freigegeben oder hält ein anderes Rig sie, endete die Nacht bisher nie. Abschluss und Ende-Bereich der Sequenz (Parken, Kamera aufwärmen) liefen nicht. Jetzt gilt am Nachtende: keine Flats, Session als abgebrochen melden, Nacht schließen, der Ende-Bereich läuft.
- **Warten auf einen späten Block:** Freigaben, *Zurücksetzen* und neue Einstellungen wirken sofort und nicht erst beim Blockstart. Vorher konnten Stunden Dunkelzeit verloren gehen.
- **Heartbeat und Lease:**
  - Eine Antwort für eine inzwischen abgeschlossene Session sperrt die neue nicht mehr.
  - Eine dem Server noch unbekannte, offline angelegte Session bekommt `lease: null` statt `leaseLost`. Der laufende Block bricht deshalb nicht mehr ab.
- **Veraltete Session:** Wird beim Nachtwechsel (z. B. Flats über das Nachtfensterende) vorher abgeschlossen und bleibt nicht `stale`.
- **Warten auf Zeit:** Bei einem Start am Morgen nach der Dunkelheit wartet die Anweisung auf die nächste Nacht. Bisher ging es mit der vergangenen Dämmerung sofort weiter, und die Sequenz entparkte im Morgengrauen.
- **Tagesschleife:**
  - Lieferangaben, die älter als 6 h sind, beenden die Schleife nicht mehr mit „keine Ziele“.
  - Die Ziele werden am Morgen aufgefrischt.
