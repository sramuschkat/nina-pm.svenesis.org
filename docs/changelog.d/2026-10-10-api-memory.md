### Infrastruktur: API-Lambda mit 1.769 MB statt 1.024 MB (2026-10-10)

- Lambda teilt die CPU nach Speicher zu: Erst mit 1.769 MB bekommt die API einen ganzen vCPU (Node rechnet in einem Thread).
- Gemessen in prod (`dso_search`, 10.10.2026): Nachtwerte im Objektbrowser 4–8× langsamer als lokal. Bewertung kalt 481 ms, „nutzbare Stunden“ kalt 1.243 ms, warm 120 ms.
- Erwartet ≈ 1,7× schneller für alles Rechenlastige: Objektbrowser, Plan, Simulation, Kaltstart, JSON.
- Kosten: bei heutiger Nutzung geschätzt höchstens etwa 0,5–0,7 € mehr im Monat.
- TK 6.1 nachgezogen (Speicher; DSQL-Pool 6 je Container ⇒ höchstens 300 Verbindungen).
