### Transitsuche: Details in der Tabelle, Zeitleiste mit Lichtkurve, Filter wie Astro PM (2026-09-30)

Anforderungen: FA-EXO-05, FA-EXO-10…14, FA-EXO-19, S-22 · transit.md §5 · components.md §2.3 · Wunsch und Entscheidung Sven 30.09.2026

- **Details inline:** Aufklappen einer Tabellenzeile zeigt die Details direkt darunter, nach der Vorlage aus Svens Screenshot:
  - Zeitleiste der Nacht von Mittag bis Mittag (FK 14.3) mit Tageshimmel, Zielhöhe, Mond, Mindesthöhe, Meridian und Jetzt-Linie;
  - darin das Beobachtungsfenster mit „Start“/„Ende“, die Kontaktzeiten und die **Lichtkurve** als gelbe Linie mit Prozentachse und Tiefe;
  - darunter drei Karten: Sternfeld (DSS2) mit „In Framing öffnen“, Himmelsposition mit Fadenkreuz und Namen, Reiter *Zieldetails* / *Meine Beobachtungen*.
  - Zieldetails als Raster mit Hilfesymbol und Erklärung je Größe (FA-EXO-13): Katalog, Koordinaten, Entfernung, Helligkeit, Tiefe, Rp/R★, Typ, Spektraltyp, Dauer, Periode, Ingress/Mitte/Egress mit Höhe, Fenster, Unsicherheit, Mond, Öffnung. Dazu Filterempfehlung, Recherche und Ephemeridenquelle.
- **Nachtdiagramm:** neues optionales Feld `transit` (Fenster, Kontakte, Lichtkurve); neue Tokens `chart-flux` und `chart-window`. Der eigene Lichtkurven-Baustein entfällt.
- **Filter „Start/Ende dunkel“, „über Mindesthöhe“ und „Flip ausblenden“** prüfen jetzt **Ingress − 1 h bis Egress + 1 h** (FA-EXO-19; Engine 0.13.0, `meridianNearTransit`).
  - Abgleich mit Astro PM, Starfront, 29.09. und 01.10.2026: deckungsgleich bis auf den Katalogstand (Astro PM kennt TOIs ab etwa 2025 nicht).
  - Die Lesart „nur Ingress/Egress“ aus #147 zeigte am 01.10. 45 statt 12 Transits.
- **Bewusst anders als Astro PM:** Transits mit einer Unsicherheit von mehreren Stunden (σ 3–5,5 h, z. B. TOI-3748.01, TOI-5329.01) gelten bei uns nach AST-T19 nicht als beobachtbar.
