# @nina-pm/catalog-data

Unveränderte Kopie der Katalog- und Sterndaten der Astro-Tools von www.svenesis.org (TK 3.1, FK 9).

- **Herkunft:** `legacy/astro-tools-2026-09-21/` (Website-Stand 21.09.2026, WS), Übernahme 23.09.2026 in AP-01 (H-03).
- **Inhalt:** `data/` vollständig aus `astro-tools/data`, dazu `js/dso-catalog.js` und (seit AP-21) `js/star-catalog.js`.
- **Schreibgeschützt:** nicht von Hand ändern. Die Dateien sind lokal mit `chmod a-w` gesperrt; im CI prüft `tools/repo-check`, dass jede Datei unverändert der Prüfsummenliste entspricht. Aktualisiert wird der Website-Auszug nur mit neuer Prüfsummenliste; der Ordner `openngc/` gehört nicht dazu (Prüfsummen in `openngc/VERSION.json`, Ausgabe deterministisch aus `pnpm catalog:build`, geprüft in `tools/catalog-import/test`).
- **OpenNGC (AP-20):** `openngc/NGC.csv` und `openngc/addendum.csv` in Version `v20260501` (abgerufen 25.09.2026, Prüfsummen in `openngc/VERSION.json`), daraus erzeugt `pnpm catalog:build` den Objektkatalog `openngc/dso-objects.json` (13.969 + 64 Quellzeilen → 13.632 Zeilen), `catalog-meta.json`, `wikipedia.json` (Wikipedia-Titel je Objekt aus dem Website-Auszug) und `import-report.md` nach `docs/specs/catalog/dso-import.md`. Lizenzen in `LICENSES.md`. Neue OpenNGC-Version: Dateien und `VERSION.json` ersetzen, `pnpm catalog:build`, Zahlen in FK/TK/Spezifikation nachziehen (WS-27).
- **Sternkarte (AP-21):** `pnpm catalog:build` erzeugt aus `js/star-catalog.js` die Datei `sky/sky.json` (Sterne bis 6 mag, Sternbildlinien, -grenzen und -namen, Milchstraße); die Sterne von 6 bis 8 mag lädt die Karte aus `data/stars-8.bin`.
- **Nicht enthalten:** die Katalogbilder (132 MB) – `pnpm catalog:upload` kopiert sie aus dem Website-Ordner nach S3 `catalog/img/…` (H-11).

| Datei | Inhalt | Quelle und Lizenz (laut Dateikopf) |
|---|---|---|
| `data/ngc.json` | OpenNGC-Einträge mit Position, ergänzt um Sharpless-Regionen und Caldwell-Nummern | OpenNGC von Mattia Verga (CC BY-SA 4.0); Sharpless 1959 über VizieR VII/20 mit SIMBAD-Positionen; Caldwell-Liste aus der englischen Wikipedia (CC BY-SA 4.0). Die Datei steht unter CC BY-SA 4.0. |
| `js/dso-catalog.js` | 168 kuratierte Objekte mit Trivialnamen, Aliasen, Vorschaubild- und Wikipedia-Titeln | Positionen über SIMBAD (CDS, Straßburg); nach FK 9.1 nur Ergänzung für Namen, Aliase und Vorschaubilder, keine Quelle für Helligkeiten, Größen oder Typcodes |
| `js/star-catalog.js` | Sterne bis 6 mag mit Namen und Bayer-Buchstaben, Sternbildlinien, -grenzen und -namen, Milchstraße | d3-celestial von Olaf Frohn (BSD 3-Clause) aus XHIP/Hipparcos; Sternbildgrenzen IAU; Milky Way Outline Catalog (J. R. Vieira) |
| `data/stars-8.bin` | Sterne von 6,0 bis 8,0 mag (Binärformat, Beschreibung in `legacy/…/tools/star-catalog-data.js`) | d3-celestial von Olaf Frohn (BSD 3-Clause) aus XHIP/Hipparcos; Eigenbewegungen und Parallaxen aus Hipparcos New Reduction (van Leeuwen 2007, VizieR I/311) |
| `data/doubles.json` | Doppelsterne | Washington Double Star Catalog (U.S. Naval Observatory) über VizieR B/wds/wds, Positionen über SIMBAD |
| `data/sky-events.json` | Satelliten-Bahnelemente, Helligkeiten, Kometen (Stand 15.09.2026) | CelesTrak, Heavens-Above, JPL Small-Body Database |

Lizenzhinweise gesammelt in `THIRD_PARTY_NOTICES.md` (Wurzel des Repositorys).
