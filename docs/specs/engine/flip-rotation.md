# Spezifikation: Meridian-Flip und Rotation

Verbindlich für AP-13d (Planung), AP-16g (Plugin). Bezug: FA-SCH-17, FA-RIG-10…14, FA-NIN-23/24, Fachkonzept 8.8. Soll-Plan: Fall „Meridian-Flip“ in `contracts/golden-plans/`. Ausführung in NINA: `specs/nina/execution.md` §5.

## 1. Eingaben
| Feld | Quelle | Einheit |
|---|---|---|
| `flipEnabled` | `rig.flip_enabled` | bool |
| `afterMin` | `rig.flip_after_meridian_min` | min |
| `maxAfterMin` | `rig.flip_max_after_meridian_min` (≥ afterMin) | min |
| `pauseBeforeMin` | `rig.flip_pause_before_meridian_min` | min |
| `durationS` | `rig.flip_duration_s` | s |
| `tM` | Meridiandurchgang (obere Kulmination) des **aktiven Panels** im Block, ganze Sekunde (abgerundet); Projekt-Einheiten: Panel der nächsten Belichtung. Berechnung §1.1 | s |
| `flipDone` | Flip für dieses Panel in dieser Nacht erledigt (bei Neuplanung aus `tonight.flipDoneByPanel`) | bool |

### 1.1 Meridiandurchgang `tM` (verbindlich, AST-6)
`tM` ist der Zeitpunkt mit lokalem Stundenwinkel `LHA = 0` für die **obere** Kulmination:
```
LHA(t) = GAST(t) + λ_Ost − α_app        (in Grad, normalisiert auf (−180, 180])
α_app, δ_app = J2000-Koordinaten des Panels, präzessiert und nutiert auf das Datum (scheinbarer Ort ohne Aberration)
Start: t0 = Nachtmitte;  Iteration: t ← t − LHA(t)/15,04107 °/h   (siderische Rate, nicht 15,0 °/h)
Abbruch nach |Δt| < 1 s (max. 5 Schritte); Ergebnis auf ganze Sekunden abgerundet
GAST = GMST + Nutation in Rektaszension (Äquinoktialgleichung); UT1 ≈ UTC (|ΔUT1| < 0,9 s, vernachlässigt)
```
- Gesucht wird die **erste obere Kulmination innerhalb des Nachtfensters**; liegt keine darin (auch im 25-h-Fenster der Zeitumstellung oder in der Polarnacht, wo zwei Kulminationen im Fenster liegen können), gilt `tM = null` und es gibt keinen Flip in dieser Nacht. Die zweite Kulmination wird ignoriert (ein Flip je Nacht und Panel).
- Zirkumpolare Ziele: nur die **obere** Kulmination zählt; die untere (LHA = 180°) wird ignoriert.
- Der Fehler durch die Präzession ist erheblich (2000 → 2026 ≈ 80 s in RA, polnah Minuten) – deshalb ist `α_app` Pflicht, nicht die J2000-Rektaszension.
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

- Der Flip liegt an der **ersten Belichtungsgrenze ≥ flipAt**. Die tatsächliche Flipzeit bestimmt NINAs Trigger aus `TimeToMeridianFlip` der Montierung; Abweichungen von ±1 Belichtung sind zulässig (Plugin plant danach neu, `specs/nina/execution.md` §4).
- Beispiel (Meridian bei 1800 s, 300-s-Belichtungen ohne Overheads, Flip nach 5 min, Dauer 240 s): Belichtungen bei 0 … 1800 s, Flip bei 2100 s, weitere Belichtungen ab 2340 s im 300-s-Takt, solange sie bis Blockende passen.
- Kein `tM` im Block oder `flipEnabled = false` → kein Flip-Eintrag, kein Overhead.
- `tM` in einem Transitblock → kein Flip-Eintrag im Plan; Diagnose `flip_in_transit` (rot im Simulator). Das Plugin folgt FA-NIN-21.
- **Block-Metadaten – eine Struktur (verbindlich, ENG5-4…7):** `meridianFlip: { waitStartUtc: string|null, plannedUtc: string, durationS: number, inTransitWindow: boolean, planned: boolean }` (TK 7.6, `contracts/nina/README.md`). `waitStartUtc` = Beginn der Wartezeit (`wait`-Eintrag) vor dem Flip, `null`, wenn nicht gewartet wird; `plannedUtc` = `flipAt` = `tM + afterMin·60`; `durationS` = `flip_duration_s` des Profils (Flip selbst, **ohne** die anschließende Zentrierung – die steht als eigener `slew_center_rotate`/`slew_center`-Eintrag und ist in `fix` als `slewCenterS` verbucht, `allocation.md` §2); `planned = true`, wenn der Block einen `meridian_flip`-Eintrag enthält; `inTransitWindow = true`, wenn `tM` in einem Transitfenster liegt (dann `planned = false` und Diagnose `flip_in_transit`). Der Name `flipUtc` wird nicht mehr verwendet.

## 3. Rotation
**Konvention:** Positionswinkel `pa` = Winkel der Bild-Oberkante (Sensor-Y) von Himmelsnord über Ost, 0 ≤ pa < 360 (wie NINA Framing-Assistent / *Center and Rotate*; Bestätigung in AP-S2b). Panel-Positionswinkel: `geometry.md` §2.

**Ist-Winkel ohne Rotator (verbindlich, NIN-4):** Quelle ist ein **eigenes Plate-Solve** nach dem Zentrieren (`IPlateSolverFactory` → `CaptureSolver`/`ImageSolver`, `PlateSolveResult.PositionAngle`), weil NINAs *Center*-Anweisung ihr Ergebnis nicht herausgibt. Gelingt kein Solve, gilt der Winkel als **unbekannt**: Warnung `rotation_unknown`, **kein** `rotation_mismatch`, Block läuft weiter; `lastMeasuredRotationDeg` bleibt leer.

| Rig | Soll | Nach Flip | Vergleich Ist ↔ Soll |
|---|---|---|---|
| mit Rotator (`has_rotator`) | `pa` des Panels | Plugin rotiert erneut auf `pa` (`slew_center_rotate`); mechanischer Winkel ändert sich um 180° | `Δ = |((ist − soll + 540) mod 360) − 180|` |
| ohne Rotator | `rig.default_rotation_deg` (Kamerawinkel) | keine Aktion | **modulo 180:** `r = |ist − soll| mod 180; Δ = min(r, 180 − r)` |

`Δ > rotation_tolerance_deg` → ohne Rotator: Ereignis `rotation_mismatch`; bei `skip_on_rotation_mismatch` Block überspringen (`block_skipped`, Grund `rotation_mismatch`), sonst Warnung und weiter.

Winkel werden vor Vergleichen auf 1e-6 gerundet; Ausgaben mit 6 Nachkommastellen.

### Grenzwert-Tabelle (Pflicht-Unit-Tests, Toleranz 5°)
| Rotator | Soll | Ist | Δ | Ergebnis |
|---|---|---|---|---|
| nein | 90 | 270 | 0 | ok |
| nein | 90 | 95 | 5 | ok (≤) |
| nein | 90 | 95.000001 | 5.000001 | mismatch |
| nein | 2 | 178 | 4 | ok |
| nein | 0 | 185 | 5 | ok |
| ja | 90 | 270 | 180 | mismatch → rotieren |
| ja | 359 | 3 | 4 | ok |
| ja | 0 | 354.9 | 5.1 | mismatch → rotieren |

## 4. Flats und Rotation
Flat-Kombinationen verwenden den **mechanischen** Rotatorwinkel (ohne Rotator 0), aber **geclustert** – ein festes Raster (`round(mech/tol)·tol`) genügt nicht, weil Winkel dicht an einer Rasterkante auseinanderfallen (nachgerechnet: 12 Winkel zwischen 88,0° und 92,0° ergeben bei `tol = 2,5°` drei Raster-Bins). Verbindlich ist **einfach verkettetes Clustern auf den sortierten Winkeln** (deterministisch, reihenfolgeunabhängig), gerechnet **erst am Ende der Nacht**, wenn alle Lights gespeichert sind:
```
tol = max(1°, rotation_tolerance_deg / 2)
winkel = sortierte Liste aller gemeldeten mechanischen Winkel der Nacht (q(x, 10), also 0,1°)
neuer Cluster, sobald winkel[i] − winkel[i−1] > tol; zusätzlich Wrap-Prüfung (winkel[0] + 360) − winkel[n−1] ≤ tol
Repräsentant = Median des Clusters, q(·, 10);  Schlüssel = repräsentativer Winkel in Zehntelgrad (Ganzzahl)
```
- Der Repräsentant wird beim Anlegen der Kombination **eingefroren** (`flat_combination_local.mech_deg_dg`) und für alle Meldungen dieser Kombination unverändert gesendet; er ist auch der Anfahrwinkel (`MoveMechanical`). Ohne Einfrieren würde eine weitere Light-Aufnahme den Median verschieben und serverseitig eine zweite Kombination erzeugen (NIN5-8).
- Ein Flip mit Rotator verschiebt den mechanischen Winkel um 180° und erzeugt damit **eine** zweite Kombination (FA-NIN-17).
- Pflicht-Tests (nachgerechnet): 12 Winkel 88,0…92,0° mit `tol = 2,5°` → **eine** Kombination mit Repräsentant 90,0°; dieselben Winkel plus 180° → **zwei** Kombinationen (90,0° und 270,0°); Winkel 359,0 / 0,5 / 1,0 → **eine** Kombination (Wrap) mit Repräsentant 1,0°.

## 5. Plugin-Abgleich (FA-NIN-24)
Heartbeat meldet `meridianFlip {triggerPresent, afterMin, maxAfterMin, pauseBeforeMin}` aus dem NINA-Profil. Abweichung von den Rig-Werten um > 0,5 min oder `triggerPresent=false` bei `flipEnabled` → Hinweis `nina.settings_mismatch` (S-10, Kategorie `alerts`).
