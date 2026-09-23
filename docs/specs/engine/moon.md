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
- `d` – **Phasenmaß in Tag-Äquivalenten** (nicht die echte Zeit bis zum Vollmond: 12,1907 °/d ist die *mittlere* Rate, die momentane schwankt 2026 zwischen 10,77 und 14,36 °/d, Abweichung zur echten Zeit bis **0,9 Tage** und damit bis 3,3° im geforderten Abstand bei *Streng*, AST-M9). Gerechnet aus den **ekliptikalen Längen**: `d = |180° − ((λ_Mond − λ_Sonne) mod 360°)| / 12,1907`. Das ist genauer als die Elongation, weil die Mondbreite (bis 5,15°) die Elongation bei Vollmond auf ~175° begrenzt (AST-10).
  **Die genauere Lunationssuche der Vorlage wird bewusst nicht übernommen (WS-30).** Der Website-Code kann den Vollmond exakt bestimmen (`sky-events.js:572` `nextSyzygy`: Halbtagsschritte auf der ekliptikalen Elongation, danach 30 Bisektionsschritte; geprüft gegen USNO auf ±30 min, `verify-planner.js:247-261`) und würde `d` als **echte** Zeit bis zum Vollmond liefern. NINA-PM bleibt trotzdem bei der Division durch die mittlere Rate 12,1907 °/d – drei Gründe: (a) **Determinismus** – die Mittelwertform ist eine geschlossene Formel ohne Iteration und liefert damit für jede Eingabe denselben Wert, ohne von Abbruchkriterium und Schrittfolge abzuhängen; (b) **Jint-Parität** – ein Suchlauf müsste in TypeScript und in der Jint-gehosteten Engine Schritt für Schritt identisch laufen, sonst weichen `outputHash` und Plan auseinander, während die Formel nur eine Winkeldifferenz und eine Division braucht; (c) **Nähe zum Astro-PM-Plugin**, dessen Mondmaß ebenfalls aus der Phasenlage und nicht aus einer Syzygien-Suche kommt – die Übernahme bleibt so vergleichbar. Die Abweichung ist bekannt und beziffert: über 2026 bis **0,90 Tage** (Maximum am 2026-04-13, `d` = 10,63 gegen 11,53 Tage echte Zeit; eigene Rechnung mit Meeus Kap. 47 und einer Syzygien-Suche wie in der Vorlage, deren Voll- und Neumonde 2026 auf die Minute mit USNO übereinstimmen), das sind bei *Streng* bis 3,3° im geforderten Abstand. Wer das ändern will, ändert **AST-M9**, nicht die Formel hier.
- `sep` – Winkelabstand Mond–Ziel in Grad, **verbindlich als** `sep = atan2( |û_Mond × û_Ziel| , û_Mond · û_Ziel )` aus **unrefraktierten topozentrischen** Äquatorialkoordinaten zum Datum (AST-M4). Zwei Festlegungen, die vorher fehlten: (a) die `atan2`-Form statt `acos` des Skalarprodukts – bei den hier relevanten Abständen numerisch gleichwertig (Abweichung 1e-14°), aber unterhalb 1e-4° deutlich stabiler; (b) **unrefraktiert** – rechnet man aus scheinbaren Höhen, schrumpft der Abstand horizontnah um bis zu **0,41°** (Mond h_geo = 0,5°, Ziel 60°: 59,500° → 59,093°), also mehr als das Vierfache der Positionstoleranz. `gen_sun_moon.py` benutzt dieselbe Definition.
- **Topozentrisch ist hier nicht kosmetisch:** Die Horizontalparallaxe des Mondes beträgt 0,899° (Apogäum) … **1,025°** (Perigäum). Nachgerechnetes Beispiel (VSW Hannover, 2026-11-27 18:45 UTC, NGC 281, Profil *Streng*): `sep_geo = 74,084°` gegen `sep_topo = 75,087°` bei gefordert 74,548° – geozentrisch blockiert, topozentrisch sicher, und das über 25 Minuten. Über das Jahr betrifft das 23 h; bei der **Mondhöhe** kippen 95 h/Jahr das `MoonDown`-Tor (Extremfall +0,910° geozentrisch gegen −0,112° topozentrisch = 10 min Zeitversatz).
- Profil: `A` Abstand (°), `W` Breite (Tage), `relax` (**Grad geforderter Abstand je Grad Mondhöhe unterhalb der Max-Höhe**; im Datenmodell heißt die Spalte `relax_scale` bzw. `moon_relax_scale`, der Name ist historisch – es ist **kein Multiplikator**, AST-M2), `minAlt`, `maxAlt` (°), `maxIllum` (%), `mustBeDown` (bool). **Der Buchstabe `R` steht in diesem Dokument nur für die Refraktion**; die Restriktivität heißt `restrictiveness` (unten), der Profilwert `relax` (AST-14).
- Gerundet wird mit der gemeinsamen Funktion **`q(x, 1e6)`** aus `canonical-json.md` – zweites Argument ist der **ganzzahlige Kehrwert**, nicht die Schrittweite. `q(x, 1e-6)` wäre `roundHalfAwayFromZero(x·1e-6)/1e-6` und machte aus 30° Mondhöhe **0°** (AST-D9) (`roundHalfAwayFromZero`: halbe Werte **vom Nullpunkt weg**, also 0,5 → 1 und −0,5 → −1; eigene Implementierung in `engine/src/math`, **nicht** `Math.round`, damit Node und Jint identisch runden; die Quantisierung rechnet mit dem ganzzahligen Kehrwert: `q(x, 1e6) = roundHalfAwayFromZero(x·1e6)/1e6`). Gerundet werden `moonAlt`, `illum`, `sep` und `required` unmittelbar vor ihrem Vergleich; „≤“/„≥“ inklusive. Winkel werden vor Vergleichen auf `[0, 360)` normalisiert (`((x % 360) + 360) % 360`).
- Validierung beim Speichern eines Profils: `minAlt < maxAlt`, `W ≥ 0`, `A ≥ 0`, `relax ≥ 0`, `0 ≤ maxIllum ≤ 100` (sonst `422 validation.failed`).

## Algorithmus
```
if mustBeDown: return moonAlt <= maxAlt   # Stufe 1 mit Reserve: "Kein Mond" hat maxAlt = -2 (AST-M11)
if moonAlt <= 0:           return true      # Stufe 1 (≤ 0 wie MoonDown in allocation.md §2)
if moonAlt <= minAlt:      return true      # Stufe 2 (nur relevant bei minAlt ≥ 0)
if illum <= maxIllum and sep >= A_floor: return true   # Stufe 3, A_floor = 15 Grad (AST-M1)
d = |180 − ((lonMoon − lonSun) mod 360)| / 12.1907   # Tage bis/seit nächstem Vollmond
if moonAlt >= maxAlt: Ae = A; We = W
else:
    f  = (moonAlt − minAlt) / (maxAlt − minAlt)     # 0 … 1
    Ae = max(0, A − relax · (maxAlt − moonAlt))
    We = W · f
required = (We == 0) ? 0 : Ae / (1 + (d / We)²)
# A_floor: Mindestabstand, der auch bei erfuellter Illuminationsschwelle gilt (Stufe 3)
return sep >= required                      # Stufe 4
```

Hinweis: Stufe 1 prüft den Horizont 0° (Mondmittelpunkt, scheinbar) mit **≤ 0** – derselbe Operator wie `MoonDown` in der Planung. Bei den Built-ins mit `minAlt < 0` wirkt Stufe 2 nie; die Relaxierung beginnt knapp über dem Horizont.

**Mondauf-/-untergang (verbindlich, AST-3):** „Mond unten“, `MoonDown`, `mustBeDown` und die Auf-/Untergangszeiten in Anzeige und Referenztests benutzen **dieselbe** Definition: scheinbare topozentrische Höhe des **Mondmittelpunkts** = 0°. Die Sonnenkonvention −0,833° (Oberrand) und die Oberrand-Definition von USNO/astroplan gelten hier **nicht** (Unterschied bis 0,26° ≈ 1,7–3 min). Der Referenz-Generator `gen_sun_moon.py` rechnet Mondzeiten genauso; die Toleranz in TK 9.2 gilt gegen diese Definition.

## Aus der Vorlage nicht übernommen (WS-20, Kurzliste; vollständige Liste TK 8.4)
- **Mondabstand geozentrisch** (`observing-planner.js:1465`): dort wird der Abstand aus den **geozentrischen** RA/Dec des Mondes (`moonCoords`) und mit `acos` des Skalarprodukts gerechnet. Der geozentrische Bezug kostet bis **1,003°** (nachgerechnetes Beispiel oben: 74,084° gegen 75,087° bei gefordert 74,548° – das kippt die Entscheidung); das `acos` ist zusätzlich nur numerisch schwächer (1e-14° gegen die `atan2`-Form). Hier gilt **topozentrisch, unrefraktiert, `atan2`**.
- **Mondhöhe ohne Refraktion** (`astro-core.js:138`): die Vorlage gibt die geometrische topozentrische Höhe zurück. Der Unterschied zur hier verbindlichen **scheinbaren** Höhe ist die Refraktion, horizontnah bis **0,647°** (= `R(−1°)` = 38,795′, der Deckel aus §Eingaben); rechnet man zusätzlich die genäherte Parallaxe der Vorlage mit (`h − arcsin(6378,14/Δ)·cos h` statt des topozentrischen Vektors), sind es bis 0,650° – nachgerechnet über 2026 an der VSW Hannover.
- **„Mond unten“ bei −0,833° geometrisch** (`astro-core.js:362`, `sky-events.js:691`): das ist die **Sonnen**konvention (Oberrand + Horizontrefraktion) und für den Mond falsch. Hier gilt scheinbare **Mitte ≤ 0°**, geometrisch **−0,574°** – ein Versatz von **0,259°** (nachgerechnet: `R(−0,574°)` = 0,5739° → `h_app` = 0,000°; 0,833 − 0,574 = 0,259). Ausnahme: in der Anzeige „bestes Fenster“ (`weather.md` §3.3, WS-10) ist die Vorlage **bitgleich** übernommen – dort ist `moonAltDeg` die **geometrische** topozentrische Mondhöhe (ohne Refraktion) und die Schwelle `− 0,833°`, weil Website und NINA-PM dieselbe Sekundenzahl zeigen sollen und `moonFreeSec` keine Planungsentscheidung trägt (WS-E1). Für die **Planung** gilt ausschließlich dieses Dokument: scheinbare Mitte ≤ 0°. Die beiden Größen sind nicht austauschbar.
- **Refraktion unter −1° ausgeblendet** (`astro-core.js:305-309`: Faktor `clamp(alt+2,0,1)`, unterhalb −2° gar keine Refraktion): hier gilt unterhalb −1° konstant `R(−1°)` = **38,795′**, damit die Formel keine Polstelle hat und `moonSafe` am Horizont stetig bleibt.

## Referenztest Mondposition (Meeus 47.a, verbindlich, WS-22)
Fundstelle in der Vorlage: `tools/verify-planner.js:419`. Eingabe **1992-04-12 0h TD** (JDE 2 448 724,5), Erwartung nach Meeus, *Astronomical Algorithms*, Beispiel 47.a (geozentrisch, scheinbar):

| Größe | Soll (Meeus 47.a) | Toleranz | eigene Prüfung | Abweichung |
|---|---|---|---|---|
| α | 134,688470° | ±0,0006° | 134,688438° | 0,000032° = 0,115″ |
| δ | 13,768368° | ±0,0006° | 13,768375° | 0,000007° = 0,027″ |
| Δ (Erde–Mond) | 368 409,7 km | ±1 km | 368 409,7 km | 0,015 km |

Nachgerechnet mit Tabelle **47.A** (60 Terme für Länge und Abstand) und **47.B mit allen 60 Termen** für die Breite; die Zwischenwerte λ = 133,162655°, β = −3,229126° und π = 0,991990° stimmen mit dem Buch auf jede gedruckte Stelle. Der Test gilt damit als **erfüllt**. Drei Hinweise für den Port:
- Die **30-Term-Fassung von 47.B**, die die Vorlage benutzt (`astro-core.js`, `MOON_B`), ist für diesen Test zu knapp und darf nicht als bestanden durchgehen: die weggelassenen 30 Terme verschieben β am Testtermin um **2,00″** und damit δ um **1,92″** – das liegt unter der Toleranz 2,16″, aber ohne jede Reserve, und über 2026 erreicht die Abweichung in β bis **19,2″** (nachgerechnet, 6-h-Raster). Der Produktivpfad braucht die **vollen 60 Terme**; die Kurzfassung besteht den Test nur zufällig.
- Der Restfehler in α (0,115″) stammt **allein aus der kurzen Nutationsreihe** (Meeus Kap. 22: Δψ = 16,483″ gegen 16,595″ der vollen IAU-1980-Reihe); δ und Δ sind davon praktisch unberührt. Die Toleranz ±0,0006° (= 2,16″) deckt das mit Reserve, die Reihe muss dafür also nicht ausgebaut werden.
- **ΔT gehört in die Ephemeridenargumente** (TT = UT + 69 s, WS-20 zu `astro-core.js:52/87`): der Test gibt TD vor, der Produktivpfad bekommt UTC. Wird ΔT vergessen, besteht dieser Test trotzdem – er prüft ihn nicht. Dafür ist der Horizons-Vergleich (`verify-planner.js:428-441`, 10 Termine 20.09.–17.10.2026, ±0,01°) zuständig, der **mit** ΔT gegen den Produktivpfad läuft.

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
| Streng | 10° | 30 % | 3 | 10° | – | Stufe 3: `illum ≤ maxIllum`, aber `sep = 10° < A_floor = 15°` → **blockiert** (AST-M1) |
| Streng | 30° | 20 % | 5 | 50° | – | Stufe 3: `illum ≤ maxIllum` **und** `sep = 50° ≥ 15°` → **sicher** |
| Moderat | 0,0° | 99 % | 0 | 5° | – | Stufe 1 (≤ 0) → **sicher** |
| Streng | −0,1° | 99 % | 0 | 5° | – | Stufe 1 → **sicher** |
| Kein Mond | 0,5° | 1 % | 14 | 170° | – | mustBeDown → **blockiert** |
| Kein Mond | 0,0° | 100 % | 0 | 10° | – | mustBeDown, Mondhöhe ≤ 0 → **sicher** |

**Reichweite der Relaxierung (AST-M6).** Stufe 1 schneidet bei `moonAlt ≤ 0` ab, die Built-ins haben `minAlt = −15°` und `maxAlt = 5°`. Der Relaxierungszweig läuft deshalb nur für `0 < moonAlt < 5°`, also `f ∈ (0,75; 1,00]` – **`Breite_eff` sinkt nie unter 0,75·W**, und der Satz „linear bis 0 bei Min-Höhe" ist für die mitgelieferten Profile unerreichbar. Für *Streng* am Vollmond (`relax = 0`, `d = 0`) ist die Relaxierung sogar **exakt wirkungslos** (90,00° → 90,00°). Das Band selbst ist nicht kurz (Hannover 2026: 1,39 h je Tag mit Mond über dem Horizont), nur der Effekt darin. Wer die Relaxierung wirksam haben will, hebt `maxAlt` auf 20–30° und setzt `relax > 0`.

## Restriktivität (für Mond-Stufen)
`restrictiveness = A · W · arctan(14,77 / W)` (Integral des geforderten Abstands über den halben Mondzyklus), zweites Sortierkriterium `maxIllum` aufsteigend; `mustBeDown` → `∞`. Bei `W = 0` gilt `restrictiveness = 0`.

**Warum nicht `A × (1 + 100/(maxIllum+1))` (AST-M3):** Die frühere Formel ignorierte die **Breite W** – also genau den Parameter, der den geforderten Abstand über den Mondzyklus skaliert –, und die Stufenordnung war damit nicht monoton. Gegenbeispiel aus zwei zulässigen Nutzerprofilen: X (A = 40°, W = 14 d, maxIllum = 50 %) und Y (A = 60°, W = 1 d, 50 %) ergaben 118,4 gegen 177,7, Y galt also als strenger – tatsächlich fordert X bei d = 5 d **35,48°** und Y nur **2,31°**, Y ist ab d = 1 d durchgehend lockerer. Folge: Y belegte die mondfreien Slots, X fiel in `moon_blocked`. Mit der Integralform: X = 454,7, Y = 90,2 – richtige Ordnung. (Alle vier Zahlen mit `arctan` im **Bogenmaß**; in Grad gerechnet ist die Ordnung dieselbe, die Werte sind aber um den Faktor 180/π größer.)

| Profil | `restrictiveness` |
|---|---|
| Kein Mond | ∞ |
| Streng | 90 · 8 · arctan(14,77/8) = **773,6** |
| Moderat | 60 · 5 · arctan(14,77/5) = **373,3** |
| Entspannt | 25 · 3 · arctan(14,77/3) = **102,8** |
