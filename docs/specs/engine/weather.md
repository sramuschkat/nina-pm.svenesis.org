# Spezifikation: Wetterbewertung (`weatherScores`)

Verbindlich für AP-23 (Wetter) und AP-08b (Portierung aus `weather-core.js` für die Bewertung und aus `astro-weather.js` für Abruf, Modellkette, Nest-Erkennung und Anzeige, WS-19). Bezug: FA-WET-01…09, FA-FOL-03, TK 8.2, TK 8.4, TK 14.

> **Warum diese Datei (AST-D24) und warum sie neu geschrieben ist (WS, 23.09.2026).** `weatherScores` gehört laut TK 8.2 zur deterministischen Engine, hatte aber – anders als Mond, Dämmerung und Geometrie – lange keine Spezifikation: die einzige Quelle war die kopierte Legacy-Datei der Website. Damit fehlten benannte Eingangsvariablen mit Einheit, der Stundenbezug, die Formeln und die Rundung. Open-Meteo liefert **weder Seeing noch Transparenz** – beides sind Ableitungen, und das muss als solches dastehen.
> Mit dem Website-Stand vom 21.09.2026 liegt die gesamte Bewertung in der neuen Datei `js/weather-core.js`, und die Formeln haben sich **alle** geändert. Entscheidung des Auftraggebers (WS-E1): **Die Bewertung wird exakt 1:1 aus dem neuen Code übernommen**, damit Website und NINA-PM für dieselbe Stunde dieselbe Zahl zeigen. Der Wertebereich ist deshalb **0…1** (nicht mehr 0…100), und die alten Größen `cloudEff`, der Regen-Riegel, der zweite Transparenzzweig und die englischen Klassennamen entfallen. Es gibt genau **eine** bewusste Abweichung in der **Bewertung** (§2.3, WS-04a) und **drei** in der **Anzeigeauswertung** (§3.3: `moonFreeSec` nur für das gemeldete Fenster, Rückfall auf die 0,45-Stufe auch bei einem zu kurzen 0,65-Fenster, Höhenkonvention des Mondes). Alles übrige ist bitgleich zur Vorlage.

**Was in dieser Datei nicht steht.** Farben, Ampelstops, Skalen, Windstufen, Taugefahr und die Hilfsbewertungen für Wasserdampf, Staub, Sicht und Regenwahrscheinlichkeit sind **nicht Teil der Bewertung**; sie stehen im Baustein-Vertrag `WeatherChart` (`specs/ui/components.md` §2.5, WS-17). Die Vorhersagegüte-Historie der Website (`weather-history.js`, `previous-runs-api.open-meteo.com`, `mesonet.agron.iastate.edu`) wird **nicht übernommen** (WS-E3, TK 8.4).

## 1. Eingaben je Stunde (`WeatherHourly`)

Alle Größen kommen aus Open-Meteo, Abruf mit `timezone=UTC&timeformat=unixtime` (TK 14, AST-D25; die Website nutzt `timezone=auto`, NINA-PM rechnet ausschließlich in UTC und bildet Standortzeit über die Übergangstabelle aus `night.md` §1 ab). Aerosol kommt aus der **getrennten** Air-Quality-API mit eigenem Horizont (TK 14, AST-D23).

### 1.1 Rohwerte (WS-11)

| Feld | Open-Meteo-Variable | Einheit | Art | Wirkung |
|---|---|---|---|---|
| `tUnix` | `time` | s (UTC) | Stundenanfang | Schlüssel |
| `cloudTotalPct` | `cloud_cover` | % | Momentanwert | **`cloudScore`** (§2.1) |
| `cloudLowPct` | `cloud_cover_low` | % | Momentanwert | nur Anzeige |
| `cloudMidPct` | `cloud_cover_mid` | % | Momentanwert | nur Anzeige |
| `cloudHighPct` | `cloud_cover_high` | % | Momentanwert | nur Anzeige |
| `tempC` | `temperature_2m` | °C | Momentanwert | Nest-Erkennung (§1.4), Anzeige |
| `dewPointC` | `dew_point_2m` | °C | Momentanwert | nur Anzeige (Taupunktabstand) |
| `humidityPct` | `relative_humidity_2m` | % | Momentanwert | **`transparencyScore`** (§2.4) |
| `wind10Kmh` | `wind_speed_10m` | km/h | Momentanwert | **`seeingScore`** (§2.3) |
| `gust10Kmh` | `wind_gusts_10m` | km/h | **Intervallwert** (§1.2) | nur Anzeige |
| `windDir10Deg` | `wind_direction_10m` | ° (0…360, Richtung, **aus** der der Wind weht) | Momentanwert | nur Anzeige |
| `wind250Kmh` | `wind_speed_250hPa` | km/h | Momentanwert | `jetKmh`, `shearKmh` |
| `windDir250Deg` | `wind_direction_250hPa` | ° | Momentanwert | `shearKmh` |
| `wind500Kmh` | `wind_speed_500hPa` | km/h | Momentanwert | `jetKmh`, `shearKmh` (Untergrenze) |
| `windDir500Deg` | `wind_direction_500hPa` | ° | Momentanwert | `shearKmh` (Untergrenze) |
| `wind700Kmh` | `wind_speed_700hPa` | km/h | Momentanwert | `shearKmh` (Untergrenze) |
| `windDir700Deg` | `wind_direction_700hPa` | ° | Momentanwert | `shearKmh` (Untergrenze) |
| `wind850Kmh` | `wind_speed_850hPa` | km/h | Momentanwert | `shearKmh` (Regelfall) |
| `windDir850Deg` | `wind_direction_850hPa` | ° | Momentanwert | `shearKmh` (Regelfall) |
| `surfacePressureHPa` | `surface_pressure` | hPa | Momentanwert | wählt die Scherungs-Untergrenze (§2.2) |
| `visibilityM` | `visibility` | m | Momentanwert | **ohne Wirkung auf die Bewertung**; Anzeige und Modell-Erkennung (§1.5) |
| `precipMm` | `precipitation` | mm | **Intervallwert** | **ohne Wirkung auf die Bewertung** (WS-E1) |
| `precipProbPct` | `precipitation_probability` | % | **Intervallwert** | **ohne Wirkung auf die Bewertung** (WS-E1) |
| `weatherCode` | `weather_code` | WMO-Code | Momentanwert | Symbol; Ableitung §1.6 |
| `aod` | `aerosol_optical_depth` | dimensionslos (550 nm) | Momentanwert | **`transparencyScore`**; **fehlt ab Tag 5** (CAMS-Horizont) |
| `dustUgM3` | `dust` | µg/m³ | Momentanwert | nur Anzeige (im `aod` bereits enthalten) |
| `pwvMm` | `total_column_integrated_water_vapour` | kg/m² ≙ mm | Momentanwert | **`transparencyScore`**; aus dem Modellvergleichs-Abruf (§1.3) |

**Abgeleitet je Stunde:** `jetKmh` (km/h, §2.2), `shearKmh` (km/h, §2.2) und `moonAltDeg` (Grad, §3.3) – die **geometrische topozentrische** Mondhöhe zum Stundenmittelpunkt `tUnix + 1800`, aus der `bestWindow` den mondfreien Anteil bildet (WS-10). `moonAltDeg` geht in **keine** Bewertung ein und wird mit den Stunden gespeichert (siehe §3.4).

**Herkunft je Stunde** (Kennzeichen, gehen in `payload` und in die Anzeige ein):

| Feld | Werte | Bedeutung |
|---|---|---|
| `modelId` | `d2 \| eu \| global \| dini \| hrrr \| gem \| gfs` (`enums.json` → `weatherModels`) | welches Modell die Stunde geliefert hat (§1.5) |
| `cloudSrc` | `dini \| gem \| null` (`enums.json` → `cloudSources`) | welches feine Modell die Wolkenzeilen übernommen hat (`null` = Basismodell) |
| `nest` | `boolean` | Stunde liegt im hochauflösenden Nest (ICON-D2 bzw. HRRR, §1.4) |
| `aerosolMissing` | `boolean` | `aod == null` – Air-Quality-Abruf ausgefallen **oder** Stunde jenseits des CAMS-Horizonts (WS-E2) |
| `seeingIncomplete` | `boolean` | `jetKmh != null and (wind250Kmh == null or wind500Kmh == null or shearKmh == null or wind10Kmh == null)` – mindestens ein Eingangswert des Seeings fehlt, gerechnet wurde mit normierten Gewichten bzw. mit dem Ersatzwert 0 in `jetKmh` (§2.2/§2.3, WS-04a). **Ohne Score kein Kennzeichen:** ist `jetKmh == null`, gibt es keinen `seeingScore` und damit auch nichts zu kennzeichnen – `seeingIncomplete = false` |

`null` bedeutet bei jedem Feld **keine Aussage** und wird nie durch 0, einen Mittelwert oder einen Nachbarwert ersetzt. **Ausnahme `jetKmh` (§2.2, 1:1 aus der Vorlage, WS-03):** dort zählt ein fehlender Einzelwert `wind250Kmh` bzw. `wind500Kmh` als **0**, weil `max()` sonst keinen Wert hätte; nur wenn **beide** fehlen, ist `jetKmh = null`. Diese eine Stelle ersetzt also ein `null` durch 0 – sie ist bewusst übernommen (WS-E1) und wird über `seeingIncomplete` kenntlich gemacht.

### 1.2 Momentanwerte gegen Intervallwerte (verbindlich, WS-12)

Böen (`gust10Kmh`), Niederschlag (`precipMm`) und Regenwahrscheinlichkeit (`precipProbPct`) sind bei Open-Meteo Werte der **vorangehenden** Stunde. Die Spalte einer Stunde beschreibt aber das Intervall `t … t + 1 h`. Deshalb gilt:

```
for k in { gust10Kmh, precipMm, precipProbPct }:
    hour[i][k] = (i + 1 < n) ? raw[k][i + 1] : null      # Stempel t + 1 h
for jedes andere Rohfeld k:
    hour[i][k] = raw[k][i]                               # Stempel t
```

Die frühere Formulierung „Wert der vorangehenden Stunde“ war um eine Stunde versetzt und ist damit **ersetzt**: entnommen wird der Wert **zum Zeitstempel `t + 1 h`**, weil genau dieser Wert das Intervall `t … t + 1 h` beschreibt. Die letzte Stunde der Reihe hat dafür keinen Nachfolger und trägt `null`. Der Pflichttest §4 (b) ist entsprechend gedreht.

Alle anderen Größen – Bewölkung, Sicht, Temperatur, Taupunkt, Feuchte, Wind in allen Niveaus, Bodendruck, Wetterschlüssel, Aerosol, Staub, Wasserdampf – sind **Momentanwerte zum Stundenanfang** `t`.

### 1.3 Abrufe und Modellwahl (WS-13)

Drei HTTP-Aufrufe je Standort und Lauf. Gemeinsame Abfrage `q`:
`latitude=<lat>&longitude=<lon>&forecast_days=7&past_days=1&timeformat=unixtime&timezone=UTC`
(`past_days=1`, damit eine laufende Nacht vollständig ist; die Stunden vor der laufenden Nacht werden anschließend über `nightKeyOf` verworfen.)

1. **Hauptmodell (Pflicht).** Fällt dieser Abruf aus, entsteht **keine** neue `weather_cache`-Zeile; der letzte gespeicherte Stand bleibt gültig und wird mit seinem Zeitstempel angezeigt. Es gibt dafür **keinen neuen Fehlercode** (WS).
   `europa = lat ≥ 29,5 and lat ≤ 70,5 and lon ≥ −23,5 and lon ≤ 62,5`
   `https://api.open-meteo.com/v1/` + (`europa ? 'dwd-icon' : 'gfs'`) + `?` + `q` + `&wind_speed_unit=kmh&hourly=<alle Rohvariablen aus §1.1 außer aerosol_optical_depth, dust, total_column_integrated_water_vapour>`
2. **Aerosol (optional).**
   `https://air-quality-api.open-meteo.com/v1/air-quality?` + `q` + `&hourly=aerosol_optical_depth,dust`
   Ausfall oder Horizontende → `aod = null`, `dustUgM3 = null`, `aerosolMissing = true` (WS-E2).
3. **Modellvergleich (optional).**
   `fine  = europa ? 'dmi_harmonie_arome_europe' : 'cmc_gem_seamless'`
   `cmp3  = europa ? 'cmc_gem_seamless'          : 'ncep_nbm_conus'`
   `models = distinct([ 'ecmwf_ifs', fine, cmp3 ] + (europa ? [ 'icon_d2' ] : [ 'ncep_hrrr_conus', 'ncep_nbm_conus' ]))`
   `https://api.open-meteo.com/v1/forecast?` + `q` + `&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,total_column_integrated_water_vapour,temperature_2m,visibility,precipitation_probability&models=<models>`
   Ausfall → `pwvMm = null`, keine Vergleichszeilen, kein Nest, `cloudSrc = null`.

**Suffix-Vorrang (verbindlich):** Open-Meteo hängt das Modellsuffix nur dort an, wo mehrere Modelle Daten haben; bleibt eines übrig, kommt der Wert ohne Suffix. Gelesen wird deshalb immer `suffixed || plain`, z. B. `cloud_cover_ecmwf_ifs || cloud_cover`.

**Zuordnung der Vergleichsreihen** (alle `null`-tolerant):

| Größe | Quelle | Verwendung |
|---|---|---|
| `pwvMm` | `total_column_integrated_water_vapour_ecmwf_ifs \|\| …` | `transparencyScore` |
| Wolken ECMWF | `cloud_cover_ecmwf_ifs \|\| cloud_cover` | nur Anzeige (zweite Meinung) |
| Wolken `cmp3` | `cloud_cover_<cmp3>` | nur Anzeige (dritte Meinung); fehlt die Reihe, zeigt die Zeile den Wert des Basismodells |
| Nest-Temperatur / -Bedeckung | `temperature_2m_icon_d2 \|\| temperature_2m_ncep_hrrr_conus`, `cloud_cover_icon_d2 \|\| cloud_cover_ncep_hrrr_conus` | Nest-Erkennung (§1.4) |
| feine Wolken + Sicht | `cloud_cover_<fine>`, `cloud_cover_low/mid/high_<fine>`, `visibility_<fine>` | ersetzen nach dem Nest die Wolkenzeilen und die Sicht |
| NBM | `cloud_cover_ncep_nbm_conus`, `visibility_ncep_nbm_conus`, `precipitation_probability_ncep_nbm_conus` | Sicht und Regenwahrscheinlichkeit nach dem Nest (Nordamerika) |

### 1.4 Nest-Erkennung je Stunde (WS-14)

Das hochauflösende Nest (ICON-D2 in Europa, HRRR in Nordamerika) wird nicht angekündigt, sondern **erkannt**: eine Stunde liegt im Nest, wenn die seamless-Reihe dieselbe Temperatur und dieselbe Bedeckung wie das Nestmodell hat.

```
NEST_MAX_H = europa ? unbegrenzt : 30            # Stunden
nestUntil  = nowUtc + NEST_MAX_H · 3600          # einmal je Lauf, vor der Schleife
nestSeen = false; nestOver = false
for jede Stunde h in aufsteigender Zeit:
    nestHere = nestTemp[t] != null and nestCloud[t] != null and h.tempC != null
               and |nestTemp[t] − h.tempC| < 0,05
               and nestCloud[t] == h.cloudTotalPct          # exakte Gleichheit
    if nestSeen and nestTemp[t] != null and not nestHere: nestOver = true   # Latch: kein Wiedereinstieg
    if nestHere and not nestOver: nestSeen = true
    h.nest = nestHere and not nestOver and h.tUnix <= nestUntil
```

- `NEST_MAX_H = 30 h` in **Nordamerika** (HRRR ist am ersten Tag das beste und am zweiten das schwächste der feinen Modelle; 30 statt 24, damit keine Nacht in der Mitte zerschnitten wird), **unbegrenzt** in Europa (ICON-D2 hat diese Schwäche nicht).
- `nestUntil` wird **einmal je Lauf** vor der Stundenschleife festgelegt. Wird es in der Schleife neu bestimmt, ist es dort noch undefiniert, der Vergleich wird `NaN` und **jede** Stunde fällt aus dem Nest (Fehler der Vorlage, dort ausdrücklich kommentiert).
- **Latch:** Nach dem ersten Verlassen des Nests gibt es keinen Wiedereinstieg, damit ein zufälliges späteres Zusammentreffen von Temperatur und Bedeckung nicht als Nest gelesen wird. Der Latch wird nur gesetzt, wenn das Nestmodell für die Stunde überhaupt Daten hat.

**Nach dem Nest** (`h.nest == false`) übernimmt das feine Modell:

```
if not h.nest:
    fn = feine Reihe zu t
    if fn != null and fn.cloud != null:
        h.cloudTotalPct = fn.cloud
        h.cloudSrc      = europa ? 'dini' : 'gem'
        if fn.low  != null: h.cloudLowPct  = fn.low
        if fn.mid  != null: h.cloudMidPct  = fn.mid
        if fn.high != null: h.cloudHighPct = fn.high
        if fn.vis > 0:      h.visibilityM  = fn.vis      # eine glatte 0 ist ein Füllwert, keine Nebelstunde
    nb = NBM-Reihe zu t
    if nb != null:
        if nb.vis > 0: h.visibilityM = nb.vis
        nbNext = NBM-Reihe zu t + 3600                   # Intervallwert, §1.2
        if nbNext != null and nbNext.prob != null: h.precipProbPct = nbNext.prob
```

Weil `cloudTotalPct` damit aus dem feinen Modell kommt, rechnet `cloudScore` – und über §2.5 die Gesamtnote – nach dem Nest mit dem feineren Wolkenwert. Das ist beabsichtigt und der Grund, warum `cloudSrc` mitgeführt und angezeigt wird.

### 1.5 `modelId` je Stunde (WS-13/WS-14)

```
if europa: modelId = h.nest ? 'd2'   : h.cloudSrc == 'dini' ? 'dini' : h.visibilityM != null ? 'eu' : 'global'
else:      modelId = h.nest ? 'hrrr' : h.cloudSrc == 'gem'  ? 'gem'  : 'gfs'
```

`visibilityM` unterscheidet in Europa ICON-EU von ICON global, weil das globale ICON keine Sicht liefert – das ist die einzige Stelle, an der die Sicht überhaupt etwas bewirkt.

### 1.6 `weatherCode` neu ableiten (WS-15)

Der Wetterschlüssel kommt aus dem Basismodell, die Bedeckung nach dem Nest aber aus dem feinen Modell. Damit Symbol und Zahl zusammenpassen, wird ein **reiner Wolkencode** neu abgeleitet:

```
if h.cloudSrc != null and h.weatherCode != null and h.weatherCode <= 3 and h.cloudTotalPct != null:
    h.weatherCode = h.cloudTotalPct < 12,5 ? 0 : h.cloudTotalPct < 37,5 ? 1 : h.cloudTotalPct < 75 ? 2 : 3
```

Niederschlagscodes (≥ 4, also Nebel, Nieseln, Regen, Schnee, Gewitter) bleiben **unangetastet** – sie tragen eine Aussage, die eine Wolkenzahl nicht ersetzen kann. Der Code wirkt nur auf das Symbol, nie auf eine Bewertung.

## 2. Teilbewertungen

Alle Teilbewertungen liefern **`double` im Bereich 0…1** (1 = bestmöglich) oder **`null` = keine Aussage**. Gerechnet und gespeichert wird ungerundet; **unmittelbar vor Vergleich, `outputHash` und Ausgabe** gilt `q(x, 1e3)` – drei Dezimalstellen, `roundHalfAwayFromZero` mit ganzzahligem Kehrwert (`canonical-json.md`, WS-08). Damit bleibt die Jint-Parität gewahrt, ohne dass eine Formel angefasst wird. `clamp(v, a, b) = max(a, min(b, v))`.

> **Niederschlag geht in keine Bewertung ein (WS-E1, FA-WET-09, FA-FOL-03).** Es gibt weder einen Regen-Riegel noch einen Niederschlagsterm. Eine Regennacht wird **allein über die Bewölkung** bewertet; das funktioniert, weil Regen praktisch immer mit hoher Bedeckung einhergeht und `cloudScore` dann gegen 0 geht. `precipMm` und `precipProbPct` werden weiter abgerufen, angezeigt und in `payload` gespeichert – sie bewerten aber nichts. Das ist bewusst so entschieden, damit Website und NINA-PM dieselben Zahlen liefern.

### 2.1 `cloudScore(cloudTotalPct)` (WS-01)

```
cloudScore(c):
    if c == null: return null
    return clamp(1 − c / 100, 0, 1)
```

- **Eingang: die Gesamtbedeckung** `cloudTotalPct` (`cloud_cover`), nach dem Nest die des feinen Modells (§1.4).
- Die alte wirksame Bedeckung `cloudEff = max(cloudLow, 0,8·cloudMid, 0,5·cloudHigh)` **entfällt**. Tiefe, mittlere und hohe Bewölkung bleiben Anzeige und gehen in keine Bewertung ein.
- Wirkbereich: linear über den ganzen Bereich; 0 % → 1, 50 % → 0,5, 100 % → 0.

### 2.2 `jetKmh` und `shearKmh` (WS-02/WS-03)

```
windShear(s1, d1, s2, d2):                          # Vektordifferenz zweier Winde
    if s1 == null or s2 == null or d1 == null or d2 == null: return null
    du = s1 · sin(d1 · π/180) − s2 · sin(d2 · π/180)
    dv = s1 · cos(d1 · π/180) − s2 · cos(d2 · π/180)
    return sqrt(du² + dv²)                          # km/h
```

```
jetKmh:
    if wind250Kmh == null and wind500Kmh == null: jetKmh = null
    else: jetKmh = max( wind250Kmh ?? 0 , 1,3 · (wind500Kmh ?? 0) )     # fehlt einer, zählt er als 0

lowLevel:                                            # Untergrenze der Scherung nach Bodendruck
    if surfacePressureHPa != null and surfacePressureHPa < 750: lowLevel = 500
    elif surfacePressureHPa != null and surfacePressureHPa < 900: lowLevel = 700
    else: lowLevel = 850                             # auch bei surfacePressureHPa == null

shearKmh = windShear( wind250Kmh, windDir250Deg, wind<lowLevel>Kmh, windDir<lowLevel>Deg )
```

- `jetKmh` ist die stärkere der beiden Höhenströmungen, 500 hPa mit 1,3 aufgewertet, weil ein Starkwind in 5,5 km mehr Turbulenz macht als dieselbe Geschwindigkeit in 10 km.
- Die Untergrenze der Scherung liegt normalerweise bei 850 hPa (≈ 1,5 km); im Hochgebirge liegt 850 hPa bereits im Boden, deshalb rückt sie mit dem Bodendruck auf 700 bzw. 500 hPa.
- `shearKmh` ist `null`, sobald eine der vier Größen fehlt – das ist der Regelfall, der §2.3 (WS-04a) auslöst.

### 2.3 `seeingScore({ jetKmh, shearKmh, wind10Kmh })` (WS-04) und die einzige Abweichung (WS-04a)

**Vorlage (`weather-core.js`), nicht übernommen:**

```
penalty = 0,45 · clamp((jetKmh − 20)/110, 0, 1)
        + 0,35 · clamp(((shearKmh  ?? 0) − 20)/100, 0, 1)
        + 0,20 · clamp(((wind10Kmh ?? 0) −  8)/ 25, 0, 1)
```

**Verbindlich für NINA-PM:**

```
seeingScore(jetKmh, shearKmh, wind10Kmh):
    if jetKmh == null: return null                       # ohne Höhenwind keine Aussage
    terms = [ (0,45, clamp((jetKmh − 20)/110, 0, 1)) ]   # immer vorhanden, weil jetKmh != null
    if shearKmh  != null: terms += (0,35, clamp((shearKmh  − 20)/100, 0, 1))
    if wind10Kmh != null: terms += (0,20, clamp((wind10Kmh −  8)/ 25, 0, 1))
    penalty = Σ wᵢ · termᵢ / Σ wᵢ                        # normierte Gewichte
    return clamp(1 − penalty, 0, 1)

seeingIncomplete = jetKmh != null
                   and (wind250Kmh == null or wind500Kmh == null
                        or shearKmh == null or wind10Kmh == null)
```

> **Begründung der Abweichung (WS-04a, TK 8.4).** Die Vorlage setzt eine fehlende Scherung und einen fehlenden Bodenwind auf **0** ein. Weil beide Terme erst oberhalb ihrer Schwelle (20 km/h bzw. 8 km/h) strafen, ist 0 nicht „unbekannt“, sondern **„ruhige Luft“** – der Datenausfall verbessert die Note. Nachgerechnet (§4, Kontrollwert 4): bei `jetKmh = 64` und fehlender Scherung **und** fehlendem Bodenwind gibt die Vorlage 0,820, obwohl nur einer von drei Termen belegt ist; mit normierten Gewichten sind es 0,600. Ein Ausfall darf die Bewertung nicht schönen, deshalb rechnet NINA-PM **nur mit den vorhandenen Termen und normiert die Gewichte**, und die Stunde trägt das Kennzeichen `seeingIncomplete` („Seeing unvollständig“).
> **Wichtig:** Sind alle drei Terme vorhanden, ist `Σ wᵢ = 0,45 + 0,35 + 0,20 = 1,00`, und die Formel ist mit der Vorlage **bitgleich**. Die Abweichung wirkt ausschließlich bei fehlenden Eingangswerten. Dass sie überhaupt greift, ist der Normalfall: `shearKmh` braucht vier Höhenwindwerte (§2.2).
> **Umfang des Kennzeichens.** `seeingIncomplete` meldet **jeden** fehlenden Eingangswert des Seeings – auch ein fehlendes `wind250Kmh` oder `wind500Kmh`, denn dort setzt `jetKmh` nach §2.2 eine 0 ein (1:1 aus der Vorlage) und die Gewichte bleiben unangetastet. Ohne `jetKmh` gibt es keinen Score, also auch kein Kennzeichen: `jetKmh == null` ⇒ `seeingScore = null` **und** `seeingIncomplete = false`.

**Wirkbereiche:** `jetKmh` strafft ab 20 km/h und ist bei 130 km/h ausgereizt; `shearKmh` ab 20 km/h, ausgereizt bei 120 km/h; `wind10Kmh` ab 8 km/h, ausgereizt bei 33 km/h. Unterhalb der jeweiligen Schwelle ist der Term 0, der Score also unbeeinflusst.

`seeingScore` ist eine **Schätzung aus dem Windprofil**, keine Messung: Open-Meteo liefert kein Seeing. In der Oberfläche steht die Zeile **immer** als *geschätzt* (FA-WET-01).

### 2.4 `transparencyScore(aod, humidityPct, pwvMm)` (WS-05, WS-E2)

```
transparencyScore(aod, rh, pwv):
    if aod == null: return null                                  # WS-E2: keine Transparenz ohne Aerosol
    s = clamp(1 − (aod − 0,05)/0,45, 0, 1)
    if rh  != null and rh > 80: s = s · clamp(1 − (rh − 80)/40, 0,5, 1)
    if pwv != null:             s = s · clamp(1 − (pwv − 25)/150, 0,85, 1)
    return s
```

- **Wirkbereiche:** `aod` ≤ 0,05 → 1, ≥ 0,50 → 0 (linear dazwischen). Die Feuchte dämpft **erst über 80 %** und höchstens auf die Hälfte (100 % → Faktor 0,5). Der Wasserdampf dämpft **erst über 25 mm** und höchstens auf 0,85 (erreicht bei **≥ 47,5 mm**: `1 − (47,5 − 25)/150 = 0,85`), weil Wasserdampf im sichtbaren Licht nur wenig absorbiert; unter 25 mm ist der Faktor durch `clamp(…, 0,85, 1)` auf 1 begrenzt, verbessert also nichts.
- Der Staub steckt bereits im `aod`; `dustUgM3` ist nur Anzeige.
- **Kein Ersatzzweig (WS-E2).** Der frühere aerosolfreie Schätzzweig (`1,8·iwv + 0,4·max(0, rh − 60)`) **entfällt**. Fehlt `aod`, gibt es **keine** Transparenz: `transparencyScore = null`, `aerosolMissing = true`, und `overallScore` verteilt das Gewicht um (§2.5). Die betroffene Stunde bzw. Nacht trägt in Oberfläche, Nachtübersicht und Mehrnacht-Prognose das Kennzeichen **„ohne Aerosol – Bewertung optimistisch“**. „Optimistisch“ ist keine Floskel: der nachgerechnete Kontrollwert 3 in §4 zeigt +0,020 auf der Gesamtnote, weil der wegfallende Term unter dem Grundwert 0,7/0,7 liegt.

### 2.5 `overallScore(cloudScore, seeingScore, transparencyScore)` (WS-06)

```
overallScore(c, se, tr):
    if c == null: return null                    # ohne Bewölkung keine Gesamtnote
    sum = 0,7; weight = 0,7
    if se != null: sum += 0,15 · se; weight += 0,15
    if tr != null: sum += 0,15 · tr; weight += 0,15
    return clamp( c · c · sum / weight , 0, 1 )
```

- **Die Bewölkung dominiert, und sie geht quadratisch ein.** Sind Seeing und Transparenz bestmöglich, ist `sum/weight = 1` und die Note genau `c²`. 50 % Bedeckung ergibt also nicht 0,5, sondern 0,25 – eine halb bedeckte Nacht ist für Langzeitbelichtung mehr als halb verdorben.
- Seeing und Transparenz **schattieren nur** eine klare Stunde: bei `c = 1` liegt die Note zwischen 0,7 (beide 0) und 1,0 (beide 1).
- **Fehlende Terme geben ihr Gewicht ab, sie zählen nicht als Mittelwert.** Fehlt die Transparenz, ist `weight = 0,85` statt 1,0, und die Note ist `c² · (0,7 + 0,15·se)/0,85`. Würde man stattdessen 0,5 einsetzen, fielen klare Stunden nach dem Ende der Aerosolvorhersage um rund sechs Punkte, ohne dass sich am Himmel etwas ändert (Kontrollwert 3: 0,584 normiert gegen 0,545 mit eingesetzter 0,5).
- Fehlen **beide**, ist `sum/weight = 1` und die Note ist `c²`.
- `overallScore` ist `null`, sobald `cloudScore` `null` ist. Solche Stunden zählen nicht in das Nachtmittel und senken die Abdeckung (§3.2).

## 3. Klassen, Nachtmittel und bestes Fenster

### 3.1 Klassen (WS-07, FA-WET-03)

```
RATING_CUTS = [ 0,25 ; 0,45 ; 0,65 ; 0,85 ]
ratingIndex(s):
    if s == null: return null
    return s >= 0,85 ? 4 : s >= 0,65 ? 3 : s >= 0,45 ? 2 : s >= 0,25 ? 1 : 0
```

| `ratingIndex` | `overallScore` (nach `q(x, 1e3)`) | Anzeigename (i18n `weather.rating.<n>`) |
|---|---|---|
| `4` | ≥ 0,85 | Ausgezeichnet |
| `3` | 0,65 … < 0,85 | Gut |
| `2` | 0,45 … < 0,65 | Mittel |
| `1` | 0,25 … < 0,45 | Schlecht |
| `0` | < 0,25 | Sehr schlecht |
| `null` | `overallScore == null` | keine Daten |

- Die Schnitte sind **nach unten inklusiv** (`>=`). Genau 0,65 ist *Gut*, nicht *Mittel*.
- **Gespeichert, verglichen und in den `outputHash` gegeben wird der ganzzahlige `ratingIndex` 0…4**, nicht ein Name. Die deutschen Namen sind Anzeigetexte über i18n und keine Enum-Werte; die alten englischen Werte `excellent|good|fair|poor|unusable` und die alten Grenzen 85/70/50/25 **entfallen** (WS-07).
- Verglichen wird der **gerundete** Score (`q(x, 1e3)`), damit Node und Jint dieselbe Klasse liefern (WS-08): 0,6495 → 0,65 → Klasse 3 auf beiden Seiten.

### 3.2 Nachtmittel `nightMean` (WS-09, FA-WET-04)

**Eingabe der Funktion (verbindlich, TK 8.2, B-07).** `weatherScores` bekommt
```
WeatherScoreInput = { hourly: WeatherHourly[],
                      darkWindows: { night: string, fromUtc: number, toUtc: number }[] }
```
also **mehrere Nächte in einem Aufruf**: `hourly` ist die durchgehende Stundenreihe des Abrufs (§1.1/§1.2), `darkWindows` trägt je Nacht ein Fenster mit dem Nacht-Schlüssel aus `night.md` §1 und den exakten −18°-Durchgängen aus `night.md` §2 als Unix-Sekunden. Der Name `darkWindows` ist derselbe wie in `specs/ui/components.md` §2.5 (dort als ISO-Zeitstempel für die Anzeige). Nächte **ohne** Dunkelheit (Polartag) stehen **nicht** in `darkWindows`; für sie gilt der Polartag-Zweig unten. Die Dunkelheitsgrenzen kommen aus `computeNight` und werden in der Wetterfunktion **nicht** gerechnet. Jede Nacht aus `darkWindows` ergibt genau eine Zeile in `payload.nights[]`, siehe §3.4; §3.2 und §3.3 beschreiben die Rechnung für **eine** dieser Nächte, `dark` ist ihr Eintrag.

Gemittelt wird über die **astronomische Dunkelheit** der Nacht – die exakten −18°-Durchgänge aus `night.md` §2, **nicht** das Nachtfenster aus `night.md` §3 (dieser frühere Bezug entfällt). Gewicht einer Stunde ist die Überlappung ihres Intervalls mit der Dunkelheit in Sekunden.

```
dark = der Eintrag dieser Nacht in darkWindows            # { night, fromUtc, toUtc }, Unix-Sekunden
if dark == null:                                           # Nacht fehlt in darkWindows = Polartag
    return { nightMean: null, coveredSec: 0, darknessSec: 0, coverage: null }
sum = 0; coveredSec = 0
for jede Stunde h der Nacht (Mittag bis Mittag, night.md §1):
    part = min(h.tUnix + 3600, dark.toUtc) − max(h.tUnix, dark.fromUtc)
    if part > 0 and h.overallScore != null:
        sum        += part · h.overallScore
        coveredSec += part
darknessSec = dark.toUtc − dark.fromUtc
nightMean   = coveredSec > 0 ? sum / coveredSec : null
coverage    = coveredSec / darknessSec
```

- **Stunden ohne `overallScore` zählen nicht in den Mittelwert und senken die Abdeckung.** So wird der Mittelwert am Ende des Vorhersagehorizonts nicht inhomogen (AST-D23): eine Nacht mit `coverage = 0,85` ist als solche erkennbar und wird in der Oberfläche als *unvollständig* gekennzeichnet.
- `coveredSec`, `darknessSec` und `coverage` werden **mitgeführt** und gespeichert (siehe §3.4), nicht nur der Mittelwert.
- `nightMean` wird wie jeder Score **ungerundet gerechnet und ungerundet gespeichert**; `q(x, 1e3)` kommt erst unmittelbar vor Vergleich, `outputHash` und Ausgabe (§2, WS-08). `coveredSec`/`darknessSec` sind ganze Sekunden, `coverage` ist wie die Scores ein ungerundeter `double`.
- Trägt **eine** Stunde der Nacht `aerosolMissing`, trägt die Nacht das Kennzeichen „ohne Aerosol – Bewertung optimistisch“ (WS-E2); dasselbe gilt für `seeingIncomplete` („Seeing unvollständig“).

### 3.3 Bestes Fenster `bestWindow` (WS-10)

Was man tatsächlich plant, ist nicht der Mittelwert, sondern der **längste zusammenhängende Lauf guter Stunden**.

```
run(hours, dark, thr):                                  # dark = Eintrag dieser Nacht aus darkWindows (§3.2)
    win = null; cur = null
    for jede Stunde h der Nacht in aufsteigender Zeit:
        part = min(h.tUnix + 3600, dark.toUtc) − max(h.tUnix, dark.fromUtc)
        if not (part > 0) or h.overallScore == null or h.overallScore < thr:
            cur = null; continue                        # Lücke bricht den Lauf
        if cur == null: cur = { fromUnix: max(h.tUnix, dark.fromUtc), sec: 0, sum: 0, moonFreeSec: 0 }
        cur.toUnix = min(h.tUnix + 3600, dark.toUtc)
        cur.sec += part
        cur.sum += part · h.overallScore
        if h.moonAltDeg != null and h.moonAltDeg < −0,833: cur.moonFreeSec += part
        if win == null or cur.sec > win.sec: win = cur
    return win

MIN_WINDOW_SEC = 1800
w = run(hours, dark, 0,65); fair = false
if w == null or w.sec < MIN_WINDOW_SEC:                 # Rückfall auf die Stufe darunter
    w2 = run(hours, dark, 0,45)
    if w2 != null and w2.sec >= MIN_WINDOW_SEC: w = w2; fair = true
    else: w = null
bestWindow = w == null ? null
           : { fromUtc:      iso8601(w.fromUnix),      # Ausgabe als UTC-Zeitstempel
               toUtc:        iso8601(w.toUnix),
               sec:          w.sec,
               moonFreeSec:  w.moonFreeSec,
               meanScore:    w.sum / w.sec,
               fair:         fair }
```

- Die Schwelle 0,65 ist die Klassengrenze *Gut* aus §3.1, der Rückfall 0,45 die Grenze *Mittel*; `fair = true` sagt der Oberfläche, dass das Fenster nur die untere Stufe erreicht. **Mindestdauer 1800 s** – eine halbe Stunde trägt keine Aufnahmeserie.
- **`moonFreeSec` ist der mondfreie Anteil des gefundenen Fensters**, nicht aller guten Stunden der Nacht. (Die Vorlage summiert den mondfreien Anteil über **alle** Stunden über der Schwelle, auch die in verworfenen Läufen – bei zwei getrennten Läufen steht dort mehr mondfreie Zeit, als das gemeldete Fenster lang ist. Das ist ein Fehler der Vorlage und wird nicht übernommen.)
- **Mondhöhe und -schwelle im besten Fenster: bitgleich zur Vorlage (WS-E1).** `moonAltDeg` ist die **geometrische topozentrische** Mondhöhe zum Stundenmittelpunkt `tUnix + 1800` – Parallaxe gerechnet, **ohne Refraktion**, wie `astro-core.js:138` –, und die Schwelle ist **`moonAltDeg < −0,833°`**. Beides ist der Zahlenwert der Vorlage, obwohl −0,833° die **Sonnen**konvention ist (Halbdurchmesser + Horizontrefraktion) und der Mond damit erst **0,259° tiefer** als nach `moon.md` als „unten“ gilt (−0,833° statt −0,574° geometrisch) – `moonFreeSec` fällt dadurch eher zu **klein** aus. Das ist **bewusst so übernommen**, damit Website und NINA-PM für dieselbe Nacht dieselbe Sekundenzahl zeigen; `moonFreeSec` ist **nur eine Anzeige** und trägt keine Planungsentscheidung.
- **Abgrenzung zur Planung (verbindlich).** Für **jede Planungsentscheidung** – Mondprofile, Nutzbarkeit, „Mond unten“ – gilt weiterhin ausschließlich `moon.md` bzw. `allocation.md`: die **scheinbare** (refraktierte) topozentrische Mitte `≤ 0°`, geometrisch −0,574°. Die beiden Größen sind nicht austauschbar: `moonAltDeg` aus dieser Datei darf in keinem Planungspfad auftauchen, und die Mondhöhe aus `moon.md` darf `moonFreeSec` nicht speisen – sonst weichen die Sekundenzahlen von der Website ab.
- **Rückfall-Regel (Präzisierung).** Die Vorlage sucht die 0,45-Stufe nur, wenn die 0,65-Suche **gar nichts** findet; ein 900-s-Lauf über 0,65 verhindert dort das bessere 0,45-Fenster. Verbindlich ist die Lesart des Entscheidungsblatts: Der Rückfall greift, wenn das 0,65-Fenster fehlt **oder** kürzer als 1800 s ist.
- Fehlt die Nacht in `darkWindows` (Polartag), ist `bestWindow = null`.

### 3.4 `weather_cache.payload` (WS-16)

Struktur und Spalten bleiben (`payload jsonb`, **keine neuen Spalten**). `model_set` beschreibt den benutzten Modellsatz, Beispiele neu:
`icon-d2+harmonie+icon+ecmwf+gem+cams` (Europa) bzw. `hrrr+gem+gfs+ecmwf+nbm+cams` (Nordamerika). Fällt ein optionaler Abruf aus, fehlt sein Kürzel im Satz (z. B. ohne `cams`).

`payload` enthält:

| Ebene | Inhalt |
|---|---|
| Kopf | `fetchedAtUtc`, `lat`, `lon`, `tzdataVersion` (Bezug `night.md` §1) – der Modellsatz steht in der Spalte `model_set`, nicht im `payload` |
| `hours[]` – Rohwerte | alle Felder aus §1.1 mit ihren dortigen Namen und Einheiten, `null` erhalten |
| `hours[]` – abgeleitet | `jetKmh`, `shearKmh`, `moonAltDeg` (geometrische topozentrische Mondhöhe in Grad zum Stundenmittelpunkt `tUnix + 1800`, §1.1/§3.3 – Grundlage von `moonFreeSec`, ohne Wirkung auf eine Bewertung) |
| `hours[]` – Herkunft | `modelId`, `cloudSrc`, `nest`, `aerosolMissing`, `seeingIncomplete` |
| `hours[]` – Scores | `cloudScore`, `seeingScore`, `transparencyScore`, `overallScore`, `ratingIndex` |
| `nights[]` | je Eintrag aus `darkWindows` (§3.2) eine Zeile: `night` (Schlüssel aus `night.md` §1), `nightMean`, `coveredSec`, `darknessSec`, `coverage`, `bestWindow` (§3.3, oder `null`), `aerosolMissing`, `seeingIncomplete` – diese Zeile ist der Typ **`WeatherNight`** (TK 8.2, `specs/ui/components.md` §2.5) |

Die Scores werden **ungerundet** gespeichert (`double`, wie gerechnet), die Rohwerte unverändert, wie sie die API liefert. `q(x, 1e3)` kommt einheitlich erst **unmittelbar vor Vergleich, `outputHash` und Ausgabe** (§2, WS-08) – auch dann, wenn die Zahl aus dem `payload` gelesen wird; zwischenzeitliches Runden ist verboten, weil sonst zweimal gerundet würde und die Jint-Parität an der Rundungskante verloren geht.

## 4. Pflicht-Tests (WS-18)

Die Kontrollwerte sind mit `weather-core.js` (Node, Stub für `window.SvAstro` mit `RAD` und `clamp`) und `verify-planner.js:637-648` nachgerechnet und gelten als Sollwerte für die Portierung. Angegeben sind die ungerundeten Werte und in Klammern `q(x, 1e3)`.

**(a) Einheiten- und Feldtest.** Eine Stunde mit allen Variablen aus §1.1, jede am Rand ihres Definitionsbereichs, prüft Name, Einheit, Typ und Herkunft (Haupt-, Aerosol- oder Vergleichsabruf) jedes Feldes. Zusätzlich: jedes Feld darf `null` sein, ohne dass die Stunde verworfen wird.

**(b) Intervallwerte (WS-12).** Eine versetzte Reihe: `gust10Kmh` bekommt die Werte `[10, 20, 30, 40]` zu den Stempeln `t₀ … t₃`. Erwartet: Spalte `t₀` trägt **20** (der Wert von `t₁`), Spalte `t₂` trägt **40**, Spalte `t₃` trägt `null`. Dasselbe für `precipMm` und `precipProbPct`. Ein Test, der in Spalte `t₁` die 10 erwartet, ist die **alte**, falsche Richtung.

**(c) Aerosol fehlt (WS-E2) – Kontrollwert 3.** Stunde: `cloudTotalPct = 20`, `wind250Kmh = 90`, `windDir250Deg = 270`, `wind500Kmh = 60`, `wind850Kmh = 30`, `windDir850Deg = 240`, `surfacePressureHPa = 990`, `wind10Kmh = 14`, `humidityPct = 85`, `pwvMm = 18`.

| Größe | mit `aod = 0,14` | mit `aod = null` |
|---|---|---|
| `cloudScore` | 0,800000 (0,8) | 0,800000 (0,8) |
| `jetKmh` | 90,000000 (`max(90; 1,3·60 = 78)`) | wie links |
| `shearKmh` | 65,753044 (65,753) | wie links |
| `seeingScore` | 0,505501 (0,506) | wie links |
| `transparencyScore` | 0,700000 (0,7) | **`null`** |
| `aerosolMissing` | `false` | **`true`** |
| `sum / weight` | 0,880825 / 1,00 | 0,775825 / **0,85** |
| `overallScore` | **0,563728 (0,564)** | **0,584151 (0,584)** |
| `ratingIndex` | 2 (*Mittel*) | 2 (*Mittel*) |

Rechenweg: `seeingScore = 1 − (0,45·clamp(70/110) + 0,35·clamp(45,753/100) + 0,20·clamp(6/25)) = 1 − (0,286364 + 0,160136 + 0,048000) = 0,505501`.
`transparencyScore = clamp(1 − (0,14 − 0,05)/0,45) · clamp(1 − (85−80)/40; 0,5; 1) · clamp(1 − (18−25)/150; 0,85; 1) = 0,800000 · 0,875000 · 1,000000 = 0,700000`.
`overallScore = 0,8² · (0,7 + 0,15·0,505501 + 0,15·0,700000)/1,00 = 0,640000 · 0,880825 = 0,563728`.
Ohne Aerosol: `0,640000 · (0,7 + 0,15·0,505501)/0,85 = 0,640000 · 0,775825/0,85 = 0,584151`. **Erwartet ist also ein Anstieg um +0,020423** – genau die „optimistische“ Bewertung, die das Kennzeichen anzeigen muss. Gegenprobe gegen einen eingesetzten Ersatzwert 0,5: `0,544528 (0,545)`, also 0,039623 niedriger als der normierte Wert – die Umverteilung ist keine Kosmetik.

**(d) Klassengrenzen (WS-07).** `ratingIndex` an den Schnitten, nach unten inklusiv:

| Eingang | 0,2499 | 0,25 | 0,4499 | 0,45 | 0,6499 | 0,65 | 0,8499 | 0,85 | 1,0 | `null` |
|---|---|---|---|---|---|---|---|---|---|---|
| `ratingIndex` | 0 | **1** | 1 | **2** | 2 | **3** | 3 | **4** | 4 | `null` |

Zusätzlich `RATING_CUTS == [0,25; 0,45; 0,65; 0,85]` als eigener Test (die Zahlen dürfen nicht je Aufrufer verdoppelt werden).

**(e) `cloudScore` und der quadrierte Wolkenterm – Kontrollwert 1** (Sollwerte aus `verify-planner.js:637-648`):

| Aufruf | Erwartet |
|---|---|
| `cloudScore(0)` / `cloudScore(50)` / `cloudScore(100)` | `1` / `0,5` / `0` |
| `cloudScore(null)` | `null` |
| `overallScore(1; null; null)` | `1` |
| `overallScore(0,5; null; null)` | `0,25` (der Wolkenterm wird quadriert) |
| `overallScore(1; 1; 1)` | `1` |
| `overallScore(1; 0; 0)` | `0,7` (Grundgewicht) |
| `overallScore(null; 1; 1)` | `null` |

Toleranz 1e-12 auf dem ungerundeten Wert.

**Kontrollwert 2 – `windShear`:**

| Aufruf | `du` | `dv` | Ergebnis |
|---|---|---|---|
| `windShear(90; 270; 30; 240)` | −64,019238 | +15,000000 | **65,753044 (65,753)** km/h |
| `windShear(100; 270; 40; 270)` | −60,000000 | 0 | **60,000000** km/h (gleichgerichtet → Differenz der Beträge) |
| `windShear(50; 0; 50; 180)` | 0 | +100,000000 | **100,000000** km/h (gegenläufig → Summe) |
| `windShear(90; 270; null; 240)` | – | – | **`null`** |

**(f) Determinismus (WS-08).** Dieselben Stunden in Node und in Jint ergeben denselben `outputHash`. Gerundet wird mit `q(x, 1e3)` unmittelbar vor Vergleich und Ausgabe, **nie** mit `Math.round` (WS-20). Testfälle an der Rundungskante: `0,6494999 → 0,649 → Klasse 2` und `0,6495 → 0,65 → Klasse 3`; `q(−0,0005; 1e3) = −0,001` (halbe Werte vom Nullpunkt weg).

**(g) Nachtmittel über die Dunkelheit (WS-09) – Kontrollwert 5.** Dunkelheit `21:30 → 04:00` (`darknessSec = 23400`), Stunden (`overallScore`): 21 h 0,70 · 22 h 0,80 · 23 h 0,82 · 00 h `null` · 01 h 0,66 · 02 h 0,60 · 03 h 0,55.

| Stunde | `part` (s) | Beitrag |
|---|---|---|
| 21 h | 1800 (21:30–22:00) | 1260,0 |
| 22 h | 3600 | 2880,0 |
| 23 h | 3600 | 2952,0 |
| 00 h | 3600, aber `overallScore == null` | **zählt nicht** |
| 01 h | 3600 | 2376,0 |
| 02 h | 3600 | 2160,0 |
| 03 h | 3600 | 1980,0 |

`coveredSec = 19800`, `sum = 13608,0`, `nightMean = 13608,0 / 19800 = 0,687273 (0,687)` → `ratingIndex = 3` (*Gut*), `coverage = 19800 / 23400 = 0,846154 (0,846)`. Die `null`-Stunde senkt die Abdeckung auf 84,6 %, ohne den Mittelwert zu verfälschen. Zweiter Fall: **alle** Stunden `null` → `nightMean = null`, `coveredSec = 0`, `coverage = 0`. Dritter Fall: Polartag (`dark.fromUnix == null`) → `nightMean = null`, `coverage = null`, `bestWindow = null`.

**Bestes Fenster zur selben Nacht (WS-10) – Kontrollwert 6.** `moonAltDeg` (geometrisch topozentrisch, §3.3): 21 h +8°, 22 h +2°, 23 h −6°, 00 h −14°, 01 h −20°, 02 h −22°, 03 h −19°. Schwelle 0,65 → qualifizierte Läufe: `21:30–00:00` (1800 + 3600 + 3600 = **9000 s**) und `01:00–02:00` (3600 s, durch die `null`-Stunde abgetrennt). Erwartet: `fromUtc = 21:30`, `toUtc = 00:00`, `sec = 9000` (2,5 h), `meanScore = 7092,0/9000 = 0,788000 (0,788)`, `moonFreeSec = 3600` (nur die 23-h-Stunde ist mondfrei), `fair = false`. Der Test prüft ausdrücklich, dass `moonFreeSec` **nicht** 7200 ist – das wäre die Summe über alle qualifizierten Stunden und damit der Fehler der Vorlage (§3.3).

**(h) Seeing mit fehlender Scherung (WS-04a) – Kontrollwert 4.**

| Fall (`w250`/`w500` wie angegeben) | Vorlage (`shear ?? 0`, `w10 ?? 0`) | NINA-PM (normiert) | `seeingIncomplete` |
|---|---|---|---|
| `w250 = 64`, `w500 = 0` ⇒ `jet = 64`, `shear = null`, `w10 = null` | `1 − 0,45·0,400000 = 0,820000 (0,82)` | `1 − 0,180000/0,45 = 0,600000 (0,6)` | `true` |
| `w250 = 90`, `w500 = 60` ⇒ `jet = 90`, `shear = null`, `w10 = 14` | `1 − (0,286364 + 0,048000) = 0,665636 (0,666)` | `1 − 0,334364/0,65 = 0,485594 (0,486)` | `true` |
| `w250 = 90`, `w500 = 60` ⇒ `jet = 90`, `shear = 65,753044`, `w10 = 14` | `0,505501 (0,506)` | `0,505501 (0,506)` – identisch, `Σw = 1,00` | **`false`** |
| `w250 = 90`, **`w500 = null`** ⇒ `jet = 90`, `shear = 65,753044`, `w10 = 14` | `0,505501 (0,506)` | `0,505501 (0,506)` – unverändert | **`true`** |
| `w250 = null`, `w500 = null` ⇒ `jet = null` | `null` | `null` | **`false`** |

Der dritte Fall ist der eigentliche Test: **bei vollständigen Daten darf die Abweichung nicht messbar sein** (Toleranz 1e-12). Der erste und zweite Fall müssen sich messbar unterscheiden (0,220 bzw. 0,180) und die Stunde muss das Kennzeichen tragen. Der **vierte** Fall prüft die Ausnahme aus §2.2: ein fehlender Einzelwert in `jetKmh` zählt 1:1 wie in der Vorlage als 0, ändert den Score also **nicht** – die Stunde trägt aber trotzdem `seeingIncomplete`. Der **fünfte** Fall prüft „ohne Score kein Kennzeichen“: `jetKmh == null` ergibt `seeingScore = null` **und** `seeingIncomplete = false`, nicht `true`.

**(i) `weatherCode`-Ableitung (WS-15).** Mit `cloudSrc = 'dini'`: `cloudTotalPct` = 5 / 12,5 / 20 / 37,5 / 74,9 / 75 / 100 → `weatherCode` = 0 / 1 / 1 / 2 / 2 / 3 / 3. Mit `weatherCode = 61` (Regen) bleibt der Code **61**, unabhängig von der Bedeckung. Mit `cloudSrc = null` bleibt der Code des Basismodells unverändert.

**(j) Nest-Erkennung (WS-14).** (1) `|nestTemp − tempC| = 0,049` und gleiche Bedeckung → `nest = true`; `0,05` → `false`. (2) Bedeckung um 1 % verschieden → `false` (exakte Gleichheit). (3) Latch: Stunden 0–5 im Nest, Stunde 6 außerhalb, Stunden 7–8 wieder gleich → `nest` ist für 7–8 **`false`**. (4) Nordamerika: Stunde bei `nowUtc + 31 h` → `false`, auch bei passenden Werten; Europa: dieselbe Stunde → `true`. (5) Vergleichsabruf ausgefallen → alle Stunden `nest = false`, `cloudSrc = null`, `pwvMm = null`.

**(k) Suffix-Vorrang und feine Übernahme (WS-13/WS-14).** Antwort nur mit `cloud_cover` (ohne Suffix) → wird gelesen; Antwort mit beiden → das Suffix gewinnt. Feine Sicht `0` → `visibilityM` bleibt der Wert des Basismodells (die glatte 0 ist ein Füllwert); feine Sicht `4000` → wird übernommen.

**(l) Niederschlag bewertet nichts (WS-E1).** Zwei Stunden mit identischen Wolken-, Wind- und Aerosolwerten, eine mit `precipMm = 0`, eine mit `precipMm = 12,4` und `precipProbPct = 95`, ergeben **denselben** `overallScore` und denselben `ratingIndex`. Beide Werte stehen trotzdem im `payload` und in der Anzeige.
