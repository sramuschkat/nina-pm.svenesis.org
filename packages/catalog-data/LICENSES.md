# Lizenzen der Katalogdaten

## OpenNGC (Objektkatalog, AP-20)

- **Quelle:** OpenNGC von Mattia Verga, https://github.com/mattiaverga/OpenNGC
- **Version:** `v20260501` (veröffentlicht 01.05.2026), **abgerufen 25.09.2026**
- **Dateien:** `openngc/NGC.csv` (13.969 Zeilen), `openngc/addendum.csv` (64 Zeilen), unverändert; URLs und SHA-256 in `openngc/VERSION.json`
- **Lizenz:** Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0), https://creativecommons.org/licenses/by-sa/4.0/
- **Abgeleitete Werke** (ebenfalls CC BY-SA 4.0): `openngc/dso-objects.json` (von `pnpm catalog:build` nach `docs/specs/catalog/dso-import.md` erzeugt, Quelle des Jobs `catalog_refresh` → `dso_object`), `openngc/catalog-meta.json`, `openngc/import-report.md`. Jede Zeile trägt in `source` Datei, Version und Abrufdatum.

## Website-Auszug (Namen, Aliase, Sharpless-Regionen)

- `data/ngc.json` – aus OpenNGC abgeleitet, ergänzt um Sharpless-Regionen (Sharpless 1959, VizieR VII/20, Positionen SIMBAD/CDS Straßburg) und Caldwell-Nummern (englische Wikipedia); CC BY-SA 4.0. Liefert im Objektkatalog nur Namen, Aliase und die 265 Sharpless-Regionen ohne OpenNGC-Zeile (ohne Helligkeiten).
- `js/dso-catalog.js` – 168 kuratierte Objekte (Trivialnamen, Aliase, Wikipedia-Titel); keine Quelle für Helligkeiten, Größen oder Typcodes.

Die übrigen Dateien unter `data/` und ihre Quellen stehen in `README.md`; gesammelte Hinweise in `THIRD_PARTY_NOTICES.md` (Wurzel des Repositorys).
