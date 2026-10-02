### Sternkarte – Heatmap, Horizontschimmer und Milchstraße wieder farbig

- Der CSS-Minifier liefert die Tokens als `#rrggbbaa` bzw. `#fff`; die Sternkarte verstand nur `#rrggbb` und `rgba()` und zeichnete Heatmap, Horizontschimmer und Milchstraße in deckendem Grau. Neuer gemeinsamer Parser `lib/color.ts` (`#rgb` … `#rrggbbaa`, `rgb()`/`rgba()` mit Kommas, Leerzeichen, `/ Deckkraft`) für Sternkarte, Filterbalken-Helligkeit und die Kontrastanpassung im Filterspektrum (helles Theme: `--npm-white` = `#fff`).
