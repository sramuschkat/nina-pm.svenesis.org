### Astronomie-Prüfung: Korrekturen in der Engine (ENGINE_VERSION 0.7.0)

Anlass ist die Prüfung aller astronomischen Rechnungen gegen astropy/ERFA, JPL DE432s, die Meeus-Beispiele und die Vallado-Testfälle für SGP4 (28.09.2026). Kritische Fehler gab es keine. Behoben sind:

**Planung**
- **Mosaike ohne Panel-Einheiten:** Höhe, Dämmerung und Mondabstand werden jetzt je Panel mit dessen Koordinaten gerechnet (Entscheidung Sven). Vorher galt die Projektmitte, sodass Randpanels großer Mosaike mehrere Grad unter der Mindesthöhe belichtet werden konnten. Die Einheit kann belichten, sobald ein Panel es kann; die Auswahl der nächsten Belichtung nimmt nur Panels, die selbst hoch genug stehen. Angepasst sind `allocation.md` §3.1 (A-19) und `geometry.md` §2.2.
- **Nachtfenster über ≈ 66° Breite:** Das Fenster endet jetzt immer innerhalb von Mittag bis Mittag. Am Rand der Polarnacht überschnitten sich zuvor die Fenster benachbarter Nächte (Spitzbergen 12.11.: 95 min). Siehe `night.md` §3 mit einem neuen Pflicht-Test.

**Himmelsereignisse und Anzeige**
- **Satelliten:** Der höchste Punkt eines Überflugs wird per Goldenem Schnitt auf die Sekunde verfeinert. Vorher war es nur die beste 20-s-Probe, bei hohen Überflügen bis 7,5° zu tief.
- **Meteorströme:** Der Radiant wandert jetzt mit der täglichen Drift nach Tabelle 6 des IMO-Kalenders 2026. Bei langen Strömen fern vom Maximum lag die „beste Zeit“ vorher um Stunden daneben, bei den Südlichen Tauriden am 28.09. um 2 h.
- **Mond & Planeten:** Planeten bekommen dieselbe Refraktion wie der Mond. Vorher gingen sie scheinbar einige Minuten zu spät auf.
- **Finsternisse:** Eine Sonnenfinsternis zählt ab Sonne über −0,833° als sichtbar (Oberrand am Horizont), nicht mehr ab −0,5°.

**Kleinigkeiten**
- `norm360` liefert nie 360 und nie −0.
- Refraktion am Zenit ist auf 0 begrenzt.
- Rückpräzession rechnet die Deklination über `atan2`.
- `offsetToSky` normiert RA auf [0, 360).
- Kommentare nennen die tatsächliche Genauigkeit: Planeten bis ≈ 0,09°, ΔT, Meridiandurchgang am Pol ohne Aberration.

**Specs**
- `transit.md`:
  - Umrechnung JD_UTC ↔ BJD_TDB mit eindeutigem Vorzeichen, das Beispiel mit astropy nachgerechnet (−431,41 s).
  - Puffer bei unbekanntem Zeitsystem 10 statt 2 min.
  - Die Suchbreite nutzt denselben Puffer wie das Fenster.
- `moon.md`: Mondaufgänge in hohen Breiten ergänzt.

**Tests**
- Die Referenztoleranzen liegen jetzt nahe an der erreichten Genauigkeit:
  - Sonne ±15 s statt ±60 s;
  - Mondzeiten ±5 s statt ±30 s;
  - Mondort und -höhe ±0,01° statt 0,1°/0,05°;
  - Beleuchtung ±0,05 %;
  - Ziele ±0,01° und ±3 s;
  - Mond gegen Horizons ±0,0075°.
- Der Azimut wird jetzt mitgeprüft.
