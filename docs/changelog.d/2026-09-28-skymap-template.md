### Sternkarte wie die Astrotools-Vorlage

- **Rundblick als Start:** Ohne Blickrichtung in der Adresse öffnet die Karte wie die Vorlage mit dem Horizont unten, dem Blick nach Süden (Südhalbkugel: Norden) und 150° Sichtfeld. In „Horizont unten“ bleibt die Blickrichtung am Horizont verankert (`az`, `hoehe`): Beim Verändern der Zeit ziehen die Sterne durchs Bild, der Horizont bleibt stehen.
- **Horizont und Himmelsrichtungen:** Der Boden unter dem Horizont ist jetzt fast deckend und hat eine weiche Kante. N, NO, O, SO, S, SW, W und NW stehen knapp unter dem Horizont. Sterne, Planeten und Katalogobjekte unter dem Horizont erscheinen nur blass und ohne Namen.
- **Sternbild beim Überfahren:** Das nächste Sternbild (höchstens 24 px) wird hervorgehoben und fett beschriftet. Oben links stehen sein Name und der Name des überfahrenen Sterns. Auf Touch-Geräten wirkt ein Tipp genauso.
- **Objekte anklicken:** Sterne, Mond, Planeten, Sonne, Katalogobjekte und Projekte lassen sich anklicken, in der Reihenfolge der Vorlage. Das gewählte Objekt bekommt einen gestrichelten Ring. Die Infokarte liegt über der Karte unten rechts, damit auch im Vollbild.
  - Inhalt: Höhe und Richtung jetzt, Helligkeit, Sternbild (IAU-Grenzen über B1875), RA/Dec, Wikipedia, *Zentrieren*, *Bildfeld hierher*.
  - `Esc` schließt die Karte.
- **Bedienung wie die Vorlage:**
  - Runde Knopfleiste rechts in der Karte: + · − · zur vorigen/nächsten Himmelsrichtung · Rundblick · Vollbild.
  - Ecktexte: links die Dämmerung, rechts die Uhrzeit am Standort und bei dir, die Blickrichtung und das Sichtfeld.
  - Unter der Karte: ein Zeitschieber über die Nacht, die Zeitschritte, Chips für Linien, Namen, Grenzen, Gitter, Milchstraße und Himmelsfotos sowie die Auswahl der Namen (Deutsch bzw. Englisch oder Lateinisch, `namen=latein`).
  - Doppelklick zoomt hinein, mit Umschalt heraus.
- **Milchstraße:** Das Band wird jetzt wie in der Vorlage aus dem 0,5°-Raster gezeichnet: bilinear, als weiches Bild, zum Horizont hin schwächer, in der Dämmerung und beim Hineinzoomen zurückgenommen. Es ist etwa viermal kräftiger als bisher und trägt einen Namen.
- **Sternbildnamen:** Alle Sternbildnamen erscheinen ab 560 px Kartenbreite. Beschriftungen überdecken sich nicht mehr; der Vorrang folgt der Vorlage.
- **Neue Tokens:** `sky-const-line-hi`, `sky-const-label-hi`, `sky-compass`, `sky-compass-dim`, `sky-selected`, `sky-chrome-*`. Neue Symbole in components.md §3.
