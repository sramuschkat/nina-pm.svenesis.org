### Rig löschen trotz Simulations- und Prognoseplänen (FA-RIG-13)
- Nachtpläne ohne Session (Web-Simulation, Prognose-Job, Server-Plan ohne angelegte Session) sperren das Löschen eines Rigs nicht mehr, sondern werden mitgelöscht – in Stapeln von höchstens 1.000 Zeilen je Transaktion, erst nach bestandener Prüfung.
- Weiter gesperrt durch Projekte (auch Papierkorb und Wunsch-Rig), NINA-Instanzen, Sessions, Nachtpläne einer Session und eine aktive Lease.
