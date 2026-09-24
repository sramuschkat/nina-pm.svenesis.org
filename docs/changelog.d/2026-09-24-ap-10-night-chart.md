### AP-10 – Nachtdiagramm nach Svens Vorlage (2026-09-24)

- Nachtdiagramm im Stil von Svens Screenshot:
  - Himmel als Farbverlauf nach Sonnenhöhe (golden → blau → dunkel), in beiden Themes gleich; die Farben kommen aus `SKY_STOPS` und `--npm-chart-*` in `@nina-pm/ui-tokens`.
  - Dämmerungswechsel mit Kürzel B/N/A (EN C/N/A).
  - Mond als rote Fläche mit Beleuchtung `☽ n %`; Mindesthöhe rot gestrichelt; Hauptziel hell.
  - Zonenkürzel am Ende jeder Achsenzeile.
- Stundenstreifen unter dem Diagramm: *Empfohlene Belichtungszeit* (aus der Engine), *über Mindesthöhe ohne Mond*, *mit Mond*, *über Mindesthöhe* und *astronomisch dunkel*.
- Legende rechts mit Checkbox je Ebene und Stundensumme je Streifen.
- Adapter `nightChartFromEngine`: Neu dabei sind die Sonnenkurve und die empfohlene Zeit des Hauptziels (optional mit Mondprofil).
- Das Canvas zeichnet bei Wechsel von Theme oder Dichte neu.
- `components.md` §2.3 entsprechend ergänzt (`sun`, `recommended`, Himmel, Streifen, Legende).
