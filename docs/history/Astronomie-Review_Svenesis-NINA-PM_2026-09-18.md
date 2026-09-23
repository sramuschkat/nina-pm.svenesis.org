# Astronomie-Durchgang – Fachkonzept 1.17 · Technisches Konzept 1.17 · Schema 1.15

| | |
|---|---|
| Dokument | Astronomie-Review (Nachtrag zu Review 1–5 und zum Sicherheits-Review) |
| Datum | 18.09.2026 |
| Auftrag | „Analyse, ob astronomisch alles richtig berechnet wird, die richtigen Daten verwendet werden – und alles direkt fixen" |
| Grundlage | FK 1.16 · TK 1.16 · Schema 1.13 · `claude-code/` Stand 18.09.2026 |
| Ergebnis | **95 Befunde**, alle eingearbeitet. Die Tabellen unten führen **60 Zeilen mit 78 AST-IDs** – mehrere Befunde teilen eine Zeile, wenn sie dieselbe Stelle betreffen; die restlichen waren Doppelnennungen mehrerer Prüfer oder reine Formulierungsfehler und sind in benachbarten Befunden aufgegangen. |

## Prüfverfahren

Fünf unabhängige Prüfungen (Transitvorhersage · Nachtfenster/Dämmerung · Mond · Geometrie/Rotation · Datenquellen und Einheiten). Weil `astropy` in dieser Umgebung nicht installierbar ist, hat jeder Prüfer die betroffenen Algorithmen **selbst** implementiert (numpy/scipy) und an veröffentlichten Rechenbeispielen verankert statt an einer zweiten Bibliothek:

- Meeus Kap. 47 (Mondposition) – Beispiel 47.a auf **0,002″** reproduziert
- Meeus Kap. 12 (Sternzeit) – Beispiele 12.a/12.b auf **0,02 ms**
- Meeus Kap. 22 (Nutation/Schiefe), 25 (Sonne), 48 (Beleuchtung), 16.3/16.4 (Refraktion)
- Sonnen- und Mondauf-/-untergänge gegen USNO-Tabellen: Abweichung **≤ 15 s**

Wo ein Fehler sich in einer Zahl ausdrücken lässt, steht sie dabei – als **gerechneter** Betrag, nicht als „könnte abweichen". Befunde ohne Zahl sind die fehlenden Festlegungen: eine Spalte, ein Wertebereich, ein nicht benannter Bezugsrahmen. Sie sind nicht weniger wert, aber anderer Art.

## A. Blocker

| ID | Befund | Wirkung ungefixt | Behoben in |
|---|---|---|---|
| **AST-T1/T4** | Die Vorhersage rechnete durchgehend in BJD_TDB, schrieb `fenster[0]` aber unmittelbar als UTC in den NINA-Vertrag. Die Rückrechnung BJD_TDB → JD_UTC fehlte ganz. | Im durchgerechneten Beispiel (HAT-P-17 b, n = 375) **141 s**, im Maximum **9,7 min** – das Fenster verfehlt den Transit, die Messung ist wertlos. | `transit.md` §1/§2 (Pflichtschritt `bjdTdbToJdUtc`, Zeitskalengrenze im Pseudocode kommentiert) |
| **AST-D9** | `q(x, 1e-6)` statt `q(x, 1e6)` in `moon.md` und `allocation.md` – zweites Argument ist der **ganzzahlige Kehrwert**, nicht die Schrittweite. | `roundHalfAwayFromZero(30 · 1e-6)/1e-6` macht aus **30° Mondhöhe 0°**: jede Mondprüfung fällt auf den Horizontwert zurück. | `moon.md`, `allocation.md`, `canonical-json.md` |
| **AST-M4** | `sep` war ohne Bezugssystem definiert – weder topozentrisch noch refraktionsfrei festgelegt. | Geozentrisch gerechnet kippen **23 h/Jahr** die Abstandsprüfung (Parallaxe bis 1,025°), aus scheinbaren Höhen schrumpft der Abstand horizontnah um **0,41°**. | `moon.md` (neue FA-MON-00 im FK), `gen_sun_moon.py`-Vorgabe |
| **AST-G02** | ΔT ging in die Sternzeit ein. | **0,2883°** Stundenwinkelfehler ⇒ **69 s** Versatz in `tM` (jeder Meridiandurchgang) und ein positionsabhängiger Höhenfehler derselben Größenordnung. | TK 8.5/9 |

## B. Transitvorhersage (AST-T)

| ID | Befund | Behoben in |
|---|---|---|
| AST-T2 | Zeitsystem je Quelle war nicht unterschieden (BJD_TDB / BTJD / HJD / unbekannt); HJD-Zweig fehlte, „unbekannt" wurde geraten. Jetzt vier getrennte Fälle, `timeSystemSource`, +2 min Puffer bei „unbekannt". | `transit.md` §1 |
| AST-T3 | Epochen-Offsets wurden aus der **Größe** des Werts geraten. Jetzt quellenspezifisch tabelliert, danach Plausibilitätsgrenze `2 400 000 < T0 < 2 500 000`, sonst `422 exo.epoch_out_of_range`. | `transit.md` §1, `errors.json` |
| AST-T5/T12 | `ephemeris` hatte keine Spalten für Zeitsystem-Herkunft und O−C; eine O−C ohne Bezugs-Ephemeride wird doppelt angewandt. | Schema (`time_system_source`, `o_minus_c_*`) |
| AST-T6 | `n̂_Ziel` war nicht auf einen Rahmen festgelegt. Auf das Datum präzessiert statt ICRS/J2000 ⇒ bis 0,36° ⇒ **3,2 s**. | `transit.md` §1 |
| AST-T7/T14 | Schaltsekunden waren als Konstante behandelt. Jetzt Stufenfunktion **zum Zeitpunkt von `T0`** (1999:32 … 2017:37), Tests unmittelbar vor/nach jedem Sprung, geprüft auf strenge Datumssortierung und Schritte aus {+1, −1} (negative Schaltsekunde ist diskutiert). | `transit.md` §1 |
| AST-T8 | Toleranz ±10 s. Damit fielen eine HJD/BJD-Verwechslung (≤ 4,6 s) und ein falscher Bezugsrahmen (≤ 3,2 s) **nicht** durch. Jetzt **±1 s**, Ziel ±0,2 s, Fehlerbudget ≤ 0,1 s aufgeschlüsselt. | `transit.md` §1, TK 9 |
| AST-T9/T13 | Ephemeridenalter und Baseline waren fest. Jetzt `k·σ ≤ 0,5·T14` als Regel (σP = 1e-4 d ⇒ nach 10 Jahren 177 min Unsicherheit) und dauerabhängige Baseline `clamp(round(30·T14[h]), 30, 120)`; σ_TTV aus ≥ 3 eigenen Ergebnissen. | `transit.md` §2, `errors.json` (`transit.ephemeris_stale`) |
| AST-T11 | astropy hätte `de432s.bsp` (≈ 10 MB) beim ersten Lauf nachgeladen – im Container ohne Netz scheitert der Job. Jetzt Kernel im Repository mit Prüfsumme, `iers.auto_download = False`. | TK 9.1 |
| AST-T15/T16 | Rømer-Iteration und Referenzvergleich unbestimmt. Jetzt zwei Iterationen (Rest ≤ 10 µs), Fixtures mit |β| < 10° und |β| > 60°, Vergleich gegen `light_travel_time(kind='barycentric')` – **nicht** gegen „barycorr", das kein astropy-Bestandteil ist. | `transit.md` §1 (Iteration) und §4 (Fixtures), TK 9.1 |
| AST-T18 | `duration_h` war NOT NULL, ist im Katalog aber oft leer. Jetzt nullable plus `duration_estimated`, T14 aus `a_over_rs`/`inclination_deg`/`rp_over_rs`. | Schema |
| AST-T19 | Beobachtbarkeit wurde nur an der nominalen Mitte geprüft. Jetzt an `Tc − k·σ`, `Tc`, `Tc + k·σ`. | `transit.md` §2 |

## C. Nachtfenster und Dämmerung (AST-N)

| ID | Befund | Behoben in |
|---|---|---|
| AST-N1 | `darknessEndUtc` war fest auf −18° – das schnitt ein nautisches Projekt 28 min zu früh ab und war in zwei regulären Fällen **überhaupt nicht definiert** (weiße Nacht Hannover 21.06.; φ ≥ 84,56° N am 21.12.). Jetzt der Aufwärtsdurchgang der **tiefsten in dieser Nacht aktiven Projektgrenze**, im Vertrag **nullable**. | `night.md` §3; Vertrag nachgezogen: `contracts/nina/README.md`, `plan.response.example.json`, TK 7.6 (`darkness` jetzt **je Stufe**, alle Werte nullable) |
| AST-N2 | Die Zeitumstellungs-Nachtschlüssel waren um einen Tag verschoben (Umstellung liegt um 03:00 bzw. 02:00 Ortszeit mitten in der Nacht des Vortags). Jetzt **24.10.** = 25 h, **28.03.** = 23 h, Gegenprobe 25.10./29.03. = 24 h. | `night.md` §4 |
| AST-N3 | `grazing` prüfte nur eine Tangente. Am Polarnachtrand ist der Durchgang genauso schlecht konditioniert: 78,5° N, 21.12., −12° ⇒ 0,01° Modellfehler = **119 s**. Jetzt `min(|h_min − h₀|, |h_max − h₀|) < 0,5°`. | `night.md` §2 |
| AST-N4/N5 | `h_min` ohne Absolutbetrag liefert für La Silla am 21.06. den unmöglichen Wert **−95,8°**. Jetzt `h_min = |φ + δ| − 90°`; Hannover 21.06. nautische Dunkelheit **2,80 h** (nicht „≈ 2 h"). | `night.md` §3 (Zirkumpolarform) und §4 (Testtabelle) |
| AST-N6 | Der Regressionstest lag auf dem 26./27.07.: am 26.07. greift `grazing` (0,37° < 0,5°), am 27.07. liegt der Wert mit 0,60° knapp außerhalb der Schwelle – beides untauglich, weil 0,23° in `h_min` die Dauer um 18 min verschieben. Jetzt eine Nacht mit Antitransit **nach** lokaler Mitternacht (01:27, 113,8 min). | `night.md` §4 |
| AST-N9 | −0,8333° wurde als Ergebnis des eigenen Refraktionsmodells gelesen. Jetzt ausdrücklich **Konventionskonstante** (das eigene Modell liefert −0,8956°, 0,062° tiefer ≈ 36 s). | `night.md` §2 |
| AST-N10 | Der Horizont der Zeitzonen-Übergangstabelle war global gedacht. Jetzt **je Eingabe**. | `night.md` §1 |
| AST-N11 | Kein Vorfilter über die Kulminationshöhe: M8 an der VSW Hannover (`h_max` = 13,25° < 30°) lief durch zweimal 60 `planNight`-Läufe, um `not_visible` zu melden. Jetzt `h_max + R(h_max) < minAlt → not_visible` mit `h_max = 90° − |φ − δ|` vor dem Slotraster (die Refraktion gehört dazu, sonst filtert der Vorfilter Grenzfälle weg, die knapp sichtbar sind). | `night.md` §3 |
| AST-N12 | Die **Sonne** – Grundlage des ganzen Nachtfensters – war weder im Algorithmus noch in der Genauigkeit noch in der Schiefe festgelegt, während der Mond exakt spezifiziert war. Jetzt Meeus Kap. 25, ε₀(2026,5) = 23,43585°, Aberration −0,00569°. | TK 8.4 |
| AST-N13 | Standorthöhe: keine Kimmtiefe, Luftdruck fest – jetzt als **bewusste** Festlegung dokumentiert statt stillschweigend. | `night.md` §2, Schema |
| AST-N14 | Im Polartag-Zweig entscheidet dasselbe `h_min` über **beide** Durchgänge: „beide vorhanden" oder „beide fehlen", nicht einzeln. | `night.md` §3 |
| AST-N16 | Datumsgrenze: bei Offset > +12 h liegt `noonStartUtc` am Vortag. | `night.md` §1 |
| AST-N17 | *Frühester Flat-Start* stand auf `darknessEndUtc` – für **Himmelsflats** 48–76 min zu früh (brauchbar ist −8° … −2° Sonnenhöhe). Jetzt eigene Option. | FK 8.1 |
| AST-N18 | Pole waren nicht ausgeschlossen; bei \|φ\| = 90° ist der Stundenwinkel undefiniert. Jetzt `latitude_deg` auf ±89,9°. | Schema, `night.md` §4 |

## D. Mond (AST-M)

| ID | Befund | Behoben in |
|---|---|---|
| AST-M1/M11 | Stufe 3 hatte keine Abstandsuntergrenze (jetzt `A_floor = 15°`); „Kein Mond" braucht Reserve (`maxAlt = −2`), sonst entscheidet ein Modellfehler in der letzten Stelle der Mondhöhe. | `moon.md` |
| AST-M2 | `relax` wurde als **Multiplikator** gelesen; es sind **Grad geforderter Abstand je Grad Mondhöhe** unterhalb der Max-Höhe. Der Spaltenname `relax_scale` bleibt (historisch) und ist jetzt als solcher gekennzeichnet. | `moon.md`, FK, Schema, AP-09a |
| AST-M3 | Restriktivität `A × (1 + 100/(maxIllum+1))` ignorierte die Breite `W`. Jetzt `A · W · arctan(14,77/W)` (Integral über den halben Mondzyklus, `arctan` im **Bogenmaß**): **773,6 / 373,3 / 102,8** für Streng/Moderat/Entspannt. `allocation.md` trug die abgelöste Formel noch im Text – sie ist jetzt als Kompatibilitätsverhalten gekennzeichnet und die Produktivform als **A-31** in die Abweichungstabelle aufgenommen. | `moon.md`, `allocation.md` §3 Punkt 4 und §10/§11.1 |
| AST-M5/D18 | Keine Toleanzzeile für die **Mondhöhe** (steuert Stufen 1/2, Relaxierungsband und `MoonDown`); Mondzeiten-Toleranz ±120 s ließ genau die Verwechslung Oberrand/Mittelpunkt durch (0,26° ≈ 1,7–3 min). Jetzt ±0,05° bzw. **±30 s** plus Direkttest \|h_app\| ≤ 0,01°. | TK 9 |
| AST-M6 | Reichweite der Relaxierung war nicht durchgerechnet; jetzt Tabelle mit allen Built-ins und Grenzfällen. | `moon.md` |
| AST-M7 | `mustBeDown` hatte keine Spalte. | Schema (`project.moon_must_be_down`) |
| AST-M8 | Profilvalidierung fehlte (`minAlt < maxAlt`, `W ≥ 0`, `A ≥ 0`, `relax ≥ 0`, `0 ≤ maxIllum ≤ 100`). | `moon.md`, AP-09a |
| AST-M9 | `d` wurde als Zeit bis zum Vollmond gelesen. 12,1907 °/d ist die **mittlere** Rate (2026: 10,77 … 14,36 °/d) – Abweichung bis **0,9 Tage** ⇒ 3,3° im geforderten Abstand bei *Streng*. Jetzt „Phasenmaß in Tag-Äquivalenten", gerechnet aus ekliptikalen Längen. | `moon.md` |
| AST-M12 | Wertebereiche der Mondprofil-Spalten fehlten. | Schema |
| AST-1/10 (Review 4) | Refraktionsrichtung: Saemundsson erwartet die **geometrische** Höhe, Bennett die scheinbare – jetzt getrennt, mit Konstante unterhalb −1°. Beleuchtung nach Meeus 48 mit `atan2` (`atan` liefert für ψ < 89,85° den falschen Quadranten: 74,9 % statt 25,1 %). | `moon.md` |

## E. Geometrie, Rotation, Anzeige (AST-G)

| ID | Befund | Behoben in |
|---|---|---|
| AST-G01 | Newton konvergiert bei 24/25-h-Fenstern auf die **zweite** Kulmination – bei 25 h liegen 63,9 min (4,45 % aller RA-Werte) in diesem Band, Fehler 23,93 h. Jetzt explizite Kandidatenmenge `t_k = t_Newton + k·(360/15,0410686) h`, k ∈ {−1, 0, +1}. | `flip-rotation.md` |
| AST-G06 | Der Median eines **Wrap-Clusters** wurde auf der wertsortierten Liste gebildet. Jetzt auf der entrollten Kette (Testvektor 1,0° → **0,5°**). | `flip-rotation.md` |
| AST-G07 | Winkelspalten waren `real` – das trägt die zugesagten 1e-6° nicht. Jetzt `double precision` mit `[0, 360)`-CHECK. | Schema |
| AST-G04/D12 | Längenvorzeichen war nicht dokumentiert. Jetzt **OST POSITIV** im Schema kommentiert. | Schema |
| AST-G08 | Astro PM benutzt `reducer = 0` für „keiner"; ungerechnet gäbe das `effFocalMm = 0` und einen unendlichen Maßstab. Jetzt Import-Abbildung 0 → 1,0 plus CHECK > 0. | Schema |
| AST-G11/G12 | Koordinatenrahmen war nicht festgelegt. Jetzt: Speicherung J2000/ICRS, Präzession/Nutation nur engine-intern, an NINA gehen **J2000**-Werte; Eigenbewegung bewusst nicht gerechnet (bis ≈ 32″ seit J2000, unkritisch für Plate-Solve, relevant nur für feste Photometrie-Aperturen). | FK 8.1, TK 7.3 |
| AST-G13 | `stepX/stepY` sind Schritte in der **Tangentialebene**, nicht Bogenmaße am Himmel (0,5 % bei 6,75°). `tan(6,75) = 0,118` wäre ein Dimensionsfehler; korrekt `degrees(tan(radians(stepX)))` = **6,781402°**. | `geometry.md` |
| AST-G14 | Luftmasse als `sec z` weicht bei 10° um 3,1 %, bei 5° um 11,3 % ab. Jetzt Kasten & Young aus der scheinbaren Höhe, **reine Anzeige**, Ingest-Grenze 1 ≤ airmass ≤ 40. | TK 7.6 |

## F. Datenquellen, Einheiten, Rundung (AST-D)

| ID | Befund | Behoben in |
|---|---|---|
| AST-D1/D2 | Drei Quellen, drei Tiefeneinheiten (NASA %, TOI ppm, ExoClock mmag), eine Spalte. Die Umrechnung ist **nichtlinear** – „×10" von Prozent auf mmag ist 8–10 % falsch. Die frühere Schreibweise `Δm = −2,5·log₁₀(1 − Tiefe)` lieferte Magnituden statt Millimagnituden. Jetzt `−2500 · log10(1 − d)` mit `d` als Bruch, Kontrollwerte 1 % = 10 000 ppm = 10,912 mmag. | `transit.md` §1, FK |
| AST-D3 | `pl_tsystemref` ist die abgelöste Confirmed-Planets-Tabelle; korrekt ist `pl_tranmid_systemref`. | `transit.md` §1 |
| AST-D5 | `disposition` ohne Wertebereich; FP/FA werden beim Import verworfen und gezählt. Jetzt sechs TFOPWG-Werte. | Schema |
| AST-D6/D7 | Magnituden waren bandlos in einer Spalte, Flächenhelligkeit fehlte. Jetzt `mag_v`, `mag_b`, `surf_br_mag_arcsec2` und `mag_band_used` in `dso_object` – B−V beträgt bei Emissionsnebeln über 1 mag, und die Sichtbarkeit eines ausgedehnten Nebels hängt an der Flächenhelligkeit (NGC 7000: `mag_v` 4 und trotzdem flächig schwach). | Schema |
| AST-D8/D31 | ESLint arbeitete als **Verbotsliste** – jede neue `Math`-Funktion wäre durchgerutscht. Jetzt **Allowlist** (`abs, floor, ceil, trunc, min, max, sign, sqrt, PI`), `**` verboten, `log10` im fdlibm-Port, `toFixed`/`toPrecision` verboten (zurückgeparste Werte weichen von `q()` ab). | `rules/engine.md` |
| AST-D10 | Hash-Eingabe war nicht als Bytefolge festgelegt. Jetzt **UTF-8-Bytes**, alle Codepunkte > U+007F als `\uXXXX`. | `canonical-json.md` |
| AST-D13 | Benötigte Öffnung: ExoClock liefert **Zoll**, Teleskope stehen systemweit in mm. Ungerechnet wäre ein 8″-Bedarf (203 mm) gegen ein 200-mm-Rig „erfüllt" – FA-EXO-07 färbte grün, wo rot gehört. Jetzt `min_aperture_mm` = Zoll · 25,4. | Schema, `transit.md` §1 |
| AST-D14 | Entfernung: NASA `sy_dist` steht in **Parsec**. In Lichtjahren abgelegt ist der Katalogwert nicht mehr gegen die Quelle prüfbar. Jetzt `distance_pc` unverändert gespeichert, Anzeige rechnet `Lj = pc · 3,26156`. | Schema, `transit.md` §1 |
| AST-D15 | Wirtstern-Helligkeiten waren bandfremd zusammengeworfen (`sy_gmag` ist SDSS g, **nicht** Gaia G; Johnson R gibt es nur bei ExoClock). Jetzt bandtreue Spalten mit Fallback-Kette. | Schema |
| AST-D20/D21/D22 | Fehlende Wertebereiche (RA/Dec/Periode/Winkel/Prozente); `position_angle_deg` (0…180, Großachse) ist eine **andere Winkelart** als der Kamera-PA (0…360, Bildoberkante) und war nicht abgegrenzt; `quantum_efficiency_pct` fehlte. | Schema |
| AST-D23/D24/D25 | Die Wetterbewertung war nirgends spezifiziert, obwohl sie laut TK 8.2 zur deterministischen Engine gehört – **neue Datei `weather.md`** mit Variablentabelle, Einheiten, Momentan- gegen Intervallwerte (Böen/Niederschlag aus der **vorangehenden** Stunde) und allen vier Formeln. Aerosol kommt aus der **getrennten** Air-Quality-API mit eigenem Horizont. Abruf **immer** `timezone=UTC&timeformat=unixtime`. | `weather.md` (neu), TK 8.4/14 |
| AST-D26 | hips2fits-Aufruf war unbestimmt (Einheiten, Rotation). Jetzt verbindlich in Dezimalgrad mit `coordsys=icrs`. | TK 12 |
| AST-D30 | Die Referenz-Fixtures hätten astropys `AltAz`-Refraktion benutzt – das macht aus dem Implementierungstest einen **Modellvergleich** (ERFA gegen Saemundsson), und die 15°-Ausnahme kann für Mondzeiten (0°) gar nicht greifen. Jetzt geometrische Höhe plus Saemundsson, wie in der Engine. | TK 9.1 |

## Was bewusst **nicht** gerechnet wird

Diese Punkte sind geprüft und als Festlegung dokumentiert, nicht als Lücke:

- **Eigenbewegung** (bis ≈ 32″ seit J2000 bei den schnellsten Wirtsternen; 0,009° sind für die Plate-Solve-Zentrierung unkritisch)
- **Standorthöhe** (keine Kimmtiefe, Luftdruck fest 1010 hPa)
- **Luftmasse als Planungsregel** (nur Anzeige; die Nutzbarkeit rechnet über die Zielhöhe)
- **Horizontprofil** (nur eine Mindesthöhe je Projekt)
- **Randverdunklung** in der geometrischen Tiefe `(Rp/R★)²` – deshalb nur Ersatzwert mit Kennzeichen *geschätzt* (rund 20 % zu flach: HAT-P-17 b 16,63 gegen 20,37 mmag = 18,4 % des gemessenen Werts)

## Nachtrag: Gegenprüfung des Durchgangs (18.09.2026)

Dieses Review wurde nach dem Schreiben **gegen die Dokumente geprüft, die es beschreibt** – mit nachgerechneten Zahlen und geprüften Abschnittsverweisen. Die Gegenprüfung fand 25 Fehler, davon zehn in den Dokumenten selbst und nicht nur in diesem Review. Alle sind behoben; die Tabellen oben tragen bereits die korrigierten Werte. Die inhaltlich schwersten:

| Was die Gegenprüfung fand | Zustand vorher | Jetzt |
|---|---|---|
| `allocation.md` §3 Punkt 4 trug die **abgelöste** Restriktivitätsformel weiter, während `moon.md` die neue führte – zwei widersprechende Definitionen in einem Paket | AST-M3 galt nur in `moon.md` | Modusaufteilung mit neuer Abweichung **A-31**, in Abweichungs- und Kompatibilitätstabelle aufgenommen; TK 8.2 sagt jetzt A-1…A-31 |
| Die Restriktivitätswerte der Built-ins waren falsch gerechnet | 793,4 / 375,3 / 104,6 | **773,6 / 373,3 / 102,8**; das Gegenbeispiel ebenso: X = 454,7, Y = 90,2 statt 470 / 89 |
| `geometry.md` nannte einen falschen Tangentialwert | 6,78247° | **6,781402°** |
| Der NINA-Vertrag legte `darknessEndUtc` **fest auf −18°** – genau das, was AST-N1 aufgehoben hat | `darkness` hatte nur `astronomicalStartUtc`/`astronomicalEndUtc` | `darkness` trägt **alle drei Stufen**, jeder Wert nullable; `darknessEndUtc` ist die tiefste aktive Grenze und nullable (README, Beispiel-JSON, TK 7.6) |
| Der Schema-Kopf nannte Spalten, die es nicht gab | `mag_b`, `surf_br_mag_arcsec2` standen nur im Änderungskommentar | beide in `dso_object` angelegt, mit `mag_band_used` |
| Dasselbe bei den Einheiten des Exoplaneten-Imports | `min_aperture_in`, `distance_ly` weiter im Schema, obwohl der Kopf `_mm`/`_pc` behauptete | `min_aperture_mm`, `distance_pc` mit Umrechnungsregel in `transit.md` §1 |
| `transit.md` verletzte den eigenen Baseline-Deckel | „T14 = 4,04 h → 121 min“ | 120 min, mit Hinweis, dass `clamp(…,30,120)` hier greift |
| Zwei tote Querverweise | `TK 20.1` und `allocation.md §3.4` – beide Abschnitte existieren nicht | TK 14 bzw. §3 Punkt 4 |
| `AP-23` (Wetter) las die neue `weather.md` nicht | Brief ohne Verweis | `weather.md` in Lesen-Liste, Liefern und automatisierter Abnahme |
| Die TK-Portierungszeile verlangte `timezone=auto`, das TK 14 verbietet | Widerspruch im TK | Ausnahme steht ausdrücklich in der Portierungszeile (AST-D25) |

Der Rest waren falsche Abschnittsnummern in diesem Review selbst sowie zwei zu großzügige Formulierungen: „bis 25 % zu flach“ bei belegten 18,4 %, und „der 26./27.07., wo `grazing` greift“ – am 27.07. greift die Schwelle mit 0,60° gerade nicht.

**Lehre für die Umsetzung:** Von den zehn Dokumentfehlern waren fünf Fälle, in denen eine Festlegung an **einer** Stelle nachgezogen wurde und an einer zweiten alt blieb (Formel, Vertrag, Schema-Kopf, Brief, Portierungszeile). Zu jeder astronomischen Änderung gehört deshalb eine Suche nach der Größe im **ganzen** Paket, nicht nur in der Datei, in der sie definiert ist.

## Offene menschliche Aufgaben aus diesem Durchgang

- **Referenz-Fixtures neu erzeugen:** `gen_sun_moon.py` und `gen_transits.py` müssen mit den neuen Konventionen laufen. Zuständig ist der CI-Auftrag `reference.yml` (mit gebündelten IERS-Daten); H-10 ist nur der optionale lokale Weg – geometrische Höhe plus Saemundsson, `de432s.bsp` aus der Datei, Fixtures mit \|β\| < 10° und \|β\| > 60°.
- **AP-08b** prüft die Refraktionsrichtung, **AP-13b** die Panel-Testtabelle, **AP-23** die neue `weather.md` – alle drei Briefe sind nachgezogen (AP-23 liest `weather.md` jetzt und prüft ihre Pflicht-Tests).
