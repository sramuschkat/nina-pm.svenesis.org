### AP-16f – Uhrabweichung als Warnung, VM-Kurzlauf `vm-flip`

- Neuer Warn-Code `clock_drift` (`enums.json`, Entscheidung Sven 03.10.2026): Uhrabweichung 5–60 s gegen `serverTimeUtc` → `WARNING code=clock_drift` höchstens 1×/12 h, Nachtschleife läuft weiter; > 60 s sperrt wie bisher (`clock_skew`).
- VM-Kurzlauf `vm-flip` (Szenario, sieben Prüfungen, Anleitung mit Gerätetabelle und NINA-Flip-Einstellungen): Flip mit echtem NINA und Rotator-Simulator ohne Handgriffe; Auswertung `pnpm plugin:sim --vm <ordner> vm-flip`; derselbe Ablauf läuft kopflos mit. Neue Prüfoption `sameValue` (z. B. mechanischer Rotatorwinkel aller Aufnahmen gleich).
