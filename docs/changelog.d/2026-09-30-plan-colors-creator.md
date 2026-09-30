### Filterfarben im Belichtungsplan, Ersteller in Editor, Simulator, NINA-Karten und Heute Nacht (2026-09-30)

Anforderungen: S-31, S-40, S-41, S-02, FA-PRJ-20, components.md §2.1/§2.22 · Wunsch Sven 30.09.2026 · setzt #165 (Mitgliederverzeichnis) voraus

- **Belichtungsplan (Projekt-Editor):** Filter-Auswahl der Zeile in der Filterfarbe mit lesbarer Schrift – gleiche Farb- und Kontrastregel wie der Filter-Chip (`chipBackground`/`chipTextColor`, ≥ 4,5:1); gesperrte Zeilen zeigen wie bisher den Chip.
- **Ersteller mit Bild** im Kopf des Projekt-Editors, auf den Zielkarten des Nacht-Simulators, auf den Karten „An NINA ausgeliefert“ und als Spalte in „Heute Nacht → Plan für diese Nacht“.
- **An NINA ausgeliefert:** Filter als farbige Filter-Chips statt Text.
- Verträge: `NinaDeliveryItem.createdBy`, `TonightProject.createdBy`; Simulator-Zielkarte mit `createdBy`.
- Tests: Belichtungsplan (Farben, abgedunkeltes #00897B), NINA-Karte, Heute Nacht, Simulator; E2E projects, project-list, simulator, nina, tonight 29/29.
