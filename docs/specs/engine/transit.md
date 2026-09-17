# Spezifikation: Transitvorhersage und Reservierung

Verbindlich für AP-41 (Rechnung) und AP-44 (Reservierung, Plugin-Transitblock: `specs/nina/execution.md` §5). Bezug: FA-EXO-*, Fachkonzept 8.7, TK 8.5.

## 1. Zeitskalen und Quell-Zeitsysteme
- Ephemeride `T0` (BJD_TDB), `P` (Tage), `σT0`, `σP` (Tage), `T14` (Stunden), optional `ocMin` (letzte O−C, Minuten), `timeSystemSource` (Herkunft der Epoche).
- **Normalisierung beim Import (verbindlich).** Jede Katalog-Epoche wird auf **BJD_TDB** gebracht und das Quellsystem gespeichert:
  1. **Offset:** `T0 < 2 400 000` → **BTJD** (TESS/TOI), `+ 2 457 000`; `2 400 000 ≤ T0 < 2 400 001` → MJD-artig, `+ 2 400 000,5`; sonst unverändert.
  2. **Zeitsystem** (NASA Exoplanet Archive: Spalte `pl_tsystemref`): `BJD_TDB` → unverändert · `BJD_UTC` → `+ (TT−TAI + (TAI−UTC)(T0))/86400` · `HJD_UTC`/`JD_UTC` → zusätzlich Heliozentrum → Baryzentrum (bis ≈ 5 Lichtsekunden, aus der Sonnen-Baryzentrum-Verschiebung) · ExoClock liefert BJD_TDB.
  3. **Schaltsekunden zur Epoche:** `TAI − UTC` wird **zum Zeitpunkt von `T0`** aus der Tabelle gelesen (2008: 33 s · 2012: 34 s · 2015: 35 s · 2017–2026: 37 s), nicht mit dem heutigen Wert – sonst bis zu 4 s Fehler bei 10 s Toleranz.
  4. Unbekanntes System → `timeSystemSource = 'unknown'`, Fensterpuffer **+ 2 min** und Kennzeichen „Zeitsystem unsicher“ in S-22/S-31.
  Ohne diese Normalisierung liegt der Fehler bei HJD_UTC-Epochen bei 65–70 s.
- Umrechnung BJD_TDB → JD_UTC am Standort:
  1. `JD_TDB ≈ BJD_TDB − Δ_Rømer`, `Δ_Rømer = (r⃗_Erde,bary · n̂_Ziel)/c`. Maximum 1,01671 AU ⇒ **8,46 min** (1 AU = 8,3167 min; dieselbe Zahl in FK 8.7 und TK 8.5). Baryzentrische Erdposition aus **VSOP87 (gekürzte Reihen, Erde-Mond-Baryzentrum) plus Sonnenversatz durch Jupiter, Saturn, Uranus und Neptun** (Keplerbahnen; Beiträge 2,48 / 1,37 / 0,42 / 0,77 Lichtsekunden). **Zwei Iterationen** (die Zielrichtung ist fest, nur die Erdposition wird nachgeführt); Lichtlaufzeit ±2 s.
  2. `TDB − TT ≈ 0,001657 s · sin(g)`; `TT − TAI = 32,184 s`; `TAI − UTC` aus der Schaltsekundentabelle (Stand 2026: 37 s; neue Einträge → Engine-Version).
- Toleranz gegen astropy (TK 9): **±10 s** für die Transitmitte in UTC.

## 2. Vorhersage
```
# Alle Größen in TAGEN rechnen: T14/24, σ, baseline/1440, ocMin/1440
nightMid = Mitte des Nachtfensters (FK 8.1), als JD_TDB
n0     = q((JD_TDB(nightMid) − T0)/P, 1)                 # ganzzahlig, Rundung nach canonical-json.md
Kandidaten: alle n ab n0 nach beiden Seiten, solange Tc(n) im Suchintervall
            [nightStart − halbeBreite ; nightEnd + halbeBreite] liegt,
            halbeBreite = T14/48 + k·σ + max(baselineVorMin, baselineNachMin)/1440
            (bei Ultrakurzperioden P < 0,4 d liegen mehrere Transits in einer Nacht)
Tc     = T0 + n·P + ocMin/1440   # letzte O−C verschiebt die Mitte MIT Vorzeichen
σ      = |n|·σP + σT0            # Tage; bewusst linear addiert = konservativ statt quadratisch
puffer = k·σ                     # k ∈ {1,2,3}, Standard 1; die O−C steckt nicht im Puffer
ingress = Tc − T14/48 ; egress = Tc + T14/48
fenster = [ingress − puffer − baselineVorMin/1440 ; egress + puffer + baselineNachMin/1440]
          + 2/1440 beidseitig, wenn timeSystemSource = 'unknown'
```
- *Beobachtbar*: Transitmitte mit Sonne unter der Dämmerungsgrenze (gleicher Operator wie `CanImage`; Suche −12°, Projekt: dessen Grenze) und scheinbarer Höhe ≥ Mindesthöhe. Der Slot-Test nutzt dieselbe Regel wie die Planung (A-26: Beginn **und** Ende des Slots).
- *Vollständig beobachtbar*: alle 5-min-Slots des Fensters erfüllen beides; sonst *teilweise* mit Anteil in %.
- Tiefe: `(Rp/R★)²`; `Δm = −2,5·log10(1 − Tiefe)`.

## 3. Reservierung im Nachtplan
- Nur `transit_observation.status = 'locked'` für diese Nacht und dieses Rig.
- Gesperrt werden alle Slots, deren **Slotmitte** im Fenster liegt und in denen das Ziel nutzbar ist (`allocation.md` §7.1, wie Astro PM).
- Transit hat Vorrang vor Mindestzeit und Strategie aller regulären Einheiten (FA-EXO-22). Zwei überlappende Transits: früher gesperrter (`locked_at`) gewinnt; der spätere sperrt **nichts**, wird `PreFiltered` mit `TierWorkSec = 0` und erhält die Diagnose `transit_conflict` (ENG-14). Die Anwendung lehnt überlappende Festlegungen schon beim Anlegen ab (`409 transit.window_overlap`).
- **Blockgrenzen (verbindlich, NIN5-5):** `block.startUtc` des Transitblocks ist der **Fensterbeginn** (`fenster[0]`, auf ganze Sekunden abgerundet), `block.endUtc = fenster[1]` und `entries[expose_series].untilUtc = fenster[1]`; `expose_series.atUtc = block.startUtc`. Der Slew-/Zentrier-Vorlauf steht als **erster Eintrag** `slew_center_rotate`/`slew_center` mit `atUtc = fenster[0] − slewCenterS − 60 s`, also **vor** `block.startUtc` – der einzige Fall im ganzen Plan, in dem ein Eintrag vor dem Blockbeginn liegt (im Vertrag vermerkt, `contracts/nina/README.md`). Ein unmittelbar vorhergehender regulärer Block endet deshalb spätestens zu dieser Zeit (dort greift A-7). Das Plugin rechnet den Vorlauf damit **nicht doppelt** ab (`execution.md` §5).
- Transitblock-Einträge: `slew_center_rotate` bzw. `slew_center`, `expose_series {lineId, filter, exposureS, untilUtc}` bis Fensterende **unabhängig vom Planungsbedarf** (`allocation.md` A-21); kein Dither, kein Filterwechsel, kein AF (außer `project.allow_autofocus`).
- Die Slotmitte-Regel kann den ersten gesperrten Slot um bis zu 150 s nach hinten verschieben. `expose_series` beginnt trotzdem am Fensterbeginn; die Vorlaufslots davor sind der Transit-Einheit zugeteilt oder frei, **niemals** einer anderen Einheit (sonst wäre „nie zwei Einheiten je Slot“ verletzt). Sie liegen zeitlich vor `block.startUtc`, gehören aber zur Buchhaltung des Transitblocks.
- Meridiandurchgang im Fenster: kein `meridian_flip`-Eintrag im Transitblock, Diagnose `flip_in_transit` (FA-NIN-21).

## 4. Pflicht-Tests
- 3 Fixture-Planeten (HAT-P-17 b, WASP-12 b, TrES-3 b) × 5 Epochen gegen astropy (`astropy.time` + `barycorr`), ±10 s.
- Grenzfall Schaltsekunde nicht nötig bis neue Einträge; Test, dass die Tabelle sortiert und monoton ist.
- `σ`-Puffer wächst linear mit |n|; `ocMin` verschiebt das Fenster (mit Vorzeichen), der Puffer bleibt symmetrisch.
- Zeitsystem: HJD_UTC-Epoche (2008) → nach Normalisierung stimmt die Mitte auf ±10 s; BTJD-Wert ohne Offset wird erkannt und korrigiert; `unknown` → Fenster 2 min breiter.
- Ultrakurzperiode `P = 0,3 d`: zwei Transitfenster in einer Nacht, beide gefunden.
- Reservierung: Soll-Plan „Transit-Sperre“.
