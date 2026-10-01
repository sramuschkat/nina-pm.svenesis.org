### Ersteller in Übersicht und Auswertung, Zielkarten-Auswahl sichtbar, Vorlagenfilter farbig, Datenschutz ohne Entwurfshinweis (2026-10-01)

Anforderungen: S-01, S-40, S-61, S-62, S-63, S-14, FA-WEB-04, components.md §2.22 · Wünsche Sven 01.10.2026

- **Übersicht → Aktive Projekte:** Spalte *Ersteller* mit Bild.
- **Nacht-Simulator, Zielkarten:** Der Klick auf den Namen wählte das Ziel schon vorher, war aber kaum zu sehen. Jetzt: gewählte Karte mit Ring in Zielfarbe; im Nachtplan treten die übrigen Blöcke deutlich zurück (`NightChart`); der Plan scrollt bei Bedarf ins Bild. Neben dem Namen ein eigener Link *„… öffnen“* zum Projekt.
- **Auswertung – Ersteller neben jedem Projektnamen:**
  - Session-Detail: Spalte *Ersteller* in Soll/Ist und Aufnahmen, Name in Korrektur-/Zuordnungsauswahl und Verwerfen-Dialog, CSV-Spalte `projectCreator`.
  - Folgeplanung: Spalte, Kandidaten-Matrix, „Nur heute aus“, Vorschläge, Wiederaufnahme.
  - Projektbericht: Spalte, Abschnittsüberschrift, CSV-Spalte `projectCreator`.
  - Verträge: `NightSessionCapture.projectCreatedBy`, `ForecastProject.createdBy`, `ForecastResume.createdBy`, `ReportProject.createdBy`. Namen für reinen Text über `useMemberNames` (Mitgliederverzeichnis).
- **Ausrüstung → Belichtungsplan-Vorlagen:** Filter-Auswahl je Zeile in der Filterfarbe (wie Belichtungsplan und Filter-Chip).
- **Datenschutz:** Hinweis „Entwurf – rechtliche Durchsicht vor dem Go-live (FA-WEB-04)“ entfernt (Freigabe Sven 01.10.2026).
- Tests: Web 491 (u. a. CSV-Snapshot mit Ersteller, Simulator-Link, Vorlagenfarbe, Übersicht), API 1944, E2E sessions/simulator/home/equipment/tonight grün.
