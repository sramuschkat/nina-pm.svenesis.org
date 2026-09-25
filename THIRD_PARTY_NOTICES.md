# Third-Party Notices

Lizenzhinweise für übernommenen Code und übernommene Daten. Weitere Einträge (z. B. Jint, NuGet-Pakete) ergänzt Claude Code mit dem jeweiligen Arbeitspaket.

## Astro PM – N.I.N.A. Plugin

Quelle: https://github.com/Josh-Jones-76/AstroPM.NINA.Plugin (Commit 5dd621d, v1.6.0.0)
Verwendung: Planungsalgorithmus (portiert nach TypeScript, `packages/engine/src/plan`), Ausführungsmuster im NINA-Plugin (`apps/nina-plugin/NinaPm.Nina`), Vergleichsorakel (`tools/astropm-oracle`).

```
MIT License

Copyright (c) 2026 Astro PM

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## OpenNGC

Quelle: https://github.com/mattiaverga/OpenNGC (Mattia Verga), `NGC.csv` und `addendum.csv`
Lizenz: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0), https://creativecommons.org/licenses/by-sa/4.0/
Verwendung: `packages/catalog-data/data/ngc.json` (abgeleitet aus OpenNGC, ergänzt um Sharpless-Regionen aus VizieR VII/20 mit SIMBAD-Positionen und Caldwell-Nummern aus der englischen Wikipedia, ebenfalls CC BY-SA 4.0; die Datei steht unter CC BY-SA 4.0). Seit AP-20 Quelle des Objektkatalogs `dso_object`: `packages/catalog-data/openngc/` mit `NGC.csv` und `addendum.csv` in Version v20260501 (abgerufen 25.09.2026, unverändert) und dem daraus abgeleiteten `dso-objects.json` (CC BY-SA 4.0); Version und Abrufdatum stehen je Zeile in `dso_object.source`, in `packages/catalog-data/LICENSES.md` und auf der Seite *Quellen* der Anwendung.

## d3-celestial

Quelle: https://github.com/ofrohn/d3-celestial (Olaf Frohn)
Verwendung: Sterndaten `packages/catalog-data/data/stars-8.bin` und `packages/catalog-data/js/star-catalog.js` (erzeugt aus den Datendateien von d3-celestial, XHIP/Hipparcos; unveränderte Kopien der Website-Vorlage), daraus `packages/catalog-data/sky/sky.json` (`pnpm catalog:build`) – Sterne, Sternbildlinien, -grenzen, -namen und Milchstraße der Sternkarte S-20 (AP-21).

```
Copyright (c) 2015, Olaf Frohn
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Weitere Datenquellen in `packages/catalog-data`

- Hipparcos New Reduction (van Leeuwen 2007, VizieR I/311): Eigenbewegungen und Parallaxen in `data/stars-8.bin`.
- Washington Double Star Catalog (Mason et al., U.S. Naval Observatory) über VizieR B/wds/wds: `data/doubles.json`.
- SIMBAD und VizieR (CDS, Straßburg): Positionen in `data/ngc.json`, `data/doubles.json` und `js/dso-catalog.js`.
- CelesTrak (Bahnelemente), Heavens-Above (Helligkeiten), JPL Small-Body Database (Kometen): `data/sky-events.json`.
