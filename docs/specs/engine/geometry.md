# Spezifikation: Geometrie – Bildfeld, Mosaik-Panels, Positionswinkel

Verbindlich für AP-09a (Kennwerte), AP-10/AP-13b (Panel-Masken), AP-21/AP-22 (Sternkarte, Mosaik), AP-16f (Rotationsprüfung). Bezug: Fachkonzept 8.1 (Maßstab, Bildfeld), 8.8 (Rotation), FA-FRM-06…15, FA-RIG-10/11.

## 1. Maßstab und Bildfeld
```
effFocalMm   = focalLengthMm · reducerFactor
scaleArcsec  = 206.265 · pixelSizeUm / effFocalMm          (″/px, ungebinnt)
scaleBinned  = scaleArcsec · binning
fovWidthDeg  = scaleArcsec · widthPx  / 3600               (Bildfeld bleibt bei Binning gleich)
fovHeightDeg = scaleArcsec · heightPx / 3600
```
- Kleinwinkelnäherung: Für Bildfelder > 5° wird die Feldkante gnomonisch gerechnet (`tan`-Projektion, §2); darunter ist der Unterschied < 0,1 %.
- Ausgabe gerundet: Maßstab 3 Nachkommastellen, Bildfeld 4 Nachkommastellen (Grad).

## 2. Mosaik-Panels (verbindlich)
Eingaben: Projektzentrum `α₀, δ₀` (J2000), Positionswinkel `pa₀` (Grad, Konvention `flip-rotation.md` §3), Raster `cols × rows`, Überlappung `overlapPct`, Bildfeld `fovW/fovH`.
- **Mosaik ohne Rotator (verbindlich, NT-30):** Bei `has_rotator = false` (`fixed_camera`) gilt `pa₀ := rig.default_rotation_deg` (Kamerawinkel); ein abweichender Projektwinkel wird für die Panelrechnung ignoriert. Das Framing (FA-FRM-06…15) sperrt die Rotation in diesem Fall auf den Kamerawinkel. Grund: das Panelraster muss mit dem tatsächlich aufgenommenen Bildfeld gedreht sein, sonst entstehen Lücken zwischen den Panels (in der Prüfung nachgerechnet: 0,086° Lücke bei einem Raster, das mit dem Projektwinkel statt dem Kamerawinkel gerechnet wurde). `block.rotationDeg` ist dann für jedes Panel der Kamerawinkel.

### 2.1 Panelzentren
```
stepX = fovWidthDeg  · (1 − overlapPct/100)          # Schritt in der Tangentialebene (Grad)
stepY = fovHeightDeg · (1 − overlapPct/100)
für Spalte i = 0…cols−1, Zeile j = 0…rows−1:
    ξ' = (i − (cols−1)/2) · stepX                    # Sensor-X (+ = links im Bild = Ost bei pa = 0)
    η' = ((rows−1)/2 − j) · stepY                    # Sensor-Y (+ = oben im Bild = Nord bei pa = 0)
    ξ =  ξ'·cos(pa₀) + η'·sin(pa₀)                   # Standardkoordinate nach Ost (Grad)
    η = −ξ'·sin(pa₀) + η'·cos(pa₀)                   # Standardkoordinate nach Nord (Grad)
    # inverse Gnomonik (TAN), ξ, η in Radiant:
    ρ = atan( √(ξ² + η²) ) ;  θ = atan2( ξ, η )
    δ = asin( sin δ₀ · cos ρ + cos δ₀ · sin ρ · cos θ )
    α = α₀ + atan2( sin ρ · sin θ , cos δ₀ · cos ρ − sin δ₀ · sin ρ · cos θ )
```
- `α` auf `[0, 360)` normalisieren (RA-Übergang 0/24 h), `δ` bleibt in `[−90, 90]`. **Normalisierung nach dem Runden (NT-31):** gilt für `α` und alle Winkel (`paPanel`): erst runden, dann `x ≥ 360 → x − 360` und `−0 → 0`, damit gespeicherte Werte `0 ≤ x < 360` erfüllen (Schema-CHECK `< 360`; z. B. `α = 359,9999999` → gerundet `360,000000` → `0`).
- `stepX/stepY` sind **Schritte in der Tangentialebene**, nicht Bogenmaße am Himmel. Bei 6,75° Versatz weicht der Himmelsabstand um ~0,5 % ab; wer exakte Überlappung braucht, rechnet `stepX' = degrees( tan( radians(stepX) ) )` – für 6,75° Himmelsabstand also 6,781402°, **nicht** `tan(6,75) = 0,118` (Dimensionsfehler, AST-G13). Die Überlappungsprüfung (Pflicht-Test unten) erlaubt deshalb ±1 % Toleranz.
- **Panel-Nummerierung ↔ NINA-Framing (verbindlich, NT-32):** NINA nummeriert die Panels im Framing-Assistenten zeilenweise ab 1, beginnend **oben links**, und „oben links“ ist bei Rotation 0 **Nordost** (`FramingAssistantVM.cs`: Schleife `j` über Zeilen von oben, `i` über Spalten von links, `panelId = id++`; `Coordinates.Shift`: +X = West, +Y = Süd). In §2.1 liegt dagegen Spalte `i = 0` im **Westen** (ξ' < 0 = rechts im Bild) und Zeile `j = 0` im **Norden**. Zuordnung daher: `n = j · cols + (cols − 1 − i) + 1` bzw. umgekehrt `j = ⌊(n − 1)/cols⌋`, `i = cols − 1 − ((n − 1) mod cols)`. Beispiel 2×2: `(i, j) = (1, 0)` → Panel 1 (NO), `(0, 0)` → 2 (NW), `(1, 1)` → 3 (SO), `(0, 1)` → 4 (SW). Panel-Labels in Web und Plugin verwenden die NINA-Nummer `n`, damit das Laden ins Framing (FA-NIN-02) nicht spiegelt; **`index` in `PlanInput` und in der NINA-Auslieferung ist die Position `n − 1` der Panels in `panel_index`-Reihenfolge**, nicht der gespeicherte `panel_index` – der hat nach Löschungen Lücken (AP-22; bei lückenlosen Indizes identisch); das Raster dreht mit `pa₀` (die Nummerierung folgt dem Sensor, nicht der Himmelsrichtung). Beim Laden setzt das Plugin `RotationPositionAngle = pa₀` am DSO; NINA rechnet intern mit der Gegenrichtung (`RectangleRotation = 360 − RotationPositionAngle`). Hinweis: NINA rechnet die Panelzentren im Framing **stereografisch** (`Coordinates.Shift`, Standard `ProjectionType.Stereographic`), §2.1 **gnomonisch**; bei 6,75° Versatz beträgt der Unterschied rund 0,02°. Maßgeblich für Slew und Meldungen sind die Koordinaten nach §2.1.

### 2.2 Panel-Positionswinkel (Feldrotation)
Die Achsen der Tangentialebene drehen sich gegenüber der Nordrichtung am Panel. Diese **Feldrotation `γ`** wird exakt über Vektoren gerechnet (keine Kleinwinkelnäherung, keine Meridiankonvergenz – beides ist hier falsch):
```
p̂₀, ê₀, n̂₀ = Einheitsvektoren am Projektzentrum (Richtung, Ost, Nord)
v̂  = normalize( p̂₀ + ξ_rad · ê₀ + η_rad · n̂₀ )        # Richtung zum Panel
d̂  = normalize( n̂₀ − (n̂₀ · v̂) · v̂ )                  # Bild der +η-Achse am Panelort
p̂, ê, n̂ = Einheitsvektoren am Panel (aus α, δ)
γ  = atan2( d̂ · ê , d̂ · n̂ )                          # Grad, + = nach Ost
paPanel = (pa₀ + γ) mod 360
```
- Gegen die numerische Ableitung der Projektion geprüft: Abweichung < 4·10⁻⁵° über alle Testfälle (δ₀ von −45° bis 89°, Versatz bis 6,75°).
- Näherungen, die **nicht** verwendet werden dürfen: `pa₀ + (α−α₀)·sin δ` (Meridiankonvergenz; liefert bei δ₀ = 0 und ξ = η = 0,45° schon 0,0035° statt 0,000000°) und `atan2(ξ·sin δ₀, cos δ₀ − η·sin δ₀)` (Kleinwinkelform; bei δ₀ = 80° 63,59° statt 62,96°). Beide sind höchstens Plausibilitätsprüfungen.
- **Wirkung:** Bei einem 4×4-Mosaik mit 4,5° Panelabstand und `δ₀ = 70°` reicht `Δα` bis **26,99°** und `γ` bis **25,43°** – weit über der Rotationstoleranz von 5°. Ohne diese Korrektur würde die Prüfung ohne Rotator laufend `panel_rotation_mismatch` melden und mit Rotator falsch rotieren.
- **Ohne Rotator** (`has_rotator = false`) ist der Soll-Winkel weiterhin der feste Kamerawinkel (`rig.default_rotation_deg`, zugleich `pa₀`, NT-30); `paPanel` wird nur **geprüft**, und zwar **modulo 180°** wie in `flip-rotation.md` §3 (NT-E4): Abweichung > Toleranz → Warnung `panel_rotation_mismatch` im Projekt, im Framing und im Simulator (FA-RIG-10, FK 8.8). Es wird nichts gedreht.
- **Gespiegelte Optik (NT-33):** Alle Formeln setzen ein nicht gespiegeltes Bild voraus (kein Umlenk-/Zenitspiegel im Strahlengang; WCS nicht `Flipped`). Gespiegelte Optik wird **nicht unterstützt**: meldet das Plate-Solve `Flipped`, gibt das Plugin `warning` Code `optics_mirrored` aus und überspringt die Winkelprüfung; Panelraster und Positionswinkel wären seitenverkehrt. Dokumentierte Einschränkung.
- Panel-Masken (Höhe, Mondabstand, `tM`) werden produktiv **je Panel** mit `α, δ` des Panels gerechnet – für Panel-Einheiten wie für Mosaike ohne Panel-Einheiten (`allocation.md` §3.1, A-19; seit 28.09.2026); im Kompatibilitätsmodus mit dem Projektzentrum.

### 2.3 Pflicht-Tests (Werte nachgerechnet, α₀ = 0)
| Fall | Erwartung |
|---|---|
| 1×1 | Panel = Projektzentrum, `paPanel = pa₀` |
| 2×2, `pa₀ = 0`, `δ₀ = 0`, Bildfeld 1°×1°, Überlappung 10 % | Offsets ±0,45°; Panel (+0,45/+0,45) → `α = 0,44999°`, `δ = 0,44998°`, `γ = 0,000000°` |
| 3×3, `pa₀ = 30°` | Panelraster um 30° gedreht; `γ` hängt nur von `ξ, η` ab. **Näherung (Prüfung 28.09.2026):** Die gnomonische Projektion ist nicht winkeltreu – am Panel stehen die Bilder von Sensor-X und Sensor-Y nicht exakt senkrecht (4×4 mit 5°-Panels bis 0,78°, 5×5 mit 10°×7°-Panels bis 5,2° Schiefe). `pa₀ + γ` richtet die Nordrichtung der Panelmitte aus und liegt höchstens die halbe Schiefe neben dem besten Kompromiss (Winkelhalbierende); gegenüber der Rotationstoleranz von 5° nur bei sehr großen Mosaiken spürbar. Die Überdeckung bleibt lückenlos (nachgeprüft bis δ₀ = 85°) |
| `δ₀ = 30°`, ξ = η = 6,75° | `α = 8,30442°`, `δ = 36,43003°`, `γ = +4,1696°` |
| `δ₀ = 70°`, ξ = η = 6,75° | `α = 26,98992°`, `δ = 75,16370°`, `γ = +25,4278°` |
| `δ₀ = 70°`, ξ = +6,75°, η = −6,75° | `α = 14,58621°`, `δ = 62,51981°`, `γ = +13,7841°` |
| `δ₀ = 80°`, ξ = η = 6,75° | `α = 63,93380°`, `δ = 82,56704°`, `γ = +62,9581°` |
| `δ₀ = −45°`, ξ = η = 6,75° | `α = 8,47745°`, `δ = −37,97525°`, `γ = −6,0245°` |
| Zentrum `α₀ = 0,5°`, Panel links | `α = 359,x°` (kein Sprung, Normalisierung) |
| 4×4, `δ₀ = 70°`, Abstand 4,5° | `max |Δα| = 26,99°`, `max |γ| = 25,43°` |
| 2×2, `pa₀ = 0`, Nummerierung (NT-32) | Panel 1 = `(i, j) = (1, 0)` mit `ξ > 0, η > 0` (Nordost), Panel 4 = `(0, 1)` (Südwest); Hin- und Rückrechnung `n ↔ (i, j)` für 3×2 identisch |
| ohne Rotator, `default_rotation_deg = 12°`, Projektwinkel 40° (NT-30) | Panelraster mit `pa₀ = 12°`; `block.rotationDeg = 12` für alle Panels |
| Normalisierung (NT-31) | `359,9999999` → `0`; `−0` → `0` |
Toleranz: Koordinaten 1e-5°, `γ` 1e-4°.

## 3. Rig-Kompatibilität (FA-RIG-12)
Bildfeld und Maßstab entscheiden über die Warnung „bisheriger Fortschritt stammt von anderer Optik“: Änderung von `effFocalMm`, `pixelSizeUm` oder Sensorgröße um > 1 % bei vorhandenen Aufnahmen → `rig.change_has_captures`.
