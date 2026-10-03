### AP-16h (Teil 2) – Plugin: Live-Status, Zielbrowser mit Framing-Assistent, Release-Prüfung

Anforderungen: FA-NIN-02, FA-NIN-13, FA-NIN-16; execution.md §2, §9; geometry.md §2.1 (NT-30, NT-32)

- **Live-Status im Container (FA-NIN-13):** Kopf mit Zustand (*Warten*, *Läuft*, *Gesperrt* mit Grund je `blockedReasons`, *Beendet*, Offline-Modus), Ziel mit RA/Dec und Rotation, laufender Belichtung (Filter, Zeit, Gain, Offset, Binning, Auslesemodus), Outbox- und Dead-Letter-Zähler, Knöpfe *Zurücksetzen* und *Block überspringen* und aufklappbar „Heutige Ziele“ mit Zeitfenstern in Standortzeit. Rotes Banner *Testbetrieb – Sicherheitsprüfungen aus* nur bei erfüllter Dreifachsperre. Die Momentaufnahme rechnet der Kern (`LiveStatus`), die Ansicht zeigt nur an.
- **Zielbrowser „An NINA ausgeliefert“ (FA-NIN-02)** auf der Optionsseite: Ziel, RA, Dec, Rotation, Panels, Brennweite, Sensor, Pixel, Priorität, Typ, Fortschritt, nächster Transit; Filter nach Typ und „nur offene“; *Aktualisieren*; **In Framing-Assistent laden** übergibt Zentrum, Positionswinkel, Sensor, Brennweite, Raster und Überlappung über NINAs `IFramingAssistantVM`.
- **Vertrag `GET /targets`:** je Projekt `center {raDeg, decDeg, rotationDeg}` (ohne Rotator Kamerawinkel des Rigs, NT-30) und `mosaic` jetzt immer geliefert; additiv, ältere Plugins ignorieren es. Wirkt nach `pnpm deploy:prod`; bis dahin rechnet das Plugin das Zentrum aus den Panels.
- **Panel-Nummerierung NT-32** im Kern (`PanelNumbering`) mit den Pflichtwerten aus geometry.md §2.3.
- **Release:** Tag `plugin-vX.Y.Z` muss der Plugin-Version aus `NinaPm.Nina.csproj` entsprechen (`tools/nina-release-check.sh`); das ZIP bekommt eine SHA-256-Prüfsumme als zusätzliches Release-Asset.
