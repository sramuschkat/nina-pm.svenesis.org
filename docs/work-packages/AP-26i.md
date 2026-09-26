# AP-26i – Objektbrowser „Beste der Nacht“ zuerst, Filtermarken seitenweit gleich breit, Sternkarte mit einklappbarem Seitenbereich, Scheduler nur im Simulator

**Release:** UI-Überarbeitung (vor R3) · **Größe:** M · **Abhängigkeiten:** AP-26h · **Menschliche Aufgaben:** –

## Ziel
Wünsche Sven vom 26.09.2026:
- **Objektbrowser:** *Beste der Nacht* ist der erste Reiter; auch dort steht das kleine Bild in der ersten Spalte.
- **Projektlisten:** Der breiteste Filtername bestimmt die Breite aller Filtermarken, damit die Balken über die ganze Liste fluchten.
- **Nacht-Simulator:** Die Einstellungen werden übersichtlicher.
- **Scheduler nur im Simulator** (Entscheidung Sven, 26.09.2026). Die Scheduler-Einstellungen standen doppelt, im Simulator und unter Ausrüstung → Rigs → Scheduler. Bearbeitet wird künftig nur im Simulator, weil man dort die Wirkung sofort sieht (FA-SIM-01). Am Rig bleibt eine Zusammenfassung mit Link.
- **Sternkarte:** Rechts stehen nur noch *Bildfeld & Mosaik* und *Ebenen*, einklappbar. Die Objektangaben stehen unter der Karte in voller Breite.

## Lesen
- FK FA-SCH-01…05, FA-SIM-01, FA-FRM-13 (`docs/concept/INDEX.md`)
- `docs/specs/ui/components.md` §2.11, §2.12

## Liefern
- **Objektbrowser:**
  - Reiter in der Reihenfolge *Beste der Nacht*, *Alle Objekte*; *Beste der Nacht* ist Standard, und `reiter=alle` wählt die Liste.
  - Die Bildspalte ist immer sichtbar (Priorität 1), mit Hover-Vorschau (AP-26h).
- **Projektlisten:** `ProjectsLayout` misst nach dem Zeichnen und bei jeder Listenänderung die breiteste Filtermarke. Das Ergebnis gilt als `--plan-chip-w` für *Plan je Filter* und die Plan-Chips der Warteschlange.
- **Scheduler-Einstellungen:**
  - **Im Simulator:** sechs kompakte Abschnitte im Raster (Verteilung, Sortierkette doppelt breit, Belichtung, Flats, Meridian-Flip, Overheads); Felder 28 px, Zahlenfelder paarweise, eigener *Speichern*-Knopf im Kopf.
  - Hinweis und NINA-Übernahme stehen in einer Zeile.
  - `einstellungen=1` öffnet die Einstellungen.
- **Rig → Scheduler:** Zusammenfassung (Strategie, Wiedergabe, Sortierkette, Überschuss, Bonus, Dither, Filterwechsel, Flats, Meridian-Flip) mit Link *Im Simulator bearbeiten*; kein *Speichern* mehr im Kartenkopf dieses Reiters.
- **Sternkarte:**
  - Der Seitenbereich rechts hat die Reiter *Bildfeld & Mosaik* und *Ebenen* und lässt sich einklappen; zugeklappt bleibt nur ein 40 px breiter Knopf, und der Zustand wird je Browser gemerkt.
  - Unter der Karte in voller Breite stehen das gewählte Objekt, die Mitte des Bildfelds und das Nachtdiagramm.

## Automatisierte Abnahme
- [ ] Objektbrowser: Standard *Beste der Nacht*, Bild in der ersten Spalte
- [ ] Sternkarte: zwei Seitenreiter, Einklappen/Einblenden, Objektbereich unter der Karte
- [ ] Rigs: Scheduler-Reiter als Zusammenfassung mit Link; Scheduler-Speichern und 412 im Simulator (E2E)
- [ ] CI grün, Changelog-Eintrag

## Menschliche Freigabe
Sichtabnahme Sven
