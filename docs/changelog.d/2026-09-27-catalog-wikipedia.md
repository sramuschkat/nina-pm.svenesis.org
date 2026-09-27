### Katalog – Wikipedia-Link je Objekt wie in der Astro-Tools-Vorlage (2026-09-27)

Anforderungen: FA-FRM-14, dso-import.md §2 · Wunsch Sven 27.09.2026

- `pnpm catalog:build` übernimmt die Wikipedia-Titel des Website-Auszugs (`wde`/`wen` aus `js/dso-catalog.js`, Feld 10 aus `data/ngc.json`) nach `packages/catalog-data/openngc/wikipedia.json` – 12.870 von 13.632 Zeilen haben einen Artikel; keine Änderung an `dso_object` (dso-import.md §2), keine Migration.
- `packages/shared`: `wikiDesignation` (`M 31` → `Messier 31`) und `wikipediaLink` nach dem Beobachtungsplaner der Vorlage: Artikel in der Sprache der Oberfläche, sonst der der anderen Sprache („Wikipedia (EN)“), sonst die Suche.
- Oberfläche: Wikipedia-Link im Objektbrowser (Symbolknopf in der Tabelle, Knopf in der Galerie), in der Infokarte der Sternkarte (Artikel statt Suche, an erster Stelle) und bei den Recherche-Links im Projekteditor. Die Titel laden einmal als eigener Teil nach (≈ 39 kB gzip).
- Tests: Importer (Vorrang, Zusammenführen, Ausgabe entspricht dem Build), `wikipediaLink`, Objektbrowser und Sternkarte.
