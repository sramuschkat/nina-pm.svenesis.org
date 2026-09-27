### Planung – nur Mondkalender, ruhigerer Kalender, eine Tabelle im Objektbrowser, Wikipedia mit „W“ (2026-09-27)

Anforderungen: S-20, S-21, FA-FRM-13, FA-FRM-14 · Wunsch Sven 27.09.2026

- **Datum (Objektbrowser und Sternkarte):** Das Datumsfeld des Browsers entfällt. Das Datum („So., 27.09.2026“) ist ein Knopf, der nur den eigenen Mondkalender öffnet; ← → wechseln weiter die Nacht.
- **Mondkalender:** Hervorgehoben sind nur noch die gewählte Nacht (gefüllt), die heutige Nacht (orange Rahmen) und die drei besten Nächte (Stern). Die Tönung der Wochenend-Nächte und die Rahmen der Mondviertel entfallen; die Viertel stehen weiter mit Namen am Tag und mit Uhrzeit unter dem Kalender.
- **Objektbrowser – eine Tabelle:** Die Reiter *Beste der Nacht* und *Alle Objekte* sind zusammengeführt. Mit Rig zeigt die Tabelle immer Bewertung und Filterempfehlung und ist standardmäßig nach der Bewertung sortiert; jede Spalte lässt sich sortieren (auch in der Galerie). *Nur Bildkandidaten* ist ein Filter unter „Weitere Filter“ (URL `kandidaten=1`), die Auswahl *Familie* entfällt zugunsten des Typs. Server: Objekte ohne Bewertung stehen bei der Sortierung nach Bewertung hinten statt zu fehlen; nur mit `candidates=true` bleiben sie weg. Die 20°-Regel der Website gehört jetzt zur Bewertung selbst.
- **Wikipedia:** Links tragen ein „W“ in Serifenschrift (Tabelle: Symbolknopf „W“; Galerie, Sternkarte, Projekteditor: „W Wikipedia“). Das Puzzle-Globus-Logo ist eine geschützte Marke der Wikimedia Foundation und wird deshalb nicht verwendet. Neuer Token `--npm-font-serif`.
- Tests: Modell und Seite des Objektbrowsers, Mondkalender, E2E Objektbrowser und Sternkarte.
