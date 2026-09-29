# Spezifikation: Transitvorhersage und Reservierung

Verbindlich für AP-41 (Rechnung) und AP-44 (Reservierung, Plugin-Transitblock: `specs/nina/execution.md` §5). Bezug: FA-EXO-*, Fachkonzept 8.7, TK 8.5.

## 1. Zeitskalen und Quell-Zeitsysteme
- Ephemeride `T0` (BJD_TDB), `P` (Tage), `σT0`, `σP` (Tage), `T14` (Stunden), optional `ocMin` (letzte O−C, Minuten) mit `ocSigmaMin`, `timeSystemSource` (Herkunft der Epoche). Alle vier Felder liegen als Spalten in `ephemeris` (Schema 1.15).
- **Normalisierung beim Import (verbindlich, AST-T3).** Jede Katalog-Epoche wird auf **BJD_TDB** gebracht und das Quellsystem gespeichert. **Nicht nach der Größe raten** – MJD (≈ 5·10⁴) und RJD (= JD − 2 400 000, ebenfalls ≈ 5·10⁴) sind an der Zahl prinzipiell nicht unterscheidbar, und ein MJD-Wert mit `+ 2 457 000` liegt 57 000 Tage (156 Jahre) daneben. Der Offset kommt **je Quelle**:

  | Quelle | Feld | Zeitsystem | Offset |
  |---|---|---|---|
  | NASA Exoplanet Archive (`pscomppars`) | `pl_tranmid` | aus `pl_tranmid_systemref` (nicht `pl_tsystemref` – das ist die abgelöste Confirmed-Planets-Tabelle, AST-D3) | keiner, volles BJD |
  | TESS TOI (Bulk) | `Epoch (BJD)` | BJD (BTJD-Offset entfernt in der Bulk-Datei bereits **nicht** – prüfen) | `< 2 400 000` ⇒ BTJD ⇒ `+ 2 457 000` |
  | ExoClock | Mittelzeit | BJD_TDB | keiner |

  Nach dem Offset gilt die **Plausibilitätsgrenze** `2 400 000 < T0 < 2 500 000`; alles andere wird mit `422 exo.epoch_out_of_range` abgelehnt, **nicht** geraten.
- **Zeitsystem → BJD_TDB (verbindlich, AST-T2).** Die vier Fälle sind **nicht** gleich zu behandeln:
  - `BJD_TDB` → unverändert.
  - `BJD_UTC` → `+ (32,184 s + (TAI−UTC)(T0))/86400`.
  - `HJD_UTC` → zusätzlich **Heliozentrum → Baryzentrum**: `+ (r⃗_Sonne,bary(T0) · n̂)/c`. Größe 0,15 … **4,6 Lichtsekunden** (Maximum bei Konjunktion der vier Riesenplaneten 5,0 s).
  - `JD_UTC` / `JD` → **volle Rømer-Korrektur**: `+ (r⃗_Erde,bary(T0) · n̂)/c`, also bis **±8,5 min** – nicht der 5-s-Sonnenversatz. JD_UTC ist eine geo-/topozentrische Zeit, kein heliozentrisches Maß; wer hier den HJD-Zweig nimmt, verfehlt das Transitfenster.
  - Unbekanntes System → `timeSystemSource = 'unknown'`, Fensterpuffer **+ 10 min** und Kennzeichen „Zeitsystem unsicher" in S-22/S-31. Die frühere Angabe + 2 min deckte nur eine Verwechslung von BJD/HJD bzw. UTC/TDB (≤ 74 s) ab, nicht eine Epoche, die in Wahrheit `JD_UTC` ist (Rømer bis ±8,5 min + 69 s; Astronomie-Prüfung 28.09.2026).
  - **Zuordnung der Quellangaben (verbindlich, Spec-Ergänzung 29.09.2026, AP-40, Entscheidung Sven).** Geprüft am 29.09.2026 gegen das NASA-Archiv (`pscomppars`, 4.739 transitierende Planeten) und ExoClock (776 Planeten, alle `BJD_TDB`): Für Planeten in beiden Katalogen wurde die NASA-Epoche mit der ExoClock-Ephemeride auf dieselbe Epochennummer gebracht und die Differenz verglichen.

    | `pl_tranmid_systemref` | Planeten gesamt / nach Vorfilter | gemeinsam mit ExoClock | Median NASA − ExoClock | Zuordnung |
    |---|---|---|---|---|
    | `BJD-TDB`, `BJD` | 746 + 2.403 / 327 + 276 | 388 | 0,00 min | `bjd_tdb` |
    | `BJD-TT` | 1 / 1 | – | – | `bjd_tdb` (TT − TDB < 2 ms) |
    | `BJD-UTC` | 41 / 24 | 27 zusammen mit HJD/HJD-UTC | + 1,1 min (= UTC → TDB) | `bjd_utc` |
    | `HJD`, `HJD-UTC` | 85 + 24 / 27 + 23 | (s. o.) | (s. o.) | `hjd_utc` |
    | `JD` | 1.383 / 21 | 7 | + 0,05 min, **kein** Rømer-Versatz | `unknown` |
    | `HJD-TDB`, leer, sonstige | 1 + 55 / 1 + 3 | – | – | `unknown` |

    **`JD` ist im NASA-Archiv keine topozentrische JD_UTC**, sondern in aller Regel BJD: Die volle Rømer-Korrektur (bis ±8,5 min) würde diese Epochen also erst falsch machen. Deshalb gilt `JD` als **unbekannt**: Epoche unverändert, Puffer + 10 min, Kennzeichen „Zeitsystem unsicher“. Der Puffer deckt auch den ungünstigsten Fall ab, dass eine Epoche doch JD_UTC ist (8,5 min + 69 s = 9,7 min). Der Zweig `JD_UTC` oben bleibt für eine Quelle, die das System ausdrücklich so angibt. Bisher gibt es keine; `normalizeEpoch` behandelt `jd_utc` bis dahin wie `unknown`.

    `HJD-TDB` (ein Planet) ist eine untypische Kombination und wird ebenfalls als unbekannt geführt. ExoClock: `ephem_mid_time_format` mit derselben Tabelle. TOI: `Epoch (BJD)` = `bjd_tdb` bzw. `btjd` unter 2 400 000. Rohwert (`t0_raw`) und Quellangabe (`time_system_raw`) werden mitgespeichert (Migration 0010).
  - **Sonnenversatz für `hjd_utc` (verbindlich, AP-40).** `r⃗_Sonne,bary = −Σ mᵢ·r⃗ᵢ / (M☉ + Σ mᵢ)` über Jupiter, Saturn, Uranus und Neptun: Kepler-Bahnen nach JPL Tabelle 1 (`sky/planets.ts`), Massenverhältnisse M☉/mᵢ = 1047,3486 / 3497,9018 / 22 902,98 / 19 412,26. Der Vektor wird ekliptikal J2000 → äquatorial gedreht, `n̂` kommt aus ICRS (AST-T6). Gegen astropy (`light_travel_time` baryzentrisch − heliozentrisch, de432s; `tools/reference/gen_exo_epochs.py`, 108 Fälle 1999–2030) liegt der Fehler bei **≤ 6,3 ms**, Testgrenze 20 ms. `TDB − UTC` enthält zusätzlich `TDB − TT ≈ 1,657 ms · sin g`; gegen astropy ≤ 1 ms.
- **Schaltsekunden zur Epoche (verbindlich, AST-T7).** `TAI − UTC` wird **zum Zeitpunkt von `T0`** als Stufenfunktion über **Datum** gelesen, nicht über Jahr. Vollständige Tabelle ab 1999 (frühere Epochen über die IANA-Datei, ab 1972-01-01 = 10 s):

  | gültig ab | TAI−UTC |
  |---|---|
  | 1999-01-01 | 32 s |
  | 2006-01-01 | 33 s |
  | 2009-01-01 | 34 s |
  | 2012-07-01 | 35 s |
  | 2015-07-01 | 36 s |
  | 2017-01-01 | 37 s |

  Mit dem heutigen Wert (37 s) statt dem zur Epoche gültigen liegt eine Epoche aus 1999–2005 um **5 s**, eine aus 1990 um **12 s** daneben – und Katalogepochen liegen real dort (HD 209458 b: 2003, TrES-1 b: 2004). Die Tabelle trägt ein `validUntil` aus der Quelle (IANA-Datei: 2027-06-28). Für `t > validUntil` gilt der **letzte** Wert weiter und die Planung erhält die Diagnose `leap_table_expired` (Fehler ≤ 1 s). Quelle: `https://data.iana.org/time-zones/data/leap-seconds.list`.
- **Umrechnung BJD_TDB → JD_UTC am Standort:**
  1. `JD_TDB ≈ BJD_TDB − Δ_Rømer`, `Δ_Rømer = (r⃗_Erde,bary · n̂_Ziel)/c`. **`n̂_Ziel` wird aus den ICRS/J2000-Koordinaten gebildet**, im selben Rahmen wie `r⃗_Erde,bary`; die nach FK 8.1 auf das Datum präzessierte Richtung darf hier **nicht** verwendet werden (Unterschied 2026: bis 0,36° ⇒ **3,2 s**, AST-T6). Maximum `|r⃗_Erde,bary|` = 1,0259 AU ⇒ **8,53 min** (Aphel 1,01671 AU = 8,456 min plus Sonnenversatz bis 4,6 Lichtsekunden; 1 AU = 8,3167 min). Baryzentrische Erdposition aus **VSOP87 (gekürzte Reihen, Erde-Mond-Baryzentrum) plus Sonnenversatz durch Jupiter, Saturn, Uranus und Neptun** (Keplerbahnen; Beiträge 2,48 / **1,36** / 0,42 / 0,77 Lichtsekunden – dieselben Zahlen in TK 8.5). **Zwei Iterationen** (die Zielrichtung ist fest, nur die Erdposition wird nachgeführt); Rest ≤ **10 µs**, eine Iteration genügt bereits auf 50 ms.
  2. `TDB − TT ≈ 0,001657 s · sin(g)`; `TT − TAI = 32,184 s`; `TAI − UTC` aus der Tabelle oben.
  3. **Fehlerbudget (AST-T15):** Erdreihe ≤ 10 ms · vernachlässigte innere Planeten im Baryzentrum-Versatz 3 ms · topozentrischer Term 21 ms · EMB → Erdmittelpunkt 16 ms · TDB−TT-Amplitude 1,7 ms · Shapiro 0,02 ms ⇒ **Gesamt ≤ 0,1 s**.
- **Zeitstempel der Aufnahmen (verbindlich, NT-10):** `capturedAtUtc` = Belichtungs**beginn** (`MetaData.Image.ExposureStart`, UTC), Pflichtfeld `exposureMidUtc` = Belichtungs**mitte** (`ExposureMidPoint`, Spalte `capture.exposure_mid_utc`). Die Umrechnung der Aufnahmezeit nach BJD_TDB für Lichtkurven und den Export (FA-EXO-29) nutzt **`exposureMidUtc`** – die Umkehrung von „BJD_TDB → JD_UTC“ unten mit denselben Termen. Wer den Beginn nimmt, verschiebt jeden Punkt um `exposureS/2` (bei 60 s um 30 s, mehr als das gesamte Fehlerbudget).
- Toleranz gegen astropy (TK 9): **±1 s** für die Transitmitte in UTC, Ziel ±0,2 s. ±10 s wären zu grob: eine HJD/BJD-Verwechslung (≤ 4,6 s) und ein falscher Bezugsrahmen der Zielrichtung (≤ 3,2 s) fielen damit **nicht** durch (AST-T8).
- **Transittiefe: Einheit je Quelle (verbindlich, AST-D1/D2).** Drei Quellen, drei Einheiten, eine Spalte `depth_mmag`. Die Umrechnung ist **nichtlinear**, ein „×10" von Prozent auf mmag ist um 8–10 % falsch:

  | Quelle | Feld | Einheit | Formel → `depth_mmag` |
  |---|---|---|---|
  | NASA `pscomppars` | `pl_trandep` | **Prozent** | `−2500 · log10(1 − pct/100)` |
  | TESS TOI | `Depth (ppm)` | **ppm** | `−2500 · log10(1 − ppm/1e6)` |
  | ExoClock | Tiefe | **mmag** (R-Band) | direkt |

  Kontrollwerte: 1 % = 10 000 ppm = **10,912 mmag** · 0,2 % = 2,174 mmag · 3 % = 33,071 mmag. Rohwert **und** Quelleinheit werden mitgespeichert.
- **Zwei weitere Einheitenwechsel beim Import (AST-D13/D14).** Sie fallen nicht auf, weil beide Werte nur angezeigt werden – und sind genau deshalb gefährlich:
  - **Benötigte Öffnung:** ExoClock nennt sie in **Zoll**, gespeichert wird `min_aperture_mm` = Zoll · 25,4. Teleskope stehen im ganzen System in Millimetern (FA-TEL-01); ungerechnet verglichen wäre ein 8″-Bedarf (203 mm) gegen ein 200-mm-Rig „erfüllt“ statt „knapp verfehlt“ – FA-EXO-07 färbte grün, wo rot gehört.
  - **Entfernung:** NASA `sy_dist` steht in **Parsec**, gespeichert wird `distance_pc` **unverändert**. Die Anzeige „Entfernung (Lj)“ (FA-EXO-06) rechnet erst beim Darstellen: `Lj = pc · 3,26156`. Umgekehrt gespeichert wäre der Katalogwert nicht mehr gegen die Quelle prüfbar.
 `(Rp/R★)²` ist die **geometrische** Tiefe und nur Ersatzwert mit Kennzeichen *geschätzt* – ohne Randverdunklung liegt sie bis **rund 20 % zu flach** (HAT-P-17 b: 16,63 mmag gerechnet gegen 20,37 mmag gemessen = 18,4 % des gemessenen Werts).

## 2. Vorhersage
```
# Alle Größen in TAGEN rechnen: T14/24, σ, baseline/1440, ocMin/1440
# ZEITSKALEN: alles bis fenster[] in BJD_TDB, danach ausschliesslich JD_UTC (AST-T1)
nightMid = Mitte des Nachtfensters (FK 8.1), als JD_UTC
n0     = q((jdUtcToBjdTdb(nightMid) − T0)/P, 1)          # beide Seiten BJD_TDB, Rundung canonical-json.md
Kandidaten: alle n ab n0 nach beiden Seiten, solange Tc_utc(n) im Suchintervall
            [nightStart − halbeBreite ; nightEnd + halbeBreite] liegt   # JD_UTC
            halbeBreite = T14/48 + puffer(n) + max(baselineVorMin, baselineNachMin)/1440
                          (+ 10/1440 bei timeSystemSource = 'unknown'; derselbe Puffer wie im Fenster,
                           sonst fällt ein Randtransit mit 5-min-Untergrenze heraus – Prüfung 28.09.2026)
            (bei Ultrakurzperioden P < 0,4 d liegen mehrere Transits in einer Nacht)

Tc_bjd = T0 + n·P + ocMin/1440   # BJD_TDB; letzte O−C verschiebt die Mitte MIT Vorzeichen
Tc_utc = bjdTdbToJdUtc(Tc_bjd, raJ2000, decJ2000)        # §1, zwei Iterationen  <-- PFLICHT

sigma  = |n|·sigmaP + sigmaT0 + ocSigmaMin/1440  # Tage; linear addiert = konservativ
puffer = max(k·sigma, 5/1440)   # k aus {1,2,3}, Standard 1; Untergrenze 5 min
                                # (ocSigmaMin steckt schon in sigma; ein eigener Term wäre doppelt)
ingress = Tc_utc − T14/48 ; egress = Tc_utc + T14/48     # JD_UTC
fenster = [ingress − puffer − baselineVorMin/1440 ; egress + puffer + baselineNachMin/1440]
          + 10/1440 beidseitig, wenn timeSystemSource = 'unknown'
```
- **Warum der Umrechnungsschritt Pflicht ist (AST-T1):** Ohne ihn steht in `fenster[]` ein BJD_TDB-Wert, der in §3 unmittelbar als UTC in den NINA-Vertrag geschrieben wird. Der Versatz ist Rømer + Uhrterme, **mit Vorzeichen** `JD_UTC − BJD_TDB = −ltt − (TT−UTC) − (TDB−TT)` mit `ltt = (r⃗_Erde,bary · n̂)/c` (positiv, wenn die Erde auf der Zielseite des Baryzentrums steht; TDB−TT < 2 ms): in der Beispielnacht 2026-09-18 (HAT-P-17 b, Starfront, 04:30Z) `ltt = +362,23 s` → **−431,41 s** (astropy `light_travel_time(kind='barycentric')`, nachgerechnet 28.09.2026), im Maximum **bis 9,7 min** – das Fenster verfehlt den Transit.
- **Puffer und O−C (AST-T4):** `σ` aus dem Katalog ist bei gut vermessenen Zielen winzig (HAT-P-17 b bei n = 375: 0,29 min), die reale Abweichung nicht (dessen O−C = 1,0 ± 0,94 min). Deshalb geht `ocSigmaMin` in `σ` ein und der Puffer hat eine Untergrenze von 5 min. `ocMin` wird nur angewendet, wenn `|ocMin| > 3·ocSigmaMin`. Liegen ≥ 3 eigene `transit_result`-Zeilen vor, geht deren empirische Streuung zusätzlich als `σ_TTV` in die Summe – bei TTV-Systemen (ExoClock-Kennzeichen `TTVs`, z. B. TrES-3 b mit O−C > 10 min) ist die lineare Ephemeride sonst wertlos.
- **Ephemeridenalter (verbindlich, AST-T9):** `σ` wächst linear mit |n|. Regel: `k·σ ≤ 0,5·T14` **und** `k·σ ≤ 30 min` ⇒ planbar · `0,5·T14 < k·σ ≤ T14` ⇒ Warnung *Ephemeride unsicher*, Baseline auf `k·σ` erhöhen · `k·σ > T14` ⇒ nicht festlegbar (`409 transit.ephemeris_stale`), Katalogaktualisierung erzwingen. Zusätzlich Warnung, wenn `ephemeris.source_date` älter als 365 Tage ist und ein neuerer Katalogstand vorliegt. Zahlenbeispiel (TESS-Kandidat, σP = 1e-4 d, σT0 = 1e-3 d, P = 3 d, T14 = 2 h): nach 1 Jahr σ = 19 min, nach 3 Jahren 54 min, nach 10 Jahren **177 min** – mehr als jede Nacht hergibt.
- **Baseline (verbindlich, AST-T13):** Vorgabe **dauerabhängig**: `baselineVorMin = baselineNachMin = clamp(round(30·T14[h]), 30, 120)`, also T14/2 je Seite mit Minimum 30 min und Deckel 2 h. Belegt ist nur das **30-min-Minimum** (BAA: „observe for half the expected transit duration either side … 30 mins … should be considered the minimum"); ein fester 60-min-Wert ist bei T14 = 1,4 h zu lang und bei T14 = 4 h nur halb so lang wie nötig.
- *Beobachtbar*: Sonne unter der Dämmerungsgrenze (gleicher Operator wie `CanImage`) und scheinbare Höhe ≥ Mindesthöhe – geprüft an **`Tc_utc − k·σ`, `Tc_utc` und `Tc_utc + k·σ`**, nicht nur an der nominalen Mitte (AST-T19). Für Exoplaneten-Projekte ist die Standard-Dämmerungsgrenze **−18°**; die Suche läuft mit −12° und kennzeichnet solche Fenster mit *Baseline in der Dämmerung* (bei −12° ändert sich die Himmelshelligkeit noch um mehrere Zehntel mag/h und erzeugt einen Trend in der Baseline). Der Slot-Test nutzt dieselbe Regel wie die Planung (A-26: Beginn **und** Ende des Slots).
- *Vollständig beobachtbar*: alle 5-min-Slots des Fensters erfüllen beides; sonst *teilweise* mit Anteil in %.

## 3. Reservierung im Nachtplan
- Nur `transit_observation.status = 'locked'` für diese Nacht und dieses Rig.
- Gesperrt werden alle Slots, deren **Slotmitte** im Fenster liegt und in denen das Ziel nutzbar ist (`allocation.md` §7.1, wie Astro PM).
- Transit hat Vorrang vor Mindestzeit und Strategie aller regulären Einheiten (FA-EXO-22). Zwei überlappende Transits: früher gesperrter (`locked_at`) gewinnt; der spätere sperrt **nichts**, wird `PreFiltered` mit `TierWorkSec = 0` und erhält die Diagnose `transit_conflict` (ENG-14). Die Anwendung lehnt überlappende Festlegungen schon beim Anlegen ab (`409 transit.window_overlap`).
- **Blockgrenzen (verbindlich, NIN5-5):** `block.startUtc` des Transitblocks ist der **Fensterbeginn** (`fenster[0]`, auf ganze Sekunden abgerundet), `block.endUtc = fenster[1]` und `entries[expose_series].untilUtc = fenster[1]`; `expose_series.atUtc = block.startUtc`. Der Slew-/Zentrier-Vorlauf steht als **erster Eintrag** `slew_center_rotate`/`slew_center` mit `atUtc = fenster[0] − slewCenterS − 60 s`, also **vor** `block.startUtc` – der einzige Fall im ganzen Plan, in dem ein Eintrag vor dem Blockbeginn liegt (im Vertrag vermerkt, `contracts/nina/README.md`). Ein unmittelbar vorhergehender regulärer Block endet deshalb spätestens zu dieser Zeit (dort greift A-7); dafür sperrt `preClaimTransits` zusätzlich jeden Slot, der `[fenster[0] − slewCenterS − 60 s, fenster[0])` schneidet (`allocation.md` §7.1, NT-25). Der **geplante Blockstart** des Transitblocks ist `min(atUtc)` seiner Einträge (der Vorlauf), nicht `block.startUtc`. Das Plugin rechnet den Vorlauf damit **nicht doppelt** ab (`execution.md` §5).
- Transitblock-Einträge: `slew_center_rotate` bzw. `slew_center`, `expose_series {lineId, filter, exposureS, untilUtc}` bis Fensterende **unabhängig vom Planungsbedarf** (`allocation.md` A-21); kein Dither, kein Filterwechsel, kein AF (außer `project.allow_autofocus`).
- **Neuplanung mitten im Fenster (§5.3 in `allocation.md`):** Liegt `startAtUtc` hinter dem Vorlaufbeginn, steht der Slew bei `startAtUtc` und die Serie beginnt bei `max(Serienbeginn, startAtUtc + slewCenterS)` – nie vor dem Slew. Die schon vergangenen, gesperrten Slots des eigenen Transits sind kein Konflikt (A-20).
- Die Slotmitte-Regel kann den ersten gesperrten Slot um bis zu 150 s nach hinten verschieben. `expose_series` beginnt trotzdem am Fensterbeginn; die Vorlaufslots davor sind der Transit-Einheit zugeteilt oder frei, **niemals** einer anderen Einheit (sonst wäre „nie zwei Einheiten je Slot“ verletzt). Sie liegen zeitlich vor `block.startUtc`, gehören aber zur Buchhaltung des Transitblocks.
- **Meridiandurchgang im Fenster (verbindlich, NT-25):** Liegt `tM + afterMin·60` im Fenster, ist der Flip **unvermeidlich** – NINA flippt nie vor `tM + afterMin` (bzw. pausiert bei `pauseBeforeMin > 0` schon vorher), ein „Vorziehen“ (bisher FA-NIN-21) gibt es nicht. Kein `meridian_flip`-Eintrag im Transitblock; stattdessen weist die Planung die erwartete **Lücke** aus:
  ```
  zyklus        = exposureS + downloadS                          # Takt der expose_series ab fenster[0]
  gapStartUtc   = pauseBeforeMin = 0 ? erste Belichtungsgrenze fenster[0] + k·zyklus ≥ tM + afterMin·60
                                     : erste Belichtungsgrenze, deren Belichtung über tM − pauseBeforeMin·60 hinausliefe
  gapDurationS  = (Wartezeit bis tM + afterMin·60, nur bei pauseBeforeMin > 0) + flipDurationS + slewCenterS   # Flip + Zentrieren
  geplante Aufnahmen = k + ⌊(fenster[1] − (gapStartUtc + gapDurationS)) / zyklus⌋
  ```
  Block-Metadaten `meridianFlip {waitStartUtc: null, plannedUtc = tM + afterMin·60, durationS, inTransitWindow: true, planned: false, gapStartUtc, gapDurationS}`; `summary.plannedFrames` zählt die Aufnahmen **ohne** Lücke. Die Diagnose `flip_in_transit` nennt Beginn und Dauer der Lücke und zusätzlich „AF nach Flip aktiv“, wenn das NINA-Profil `AutoFocusAfterFlip` meldet (Heartbeat, NT-22) – dann verlängert sich die Lücke um die AF-Dauer. Beispielnacht (HAT-P-17 b, `tM` = 04:28:23Z mit α_app, Fenster 02:08:00–07:34:00Z, Zyklus 63 s): `plannedUtc` = 04:33:23Z, `gapStartUtc` = 04:33:57Z (k = 139), `gapDurationS` = 240 + 90 = 330, danach 166 Aufnahmen → **305** Aufnahmen / 18 300 s statt 310 ohne Flip. Liegt nur `tM`, aber nicht `tM + afterMin` im Fenster, gibt es keine Lücke (NINA flippt erst nach Fensterende; `gapStartUtc = gapDurationS = null`), `inTransitWindow = true` bleibt als Hinweis. Reguläre Blöcke tragen beide Felder immer mit `null` (eine Struktur, `flip-rotation.md` §2). **Eine Definition (M8):** `inTransitWindow` = `tM` im Fenster; Lücken-Felder nur bei `tM + afterMin` im Fenster.
- **Flip im Vorlauf (verbindlich, L1):** Liegt `tM + afterMin·60` zwischen Vorlaufbeginn `v₀ = fenster[0] − slewCenterS − 60 s` und `fenster[0]`, wird der Flip in den Vorlauf gelegt, **vor** die erste Serienbelichtung: Einträge `slew_center(_rotate)` bei `v₀` → `meridian_flip` bei `max(tM + afterMin·60, v₀ + slewCenterS)` → `slew_center` → `expose_series` ab `max(fenster[0], Flipende + slewCenterS)`. Block-Metadaten `planned: true`, `inTransitWindow` nach M8 (hier `false`, weil `tM` vor dem Fenster liegt), `gapStartUtc = gapDurationS = null`. Beginnt die Serie nach `fenster[0]`, nennt die Diagnose `flip_in_transit` den späteren Serienbeginn (Ausweis im Simulator und in der Transitsuche); `summary.plannedFrames` zählt ab dem tatsächlichen Serienbeginn. Pflicht-Test: Fenster so gelegt, dass `tM + afterMin = fenster[0] − 60 s` → Flip-Eintrag vor `expose_series`, kein Flip während der Serie.

## 4. Pflicht-Tests
- 3 Fixture-Planeten (HAT-P-17 b, WASP-12 b, TrES-3 b) × **mindestens 5 Epochen, über ≥ 1 Jahr verteilt** (Abstand ≥ 2 Monate), damit der Rømer-Term sein Vorzeichen wechselt. Die Menge enthält **ein Ziel mit |β| < 10°** (WASP-12 b, β = +6,4°, Rømer-Spanne 16,5 min) und **eines mit |β| > 60°** (TrES-3 b, β = +61,0°, Spanne 8,1 min). Vergleich gegen `astropy.time.Time.light_travel_time(kind='barycentric')` – **nicht** gegen „barycorr", das ist kein astropy-Bestandteil (AST-T16). Toleranz **±1 s**. Dieselbe Fixture-Liste in TK 9.1 (`transits.yaml`).
- **Skalen-Gegenprobe (AST-T1):** Für jeden Fixture-Fall wird zusätzlich geprüft, dass `fenster[0]` und `block.startUtc` **JD_UTC** sind: die Differenz `fenster[0] − (Tc_bjd − T14/48 − puffer − baseline)` in Sekunden muss `−ltt − (TT−UTC) − (TDB−TT)` ergeben (Beispielnacht 2026-09-18, HAT-P-17 b, Starfront: −362,23 s − 69,184 s + 0,002 s = **−431,41 s**; Rømer- und Uhrterm haben bei positivem `ltt` dasselbe Vorzeichen – die frühere Zeile „−210,157 s + 69,184 s“ war mehrdeutig und ist ersetzt). Ein Durchlauf ohne den Umrechnungsschritt fällt damit auf.
- **Bezugsrahmen (AST-T6):** derselbe Transit mit J2000- und mit datumsbezogener Zielrichtung – Differenz ≤ 0,05 s (erwartet ≈ 0 mit J2000, ≈ 3 s mit der falschen Richtung).
- **Zeitsystem-Gegenprobe (AST-T8):** dieselbe Epoche als `HJD_UTC` und als `BJD_UTC` eingespeist – die Differenz muss `32,184 s + (TAI−UTC)(T0) ± (r⃗_Sonne,bary·n̂)/c` ergeben; eine HJD/BJD-Verwechslung wird so sichtbar.
- **Schaltsekunden:** je eine Epoche **unmittelbar vor und nach jedem Sprung** der Tabelle (1999/2006/2009/2012-07/2015-07/2017). Der Test prüft **strenge Sortierung nach Datum** und Schrittweiten aus {+1, −1} – **nicht** Monotonie der Werte: eine negative Schaltsekunde wird diskutiert, und der CGPM-Beschluss von 2022 ändert das Regime bis 2035 (AST-T14).
- `σ`-Puffer wächst linear mit |n| und enthält `ocSigmaMin`; Untergrenze 5 min greift; `ocMin` verschiebt das Fenster nur bei `|ocMin| > 3·ocSigmaMin`.
- **Ephemeridenalter:** ein Fall mit `k·σ` zwischen `0,5·T14` und `T14` → Warnung; einer über `T14` → `409 transit.ephemeris_stale`.
- **Tiefe:** je eine Zeile aus NASA (%), TOI (ppm) und ExoClock (mmag) → alle drei ergeben dieselbe Tiefe in mmag (Kontrollwert 1 % = 10 000 ppm = 10,912 mmag, ±0,002).
- **Baseline:** T14 = 1,36 h → 41 min je Seite; T14 = 4,04 h → **120 min** (der Deckel greift bereits hier: `round(30·4,04) = 121` → `clamp(…,30,120)`); T14 = 6 h → 120 min.
- Zeitsystem: HJD_UTC-Epoche (2008) → nach Normalisierung stimmt die Mitte auf ±1 s; BTJD-Wert ohne Offset wird erkannt und korrigiert; ein MJD-artiger Wert wird **abgelehnt** (`422 exo.epoch_out_of_range`) statt geraten; `unknown` → Fenster je Seite 10 min breiter.
- Ultrakurzperiode `P = 0,3 d`: zwei Transitfenster in einer Nacht, beide gefunden.
- Reservierung: Soll-Plan „Transit-Sperre".
