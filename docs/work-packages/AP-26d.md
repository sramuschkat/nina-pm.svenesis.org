# AP-26d – Stilsystem: ein Seitengerüst, eine Typo-Skala, Karten als Fläche

**Release:** UI-Überarbeitung (vor R3) · **Größe:** L · **Abhängigkeiten:** AP-26c · **Menschliche Aufgaben:** –

## Ziel
Die Oberfläche soll übersichtlich, klar strukturiert und optisch ruhig wirken (Wunsch Sven, 26.09.2026). Grundlage ist die Layout-Analyse vom 26.09.2026 und der von Sven freigegebene Entwurf im Design-Canvas „Layout-Optimierung Entwurf (AP-26d)“: Stilsystem, Übersicht, Projektliste, Projekt-Editor, Ausrüstung, Objektbrowser, dunkles Theme.

## Befund (gemessen bei 1280 × 800, 12 Arbeitsseiten)
- Seitentitel 20 px auf 4 Seiten, 32 px auf 8; der Titel beginnt zwischen 76 und 191 px. Bereichsreiter stehen mal über, mal ohne Titel, Brotkrumen zusätzlich auf einzelnen Seiten.
- 8 Schriftgrößen (10 / 12,8 / 13,6 / 14,4 / 16 / 16,8 / 20 / 32 px), Fließtext wechselt zwischen 13,6 und 16 px.
- Steuerelemente 26 / 28 / 32 / 34 px hoch.
- Flächen uneinheitlich: Karten mit farbiger Oberkante (Übersicht), ohne Karte (Projektliste), gemischt (Ausrüstung).
- *Speichern* im Editor oben rechts, in der Ausrüstung unten; *Löschen* gleich gewichtet daneben.
- Umrandete Kennzeichen in vielen Farben, drei gestapelte Zeilenknöpfe im Objektbrowser, zwei Fußleisten auf jeder Arbeitsseite.

## Liefern
- **Tokens** (`packages/ui-tokens`):
  - **Schrift:** Skala 24 (Titel) · 16 (Kartentitel) · 14 (Fließtext, Tabellen, Felder) · 13 (Nebentext) · 12 (Beschriftung, Tabellenkopf).
  - **Steuerhöhe:** `row-h` 32 px (dicht 28, weit 36); Tabellenzeilen `row-h` + 12 px.
  - **Farben:** Fläche und Linie leicht kühler (`bg`, `border`), Text dunkler (`text`, `text-light`). Neu: `border-strong`, `surface-sub`, `selected-bg`, `success-bg`, `info`/`info-bg`, `neutral-bg`.
  - **Formen:** Kartenradius 10 px, Steuerradius 6 px, flacher Schatten.
  - Dokumentierte Abweichung von den Website-Farben in `tokens.ts` und im Test.
- **Grundklassen** (`admin.module.css`, von allen Seiten komponiert) und Bausteine:
  - Knöpfe: primär / sekundär / ruhig / Gefahr (nur Text).
  - Felder 32 px mit Beschriftung 12 px.
  - Karten als einzige Fläche.
  - `StatusBadge` / `EffortChip` als weiche Kennzeichen (Status mit Punkt).
  - `DataTable` mit Kopf auf `surface-sub`, Zeile 44 px.
  - `Tabs` 40 px.
- **Seitengerüst** `PageHeader` (components.md §2.14):
  - Titel 24 px oben links, darunter Metazeile; Hauptaktion rechts.
  - Bereichsreiter **unter** dem Titel.
  - Brotkrumen nur auf Detailseiten.
  - Genutzt von allen Bereichs-Layouts (Projekte, Ausrüstung, Planung, NINA, Auswertung, Verwaltung, System) und Einzelseiten (Übersicht, Wetter, Editor, Session-Detail, Persönliche Einstellungen).
- **Rahmen:**
  - Seitenleiste in Gruppen *Planen* (Heute Nacht, Planung, Projekte) · *Betrieb* (NINA, Wetter, Auswertung) · *Einrichten* (Ausrüstung, Administration).
  - Aktiver Eintrag als gefüllte Fläche.
  - Unten in der Seitenleiste: *Einklappen*, *Impressum · Datenschutz · Quellen*, Version.
  - Beide Fußleisten entfallen auf Arbeitsseiten. Die Dichte wandert ins Benutzermenü, Textseiten behalten den Website-Fuß.
- **Seiten nach Entwurf:**
  - **Übersicht:** Kennzahlen-Kacheln oben (aktive Projekte, Warteschlange, Integration im Monat, nächste gute Nacht), darunter zwei Spalten.
  - **Projektliste / Warteschlange:** Filterleiste und Tabelle in **einer** Karte; Gruppenzeilen schlank; Zeilenaktionen im ⋯-Menü.
  - **Projekt-Editor:**
    - Titelzeile mit Kennzeichen und Metazeile (Rig, Fortschritt).
    - *Löschen* im ⋯-Menü.
    - Legende des Nachtdiagramms als Zeile über dem Diagramm.
    - Summenfuß im Plan.
  - **Ausrüstung:** *Speichern*/*Löschen* im Kartenkopf des Details, Felder in Abschnitten, Einheiten am Feld, berechnete Werte als Schlüssel-Wert-Liste mit fester Beschriftungsspalte.
  - **Objektbrowser:** Rig und Nacht in einer Kontextleiste; Zeilenaktionen als Symbolknöpfe (Saison, Sternkarte) plus *Projekt*.
  - **Übrige Seiten** (Wetter, Simulator, Sessions, NINA, Verwaltung, System, Persönlich): Gerüst, Karten und Knöpfe nach dem Stilsystem, ohne Funktionsänderung.

## Nicht im Umfang
- Neue Funktionen oder Daten, Änderungen an Engine und API.
- Diagramm-Inhalte: nur die Legenden-Anordnung ändert sich.

## Automatisierte Abnahme
- [ ] Token-Test angepasst (Kontrast ≥ 4,5:1 in beiden Themes für alle neuen Paare)
- [ ] Seitentests grün, axe ohne *serious*/*critical*; Breiten 768/1280/2400 px ohne horizontales Scrollen
- [ ] Messung wie im Befund: eine h1-Größe (24 px) auf allen Arbeitsseiten, Titel auf allen Bereichsseiten an derselben Stelle, Steuerhöhen nur 28/32 px
- [ ] CI grün, Changelog-Eintrag

## Menschliche Freigabe
Sichtabnahme Sven (Übersicht, Projektliste, Editor, Ausrüstung, Objektbrowser, hell und dunkel)
