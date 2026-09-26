# AP-26f – Projekt-Editor ohne innere Rollbereiche, Sternkarte „Karte zuerst“

**Release:** UI-Überarbeitung (vor R3) · **Größe:** M · **Abhängigkeiten:** AP-26e · **Menschliche Aufgaben:** –

## Ziel
Im Projekt-Editor muss man heute in den einzelnen Bereichen rollen, und die Sternkarte ist unübersichtlich (Sven, 26.09.2026). Grundlage ist der Design-Canvas „Nachtdiagramm, Sternkarte, Editor Entwurf (AP-26e)“; Sven hat die zweispaltige Lösung gewählt.

## Lesen
- `docs/specs/ui/components.md` §2.3, §2.12
- `docs/rules/ui.md`
- FK S-31 (Projekt-Editor) und S-20 (Sternkarte) über `docs/concept/INDEX.md`

## Liefern
- **Projekt-Editor:**
  - Zwei Spalten ab 1280 px. Links die Karten *Ziel*, *Bedingungen* und *Belichtungsplan*, rechts *Nacht/Saison/Wetter* und *Bild & Notizen*. Die rechte Spalte bleibt beim Rollen stehen (`position: sticky`).
  - Unter 1280 px eine Spalte.
  - Keine festen Höhen mit Rollbalken mehr: die Seite rollt.
  - Das verknüpfte Katalogobjekt steht als Chip im Kartenkopf *Ziel*.
  - Der Wetter-Reiter zeigt die nächsten Nächte als Kacheln; ein Klick auf eine Nacht öffnet sie im Nacht-Reiter.
- **Sternkarte:**
  - Eine Werkzeugleiste über der Karte: Suche, Rig, Datum/Uhrzeit, *Jetzt*, *Neues Projekt mit …*.
  - Die Karte füllt die übrige Höhe; die Zeitleiste liegt unten in der Karte.
  - Rechts ein Seitenbereich mit den Reitern *Objekt* (Angaben, Nachtdiagramm, Aktionen), *Bildfeld & Mosaik* und *Ebenen*.
  - Die bisherigen Einstellungskarten über der Karte entfallen.
- Tests angepasst, Changelog.

## Nicht im Umfang
- Neue Funktionen, Engine, API.

## Automatisierte Abnahme
- [ ] Editor bei 1280 × 800 ohne Element mit eigenem Rollbalken (außer Tabellen mit horizontalem Überlauf); axe
- [ ] Sternkarte bei 1440 × 900: Karte mindestens 560 px hoch; Seitenreiter per Tastatur bedienbar
- [ ] 768 px ohne horizontales Scrollen
- [ ] CI grün, Changelog-Eintrag

## Menschliche Freigabe
Sichtabnahme Sven (Editor, Sternkarte)
