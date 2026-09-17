# Spezifikation: Mondvermeidung (`moonSafe`)

Verbindlich für AP-10 und AP-13b. Bezug: Fachkonzept 8.1, 8.2, FA-MON-01…05. Mond-Stufen und Restriktivität: `allocation.md` §3.4.

> **Bewusste Abweichung vom Astro-PM-Plugin (Entscheidung 17.09.2026):** Dort gilt „Mondhöhe ≤ Max-Höhe → sicher“, Relax-Faktor und Min-Höhe wirken nicht. Hier gilt die unten beschriebene Relaxierung; „Kein Mond“ bedeutet überall Mond unter dem Horizont.

## Eingaben je Slot
- `moonAlt` – **scheinbare topozentrische Höhe des Mondmittelpunkts** in Grad.
  **Refraktionsrichtung (verbindlich, AST-1):** Aus der geometrischen Höhe `h_geo` wird die scheinbare Höhe mit der Saemundsson-Formel gerechnet, weil sie die **geometrische** Höhe als Eingabe hat:
  `R(h) = 1,02′ / tan( h + 10,3/(h + 5,11) )` (h in Grad, Ergebnis in Bogenminuten, Standardatmosphäre 10 °C / 1010 hPa) und `h_app = h_geo + R(h_geo)/60`.
  Für `h_geo < −1°` gilt `R = R(−1°)` (konstant), damit die Formel keine Polstelle hat. Die Bennett-Formel (`R = 1′/tan(h + 7,31/(h + 4,4))`) erwartet die **scheinbare** Höhe und wird nur dort verwendet, wo aus einer scheinbaren Höhe zurückgerechnet wird (Referenztests). Der Unterschied ist nur horizontnah relevant: bei 0° 34,5′ (Bennett) gegen 29,0′ (Saemundsson), bei 20° < 0,001°.
- `illum` – beleuchteter Anteil in % (0–100).
- `elong` – geozentrische Elongation Sonne–Mond in Grad (0–180).
- `illum` wird nach Meeus Kap. 48 gerechnet: Phasenwinkel `i` aus der geozentrischen Elongation `ψ` sowie den Distanzen Erde–Mond `Δ` und Erde–Sonne `R_S`:
  **`i = atan2( R_S · sin ψ , Δ − R_S · cos ψ )`** mit `i ∈ [0°, 180°]`, dann `illum = 100 · (1 + cos i)/2`.
  **`atan` ist falsch:** Wegen `Δ ≈ 3,84·10⁵ km ≪ R_S ≈ 1,496·10⁸ km` ist der Nenner für `ψ < 89,85°` negativ; `atan` liefert dann den falschen Quadranten (nachgerechnet: ψ = 60° → `i = −60,13°` → 74,9 % statt 25,1 %; ψ = 30° → 93,3 % statt 6,7 %). Pflicht-Testvektoren: ψ = 30 / 60 / 90 / 120 / 150° → **6,7 / 25,1 / 50,1 / 75,1 / 93,3 %** (±0,2 %).
- `d` (Tage bis/seit Vollmond) wird aus den **ekliptikalen Längen** gerechnet: `d = |180° − ((λ_Mond − λ_Sonne) mod 360°)| / 12,1907`. Das ist genauer als die Elongation, weil die Mondbreite (bis 5,15°) die Elongation bei Vollmond auf ~175° begrenzt (AST-10).
- `sep` – Winkelabstand Mond–Ziel (topozentrisch) in Grad.
- Profil: `A` Abstand (°), `W` Breite (Tage), `relax` (° je ° Mondhöhe; im Datenmodell `relax_deg_per_deg`), `minAlt`, `maxAlt` (°), `maxIllum` (%), `mustBeDown` (bool). **Der Buchstabe `R` steht in diesem Dokument nur für die Refraktion**; die Restriktivität heißt `restrictiveness` (unten), der Profilwert `relax` (AST-14).
- Gerundet wird mit der gemeinsamen Funktion `q(x, 1e-6)` aus `canonical-json.md` (`roundHalfAwayFromZero`: halbe Werte **vom Nullpunkt weg**, also 0,5 → 1 und −0,5 → −1; eigene Implementierung in `engine/src/math`, **nicht** `Math.round`, damit Node und Jint identisch runden; die Quantisierung rechnet mit dem ganzzahligen Kehrwert `q(x, 1e-6) = roundHalfAwayFromZero(x·1e6)/1e6`). Gerundet werden `moonAlt`, `illum`, `sep` und `required` unmittelbar vor ihrem Vergleich; „≤“/„≥“ inklusive. Winkel werden vor Vergleichen auf `[0, 360)` normalisiert (`((x % 360) + 360) % 360`).
- Validierung beim Speichern eines Profils: `minAlt < maxAlt`, `W ≥ 0`, `A ≥ 0`, `relax ≥ 0`, `0 ≤ maxIllum ≤ 100` (sonst `422 validation.failed`).

## Algorithmus
```
if mustBeDown: return moonAlt <= 0
if moonAlt <= 0:           return true      # Stufe 1 (≤ 0 wie MoonDown in allocation.md §2)
if moonAlt <= minAlt:      return true      # Stufe 2 (nur relevant bei minAlt ≥ 0)
if illum <= maxIllum:      return true      # Stufe 3
d = |180 − ((lonMoon − lonSun) mod 360)| / 12.1907   # Tage bis/seit nächstem Vollmond
if moonAlt >= maxAlt: Ae = A; We = W
else:
    f  = (moonAlt − minAlt) / (maxAlt − minAlt)     # 0 … 1
    Ae = max(0, A − relax · (maxAlt − moonAlt))
    We = W · f
required = (We == 0) ? 0 : Ae / (1 + (d / We)²)
return sep >= required                      # Stufe 4
```

Hinweis: Stufe 1 prüft den Horizont 0° (Mondmittelpunkt, scheinbar) mit **≤ 0** – derselbe Operator wie `MoonDown` in der Planung. Bei den Built-ins mit `minAlt < 0` wirkt Stufe 2 nie; die Relaxierung beginnt knapp über dem Horizont.

**Mondauf-/-untergang (verbindlich, AST-3):** „Mond unten“, `MoonDown`, `mustBeDown` und die Auf-/Untergangszeiten in Anzeige und Referenztests benutzen **dieselbe** Definition: scheinbare topozentrische Höhe des **Mondmittelpunkts** = 0°. Die Sonnenkonvention −0,833° (Oberrand) und die Oberrand-Definition von USNO/astroplan gelten hier **nicht** (Unterschied bis 0,26° ≈ 1,7–3 min). Der Referenz-Generator `gen_sun_moon.py` rechnet Mondzeiten genauso; die Toleranz in TK 9.2 gilt gegen diese Definition.

## Built-in-Profile (Seed je Mandant, Schlüssel für i18n in Klammern)

| Schlüssel | A | W | `relax` | minAlt / maxAlt | maxIllum | mustBeDown |
|---|---|---|---|---|---|---|
| `moonProfile.none` (Kein Mond) | 180 | 14 | 0 | −90 / −2 | 0 | **true** |
| `moonProfile.strict` (Streng) | 90 | 8 | 0 | −15 / 5 | 30 | false |
| `moonProfile.moderate` (Moderat) | 60 | 5 | 2 | −15 / 5 | 60 | false |
| `moonProfile.relaxed` (Entspannt) | 25 | 3 | 3 | −15 / 5 | 80 | false |

## Grenzfall-Tabelle (Pflicht-Unit-Tests)

**Synthetische Eingaben:** `illum` und `d` sind hier **frei gewählt** und gehören nicht zur selben Mondphase (aus `illum` folgt physikalisch `d = acos(2·illum/100 − 1)/12,1907`: 40 % → 8,33 d, 70 % → 5,45 d, 90 % → 3,02 d). Die Tabelle prüft ausschließlich die Formel `moonSafe`; Ephemeriden-Referenztests (TK 9.2) dürfen diese Paare nicht erzeugen.

| Profil | Mondhöhe | Beleuchtung | d (Tage) | Abstand | gefordert | Ergebnis |
|---|---|---|---|---|---|---|
| Streng | 30° | 40 % | 5 | 50° | 64,72° | Stufe 4 → **blockiert** |
| Streng | 2° | 40 % | 5 | 70° | 58,42° | Stufe 4 (Relaxierung, f = 0,85) → **sicher** |
| Moderat | 0,5° | 70 % | 2 | 38° | 40,27° | Stufe 4 (Relaxierung, f = 0,775) → **blockiert** |
| Moderat | 20° | 65 % | 2 | 52° | 51,72° | Stufe 4 → **sicher** |
| Entspannt | 10° | 95 % | 0 | 25° | 25,00° | Stufe 4 → **sicher** |
| Entspannt | 2° | 90 % | 1 | 13° | 13,87° | Stufe 4 → **blockiert** |
| Streng | 10° | 30 % | 3 | 10° | – | Stufe 3 (30 % ≤ 30 %) → **sicher** |
| Streng | 30° | 20 % | 5 | 50° | – | Stufe 3 (20 % ≤ 30 %) → **sicher** |
| Moderat | 0,0° | 99 % | 0 | 5° | – | Stufe 1 (≤ 0) → **sicher** |
| Streng | −0,1° | 99 % | 0 | 5° | – | Stufe 1 → **sicher** |
| Kein Mond | 0,5° | 1 % | 14 | 170° | – | mustBeDown → **blockiert** |
| Kein Mond | 0,0° | 100 % | 0 | 10° | – | mustBeDown, Mondhöhe ≤ 0 → **sicher** |

## Restriktivität (für Mond-Stufen)
`restrictiveness = A × (1 + 100 / (maxIllum + 1))`; `mustBeDown` → `∞`.

| Profil | `restrictiveness` |
|---|---|
| Kein Mond | ∞ |
| Streng | 90 × (1 + 100/31) = 380,32 |
| Moderat | 60 × (1 + 100/61) = 158,36 |
| Entspannt | 25 × (1 + 100/81) = 55,86 |
