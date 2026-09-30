### Nacht-Simulator: Mondprofil statt „LA“ in den Zielkarten (2026-09-30)

Anforderungen: S-40, FA-SIM-06, FA-MON-02 · Wunsch Sven 30.09.2026 („was bedeutet das LA Tag?“)

- Zielkarten nennen an jeder Belichtungszeile mit Mondvermeidung das **Mondprofil** („Mond: Streng“ / „Moon: Strict“) statt des Kürzels „LA“; Tooltip mit Abstand und Breite um Vollmond (bei *Kein Mond*: nur bei Mond unter dem Horizont). DE/EN.
- Planprotokoll und CSV: Spalte „Mondprofil“ zeigt mitgelieferte Profile übersetzt statt als Schlüssel `moonProfile.strict`; Spaltenkopf „LA“ heißt jetzt „Mondvermeidung“.
- Gemeinsame Hilfsfunktion `moonProfileLabel` (Ausrüstung, Simulator, Protokoll).
- Tests: Unit (Kartenzeile mit Profil, Übersetzung im Protokoll), E2E S-40 mit zweiter Zeile *Entspannt*.
