### Sternkarte – Safari flüssig, Meridian kräftiger, Heatmap als Verlauf

- Safari: Ziehen und Zoomen schrieben bei jedem Mausereignis die Adresse (`history.replaceState`); Safari bricht das nach ~100 Aufrufen mit einem SecurityError ab – die Karte reagierte nicht mehr. Jetzt hält die Seite die Ansicht beim Ziehen lokal und schreibt die Adresse 400 ms nach der letzten Bewegung. Außerdem: Zeichenfläche nur bei Größenänderung neu anlegen, Farben einmal lesen, Ziehen und Mausrad höchstens einmal je Frame melden (Mausrad-Schritte aufsummiert), Zwischenbild der Zellen-Ebenen wiederverwenden.
- Meridian kräftiger: Violett wie im Nachtdiagramm, 1,5 px, längere Striche (`sky-meridian`).
- Heatmap unter der Höhen-Schwelle als Verlauf statt grau wirkender Fläche: an der Schwelle hell und zart, zum Horizont dunkler und kräftiger (`sky-heatmap-top`, `sky-heatmap-bottom`).
