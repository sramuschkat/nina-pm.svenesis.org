### AP-10 / AP-09b – Nachtdiagramm und Filterspektrum nach Svens Vorlage (2026-09-24)

- Nachtdiagramm im Stil von Svens Screenshot:
  - Himmel als Farbverlauf nach Sonnenhöhe (golden → blau → dunkel), in beiden Themes gleich; die Farben kommen aus `SKY_STOPS` und `--npm-chart-*` in `@nina-pm/ui-tokens`.
  - Dämmerungswechsel mit Kürzel B/N/A (EN C/N/A).
  - Mond als rote Fläche mit Beleuchtung „Mond n %“; Mindesthöhe rot gestrichelt; Hauptziel hell.
  - Zonenkürzel am Ende jeder Achsenzeile.
- Stundenstreifen unter dem Diagramm: *Empfohlene Belichtungszeit* (aus der Engine), *über Mindesthöhe ohne Mond*, *mit Mond*, *über Mindesthöhe* und *astronomisch dunkel*.
- Legende rechts mit Checkbox je Ebene und Stundensumme je Streifen.
- Adapter `nightChartFromEngine`: Neu dabei sind die Sonnenkurve und die empfohlene Zeit des Hauptziels (optional mit Mondprofil).
- Das Canvas zeichnet bei Wechsel von Theme oder Dichte neu.
- `components.md` §2.3 entsprechend ergänzt (`sun`, `recommended`, Himmel, Streifen, Legende).
- Filterspektrum S-14 (`FilterSpectrum.tsx`) nach Svens Vorlage:
  - Bereich 380–750 nm; Filter außerhalb erweitern ihn in 50-nm-Schritten.
  - Blasser Spektralgrund und voller Farbbalken am Fuß; Farben aus `SPECTRUM_STOPS` in `@nina-pm/ui-tokens`.
  - Raster je 10 % und 50 nm; Achsentitel „Transmission [%]“ und „Wellenlänge (nm)“.
  - Je Filter ein Trapez in seiner Farbe, darüber „OIII 500,7 nm / 4,5 nm“ mit Führungslinie. Überlappende Beschriftungen rücken in eine weitere Zeile.
  - Die Beschriftungsfarbe wird aufgehellt bzw. abgedunkelt, bis der Kontrast 4,5:1 zum Theme-Grund erreicht.
- Nachtdiagramm: Die Mondbeleuchtung steht als Text („Mond n %“) statt als Symbolzeichen (rules/ui.md: keine Emoji).
