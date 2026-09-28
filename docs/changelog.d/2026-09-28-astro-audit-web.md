### Astronomie-Prüfung: Korrekturen in Sternkarte, Katalog und Eingabe

**Sternkarte**
- **Meridian:** Die Ebene „Meridian“ zeichnet jetzt den Großkreis Nord – Zenit – Süd. Vorher war es die halbe Ost-West-Linie durch den Ostpunkt.
- **Mindesthöhen-Linie:** Sie steht jetzt dort, wo die Planung die Grenze zieht, also bei der scheinbaren Höhe. Vorher lag sie bei 20° um 2,7′ zu hoch.
- **Nacht an Umstellungstagen:** Die Nacht wird über die Ortszeit bestimmt. An Umstellungstagen lud die Karte vorher eine Stunde lang die falsche Nacht.
- **Gitterbeschriftung:** RA erscheint mit Sekunden und Übertrag (nie „0h60m“), Dec bei feinem Raster in Bogenminuten.
- **Ellipsen der Katalogobjekte:** Sie nutzen den Maßstab der Projektion am Objekt. Vorher waren sie bei weiten Ansichten bis 27 % zu groß.
- **Eigenbewegung:** Sterne bewegen sich von 2000 bis heute, für die Sterne bis 6 mag neu in `sky.json`, für die bis 8 mag aus `stars-8.bin`.
- **Rig ohne Rotator:** Das Bildfeld steht im Kamerawinkel, so wie NINA aufnimmt und „Ins Projekt übernehmen“ speichert. Ein abweichend gewählter Winkel erscheint gestrichelt.
- **Infokarte:** Sie zeigt die scheinbare Höhe, wie Planung und Zeitleiste.

**Objektbrowser**
- **Gipfelhöhe:** Sie wird zusätzlich an Beginn und Ende der Dunkelheit geprüft. Vorher war sie für Objekte, die nach der Dämmerung untergehen, um bis zu ≈ 1° zu tief.

**Katalog**
- Die 265 Sharpless-Regionen und OpenNGC-Zeilen mit unbekanntem Sternbild bekommen ihr Sternbild aus den IAU-Grenzen, mit derselben Zuordnung wie die Sternkarte (jetzt `sky.constellationAt` der Engine). Dadurch findet der Sternbild-Filter sie.

**Koordinateneingabe**
- „12 345“ ohne Trenner ist ungültig und wird nicht mehr still als 12°34′05″ gelesen.
- „12h“ bzw. „5,5 h“ ist als RA erlaubt.
- Die dezimale Anzeige zeigt nie „360“.
- Ein winziger negativer Wert erscheint nicht als „−00° 00′ 00″“.
