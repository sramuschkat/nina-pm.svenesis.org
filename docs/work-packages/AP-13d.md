# AP-13d – Engine: Flip, Transit, Diagnose + Soll-Pläne Ablauf

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-13c · **Menschliche Aufgaben:** H-13

## Ziel
Flip, Transit und Diagnose vervollständigen den Plan, und die Ablauf-Soll-Pläne machen ihn dauerhaft prüfbar. Merge erst nach Sichtprüfung der Soll-Pläne (H-13).

## Anforderungen
FA-SCH-17, FA-RIG-10/11, FA-SIM-03, FA-EXO-22…24, FK 8.8

## Lesen (nur diese Abschnitte)
- specs/engine/flip-rotation.md (inkl. §1.1 `tM`)
- specs/engine/transit.md §3
- specs/engine/geometry.md §2 (Panel-PA)
- specs/engine/allocation.md §7.1 (inkl. Transit-Vorlauf), §8 (Pierseitenwechsel), §8.2, §9 (Panelreihenfolge nach einem Flip), §10 (A-5, A-12, A-19, A-21), §12
- contracts/golden-plans/README.md
- contracts/enums.json (diagnosticReasons, simulatorWarnings)
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- **`tM`-Verfahren (WS-24):** erlaubt sind die Newton-Iteration **oder** die geschlossene Form `t = t_start + ((360° − LHA(t_start)) mod 360°)/15,0410686 °/h` (untere Kulmination mit Zielwert 180°), die per Konstruktion die erste Kulmination im Fenster liefert. Je Implementierung (Server, Browser-Worker, Jint) wird **einheitlich eines von beiden** benutzt – ein Mischbetrieb treibt den `outputHash` auseinander. „Mittlerer Ort + GMST“ und „α_app + GAST“ sind auf die Sekunde gleichwertig (HAT-P-17, Starfront, 18.09.2026: beide 04:28:23Z); entscheidend ist allein die **Präzession** auf das Datum – mit der J2000-Rektaszension liegt `tM` 70 s daneben und damit weit über der Toleranz ± 30 s (`flip-rotation.md` §1.1)
- Meridiandurchgang `tM` je Panel (scheinbare RA, GAST, siderische Rate), Flip-Planung vor der Filterwahl, Block-Metadaten `meridianFlip` inkl. `inTransitWindow` (= `tM` im Transitfenster) und `gapStartUtc`/`gapDurationS` (nur bei `tM + afterMin` im Fenster, sonst `null`; eine Definition, M8)
- **Flip-Regeln der Nachtablauf-Prüfung:** untere Kulmination (LHA = 180°) als zweiter Flip-Kandidat, wenn die Höhe dort ≥ Mindesthöhe (NT-26); nach dem Flip **immer** `slew_center`, nie `slew_center_rotate` (NT-E4); wechselt die erwartete Pierseite zwischen zwei Blöcken, zählt `flipDurationS` zum Slew (NT-27); nach einem Flip bevorzugt die Panelreihenfolge Panels, deren `tM` schon überschritten ist
- **Rotation:** Vergleich überall modulo 180° (`r = |ist − soll| mod 180; Δ = min(r, 180 − r)`, NT-E4); `fixed_camera`: `block.rotationDeg` = `rig.default_rotation_deg`, Mosaik ohne Rotator mit `pa₀ := rig.default_rotation_deg` (NT-30); Winkel nach dem Runden normalisieren (`x ≥ 360 → x − 360`, `−0 → 0`, NT-31)
- Transit-Reservierung (`preClaimTransits` nach `locked_at`, Konfliktregel), `expose_series` bis Fensterende; **Vorlauf-Sperre:** zusätzlich jeder Slot, der `[fenster0 − slewCenterS − 60 s, fenster0)` schneidet (NT-25); liegt `tM + afterMin` im Fenster: kein Flip-Eintrag, erwartete Lücke (Flip + Zentrieren) in `meridianFlip`, Diagnose `flip_in_transit`; **liegt `tM + afterMin` im Vorlauf** vor dem Fensterbeginn: Flip als Eintrag in den Vorlauf, vor die erste Serienbelichtung, `planned: true`, späterer Serienbeginn in `flip_in_transit` ausgewiesen (L1, `transit.md` §3)
- Warnungen (§12) und **ein** Diagnose-Kanal `diagnostics[]` (auch je Zeile für das Aufwand-Kennzeichen)
- Ablauf-Soll-Pläne (`contracts/golden-plans/`) mit Erklärung und `oracleDiff`, inkl. Flip-, Transit- und Panel-Fällen

## Nicht im Umfang
- Aufwand (AP-13e), UI (AP-13f)

## Automatisierte Abnahme
- [ ] alle abgenommenen Soll-Pläne exakt
- [ ] Rotations-Grenzwerttabelle aus `flip-rotation.md` §3 (modulo 180°: mit Rotator Soll 90°, Ist 270° → ok) und Flip-Fälle (im Block / außerhalb / passt nicht / aus / Pause vor Meridian / im Transit / untere Kulmination)
- [ ] `tM`-Referenztest ±30 s; dazu ein Determinismus-Test, dass Newton-Iteration und geschlossene Form in **derselben** Implementierung nicht gemischt werden (gleicher `outputHash` über alle Hosts, WS-24)
- [ ] Panel-PA-Tests aus `geometry.md` §2.3 inkl. `fixed_camera` (`default_rotation_deg = 12°` → `block.rotationDeg = 12` für alle Panels) und Normalisierung (`359,9999999` → `0`)
- [ ] Pierseitenwechsel: erster Slew-Eintrag des Folgeblocks mit `durationS = slewCenterS + flipDurationS` (Beispielnacht 330 s, `contracts/nina/README.md`)
- [ ] Transit-Vorlauf: ein Slot, der `[fenster0 − slewCenterS − 60 s, fenster0)` schneidet, bleibt frei; Flip im Fenster → Lücke ausgewiesen, kein `meridian_flip`-Eintrag; `tM + afterMin = fenster0 − 60 s` → `meridian_flip` im Vorlauf vor `expose_series` (L1); `tM` im Fenster, `tM + afterMin` danach → `inTransitWindow: true`, Lücken-Felder `null` (M8)
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
Soll-Pläne (Ablauf) abnehmen; **Merge erst nach Abnahme** (H-13)
