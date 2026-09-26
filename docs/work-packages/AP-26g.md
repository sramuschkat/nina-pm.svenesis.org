# AP-26g – Nacht-Simulator auf einer Seite: Zielkarten, Plangrafik, kompaktes Planprotokoll

**Release:** UI-Überarbeitung (vor R3) · **Größe:** S · **Abhängigkeiten:** AP-26f · **Menschliche Aufgaben:** –

## Ziel
Der Simulator zeigt das Ergebnis ohne Reiter, untereinander wie in Svens Screenshot vom 26.09.2026: Zielkarten, darunter die Plangrafik, darunter das Planprotokoll. Das Protokoll ist sehr kompakt (Festbreitenschrift, kleine Schrift), die Zielkarten sind kompakter.

## Lesen
- FK FA-SIM-01, FA-SIM-06, FA-SIM-07, FA-SIM-08 (über `docs/concept/INDEX.md`)
- `docs/specs/ui/components.md` §2.3, §2.11
- `docs/rules/ui.md`

## Liefern
- **Ergebnis ohne Reiter**, in dieser Reihenfolge:
  - *Zielkarten* (mit „nicht zugeteilt“) als Raster.
  - *Nachtplan*: Kopfzeile mit Standortzeit, dunklen Stunden, Zielen, Aufnahmen und Mond; darunter Plangrafik und Zeitschieber.
  - *Planprotokoll* mit *Kopieren* und *CSV* im Kopf.
  - *Prüfungen* (Warnungen und Diagnosen) und Plan-Hash am Ende.
- **Zielkarten kompakt:**
  - Kleine Schrift, Kennwerte zweispaltig, Filterzeilen einzeilig, Prüfliste eng.
  - Ein Klick auf den Kartentitel wählt das Ziel (`aria-pressed`). Die Karte bekommt dann einen Rand in Zielfarbe, und die Plangrafik hebt seine Blöcke hervor (`NightChart.highlightBlockIds`).
- **Planprotokoll:**
  - Festbreitenschrift (`--npm-font-mono`), 12 px, Zeilen 22 px.
  - Höhe begrenzt mit stehendem Kopf; das Protokoll ist die einzige Liste mit eigenem Rollbalken (Hunderte Zeilen).
  - Spalten wie bisher, Sortieren wie bisher.
- Tests (Unit, E2E) auf den Aufbau ohne Reiter umgestellt; Changelog.

## Nicht im Umfang
- Engine, Protokollinhalt, Einstellungen.

## Automatisierte Abnahme
- [ ] Keine Reiterleiste im Ergebnis; Zielkarten, Plangrafik und Protokoll gleichzeitig im Dokument
- [ ] Kartentitel wählt das Ziel; die Plangrafik hebt dessen Blöcke hervor
- [ ] axe ohne *serious*/*critical*; 768/2400 px ohne horizontales Scrollen
- [ ] CI grün, Changelog-Eintrag

## Menschliche Freigabe
Sichtabnahme Sven
