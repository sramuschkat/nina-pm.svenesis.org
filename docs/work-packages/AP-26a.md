# AP-26a – Tabellen: sortierbar, Spalten ausblenden statt scrollen

**Release:** UI-Überarbeitung (vor R3) · **Größe:** M · **Abhängigkeiten:** AP-25 · **Menschliche Aufgaben:** –

## Ziel
Alle Datentabellen lassen sich per Klick auf den Spaltenkopf sortieren und laufen bei wenig Platz nicht mehr seitlich über, sondern blenden weniger wichtige Spalten aus (Entscheidung Sven, 26.09.2026).

## Anforderungen
NFA-01 (volle Breite, 768 px ohne horizontales Scrollen), FK 14.1/14.4, `../ui/bestandsaufnahme-2026-09-26.md` §1

## Lesen (nur diese Abschnitte)
- `../ui/bestandsaufnahme-2026-09-26.md` §1
- specs/ui/components.md §1 (allgemeine Regeln) und §4
- rules/ui.md
- `CLAUDE.md`, `docs/rules/testing.md`

## Liefern
- **Baustein `DataTable`** (neuer Vertrag components.md §2.11):
  - Sortieren per Klick auf den Spaltenkopf: auf-, absteigend, aus; `aria-sort`; stabil; `null` zuletzt; Zeichenketten mit Ziffernfolge natürlich sortiert.
  - Optional gesteuert, damit Seiten den Zustand in der URL halten oder serverseitig sortieren.
  - **Spalten mit Priorität:** Passt die Tabelle nicht in den Container, werden Spalten mit der niedrigsten Priorität ausgeblendet, bis sie passt – nie horizontal scrollen. Ausgeblendete Werte stehen in einer je Zeile aufklappbaren Detailzeile.
  - Gruppen als Zwischenüberschriften in **einer** Tabelle (Spalten fluchten).
  - Stehender Kopf, Zustände leer/laden/Fehler, Tastatur, Textalternative ist die Tabelle selbst.
- **Umstellung aller Datentabellen:**
  - Projektliste (je Rig gruppiert), Warteschlange (ersetzt die Eigenlösung), Entwürfe.
  - Objektbrowser (Sortierung serverseitig über die Spaltenköpfe, die Auswahlliste *Sortierung* entfällt).
  - Sessions und Session-Detail, Mitglieder und Einladungen, Änderungsprotokoll/Audit, Mandanten, Super-User, NINA-Instanzen, persönliche Sitzungen.
  - Ausrüstungslisten und Wetter-Nachttabelle.
- **Bearbeitbare Tabellen** (Belichtungsplan, Panel-Liste, Belichtungsvorlagen, Filterrad) behalten ihre fachliche Reihenfolge (NINA-Reihenfolge) und werden **nicht** sortiert, blenden bei Platzmangel aber ebenfalls Spalten aus.
- Kompakte Zellen: Plan als eine Zeile mit Tooltip, Status in einer Zeile, Namen ohne Umbruch.

## Nicht im Umfang
- Reiter und Seitenaufbau (AP-26b), Filterleisten, Kopf und Startseite (AP-26c)
- Textalternativen der Diagramme (NightChart, SeasonChart, WeatherChart) – sie bleiben einfache Tabellen hinter `<details>`

## Automatisierte Abnahme
- [ ] Komponententests `DataTable`: Sortierung (auf/ab/aus, stabil, `null` zuletzt, natürliche Reihenfolge), `aria-sort`, gesteuert, Ausblenden nach Priorität bei schmalem Container mit Detailzeile, Gruppen, Zustände, Tastatur, axe
- [ ] Seitentests der umgestellten Tabellen weiter grün; je Seite ein Sortiertest an einer Stichprobe
- [ ] E2E: Projektliste und Warteschlange bei 768 und 1280 px ohne horizontales Scrollen der Tabelle
- [ ] CI grün, Changelog-Eintrag, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
Sichtabnahme Sven (Projektliste, Warteschlange, Objektbrowser bei 1280 und 768 px)
