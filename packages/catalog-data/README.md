# @nina-pm/catalog-data

Unveränderte Kopie der Katalog- und Sterndaten der Astro-Tools von www.svenesis.org (TK 3.1, FK 9).

- **Herkunft:** `legacy/astro-tools-2026-09-21/` (Website-Stand 21.09.2026, WS), Übernahme 23.09.2026 in AP-01 (H-03).
- **Inhalt:** `data/` vollständig aus `astro-tools/data`, dazu `js/dso-catalog.js`.
- **Schreibgeschützt:** nicht von Hand ändern. Die Dateien sind lokal mit `chmod a-w` gesperrt; im CI prüft `tools/repo-check`, dass jede Datei unverändert der Prüfsummenliste entspricht. Aktualisiert wird der Katalog nur über die portierten Generatoren (`tools/catalog`, AP-20) und mit neuer Prüfsummenliste.
- **Nicht enthalten:** OpenNGC `NGC.csv` und `addendum.csv` (Quelle des Objektkatalogs, kommen mit AP-20 nach `docs/specs/catalog/dso-import.md`), `js/star-catalog.js` (Sterne bis 6 mag, bleibt bis AP-21 in der Vorlage) und die Katalogbilder (132 MB, H-11 nach S3).

| Datei | Inhalt | Quelle und Lizenz (laut Dateikopf) |
|---|---|---|
| `data/ngc.json` | OpenNGC-Einträge mit Position, ergänzt um Sharpless-Regionen und Caldwell-Nummern | OpenNGC von Mattia Verga (CC BY-SA 4.0); Sharpless 1959 über VizieR VII/20 mit SIMBAD-Positionen; Caldwell-Liste aus der englischen Wikipedia (CC BY-SA 4.0). Die Datei steht unter CC BY-SA 4.0. |
| `js/dso-catalog.js` | 168 kuratierte Objekte mit Trivialnamen, Aliasen, Vorschaubild- und Wikipedia-Titeln | Positionen über SIMBAD (CDS, Straßburg); nach FK 9.1 nur Ergänzung für Namen, Aliase und Vorschaubilder, keine Quelle für Helligkeiten, Größen oder Typcodes |
| `data/stars-8.bin` | Sterne von 6,0 bis 8,0 mag (Binärformat, Beschreibung in `legacy/…/tools/star-catalog-data.js`) | d3-celestial von Olaf Frohn (BSD 3-Clause) aus XHIP/Hipparcos; Eigenbewegungen und Parallaxen aus Hipparcos New Reduction (van Leeuwen 2007, VizieR I/311) |
| `data/doubles.json` | Doppelsterne | Washington Double Star Catalog (U.S. Naval Observatory) über VizieR B/wds/wds, Positionen über SIMBAD |
| `data/sky-events.json` | Satelliten-Bahnelemente, Helligkeiten, Kometen (Stand 15.09.2026) | CelesTrak, Heavens-Above, JPL Small-Body Database |

Lizenzhinweise gesammelt in `THIRD_PARTY_NOTICES.md` (Wurzel des Repositorys).
