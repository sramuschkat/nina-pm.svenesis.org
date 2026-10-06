# Spezifikation: Meridian-Flip und Rotation

Verbindlich für AP-13d (Planung), AP-16f (Plugin; NT-18). Bezug: FA-SCH-17, FA-RIG-10…14, FA-NIN-23/24, Fachkonzept 8.8. Soll-Plan: Fall „Meridian-Flip“ in `contracts/golden-plans/`. Ausführung in NINA: `specs/nina/execution.md` §4.5 (Flip und Rotation), §5 (Transit).

## 1. Eingaben
| Feld | Quelle | Einheit |
|---|---|---|
| `flipEnabled` | `rig.flip_enabled` | bool |
| `afterMin` | `rig.flip_after_meridian_min` | min |
| `maxAfterMin` | `rig.flip_max_after_meridian_min` (≥ afterMin) | min |
| `pauseBeforeMin` | `rig.flip_pause_before_meridian_min` | min |
| `durationS` | `rig.flip_duration_s` | s |
| `tM` | Meridiandurchgang des **aktiven Panels** im Block (obere Kulmination; untere Kulmination als zweiter Kandidat nach §1.1, NT-26), ganze Sekunde (abgerundet); Projekt-Einheiten: Panel der nächsten Belichtung. Berechnung §1.1 | s |
| `flipDone` | Flip für dieses Panel und diesen Kandidaten (obere bzw. untere Kulmination) in dieser Nacht erledigt (bei Neuplanung aus `tonight.flipDoneByPanel`) | bool |

### 1.1 Meridiandurchgang `tM` (verbindlich, AST-6)
`tM` ist der Zeitpunkt mit lokalem Stundenwinkel `LHA = 0` für die **obere** Kulmination:
```
LHA(t) = GAST(t) + λ_Ost − α_app        (in Grad, normalisiert auf (−180, 180])
α_app, δ_app = J2000-Koordinaten des Panels, präzessiert und nutiert auf das Datum (scheinbarer Ort ohne Aberration)
Start: t0 = Nachtmitte;  Iteration: t ← t − LHA(t)/15,04107 °/h   (siderische Rate, nicht 15,0 °/h)
Abbruch nach |Δt| < 1 s (max. 5 Schritte); Ergebnis auf ganze Sekunden abgerundet
GAST = GMST + Nutation in Rektaszension (Äquinoktialgleichung); UT1 ≈ UTC (|ΔUT1| < 0,9 s, vernachlässigt)
```
- Die Newton-Iteration liefert **eine** Kulmination; weil ein Schritt höchstens 11,9672 h überbrückt (|LHA| ≤ 180°), der siderische Tag aber 23,9345 h dauert, ist bei einem 24- bzw. 25-h-Fenster (Polarnacht, Zeitumstellung) nicht jede erreichbar – bei 25 h liegen 63,9 min (4,45 % aller RA-Werte) in einem Band, aus dem Newton auf die **zweite** Kulmination konvergiert (Fehler 23,93 h, AST-G01). Deshalb wird die Kandidatenmenge explizit gebildet: `t_k = t_Newton + k · (360/15,0410686) h` für `k ∈ {−1, 0, +1}`, und daraus die **kleinste** Lösung in `[nightWindowStart, nightWindowEnd)` genommen. Gesucht wird also die **erste obere Kulmination innerhalb des Nachtfensters**; liegt **keine** darin, gilt `tM = null`; liegen **zwei** darin (25-h-Fenster, Polarnacht), gilt die erste und es gibt keinen Flip in dieser Nacht. Die zweite **obere** Kulmination wird ignoriert (ein Flip je Nacht, Panel und Kandidat).
- **Untere Kulmination (NT-26):** NINA rechnet die Zeit bis zum Meridian **modulo 12 h** (`NINA.Astrometry/MeridianFlip.cs`, `(RA − LST) % 12.0`) und flippt deshalb auch bei LHA = 180°. Die untere Kulmination `tM_u` (LHA = 180°, gleiche Iteration mit Zielwert 180°, erste Lösung im Nachtfenster) ist deshalb ein **zweiter Flip-Kandidat**, wenn die Höhe des Panels dort ≥ Mindesthöhe ist (sonst ist das Ziel dort ohnehin nicht belichtbar). Für diesen Kandidaten gilt die Planungsregel §2 mit `tM := tM_u`; `flipDone` wird je Kandidat geführt.
- Der Fehler durch die Präzession ist erheblich (2000 → 2026 ≈ 80 s in RA, polnah Minuten) – deshalb ist `α_app` Pflicht, nicht die J2000-Rektaszension.
- **Entscheidend ist die Präzession, nicht die Nutation (Klarstellung, WS-24).** „Mittlerer Ort des Datums + GMST“ und „`α_app` + GAST“ sind für `tM` **auf die Sekunde gleichwertig**: die Äquinoktialgleichung `Δψ·cos ε` in GAST hebt den Hauptterm der Nutation in Rektaszension weg, übrig bleibt nur der positionsabhängige Rest `tan δ·(sin ε·sin α·Δψ − cos α·Δε)`. Nachgerechnet für die Beispielnacht (Starfront, 2026-09-18, IAU-1976-Präzession + Nutation nach Meeus Kap. 22): HAT-P-17 – `α_app` = 324,828946° mit GAST **04:28:23,07Z**, mittlerer Ort 324,828134° mit GMST **04:28:23,41Z**, Unterschied **0,35 s**, beide abgerundet **04:28:23Z**. Die J2000-Rektaszension (324,5366°) ergibt dagegen **04:27:13Z**, also **70 s** zu früh – 0,2923° in RA. (NGC 281 zur Gegenprobe: 07:42:55,81Z gegen 07:42:56,55Z, Unterschied 0,73 s; abgerundet 07:42:55Z gegen 07:42:56Z.) Weil der Rest bis knapp unter 1 s reichen und damit die abgerundete Sekunde kippen kann, bleibt **`α_app` + GAST der verbindliche Weg**; die andere Form ist nur für Gegenrechnungen erlaubt und darf in den Referenztests ±1 s abweichen.
- **Geschlossene Form als erlaubte Alternative zur Newton-Iteration (WS-24).** Weil `LHA` mit der siderischen Rate wächst und `α_app` sich über eine Nacht nur im Bogensekundenbereich ändert, darf `tM` auch direkt gerechnet werden:
```
t = t_start + ((360° − LHA(t_start)) mod 360°) / 15,0410686 °/h        # obere Kulmination
t = t_start + ((180° − LHA(t_start)) mod 360°) / 15,0410686 °/h        # untere Kulmination (NT-26)
mit t_start = nightWindowStart und LHA(t_start) auf [0°, 360°) normalisiert
```
  Diese Form liefert **per Konstruktion die erste Kulmination im Fenster**: der Vorlauf ist nie negativ und nie größer als ein siderischer Tag. Die Kandidatenmenge `k ∈ {−1, 0, +1}` entfällt damit – sie bleibt aber **Pflicht für die Newton-Variante** (AST-G01). Liegt das Ergebnis `≥ nightWindowEnd`, gilt `tM = null` (bzw. `tM_u = null`); ein zweites Ergebnis im Fenster ergibt sich, wenn `t + 23,9345 h < nightWindowEnd` (25-h-Fenster), und wird wie in der Newton-Variante ignoriert. Nachgerechnet gegen Newton für die Beispielnacht (Fenster `2026-09-18T00:00:00Z – 13:00:00Z`): HAT-P-17 04:28:23,065Z gegen 04:28:23,066Z, NGC 281 07:42:55,810Z gegen 07:42:55,814Z – **Unterschied ≤ 0,004 s**; die untere Kulmination fällt für beide außerhalb des Fensters (16:26:25Z bzw. 19:40:58Z) und liefert damit korrekt `tM_u = null`. Beide Wege sind zulässig, aber je Implementierung einheitlich, damit `outputHash` reproduzierbar bleibt.
- Referenztest: `gen_targets.py` liefert Meridiandurchgänge; Toleranz ±30 s (TK 9.2).

## 2. Planungsregel im Ablauf (`allocation.md` §8)
Für einen Block `[bS, bE)` mit `tM` ∈ `[bS, bE)` und `flipEnabled`:

```
flipAt   = tM + afterMin·60
limitEnd = pauseBeforeMin > 0 ? tM − pauseBeforeMin·60 : tM + maxAfterMin·60
flipped  = false
vor der Filterwahl jeder Belichtung bei cursor (Dauer D = längste Belichtung + downloadS des Kandidaten-Pools; allocation.md §8):
    wenn !flipped und cursor ≥ flipAt:
        wenn cursor + durationS > bE: Block endet hier (wait bis bE); stopp
        Eintrag meridian_flip(atS=cursor, durationS); cursor += durationS; flipped = true
        Eintrag slew_center_rotate bzw. slew_center (Rotator-Regel §3), Dauer overhead.slewCenterS
    wenn !flipped und cursor + D > limitEnd:
        wartezeit = max(0, flipAt − cursor)
        wenn cursor + wartezeit + durationS > bE: wait bis bE; stopp
        Eintrag wait(atS=cursor, durationS=wartezeit); cursor = flipAt; weiter mit Flip-Prüfung (oben)
    ...
```

- Der Flip liegt an der **ersten Belichtungsgrenze ≥ flipAt**. Das Plugin löst ihn dort **aktiv** aus: beim Eintrag `meridian_flip` wartet es, bis NINAs früheste Flipzeit erreicht ist (`minimumTimeRemaining ≤ 0` aus `TelescopeInfo.TimeToMeridianFlip`, höchstens bis `limitEnd`, M3), und ruft dann die Trigger aller Vorfahren über die eigene Iteration auf (`GetTriggersSnapshot` + Filter, Dither unterdrückt, M1); NINAs Trigger flippt, weil die früheste Flipzeit `tM + afterMin` erreicht ist (NT-21, `specs/nina/execution.md` §4.5). Nach **jedem** erkannten Flip – auch einem ungeplanten – zentriert das Plugin (M3). Abweichungen von ±1 Belichtung sind zulässig (Plugin plant danach neu). Ein `wait` endet spätestens beim folgenden `meridian_flip`.
- **Flip-Dauer (NT-21):** geplant wird mit `durationS = flip_duration_s`; das Plugin meldet die gemessene Dauer `now − max(tTriggerStart, tM + afterMin)` (ohne Wartezeit bis zum Meridian) und verbucht die Differenz zum Plan zusammen mit dem Startverzug des Blocks im Playback-Offset.
- **Nach dem Flip** gibt die Engine **immer** `slew_center` aus (kein `slew_center_rotate`, NT-E4): NINA dreht beim Flip nicht, und der Winkel gilt modulo 180° weiter als richtig. Im Kompatibilitätsmodus bleibt die Ausgabe des Originals.
- Beispiel (Meridian bei 1800 s, 300-s-Belichtungen ohne Overheads, Flip nach 5 min, Dauer 240 s): Belichtungen bei 0 … 1800 s, Flip bei 2100 s, weitere Belichtungen ab 2340 s im 300-s-Takt, solange sie bis Blockende passen.
- Kein `tM` im Block oder `flipEnabled = false` → kein Flip-Eintrag, kein Overhead.
- **Flip im Transit-Vorlauf (L1):** liegt `flipAt` zwischen Vorlaufbeginn (`fenster[0] − slewCenterS − 60 s`) und Fensterbeginn, legt die Engine den Flip in den Vorlauf des Transitblocks – `slew_center(_rotate)` → `meridian_flip` (`atUtc = max(flipAt, Vorlaufbeginn + slewCenterS)`) → `slew_center` → `expose_series` ab `max(fenster[0], Flipende + slewCenterS)` –, also vor die erste Serienbelichtung, und weist ihn aus (`planned: true`; beginnt die Serie nach `fenster[0]`, nennt die Diagnose `flip_in_transit` den späteren Serienbeginn; `transit.md` §3).
- `tM + afterMin` in einem Transitfenster → der Flip ist unvermeidlich (NINA flippt nie vor `tM`, ein Vorziehen ist nicht möglich; NT-25). Kein Flip-Eintrag im Plan, aber die erwartete Lücke (Beginn, Dauer inkl. Zentrieren) wird ausgewiesen; Diagnose `flip_in_transit` (rot im Simulator), bei `AutoFocusAfterFlip` des NINA-Profils mit Zusatz „AF nach Flip aktiv“. Plugin: `specs/nina/execution.md` §5.
- **Block-Metadaten – eine Struktur (verbindlich, ENG5-4…7):** `meridianFlip: { waitStartUtc: string|null, plannedUtc: string, durationS: number, inTransitWindow: boolean, planned: boolean, gapStartUtc: string|null, gapDurationS: number|null }` (TK 7.6, `contracts/nina/README.md`). `waitStartUtc` = Beginn der Wartezeit (`wait`-Eintrag) vor dem Flip, `null`, wenn nicht gewartet wird; `plannedUtc` = `flipAt` = `tM + afterMin·60`; `durationS` = `flip_duration_s` des Profils (Flip selbst, **ohne** die anschließende Zentrierung – die steht als eigener `slew_center_rotate`/`slew_center`-Eintrag und ist in `fix` als `slewCenterS` verbucht, `allocation.md` §2); `planned = true`, wenn der Block einen `meridian_flip`-Eintrag enthält; **eine Definition (M8):** `inTransitWindow = true`, wenn `tM` im Transitfenster liegt; `gapStartUtc`/`gapDurationS` (erwartete Lücke: Beginn, Flip + Zentrieren, `transit.md` §3) nur, wenn `tM + afterMin` im Fenster liegt (NT-25; dann `planned = false` und Diagnose `flip_in_transit`), sonst beide `null` – auch in allen regulären Blöcken. Der Name `flipUtc` wird nicht mehr verwendet.

## 3. Rotation
**Konvention:** Positionswinkel `pa` = Winkel der Bild-Oberkante (Sensor-Y) von Himmelsnord über Ost, 0 ≤ pa < 360 (wie NINA Framing-Assistent / *Center and Rotate*; Bestätigung in AP-S2b). Panel-Positionswinkel: `geometry.md` §2.

**Ist-Winkel ohne Rotator (verbindlich, NIN-4):** Quelle ist ein **eigenes Plate-Solve** nach dem Zentrieren (`IPlateSolverFactory` → `CaptureSolver`/`ImageSolver`, `PlateSolveResult.PositionAngle`), weil NINAs *Center*-Anweisung ihr Ergebnis nicht herausgibt. Gelingt kein Solve, gilt der Winkel als **unbekannt**: Warnung `rotation_unknown`, **kein** `rotation_mismatch`, Block läuft weiter; `lastMeasuredRotationDeg` bleibt leer.

| Rig | Soll | Nach Flip | Vergleich Ist ↔ Soll |
|---|---|---|---|
| mit Rotator (`has_rotator`) | `pa` des Panels | **kein Nachrotieren** (NT-E4): NINA dreht beim Flip nicht, der mechanische Winkel bleibt, der Himmels-PA ändert sich um 180°; das Plugin zentriert nur | **modulo 180:** `r = \|ist − soll\| mod 180; Δ = min(r, 180 − r)` |
| ohne Rotator | `rig.default_rotation_deg` (Kamerawinkel) | keine Aktion | **modulo 180:** `r = \|ist − soll\| mod 180; Δ = min(r, 180 − r)` |

**Modulo 180° überall (verbindlich, NT-E4):** PA und PA + 180° ergeben dasselbe Bildfeld (um 180° gedreht) und gelten als gleich. Mit Rotator übergibt das Plugin `CenterAndRotate.PositionAngle = pa`; NINA wählt bei `RotatorSettings.RangeType` `FULL` oder `HALF` selbst PA oder PA + 180° (`FULL`: näherer Wert; `HALF`: Wert im erlaubten 180°-Bereich); `QUARTER` legt den Zielwinkel in einen 90°-Bereich und kann PA + 90°/PA + 270° anfahren – nicht zulässig, Alarmcode `rotator_range_quarter` (M2) und prüft die Toleranz ebenfalls modulo 180° (`CenterAndRotate.cs`: `Angle.Equals(…, oneEightyIsEqual: true)`; `RotatorVM.GetTargetMechanicalPosition`). Die frühere Formel `Δ = |((ist − soll + 540) mod 360) − 180|` für Rigs mit Rotator entfällt.

`Δ > rotation_tolerance_deg` → mit Rotator: erneut `CenterAndRotate` (nur vor bzw. am Blockanfang, nie nach dem Flip); ohne Rotator (oder Rotator nicht verbunden, dann zusätzlich `warning` Code `rotator_unavailable`, NT-29): Ereignis `rotation_mismatch`; bei `skip_on_rotation_mismatch` Block überspringen (`block_skipped`, Grund `rotation_mismatch`), sonst Warnung und weiter. Meldet das Plate-Solve eine gespiegelte Optik (`Flipped`), ist die Winkelprüfung nicht definiert: `warning` Code `optics_mirrored`, keine Prüfung (nicht unterstützt, NT-33).

**Spec-Ergänzung (Rig-Nacht 06.10.2026, Entscheidung Sven, Plugin 0.4.10) – keine Prüfung ohne Rotator:** Hat das Rig **keinen** Rotator (`rig.rotator.present = false`) und ist `skip_on_rotation_mismatch` aus, prüft das Plugin den Winkel nicht: kein eigenes Plate-Solve, kein `rotation_mismatch`, kein `rotation_unknown`. Ohne Rotator lässt sich nichts drehen, und belichtet wird ohnehin; am Starfront-Rig kam sonst vor jedem Block `ROTATION_MISMATCH` (136° gemessen, 0° erwartet). Mit `skip_on_rotation_mismatch` bleibt die Prüfung, weil der Benutzer Blöcke bei falsch gedrehter Kamera ausdrücklich überspringen will; mit Rotator im Rig (auch wenn er nicht verbunden ist, `rotator_unavailable`) bleibt sie ebenfalls.

**Feste Kamera (`fixed_camera`, NT-30):** ohne Rotator ist `block.rotationDeg` = Kamerawinkel `rig.default_rotation_deg`; bei Mosaiken ohne Rotator gilt `pa₀ := rig.default_rotation_deg` (`geometry.md` §2).

Winkel werden vor Vergleichen auf 1e-6 gerundet; Ausgaben mit 6 Nachkommastellen. **Normalisierung nach dem Runden (NT-31):** `x ≥ 360 → x − 360`, `−0 → 0`; gespeicherte Winkel erfüllen damit `0 ≤ x < 360` (Schema-CHECK `< 360`). Beispiel: `359,9999996` rundet auf `360,000000` und wird zu `0`.

### Grenzwert-Tabelle (Pflicht-Unit-Tests, Toleranz 5°)
| Rotator | Soll | Ist | Δ | Ergebnis |
|---|---|---|---|---|
| nein | 90 | 270 | 0 | ok |
| nein | 90 | 95 | 5 | ok (≤) |
| nein | 90 | 95.000001 | 5.000001 | mismatch |
| nein | 2 | 178 | 4 | ok |
| nein | 0 | 185 | 5 | ok |
| ja | 90 | 270 | 0 | ok (NT-E4; z. B. nach dem Flip) |
| ja | 359 | 3 | 4 | ok |
| ja | 0 | 354.9 | 5.1 | mismatch → rotieren |
| ja | 0 | 185 | 5 | ok (≤) |
| ja | 45 | 230.000001 | 5.000001 | mismatch → rotieren |

## 4. Flats und Rotation
Flat-Kombinationen verwenden den **mechanischen** Rotatorwinkel (ohne Rotator 0), aber **geclustert** – ein festes Raster (`round(mech/tol)·tol`) genügt nicht, weil Winkel dicht an einer Rasterkante auseinanderfallen (nachgerechnet: 12 Winkel zwischen 88,0° und 92,0° ergeben bei `tol = 2,5°` drei Raster-Bins). Verbindlich ist **einfach verkettetes Clustern auf den sortierten Winkeln** (deterministisch, reihenfolgeunabhängig), gerechnet **erst am Ende der Nacht**, wenn alle Lights gespeichert sind:
```
tol = max(1°, rotation_tolerance_deg / 2)
winkel = sortierte Liste aller gemeldeten mechanischen Winkel der Nacht (q(x, 10), also 0,1°)
neuer Cluster, sobald winkel[i] − winkel[i−1] > tol; zusätzlich Wrap-Prüfung (winkel[0] + 360) − winkel[n−1] ≤ tol
Repräsentant = Median des Clusters, q(·, 10); bei einem **Wrap-Cluster** wird der Median auf der **entrollten** Kette gebildet (+360° für die vom Wrap übernommenen Werte) und anschließend `mod 360` genommen – der Median der wertsortierten Liste wäre falsch (AST-G06);  Schlüssel = repräsentativer Winkel in Zehntelgrad (Ganzzahl)
```
- Der Repräsentant wird beim Anlegen der Kombination **eingefroren** (`flat_combination_local.mech_deg_dg`) und für alle Meldungen dieser Kombination unverändert gesendet; er ist auch der Anfahrwinkel (`MoveMechanical`). Ohne Einfrieren würde eine weitere Light-Aufnahme den Median verschieben und serverseitig eine zweite Kombination erzeugen (NIN5-8).
- Ein Flip ändert den mechanischen Winkel **nicht** (NINA dreht den Rotator beim Flip nicht, das Plugin rotiert nicht nach; §3, NT-E4) und erzeugt daher **keine** zweite Kombination. Zwei Kombinationen je Filter entstehen nur, wenn der Rotator in der Nacht tatsächlich auf verschiedene mechanische Winkel gefahren wurde (z. B. Ziele mit verschiedenem PA). Der Pflicht-Test „plus 180°“ unten prüft nur das Clustern.
- Pflicht-Tests (nachgerechnet): 12 Winkel 88,0…92,0° mit `tol = 2,5°` → **eine** Kombination mit Repräsentant 90,0°; dieselben Winkel plus 180° → **zwei** Kombinationen (90,0° und 270,0°); Winkel 359,0 / 0,5 / 1,0 → **eine** Kombination (Wrap) mit Repräsentant **0,5°** (entrollt 359,0 / 360,5 / 361,0 → Median 360,5 → 0,5°; der Median der wertsortierten Liste wäre fälschlich 1,0°, AST-G06); Gegenprobe {358, 359, 0, 1, 2} bei `tol = 2,5` → **0,0°**, nicht 2,0°.

## 5. Plugin-Abgleich (FA-NIN-24)
Heartbeat meldet `meridianFlip {triggerPresent, afterMin, maxAfterMin, pauseBeforeMin}` aus dem NINA-Profil, erweitert um `useSideOfPier`, `recenter`, `autoFocusAfterFlip`, `settleTimeS` (`MeridianFlipSettings`), dazu `RotatorSettings` (`RangeType` – nur `FULL`/`HALF` zulässig, `QUARTER` → Code `rotator_range_quarter`, M2 –, `RangeStartMechanicalPosition`, Umkehr) und `PlateSolveSettings.RotationTolerance` (NT-22; vollständige Liste `specs/nina/execution.md` §6, Feldnamen `contracts/nina/README.md`). Abweichung von den Rig-Werten um > 0,5 min, `triggerPresent=false` bei `flipEnabled` oder `recenter = true` (Vorgabe: NINA-Recenter nach Flip **aus**, das Plugin zentriert selbst) → Alarm `alert.nina_settings_mismatch` mit Code-Liste (S-10, Kategorie `alerts`).
