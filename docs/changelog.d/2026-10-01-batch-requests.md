### Weniger parallele Anfragen je Seitenaufruf (2026-10-01)

Anforderungen: SV-06, TK 7.2, NFA (Lastspitzen) · Alarm `nina-pm-api-5xx-rate` 30.09.2026, Entscheidung Sven 01.10.2026 („mach beides“; Teil 2 nach PR „Parallelität 50“)

- **`GET /api/web/v1/equipment`** (`equipment.read`): Standorte, Teleskope, Kameras, Filter, Mondprofile und Rigs in einem Aufruf; Teleskope und Kameras werden für die Rig-Ansicht nur einmal geladen (die Einzelliste lädt sie je Rig).
- **`GET /api/web/v1/project-details?ids=…`** (`project.read`, höchstens 50): wie `GET /projects/{id}` je ID; nicht lesbare oder unbekannte fehlen.
- **Web-Client bündelt automatisch:** gleichzeitige `equipmentApi.list(kind)` teilen sich einen `/equipment`-Aufruf (nur solange er läuft – danach wieder frisch, also kein veralteter Stand nach dem Speichern); gleichzeitige `projectsApi.get(id)` gehen gesammelt an `/project-details` (einer allein bleibt Einzelabruf; fehlende fallen auf den Einzelabruf mit dessen Fehler zurück). Seiten, Cache-Schlüssel und Invalidierung unverändert.
- Gemessen im lokalen Stack mit 7 aktiven Projekten: „Heute Nacht“ **10 statt 19** Anfragen beim Laden.
- TK 7.2 (Routentabelle). Tests: API (Bündel = Einzellisten, Sammelabruf mit Rechten, Grenze 50), generierter Rechte-Test, Client-Bündelung; E2E 82/82.
