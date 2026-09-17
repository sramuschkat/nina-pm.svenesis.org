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
- `α` auf `[0, 360)` normalisieren (RA-Übergang 0/24 h), `δ` bleibt in `[−90, 90]`.
- `stepX/stepY` sind **Schritte in der Tangentialebene**, nicht Bogenmaße am Himmel. Bei 6,75° Versatz weicht der Himmelsabstand um ~0,5 % ab; wer exakte Überlappung braucht, rechnet `stepX' = tan(stepX)` in Tangenteneinheiten. Die Überlappungsprüfung (Pflicht-Test unten) erlaubt deshalb ±1 % Toleranz.

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
- **Ohne Rotator** (`has_rotator = false`) ist der Soll-Winkel weiterhin der feste Kamerawinkel (`rig.default_rotation_deg`); `paPanel` wird nur **geprüft**: Abweichung > Toleranz → Warnung `panel_rotation_mismatch` im Projekt, im Framing und im Simulator (FA-RIG-10, FK 8.8). Es wird nichts gedreht.
- Panel-Masken (Höhe, Mondabstand, `tM`) werden produktiv **je Panel** mit `α, δ` des Panels gerechnet (`allocation.md` A-19); im Kompatibilitätsmodus mit dem Projektzentrum.

### 2.3 Pflicht-Tests (Werte nachgerechnet, α₀ = 0)
| Fall | Erwartung |
|---|---|
| 1×1 | Panel = Projektzentrum, `paPanel = pa₀` |
| 2×2, `pa₀ = 0`, `δ₀ = 0`, Bildfeld 1°×1°, Überlappung 10 % | Offsets ±0,45°; Panel (+0,45/+0,45) → `α = 0,44999°`, `δ = 0,44998°`, `γ = 0,000000°` |
| 3×3, `pa₀ = 30°` | Panelraster um 30° gedreht; `γ` unabhängig von `pa₀` (nur `ξ, η` gehen ein) |
| `δ₀ = 30°`, ξ = η = 6,75° | `α = 8,30442°`, `δ = 36,43003°`, `γ = +4,1696°` |
| `δ₀ = 70°`, ξ = η = 6,75° | `α = 26,98992°`, `δ = 75,16370°`, `γ = +25,4278°` |
| `δ₀ = 70°`, ξ = +6,75°, η = −6,75° | `α = 14,58621°`, `δ = 62,51981°`, `γ = +13,7841°` |
| `δ₀ = 80°`, ξ = η = 6,75° | `α = 63,93380°`, `δ = 82,56704°`, `γ = +62,9581°` |
| `δ₀ = −45°`, ξ = η = 6,75° | `α = 8,47745°`, `δ = −37,97525°`, `γ = −6,0245°` |
| Zentrum `α₀ = 0,5°`, Panel links | `α = 359,x°` (kein Sprung, Normalisierung) |
| 4×4, `δ₀ = 70°`, Abstand 4,5° | `max |Δα| = 26,99°`, `max |γ| = 25,43°` |
Toleranz: Koordinaten 1e-5°, `γ` 1e-4°.

## 3. Rig-Kompatibilität (FA-RIG-12)
Bildfeld und Maßstab entscheiden über die Warnung „bisheriger Fortschritt stammt von anderer Optik“: Änderung von `effFocalMm`, `pixelSizeUm` oder Sensorgröße um > 1 % bei vorhandenen Aufnahmen → `rig.change_has_captures`.
