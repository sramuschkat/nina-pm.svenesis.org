# AP-26h – Vorschaubilder in Listen, Filterplan fluchtend, Simulator: Protokoll folgt der Uhrzeit

**Release:** UI-Überarbeitung (vor R3) · **Größe:** S · **Abhängigkeiten:** AP-26g · **Menschliche Aufgaben:** –

## Ziel
Wünsche Sven vom 26.09.2026:
- In der Spalte *Plan je Filter* stehen die Balken nicht untereinander, weil die Filterkürzel verschieden breit sind.
- Alle Projektlisten zeigen ein kleines Vorschaubild; beim Überfahren erscheint das große. Im Objektbrowser (*Alle Objekte*, *Beste der Nacht*) gilt dasselbe beim Überfahren.
- Im Simulator ist die Schrift der Zielkarten deutlich kleiner.
- Beim Verschieben der Uhrzeit springt das Planprotokoll zur passenden Zeile und markiert sie.

## Lesen
- `docs/specs/ui/components.md` §2.1 (`FilterChip`), §2.11 (`DataTable`)
- FK FA-SIM-02, FA-SIM-08
- `packages/shared/src/contracts/approval.ts` (`QueueItem`)

## Liefern
- **Vertrag:** `QueueItem.dsoPrimaryId` und `QueueItem.thumbnailUrl`, damit auch die Warteschlange Vorschaubilder zeigen kann. OpenAPI und Web-Typen sind neu erzeugt.
- **`ThumbPreview`** (components.md §2.16): kleines Bild, große Fassung als Portal beim Überfahren.
  - Projektliste, Warteschlange und Entwürfe: Bildspalte mit Priorität 1.
  - Meine Objekte: Bild im Kartentitel.
  - Objektbrowser: Hover-Vorschau am vorhandenen Listenbild.
- **Plan je Filter:** ein gemeinsames Raster (`max-content` für die Filtermarke), Marken gleich breit.
- **Simulator:**
  - Zielkarten mit 11 px Schrift, Titel 13 px.
  - Das Protokoll markiert die Zeile zur Uhrzeit (`aria-current`, hervorgehoben) und rollt nur das Protokoll, nicht die Seite, sodass sie in der Mitte steht.

## Automatisierte Abnahme
- [ ] `ThumbPreview`: große Fassung erst beim Überfahren, Portal, `aria-hidden`; axe
- [ ] Simulator: nach dem Verschieben genau eine Zeile mit `aria-current`, Zeit ≤ Uhrzeit
- [ ] API-Vertrag: OpenAPI-Diff grün; Typecheck, Lint, CI grün, Changelog

## Menschliche Freigabe
Sichtabnahme Sven
